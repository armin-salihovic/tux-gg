#!/usr/bin/env python3
"""Safely migrate an existing TuxGG database and verify its runtime grants."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"
EXPECTED_DATABASE = "tuxgg"
MAINTENANCE_DATABASE = "postgres"
LEGACY_ROLE = "tuxgg_app"
MIGRATION_ROLE = "tuxgg_migrator"
TEST_MARKER_TABLE = "public.tuxgg_test_safety_marker"
TEST_MARKER = "tuxgg_disposable_test_database_v1"
TEST_DATABASE_PATTERN = re.compile(r"^tuxgg_upgrade_test_[a-f0-9]{12}$")
PRESERVED_TABLES = (
    "games",
    "reports",
    "compatibility_summaries",
    "import_batches",
    "user",
    "session",
    "account",
    "verification",
    "native_reports",
)
TABLE_PRIVILEGES = ("SELECT", "INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER")
UNSAFE_MIGRATION = re.compile(
	r"\b(?:DROP\s+(?:DATABASE|SCHEMA|TABLE|COLUMN|CONSTRAINT)|TRUNCATE\b|DELETE\s+FROM\b)",
    re.IGNORECASE,
)
URL_RE = re.compile(r"postgres(?:ql)?://[^\s\"'<>]+", re.IGNORECASE)
ALTER_TABLE_PATTERN = re.compile(
	r"\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:public\.)?\"?([a-zA-Z_][a-zA-Z0-9_]*)\"?",
	re.IGNORECASE,
)

sys.path.insert(0, str(ROOT / "scripts"))
from setup_database import (  # noqa: E402
    NATIVE_REPORT_INSERT_COLUMNS,
    WEB_PRIVILEGES,
    grant_native_report_insert_columns,
)


def read_env_file() -> dict[str, str]:
	values: dict[str, str] = {}
	if not ENV_FILE.exists():
		return values
	for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
		line = line.strip()
		if not line or line.startswith("#") or "=" not in line:
			continue
		key, value = line.split("=", 1)
		values[key.strip()] = value.strip().strip("\"'")
	return values


def env_value(name: str, file_values: dict[str, str]) -> str:
	value = os.environ.get(name) or file_values.get(name)
	if not value:
		raise RuntimeError(f"Set {name} in the process environment or private .env file.")
	return value


def safe_connect(url: str, label: str):
	try:
		import psycopg
	except ImportError as exc:
		raise RuntimeError(
			"Install PostgreSQL Python dependencies with `python -m pip install -r importer/requirements.txt`."
		) from exc
	try:
		return psycopg.connect(url, autocommit=True, connect_timeout=10, application_name="tuxgg-db-upgrade")
	except Exception as exc:
		raise RuntimeError(f"Could not connect using {label}; verify that credential and database configuration.") from exc


@contextmanager
def connection(url: str, label: str):
	conn = safe_connect(url, label)
	try:
		yield conn
	finally:
		conn.close()


def url_database(url: str) -> str:
	return unquote(urlsplit(url).path.rstrip("/").rsplit("/", 1)[-1])


def url_username(url: str) -> str:
	return unquote(urlsplit(url).username or "")


def url_for_database(source: str, database: str) -> str:
	parts = urlsplit(source)
	if not parts.scheme.startswith("postgres") or not parts.hostname:
		raise RuntimeError("Database variables must be PostgreSQL URLs with a host.")
	return parts._replace(path=f"/{database}").geturl()


def identities(database_url: str, migration_url: str, admin_url: str, test_mode: bool) -> dict[str, str]:
	app_database = url_database(database_url)
	if url_database(admin_url) != MAINTENANCE_DATABASE:
		raise RuntimeError("PGADMIN_URL must connect to the postgres maintenance database.")
	if app_database != EXPECTED_DATABASE:
		if not test_mode or not (
			app_database == "tuxgg_test" or TEST_DATABASE_PATTERN.fullmatch(app_database)
		):
			raise RuntimeError(
				"Refusing to upgrade this database. DATABASE_URL must target tuxgg; disposable integration tests require --allow-test-database and a marked test database."
			)
	if url_database(migration_url) != app_database:
		raise RuntimeError("DATABASE_URL and MIGRATION_DATABASE_URL must target the same intended database.")
	if url_username(database_url) not in ("tuxgg_web", LEGACY_ROLE):
		raise RuntimeError("DATABASE_URL must use the configured tuxgg_web role or the legacy tuxgg_app role.")
	if url_username(migration_url) != MIGRATION_ROLE:
		raise RuntimeError("MIGRATION_DATABASE_URL must use the dedicated tuxgg_migrator role.")
	if url_username(admin_url) in (url_username(database_url), url_username(migration_url)):
		raise RuntimeError("PGADMIN_URL must use a separate PostgreSQL administration account.")

	admin_target_url = url_for_database(admin_url, app_database)
	try:
		with connection(admin_url, "PGADMIN_URL") as conn, conn.cursor() as cur:
			cur.execute("SELECT current_database(), current_user, rolsuper FROM pg_roles WHERE rolname = current_user")
			admin_row = cur.fetchone()
			if not admin_row or admin_row[0] != MAINTENANCE_DATABASE:
				raise RuntimeError("PGADMIN_URL must connect to the postgres maintenance database.")
			if not admin_row[2]:
				raise RuntimeError(
					"PGADMIN_URL must use a PostgreSQL superuser so the upgrade can grant reviewed privileges without changing role ownership."
				)
			cur.execute("SELECT system_identifier FROM pg_control_system()")
			system_identifier = cur.fetchone()[0]
			cur.execute("SELECT oid FROM pg_database WHERE datname = %s", (app_database,))
			database_row = cur.fetchone()
			if not database_row:
				raise RuntimeError(f"The intended database {app_database} does not exist.")
			admin_database_oid = database_row[0]
		with connection(admin_target_url, "PGADMIN_URL target-database connection") as conn, conn.cursor() as cur:
			cur.execute(
				"SELECT current_database(), current_user, inet_server_addr()::text, inet_server_port(), "
				"current_setting('server_version_num')"
			)
			admin_target = cur.fetchone()
			if not admin_target or admin_target[0] != app_database:
				raise RuntimeError("PGADMIN_URL did not reach the intended target database on the expected PostgreSQL installation.")
			cur.execute("SELECT system_identifier FROM pg_control_system()")
			if cur.fetchone()[0] != system_identifier:
				raise RuntimeError("PGADMIN_URL connections do not refer to the same PostgreSQL installation.")
			cur.execute("SELECT oid FROM pg_database WHERE datname = current_database()")
			if cur.fetchone()[0] != admin_database_oid:
				raise RuntimeError("The maintenance and target connections do not refer to the same PostgreSQL database catalog.")
			if test_mode and app_database != EXPECTED_DATABASE:
				verify_test_marker(cur, app_database)
			cluster_address = (admin_target[2], admin_target[3])
			cluster_version = admin_target[4]

		for label, url, expected_role in (
			("DATABASE_URL", database_url, url_username(database_url)),
			("MIGRATION_DATABASE_URL", migration_url, MIGRATION_ROLE),
		):
			if url_database(url) != app_database:
				raise RuntimeError(f"{label} must target {app_database}.")
			with connection(url, label) as conn, conn.cursor() as cur:
				cur.execute(
					"SELECT current_database(), current_user, inet_server_addr()::text, inet_server_port(), current_setting('server_version_num')"
				)
				row = cur.fetchone()
				if not row or row[0] != app_database or row[1] != expected_role:
					raise RuntimeError(f"{label} credentials did not connect as the expected role to {app_database}.")
				if (row[2], row[3]) != cluster_address:
					raise RuntimeError(f"{label} does not connect to the same PostgreSQL installation as PGADMIN_URL.")
				if row[4] != cluster_version:
					raise RuntimeError(f"{label} reports a different PostgreSQL server version from PGADMIN_URL.")
				cur.execute("SELECT oid FROM pg_database WHERE datname = current_database()")
				if cur.fetchone()[0] != admin_database_oid:
					raise RuntimeError(f"{label} reached a different PostgreSQL database catalog than PGADMIN_URL.")
				if label == "MIGRATION_DATABASE_URL":
					cur.execute(
						"SELECT has_database_privilege(current_user, current_database(), 'CREATE'), "
						"has_schema_privilege(current_user, 'public', 'USAGE'), "
						"has_schema_privilege(current_user, 'public', 'CREATE')"
					)
					privileges = cur.fetchone()
					if not privileges[0] or not privileges[1] or not privileges[2]:
						raise RuntimeError(
							"MIGRATION_DATABASE_URL role needs CREATE on the target database and USAGE/CREATE on schema public. Ask the database owner to restore the dedicated migration role's existing setup grants; db:upgrade will not change role ownership."
						)
					cur.execute(
						"SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls "
						"FROM pg_roles WHERE rolname = current_user"
					)
					attrs = cur.fetchone()
					if not attrs or any(attrs):
						raise RuntimeError("The migration role has administrator attributes; restore its restricted TuxGG configuration.")
					cur.execute(
						"SELECT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user))"
					)
					if cur.fetchone()[0]:
						raise RuntimeError("The migration role has role memberships; remove them before upgrading.")
		return {"database": app_database, "runtime_role": url_username(database_url), "migration_role": MIGRATION_ROLE}
	except RuntimeError:
		raise
	except Exception as exc:
		if "pg_control_system" in str(exc):
			raise RuntimeError(
				"Could not verify PostgreSQL system identity. PGADMIN_URL needs permission to read pg_control_system()."
			) from exc
		raise RuntimeError("Could not verify the database connection identities and permissions.") from exc


def verify_test_marker(cur, database: str) -> None:
	if database == "tuxgg_test" or TEST_DATABASE_PATTERN.fullmatch(database):
		cur.execute("SELECT to_regclass(%s)", (TEST_MARKER_TABLE,))
		if cur.fetchone()[0] is None:
			raise RuntimeError("Refusing test database changes without the project disposable-database marker.")
		cur.execute(f"SELECT marker FROM {TEST_MARKER_TABLE} WHERE id = 1")
		row = cur.fetchone()
		if not row or row[0] != TEST_MARKER:
			raise RuntimeError("Refusing test database changes without the valid disposable-database marker.")


def read_migrations() -> list[dict[str, object]]:
	journal_path = ROOT / "drizzle" / "meta" / "_journal.json"
	try:
		journal = json.loads(journal_path.read_text(encoding="utf-8"))
	except Exception as exc:
		raise RuntimeError("The Drizzle migration journal could not be read.") from exc
	entries = journal.get("entries")
	if not isinstance(entries, list) or not entries:
		raise RuntimeError("The Drizzle migration journal contains no reviewed migration entries.")
	result: list[dict[str, object]] = []
	seen_when: set[int] = set()
	for entry in entries:
		if not isinstance(entry, dict) or not isinstance(entry.get("tag"), str) or not isinstance(entry.get("when"), int):
			raise RuntimeError("The Drizzle migration journal contains an invalid entry.")
		tag = entry["tag"]
		when = entry["when"]
		if when in seen_when:
			raise RuntimeError("The Drizzle journal contains duplicate migration timestamps.")
		seen_when.add(when)
		migration_path = ROOT / "drizzle" / f"{tag}.sql"
		if not migration_path.is_file():
			raise RuntimeError(f"The reviewed migration file for {tag} is missing.")
		contents = migration_path.read_bytes()
		if UNSAFE_MIGRATION.search(contents.decode("utf-8", errors="replace")):
			raise RuntimeError(
				f"Migration {tag} contains a destructive SQL statement. db:upgrade only applies reviewed additive migrations."
			)
		result.append(
			{
				"tag": tag,
				"when": when,
				"hash": hashlib.sha256(contents).hexdigest(),
				"path": migration_path,
				"sql": contents.decode("utf-8", errors="replace"),
			}
		)
	return result


def migration_state(migration_url: str, database: str, migrations: list[dict[str, object]]) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
	with connection(migration_url, "MIGRATION_DATABASE_URL") as conn, conn.cursor() as cur:
		cur.execute("SELECT to_regclass('drizzle.__drizzle_migrations')")
		ledger_exists = cur.fetchone()[0] is not None
		if not ledger_exists:
			cur.execute(
				"SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
				"WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f') "
				"AND c.relname <> 'tuxgg_test_safety_marker'"
			)
			if cur.fetchone()[0]:
				raise RuntimeError(
					"This database contains application objects but has no Drizzle migration ledger. Audit its schema before upgrading; db:upgrade will not guess which migrations were applied."
				)
			return [], migrations
		cur.execute("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at")
		applied = cur.fetchall()
	applied_by_time = {int(row[1]): row[0] for row in applied}
	if len(applied_by_time) != len(applied):
		raise RuntimeError("The Drizzle migration ledger contains duplicate timestamps.")
	known = {int(item["when"]): item for item in migrations}
	unknown_times = sorted(set(applied_by_time) - set(known))
	if unknown_times:
		raise RuntimeError(
			"The Drizzle migration ledger contains entries not present in this checkout. Restore the matching reviewed migration files before upgrading."
		)
	applied_entries: list[dict[str, object]] = []
	for when, recorded_hash in applied_by_time.items():
		entry = known[when]
		if recorded_hash != entry["hash"]:
			raise RuntimeError(
				f"Applied migration {entry['tag']} does not match its checked-in SQL hash. Restore the applied file before upgrading."
			)
		applied_entries.append(entry)
	ordered_applied = sorted(applied_entries, key=lambda item: int(item["when"]))
	if ordered_applied != migrations[: len(ordered_applied)]:
		raise RuntimeError("The Drizzle migration ledger is not a sequential prefix of the checked-in journal.")
	pending = migrations[len(ordered_applied) :]
	with connection(migration_url, "MIGRATION_DATABASE_URL") as conn, conn.cursor() as cur:
		for migration in pending:
			for table in ALTER_TABLE_PATTERN.findall(str(migration["sql"])):
				cur.execute("SELECT pg_get_userbyid(c.relowner) FROM pg_class c WHERE c.oid = to_regclass(%s)", (f"public.{table}",))
				owner = cur.fetchone()[0]
				if owner is not None and owner != MIGRATION_ROLE:
					raise RuntimeError(
						f"MIGRATION_DATABASE_URL role does not own existing table public.{table}, which migration {migration['tag']} must alter. Restore the dedicated migration role's existing object ownership before upgrading; db:upgrade will not transfer ownership."
					)
	return ordered_applied, pending


def count_preserved_records(database_admin_url: str) -> dict[str, int]:
	counts: dict[str, int] = {}
	with connection(database_admin_url, "PGADMIN_URL target-database connection") as conn, conn.cursor() as cur:
		for table in PRESERVED_TABLES:
			cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
			if cur.fetchone()[0] is None:
				continue
			cur.execute(f'SELECT count(*) FROM public."{table}"')
			counts[table] = int(cur.fetchone()[0])
	return counts


def inspect_runtime_privileges(runtime_url: str) -> tuple[dict[str, set[str]], list[str]]:
	state: dict[str, set[str]] = {}
	problems: list[str] = []
	with connection(runtime_url, "DATABASE_URL") as conn, conn.cursor() as cur:
		cur.execute("SELECT current_database(), current_user")
		database, role = cur.fetchone()
		if role not in ("tuxgg_web", LEGACY_ROLE):
			raise RuntimeError("The restricted runtime connection uses an unsupported role.")
		cur.execute(
			"SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls "
			"FROM pg_roles WHERE rolname = current_user"
		)
		attrs = cur.fetchone()
		if not attrs or any(attrs):
			raise RuntimeError("DATABASE_URL role has PostgreSQL administrator attributes; restore its restricted runtime configuration.")
		cur.execute(
			"SELECT EXISTS (SELECT 1 FROM pg_auth_members WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user))"
		)
		if cur.fetchone()[0]:
			raise RuntimeError("DATABASE_URL role has role memberships; remove them before applying restricted grants.")
		cur.execute(
			"SELECT EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
			"WHERE n.nspname = 'public' AND c.relname::text = ANY(%s) "
			"AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = current_user)), "
			"has_schema_privilege(current_user, 'public', 'CREATE'), "
			"has_database_privilege(current_user, current_database(), 'CREATE')",
			(list(WEB_PRIVILEGES),),
		)
		owns_objects, can_create_schema, can_create_database = cur.fetchone()
		if owns_objects or can_create_schema or can_create_database:
			raise RuntimeError(
				"DATABASE_URL runtime role owns application tables or has schema/database CREATE privileges; restore the restricted runtime-role ownership and grants before upgrading."
			)
		for table, privilege_list in WEB_PRIVILEGES.items():
			cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
			if cur.fetchone()[0] is None:
				for privilege in privilege_list.replace(",", "").split():
					problems.append(f"public.{table} {privilege}")
				continue
			cur.execute(
				"SELECT " + ", ".join(
					f"has_table_privilege(current_user, 'public.{table}', '{privilege}')"
					for privilege in TABLE_PRIVILEGES
				)
			)
			actual = set()
			for privilege, allowed in zip(TABLE_PRIVILEGES, cur.fetchone()):
				if allowed:
					actual.add(privilege)
			for privilege in {part.strip() for part in privilege_list.split(",")}:
				if privilege not in actual:
					problems.append(f"public.{table} {privilege}")
			for privilege in actual - {part.strip() for part in privilege_list.split(",")}:
				problems.append(f"public.{table} unexpected {privilege}")
			state[table] = actual

		cur.execute(
			"SELECT c.relname::text, acl.privilege_type FROM pg_class c "
			"JOIN pg_namespace n ON n.oid = c.relnamespace "
			"CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl "
			"WHERE n.nspname = 'public' AND c.relname::text = ANY(%s) AND acl.grantee = 0",
			(list(WEB_PRIVILEGES),),
		)
		for table, privilege in cur.fetchall():
			problems.append(f"PUBLIC {privilege} on public.{table} unexpectedly granted")

		cur.execute("SELECT to_regclass('public.native_reports')")
		if cur.fetchone()[0] is not None:
			cur.execute(
				"SELECT attname FROM pg_attribute WHERE attrelid = 'public.native_reports'::regclass "
				"AND attnum > 0 AND NOT attisdropped ORDER BY attnum"
			)
			columns = [row[0] for row in cur.fetchall()]
			cur.execute(
				"SELECT a.attname, acl.privilege_type FROM pg_attribute a "
				"CROSS JOIN LATERAL aclexplode(a.attacl) acl "
				"WHERE a.attrelid = 'public.native_reports'::regclass AND a.attnum > 0 "
				"AND a.attacl IS NOT NULL "
				"AND NOT a.attisdropped AND acl.grantee = 0"
			)
			for column, privilege in cur.fetchall():
				problems.append(
					f"PUBLIC {privilege}({column}) on public.native_reports unexpectedly granted"
				)
			allowed_columns = set(NATIVE_REPORT_INSERT_COLUMNS) & set(columns)
			for column in columns:
				cur.execute(
					"SELECT has_column_privilege(current_user, 'public.native_reports', %s, 'INSERT')",
					(column,),
				)
				can_insert = cur.fetchone()[0]
				if can_insert != (column in allowed_columns):
					problems.append(
						f"public.native_reports INSERT({column}) {'unexpectedly granted' if can_insert else 'missing'}"
					)
				cur.execute(
					"SELECT has_column_privilege(current_user, 'public.native_reports', %s, 'UPDATE')",
					(column,),
				)
				if cur.fetchone()[0]:
					problems.append(f"public.native_reports UPDATE({column}) unexpectedly granted")
			cur.execute(
				"SELECT has_table_privilege(current_user, 'public.native_reports', 'INSERT'), "
				"has_table_privilege(current_user, 'public.native_reports', 'UPDATE'), "
				"has_table_privilege(current_user, 'public.native_reports', 'DELETE')"
			)
			if any(cur.fetchone()):
				problems.append("public.native_reports unexpected table-level write privilege")
		cur.execute("SELECT has_schema_privilege(current_user, 'public', 'USAGE')")
		if not cur.fetchone()[0]:
			problems.append("schema public USAGE")
	return state, problems


def apply_runtime_grants(admin_target_url: str, runtime_role: str) -> None:
	from psycopg import sql

	with connection(admin_target_url, "PGADMIN_URL target-database connection") as conn:
		with conn.transaction():
			with conn.cursor() as cur:
				cur.execute("SELECT current_database(), current_user, rolsuper FROM pg_roles WHERE rolname = current_user")
				identity = cur.fetchone()
				if not identity or not identity[2]:
					raise RuntimeError("The administration connection is not a PostgreSQL superuser.")
				for table in WEB_PRIVILEGES:
					cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
					if cur.fetchone()[0] is None:
						raise RuntimeError(f"Required table public.{table} is missing after migrations.")
					cur.execute(
						sql.SQL("REVOKE ALL PRIVILEGES ON TABLE public.{} FROM {}").format(
							sql.Identifier(table), sql.Identifier(runtime_role)
						)
					)
					cur.execute(
						sql.SQL("REVOKE ALL PRIVILEGES ON TABLE public.{} FROM PUBLIC").format(
							sql.Identifier(table)
						)
					)
					cur.execute(
						sql.SQL("GRANT {} ON TABLE public.{} TO {}").format(
							sql.SQL(WEB_PRIVILEGES[table]), sql.Identifier(table), sql.Identifier(runtime_role)
						)
					)
				cur.execute("SELECT to_regclass('public.native_reports')")
				if cur.fetchone()[0] is not None:
					cur.execute(
						"SELECT attname FROM pg_attribute WHERE attrelid = 'public.native_reports'::regclass "
						"AND attnum > 0 AND NOT attisdropped ORDER BY attnum"
					)
					columns = [row[0] for row in cur.fetchall()]
					if columns:
						all_columns = sql.SQL(", ").join(sql.Identifier(column) for column in columns)
						cur.execute(
							sql.SQL(
								"REVOKE INSERT ({columns}), UPDATE ({columns}), REFERENCES ({columns}) "
								"ON TABLE public.native_reports FROM PUBLIC"
							).format(columns=all_columns)
						)
					grant_native_report_insert_columns(cur, (runtime_role,))
				cur.execute(
					sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(runtime_role))
				)
				cur.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")


def migration_privilege_changes(runtime_role: str, tables: dict[str, set[str]], problems: list[str]) -> list[str]:
	changes = [
		f"Grant {privileges} on public.{table} to {runtime_role}"
		for table, privileges in WEB_PRIVILEGES.items()
		if table not in tables or any(
			part.strip() not in tables[table] for part in privileges.split(",")
		)
	]
	if any(problem.startswith("public.native_reports INSERT(") for problem in problems):
		changes.append(
			f"Grant only the approved native_reports insert columns to {runtime_role}; deny table-level writes and moderation columns"
		)
	if any(problem.startswith("public.native_reports unexpected table-level") for problem in problems):
		changes.append(f"Remove table-level write privileges on public.native_reports from {runtime_role}")
	if any(problem.startswith("schema public") for problem in problems):
		changes.append(f"Grant USAGE on schema public to {runtime_role}")
	if any("unexpected" in problem for problem in problems):
		changes.append(f"Revoke unexpected application-table privileges from {runtime_role} and PUBLIC")
	return changes


def _pg_client_env(url: str, passfile: Path) -> dict[str, str]:
	parts = urlsplit(url)
	query = parse_qs(parts.query)
	env = os.environ.copy()
	env.pop("PGPASSWORD", None)
	env["PGPASSFILE"] = str(passfile)
	env["PGHOST"] = parts.hostname or ""
	env["PGPORT"] = str(parts.port or 5432)
	env["PGUSER"] = unquote(parts.username or "")
	env["PGDATABASE"] = unquote(parts.path.strip("/"))
	for key in ("sslmode", "sslrootcert", "sslcert", "sslkey", "gssencmode", "target_session_attrs", "application_name"):
		if key in query:
			env[{"sslmode": "PGSSLMODE", "sslrootcert": "PGSSLROOTCERT", "sslcert": "PGSSLCERT", "sslkey": "PGSSLKEY", "gssencmode": "PGGSSENCMODE", "target_session_attrs": "PGTARGETSESSIONATTRS", "application_name": "PGAPPNAME"}[key]] = query[key][-1]
	return env


def _pgpass_escape(value: str) -> str:
	return value.replace("\\", "\\\\").replace(":", "\\:")


def _pg_tool(name: str, configured: str | None = None) -> str:
	candidate = configured or shutil.which(name)
	if not candidate:
		raise RuntimeError(
			f"{name} was not found. Install PostgreSQL client utilities and put {name} on PATH, or set TUXGG_{name.upper().replace('-', '_')} to its full path."
		)
	return candidate


def create_verified_backup(admin_target_url: str, database: str) -> Path:
	backup_dir = Path(os.environ.get("TUXGG_BACKUP_DIR") or (Path.home() / ".tuxgg-backups"))
	backup_dir.mkdir(parents=True, exist_ok=True)
	stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ") + f"-{os.getpid()}"
	backup_path = backup_dir / f"{database}-{stamp}.dump"
	partial_path = backup_path.with_suffix(".dump.partial")
	dump_executable = _pg_tool("pg_dump", os.environ.get("TUXGG_PG_DUMP"))
	restore_executable = _pg_tool("pg_restore", os.environ.get("TUXGG_PG_RESTORE"))
	parts = urlsplit(admin_target_url)
	password = unquote(parts.password or "")
	with tempfile.TemporaryDirectory(prefix="tuxgg-upgrade-") as temp_dir:
		passfile = Path(temp_dir) / ("pgpass.conf" if os.name == "nt" else ".pgpass")
		passfile.write_text(
			f"{_pgpass_escape(parts.hostname or '*')}:{parts.port or 5432}:{_pgpass_escape(database)}:{_pgpass_escape(unquote(parts.username or '*'))}:{_pgpass_escape(password)}\n",
			encoding="utf-8",
		)
		if os.name != "nt":
			passfile.chmod(0o600)
		env = _pg_client_env(admin_target_url, passfile)
		commands = [
			[ dump_executable, "--format=custom", "--no-owner", "--no-acl", "--no-password", "--file", str(partial_path) ],
			[ restore_executable, "--list", "--no-password", str(partial_path) ],
			[ restore_executable, "--file", os.devnull, "--no-password", str(partial_path) ],
		]
		for index, command in enumerate(commands):
			try:
				result = subprocess.run(command, env=env, capture_output=True, text=True, check=False)
			except OSError as exc:
				partial_path.unlink(missing_ok=True)
				raise RuntimeError("PostgreSQL backup utilities could not be started.") from exc
			if result.returncode != 0:
				partial_path.unlink(missing_ok=True)
				step = ("pg_dump", "pg_restore archive listing", "pg_restore archive extraction")[index]
				raise RuntimeError(
					f"{step} failed with exit code {result.returncode}; no database changes were applied. Check the admin connection and PostgreSQL client compatibility."
				)
	partial_path.replace(backup_path)
	return backup_path


def run_migrations(migration_url: str) -> None:
	pnpm = shutil.which("pnpm")
	if not pnpm:
		raise RuntimeError("pnpm was not found on PATH; install the project package manager before upgrading.")
	env = os.environ.copy()
	env["MIGRATION_DATABASE_URL"] = migration_url
	if os.name == "nt":
		command = f'"{pnpm}" db:migrate'
		result = subprocess.run(command, cwd=ROOT, env=env, shell=True, capture_output=True, text=True, check=False)
	else:
		result = subprocess.run([pnpm, "db:migrate"], cwd=ROOT, env=env, capture_output=True, text=True, check=False)
	if result.returncode != 0:
		output = (result.stdout + "\n" + result.stderr).strip()
		output = URL_RE.sub("<redacted PostgreSQL connection>", output)
		for value in (migration_url,):
			output = output.replace(value, "<redacted PostgreSQL connection>")
		tail = "\n".join(output.splitlines()[-12:])
		raise RuntimeError(
			f"Drizzle migration failed with exit code {result.returncode}. No grants were applied. Review the sanitized migration output below and correct the migration-role permissions before retrying:\n{tail or '(no diagnostic output)'}"
		)


def run(args: argparse.Namespace) -> None:
	file_values = read_env_file()
	database_url = env_value("DATABASE_URL", file_values)
	migration_url = env_value("MIGRATION_DATABASE_URL", file_values)
	admin_url = env_value("PGADMIN_URL", file_values)
	identity = identities(database_url, migration_url, admin_url, args.allow_test_database)
	database = identity["database"]
	runtime_role = identity["runtime_role"]
	admin_target_url = url_for_database(admin_url, database)
	migrations = read_migrations()
	applied, pending = migration_state(migration_url, database, migrations)
	current_grants, privilege_problems = inspect_runtime_privileges(database_url)
	grant_changes = migration_privilege_changes(runtime_role, current_grants, privilege_problems)

	if args.dry_run:
		print(f"Database identity verified: database={database}, runtime_role={runtime_role}, migration_role={MIGRATION_ROLE}.")
		print("Applied migrations:")
		for migration in applied:
			print(f"  - {migration['tag']}")
		print("Pending migrations:")
		if pending:
			for migration in pending:
				print(f"  - {migration['tag']}: {migration['sql'].strip()}")
		else:
			print("  - none")
		print("Privilege changes:")
		if grant_changes:
			for change in grant_changes:
				print(f"  - {change}")
		else:
			print("  - none; the configured runtime role already matches the reviewed grant map")
		print("Dry run complete. No backup, migration, or permission change was made.")
		return

	if not pending and not privilege_problems:
		verify_runtime_permissions(database_url, database)
		print(f"Database {database} is current; migration history and runtime permissions are verified.")
		return

	before_counts = count_preserved_records(admin_target_url) if pending else None
	backup_path = create_verified_backup(admin_target_url, database)
	print(f"Verified PostgreSQL backup created: {backup_path}")
	if pending:
		print("Applying reviewed migrations: " + ", ".join(str(item["tag"]) for item in pending))
		run_migrations(migration_url)

	if pending:
		with connection(migration_url, "MIGRATION_DATABASE_URL") as conn, conn.cursor() as cur:
			cur.execute("SELECT current_database(), current_user")
			if cur.fetchone() != (database, MIGRATION_ROLE):
				raise RuntimeError("The migration connection changed identity during upgrade.")
			cur.execute("SELECT to_regclass('public.user_devices')")
			if cur.fetchone()[0] is None:
				raise RuntimeError("The migration command exited successfully but public.user_devices is still missing.")

	_, post_migration_problems = inspect_runtime_privileges(database_url)
	if post_migration_problems:
		apply_runtime_grants(admin_target_url, runtime_role)
	verify_runtime_permissions(database_url, database)
	if before_counts is not None:
		after_counts = count_preserved_records(admin_target_url)
		changes = {
			table: (before_counts[table], after_counts.get(table))
			for table in before_counts
			if before_counts[table] != after_counts.get(table)
		}
		if changes:
			details = ", ".join(f"{table} {old}->{new}" for table, (old, new) in sorted(changes.items()))
			raise RuntimeError(
				"Post-upgrade preservation check found changed row counts in protected tables: "
				+ details
				+ f". Stop application traffic and review the verified backup at {backup_path}."
			)
	message = (
		f"Database upgrade succeeded for {database}. Applied {len(pending)} pending migration(s), repaired and verified least-privilege grants for {runtime_role}."
	)
	if before_counts is not None:
		message += " Existing application-table row counts were preserved."
	print(message)


def verify_runtime_permissions(runtime_url: str, database: str) -> None:
	_, problems = inspect_runtime_privileges(runtime_url)
	if problems:
		permissions = "; ".join(sorted(set(problems)))
		raise RuntimeError(f"Runtime role permission verification failed. Missing or excessive privileges: {permissions}.")


def main() -> int:
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--dry-run", action="store_true", help="verify identity and report pending migrations/grants without changing the database")
	parser.add_argument(
		"--allow-test-database",
		action="store_true",
		help="test-only: permit a database marked by scripts/prepare_test_database.py or the upgrade integration fixture",
	)
	args = parser.parse_args()
	try:
		run(args)
		return 0
	except RuntimeError as exc:
		print(f"Database upgrade failed: {exc}", file=sys.stderr)
		return 1
	except Exception as exc:
		# Database driver exceptions frequently include connection details; never echo them.
		print(f"Database upgrade failed while verifying or applying the operation ({type(exc).__name__}). Credentials and URLs were not printed.", file=sys.stderr)
		return 1


if __name__ == "__main__":
	raise SystemExit(main())

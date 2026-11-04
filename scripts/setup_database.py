#!/usr/bin/env python3
"""Create only the TuxGG database/runtime role and grant the app minimum access."""

from __future__ import annotations

import argparse
import os
import secrets
import sys
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"
DATABASE = "tuxgg"
ROLE = "tuxgg_app"


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


def write_env_file(values: dict[str, str]) -> None:
	lines: list[str] = []
	seen: set[str] = set()
	if ENV_FILE.exists():
		for line in ENV_FILE.read_text(encoding="utf-8").splitlines():
			key = line.split("=", 1)[0].strip() if "=" in line and not line.lstrip().startswith("#") else ""
			if key in values:
				lines.append(f"{key}={values[key]}")
				seen.add(key)
			else:
				lines.append(line)
	for key, value in values.items():
		if key not in seen:
			lines.append(f"{key}={value}")
	ENV_FILE.write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def url_for_database(source: str, database: str, username: str | None = None, password: str | None = None) -> str:
	parts = urlsplit(source)
	if not parts.scheme.startswith("postgres") or not parts.hostname:
		raise ValueError("Database URLs must be PostgreSQL URLs with a host.")
	userinfo = ""
	if username is not None:
		userinfo = quote(username, safe="")
		if password is not None:
			userinfo += ":" + quote(password, safe="")
		userinfo += "@"
	elif parts.username is not None:
		userinfo = quote(parts.username, safe="")
		if parts.password is not None:
			userinfo += ":" + quote(parts.password, safe="")
		userinfo += "@"
	host = f"[{parts.hostname}]" if ":" in parts.hostname else parts.hostname
	if parts.port:
		host += f":{parts.port}"
	return urlunsplit((parts.scheme, userinfo + host, f"/{database}", parts.query, ""))


def connect_admin(url: str):
	try:
		import psycopg
	except ImportError as exc:
		raise RuntimeError("Install importer dependencies first: python -m pip install -r importer/requirements.txt") from exc
	return psycopg.connect(url, autocommit=True)


def grant_runtime_access(admin_url: str) -> None:
	from psycopg import sql

	with connect_admin(admin_url) as conn:
		with conn.cursor() as cur:
			cur.execute(
				"SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls "
				"FROM pg_roles WHERE rolname = %s",
				(ROLE,),
			)
			attributes = cur.fetchone()
			if attributes is None:
				raise RuntimeError("The tuxgg_app runtime role does not exist.")
			if any(attributes):
				raise RuntimeError("The tuxgg_app role has PostgreSQL administrator attributes; remove them before granting runtime access.")
			cur.execute(
				"SELECT EXISTS (SELECT 1 FROM pg_auth_members "
				"WHERE member = (SELECT oid FROM pg_roles WHERE rolname = %s))",
				(ROLE,),
			)
			if cur.fetchone()[0]:
				raise RuntimeError("The tuxgg_app role has role memberships; remove them before granting runtime access.")
			cur.execute(
				"SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = %s "
				"AND datdba = (SELECT oid FROM pg_roles WHERE rolname = %s)) "
				"OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname NOT LIKE 'pg_%%' "
				"AND nspname <> 'information_schema' "
				"AND nspowner = (SELECT oid FROM pg_roles WHERE rolname = %s)) "
				"OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
				"WHERE n.nspname NOT LIKE 'pg_%%' AND n.nspname <> 'information_schema' "
				"AND c.relkind IN ('r', 'p', 'v', 'm', 'S') "
				"AND c.relowner = (SELECT oid FROM pg_roles WHERE rolname = %s))",
				(DATABASE, ROLE, ROLE, ROLE),
			)
			if cur.fetchone()[0]:
				raise RuntimeError("The tuxgg_app role owns database objects; transfer ownership to the migration role before granting runtime access.")

	with connect_admin(admin_url) as conn:
		with conn.cursor() as cur:
			cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE,))
			if cur.fetchone() is None:
				raise RuntimeError("The tuxgg database does not exist; run setup without --grant-only first.")
	with connect_admin(url_for_database(admin_url, DATABASE)) as conn:
		with conn.cursor() as cur:
			cur.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {};").format(sql.Identifier(DATABASE), sql.Identifier(ROLE)))
			cur.execute(sql.SQL("REVOKE CREATE ON DATABASE {} FROM PUBLIC;").format(sql.Identifier(DATABASE)))
			cur.execute(sql.SQL("REVOKE CREATE ON DATABASE {} FROM {};").format(sql.Identifier(DATABASE), sql.Identifier(ROLE)))
			cur.execute(
				"SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%%' "
				"AND nspname <> 'information_schema'"
			)
			for (schema_name,) in cur.fetchall():
				cur.execute(sql.SQL("REVOKE CREATE ON SCHEMA {} FROM PUBLIC").format(sql.Identifier(schema_name)))
				cur.execute(sql.SQL("REVOKE CREATE ON SCHEMA {} FROM {}").format(sql.Identifier(schema_name), sql.Identifier(ROLE)))
			cur.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {};").format(sql.Identifier(ROLE)))
			privileges = {
				"games": "SELECT, INSERT, UPDATE",
				"reports": "SELECT, INSERT",
				"import_batches": "SELECT, INSERT, UPDATE",
				"compatibility_summaries": "SELECT, INSERT, UPDATE",
				"user": "SELECT, INSERT, UPDATE, DELETE",
				"session": "SELECT, INSERT, UPDATE, DELETE",
				"account": "SELECT, INSERT, UPDATE, DELETE",
				"verification": "SELECT, INSERT, UPDATE, DELETE",
				"native_reports": "SELECT",
			}
			for table, grants in privileges.items():
				cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
				if cur.fetchone()[0] is not None:
					cur.execute(sql.SQL("GRANT " + grants + " ON TABLE {}.{} TO {}; ").format(sql.Identifier("public"), sql.Identifier(table), sql.Identifier(ROLE)))
			for sequence in ("reports_id_seq", "import_batches_id_seq"):
				cur.execute("SELECT to_regclass(%s)", (f"public.{sequence}",))
				if cur.fetchone()[0] is not None:
					cur.execute(sql.SQL("GRANT USAGE, SELECT ON SEQUENCE {}.{} TO {}; ").format(sql.Identifier("public"), sql.Identifier(sequence), sql.Identifier(ROLE)))


def run(grant_only: bool) -> None:
	from psycopg import sql

	file_values = read_env_file()
	admin_url = os.environ.get("PGADMIN_URL") or file_values.get("PGADMIN_URL")
	if not admin_url:
		raise RuntimeError("Set PGADMIN_URL to a PostgreSQL administrator connection in .env.")
	if grant_only:
		grant_runtime_access(admin_url)
		print("Runtime database grants refreshed for the TuxGG tables.")
		return

	values: dict[str, str] = {}
	values["PGADMIN_URL"] = admin_url
	app_url = os.environ.get("DATABASE_URL") or file_values.get("DATABASE_URL", "")
	with connect_admin(admin_url) as conn:
		with conn.cursor() as cur:
			cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (ROLE,))
			role_exists = cur.fetchone() is not None
			cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (DATABASE,))
			database_exists = cur.fetchone() is not None
			if not role_exists:
				password = secrets.token_urlsafe(36)
				cur.execute(sql.SQL("CREATE ROLE {} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD {};").format(sql.Identifier(ROLE), sql.Literal(password)))
				app_url = url_for_database(admin_url, DATABASE, ROLE, password)
				values["DATABASE_URL"] = app_url
				values["DATABASE_URL_DOCKER"] = url_for_database(admin_url, DATABASE, ROLE, password).replace("@localhost", "@host.docker.internal")
			elif not app_url:
				raise RuntimeError("The tuxgg_app role already exists, but .env has no DATABASE_URL to verify its password. No role or database changes were made.")
			if not database_exists:
				cur.execute(sql.SQL("CREATE DATABASE {};").format(sql.Identifier(DATABASE)))
			elif not role_exists:
				# The project database exists, but creating a new role does not alter its objects.
				pass
			cur.execute(sql.SQL("GRANT CONNECT ON DATABASE {} TO {};").format(sql.Identifier(DATABASE), sql.Identifier(ROLE)))
			cur.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
			cur.execute(sql.SQL("REVOKE CREATE ON SCHEMA public FROM {}; ").format(sql.Identifier(ROLE)))
		if role_exists:
			# Verify the existing runtime URL before treating the setup as repeatable.
			from psycopg import connect
			try:
				with connect(url_for_database(app_url, DATABASE)) as app_conn:
					with app_conn.cursor() as app_cur:
						app_cur.execute("SELECT 1")
			except Exception as exc:
				raise RuntimeError("The existing runtime database URL could not be verified; no password was changed.") from exc

		if not app_url:
			app_url = file_values.get("DATABASE_URL", "")
		if app_url:
			values["MIGRATION_DATABASE_URL"] = url_for_database(admin_url, DATABASE)
			if "DATABASE_URL_DOCKER" not in values:
				parts = urlsplit(app_url)
				host = f"[{parts.hostname}]" if parts.hostname and ":" in parts.hostname else (parts.hostname or "")
				if parts.port:
					host += f":{parts.port}"
				userinfo = ""
				if parts.username is not None:
					userinfo = quote(parts.username, safe="")
					if parts.password is not None:
						userinfo += ":" + quote(parts.password, safe="")
					userinfo += "@"
				if parts.hostname in ("localhost", "127.0.0.1", "::1"):
					host = f"host.docker.internal:{parts.port}" if parts.port else "host.docker.internal"
				values["DATABASE_URL_DOCKER"] = urlunsplit((parts.scheme, userinfo + host, f"/{DATABASE}", parts.query, ""))
		write_env_file(values)
	grant_runtime_access(admin_url)
	print("TuxGG database and least-privilege runtime role are ready. Credentials were written to the ignored .env file and were not displayed.")


def main() -> int:
	parser = argparse.ArgumentParser(description=__doc__)
	parser.add_argument("--grant-only", action="store_true", help="refresh table grants after migrations")
	args = parser.parse_args()
	try:
		run(args.grant_only)
		return 0
	except Exception:
		print("Database setup failed. Check the PostgreSQL connection, runtime role, and database state; credentials and connection details are not printed.", file=sys.stderr)
		return 1


if __name__ == "__main__":
	raise SystemExit(main())

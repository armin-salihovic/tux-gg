"""Unit and disposable-PostgreSQL checks for db:upgrade."""

from __future__ import annotations

import os
import secrets
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

import pytest

from scripts import upgrade_database

ROOT = Path(__file__).resolve().parents[1]
MARKER = "tuxgg_disposable_test_database_v1"
INTEGRATION_ENABLED = os.environ.get("TUXGG_DB_UPGRADE_INTEGRATION") == "1"


def with_database(url: str, database: str) -> str:
	parts = urlsplit(url)
	return urlunsplit(parts._replace(path=f"/{database}"))


def test_normal_upgrade_refuses_unintended_database_names_before_connecting() -> None:
	for database in ("postgres", "tuxgg_test", "other_app"):
		with pytest.raises(RuntimeError, match="Refusing to upgrade"):
			upgrade_database.identities(
				f"postgresql://tuxgg_web:placeholder@localhost:5432/{database}",
				f"postgresql://tuxgg_migrator:placeholder@localhost:5432/{database}",
				"postgresql://postgres:placeholder@localhost:5432/postgres",
				test_mode=False,
			)


def test_pending_migrations_are_sequential_and_additive() -> None:
	migrations = upgrade_database.read_migrations()
	assert [entry["tag"] for entry in migrations] == [
		"0000_tuxgg_initial",
		"0001_import_recovery",
		"0002_native_report_platform",
		"0003_user_devices",
		"0004_user_device_source_verification",
	]
	assert "source_verified_at" in str(migrations[-1]["sql"])
	assert upgrade_database.UNSAFE_MIGRATION.search("DROP TABLE public.reports")
	assert upgrade_database.UNSAFE_MIGRATION.search("TRUNCATE public.reports")


def _seed_existing_records(migration_url: str) -> str:
	import psycopg

	user_id = "upgrade-preservation-user"
	app_id = "940000001"
	with psycopg.connect(migration_url, autocommit=True) as conn, conn.cursor() as cur:
		cur.execute("INSERT INTO public.games (app_id, title, slug) VALUES (%s, %s, %s)", [app_id, "Upgrade Fixture Game", "upgrade-fixture-game"])
		cur.execute(
			"INSERT INTO public.import_batches (source_filename, source_checksum, source_schema, status) "
			"VALUES (%s, %s, %s, 'complete') RETURNING id",
			["upgrade-fixture.tar.gz", "a" * 64, "upgrade-test"],
		)
		batch_id = cur.fetchone()[0]
		cur.execute(
			"INSERT INTO public.reports (app_id, source_fingerprint, imported_batch_id, source_verdict) "
			"VALUES (%s, %s, %s, 'yes')",
			[app_id, "b" * 64, batch_id],
		)
		cur.execute("INSERT INTO public.compatibility_summaries (app_id, report_count) VALUES (%s, 1)", [app_id])
		cur.execute(
			'INSERT INTO public."user" (id, name, email, username) VALUES (%s, %s, %s, %s)',
			[user_id, "Upgrade Fixture User", "upgrade-fixture@steam.invalid", "upgrade_fixture"],
		)
		cur.execute(
			'INSERT INTO public.account (id, account_id, provider_id, user_id) VALUES (%s, %s, %s, %s)',
			["upgrade-fixture-account", "76561198000000001", "steam", user_id],
		)
		cur.execute(
			"INSERT INTO public.session (id, token, user_id, expires_at) VALUES (%s, %s, %s, now() + interval '1 day')",
			["upgrade-fixture-session", "upgrade-fixture-token", user_id],
		)
		cur.execute(
			"INSERT INTO public.verification (id, identifier, value, expires_at) VALUES (%s, %s, %s, now() + interval '1 day')",
			["upgrade-fixture-verification", "upgrade-fixture", "value"],
		)
		cur.execute(
			"INSERT INTO public.native_reports (id, app_id, author_id, verdict, platform, content) "
			"VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', %s, %s, 'yes', 'linux_desktop', 'Existing report snapshot')",
			[app_id, user_id],
		)
		cur.execute(
			"INSERT INTO public.user_devices (id, user_id, name, device_type, cpu, gpu, is_default) "
			"VALUES ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', %s, 'Old manual device', 'linux_desktop', 'Old CPU', 'Old GPU', true)",
			[user_id],
		)
	return user_id


def _run_upgrade(env: dict[str, str], *, dry_run: bool = False) -> subprocess.CompletedProcess[str]:
	command = [sys.executable, str(ROOT / "scripts" / "upgrade_database.py"), "--allow-test-database"]
	if dry_run:
		command.append("--dry-run")
	return subprocess.run(command, cwd=ROOT, env=env, text=True, capture_output=True, check=False)


@pytest.mark.skipif(not INTEGRATION_ENABLED, reason="requires the explicitly enabled marked PostgreSQL upgrade test")
def test_upgrade_existing_database_missing_migration_repairs_grants_and_is_idempotent(tmp_path: Path) -> None:
	import psycopg
	from psycopg import sql

	base_runtime_url = os.environ.get("DATABASE_URL", "")
	base_migration_url = os.environ.get("MIGRATION_DATABASE_URL", "")
	admin_url = os.environ.get("PGADMIN_URL", "")
	assert base_runtime_url and base_migration_url and admin_url
	assert urlsplit(base_runtime_url).path == "/tuxgg_test"
	assert urlsplit(base_migration_url).path == "/tuxgg_test"
	assert urlsplit(admin_url).path.rstrip("/") == "/postgres"

	database = "tuxgg_upgrade_test_" + secrets.token_hex(6)
	runtime_url = with_database(base_runtime_url, database)
	migration_url = with_database(base_migration_url, database)
	admin_target_url = with_database(admin_url, database)
	backup_dir = tmp_path / "backups"

	try:
		with psycopg.connect(with_database(admin_url, "tuxgg_test"), autocommit=True) as source, source.cursor() as cur:
			cur.execute("SELECT marker FROM public.tuxgg_test_safety_marker WHERE id = 1")
			assert cur.fetchone()[0] == MARKER
		with psycopg.connect(admin_url, autocommit=True) as admin, admin.cursor() as cur:
			cur.execute(
				sql.SQL("CREATE DATABASE {} WITH TEMPLATE {} OWNER tuxgg_migrator").format(
					sql.Identifier(database), sql.Identifier("tuxgg_test")
				)
			)

		# Remove only the newest additive migration from the marked disposable clone to
		# model a prior TuxGG version. The production database is never modified here.
		with psycopg.connect(migration_url, autocommit=True) as conn, conn.cursor() as cur:
			cur.execute("SELECT marker FROM public.tuxgg_test_safety_marker WHERE id = 1")
			assert cur.fetchone()[0] == MARKER
			cur.execute("ALTER TABLE public.user_devices DROP COLUMN source_verified_at")
			latest = next(item for item in upgrade_database.read_migrations() if item["tag"] == "0004_user_device_source_verification")
			cur.execute("DELETE FROM drizzle.__drizzle_migrations WHERE created_at = %s", [latest["when"]])

		user_id = _seed_existing_records(migration_url)
		before_counts = upgrade_database.count_preserved_records(admin_target_url)
		with psycopg.connect(admin_target_url, autocommit=True) as conn, conn.cursor() as cur:
			cur.execute("SELECT 'public.user_devices'::regclass::oid")
			device_table_oid = cur.fetchone()[0]

		env = os.environ.copy()
		env.update(
			{
				"DATABASE_URL": runtime_url,
				"MIGRATION_DATABASE_URL": migration_url,
				"PGADMIN_URL": admin_url,
				"TUXGG_BACKUP_DIR": str(backup_dir),
			}
		)
		first = _run_upgrade(env)
		assert first.returncode == 0, first.stdout + first.stderr
		assert "Applied 1 pending migration" in first.stdout
		assert len(list(backup_dir.glob("*.dump"))) == 1
		assert upgrade_database.count_preserved_records(admin_target_url) == before_counts
		with psycopg.connect(admin_target_url, autocommit=True) as conn, conn.cursor() as cur:
			cur.execute("SELECT 'public.user_devices'::regclass::oid")
			assert cur.fetchone()[0] == device_table_oid
			cur.execute("SELECT source_verified_at, cpu, gpu FROM public.user_devices WHERE id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'")
			assert cur.fetchone() == (None, "Old CPU", "Old GPU")
			cur.execute("SELECT moderation_state, content FROM public.native_reports WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")
			assert cur.fetchone() == ("pending", "Existing report snapshot")
			cur.execute("SELECT count(*) FROM drizzle.__drizzle_migrations WHERE created_at = %s", [latest["when"]])
			assert cur.fetchone()[0] == 1

		# Migration already recorded, but runtime SELECT is missing: grants repair must
		# happen independently of Drizzle and must not recreate the device table.
		with psycopg.connect(admin_target_url, autocommit=True) as conn, conn.cursor() as cur:
			cur.execute("REVOKE SELECT ON TABLE public.user_devices FROM tuxgg_web")
			cur.execute("SELECT 'public.user_devices'::regclass::oid")
			device_table_oid = cur.fetchone()[0]
		second = _run_upgrade(env)
		assert second.returncode == 0, second.stdout + second.stderr
		assert "Applied 0 pending migration" in second.stdout
		assert len(list(backup_dir.glob("*.dump"))) == 2
		with psycopg.connect(admin_target_url, autocommit=True) as conn, conn.cursor() as cur:
			cur.execute("SELECT 'public.user_devices'::regclass::oid")
			assert cur.fetchone()[0] == device_table_oid
			cur.execute("SELECT has_table_privilege('tuxgg_web', 'public.user_devices', 'SELECT')")
			assert cur.fetchone()[0] is True

		# A current database succeeds again without another backup or ACL churn.
		third = _run_upgrade(env)
		assert third.returncode == 0, third.stdout + third.stderr
		assert "is current" in third.stdout
		assert len(list(backup_dir.glob("*.dump"))) == 2

		# Normal mode refuses both the maintenance DB and the standard test DB.
		wrong_env = env.copy()
		wrong_env["DATABASE_URL"] = with_database(base_runtime_url, "tuxgg_test")
		wrong_env["MIGRATION_DATABASE_URL"] = with_database(base_migration_url, "tuxgg_test")
		wrong = subprocess.run(
			[sys.executable, str(ROOT / "scripts" / "upgrade_database.py"), "--dry-run"],
			cwd=ROOT,
			env=wrong_env,
			text=True,
			capture_output=True,
			check=False,
		)
		assert wrong.returncode == 1
		assert "Refusing to upgrade" in wrong.stderr

		# The actual web credentials can manage devices, but remain unable to write
		# imported reports/summaries or publish a native report.
		with psycopg.connect(runtime_url, autocommit=True) as web, web.cursor() as cur:
			cur.execute(
				"INSERT INTO public.user_devices (user_id, name, device_type, cpu, gpu) "
				"VALUES (%s, 'Privilege test device', 'linux_desktop', 'Test CPU', 'Test GPU') RETURNING id",
				[user_id],
			)
			device_id = cur.fetchone()[0]
			cur.execute("UPDATE public.user_devices SET name = 'Updated test device' WHERE id = %s", [device_id])
			cur.execute("DELETE FROM public.user_devices WHERE id = %s", [device_id])
			with pytest.raises(psycopg.errors.InsufficientPrivilege):
				cur.execute(
					"INSERT INTO public.reports (app_id, source_fingerprint, imported_batch_id) VALUES ('940000001', %s, 1)",
					["c" * 64],
				)
			with pytest.raises(psycopg.errors.InsufficientPrivilege):
				cur.execute("UPDATE public.compatibility_summaries SET report_count = 2 WHERE app_id = '940000001'")
			with pytest.raises(psycopg.errors.InsufficientPrivilege):
				cur.execute("UPDATE public.native_reports SET moderation_state = 'published' WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")
			with pytest.raises(psycopg.errors.InsufficientPrivilege):
				cur.execute("UPDATE public.native_reports SET published_at = now() WHERE id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'")
	finally:
		with psycopg.connect(admin_url, autocommit=True) as admin, admin.cursor() as cur:
			cur.execute(
				"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = %s AND pid <> pg_backend_pid()",
				[database],
			)
			cur.execute(sql.SQL("DROP DATABASE IF EXISTS {}").format(sql.Identifier(database)))

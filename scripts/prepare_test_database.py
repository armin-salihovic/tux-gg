#!/usr/bin/env python3
"""Mark a database named tuxgg_test before migrations and destructive test cleanup."""

from __future__ import annotations

import os
import sys
from urllib.parse import urlsplit

from setup_database import read_env_file

EXPECTED_DATABASE = "tuxgg_test"
MARKER_TABLE = "tuxgg_test_safety_marker"
MARKER_VALUE = "tuxgg_disposable_test_database_v1"


def main() -> int:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        print("Set TEST_DATABASE_URL to a disposable PostgreSQL database named tuxgg_test.", file=sys.stderr)
        return 1
    try:
        import psycopg
        from psycopg import sql

        if urlsplit(url).path.rstrip("/").split("/")[-1] != EXPECTED_DATABASE:
            raise RuntimeError("TEST_DATABASE_URL must point to the dedicated tuxgg_test database.")
        admin_url = os.environ.get("PGADMIN_URL") or read_env_file().get("PGADMIN_URL")
        if not admin_url:
            raise RuntimeError("Set PGADMIN_URL to create or verify the dedicated test database.")
        created_database = False
        with psycopg.connect(admin_url, autocommit=True) as admin, admin.cursor() as admin_cur:
            admin_cur.execute("SELECT current_database()")
            if admin_cur.fetchone()[0] != "postgres":
                raise RuntimeError("PGADMIN_URL must connect to the postgres maintenance database.")
            admin_cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (EXPECTED_DATABASE,))
            if admin_cur.fetchone() is None:
                admin_cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(EXPECTED_DATABASE)))
                created_database = True

        with psycopg.connect(url) as conn, conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            if cur.fetchone()[0] != EXPECTED_DATABASE:
                raise RuntimeError("Refusing to mark any database except tuxgg_test as disposable.")
            cur.execute("SELECT to_regclass(%s)", (f"public.{MARKER_TABLE}",))
            marker_table_exists = cur.fetchone()[0] is not None
            if marker_table_exists:
                cur.execute(f"SELECT marker FROM public.{MARKER_TABLE} WHERE id = 1")
                marker = cur.fetchone()
                if marker is None or marker[0] != MARKER_VALUE:
                    raise RuntimeError("The existing test-database marker is invalid.")
            else:
                cur.execute(
                    "SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
                    "WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' "
                    "AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')"
                )
                if cur.fetchone()[0] and not created_database:
                    raise RuntimeError("Refusing to mark an existing database that already contains application objects.")
                cur.execute(
                    "SELECT count(*) FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' "
                    "AND nspname NOT IN ('information_schema', 'public')"
                )
                if cur.fetchone()[0]:
                    raise RuntimeError("Refusing to mark a database with pre-existing application schemas.")
            cur.execute(
                f'CREATE TABLE IF NOT EXISTS public.{MARKER_TABLE} '
                "(id integer PRIMARY KEY CHECK (id = 1), marker text NOT NULL)"
            )
            cur.execute(
                f"INSERT INTO public.{MARKER_TABLE} (id, marker) VALUES (1, %s) "
                "ON CONFLICT (id) DO NOTHING",
                (MARKER_VALUE,),
            )
        print("Verified and marked the dedicated tuxgg_test database.")
        return 0
    except Exception as exc:
        print(f"Test database preparation failed: {type(exc).__name__}.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

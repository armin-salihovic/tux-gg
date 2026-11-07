#!/usr/bin/env python3
"""Mark a database named tuxgg_test before migrations and destructive test cleanup."""

from __future__ import annotations

import os
import sys
from urllib.parse import urlsplit

from setup_database import (
    IMPORTER_PRIVILEGES,
    IMPORTER_ROLE,
    MIGRATION_ROLE,
    SEQUENCES,
    WEB_PRIVILEGES,
    WEB_ROLE,
    _validate_role,
    grant_native_report_insert_columns,
    read_env_file,
)

EXPECTED_DATABASE = "tuxgg_test"
MARKER_TABLE = "tuxgg_test_safety_marker"
MARKER_VALUE = "tuxgg_disposable_test_database_v1"
ROLES = (WEB_ROLE, IMPORTER_ROLE, MIGRATION_ROLE)


def configure_runtime_roles(admin_url: str, test_url: str) -> None:
    """Apply the production runtime grant map to the marked disposable database only."""
    from psycopg import sql

    with psycopg_connect(admin_url) as conn, conn.cursor() as cur:
        cur.execute("SELECT current_database()")
        if cur.fetchone()[0] != "postgres":
            raise RuntimeError("PGADMIN_URL must connect to the postgres maintenance database.")
        for role in ROLES:
            cur.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", (role,))
            if cur.fetchone() is None:
                raise RuntimeError("The web, importer, and migration roles must exist before test setup.")
            _validate_role(cur, role)
        for role in ROLES:
            cur.execute(
                sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
                    sql.Identifier(EXPECTED_DATABASE), sql.Identifier(role)
                )
            )
        cur.execute(
            sql.SQL("REVOKE CREATE ON DATABASE {} FROM PUBLIC").format(
                sql.Identifier(EXPECTED_DATABASE)
            )
        )
        cur.execute(
            sql.SQL("GRANT CREATE ON DATABASE {} TO {}").format(
                sql.Identifier(EXPECTED_DATABASE), sql.Identifier(MIGRATION_ROLE)
            )
        )
        for role in (WEB_ROLE, IMPORTER_ROLE):
            cur.execute(
                sql.SQL("REVOKE CREATE ON DATABASE {} FROM {}").format(
                    sql.Identifier(EXPECTED_DATABASE), sql.Identifier(role)
                )
            )

    with psycopg_connect(test_url) as conn, conn.cursor() as cur:
        cur.execute("SELECT current_database()")
        if cur.fetchone()[0] != EXPECTED_DATABASE:
            raise RuntimeError("Refusing role changes outside the dedicated tuxgg_test database.")
        cur.execute(
            f"SELECT marker FROM public.{MARKER_TABLE} WHERE id = 1"
        )
        marker = cur.fetchone()
        if marker is None or marker[0] != MARKER_VALUE:
            raise RuntimeError("Refusing role changes without the disposable database marker.")
        cur.execute("REVOKE CREATE ON SCHEMA public FROM PUBLIC")
        cur.execute(sql.SQL("ALTER SCHEMA public OWNER TO {}").format(sql.Identifier(MIGRATION_ROLE)))
        for role in ROLES:
            cur.execute(
                sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(sql.Identifier(role))
            )
            if role != MIGRATION_ROLE:
                cur.execute(
                    sql.SQL("REVOKE CREATE ON SCHEMA public FROM {}").format(sql.Identifier(role))
                )
        cur.execute(
            sql.SQL("GRANT CREATE ON SCHEMA public TO {}").format(sql.Identifier(MIGRATION_ROLE))
        )
        cur.execute(
            sql.SQL("GRANT SELECT ON TABLE public.{} TO {}, {}").format(
                sql.Identifier(MARKER_TABLE),
                sql.Identifier(WEB_ROLE),
                sql.Identifier(MIGRATION_ROLE),
            )
        )
        cur.execute(
            sql.SQL("REVOKE ALL PRIVILEGES ON TABLE public.{} FROM PUBLIC").format(
                sql.Identifier(MARKER_TABLE)
            )
        )

        for table in (*WEB_PRIVILEGES, *IMPORTER_PRIVILEGES):
            cur.execute("SELECT to_regclass(%s)", (f"public.{table}",))
            if cur.fetchone()[0] is None:
                continue
            cur.execute(
                sql.SQL("ALTER TABLE public.{} OWNER TO {}").format(
                    sql.Identifier(table), sql.Identifier(MIGRATION_ROLE)
                )
            )
            # Keep the migration role's owner privileges. PostgreSQL executes foreign-key
            # checks with the referenced table owner's rights, including for auth.user.
            for role in (WEB_ROLE, IMPORTER_ROLE):
                cur.execute(
                    sql.SQL("REVOKE ALL PRIVILEGES ON TABLE public.{} FROM {}").format(
                        sql.Identifier(table), sql.Identifier(role)
                    )
                )
            if table in WEB_PRIVILEGES:
                cur.execute(
                    sql.SQL("GRANT " + WEB_PRIVILEGES[table] + " ON TABLE public.{} TO {}").format(
                        sql.Identifier(table), sql.Identifier(WEB_ROLE)
                    )
                )
            if table in IMPORTER_PRIVILEGES:
                cur.execute(
                    sql.SQL("GRANT " + IMPORTER_PRIVILEGES[table] + " ON TABLE public.{} TO {}").format(
                        sql.Identifier(table), sql.Identifier(IMPORTER_ROLE)
                    )
                )
            if table == "native_reports":
                grant_native_report_insert_columns(cur, (WEB_ROLE,))

        for sequence in SEQUENCES:
            cur.execute("SELECT to_regclass(%s)", (f"public.{sequence}",))
            if cur.fetchone()[0] is not None:
                cur.execute(
                    sql.SQL("ALTER SEQUENCE public.{} OWNER TO {}").format(
                        sql.Identifier(sequence), sql.Identifier(MIGRATION_ROLE)
                    )
                )
                cur.execute(
                    sql.SQL("GRANT USAGE, SELECT ON SEQUENCE public.{} TO {}").format(
                        sql.Identifier(sequence), sql.Identifier(IMPORTER_ROLE)
                    )
                )


def psycopg_connect(url: str):
    import psycopg

    return psycopg.connect(url, autocommit=True, connect_timeout=5)


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
        with psycopg.connect(admin_url, autocommit=True, connect_timeout=5) as admin, admin.cursor() as admin_cur:
            admin_cur.execute("SELECT current_database()")
            if admin_cur.fetchone()[0] != "postgres":
                raise RuntimeError("PGADMIN_URL must connect to the postgres maintenance database.")
            admin_cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (EXPECTED_DATABASE,))
            if admin_cur.fetchone() is None:
                admin_cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(EXPECTED_DATABASE)))
                created_database = True

        with psycopg.connect(url, connect_timeout=5) as conn, conn.cursor() as cur:
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
        with psycopg.connect(admin_url, connect_timeout=5) as conn, conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM pg_roles WHERE rolname = ANY(%s)", (list(ROLES),))
            roles_present = cur.fetchone()[0]
        if roles_present == len(ROLES):
            configure_runtime_roles(admin_url, url)
        elif roles_present:
            raise RuntimeError("Only some TuxGG runtime roles exist; refusing partial test setup.")
        print("Verified and marked the dedicated tuxgg_test database.")
        return 0
    except Exception as exc:
        print(f"Test database preparation failed: {type(exc).__name__}.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

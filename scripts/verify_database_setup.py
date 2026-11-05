#!/usr/bin/env python3
"""Verify database setup touched only TuxGG and applied least-privilege grants."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

from setup_database import read_env_file

UNRELATED_DATABASE = "unrelated_app"


def require_ci() -> None:
    if os.environ.get("GITHUB_ACTIONS") != "true" or os.environ.get("VERIFY_DATABASE_SETUP_SAFETY") != "1":
        raise RuntimeError("This disposable-server verification helper only runs in its CI workflow.")


def database_url(source: str, database: str) -> str:
    parts = urlsplit(source)
    return urlunsplit((parts.scheme, parts.netloc, f"/{database}", parts.query, ""))


def snapshot_database(conn) -> dict[str, str | None]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT "
            "(SELECT datacl::text FROM pg_database WHERE datname = current_database()), "
            "(SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = current_database()), "
            "(SELECT COALESCE(jsonb_agg(jsonb_build_object('schema', nspname, 'owner', "
            "pg_get_userbyid(nspowner), 'acl', nspacl::text) ORDER BY nspname), '[]'::jsonb)::text "
            "FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema'), "
            "(SELECT COALESCE(jsonb_agg(jsonb_build_object('schema', n.nspname, 'name', c.relname, "
            "'kind', c.relkind, 'owner', pg_get_userbyid(c.relowner), 'acl', c.relacl::text) "
            "ORDER BY n.nspname, c.relname), '[]'::jsonb)::text FROM pg_class c "
            "JOIN pg_namespace n ON n.oid = c.relnamespace "
            "WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' "
            "AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'i', 'I')), "
            "(SELECT COALESCE(jsonb_agg(jsonb_build_object('owner', pg_get_userbyid(defaclrole), "
            "'schema', (SELECT nspname FROM pg_namespace WHERE oid = defaclnamespace), "
            "'kind', defaclobjtype, 'acl', defaclacl::text) ORDER BY defaclrole, defaclnamespace, "
            "defaclobjtype), '[]'::jsonb)::text FROM pg_default_acl)"
        )
        row = cur.fetchone()
        return {
            "database_acl": row[0],
            "database_owner": row[1],
            "schema_acls": row[2],
            "object_acls": row[3],
            "default_acls": row[4],
        }


def assert_runtime_privileges(url: str, role: str, expected: dict[str, bool]) -> None:
    import psycopg

    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute("SELECT current_database(), current_user")
        if cur.fetchone() != ("tuxgg", role):
            raise RuntimeError(f"{role} did not connect to the expected database and role.")
        for expression, wanted in expected.items():
            cur.execute(f"SELECT {expression}")
            if cur.fetchone()[0] is not wanted:
                raise RuntimeError(f"Unexpected privilege result for {role}: {expression}")


def main() -> int:
    try:
        require_ci()
        import psycopg

        admin_url = os.environ["PGADMIN_URL"]
        path = Path(os.environ["DATABASE_SETUP_SNAPSHOT"])
        baseline = json.loads(path.read_text(encoding="utf-8"))
        for name in ("postgres", UNRELATED_DATABASE):
            with psycopg.connect(database_url(admin_url, name)) as conn:
                if snapshot_database(conn) != baseline[name]:
                    raise RuntimeError(f"Database setup changed ownership or privileges in {name}.")

        with psycopg.connect(database_url(admin_url, "tuxgg")) as conn, conn.cursor() as cur:
            if snapshot_database(conn) == baseline["tuxgg"]:
                raise RuntimeError("TuxGG setup did not apply its database-specific ACL changes.")
            cur.execute(
                "SELECT has_schema_privilege('tuxgg_web', 'public', 'CREATE'), "
                "has_schema_privilege('tuxgg_importer', 'public', 'CREATE'), "
                "has_schema_privilege('tuxgg_migrator', 'public', 'CREATE'), "
                "has_database_privilege('tuxgg_web', 'tuxgg', 'CREATE'), "
                "has_database_privilege('tuxgg_importer', 'tuxgg', 'CREATE'), "
                "has_database_privilege('tuxgg_migrator', 'tuxgg', 'CREATE')"
            )
            if cur.fetchone() != (False, False, True, False, False, True):
                raise RuntimeError("Unexpected TuxGG schema or migration-role privileges.")
            cur.execute("SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = 'tuxgg'")
            if cur.fetchone()[0] in ("tuxgg_web", "tuxgg_importer", "tuxgg_app"):
                raise RuntimeError("A runtime role owns the TuxGG database.")

        env = read_env_file()
        assert_runtime_privileges(
            env["DATABASE_URL"],
            "tuxgg_web",
            {
                "has_table_privilege(current_user, 'public.games', 'SELECT')": True,
                "has_table_privilege(current_user, 'public.reports', 'SELECT')": True,
                "has_table_privilege(current_user, 'public.reports', 'INSERT')": False,
                "has_table_privilege(current_user, 'public.compatibility_summaries', 'UPDATE')": False,
                "has_table_privilege(current_user, 'public.user', 'UPDATE')": True,
            },
        )
        assert_runtime_privileges(
            env["IMPORTER_DATABASE_URL"],
            "tuxgg_importer",
            {
                "has_table_privilege(current_user, 'public.games', 'INSERT')": True,
                "has_table_privilege(current_user, 'public.reports', 'INSERT')": True,
                "has_table_privilege(current_user, 'public.reports', 'UPDATE')": True,
                "has_table_privilege(current_user, 'public.compatibility_summaries', 'UPDATE')": True,
                "has_table_privilege(current_user, 'public.user', 'SELECT')": False,
            },
        )
        print("Only TuxGG privileges changed; web and importer grants match their access maps.")
        return 0
    except Exception as exc:
        print(f"Database setup verification failed: {type(exc).__name__}.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Capture CI-only permissions for the maintenance and unrelated databases."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

TEST_DATABASES = ("tuxgg", "unrelated_app")


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


def main() -> int:
    try:
        require_ci()
        import psycopg
        from psycopg import sql

        admin_url = os.environ["PGADMIN_URL"]
        path = Path(os.environ["DATABASE_SETUP_SNAPSHOT"])
        with psycopg.connect(admin_url, autocommit=True) as admin, admin.cursor() as cur:
            cur.execute("SELECT current_database()")
            if cur.fetchone()[0] != "postgres":
                raise RuntimeError("Expected the PostgreSQL maintenance database.")
            for name in TEST_DATABASES:
                cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (name,))
                if cur.fetchone() is not None:
                    raise RuntimeError(f"Expected a fresh CI PostgreSQL service without {name}.")
                cur.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(name)))

        with psycopg.connect(database_url(admin_url, "unrelated_app"), autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute("CREATE TABLE public.unrelated_app_sentinel (id integer PRIMARY KEY)")
                cur.execute("GRANT SELECT ON TABLE public.unrelated_app_sentinel TO PUBLIC")

        baseline = {}
        for name in ("postgres", *TEST_DATABASES):
            with psycopg.connect(database_url(admin_url, name)) as conn:
                baseline[name] = snapshot_database(conn)
        path.write_text(json.dumps(baseline, indent=2), encoding="utf-8")
        print("Captured maintenance and unrelated-database permission baselines.")
        return 0
    except Exception as exc:
        print(f"Database safety baseline failed: {type(exc).__name__}.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

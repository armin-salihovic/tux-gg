#!/usr/bin/env python3
"""Read-only inspection of the configured VapourDB database."""

from __future__ import annotations

import json
import sys

try:
    from .db_config import database_settings
except ImportError:
    from db_config import database_settings


def main() -> int:
    try:
        import psycopg
        from psycopg.rows import dict_row

        with psycopg.connect(**database_settings(), row_factory=dict_row) as conn:
            conn.execute("SET default_transaction_read_only = on")
            result = {
                "connection": conn.execute(
                    "SELECT current_database() AS database, current_user AS username, "
                    "current_setting('server_version') AS version, inet_server_addr()::text AS server_address"
                ).fetchone(),
                "privileges": conn.execute(
                    "SELECT has_database_privilege(current_user, current_database(), 'CREATE') AS database_create, "
                    "has_schema_privilege(current_user, 'public', 'CREATE') AS public_create, "
                    "CASE WHEN to_regnamespace('drizzle') IS NULL THEN false "
                    "ELSE has_schema_privilege(current_user, 'drizzle', 'CREATE') END AS drizzle_create"
                ).fetchone(),
                "tables": conn.execute(
                    "SELECT table_schema, table_name FROM information_schema.tables "
                    "WHERE table_schema IN ('public', 'drizzle') AND table_type = 'BASE TABLE' "
                    "ORDER BY table_schema, table_name"
                ).fetchall(),
            }
            print(json.dumps(result, indent=2, default=str))
        return 0
    except Exception:
        print("PostgreSQL inspection failed. Passwords and connection strings are not displayed.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

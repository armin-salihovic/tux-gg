#!/usr/bin/env python3
"""Read-only inspection of the local PostgreSQL server and the TuxGG target database."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[1]


def env_values() -> dict[str, str]:
	values: dict[str, str] = {}
	path = ROOT / ".env"
	if path.exists():
		for line in path.read_text(encoding="utf-8").splitlines():
			line = line.strip()
			if line and not line.startswith("#") and "=" in line:
				key, value = line.split("=", 1)
				values[key.strip()] = value.strip().strip("\"'")
	return values


def main() -> int:
	try:
		import psycopg
		from psycopg.rows import dict_row

		admin_url = os.environ.get("PGADMIN_URL") or env_values().get("PGADMIN_URL")
		if not admin_url:
			raise RuntimeError("PGADMIN_URL is not configured in the private environment.")
		result: dict[str, object] = {}
		with psycopg.connect(admin_url, autocommit=True, row_factory=dict_row) as conn:
			conn.execute("SET default_transaction_read_only = on")
			result["server"] = conn.execute(
				"SELECT current_setting('server_version') AS version, current_setting('port') AS port, "
				"current_setting('listen_addresses') AS listen_addresses, "
				"current_setting('max_connections') AS max_connections, current_user AS connected_as"
			).fetchone()
			result["target_database"] = conn.execute(
				"SELECT d.datname, pg_get_userbyid(d.datdba) AS owner, d.datallowconn AS accepts_connections "
				"FROM pg_database d WHERE d.datname = 'tuxgg'"
			).fetchone()
			result["project_role"] = conn.execute(
				"SELECT rolname, rolsuper AS is_superuser, rolcreatedb AS can_create_database, "
				"rolcreaterole AS can_create_roles, rolcanlogin AS can_login "
				"FROM pg_roles WHERE rolname = 'tuxgg_app'"
			).fetchone()
		if result["target_database"]:
			parts = urlsplit(admin_url)
			target_url = urlunsplit((parts.scheme, parts.netloc, "/tuxgg", parts.query, ""))
			with psycopg.connect(target_url, autocommit=True, row_factory=dict_row) as conn:
				conn.execute("SET default_transaction_read_only = on")
				result["target_objects"] = conn.execute(
					"SELECT table_schema, table_name FROM information_schema.tables "
					"WHERE table_schema NOT IN ('pg_catalog', 'information_schema') "
					"AND table_type = 'BASE TABLE' ORDER BY table_schema, table_name"
				).fetchall()
		print(json.dumps(result, indent=2, default=str))
		return 0
	except Exception:
		print("PostgreSQL inspection failed. Connection values are not displayed.", file=sys.stderr)
		return 1


if __name__ == "__main__":
	raise SystemExit(main())

"""Read the single configured PostgreSQL account without URL parsing."""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def read_env_file() -> dict[str, str]:
    values: dict[str, str] = {}
    path = ROOT / ".env"
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key.strip()] = value
    return values


def database_settings(
    *, database: str | None = None, allow_test: bool = False, maintenance: bool = False
) -> dict[str, object]:
    values = dict(os.environ)
    required_environment = ["DB_CONNECTION", "DB_HOST", "DB_PORT", "DB_USERNAME"]
    if database is None:
        required_environment.append("DB_DATABASE")
    if any(not values.get(key) for key in required_environment):
        values = {**read_env_file(), **values}
    if values.get("DB_CONNECTION", "").lower() != "pgsql":
        raise RuntimeError("Set DB_CONNECTION=pgsql.")
    selected_database = database or values.get("DB_DATABASE", "")
    permitted_test = (
        allow_test
        and os.environ.get("VAPOURDB_TEST_DATABASE") == "1"
        and selected_database == "vapourdb_test"
    )
    if selected_database != "vapourdb" and not permitted_test and not (
        maintenance and selected_database == "postgres"
    ):
        raise RuntimeError("DB_DATABASE must be exactly vapourdb for ordinary application commands.")
    missing = [key for key in ("DB_HOST", "DB_PORT", "DB_USERNAME") if not values.get(key)]
    if missing:
        raise RuntimeError(f"Set {', '.join(missing)} in .env.")
    try:
        port = int(values["DB_PORT"])
        if port < 1 or port > 65535:
            raise ValueError
    except ValueError as exc:
        raise RuntimeError("DB_PORT must be an integer from 1 to 65535.") from exc
    return {
        "host": values["DB_HOST"],
        "port": port,
        "dbname": selected_database,
        "user": values["DB_USERNAME"],
        "password": values.get("DB_PASSWORD", ""),
        "connect_timeout": 5,
        "application_name": "vapourdb-python-tool",
    }

#!/usr/bin/env python3
"""Set CI database URLs to the restricted runtime roles on tuxgg_test."""

from __future__ import annotations

import os
import sys
from pathlib import Path
from urllib.parse import urlsplit

from setup_database import read_env_file, url_for_database

EXPECTED_DATABASE = "tuxgg"
TEST_DATABASE = "tuxgg_test"
ROLE_URLS = {
    "DATABASE_URL": "tuxgg_web",
    "MIGRATION_DATABASE_URL": "tuxgg_migrator",
}


def main() -> int:
    try:
        if os.environ.get("GITHUB_ACTIONS") != "true":
            raise RuntimeError("This helper only configures the disposable GitHub Actions database.")
        github_env = os.environ.get("GITHUB_ENV")
        if not github_env:
            raise RuntimeError("GITHUB_ENV is unavailable.")
        values = read_env_file()
        urls: dict[str, str] = {}
        for key, role in ROLE_URLS.items():
            source = values.get(key) or os.environ.get(key)
            if not source:
                raise RuntimeError(f"{key} is missing from the CI database setup.")
            parts = urlsplit(source)
            if parts.username != role or parts.path.rstrip("/").split("/")[-1] != EXPECTED_DATABASE:
                raise RuntimeError(f"{key} does not use the expected restricted role and database.")
            urls[key] = url_for_database(source, TEST_DATABASE)

        with Path(github_env).open("a", encoding="utf-8") as stream:
            for key, value in urls.items():
                print(f"::add-mask::{value}")
                stream.write(f"{key}={value}\n")
        print("Configured tuxgg_test migrations and runtime access with the dedicated TuxGG roles.")
        return 0
    except Exception as exc:
        print(f"CI test database role setup failed: {type(exc).__name__}.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

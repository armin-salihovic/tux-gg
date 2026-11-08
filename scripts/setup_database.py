#!/usr/bin/env python3
"""Compatibility entry point for the zero-prompt Node.js database setup."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> int:
    if sys.argv[1:]:
        print("Database setup takes no arguments; use pnpm db:setup.", file=sys.stderr)
        return 2
    result = subprocess.run(
        ["node", str(ROOT / "scripts" / "setup_database.mjs")],
        cwd=ROOT,
        check=False,
    )
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())

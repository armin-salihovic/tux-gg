#!/usr/bin/env python3
"""Insert deterministic game rows into the verified disposable browser-test database."""

from __future__ import annotations

import os
import sys

EXPECTED_DATABASE = "tuxgg_test"
MARKER_VALUE = "tuxgg_disposable_test_database_v1"
GAMES = (
	(
		"440",
		"Team Fortress 2",
		"team-fortress-2",
		{"steam": {"shortDescription": "Team Fortress 2 is a class-based multiplayer game with many maps and distinct character roles."}},
	),
	("570", "Dota 2", "dota-2", {}),
	("730", "Counter-Strike 2", "counter-strike-2", {}),
)


def main() -> int:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        print("Set TEST_DATABASE_URL to the marked tuxgg_test database.", file=sys.stderr)
        return 1
    try:
        import psycopg
        from psycopg.types.json import Json

        with psycopg.connect(url, connect_timeout=5) as conn, conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            if cur.fetchone()[0] != EXPECTED_DATABASE:
                raise RuntimeError("Refusing to seed fixtures outside tuxgg_test.")
            cur.execute("SELECT marker FROM public.tuxgg_test_safety_marker WHERE id = 1")
            marker = cur.fetchone()
            if marker is None or marker[0] != MARKER_VALUE:
                raise RuntimeError("Refusing to seed fixtures without the disposable database marker.")
            for app_id, title, slug, metadata in GAMES:
                cur.execute(
                    "INSERT INTO games (app_id, title, slug, metadata) VALUES (%s, %s, %s, %s) "
                    "ON CONFLICT (app_id) DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug, metadata = EXCLUDED.metadata, updated_at = now()",
                    (app_id, title, slug, Json(metadata)),
                )
        print("Seeded deterministic game fixtures in tuxgg_test.")
        return 0
    except Exception as exc:
        print(f"Browser-test fixture seeding failed: {type(exc).__name__}.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

#!/usr/bin/env python3
"""Insert deterministic game rows into the verified disposable browser-test database."""

from __future__ import annotations

import os
import sys

EXPECTED_DATABASE = "tuxgg_test"
MARKER_VALUE = "tuxgg_disposable_test_database_v1"
GAMES = (
    ("440", "Team Fortress 2", "team-fortress-2", "platinum", 12),
    ("570", "Dota 2", "dota-2", "gold", 4),
    ("730", "Counter-Strike 2", "counter-strike-2", "unknown", 2),
)


def main() -> int:
    url = os.environ.get("TEST_DATABASE_URL")
    if not url:
        print("Set TEST_DATABASE_URL to the marked tuxgg_test database.", file=sys.stderr)
        return 1
    try:
        import psycopg

        with psycopg.connect(url) as conn, conn.cursor() as cur:
            cur.execute("SELECT current_database()")
            if cur.fetchone()[0] != EXPECTED_DATABASE:
                raise RuntimeError("Refusing to seed fixtures outside tuxgg_test.")
            cur.execute("SELECT marker FROM public.tuxgg_test_safety_marker WHERE id = 1")
            marker = cur.fetchone()
            if marker is None or marker[0] != MARKER_VALUE:
                raise RuntimeError("Refusing to seed fixtures without the disposable database marker.")
            for app_id, title, slug, tier, report_count in GAMES:
                cur.execute(
                    "INSERT INTO games (app_id, title, slug) VALUES (%s, %s, %s) "
                    "ON CONFLICT (app_id) DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug, updated_at = now()",
                    (app_id, title, slug),
                )
                cur.execute(
                    "INSERT INTO compatibility_summaries (app_id, tier, report_count, scored_report_count) "
                    "VALUES (%s, %s, %s, %s) ON CONFLICT (app_id) DO UPDATE SET "
                    "tier = EXCLUDED.tier, report_count = EXCLUDED.report_count, "
                    "scored_report_count = EXCLUDED.scored_report_count, calculated_at = now()",
                    (app_id, tier, report_count, report_count),
                )
        print("Seeded deterministic game fixtures in tuxgg_test.")
        return 0
    except Exception as exc:
        print(f"Browser-test fixture seeding failed: {type(exc).__name__}.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

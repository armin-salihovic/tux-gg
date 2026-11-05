#!/usr/bin/env python3
"""List and moderate native TuxGG reports using an operator-only database URL."""

from __future__ import annotations

import argparse
import os
import re
import sys
import uuid

import psycopg

TEST_DATABASE = "tuxgg_test"
TEST_MARKER = "tuxgg_disposable_test_database_v1"
TRANSITIONS = {"approve": "published", "hide": "hidden", "remove": "removed"}


def verify_operator_connection(conn) -> None:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT current_database(), current_user, operator_role.rolsuper, "
            "has_table_privilege(current_user, 'public.native_reports', 'SELECT'), "
            "has_table_privilege(current_user, 'public.native_reports', 'UPDATE') "
            "FROM pg_roles AS operator_role WHERE operator_role.rolname = current_user"
        )
        row = cur.fetchone()
        if not row:
            raise RuntimeError("Could not verify the operator database connection.")
        database, role, is_superuser, can_select, can_update = row
        if database not in ("tuxgg", TEST_DATABASE):
            raise RuntimeError("Moderation is allowed only on tuxgg or the marked tuxgg_test database.")
        if role in ("tuxgg_web", "tuxgg_importer", "tuxgg_app") or is_superuser:
            raise RuntimeError("Use a non-administrator operator or migration role for moderation.")
        if not can_select or not can_update:
            raise RuntimeError("The configured operator role cannot moderate native reports.")
        if database == TEST_DATABASE:
            cur.execute("SELECT marker FROM public.tuxgg_test_safety_marker WHERE id = 1")
            marker = cur.fetchone()
            if marker is None or marker[0] != TEST_MARKER:
                raise RuntimeError("Refusing to moderate an unmarked tuxgg_test database.")


def list_pending(conn) -> list[tuple]:
    with conn.cursor() as cur:
        cur.execute(
            "SELECT report.id, report.app_id, COALESCE(game.title, 'Steam app ' || report.app_id), "
            "account.username, report.verdict, report.platform, report.created_at, report.content "
            "FROM public.native_reports AS report "
            "JOIN public.games AS game ON game.app_id = report.app_id "
            "JOIN public.user AS account ON account.id = report.author_id "
            "WHERE report.moderation_state = 'pending' "
            "ORDER BY report.created_at, report.id"
        )
        return cur.fetchall()


def moderate_report(conn, report_id: str, state: str) -> bool:
    if state not in TRANSITIONS.values():
        raise ValueError("Unsupported moderation state.")
    with conn.cursor() as cur:
        cur.execute(
            "UPDATE public.native_reports SET moderation_state = %s, "
            "published_at = CASE WHEN %s = 'published' THEN COALESCE(published_at, now()) ELSE published_at END, "
            "updated_at = now() WHERE id = %s RETURNING id",
            (state, state, report_id),
        )
        return cur.fetchone() is not None


def terminal_text(value: str | None) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", value or "")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="action", required=True)
    subparsers.add_parser("list", help="list pending native reports")
    for action in TRANSITIONS:
        command = subparsers.add_parser(action, help=f"set a report to {TRANSITIONS[action]}")
        command.add_argument("report_id", type=uuid.UUID, help="native report UUID")
    args = parser.parse_args()
    database_url = os.environ.get("NATIVE_REPORT_OPERATOR_DATABASE_URL")
    if not database_url:
        print("Set NATIVE_REPORT_OPERATOR_DATABASE_URL for this operator command.", file=sys.stderr)
        return 2

    try:
        with psycopg.connect(database_url) as conn:
            verify_operator_connection(conn)
            if args.action == "list":
                rows = list_pending(conn)
                if not rows:
                    print("No pending native reports.")
                for report_id, app_id, title, username, verdict, platform, created_at, content in rows:
                    snippet = " ".join(terminal_text(content).split())[:240]
                    print(
                        f"{report_id} | {title} ({app_id}) | @{username} | {verdict} | "
                        f"{platform or 'platform missing'} | {created_at.isoformat()}\n  {snippet}"
                    )
            else:
                new_state = TRANSITIONS[args.action]
                if not moderate_report(conn, str(args.report_id), new_state):
                    print("No report with that ID exists.", file=sys.stderr)
                    return 1
                print(f"Report {args.report_id} set to {new_state}.")
        return 0
    except Exception as exc:
        print(f"Moderation failed: {type(exc).__name__}.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

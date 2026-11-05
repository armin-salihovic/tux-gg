"""Operator CLI integration tests, confined to the marked disposable database."""

from __future__ import annotations

import os
import uuid

import psycopg
import pytest

from scripts.moderate_native_reports import list_pending, moderate_report, verify_operator_connection


@pytest.fixture
def operator_connection():
    url = os.environ.get("MIGRATION_DATABASE_URL")
    if not url:
        pytest.skip("MIGRATION_DATABASE_URL is not configured for the disposable database.")
    if psycopg.conninfo.conninfo_to_dict(url).get("dbname") != "tuxgg_test":
        pytest.fail("Native report moderation integration tests require tuxgg_test.")
    conn = psycopg.connect(url)
    conn.execute("BEGIN")
    try:
        verify_operator_connection(conn)
        yield conn
    finally:
        conn.rollback()
        conn.close()


def create_pending_report(conn):
    suffix = uuid.uuid4().hex
    app_id = f"9{int(suffix[:9], 16)}"
    user_id = f"native-report-test-{suffix}"
    username = f"test-{suffix[:18]}"
    report_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO public.games (app_id, title, slug) VALUES (%s, %s, %s)",
        (app_id, "Moderation test game", f"moderation-{suffix[:12]}"),
    )
    conn.execute(
        "INSERT INTO public.user (id, name, email, username) VALUES (%s, %s, %s, %s)",
        (user_id, "Moderation test", f"{suffix}@steam.invalid", username),
    )
    conn.execute(
        "INSERT INTO public.native_reports (id, app_id, author_id, verdict, platform, content) "
        "VALUES (%s, %s, %s, 'yes', 'linux_desktop', 'Test report for moderation.')",
        (report_id, app_id, user_id),
    )
    return report_id


def test_operator_lists_and_approves_only_native_pending_reports(operator_connection):
    conn = operator_connection
    report_id = create_pending_report(conn)
    pending = list_pending(conn)
    assert any(str(row[0]) == report_id for row in pending)
    assert moderate_report(conn, report_id, "published")
    row = conn.execute(
        "SELECT moderation_state, published_at IS NOT NULL FROM public.native_reports WHERE id = %s",
        (report_id,),
    ).fetchone()
    assert row == ("published", True)
    assert not moderate_report(conn, str(uuid.uuid4()), "hidden")


def test_operator_can_hide_or_remove_a_native_report(operator_connection):
    conn = operator_connection
    report_id = create_pending_report(conn)
    assert moderate_report(conn, report_id, "hidden")
    assert conn.execute(
        "SELECT moderation_state FROM public.native_reports WHERE id = %s", (report_id,)
    ).fetchone()[0] == "hidden"
    assert moderate_report(conn, report_id, "removed")
    assert conn.execute(
        "SELECT moderation_state FROM public.native_reports WHERE id = %s", (report_id,)
    ).fetchone()[0] == "removed"

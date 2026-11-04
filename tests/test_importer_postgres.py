"""Importer recovery tests; run only against a disposable TEST_DATABASE_URL."""

import io
import json
import os
import tarfile
from datetime import datetime, timedelta, timezone

import pytest

from importer import tuxgg_importer


DATABASE_URL = os.environ.get("TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DATABASE_URL, reason="TEST_DATABASE_URL is not configured")


def _record(
    app_id: str,
    title: str,
    timestamp: int,
    verdict: str = "yes",
    proton_version: str = "Proton 10",
    gpu: str = "AMD Custom GPU",
) -> dict:
    return {
        "app": {"steam": {"appId": app_id}, "title": title},
        "timestamp": timestamp,
        "responses": {"verdict": verdict, "protonVersion": proton_version},
        "systemInfo": {
            "os": "SteamOS Holo",
            "cpu": "AMD Custom APU",
            "gpu": gpu,
            "gpuDriver": "Mesa",
        },
    }


def _archive(path, records: list[dict]) -> None:
    payload = json.dumps(records, separators=(",", ":")).encode("utf-8")
    with tarfile.open(path, mode="w:gz") as archive:
        member = tarfile.TarInfo("reports.json")
        member.size = len(payload)
        archive.addfile(member, io.BytesIO(payload))


@pytest.fixture(autouse=True)
def clean_test_database():
    if not DATABASE_URL:
        yield
        return
    import psycopg

    with psycopg.connect(DATABASE_URL) as conn, conn.cursor() as cur:
        cur.execute(
            'TRUNCATE TABLE reports, compatibility_summaries, import_batches, games RESTART IDENTITY CASCADE'
        )
    yield


def _counts():
    import psycopg

    with psycopg.connect(DATABASE_URL) as conn, conn.cursor() as cur:
        cur.execute("SELECT count(*) FROM reports")
        reports = cur.fetchone()[0]
        cur.execute("SELECT status, import_mode FROM import_batches ORDER BY id DESC LIMIT 1")
        batch = cur.fetchone()
        cur.execute("SELECT COALESCE(sum(report_count), 0) FROM compatibility_summaries")
        summary = cur.fetchone()
    return reports, batch, summary[0]


def test_interrupted_full_import_replays_without_duplicates(tmp_path, monkeypatch):
    archive = tmp_path / "reports_nov1_2026.tar.gz"
    records = [
        _record("440", "Team Fortress 2", 1790899200),
        _record("570", "Dota 2", 1790985600, "no"),
    ]
    _archive(archive, records)
    original_iter = tuxgg_importer.iter_archive

    def interrupted(path):
        iterator = original_iter(path)
        yield next(iterator)
        raise RuntimeError("simulated interruption")

    monkeypatch.setattr(tuxgg_importer, "iter_archive", interrupted)
    with pytest.raises(RuntimeError, match="simulated interruption"):
        tuxgg_importer.import_archive(archive, DATABASE_URL, batch_size=1)
    count, batch, _ = _counts()
    assert count == 1
    assert batch == ("failed", "full")

    monkeypatch.setattr(tuxgg_importer, "iter_archive", original_iter)
    result = tuxgg_importer.import_archive(archive, DATABASE_URL, batch_size=1)
    assert result["source_records"] == 2
    assert _counts()[:2] == (2, ("complete", "full"))
    assert tuxgg_importer.rebuild_summaries(DATABASE_URL) == 2
    assert _counts()[2] == 2


def test_sample_full_retry_new_snapshot_and_unchanged_archive(tmp_path):
    archive = tmp_path / "reports_nov1_2026.tar.gz"
    original = [
        _record("440", "Team Fortress 2", 1790899200),
        _record("570", "Dota 2", 1790985600, "no"),
    ]
    _archive(archive, original)

    sample = tuxgg_importer.import_archive(archive, DATABASE_URL, limit=1)
    assert sample["import_mode"] == "sample"
    assert tuxgg_importer.rebuild_summaries(DATABASE_URL) == 0
    assert _counts()[2] == 0

    full = tuxgg_importer.import_archive(archive, DATABASE_URL)
    assert full["import_mode"] == "full"
    assert _counts()[0] == 2
    tuxgg_importer.rebuild_summaries(DATABASE_URL)
    assert _counts()[2] == 2

    unchanged = tuxgg_importer.import_archive(archive, DATABASE_URL)
    assert unchanged["skipped"] is True
    assert _counts()[0] == 2

    newer_archive = tmp_path / "reports_dec1_2026.tar.gz"
    _archive(newer_archive, original + [_record("730", "Counter-Strike 2", 1791072000)])
    tuxgg_importer.import_archive(newer_archive, DATABASE_URL)
    tuxgg_importer.rebuild_summaries(DATABASE_URL)
    assert _counts()[0] == 3
    assert _counts()[2] == 3


def test_summary_scoring_covers_positive_negative_sparse_and_recency_cases(tmp_path):
    archive = tmp_path / "reports_nov1_2026.tar.gz"
    now = datetime.now(timezone.utc)
    recent = int(now.timestamp())
    old = int((now - timedelta(days=365 * 3)).timestamp())
    records = [
        _record("440", "Team Fortress 2", recent, "yes", "Proton Experimental", "AMD GPU"),
        _record("440", "Team Fortress 2", recent - 10, "yes", "GE-Proton 10", "NVIDIA GPU"),
        _record("440", "Team Fortress 2", recent - 20, "yes", "Proton 9", "Intel GPU"),
        _record("440", "Team Fortress 2", recent - 30, "yes", "Proton 10", "AMD GPU"),
        *[_record("570", "Dota 2", recent - index, "no") for index in range(4)],
        *[_record("730", "Counter-Strike 2", recent - index, "yes") for index in range(2)],
        *[_record("9000", "Recency Example", old - index, "yes") for index in range(3)],
        *[_record("9000", "Recency Example", recent - index, "no") for index in range(3)],
    ]
    _archive(archive, records)
    tuxgg_importer.import_archive(archive, DATABASE_URL, batch_size=100)
    tuxgg_importer.rebuild_summaries(DATABASE_URL)

    import psycopg

    with psycopg.connect(DATABASE_URL) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT app_id, tier, report_count FROM compatibility_summaries WHERE app_id = ANY(%s)",
            (["440", "570", "730", "9000"],),
        )
        summaries = {row[0]: (row[1], row[2]) for row in cur.fetchall()}

    assert summaries == {
        "440": ("platinum", 4),
        "570": ("borked", 4),
        "730": ("unknown", 2),
        "9000": ("borked", 6),
    }

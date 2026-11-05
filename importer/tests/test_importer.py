from __future__ import annotations

import io
import json
import os
from unittest.mock import patch

import psycopg

from importer import tuxgg_importer
from importer.tuxgg_importer import iter_json_array, normalize_record


def test_importer_prefers_its_dedicated_database_role():
    with patch.dict(
        os.environ,
        {
            "IMPORTER_DATABASE_URL": "postgresql://tuxgg_importer@localhost/tuxgg",
            "DATABASE_URL": "postgresql://tuxgg_web@localhost/tuxgg",
        },
    ), patch.object(psycopg, "connect", return_value=object()) as connect:
        tuxgg_importer._connect()

    connect.assert_called_once_with("postgresql://tuxgg_importer@localhost/tuxgg", autocommit=False)


def legacy_report(**overrides):
    record = {
        "appId": "570",
        "title": "Dota 2",
        "timestamp": "1543707362",
        "rating": "Platinum",
        "notes": "Runs well; contact test@example.org for my patch.",
        "os": "Arch Linux",
        "gpuDriver": "NVIDIA 535.54",
        "specs": "AMD Ryzen 7 / NVIDIA GeForce RTX 3080",
        "protonVersion": "3.7-8",
        "tweaks": {"environment": "PROTON_NO_ESYNC=1"},
    }
    record.update(overrides)
    return record


def nested_report(**overrides):
    record = {
        "app": {"steam": {"appId": 123}, "title": "Example Game"},
        "responses": {
            "verdict": "yes",
            "variant": "ge",
            "customProtonVersion": "GE-Proton9-1",
            "launchOptions": "PROTON_LOG=1 %command%",
            "concludingNotes": "Works on Steam Deck; contact deck@example.org",
            "batteryPerformance": "good",
        },
        "timestamp": 1793589447,
        "systemInfo": {
            "os": "SteamOS Holo",
            "cpu": "AMD Custom APU",
            "gpu": "AMD Custom GPU",
            "gpuDriver": "Mesa 25.0",
            "kernel": "6.12.0",
            "ram": "16 GB",
            "steamRuntimeVersion": "sniper",
        },
    }
    record.update(overrides)
    return record


def test_legacy_schema_normalizes_and_redacts_email():
    report, reason, missing = normalize_record(legacy_report())

    assert reason is None
    assert report is not None
    assert report.app_id == "570"
    assert report.source_rating == "Platinum"
    assert report.scoring_value == 1.0
    assert report.gpu_vendor == "NVIDIA"
    assert report.hardware_details.startswith("AMD Ryzen")
    assert "test@example.org" not in (report.comments or "")
    assert "[email redacted]" in (report.comments or "")
    assert "timestamp" not in missing


def test_nested_schema_normalizes_variant_and_keeps_steam_deck_fields():
    report, reason, _ = normalize_record(nested_report())

    assert reason is None
    assert report is not None
    assert report.app_id == "123"
    assert report.source_verdict == "yes"
    assert report.scoring_value == 1.0
    assert report.proton_variant == "ge"
    assert report.custom_proton_version == "GE-Proton9-1"
    assert report.distribution == "SteamOS Holo"
    assert report.source_data["responses"]["batteryPerformance"] == "good"
    assert "deck@example.org" not in (report.comments or "")


def test_only_primary_chromeos_reports_are_excluded():
    report, reason, _ = normalize_record(
        nested_report(systemInfo={"os": "Chrome OS", "gpu": "Intel Graphics"})
    )
    assert report is None
    assert reason == "chromebook_only"

    linux_record = nested_report(
        responses={"verdict": "yes", "concludingNotes": "Chromebook users asked about this too."}
    )
    report, reason, _ = normalize_record(linux_record)
    assert reason is None
    assert report is not None
    assert report.distribution == "SteamOS Holo"


def test_missing_and_malformed_values_are_retained_as_unknown():
    report, reason, missing = normalize_record(
        nested_report(timestamp="not-a-date", systemInfo={"os": None, "gpu": None})
    )
    assert reason is None
    assert report is not None
    assert report.submitted_at is None
    assert {"timestamp", "os", "gpu"}.issubset(set(missing))

    invalid, invalid_reason, _ = normalize_record({"title": "No app ID"})
    assert invalid is None
    assert invalid_reason == "missing_app_id"


def test_content_fingerprint_distinguishes_same_second_different_reports():
    first, _, _ = normalize_record(nested_report())
    second, _, _ = normalize_record(
        nested_report(responses={"verdict": "no", "notes": {"verdict": "black screen"}})
    )
    assert first is not None and second is not None
    assert first.app_id == second.app_id
    assert first.submitted_at == second.submitted_at
    assert first.source_fingerprint != second.source_fingerprint


def test_json_array_streams_records_across_small_chunks():
    payload = json.dumps([{"name": "Game Ω"}, {"name": 'escaped " quote'}])
    records = list(iter_json_array(io.StringIO(payload), chunk_size=7))
    assert records == [{"name": "Game Ω"}, {"name": 'escaped " quote'}]

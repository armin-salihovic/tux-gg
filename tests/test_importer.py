import os

from importer import tuxgg_importer


def test_project_env_is_loaded_without_overriding_exported_values(tmp_path, monkeypatch):
    env_file = tmp_path / ".env"
    env_file.write_text(
        'DATABASE_URL="postgresql://from-file"\nPUBLIC_SITE_URL=https://example.test\n',
        encoding="utf-8",
    )
    monkeypatch.setenv("DATABASE_URL", "postgresql://from-shell")
    monkeypatch.delenv("PUBLIC_SITE_URL", raising=False)

    tuxgg_importer.load_project_environment(env_file)

    assert os.environ["DATABASE_URL"] == "postgresql://from-shell"
    assert os.environ["PUBLIC_SITE_URL"] == "https://example.test"


def test_database_credentials_are_redacted_from_errors():
    message = tuxgg_importer.safe_error_message(
        "failed: postgresql://tuxgg_app:super-secret%40value@db.example.test:5432/tuxgg"
    )

    assert "super-secret" not in message
    assert "[redacted]" in message


def test_chromeos_only_records_are_excluded_but_linux_mentions_are_kept():
    chromeos = {
        "app": {"steam": {"appId": "440"}, "title": "Team Fortress 2"},
        "timestamp": 1790899200,
        "responses": {"verdict": "yes"},
        "systemInfo": {"os": "Chrome OS"},
    }
    linux = {
        "app": {"steam": {"appId": "440"}, "title": "Team Fortress 2"},
        "timestamp": 1790899200,
        "responses": {"verdict": "yes", "concludingNotes": "My old Chromebook was different."},
        "systemInfo": {"os": "Arch Linux"},
    }

    rejected, reason, _ = tuxgg_importer.normalize_record(chromeos)
    kept, kept_reason, _ = tuxgg_importer.normalize_record(linux)

    assert rejected is None
    assert reason == "chromebook_only"
    assert kept is not None
    assert kept_reason is None
    assert "Chromebook" in kept.comments


def test_malformed_and_duplicate_source_records_are_deterministic():
    malformed, reason, _ = tuxgg_importer.normalize_record(["not", "a", "report"])
    record = {
        "app": {"steam": {"appId": "440"}, "title": "Team Fortress 2"},
        "timestamp": 1790899200,
        "responses": {"verdict": "yes"},
        "systemInfo": {"os": "Arch Linux"},
    }
    first, _, _ = tuxgg_importer.normalize_record(record)
    second, _, _ = tuxgg_importer.normalize_record(record)

    assert malformed is None
    assert reason == "invalid_record_shape"
    assert first is not None and second is not None
    assert first.source_fingerprint == second.source_fingerprint

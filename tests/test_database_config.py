from __future__ import annotations

import pytest

from scripts.db_config import database_settings


def test_database_settings_use_one_configured_account(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DB_CONNECTION", "pgsql")
    monkeypatch.setenv("DB_HOST", "127.0.0.1")
    monkeypatch.setenv("DB_PORT", "5432")
    monkeypatch.setenv("DB_DATABASE", "vapourdb")
    monkeypatch.setenv("DB_USERNAME", "postgres")
    monkeypatch.setenv("DB_PASSWORD", "special :/@ password")
    monkeypatch.setenv("DATABASE_URL", "postgresql://ignored:wrong@localhost/tuxgg")

    settings = database_settings()

    assert settings["dbname"] == "vapourdb"
    assert settings["user"] == "postgres"
    assert settings["password"] == "special :/@ password"


def test_legacy_and_test_databases_are_not_ordinary_targets(monkeypatch: pytest.MonkeyPatch) -> None:
    for name, message in (("tuxgg", "DB_DATABASE"), ("vapourdb_test", "DB_DATABASE")):
        monkeypatch.setenv("DB_CONNECTION", "pgsql")
        monkeypatch.setenv("DB_HOST", "localhost")
        monkeypatch.setenv("DB_PORT", "5432")
        monkeypatch.setenv("DB_DATABASE", name)
        monkeypatch.setenv("DB_USERNAME", "postgres")
        monkeypatch.setenv("DB_PASSWORD", "test")
        monkeypatch.delenv("VAPOURDB_TEST_DATABASE", raising=False)
        with pytest.raises(RuntimeError, match=message):
            database_settings()


def test_test_database_requires_the_explicit_github_actions_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv("DB_CONNECTION", "pgsql")
    monkeypatch.setenv("DB_HOST", "localhost")
    monkeypatch.setenv("DB_PORT", "5432")
    monkeypatch.setenv("DB_DATABASE", "vapourdb_test")
    monkeypatch.setenv("DB_USERNAME", "postgres")
    monkeypatch.setenv("VAPOURDB_TEST_DATABASE", "1")
    monkeypatch.setenv("GITHUB_ACTIONS", "false")

    with pytest.raises(RuntimeError, match="DB_DATABASE"):
        database_settings(allow_test=True)

    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    assert database_settings(allow_test=True)["dbname"] == "vapourdb_test"

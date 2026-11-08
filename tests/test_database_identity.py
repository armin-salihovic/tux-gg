"""Database identity selection remains stable across the legacy cutover."""

from __future__ import annotations

import pytest

from scripts.setup_database import resolve_identity


@pytest.mark.parametrize(
    ("database_url", "expected"),
    [
        (
            "postgresql://vapourdb_web:placeholder@localhost:5432/vapourdb",
            ("vapourdb", ("vapourdb_web", "vapourdb_importer", "vapourdb_migrator")),
        ),
        (
            "postgresql://tuxgg_web:placeholder@localhost:5432/tuxgg",
            ("tuxgg", ("tuxgg_web", "tuxgg_importer", "tuxgg_migrator")),
        ),
    ],
)
def test_resolve_identity_uses_configured_database(
    monkeypatch: pytest.MonkeyPatch, database_url: str, expected: tuple
) -> None:
    for key in ("MIGRATION_DATABASE_URL", "DATABASE_URL", "IMPORTER_DATABASE_URL"):
        monkeypatch.delenv(key, raising=False)
    assert resolve_identity({"DATABASE_URL": database_url}) == expected


def test_resolve_identity_rejects_mixed_old_and_new_database_urls(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for key in ("MIGRATION_DATABASE_URL", "DATABASE_URL", "IMPORTER_DATABASE_URL"):
        monkeypatch.delenv(key, raising=False)
    with pytest.raises(RuntimeError, match="mix legacy and VapourDB"):
        resolve_identity(
            {
                "DATABASE_URL": "postgresql://tuxgg_web:placeholder@localhost:5432/tuxgg",
                "IMPORTER_DATABASE_URL": "postgresql://vapourdb_importer:placeholder@localhost:5432/vapourdb",
            }
        )

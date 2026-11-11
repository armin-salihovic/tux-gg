"""Offline tests for the VapourDB VPS local-image selector and cleanup guard."""

from __future__ import annotations

import importlib.util
import json
import os
import pathlib
import sys
from unittest.mock import patch

import pytest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "deploy" / "production" / "cleanup-vps.py"
SPEC = importlib.util.spec_from_file_location("vapourdb_cleanup_vps", SCRIPT)
assert SPEC and SPEC.loader
cleanup = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = cleanup
SPEC.loader.exec_module(cleanup)


RELEASES = [f"v1.0.{number}" for number in range(4)]
COMMITS = {tag: f"{number + 101:040x}" for number, tag in enumerate(RELEASES)}
REPOSITORY = cleanup.IMAGE_REPOSITORY


def complete_fixture(releases=RELEASES):
    metadata = {tag: COMMITS[tag] for tag in releases}
    images = []
    for index, release in enumerate(releases):
        sha = metadata[release]
        runtime_id = f"runtime-image-{index}"
        migration_id = f"migration-image-{index}"
        images.extend([
            {"repository": REPOSITORY, "tag": release, "id": runtime_id, "revision": sha},
            {"repository": REPOSITORY, "tag": f"{release}-migration", "id": migration_id, "revision": sha},
            {"repository": REPOSITORY, "tag": f"sha-{sha}", "id": runtime_id, "revision": sha},
            {"repository": REPOSITORY, "tag": f"sha-{sha}-migration", "id": migration_id, "revision": sha},
        ])
    return metadata, images


def test_four_complete_releases_keep_current_and_previous_and_remove_both_alias_sets():
    metadata, images = complete_fixture()
    plan = cleanup.plan_retention(metadata, images, RELEASES[3], COMMITS[RELEASES[3]])

    assert plan.retained == (RELEASES[3], RELEASES[2])
    assert [item["release"] for item in plan.deleting] == RELEASES[:2]
    removed_tags = {tag for item in plan.deleting for tag in item["tags"]}
    assert {RELEASES[0], f"{RELEASES[0]}-migration"} <= removed_tags
    assert {f"sha-{COMMITS[RELEASES[0]]}", f"sha-{COMMITS[RELEASES[0]]}-migration"} <= removed_tags
    assert {RELEASES[1], f"{RELEASES[1]}-migration"} <= removed_tags


def test_no_complete_prior_release_is_safe():
    metadata, images = complete_fixture([RELEASES[2], RELEASES[3]])
    images = [image for image in images if image["tag"] != f"{RELEASES[2]}-migration"]
    plan = cleanup.plan_retention(metadata, images, RELEASES[3], COMMITS[RELEASES[3]])
    assert not plan.deleting
    assert any(item["release"] == RELEASES[2] for item in plan.protected)


def test_rollback_keeps_current_and_previous_older_pairs_and_leaves_newer_untouched():
    metadata, images = complete_fixture()
    plan = cleanup.plan_retention(metadata, images, RELEASES[1], COMMITS[RELEASES[1]])
    assert plan.retained == (RELEASES[1], RELEASES[0])
    assert plan.newer == (RELEASES[3], RELEASES[2])
    assert not plan.deleting


def test_images_referenced_by_any_container_are_not_selected():
    metadata, images = complete_fixture()
    plan = cleanup.plan_retention(
        metadata, images, RELEASES[3], COMMITS[RELEASES[3]],
        container_image_ids={"runtime-image-0"},
    )
    assert RELEASES[0] not in {item["release"] for item in plan.deleting}
    assert any(item["release"] == RELEASES[0] and "container" in item["reason"] for item in plan.protected)
    assert RELEASES[1] in {item["release"] for item in plan.deleting}


def test_current_pair_remains_retained_when_its_images_are_in_use():
    metadata, images = complete_fixture()
    plan = cleanup.plan_retention(
        metadata, images, RELEASES[3], COMMITS[RELEASES[3]],
        container_image_ids={"runtime-image-3", "migration-image-3"},
    )
    assert RELEASES[3] in plan.retained
    assert RELEASES[3] not in {item["release"] for item in plan.deleting}


def test_sha_only_images_without_release_identity_are_preserved():
    metadata, images = complete_fixture([RELEASES[3]])
    unknown_sha = "f" * 40
    images.extend([
        {"repository": REPOSITORY, "tag": f"sha-{unknown_sha}", "id": "old-runtime", "revision": unknown_sha},
        {"repository": REPOSITORY, "tag": f"sha-{unknown_sha}-migration", "id": "old-migration", "revision": unknown_sha},
    ])
    plan = cleanup.plan_retention(metadata, images, RELEASES[3], COMMITS[RELEASES[3]])
    assert not plan.deleting
    assert sum(item["release"] == "unmapped SHA-only image" for item in plan.protected) == 2


def test_incomplete_or_revision_mismatched_pair_is_preserved():
    metadata, images = complete_fixture()
    images = [image for image in images if image["tag"] != f"{RELEASES[0]}-migration"]
    plan = cleanup.plan_retention(metadata, images, RELEASES[3], COMMITS[RELEASES[3]])
    assert RELEASES[0] not in {item["release"] for item in plan.deleting}
    assert any(item["release"] == RELEASES[0] for item in plan.protected)

    metadata, images = complete_fixture()
    next(image for image in images if image["tag"] == RELEASES[0])["revision"] = "e" * 40
    plan = cleanup.plan_retention(metadata, images, RELEASES[3], COMMITS[RELEASES[3]])
    assert RELEASES[0] not in {item["release"] for item in plan.deleting}


def test_other_repositories_are_never_selected():
    metadata, images = complete_fixture()
    images.extend([
        {"repository": "ghcr.io/armin-salihovic/elecparts", "tag": "v9.9.9", "id": "elecparts", "revision": "a" * 40},
        {"repository": "postgres", "tag": "17-alpine", "id": "postgres", "revision": "b" * 40},
    ])
    plan = cleanup.plan_retention(metadata, images, RELEASES[3], COMMITS[RELEASES[3]])
    selected = " ".join(tag for item in plan.deleting for tag in item["tags"])
    assert "elecparts" not in selected
    assert "postgres" not in selected
    assert all(tag in {image["tag"] for image in images if image["repository"] == REPOSITORY}
               for item in plan.deleting for tag in item["tags"])


def test_unknown_project_tag_causes_a_global_safe_skip():
    metadata, images = complete_fixture()
    images.append({"repository": REPOSITORY, "tag": "latest", "id": "unknown", "revision": "c" * 40})
    plan = cleanup.plan_retention(metadata, images, RELEASES[3], COMMITS[RELEASES[3]])
    assert plan.reason and "unexpected" in plan.reason
    assert not plan.deleting


@pytest.mark.parametrize("raw", ["0", "1", "2.5", "abc", "-2", " 3"])
def test_malformed_retention_is_warning_only_and_does_not_call_docker(raw, monkeypatch, capsys):
    monkeypatch.setenv("VAPOURDB_IMAGE_RETENTION", raw)
    monkeypatch.setattr(cleanup, "_docker", lambda _args: pytest.fail("Docker must not run"))
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), RELEASES[3], COMMITS[RELEASES[3]]])

    assert cleanup.main() == 0
    assert "WARNING: VPS image cleanup skipped safely" in capsys.readouterr().err


def test_deletion_failure_is_warning_only(monkeypatch, capsys):
    metadata, images = complete_fixture()
    plan = cleanup.plan_retention(metadata, images, RELEASES[3], COMMITS[RELEASES[3]])
    calls = []

    def fail_remove(args):
        calls.append(args)
        raise RuntimeError("simulated Docker error")

    monkeypatch.setattr(cleanup, "_docker", fail_remove)
    warnings = cleanup._apply_deletions(plan)
    assert warnings
    assert calls
    assert all(call[:3] == ["image", "rm", f"{REPOSITORY}:{call[2].split(':')[-1]}"] for call in calls)
    assert "WARNING: Could not remove" in capsys.readouterr().err


def test_test_plan_mode_uses_a_temporary_fixture_and_never_mutates_docker(tmp_path, monkeypatch, capsys):
    metadata, images = complete_fixture()
    fixture = {
        "metadata": metadata,
        "images": images,
        "current_release": RELEASES[3],
        "current_revision": COMMITS[RELEASES[3]],
        "retention": 2,
    }
    fixture_path = tmp_path / "images.json"
    fixture_path.write_text(json.dumps(fixture), encoding="utf-8")
    before = fixture_path.read_bytes()
    monkeypatch.setattr(sys, "argv", [str(SCRIPT), "--test-plan", str(fixture_path)])
    monkeypatch.setattr(cleanup, "_docker", lambda _args: pytest.fail("test-plan must not invoke Docker"))

    assert cleanup.main() == 0
    result = json.loads(capsys.readouterr().out)
    assert [item["release"] for item in result["deleting"]] == RELEASES[:2]
    assert fixture_path.read_bytes() == before


def test_metadata_is_written_atomically_with_restricted_mode(tmp_path):
    path = tmp_path / "retention-releases.tsv"
    cleanup._store_metadata(path, {RELEASES[0]: COMMITS[RELEASES[0]]})
    assert cleanup._load_metadata(path) == {RELEASES[0]: COMMITS[RELEASES[0]]}
    if os.name != "nt":
        assert path.stat().st_mode & 0o777 == 0o600


def test_shared_sha_alias_is_kept_when_another_release_uses_it():
    same_sha = "a" * 40
    metadata = {
        RELEASES[0]: same_sha,
        RELEASES[1]: same_sha,
        RELEASES[3]: COMMITS[RELEASES[3]],
    }
    images = []
    for index, release in enumerate((RELEASES[0], RELEASES[1], RELEASES[3])):
        revision = metadata[release]
        shared = index < 2
        runtime_id = "runtime-shared" if shared else f"runtime-{index}"
        migration_id = "migration-shared" if shared else f"migration-{index}"
        images.extend([
            {"repository": REPOSITORY, "tag": release, "id": runtime_id, "revision": revision},
            {"repository": REPOSITORY, "tag": f"{release}-migration", "id": migration_id, "revision": revision},
        ])
        if index == 0 or not shared:
            images.extend([
                {"repository": REPOSITORY, "tag": f"sha-{revision}", "id": runtime_id, "revision": revision},
                {"repository": REPOSITORY, "tag": f"sha-{revision}-migration", "id": migration_id, "revision": revision},
            ])
    plan = cleanup.plan_retention(metadata, images, RELEASES[3], COMMITS[RELEASES[3]])
    removed_tags = {tag for item in plan.deleting for tag in item["tags"]}
    assert RELEASES[0] in removed_tags
    assert f"{RELEASES[0]}-migration" in removed_tags
    assert f"sha-{same_sha}" not in removed_tags
    assert f"sha-{same_sha}-migration" not in removed_tags


def test_shared_sha_alias_is_scheduled_once_when_all_associated_releases_are_obsolete():
    same_sha = "a" * 40
    metadata = {tag: (same_sha if index < 2 else COMMITS[tag]) for index, tag in enumerate(RELEASES)}
    images = []
    for index, release in enumerate(RELEASES):
        revision = metadata[release]
        shared = index < 2
        runtime_id = "runtime-shared" if shared else f"runtime-{index}"
        migration_id = "migration-shared" if shared else f"migration-{index}"
        images.extend([
            {"repository": REPOSITORY, "tag": release, "id": runtime_id, "revision": revision},
            {"repository": REPOSITORY, "tag": f"{release}-migration", "id": migration_id, "revision": revision},
        ])
        if index == 0 or not shared:
            images.extend([
                {"repository": REPOSITORY, "tag": f"sha-{revision}", "id": runtime_id, "revision": revision},
                {"repository": REPOSITORY, "tag": f"sha-{revision}-migration", "id": migration_id, "revision": revision},
            ])
    plan = cleanup.plan_retention(metadata, images, RELEASES[3], COMMITS[RELEASES[3]])
    removed_tags = [tag for item in plan.deleting for tag in item["tags"]]
    assert removed_tags.count(f"sha-{same_sha}") == 1
    assert removed_tags.count(f"sha-{same_sha}-migration") == 1

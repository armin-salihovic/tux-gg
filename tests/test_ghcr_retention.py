"""Offline tests for the VapourDB GHCR package-version retention selector."""

from __future__ import annotations

import importlib.util
import pathlib
import sys
from unittest.mock import patch

import pytest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "deploy" / "production" / "cleanup-ghcr.py"
SPEC = importlib.util.spec_from_file_location("vapourdb_cleanup_ghcr", SCRIPT)
assert SPEC and SPEC.loader
cleanup = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = cleanup
SPEC.loader.exec_module(cleanup)


RELEASES = [f"v1.0.{number}" for number in range(7)]
COMMITS = {tag: f"{number + 1:040x}" for number, tag in enumerate(RELEASES)}


def version(version_id: int, *tags: str) -> dict:
    return {"id": version_id, "metadata": {"container": {"tags": list(tags)}}}


def package_versions(releases: list[str] = RELEASES, separate_aliases: bool = False) -> list[dict]:
    result: list[dict] = []
    next_id = 1
    for release in releases:
        sha = COMMITS[release]
        pairs = [
            (release, f"sha-{sha}"),
            (f"{release}-migration", f"sha-{sha}-migration"),
        ]
        for tags in pairs:
            if separate_aliases:
                for tag in tags:
                    result.append(version(next_id, tag))
                    next_id += 1
            else:
                result.append(version(next_id, *tags))
                next_id += 1
    return result


def deleted_ids(plan) -> set[int]:
    return {item["id"] for item in plan.deleting}


def test_seven_releases_keep_five_complete_runtime_and_migration_pairs():
    versions = package_versions()
    plan = cleanup.plan_retention(versions, COMMITS, RELEASES[-1])

    assert plan.retained == tuple(reversed(RELEASES[-5:]))
    assert deleted_ids(plan) == {1, 2, 3, 4}
    removed_tags = {tag for item in plan.deleting for tag in item["tags"]}
    assert {RELEASES[0], f"{RELEASES[0]}-migration"} <= removed_tags
    assert {f"sha-{COMMITS[RELEASES[0]]}", f"sha-{COMMITS[RELEASES[0]]}-migration"} <= removed_tags
    assert {RELEASES[1], f"{RELEASES[1]}-migration"} <= removed_tags


def test_untagged_version_is_protected_without_blocking_obsolete_pair_deletion():
    versions = package_versions()
    versions.append(version(999))
    plan = cleanup.plan_retention(versions, COMMITS, RELEASES[-1])

    assert plan.retained == tuple(reversed(RELEASES[-5:]))
    assert deleted_ids(plan) == {1, 2, 3, 4}
    assert 999 not in deleted_ids(plan)
    assert any(
        item["id"] == 999
        and item["tags"] == []
        and item["reason"] == "untagged package version"
        for item in plan.protected
    )
    deleted_tags = {tag for item in plan.deleting for tag in item["tags"]}
    assert {
        RELEASES[0],
        f"sha-{COMMITS[RELEASES[0]]}",
        f"{RELEASES[0]}-migration",
        f"sha-{COMMITS[RELEASES[0]]}-migration",
        RELEASES[1],
        f"sha-{COMMITS[RELEASES[1]]}",
        f"{RELEASES[1]}-migration",
        f"sha-{COMMITS[RELEASES[1]]}-migration",
    } == deleted_tags


def test_fewer_than_five_complete_pairs_are_not_deleted():
    releases = RELEASES[:3]
    plan = cleanup.plan_retention(package_versions(releases), COMMITS, releases[-1])
    assert not plan.deleting
    assert len(plan.retained) == 3


def test_current_release_is_protected_even_when_deploying_an_older_rollback():
    versions = package_versions()
    plan = cleanup.plan_retention(versions, COMMITS, RELEASES[0], retention=1)
    assert RELEASES[0] in plan.retained
    assert 1 not in deleted_ids(plan)
    assert 2 not in deleted_ids(plan)


def test_prerelease_semantic_ordering_is_used():
    releases = ["v2.0.0-alpha.2", "v2.0.0-alpha.10", "v2.0.0-beta.1", "v2.0.0", "v1.99.0"]
    commits = {tag: f"{number + 20:040x}" for number, tag in enumerate(releases)}
    versions = []
    for index, tag in enumerate(releases):
        sha = commits[tag]
        versions.extend((version(index * 2 + 1, tag, f"sha-{sha}"),
                         version(index * 2 + 2, f"{tag}-migration", f"sha-{sha}-migration")))
    plan = cleanup.plan_retention(versions, commits, "v2.0.0", retention=3)
    assert plan.retained == ("v2.0.0", "v2.0.0-beta.1", "v2.0.0-alpha.10")
    assert {item["id"] for item in plan.deleting} == {1, 2, 9, 10}


def test_independent_runtime_migration_and_sha_package_version_records_are_supported():
    versions = package_versions(separate_aliases=True)
    plan = cleanup.plan_retention(versions, COMMITS, RELEASES[-1])
    assert deleted_ids(plan) == {1, 2, 3, 4, 5, 6, 7, 8}
    deleted_tags = {tag for item in plan.deleting for tag in item["tags"]}
    assert {RELEASES[0], f"{RELEASES[0]}-migration"} <= deleted_tags
    assert {f"sha-{COMMITS[RELEASES[0]]}", f"sha-{COMMITS[RELEASES[0]]}-migration"} <= deleted_tags


def test_unmapped_sha_only_package_version_is_protected():
    versions = package_versions()
    versions.append(version(900, "sha-" + "f" * 40))
    plan = cleanup.plan_retention(versions, COMMITS, RELEASES[-1])
    assert 900 not in deleted_ids(plan)
    assert any(item["id"] == 900 and "unmapped" in item["reason"] for item in plan.protected)


def test_unknown_and_malformed_tags_protect_their_entire_obsolete_release_pair():
    versions = package_versions()
    versions[0]["metadata"]["container"]["tags"].append("nightly")
    versions.append(version(901, "sha-not-a-full-commit"))
    plan = cleanup.plan_retention(versions, COMMITS, RELEASES[-1])
    assert not ({1, 2} & deleted_ids(plan))
    assert 901 not in deleted_ids(plan)
    assert any(item["id"] == 1 and "unknown" in item["reason"] for item in plan.protected)


def test_ambiguous_sha_aliases_protect_every_release_that_shares_the_commit():
    commits = dict(COMMITS)
    commits[RELEASES[1]] = commits[RELEASES[0]]
    plan = cleanup.plan_retention(package_versions(), commits, RELEASES[-1])
    assert not ({1, 2, 3, 4} & deleted_ids(plan))


def test_mixed_current_and_obsolete_package_version_fails_closed():
    versions = package_versions()
    current_app = versions[-2]
    versions[0]["metadata"]["container"]["tags"].extend(
        current_app["metadata"]["container"]["tags"]
    )
    versions.remove(current_app)
    plan = cleanup.plan_retention(versions, COMMITS, RELEASES[-1])
    assert not plan.deleting
    assert plan.reason


def test_duplicate_tag_versions_are_protected():
    versions = package_versions()
    versions.append(version(902, RELEASES[0]))
    plan = cleanup.plan_retention(versions, COMMITS, RELEASES[-1])
    assert not ({1, 2, 902} & deleted_ids(plan))
    assert any(item["id"] == 902 and "duplicate" in item["reason"] for item in plan.protected)


def test_missing_current_release_and_incomplete_metadata_fail_closed():
    missing = cleanup.plan_retention(package_versions(), COMMITS, "v9.0.0")
    assert missing.reason
    assert not missing.deleting

    malformed = package_versions() + [{"id": 950, "metadata": {"container": {}}}]
    plan = cleanup.plan_retention(malformed, COMMITS, RELEASES[-1])
    assert plan.reason
    assert not plan.deleting


@pytest.mark.parametrize(
    "metadata",
    [
        {"container": {}},
        {"container": {"tags": None}},
        {"container": {"tags": "v1.0.0"}},
        {"container": {"tags": [None]}},
    ],
    ids=["missing-tags", "none-tags", "non-list-tags", "non-string-tag"],
)
def test_missing_or_invalid_tag_field_fails_closed(metadata):
    versions = package_versions() + [{"id": 950, "metadata": metadata}]
    plan = cleanup.plan_retention(versions, COMMITS, RELEASES[-1])

    assert plan.reason
    assert not plan.deleting
    assert any(item["id"] == 950 for item in plan.protected)


@pytest.mark.parametrize("invalid_id", [0, 1])
def test_untagged_version_with_invalid_or_duplicate_id_fails_closed(invalid_id):
    versions = package_versions() + [version(invalid_id)]
    plan = cleanup.plan_retention(versions, COMMITS, RELEASES[-1])

    assert plan.reason
    assert not plan.deleting
    assert any(
        item["tags"] == []
        and item["reason"] == "missing, duplicate, or malformed package-version metadata"
        for item in plan.protected
    )


def test_release_tag_matcher_does_not_widen_the_workflow_ascii_grammar():
    assert cleanup.RELEASE_RE.fullmatch("v١.0.0") is None
    assert cleanup.RELEASE_RE.fullmatch("v1.0.0+build.1") is None


def test_ghcr_api_permission_failure_is_warning_only(monkeypatch, capsys):
    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    monkeypatch.setenv("CURRENT_RELEASE", RELEASES[-1])
    monkeypatch.setattr(cleanup, "_list_versions", lambda _token: (_ for _ in ()).throw(PermissionError("403")))

    assert cleanup.main() == 0
    assert "WARNING: GHCR cleanup failed safely" in capsys.readouterr().err


@pytest.mark.parametrize("raw", ["", "0", "-1", "1.5", "five", " 5"])
def test_invalid_ghcr_retention_is_warning_only_and_skips_api(monkeypatch, capsys, raw):
    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    monkeypatch.setenv("CURRENT_RELEASE", RELEASES[-1])
    monkeypatch.setenv("GHCR_RETENTION", raw)
    monkeypatch.setattr(cleanup, "_list_versions", lambda _token: pytest.fail("API must not be called"))

    assert cleanup.main() == 0
    assert "GHCR_RETENTION must be a positive integer" in capsys.readouterr().err


def test_ghcr_delete_failures_are_warning_only_and_paths_stay_package_scoped(monkeypatch, capsys):
    calls = []

    def request(path, _token, method="GET"):
        calls.append((path, method))
        if method == "DELETE":
            raise PermissionError("403")
        return None, None

    monkeypatch.setenv("GITHUB_TOKEN", "test-token")
    monkeypatch.setenv("CURRENT_RELEASE", RELEASES[-1])
    monkeypatch.setenv("GHCR_RETENTION", "5")
    monkeypatch.setattr(cleanup, "_list_versions", lambda _token: package_versions())
    monkeypatch.setattr(cleanup, "_release_commits", lambda: COMMITS)
    monkeypatch.setattr(cleanup, "_github_request", request)

    assert cleanup.main() == 0
    assert calls
    assert all(path.startswith("/users/armin-salihovic/packages/container/vapourdb/versions/") for path, _ in calls)
    assert all(method == "DELETE" for _, method in calls)
    assert "WARNING: Could not delete GHCR package version" in capsys.readouterr().err


def test_api_path_guard_rejects_other_packages_without_network_access():
    assert cleanup.OWNER == "armin-salihovic"
    assert cleanup.PACKAGE == "vapourdb"
    with patch.object(cleanup.urllib.request, "urlopen", side_effect=AssertionError("network must not be used")):
        with pytest.raises(ValueError):
            cleanup._github_request("/users/armin-salihovic/packages/container/elecparts/versions", "token")
        with pytest.raises(ValueError):
            cleanup._github_request(cleanup.VERSIONS_PATH, "token", "DELETE")
        with pytest.raises(ValueError):
            cleanup._github_request(f"{cleanup.VERSIONS_PATH}/1", "token", "GET")


def test_version_listing_uses_only_the_exact_vapourdb_versions_endpoint(monkeypatch):
    calls = []

    def list_page(path, _token, method="GET"):
        calls.append((path, method))
        return [], None

    monkeypatch.setattr(cleanup, "_github_request", list_page)
    assert cleanup._list_versions("test-token") == []
    assert calls == [("/users/armin-salihovic/packages/container/vapourdb/versions?per_page=100&page=1", "GET")]

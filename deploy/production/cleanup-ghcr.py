#!/usr/bin/env python3
"""Safely retain complete VapourDB runtime and migration releases in GHCR."""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request
from dataclasses import dataclass
from functools import cmp_to_key
from typing import Any

OWNER = "armin-salihovic"
PACKAGE = "vapourdb"
API = "https://api.github.com"
# Keep this grammar in sync with release-production.yml. Do not broaden the
# immutable release-tag contract here.
RELEASE_RE = re.compile(
    r"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z.-]+))?$"
)
SHA_RE = re.compile(r"^sha-([0-9a-f]{40})(-migration)?$")
VERSIONS_PATH = f"/users/{OWNER}/packages/container/{PACKAGE}/versions"


@dataclass(frozen=True)
class Plan:
    retained: tuple[str, ...]
    deleting: tuple[dict[str, Any], ...]
    protected: tuple[dict[str, Any], ...]
    reason: str | None = None


def _semver(tag: str) -> tuple[Any, ...] | None:
    """Return SemVer precedence fields for tags accepted by the release regex."""
    match = RELEASE_RE.fullmatch(tag)
    if not match:
        return None
    major, minor, patch, prerelease = match.groups()
    identifiers: list[tuple[int, Any]] = []
    if prerelease:
        for item in prerelease.split("."):
            if not item:
                return None
            if item.isdigit():
                if len(item) > 1 and item.startswith("0"):
                    # The existing workflow regex permits this; semver order is
                    # undefined for it, so callers fail closed rather than guess.
                    return None
                identifiers.append((0, int(item)))
            else:
                identifiers.append((1, item))
    return int(major), int(minor), int(patch), prerelease is None, tuple(identifiers)


def _compare(left: str, right: str) -> int:
    a, b = _semver(left), _semver(right)
    assert a is not None and b is not None
    for x, y in zip(a[:3], b[:3]):
        if x != y:
            return -1 if x < y else 1
    if a[3] != b[3]:
        return 1 if a[3] else -1
    for x, y in zip(a[4], b[4]):
        if x != y:
            if x[0] != y[0]:
                return -1 if x[0] < y[0] else 1
            return -1 if x[1] < y[1] else 1
    return (len(a[4]) > len(b[4])) - (len(a[4]) < len(b[4]))


def _tag_identity(tag: str, release_commits: dict[str, str]) -> tuple[str, str] | None:
    """Map a tag to (release, role); None means unknown or ambiguous."""
    sha_match = SHA_RE.fullmatch(tag)
    if sha_match:
        commit, migration = sha_match.groups()
        matches = [release for release, sha in release_commits.items() if sha == commit]
        if len(matches) == 1:
            return matches[0], "migration" if migration else "runtime"
        return None

    if not RELEASE_RE.fullmatch(tag):
        return None

    parent = tag.removesuffix("-migration") if tag.endswith("-migration") else None
    is_release = tag in release_commits
    is_migration = parent in release_commits if parent else False
    if is_release and is_migration:
        return None
    if is_migration and parent is not None:
        return parent, "migration"
    if is_release:
        return tag, "runtime"
    # A migration tag may refer to a release whose git tag is unavailable. It
    # cannot be safely distinguished from a valid release tag ending in this
    # suffix, so it remains unknown and protected.
    return None


def plan_retention(
    versions: list[dict[str, Any]],
    release_commits: dict[str, str],
    current_release: str,
    retention: int = 5,
) -> Plan:
    """Select package versions whose complete release pair is provably obsolete."""
    if retention < 1 or _semver(current_release) is None:
        return Plan((), (), tuple({**v, "reason": "invalid retention or current release"} for v in versions),
                    "invalid retention count or current release")
    if current_release not in release_commits:
        return Plan((), (), tuple({**v, "reason": "current release has no checked-out Git tag"} for v in versions),
                    "current release is missing from checked-out Git tags")
    if any(_semver(tag) is None for tag in release_commits):
        return Plan((), (), tuple({**v, "reason": "release tag cannot be semantically ordered"} for v in versions),
                    "a checked-out release tag has ambiguous semver precedence")

    normalized_commits = {tag: sha.lower() for tag, sha in release_commits.items()}
    if any(not re.fullmatch(r"[0-9a-f]{40}", sha) for sha in normalized_commits.values()):
        return Plan((), (), tuple({**v, "reason": "invalid release commit metadata"} for v in versions),
                    "release commit metadata is incomplete")

    records: list[tuple[dict[str, Any], list[str], set[str], bool]] = []
    tag_owners: dict[str, list[int]] = {}
    ids: set[int] = set()
    malformed = False
    for index, version in enumerate(versions):
        metadata = version.get("metadata")
        container = metadata.get("container") if isinstance(metadata, dict) else None
        tags = container.get("tags") if isinstance(container, dict) else None
        version_id = version.get("id")
        valid = (
            isinstance(version_id, int)
            and not isinstance(version_id, bool)
            and version_id > 0
            and isinstance(tags, list)
            and all(isinstance(tag, str) for tag in tags)
            and len(tags) == len(set(tags))
            and version_id not in ids
        )
        if not valid:
            malformed = True
            clean_tags = tags if isinstance(tags, list) and all(isinstance(tag, str) for tag in tags) else []
            records.append((version, clean_tags, set(), False))
            continue
        ids.add(version_id)
        clean_tags = list(tags)
        records.append((version, clean_tags, set(), True))
        for tag in clean_tags:
            tag_owners.setdefault(tag, []).append(index)

    if malformed:
        protected = tuple(
            {
                "id": version.get("id"),
                "tags": sorted(tags),
                "reason": (
                    "untagged package version"
                    if valid and not tags
                    else "missing, duplicate, or malformed package-version metadata"
                ),
            }
            for version, tags, _associated, valid in records
        )
        return Plan((), (), protected, "package-version metadata is incomplete or duplicated")

    commit_releases: dict[str, list[str]] = {}
    for release, sha in normalized_commits.items():
        commit_releases.setdefault(sha, []).append(release)

    record_identities: list[set[str]] = []
    record_reasons: list[str | None] = []
    tainted_releases: set[str] = set()
    for index, (_version, tags, _associated, _valid) in enumerate(records):
        identities: set[str] = set()
        roles: set[tuple[str, str]] = set()
        reason: str | None = "untagged package version" if not tags else None
        for tag in tags:
            identity = _tag_identity(tag, normalized_commits)
            if identity is None:
                reason = "unknown, unmapped, malformed, or ambiguous tag"
                sha_match = SHA_RE.fullmatch(tag)
                if sha_match:
                    possible = commit_releases.get(sha_match.group(1), [])
                    identities.update(possible)
                    if len(possible) > 1:
                        reason = "ambiguous SHA tag maps to multiple releases"
                elif tag.endswith("-migration"):
                    parent = tag.removesuffix("-migration")
                    if parent in normalized_commits:
                        identities.add(parent)
                if RELEASE_RE.fullmatch(tag) and tag in normalized_commits:
                    identities.add(tag)
                continue
            release, role = identity
            identities.add(release)
            roles.add((release, role))

        if any(len(owners) != 1 for tag in tags for owners in [tag_owners[tag]]):
            reason = "duplicate tag appears on multiple package versions"
        if len(identities) > 1:
            reason = "package version mixes tags from multiple releases"
        if reason:
            tainted_releases.update(identities)
        record_identities.append(identities)
        record_reasons.append(reason)

    # A release pair requires all four immutable names. They may be co-located
    # in two package versions or live in four independent package versions.
    observed_release_tags = {
        release
        for identities in record_identities
        for release in identities
    }
    complete: set[str] = set()
    incomplete_reasons: dict[str, str] = {}
    for release in observed_release_tags | {current_release}:
        sha = normalized_commits.get(release)
        if not sha:
            incomplete_reasons[release] = "release has no full-SHA Git mapping"
            continue
        expected = {
            release: (release, "runtime"),
            f"{release}-migration": (release, "migration"),
            f"sha-{sha}": (release, "runtime"),
            f"sha-{sha}-migration": (release, "migration"),
        }
        good = True
        for tag, identity in expected.items():
            owners = tag_owners.get(tag, [])
            if len(owners) != 1:
                good = False
                break
            if _tag_identity(tag, normalized_commits) != identity:
                good = False
                break
        if good and release not in tainted_releases:
            complete.add(release)
        else:
            incomplete_reasons[release] = (
                "release pair contains unknown, duplicate, mixed, or ambiguous tags"
                if release in tainted_releases
                else "runtime, migration, or full-SHA alias is missing"
            )

    if current_release not in complete:
        protected = tuple(
            {"id": version.get("id"), "tags": sorted(tags), "reason": record_reasons[i] or "current or uncertain release"}
            for i, (version, tags, _associated, _valid) in enumerate(records)
        )
        return Plan((), (), protected, "current release does not have an unambiguous complete image pair")

    ordered = sorted(complete, key=cmp_to_key(_compare), reverse=True)
    retained_set = set(ordered[:retention]) | {current_release}
    deleting_releases = complete - retained_set

    deleting: list[dict[str, Any]] = []
    protected: list[dict[str, Any]] = []
    for index, (version, tags, _associated, _valid) in enumerate(records):
        identities = record_identities[index]
        reason = record_reasons[index]
        item = {"id": version["id"], "tags": sorted(tags)}
        if reason:
            protected.append({**item, "reason": reason})
        elif len(identities) == 1 and next(iter(identities)) in deleting_releases:
            deleting.append(item)
        else:
            release = next(iter(identities)) if len(identities) == 1 else None
            detail = incomplete_reasons.get(release or "", "retained, unmapped, or unrecognized release tag")
            protected.append({**item, "reason": detail})

    retained = tuple(sorted(retained_set, key=cmp_to_key(_compare), reverse=True))
    return Plan(retained, tuple(deleting), tuple(protected))


def _github_request(path: str, token: str, method: str = "GET") -> tuple[Any, str | None]:
    # Accept only this package's version collection or a numeric version ID.
    allowed_collection = path == VERSIONS_PATH or bool(
        re.fullmatch(re.escape(VERSIONS_PATH) + r"\?per_page=100&page=[1-9][0-9]*", path)
    )
    allowed_version = bool(re.fullmatch(re.escape(VERSIONS_PATH) + r"/[0-9]+", path))
    if (method == "GET" and not allowed_collection) or (method == "DELETE" and not allowed_version) or method not in {"GET", "DELETE"}:
        raise ValueError("refusing a GHCR API path outside the exact VapourDB package")
    request = urllib.request.Request(
        f"{API}{path}",
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "vapourdb-ghcr-retention",
        },
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        body = response.read()
    return (json.loads(body) if body else None), None


def _list_versions(token: str) -> list[dict[str, Any]]:
    versions: list[dict[str, Any]] = []
    page = 1
    while True:
        result, _ = _github_request(f"{VERSIONS_PATH}?per_page=100&page={page}", token)
        if not isinstance(result, list):
            raise RuntimeError("GHCR returned an unexpected package-version response")
        versions.extend(result)
        if len(result) < 100:
            return versions
        page += 1


def _release_commits() -> dict[str, str]:
    output = subprocess.check_output(
        ["git", "for-each-ref", "--format=%(refname:short)", "refs/tags"], text=True
    )
    commits: dict[str, str] = {}
    for tag in output.splitlines():
        if not RELEASE_RE.fullmatch(tag):
            continue
        try:
            commit = subprocess.check_output(
                ["git", "rev-parse", f"refs/tags/{tag}^{{commit}}"],
                text=True,
                stderr=subprocess.DEVNULL,
            ).strip().lower()
        except subprocess.CalledProcessError:
            continue
        if re.fullmatch(r"[0-9a-f]{40}", commit):
            commits[tag] = commit
    return commits


def _retention_count() -> int:
    raw = os.environ.get("GHCR_RETENTION", "5")
    if not raw.isascii() or not raw.isdigit() or int(raw) < 1:
        raise ValueError("GHCR_RETENTION must be a positive integer")
    return int(raw)


def main() -> int:
    token = os.environ.get("GITHUB_TOKEN", "")
    current = os.environ.get("CURRENT_RELEASE", "")
    if not token or not current:
        print("WARNING: GHCR cleanup skipped: required token or current release is missing.", file=sys.stderr)
        return 0
    try:
        count = _retention_count()
        versions = _list_versions(token)
        commits = _release_commits()
        plan = plan_retention(versions, commits, current, count)
        print("GHCR image retention:")
        print(f"  Package: ghcr.io/{OWNER}/{PACKAGE}")
        print(f"  Retention count: {count}")
        print(f"  Current release: {current}")
        print("  Retained releases:")
        for tag in plan.retained:
            print(f"    {tag}{' (current)' if tag == current else ''}")
        print("  Planned package-version deletions:")
        for item in plan.deleting:
            print(f"    version id={item['id']} tags={','.join(item['tags'])}")
        print("  Protected package versions:")
        for item in plan.protected:
            print(f"    version id={item.get('id')} tags={','.join(item['tags'])} ({item['reason']})")
        if plan.reason:
            print(f"WARNING: No GHCR versions will be deleted: {plan.reason}", file=sys.stderr)
            return 0

        for item in plan.deleting:
            try:
                _github_request(f"{VERSIONS_PATH}/{item['id']}", token, "DELETE")
                print(f"Deleted GHCR package version id={item['id']} tags={','.join(item['tags'])}")
            except Exception as error:
                print(
                    f"WARNING: Could not delete GHCR package version id={item['id']} "
                    f"tags={','.join(item['tags'])}: {error}",
                    file=sys.stderr,
                )
        return 0
    except Exception as error:  # Cleanup is deliberately best-effort post-deployment.
        print(f"WARNING: GHCR cleanup failed safely: {error}", file=sys.stderr)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

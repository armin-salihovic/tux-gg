#!/usr/bin/env python3
"""Best-effort, VapourDB-only retention of proven local image release pairs."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from functools import cmp_to_key
from pathlib import Path
from typing import Any

IMAGE_REPOSITORY = "ghcr.io/armin-salihovic/vapourdb"
RELEASE_RE = re.compile(
    r"^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)"
    r"(?:-([0-9A-Za-z.-]+))?$"
)
SHA_TAG_RE = re.compile(r"^sha-([0-9a-f]{40})(-migration)?$")
REVISION_RE = re.compile(r"^[0-9a-f]{40}$")


@dataclass(frozen=True)
class Plan:
    retained: tuple[str, ...]
    newer: tuple[str, ...]
    deleting: tuple[dict[str, Any], ...]
    protected: tuple[dict[str, Any], ...]
    reason: str | None = None


def _semver(tag: str) -> tuple[Any, ...] | None:
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


def _release_tags(release: str, revision: str) -> tuple[str, str, str, str]:
    return (
        release,
        f"{release}-migration",
        f"sha-{revision}",
        f"sha-{revision}-migration",
    )


def _alias_index(metadata: dict[str, str]) -> dict[str, set[tuple[str, str]]]:
    aliases: dict[str, set[tuple[str, str]]] = {}
    for release, revision in metadata.items():
        for tag, role in zip(_release_tags(release, revision), ("runtime", "migration", "runtime", "migration")):
            identity = (release, role)
            existing = aliases.get(tag, set())
            if existing and identity not in existing:
                shared_sha_alias = bool(SHA_TAG_RE.fullmatch(tag)) and all(
                    previous[1] == role for previous in existing
                )
                if not shared_sha_alias:
                    raise ValueError(f"ambiguous local image tag {tag}")
            aliases.setdefault(tag, set()).add(identity)
    return aliases


def plan_retention(
    metadata: dict[str, str],
    images: list[dict[str, str]],
    current_release: str,
    current_revision: str,
    retention: int = 2,
    container_image_ids: set[str] | None = None,
) -> Plan:
    """Return a deletion plan only for complete, mapped VapourDB release pairs."""
    container_image_ids = container_image_ids or set()
    if retention < 2 or not isinstance(retention, int):
        return Plan((), (), (), (), "VAPOURDB_IMAGE_RETENTION must be an integer of at least 2")
    if _semver(current_release) is None or not REVISION_RE.fullmatch(current_revision):
        return Plan((), (), (), (), "invalid current release or full commit SHA")
    if any(_semver(tag) is None or not REVISION_RE.fullmatch(sha) for tag, sha in metadata.items()):
        return Plan((), (), (), (), "release metadata is malformed or cannot be ordered")
    if metadata.get(current_release) != current_revision:
        return Plan((), (), (), (), "current release is not proven by local deployment metadata")

    try:
        aliases = _alias_index(metadata)
    except ValueError as error:
        return Plan((), (), (), (), str(error))

    by_tag: dict[str, dict[str, str]] = {}
    unexpected: list[str] = []
    for image in images:
        repository = image.get("repository")
        if repository != IMAGE_REPOSITORY:
            continue
        tag = image.get("tag", "")
        if tag in by_tag:
            return Plan((), (), (), (), f"duplicate local VapourDB image tag {tag}")
        by_tag[tag] = image
        if tag not in aliases and not SHA_TAG_RE.fullmatch(tag):
            unexpected.append(tag)
    if unexpected:
        return Plan((), (), (), (), "unexpected VapourDB image tags: " + ", ".join(sorted(unexpected)))

    complete: dict[str, tuple[dict[str, str], ...]] = {}
    protected: list[dict[str, Any]] = []
    for release, revision in metadata.items():
        expected_tags = _release_tags(release, revision)
        pair = tuple(by_tag.get(tag) for tag in expected_tags)
        reason: str | None = None
        if any(image is None for image in pair):
            reason = "incomplete runtime/migration pair or missing SHA alias"
        else:
            runtime_release, migration_release, runtime_sha, migration_sha = pair
            if runtime_release.get("revision") != revision or runtime_sha.get("revision") != revision:
                reason = "runtime revision label does not match release metadata"
            elif migration_release.get("revision") != revision or migration_sha.get("revision") != revision:
                reason = "migration revision label does not match release metadata"
            elif runtime_release.get("id") != runtime_sha.get("id"):
                reason = "runtime release tag and SHA alias point to different images"
            elif migration_release.get("id") != migration_sha.get("id"):
                reason = "migration release tag and SHA alias point to different images"

        if reason:
            protected.append({"release": release, "revision": revision, "reason": reason})
            continue
        complete[release] = pair

    mapped_sha_tags = {
        tag
        for release, revision in metadata.items()
        for tag in _release_tags(release, revision)[2:]
    }
    for tag, image in by_tag.items():
        if SHA_TAG_RE.fullmatch(tag) and tag not in mapped_sha_tags:
            protected.append({
                "release": "unmapped SHA-only image",
                "revision": image.get("revision", "unknown"),
                "reason": f"{tag} has no proven release-tag mapping",
            })

    if current_release not in complete:
        return Plan((), (), (), tuple(protected), "current release image pair is missing or unverifiable")

    newer = tuple(
        sorted((release for release in metadata if _compare(release, current_release) > 0),
               key=cmp_to_key(_compare), reverse=True)
    )
    older_complete = sorted(
        (release for release in complete if _compare(release, current_release) < 0),
        key=cmp_to_key(_compare),
        reverse=True,
    )
    retained_set = {current_release, *older_complete[: retention - 1]}
    retained = tuple(sorted(retained_set, key=cmp_to_key(_compare), reverse=True))
    removable = {
        release for release in older_complete if release not in retained_set
    }

    # Do not remove a pair referenced by any running or stopped container.
    for release in list(removable):
        pair = complete[release]
        if any(image["id"] in container_image_ids for image in pair):
            removable.remove(release)
            protected.append({
                "release": release,
                "revision": metadata[release],
                "reason": "one or more pair images are referenced by a container",
            })

    deleting: list[dict[str, Any]] = []
    releases_by_revision: dict[str, set[str]] = {}
    for release, revision in metadata.items():
        releases_by_revision.setdefault(revision, set()).add(release)
    scheduled_sha_aliases: set[str] = set()
    for release in sorted(removable, key=cmp_to_key(_compare)):
        revision = metadata[release]
        tags = [release, f"{release}-migration"]
        associated_releases = releases_by_revision[revision]
        if associated_releases <= removable:
            for sha_tag in (f"sha-{revision}", f"sha-{revision}-migration"):
                if sha_tag not in scheduled_sha_aliases:
                    tags.append(sha_tag)
                    scheduled_sha_aliases.add(sha_tag)
        deleting.append({
            "release": release,
            "revision": revision,
            "tags": [tag for tag in tags if tag in by_tag],
        })

    return Plan(retained, newer, tuple(deleting), tuple(protected))


def _docker(args: list[str]) -> str:
    result = subprocess.run(
        ["docker", *args], text=True, capture_output=True, check=True, timeout=60
    )
    return result.stdout


def _load_metadata(path: Path) -> dict[str, str]:
    if not path.exists() and not path.is_symlink():
        return {}
    if path.is_symlink() or not path.is_file():
        raise ValueError("release metadata is not a regular non-symlink file")
    metadata: dict[str, str] = {}
    for line_number, line in enumerate(path.read_text(encoding="ascii").splitlines(), start=1):
        if not line:
            continue
        parts = line.split("\t")
        if len(parts) != 2:
            raise ValueError(f"malformed release metadata on line {line_number}")
        release, revision = parts
        if release in metadata:
            raise ValueError(f"duplicate release metadata for {release}")
        if _semver(release) is None or not REVISION_RE.fullmatch(revision):
            raise ValueError(f"invalid release metadata on line {line_number}")
        metadata[release] = revision
    return metadata


def _store_metadata(path: Path, metadata: dict[str, str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=".vapourdb-retention-", dir=path.parent, text=True)
    try:
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "w", encoding="ascii", newline="\n") as output:
            for release in sorted(metadata, key=cmp_to_key(_compare)):
                output.write(f"{release}\t{metadata[release]}\n")
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _inspect_inventory() -> list[dict[str, str]]:
    output = _docker([
        "image", "ls", "--no-trunc", "--format", "{{.Repository}}:{{.Tag}} {{.ID}}"
    ])
    entries: list[dict[str, str]] = []
    for line in output.splitlines():
        reference, separator, image_id = line.partition(" ")
        if not separator or ":" not in reference:
            raise ValueError("Docker returned malformed image inventory")
        repository, tag = reference.rsplit(":", 1)
        if repository != IMAGE_REPOSITORY:
            continue
        if any(entry["tag"] == tag for entry in entries):
            raise ValueError(f"Docker returned a duplicate VapourDB image tag: {tag}")
        inspected = _docker([
            "image", "inspect", "--format",
            '{{.Id}}|{{index .Config.Labels "org.opencontainers.image.revision"}}',
            reference,
        ]).strip()
        actual_id, separator, revision = inspected.partition("|")
        if not separator or actual_id != image_id:
            raise ValueError(f"could not verify exact image metadata for {reference}")
        entries.append({"repository": repository, "tag": tag, "id": image_id, "revision": revision})
    return entries


def _container_image_ids() -> set[str]:
    output = _docker(["ps", "--all", "--quiet", "--no-trunc"])
    container_ids = output.split()
    if not container_ids:
        return set()
    inspected = _docker([
        "inspect", "--format", "{{.Image}}", *container_ids
    ])
    return set(inspected.split())


def _ensure_current_aliases(
    images: list[dict[str, str]], release: str, revision: str, create_aliases: bool = True
) -> list[dict[str, str]]:
    by_tag = {image["tag"]: image for image in images}
    runtime_sha, migration_sha = f"sha-{revision}", f"sha-{revision}-migration"
    for sha_tag in (runtime_sha, migration_sha):
        image = by_tag.get(sha_tag)
        if image is None or image.get("revision") != revision:
            raise ValueError(f"verified current image is missing or has the wrong revision: {sha_tag}")

    for version_tag, sha_tag in ((release, runtime_sha), (f"{release}-migration", migration_sha)):
        source = by_tag[sha_tag]
        existing = by_tag.get(version_tag)
        if existing:
            if existing.get("revision") != revision or existing.get("id") != source.get("id"):
                raise ValueError(f"release alias already points to a different image: {version_tag}")
        else:
            if create_aliases:
                _docker(["image", "tag", f"{IMAGE_REPOSITORY}:{sha_tag}", f"{IMAGE_REPOSITORY}:{version_tag}"])
            by_tag[version_tag] = {
                "repository": IMAGE_REPOSITORY,
                "tag": version_tag,
                "id": source["id"],
                "revision": source["revision"],
            }
    return list(by_tag.values())


def _print_plan(plan: Plan, current: str, retention: int) -> None:
    print("VPS image retention:")
    print(f"  Repository: {IMAGE_REPOSITORY}")
    print(f"  Retention count: {retention}")
    print(f"  Current release: {current}")
    print("  Retained complete releases:")
    for release in plan.retained:
        print(f"    {release}{' (current)' if release == current else ''}")
    if plan.newer:
        print("  Newer releases left untouched during rollback:")
        for release in plan.newer:
            print(f"    {release}")
    print("  Planned VapourDB tag removals:")
    for item in plan.deleting:
        print(f"    {item['release']} ({item['revision']}): {', '.join(item['tags'])}")
    print("  Protected releases:")
    for item in plan.protected:
        print(f"    {item['release']} ({item['revision']}): {item['reason']}")
    if plan.reason:
        print(f"WARNING: No local images will be removed: {plan.reason}", file=sys.stderr)


def _apply_deletions(plan: Plan) -> list[str]:
    """Remove only exact planned tags, without force; report failures to caller."""
    warnings: list[str] = []
    if plan.reason:
        return warnings
    for item in plan.deleting:
        for tag in item["tags"]:
            reference = f"{IMAGE_REPOSITORY}:{tag}"
            try:
                _docker(["image", "rm", reference])
                print(f"  Removed {reference}")
            except Exception as error:
                warning = f"Could not remove {reference}: {error}"
                warnings.append(warning)
                print(f"WARNING: {warning}", file=sys.stderr)
    return warnings


def _parse_retention(raw: str) -> int:
    if not raw.isascii() or not raw.isdigit() or int(raw) < 2:
        raise ValueError("VAPOURDB_IMAGE_RETENTION must be an integer of at least 2")
    return int(raw)


def _test_plan(path: Path) -> int:
    fixture = json.loads(path.read_text(encoding="utf-8"))
    plan = plan_retention(
        fixture["metadata"],
        fixture["images"],
        fixture["current_release"],
        fixture["current_revision"],
        fixture.get("retention", 2),
        set(fixture.get("container_image_ids", [])),
    )
    print(json.dumps({
        "retained": list(plan.retained),
        "newer": list(plan.newer),
        "deleting": list(plan.deleting),
        "protected": list(plan.protected),
        "reason": plan.reason,
    }, sort_keys=True))
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("current_release", nargs="?")
    parser.add_argument("current_revision", nargs="?")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--dry-run", action="store_true", help="inspect and print the plan without deleting tags")
    parser.add_argument("--test-plan", type=Path, help="offline fixture mode; never invokes Docker")
    args = parser.parse_args()
    if args.test_plan:
        try:
            return _test_plan(args.test_plan)
        except Exception as error:
            print(f"WARNING: VPS selector fixture failed safely: {error}", file=sys.stderr)
            return 0

    try:
        release, revision = args.current_release, args.current_revision
        if not release or _semver(release) is None or not revision or not REVISION_RE.fullmatch(revision):
            raise ValueError("a validated release tag and full commit SHA are required")
        retention = _parse_retention(os.environ.get("VAPOURDB_IMAGE_RETENTION", "2"))
        metadata_path = args.root / "retention-releases.tsv"
        metadata = _load_metadata(metadata_path)
        previous = metadata.get(release)
        if previous is not None and previous != revision:
            raise ValueError(f"release metadata conflicts with the requested SHA for {release}")
        metadata[release] = revision
        _alias_index(metadata)

        images = _inspect_inventory()
        images = _ensure_current_aliases(images, release, revision, create_aliases=not args.dry_run)
        if not args.dry_run:
            _store_metadata(metadata_path, metadata)
            # Re-inspect after adding version aliases so labels and IDs are
            # verified from Docker before any removal is considered.
            images = _inspect_inventory()
        container_ids = _container_image_ids()
        plan = plan_retention(metadata, images, release, revision, retention, container_ids)
        _print_plan(plan, release, retention)
        if plan.reason:
            return 0
        if args.dry_run:
            print("  Dry run: no Docker tags were removed.")
            return 0

        _apply_deletions(plan)
        return 0
    except Exception as error:
        print(f"WARNING: VPS image cleanup skipped safely: {error}", file=sys.stderr)
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

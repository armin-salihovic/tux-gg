#!/usr/bin/env python3
"""Stream, normalize, validate, and import the local ProtonDB snapshots."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import logging
import math
import os
import re
import sys
import tarfile
import unicodedata
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, BinaryIO, Iterator, TextIO

LOGGER = logging.getLogger("tuxgg.importer")
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_DIR = PROJECT_ROOT / "protondb-data" / "reports"
EMAIL_RE = re.compile(r"\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b")
CHROMEOS_OS_RE = re.compile(r"chrome\s*os|chromebook", re.IGNORECASE)
CHROME_FIELD_RE = re.compile(r"chromebook|chrome\s*os|chromeos", re.IGNORECASE)
APP_ID_RE = re.compile(r"^\d+$")
ARCHIVE_RE = re.compile(r"^reports_([a-z]{3})(\d{1,2})_(\d{4})\.tar\.gz$", re.IGNORECASE)

LEGACY_RATING_VALUES = {
    "platinum": 1.00,
    "gold": 0.80,
    "silver": 0.60,
    "bronze": 0.35,
    "borked": 0.00,
}


@dataclass(frozen=True)
class NormalizedReport:
    app_id: str
    title: str | None
    submitted_at: datetime | None
    source_timestamp: str | None
    source_verdict: str | None
    source_rating: str | None
    proton_version: str | None
    proton_variant: str | None
    custom_proton_version: str | None
    distribution: str | None
    kernel: str | None
    cpu: str | None
    gpu: str | None
    gpu_vendor: str
    graphics_driver: str | None
    ram: str | None
    steam_runtime_version: str | None
    x_window_manager: str | None
    launch_options: str | None
    comments: str | None
    hardware_details: str | None
    scoring_value: float | None
    source_data: dict[str, Any]
    source_fingerprint: str
    source_format: str
    missing_fields: tuple[str, ...]


def _string(value: Any) -> str | None:
    if isinstance(value, str):
        value = value.strip()
        return value or None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    return None


def _redact_text(value: str) -> str:
    return EMAIL_RE.sub("[email redacted]", value)


def _clean_source(value: Any, field_name: str = "") -> Any:
    """Copy JSON values, removing Chromebook-only keys and redacting email text."""
    if CHROME_FIELD_RE.search(field_name):
        return None
    if isinstance(value, dict):
        cleaned: dict[str, Any] = {}
        for key, child in value.items():
            if CHROME_FIELD_RE.search(str(key)):
                continue
            cleaned[str(key)] = _clean_source(child, str(key))
        return cleaned
    if isinstance(value, list):
        return [_clean_source(child, field_name) for child in value]
    if isinstance(value, str):
        return _redact_text(value)
    return value


def _legacy_record(record: dict[str, Any]) -> bool:
    return not isinstance(record.get("responses"), dict)


def _app_info(record: dict[str, Any], legacy: bool) -> tuple[str | None, str | None]:
    if legacy:
        app_id = record.get("appId")
        title = record.get("title")
    else:
        app = record.get("app")
        app = app if isinstance(app, dict) else {}
        steam = app.get("steam")
        steam = steam if isinstance(steam, dict) else {}
        app_id = steam.get("appId") or app.get("appId")
        title = app.get("title")
    normalized_id = _string(app_id)
    if normalized_id and not APP_ID_RE.fullmatch(normalized_id):
        normalized_id = None
    return normalized_id, _string(title)


def _as_mapping(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _submitted_at(value: Any) -> tuple[datetime | None, str | None]:
    source_value = _string(value)
    if value is None or isinstance(value, bool):
        return None, source_value
    try:
        seconds = int(value)
    except (TypeError, ValueError, OverflowError):
        return None, source_value
    # Reject impossible dates but retain the report and the original timestamp.
    lower_bound = 946684800  # 2000-01-01 UTC
    upper_bound = int((datetime.now(timezone.utc) + timedelta(days=30)).timestamp())
    if seconds < lower_bound or seconds > upper_bound:
        return None, source_value
    try:
        return datetime.fromtimestamp(seconds, tz=timezone.utc), source_value
    except (OverflowError, OSError, ValueError):
        return None, source_value


def _gpu_vendor(gpu: str | None, driver: str | None) -> str:
    text = f"{gpu or ''} {driver or ''}".casefold()
    vendors: list[str] = []
    if "nvidia" in text or "geforce" in text or "quadro" in text:
        vendors.append("NVIDIA")
    if any(token in text for token in ("amd", "radeon", "ati technologies")):
        vendors.append("AMD")
    if "intel" in text:
        vendors.append("Intel")
    if "apple" in text or "m1" in text or "m2" in text or "m3" in text:
        vendors.append("Apple")
    unique = list(dict.fromkeys(vendors))
    if len(unique) > 1:
        return "Multiple"
    return unique[0] if unique else "Unknown"


def _comments(legacy: bool, record: dict[str, Any], responses: dict[str, Any]) -> str | None:
    candidates: list[Any] = []
    if legacy:
        candidates.extend((record.get("notes"), record.get("systemInfoNotes")))
    else:
        candidates.extend((responses.get("concludingNotes"), responses.get("followUp")))
        notes = responses.get("notes")
        if isinstance(notes, str):
            candidates.append(notes)
        elif isinstance(notes, dict):
            candidates.extend((notes.get("verdict"), notes.get("extra")))

    lines: list[str] = []
    seen: set[str] = set()
    for value in candidates:
        text = _string(value)
        if not text or text.casefold() in {"yes", "no", "none", "null"}:
            continue
        text = _redact_text(text)
        if text not in seen:
            seen.add(text)
            lines.append(text)
    return "\n\n".join(lines) or None


def _fingerprint(record: dict[str, Any]) -> str:
    canonical = json.dumps(
        record,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def normalize_record(record: Any) -> tuple[NormalizedReport | None, str | None, tuple[str, ...]]:
    if not isinstance(record, dict):
        return None, "invalid_record_shape", ("object",)

    legacy = _legacy_record(record)
    app_id, title = _app_info(record, legacy)
    responses = _as_mapping(record.get("responses"))
    system_info = _as_mapping(record.get("systemInfo")) if not legacy else record
    os_value = _string(system_info.get("os"))

    # Exclude only reports whose primary OS field says ChromeOS/Chromebook.
    # Incidental references in a Linux report's prose do not remove that report.
    if os_value and CHROMEOS_OS_RE.search(os_value):
        return None, "chromebook_only", ()
    if not app_id:
        return None, "missing_app_id", ("app_id",)

    source_timestamp = record.get("timestamp")
    submitted_at, timestamp_text = _submitted_at(source_timestamp)
    source_verdict = _string(responses.get("verdict")) if not legacy else None
    source_rating = _string(record.get("rating")) if legacy else None
    if source_rating and source_rating.casefold() in LEGACY_RATING_VALUES:
        scoring_value: float | None = LEGACY_RATING_VALUES[source_rating.casefold()]
    elif source_verdict and source_verdict.casefold() == "yes":
        scoring_value = 1.0
    elif source_verdict and source_verdict.casefold() == "no":
        scoring_value = 0.0
    else:
        scoring_value = None

    if legacy:
        proton_version = _string(record.get("protonVersion"))
        proton_variant = None
        custom_proton_version = _string(record.get("protonVersionManual"))
        distribution = _string(record.get("os"))
        kernel = _string(record.get("kernel"))
        cpu = _string(record.get("cpu"))
        gpu = _string(record.get("gpu"))
        graphics_driver = _string(record.get("gpuDriver"))
        ram = _string(record.get("ram"))
        steam_runtime_version = None
        x_window_manager = None
        launch_options = None
        hardware_details = _string(record.get("specs"))
        comments = _comments(True, record, {})
        format_name = "legacy-flat"
    else:
        proton_version = _string(responses.get("protonVersion"))
        proton_variant = _string(responses.get("variant"))
        custom_proton_version = _string(responses.get("customProtonVersion"))
        distribution = os_value
        kernel = _string(system_info.get("kernel"))
        cpu = _string(system_info.get("cpu"))
        gpu = _string(system_info.get("gpu"))
        graphics_driver = _string(system_info.get("gpuDriver"))
        ram = _string(system_info.get("ram"))
        steam_runtime_version = _string(system_info.get("steamRuntimeVersion"))
        x_window_manager = _string(system_info.get("xWindowManager"))
        launch_options = _string(responses.get("launchOptions"))
        hardware_details = None
        comments = _comments(False, record, responses)
        format_name = "questionnaire-nested"

    missing: list[str] = []
    if not title:
        missing.append("title")
    if submitted_at is None:
        missing.append("timestamp")
    if not source_verdict and not source_rating:
        missing.append("verdict_or_rating")
    if not distribution:
        missing.append("os")
    if not gpu:
        missing.append("gpu")
    if not proton_version and not proton_variant and not custom_proton_version:
        missing.append("proton_information")

    cleaned_record = _clean_source(record)
    if not isinstance(cleaned_record, dict):
        cleaned_record = {}
    fingerprint = _fingerprint(record)

    return (
        NormalizedReport(
            app_id=app_id,
            title=title,
            submitted_at=submitted_at,
            source_timestamp=timestamp_text,
            source_verdict=source_verdict,
            source_rating=source_rating,
            proton_version=proton_version,
            proton_variant=proton_variant,
            custom_proton_version=custom_proton_version,
            distribution=distribution,
            kernel=kernel,
            cpu=cpu,
            gpu=gpu,
            gpu_vendor=_gpu_vendor(gpu, graphics_driver),
            graphics_driver=graphics_driver,
            ram=ram,
            steam_runtime_version=steam_runtime_version,
            x_window_manager=x_window_manager,
            launch_options=launch_options,
            comments=comments,
            hardware_details=hardware_details,
            scoring_value=scoring_value,
            source_data=cleaned_record,
            source_fingerprint=fingerprint,
            source_format=format_name,
            missing_fields=tuple(missing),
        ),
        None,
        tuple(missing),
    )


def iter_json_array(stream: TextIO, chunk_size: int = 1024 * 1024) -> Iterator[Any]:
    """Yield elements from a top-level JSON array without buffering the full file."""
    decoder = json.JSONDecoder()
    buffer = ""
    offset = 0
    started = False
    eof = False

    while True:
        if offset >= len(buffer) and not eof:
            chunk = stream.read(chunk_size)
            if chunk:
                buffer = chunk
                offset = 0
            else:
                eof = True

        while offset < len(buffer) and buffer[offset] in " \t\r\n,":
            offset += 1

        if not started and offset < len(buffer) and buffer[offset] == "[":
            offset += 1
            started = True
        if offset < len(buffer) and buffer[offset] == "]":
            return
        if offset >= len(buffer):
            if eof:
                if not started:
                    raise ValueError("Expected a top-level JSON array")
                return
            continue

        try:
            item, end = decoder.raw_decode(buffer, offset)
        except json.JSONDecodeError:
            if eof:
                raise
            more = stream.read(chunk_size)
            if more:
                buffer = buffer[offset:] + more
                offset = 0
            else:
                eof = True
            continue

        yield item
        offset = end
        if offset > chunk_size:
            buffer = buffer[offset:]
            offset = 0


def iter_archive(path: Path) -> Iterator[Any]:
    """Read the JSON member of a gzip-compressed tar archive in streaming mode."""
    with tarfile.open(path, mode="r|gz") as archive:
        member = next((entry for entry in archive if entry.isfile() and entry.name.endswith(".json")), None)
        if member is None:
            raise ValueError(f"No JSON member found in {path.name}")
        source = archive.extractfile(member)
        if source is None:
            raise ValueError(f"Could not read {member.name} from {path.name}")
        class NonSeekableMember(io.RawIOBase):
            def readable(self) -> bool:
                return True

            def seekable(self) -> bool:
                return False

            def readinto(self, target: bytearray) -> int:
                chunk = source.read(len(target))
                if not chunk:
                    return 0
                target[: len(chunk)] = chunk
                return len(chunk)

            def close(self) -> None:
                source.close()
                super().close()

        with io.TextIOWrapper(io.BufferedReader(NonSeekableMember()), encoding="utf-8", errors="strict") as text_stream:
            yield from iter_json_array(text_stream)


def archive_date(path: Path) -> datetime | None:
    match = ARCHIVE_RE.fullmatch(path.name)
    if not match:
        return None
    month, day, year = match.groups()
    try:
        return datetime.strptime(f"{month.title()} {day} {year}", "%b %d %Y").replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def selected_archives(data_dir: Path) -> list[Path]:
    archives = [path for path in data_dir.glob("reports_*.tar.gz") if archive_date(path)]
    if not archives:
        raise FileNotFoundError(f"No dated reports_*.tar.gz exports found in {data_dir}")
    legacy = data_dir / "reports_oct1_2019.tar.gz"
    modern = max((path for path in archives if (archive_date(path) or datetime.min.replace(tzinfo=timezone.utc)) >= datetime(2019, 12, 1, tzinfo=timezone.utc)), key=lambda p: archive_date(p) or datetime.min.replace(tzinfo=timezone.utc), default=None)
    selected = [path for path in (legacy, modern) if path is not None and path.is_file()]
    if not selected:
        raise FileNotFoundError("Expected the last legacy archive and a later nested-schema export")
    return selected


def _slug(title: str | None, app_id: str) -> str:
    if not title:
        return f"app-{app_id}"
    ascii_title = unicodedata.normalize("NFKD", title).encode("ascii", "ignore").decode("ascii").lower()
    slug = re.sub(r"[^a-z0-9]+", "-", ascii_title).strip("-")
    return slug[:100].rstrip("-") or f"app-{app_id}"


def _file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def inspect_dataset(data_dir: Path) -> dict[str, Any]:
    archives = sorted((p for p in data_dir.glob("reports_*.tar.gz") if archive_date(p)), key=lambda p: archive_date(p) or datetime.min.replace(tzinfo=timezone.utc))
    chosen = selected_archives(data_dir)
    samples: list[dict[str, Any]] = []
    for path in chosen:
        first = next(iter_archive(path), None)
        if isinstance(first, dict):
            samples.append({"archive": path.name, "top_level_fields": sorted(first), "schema": "questionnaire-nested" if "responses" in first else "legacy-flat"})
    return {
        "archive_count": len(archives),
        "compressed_bytes": sum(path.stat().st_size for path in archives),
        "first_export": archives[0].name if archives else None,
        "latest_export": archives[-1].name if archives else None,
        "selected_for_import": [path.name for path in chosen],
        "sample_schemas": samples,
    }


def validate_dataset(data_dir: Path, limit_per_archive: int | None = None) -> dict[str, Any]:
    archives = selected_archives(data_dir)
    stats: Counter[str] = Counter()
    missing: Counter[str] = Counter()
    verdicts: Counter[str] = Counter()
    ratings: Counter[str] = Counter()
    formats: Counter[str] = Counter()
    unique_reports: set[str] = set()
    games: set[str] = set()
    earliest: datetime | None = None
    latest: datetime | None = None

    for path in archives:
        per_archive = 0
        LOGGER.info("Validating %s", path.name)
        for raw in iter_archive(path):
            if limit_per_archive is not None and per_archive >= limit_per_archive:
                break
            per_archive += 1
            stats["source_records"] += 1
            report, reason, absent = normalize_record(raw)
            for field in absent:
                missing[field] += 1
            if reason == "chromebook_only":
                stats["chromebook_only"] += 1
                continue
            if report is None:
                stats["invalid_records"] += 1
                stats[f"invalid_{reason or 'unknown'}"] += 1
                continue
            formats[report.source_format] += 1
            games.add(report.app_id)
            if report.source_fingerprint in unique_reports:
                stats["duplicate_reports"] += 1
                continue
            unique_reports.add(report.source_fingerprint)
            stats["unique_reports"] += 1
            if report.submitted_at:
                earliest = min(earliest, report.submitted_at) if earliest else report.submitted_at
                latest = max(latest, report.submitted_at) if latest else report.submitted_at
            if report.source_verdict:
                verdicts[report.source_verdict.casefold()] += 1
            if report.source_rating:
                ratings[report.source_rating.casefold()] += 1

    return {
        **dict(stats),
        "unique_games": len(games),
        "source_formats": dict(formats),
        "source_verdicts": dict(verdicts),
        "legacy_ratings": dict(ratings),
        "missing_fields": dict(missing),
        "earliest_report_at": earliest.isoformat() if earliest else None,
        "latest_report_at": latest.isoformat() if latest else None,
    }


def _connect(database_url: str | None = None):
    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("Set DATABASE_URL to the TuxGG PostgreSQL database before importing")
    try:
        import psycopg
    except ImportError as exc:
        raise RuntimeError("Install importer dependencies with: python -m pip install -r importer/requirements.txt") from exc
    return psycopg.connect(url, autocommit=False)


def _report_values(report: NormalizedReport, batch_id: int) -> tuple[Any, ...]:
    try:
        from psycopg.types.json import Jsonb
    except ImportError as exc:
        raise RuntimeError("Install importer dependencies with: python -m pip install -r importer/requirements.txt") from exc
    return (
        report.app_id,
        report.source_fingerprint,
        report.submitted_at,
        report.source_verdict,
        report.source_rating,
        report.proton_version,
        report.proton_variant,
        report.custom_proton_version,
        report.distribution,
        report.kernel,
        report.cpu,
        report.gpu,
        report.gpu_vendor,
        report.graphics_driver,
        report.ram,
        report.steam_runtime_version,
        report.x_window_manager,
        report.launch_options,
        report.comments,
        report.hardware_details,
        report.scoring_value,
        Jsonb(report.source_data),
        batch_id,
    )


def import_archive(
    path: Path,
    database_url: str | None = None,
    limit: int | None = None,
    batch_size: int = 500,
) -> dict[str, Any]:
    import psycopg
    from psycopg.types.json import Jsonb

    checksum = _file_sha256(path)
    with _connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """INSERT INTO import_batches (source_filename, source_checksum, source_schema, status, started_at)
                   VALUES (%s, %s, %s, 'running', now()) RETURNING id""",
                (path.name, checksum, "pre-change" if path.name == "reports_oct1_2019.tar.gz" else "latest-snapshot"),
            )
            batch_id = cur.fetchone()[0]
        conn.commit()

        stats: Counter[str] = Counter()
        missing: Counter[str] = Counter()
        buffer: list[NormalizedReport] = []
        processed = 0

        def write_chunk(rows: list[NormalizedReport]) -> None:
            if not rows:
                return
            game_rows = list({row.app_id: (row.app_id, row.title, _slug(row.title, row.app_id)) for row in rows}.values())
            with conn.cursor() as cur:
                cur.executemany(
                    """INSERT INTO games (app_id, title, slug, created_at, updated_at)
                       VALUES (%s, %s, %s, now(), now())
                       ON CONFLICT (app_id) DO UPDATE SET title = EXCLUDED.title, slug = EXCLUDED.slug, updated_at = now()
                       WHERE games.title IS DISTINCT FROM EXCLUDED.title OR games.slug IS DISTINCT FROM EXCLUDED.slug""",
                    game_rows,
                )
                cur.executemany(
                    """INSERT INTO reports (
                         app_id, source_fingerprint, submitted_at, source_verdict, source_rating,
                         proton_version, proton_variant, custom_proton_version, distribution, kernel,
                         cpu, gpu, gpu_vendor, graphics_driver, ram, steam_runtime_version,
                         x_window_manager, launch_options, comments, hardware_details, scoring_value,
                         source_data, imported_batch_id
                       ) VALUES (
                         %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                       ) ON CONFLICT (source_fingerprint) DO NOTHING""",
                    [_report_values(row, batch_id) for row in rows],
                )
                inserted = cur.rowcount
            conn.commit()
            stats["inserted_reports"] += inserted
            stats["duplicate_reports"] += len(rows) - inserted

        try:
            for raw in iter_archive(path):
                if limit is not None and processed >= limit:
                    break
                processed += 1
                stats["source_records"] += 1
                report, reason, absent = normalize_record(raw)
                for field in absent:
                    missing[field] += 1
                if reason == "chromebook_only":
                    stats["chromebook_only"] += 1
                elif report is None:
                    stats["invalid_records"] += 1
                    stats[f"invalid_{reason or 'unknown'}"] += 1
                else:
                    buffer.append(report)
                    if len(buffer) >= batch_size:
                        write_chunk(buffer)
                        buffer.clear()
            write_chunk(buffer)
            with conn.cursor() as cur:
                cur.execute(
                    """UPDATE import_batches SET status = 'complete', finished_at = now(), source_records = %s,
                         inserted_records = %s, duplicate_records = %s, chromebook_records = %s,
                         invalid_records = %s, missing_fields = %s::jsonb
                       WHERE id = %s""",
                    (
                        stats["source_records"],
                        stats["inserted_reports"],
                        stats["duplicate_reports"],
                        stats["chromebook_only"],
                        stats["invalid_records"],
                        json.dumps(dict(missing)),
                        batch_id,
                    ),
                )
            conn.commit()
        except Exception as exc:
            conn.rollback()
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE import_batches SET status = 'failed', finished_at = now(), error_summary = %s WHERE id = %s",
                    (f"{type(exc).__name__}: {str(exc)[:500]}", batch_id),
                )
            conn.commit()
            raise

    return {"archive": path.name, **dict(stats), "missing_fields": dict(missing)}


SUMMARY_SQL = """
WITH weighted AS (
  SELECT app_id, source_verdict, source_rating, scoring_value, submitted_at,
         CASE
           WHEN scoring_value IS NULL OR submitted_at IS NULL THEN 0::double precision
           ELSE power(0.5, greatest(0, extract(epoch FROM (now() - submitted_at)) / 31557600.0))
         END AS recency_weight
  FROM reports
  WHERE source = 'protondb'
), grouped AS (
  SELECT app_id,
         count(*)::integer AS report_count,
         count(*) FILTER (WHERE source_verdict = 'yes')::integer AS yes_count,
         count(*) FILTER (WHERE source_verdict = 'no')::integer AS no_count,
         count(*) FILTER (WHERE source_rating IS NOT NULL)::integer AS legacy_rating_count,
         count(*) FILTER (WHERE scoring_value IS NOT NULL AND submitted_at IS NOT NULL)::integer AS scored_report_count,
         sum(recency_weight) AS total_weight,
         sum(recency_weight * coalesce(scoring_value, 0)) AS weighted_value,
         sum(recency_weight * recency_weight) AS squared_weight,
         max(submitted_at) AS last_report_at,
         jsonb_build_object(
           'yes', count(*) FILTER (WHERE source_verdict = 'yes'),
           'no', count(*) FILTER (WHERE source_verdict = 'no'),
           'platinum', count(*) FILTER (WHERE lower(source_rating) = 'platinum'),
           'gold', count(*) FILTER (WHERE lower(source_rating) = 'gold'),
           'silver', count(*) FILTER (WHERE lower(source_rating) = 'silver'),
           'bronze', count(*) FILTER (WHERE lower(source_rating) = 'bronze'),
           'borked', count(*) FILTER (WHERE lower(source_rating) = 'borked'),
           'unknown', count(*) FILTER (WHERE scoring_value IS NULL)
         ) AS verdict_distribution
  FROM weighted
  GROUP BY app_id
), scored AS (
  SELECT grouped.*,
         weighted_value / nullif(total_weight, 0) AS weighted_score,
         total_weight * total_weight / nullif(squared_weight, 0) AS effective_sample_size
  FROM grouped
)
INSERT INTO compatibility_summaries (
  app_id, tier, report_count, scored_report_count, yes_count, no_count,
  weighted_score, effective_sample_size, verdict_distribution, last_report_at, calculated_at
)
SELECT app_id,
       CASE
         WHEN total_weight < 3 OR effective_sample_size < 3 OR weighted_score IS NULL THEN 'unknown'
         WHEN weighted_score >= 0.95 THEN 'platinum'
         WHEN weighted_score >= 0.80 THEN 'gold'
         WHEN weighted_score >= 0.60 THEN 'silver'
         WHEN weighted_score >= 0.30 THEN 'bronze'
         ELSE 'borked'
       END,
       report_count, scored_report_count, yes_count, no_count,
       weighted_score, effective_sample_size, verdict_distribution, last_report_at, now()
FROM scored
ON CONFLICT (app_id) DO UPDATE SET
  tier = EXCLUDED.tier,
  report_count = EXCLUDED.report_count,
  scored_report_count = EXCLUDED.scored_report_count,
  yes_count = EXCLUDED.yes_count,
  no_count = EXCLUDED.no_count,
  weighted_score = EXCLUDED.weighted_score,
  effective_sample_size = EXCLUDED.effective_sample_size,
  verdict_distribution = EXCLUDED.verdict_distribution,
  last_report_at = EXCLUDED.last_report_at,
  calculated_at = EXCLUDED.calculated_at
"""


def rebuild_summaries(database_url: str | None = None) -> int:
    with _connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(SUMMARY_SQL)
            updated = cur.rowcount
        conn.commit()
    return updated


def database_stats(database_url: str | None = None) -> dict[str, Any]:
    with _connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM games")
            game_count = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM reports WHERE source = 'protondb'")
            report_count = cur.fetchone()[0]
            cur.execute("SELECT count(*) FROM compatibility_summaries")
            summary_count = cur.fetchone()[0]
            cur.execute("""SELECT source_verdict, count(*) FROM reports WHERE source = 'protondb'
                           GROUP BY source_verdict ORDER BY source_verdict""")
            verdicts = {str(key or "unknown"): count for key, count in cur.fetchall()}
            cur.execute("SELECT min(submitted_at), max(submitted_at) FROM reports WHERE source = 'protondb'")
            earliest, latest = cur.fetchone()
            cur.execute("""SELECT coalesce(sum(source_records), 0), coalesce(sum(inserted_records), 0),
                           coalesce(sum(duplicate_records), 0), coalesce(sum(chromebook_records), 0),
                           coalesce(sum(invalid_records), 0)
                           FROM import_batches WHERE status = 'complete'""")
            batches = cur.fetchone()
    return {
        "games": game_count,
        "imported_reports": report_count,
        "summaries": summary_count,
        "source_verdicts": verdicts,
        "earliest_report_at": earliest.isoformat() if earliest else None,
        "latest_report_at": latest.isoformat() if latest else None,
        "completed_batch_totals": {
            "source_records": batches[0],
            "inserted_records": batches[1],
            "duplicate_records": batches[2],
            "chromebook_records_excluded": batches[3],
            "invalid_records": batches[4],
        },
    }


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Import local ProtonDB report snapshots into TuxGG PostgreSQL")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR, help="Directory containing reports_*.tar.gz")
    parser.add_argument("--database-url", help="Database URL; defaults to DATABASE_URL")
    parser.add_argument("--log-level", default="INFO", choices=("DEBUG", "INFO", "WARNING", "ERROR"))
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("inspect", help="List available exports and identify selected schema eras")
    validate = subparsers.add_parser("validate", help="Validate selected snapshots without writing to the database")
    validate.add_argument("--limit-per-archive", type=int, help="Optional sample size per selected archive")

    sample = subparsers.add_parser("sample-import", help="Import a small sample from both schema eras")
    sample.add_argument("--limit-per-archive", type=int, default=1000)
    sample.add_argument("--batch-size", type=int, default=500)

    full = subparsers.add_parser("import", help="Import the last legacy export and newest modern snapshot")
    full.add_argument("--archive", action="append", type=Path, help="Optional explicit archive path; may be repeated")
    full.add_argument("--batch-size", type=int, default=500)

    subparsers.add_parser("rebuild-summaries", help="Recalculate precomputed TuxGG compatibility tiers")
    subparsers.add_parser("stats", help="Show database import statistics")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _parser()
    args = parser.parse_args(argv)
    logging.basicConfig(level=getattr(logging, args.log_level), format="%(levelname)s %(message)s")
    try:
        if args.command == "inspect":
            print(json.dumps(inspect_dataset(args.data_dir), indent=2, ensure_ascii=False))
        elif args.command == "validate":
            print(json.dumps(validate_dataset(args.data_dir, args.limit_per_archive), indent=2, ensure_ascii=False))
        elif args.command in {"sample-import", "import"}:
            if args.command == "sample-import":
                paths = selected_archives(args.data_dir)
                limit = args.limit_per_archive
            else:
                paths = args.archive or selected_archives(args.data_dir)
                limit = None
            results = [import_archive(path, args.database_url, limit, args.batch_size) for path in paths]
            if args.command == "import":
                summary_count = rebuild_summaries(args.database_url)
                LOGGER.info("Rebuilt %s compatibility summaries", summary_count)
            print(json.dumps(results, indent=2, ensure_ascii=False))
        elif args.command == "rebuild-summaries":
            print(json.dumps({"summaries_rebuilt": rebuild_summaries(args.database_url)}, indent=2))
        elif args.command == "stats":
            print(json.dumps(database_stats(args.database_url), indent=2, ensure_ascii=False))
    except Exception as exc:
        LOGGER.error("%s: %s", type(exc).__name__, exc)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())

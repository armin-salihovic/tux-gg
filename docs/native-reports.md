# VapourDB community reports

## Submission and display

Each game page links to `/games/[appId]/[slug]/report/new`. Guests are sent through Steam sign-in and return to the report form. A Steam-linked account must have a validated Linux PC or Steam Deck device before submitting a verdict and optional Proton, distribution, hardware, performance, and issue details.

The server derives the report author from the Better Auth session, checks the Steam account link and game, validates the selected device, and rate-limits submissions. Client-supplied hardware and moderation state are ignored. A new row is inserted into `native_reports` with the database default `moderation_state = 'pending'`. Pending reports are immediately public and contribute to all public lists, counts, filters, profile totals, and compatibility tiers, just like published reports. `/my-reports` is private and does not show a review status for pending or published reports. Hidden and removed reports are excluded from public queries.

Public reports show the author’s public username, report text, and chosen device snapshot immediately after submission. Reports may be moderated later, so an inaccurate or malicious report can briefly affect public totals and compatibility before it is hidden or removed. Public ordering and recency weighting use `created_at`, so approval does not move an older report or refresh its scoring weight. Compatibility keeps the 365-day half-life, minimum total weight, and effective-sample-size threshold.

## Relationships and privileges

The schema keeps native reports linked to `games.app_id`, `user.id`, and optionally `user_devices.id`. Deleting a referenced game or user cascades through their reports; deleting a device preserves the report's hardware snapshot and clears its optional device reference.

The app validates report fields, leaves new reports pending for internal operator tracking, and derives the author from the signed-in account. `scripts/moderate_native_reports.py` uses the same configured `DB_*` account to list pending reports and approve, hide, or remove them. Approval changes the internal state only; it does not change public visibility or score contribution. Hiding or removing a report excludes it from public results on the next query. The configured login needs `SELECT` and `UPDATE` on `public.native_reports` for moderation.

## Disposable database

Prepare the marked test database with:

```sh
pnpm db:test:prepare
pnpm db:migrate
pnpm db:test:prepare
pnpm db:test:seed-e2e
```

CI sets `DB_DATABASE=vapourdb_test` and `VAPOURDB_TEST_DATABASE=1` for the dedicated disposable PostgreSQL service. Test preparation creates or verifies a marker only when the database is empty; test fixtures refuse unmarked databases and never accept the production or legacy database.

For moderation, configure the same `DB_*` account used by the application:

```sh
python scripts/moderate_native_reports.py list
python scripts/moderate_native_reports.py approve REPORT_UUID
python scripts/moderate_native_reports.py hide REPORT_UUID
python scripts/moderate_native_reports.py remove REPORT_UUID
```

The moderation CLI accepts only `vapourdb` or the explicitly marked `vapourdb_test` database. It never targets legacy `tuxgg`.

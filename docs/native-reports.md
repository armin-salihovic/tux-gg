# VapourDB community reports

## Submission and display

Each game page links to `/games/[appId]/[slug]/report/new`. Guests are sent through Steam sign-in and return to the report form. A Steam-linked account must have a validated Linux PC or Steam Deck device before submitting a verdict and optional Proton, distribution, hardware, performance, and issue details.

The server derives the report author from the Better Auth session, checks the Steam account link and game, validates the selected device, and rate-limits submissions. Client-supplied hardware is ignored. A new row is inserted into `native_reports` with the database default `moderation_state = 'pending'`. `/my-reports` is private. Game pages show only published reports and aggregate their public yes/no counts.

## Relationships and privileges

The schema keeps native reports linked to `games.app_id`, `user.id`, and optionally `user_devices.id`. Deleting a referenced game or user cascades through their reports; deleting a device preserves the report's hardware snapshot and clears its optional device reference.

The app validates report fields, sets new reports to pending, and derives the author from the signed-in account. `scripts/moderate_native_reports.py` uses the same configured `DB_*` account to list and moderate pending reports. The configured login needs `SELECT` and `UPDATE` on `public.native_reports` for moderation.

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

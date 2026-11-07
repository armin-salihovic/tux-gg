# TuxGG community reports

## Submission and display

Each game page links to `/games/[appId]/[slug]/report/new`. Guests are sent through Steam sign-in and return to the report form. A Steam-linked account must have a validated Linux PC or Steam Deck device before submitting a verdict and optional Proton, distribution, hardware, performance, and issue details.

The server derives the report author from the Better Auth session, checks the Steam account link and game, validates the selected device, and rate-limits submissions. Client-supplied hardware is ignored. A new row is inserted into `native_reports` with the database default `moderation_state = 'pending'`. `/my-reports` is private. Game pages show only published reports and aggregate their public yes/no counts.

## Relationships and privileges

The schema keeps native reports linked to `games.app_id`, `user.id`, and optionally `user_devices.id`. Deleting a referenced game or user cascades through their reports; deleting a device preserves the report's hardware snapshot and clears its optional device reference.

The web role can select reports and insert only approved report fields. It cannot choose moderation state or publication timestamps, update reports, or delete reports. Operators use `scripts/moderate_native_reports.py` to list and moderate pending reports through a separate database URL.

## Disposable database

Prepare the marked test database with:

```sh
pnpm db:test:prepare
pnpm db:migrate
pnpm db:test:prepare
pnpm db:test:seed-e2e
```

Set `TEST_DATABASE_URL` to an admin connection for `tuxgg_test`, `DATABASE_URL` to `tuxgg_web` on that database, and `MIGRATION_DATABASE_URL` to `tuxgg_migrator` on that database. The safety marker is required before integration tests run. Never point tests at the normal `tuxgg` database.

For operator moderation, set `NATIVE_REPORT_OPERATOR_DATABASE_URL` only in the operator shell:

```sh
python scripts/moderate_native_reports.py list
python scripts/moderate_native_reports.py approve REPORT_UUID
python scripts/moderate_native_reports.py hide REPORT_UUID
python scripts/moderate_native_reports.py remove REPORT_UUID
```

The moderation CLI rejects the web and catalog-writer roles, PostgreSQL superusers, unmarked test databases, and databases other than `tuxgg` or marked `tuxgg_test`.

# Native TuxGG compatibility reports

## User flow

Each game page links to `/games/[appId]/[slug]/report/new`. Guests are sent to Steam sign-in with the validated local form destination bound to Better Auth's existing, browser-bound authentication state. After sign-in, they return to that form. A Steam-linked user submits one plain-text report with a compatibility verdict, saved device, and experience; Proton details are optional and the platform comes from the selected device.

The server derives `author_id` from the Better Auth session, verifies that the account has a `steam` provider link, confirms the game exists, validates all fields, and applies a per-account submission throttle. A report references one of the author's saved devices; the server reloads that device under the account's device lock and copies its name and hardware values into the report. New reports enter `native_reports` with the database default `moderation_state = 'pending'`. `/my-reports` is private and filters by the session user ID. Public game pages show only `published` reports in **TuxGG Community Reports**. Imported ProtonDB reports remain in their existing section and do not change when a native report is submitted or moderated.

## Schema and privileges

Migration `0002_native_report_platform.sql` adds a nullable `platform` column and a constraint accepting `steam_deck` and `linux_desktop`. Migration `0003_user_devices.sql` adds private saved devices plus nullable report device/name snapshot fields. Both are additive; existing reports remain valid, and imported rows are untouched.

The `tuxgg_web` role needs `SELECT` and column-level `INSERT` access to `native_reports`. Its allowed insert columns exclude `moderation_state`, `created_at`, `updated_at`, and `published_at`; `moderation_state` uses the database default. The web role receives no `UPDATE` or `DELETE` privilege on native reports and no write access to `reports`, `compatibility_summaries`, `import_batches`, or game records. It receives full CRUD access to `user_devices`, with every application query constrained by the current user ID. Refresh grants with `pnpm db:grant` after applying migrations.

To prepare a disposable integration database, use `tuxgg_test` and the project safety marker:

```sh
export TEST_DATABASE_URL=postgresql://postgres:local-password@localhost:5432/tuxgg_test
pnpm db:test:prepare
export TEST_WEB_DATABASE_URL=postgresql://tuxgg_web:existing-web-password@localhost:5432/tuxgg_test
export TEST_MIGRATOR_DATABASE_URL=postgresql://tuxgg_migrator:existing-migration-password@localhost:5432/tuxgg_test
DATABASE_URL="$TEST_WEB_DATABASE_URL" MIGRATION_DATABASE_URL="$TEST_MIGRATOR_DATABASE_URL" pnpm db:migrate
pnpm db:test:prepare
pnpm db:test:seed-e2e
```

The migration adds one column and one check constraint without deleting or rewriting existing report data. Grant refresh updates table ACLs only. Verify that `MIGRATION_DATABASE_URL` targets the intended database before running either command; never point destructive tests at the normal `tuxgg` database.

Device import, hardware snapshots, privacy, migration, permissions, and test steps are covered in [devices.md](devices.md).

## Operator moderation

Moderation is an explicit terminal action. Run the CLI with a privileged database URL in the operator shell only. The existing migration role can be used for this small workflow; the URL must not be passed to the web process or included in Compose's application environment.

```sh
export NATIVE_REPORT_OPERATOR_DATABASE_URL="$MIGRATION_DATABASE_URL"
python scripts/moderate_native_reports.py list
python scripts/moderate_native_reports.py approve REPORT_UUID
python scripts/moderate_native_reports.py hide REPORT_UUID
python scripts/moderate_native_reports.py remove REPORT_UUID
```

`approve` sets the state to `published` and records `published_at`. `hide` and `remove` set their corresponding moderation states. These commands update `native_reports` only; they never touch imported ProtonDB rows. The CLI refuses the web/importer roles, PostgreSQL superusers, unmarked test databases, and databases other than `tuxgg` or marked `tuxgg_test`.

## Verification

Unit checks cover the form schema, rate limit, safe Steam login/device return destinations, and Steam System Information parsing. After preparing and migrating the marked `tuxgg_test` database above, run the database checks with the web and migration credentials:

```sh
DATABASE_URL="$TEST_WEB_DATABASE_URL" \
MIGRATION_DATABASE_URL="$TEST_MIGRATOR_DATABASE_URL" \
AUTH_INTEGRATION_TESTS=1 \
NATIVE_REPORT_INTEGRATION_TESTS=1 \
BETTER_AUTH_URL=https://localhost:5173 \
PUBLIC_SITE_URL=https://localhost:5173 \
STEAM_API_KEY=ci-mocked-steam-api-key \
BETTER_AUTH_SECRET=ci-only-test-secret-for-mocked-steam \
pnpm test:auth-integration

DATABASE_URL="$TEST_WEB_DATABASE_URL" \
MIGRATION_DATABASE_URL="$TEST_MIGRATOR_DATABASE_URL" \
pnpm test:e2e
```

PostgreSQL integration tests use the marked database with `tuxgg_web` for device ownership, report insertion, snapshots, and permission checks, and the migration role for moderation tests. The Playwright journey simulates a Steam-linked session, imports a PC by paste and a Steam Deck from a text file, writes and approves a report, then edits and deletes the device to verify the published hardware snapshot. Do not run these commands with `DATABASE_URL` or `MIGRATION_DATABASE_URL` pointing at the normal `tuxgg` database.

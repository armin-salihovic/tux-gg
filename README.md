# TuxGG

TuxGG is a searchable Linux and Steam Deck compatibility catalog built with SvelteKit 3, Svelte 5, Tailwind CSS 4, PostgreSQL, and Drizzle ORM. It imports ProtonDB report snapshots, preserves their source verdicts and ratings, and calculates a separate recency-weighted TuxGG tier. Imported reports are never assigned to TuxGG accounts.

## Requirements

- Node.js 24 or newer
- pnpm 11
- PostgreSQL 15 or newer
- Python 3.11 or newer for data import and database setup

## Local setup

1. Install JavaScript dependencies: `pnpm install`.
2. Copy `.env.example` to `.env`. Keep `.env` private; it is ignored by Git.
3. Install database/importer dependencies with `python -m pip install -r importer/requirements.txt`.
4. For a new local installation only, set `PGADMIN_URL` to an administrator URL connected to PostgreSQL's `postgres` maintenance database, then run `pnpm db:setup` once. Do not rerun it against an existing installation.
5. Run `pnpm db:upgrade`. This is the standard database update command for both a new schema after provisioning and an existing installation after pulling code.
6. Run `pnpm import:inspect` and `pnpm import:validate` to inspect the selected source snapshots. Use `pnpm import:sample` for a 1,000-row-per-snapshot smoke import, then `pnpm import:stats` to inspect it. Sample batches are marked as samples and do not contribute to public reports or summaries until the matching complete archive is imported.
7. Run `pnpm import:all` to import the complete selected corpus and rebuild compatibility summaries. Import commands use `IMPORTER_DATABASE_URL`; unchanged completed archives are skipped, failed full imports replay from the start and reuse report fingerprints, while incomplete data remains out of public summaries.
8. Set `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `ORIGIN`, and `PUBLIC_SITE_URL` to your local origin. `STEAM_API_KEY` is optional and only enriches public profile details. Start the app with `pnpm dev`.

The web process receives only `DATABASE_URL` for its configured runtime role. Keep `IMPORTER_DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `PGADMIN_URL` in a host-side secret file or secret manager. Compose passes only the web URL to the app container. The upgrade command supports an existing `tuxgg_app` runtime credential and applies grants only to the role configured in `DATABASE_URL`; it does not replace or rotate credentials.

### Disposable PostgreSQL integration tests

Importer integration tests truncate importer tables, so run them only against a separate database named `tuxgg_test`. The safety command checks this exact database name and writes a marker that the test fixture verifies before it runs `TRUNCATE`:

```sh
export TEST_DATABASE_URL=postgresql://postgres:local-password@localhost:5432/tuxgg_test
pnpm db:test:prepare
# Point these to the existing role credentials, keeping their passwords unchanged.
export TEST_WEB_DATABASE_URL=postgresql://tuxgg_web:existing-web-password@localhost:5432/tuxgg_test
export TEST_MIGRATOR_DATABASE_URL=postgresql://tuxgg_migrator:existing-migration-password@localhost:5432/tuxgg_test
MIGRATION_DATABASE_URL="$TEST_MIGRATOR_DATABASE_URL" pnpm db:migrate
python -m pytest -q importer/tests
python -m pytest -q tests
pnpm db:test:seed-e2e
DATABASE_URL="$TEST_WEB_DATABASE_URL" pnpm test:e2e
```

`pnpm db:test:prepare` creates or verifies only the marked `tuxgg_test` database through `PGADMIN_URL`. Once the three runtime roles exist, it applies the production grant map to that disposable database. Do not run `pnpm db:setup` automatically against a developer database. The importer tests use `TEST_DATABASE_URL` and reject `tuxgg`, `postgres`, other database names, and unmarked databases before destructive cleanup. The database upgrade integration test clones the marked database into a temporary marked database and confines its previous-version fixtures to that clone. CI uses its own ephemeral PostgreSQL service and seeds browser fixtures (Team Fortress 2, Dota 2, and Counter-Strike 2) without reading local archives.

The mocked Steam OpenID lifecycle test must use the `tuxgg_web` role on the marked disposable database. Run migrations with `tuxgg_migrator` and keep `TEST_DATABASE_URL` on the admin connection only for importer fixtures. The runtime URL must not use PostgreSQL administrator credentials. Set `STEAM_API_KEY` to a non-secret placeholder for the mocked profile-enrichment failure case; Steam requests remain intercepted by the test:

```sh
DATABASE_URL="$TEST_WEB_DATABASE_URL" \
MIGRATION_DATABASE_URL="$TEST_MIGRATOR_DATABASE_URL" \
AUTH_INTEGRATION_TESTS=1 \
NODE_ENV=production \
BETTER_AUTH_URL=https://localhost:5173 \
PUBLIC_SITE_URL=https://localhost:5173 \
STEAM_API_KEY=ci-mocked-steam-api-key \
BETTER_AUTH_SECRET=ci-only-test-secret-for-mocked-steam \
pnpm test:auth-integration
```

Before running the command, point `DATABASE_URL` to the existing `tuxgg_web` credential on `tuxgg_test` and `MIGRATION_DATABASE_URL` to the existing `tuxgg_migrator` credential on that same database. Keep credentials unchanged. CI runs the suite with the restricted web role and production-cookie settings. Steam OpenID derives its realm from `PUBLIC_SITE_URL` and its callback path from Better Auth's configured base path. The site URL must be an origin without a path and must match Better Auth's origin. A live Steam login requires a reachable origin but no client ID or secret.

Steam is the only sign-in provider. Steam OpenID supplies a verified SteamID64 but no email address. TuxGG stores that identity in the Better Auth `account` table and uses an unverified internal placeholder email that is never used for email or account linking. Better Auth manages sessions. A server-side Steam Web API key is optional and used only for profile enrichment; without it, sign-in uses fallback profile details.

Signed-in Steam users can select **Write a Report** on any game page and submit a compatibility verdict, platform, experience, and optional system details. Each report is stored in `native_reports` with `pending` moderation state and appears in `/my-reports` for its author. Only published TuxGG reports appear in the separate **TuxGG Community Reports** section on game pages; imported ProtonDB reports and their scoring remain unchanged.

Steam users can save Linux PCs and Steam Decks under **Settings → Devices**. Paste Steam **Help → System Information** or choose a `.txt` file; TuxGG validates the OS and hardware on the server, and device specifications stay read-only. Windows, macOS, and unidentified systems are rejected. At least one validated saved device is required for a report. Existing devices require reimport before reporting, and old reports retain their hardware snapshots. See [docs/devices.md](docs/devices.md) and [docs/database.md](docs/database.md) for device privacy and database upgrade details.

No database migration is needed for Steam sign-in. Existing user, account, session, and verification tables are reused; old account rows are left untouched and are not linked automatically. Set `PUBLIC_SITE_URL` to the canonical public origin and `PUBLIC_CONTACT_EMAIL` to a monitored address before public deployment.

## Useful commands

| Command                      | Purpose                                                                      |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `pnpm check`                 | Svelte and TypeScript checks                                                 |
| `pnpm test`                  | Unit and browser tests                                                       |
| `pnpm build`                 | Production build                                                             |
| `pnpm db:setup`              | Create the project database and separate web, importer, and migration roles  |
| `pnpm db:upgrade`            | Back up, apply reviewed migrations, repair runtime grants, and verify access |
| `pnpm db:upgrade --dry-run`  | Inspect pending migrations and grant changes without applying them           |
| `pnpm db:migrate`            | Low-level Drizzle migration command; use `db:upgrade` for normal updates     |
| `pnpm db:grant`              | Low-level initial/setup grant command; use `db:upgrade` for normal updates   |
| `pnpm db:test:prepare`       | Create and mark the disposable `tuxgg_test` database                         |
| `pnpm test:auth-integration` | Run the mocked Steam lifecycle against a marked disposable database          |
| `pnpm import:validate`       | Validate the selected source archives without writing to PostgreSQL          |
| `pnpm import:sample`         | Import up to 1,000 records from each selected snapshot                       |
| `pnpm import:all`            | Import all normalized records and rebuild summary rows                       |

The web app uses `DATABASE_URL` and cannot write imported reports or compatibility summaries. The importer uses `IMPORTER_DATABASE_URL` and has no authentication-table access. Drizzle migrations require the dedicated `MIGRATION_DATABASE_URL`; there is no fallback to the maintenance URL or web URL. Use `pnpm db:upgrade` after pulling feature updates; it applies the reviewed migrations, updates the configured runtime role's least-privilege grants, and verifies those grants through the runtime connection.

The importer loads the project `.env` for local commands such as `pnpm import:sample` and `pnpm import:all`. Variables already exported by the shell or injected by production take precedence; connection credentials are not printed.

## Dataset, scoring, and limitations

The importer reads only the last selected pre-questionnaire-change export and the newest nested-schema export. It streams archive contents, excludes records whose primary operating system is ChromeOS/Chromebook, redacts email-shaped strings from displayable text, fingerprints full canonical source records, and preserves source provenance. See [docs/data-analysis.md](docs/data-analysis.md) for measured coverage, field mapping, scoring, licensing, and known limitations.

TuxGG tiers are independent summaries, not official ProtonDB ratings. The method uses documented source-signal mappings, a 365-day half-life, and minimum evidence thresholds. Original source verdict/rating counts stay visible on game pages. Native TuxGG reports do not affect imported report counts or compatibility scoring.

## Deployment

See [docs/deployment.md](docs/deployment.md) for the container workflow and environment checklist. Do not put passwords, Better Auth secrets, Steam API keys, production URLs, or generated `.env` files in source control.

See [docs/native-reports.md](docs/native-reports.md) for the report submission flow, additive platform migration, least-privilege web grants, disposable test setup, and operator moderation commands.

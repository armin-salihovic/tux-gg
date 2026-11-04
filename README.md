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
3. Set `PGADMIN_URL` to an administrator URL connected to PostgreSQL's `postgres` maintenance database. `pnpm db:setup` creates or inspects only the TuxGG database and its named roles. It makes schema changes only after reconnecting to `tuxgg`.
4. Install importer dependencies with `python -m pip install -r importer/requirements.txt`.
5. Run `pnpm db:setup`. It generates credentials for `tuxgg_web`, `tuxgg_importer`, and `tuxgg_migrator`, writes their URLs to the ignored `.env`, and creates the database if needed. It does not change privileges in the maintenance database.
6. Run `pnpm db:migrate` using `MIGRATION_DATABASE_URL`, then `pnpm db:grant` to apply table-specific access after migrations.
7. Run `pnpm import:inspect` and `pnpm import:validate` to inspect the selected source snapshots. Use `pnpm import:sample` for a 1,000-row-per-snapshot smoke import, then `pnpm import:stats` to inspect it. Sample batches are marked as samples and do not contribute to public reports or summaries until the matching complete archive is imported.
8. Run `pnpm import:all` to import the complete selected corpus and rebuild compatibility summaries. Import commands use `IMPORTER_DATABASE_URL`; unchanged completed archives are skipped, failed full imports replay from the start and reuse report fingerprints, while incomplete data remains out of public summaries.
9. Start the app with `pnpm dev`.

The web process receives only `DATABASE_URL` for `tuxgg_web`. Keep `IMPORTER_DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `PGADMIN_URL` in a host-side secret file or secret manager. Compose passes only the web URL to the app container. The one-time transition from `tuxgg_app` preserves that legacy login with web-only grants, updates the local web URL, and provisions a separate importer login. Restart the app after setup and use the generated importer URL for future imports.

### Disposable PostgreSQL integration tests

Importer integration tests truncate importer tables, so run them only against a separate database named `tuxgg_test`. The safety command checks this exact database name and writes a marker that the test fixture verifies before it runs `TRUNCATE`:

```sh
export TEST_DATABASE_URL=postgresql://postgres:local-password@localhost:5432/tuxgg_test
pnpm db:test:prepare
MIGRATION_DATABASE_URL="$TEST_DATABASE_URL" pnpm db:migrate
python -m pytest -q importer/tests
python -m pytest -q tests
pnpm db:test:seed-e2e
DATABASE_URL="$TEST_DATABASE_URL" pnpm test:e2e
```

`pnpm db:test:prepare` creates only `tuxgg_test` through `PGADMIN_URL` from the shell or private `.env`. The importer tests reject `tuxgg`, `postgres`, any other database name, and unmarked databases before destructive cleanup. `importer/tests` contains database-free importer unit tests; `tests` contains the PostgreSQL recovery tests. CI uses its own ephemeral PostgreSQL service and seeds browser fixtures (Team Fortress 2, Dota 2, and Counter-Strike 2) without reading local archives.

The mocked Discord lifecycle test can run against the same marked disposable database with CI-only provider credentials:

```sh
DATABASE_URL="$TEST_DATABASE_URL" \
AUTH_INTEGRATION_TESTS=1 \
NODE_ENV=production \
BETTER_AUTH_URL=https://localhost:5173 \
BETTER_AUTH_SECRET=ci-only-test-secret-that-is-never-used-for-oauth \
DISCORD_CLIENT_ID=ci-only-client-id \
DISCORD_CLIENT_SECRET=ci-only-client-secret \
pnpm test:auth-integration
```

CI runs this test in production-cookie mode. A live Discord OAuth callback still requires a registered deployment URL and remains a manual deployment check.

For optional Discord sign-in, configure `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `DISCORD_CLIENT_ID`, and `DISCORD_CLIENT_SECRET` in `.env`. The site remains browseable without Discord configuration; sign-in returns a clear unavailable state. Set `PUBLIC_SITE_URL` to the canonical public origin and `PUBLIC_CONTACT_EMAIL` to a monitored address before public deployment.

## Useful commands

| Command                      | Purpose                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `pnpm check`                 | Svelte and TypeScript checks                                                |
| `pnpm test`                  | Unit and browser tests                                                      |
| `pnpm build`                 | Production build                                                            |
| `pnpm db:setup`              | Create the project database and separate web, importer, and migration roles |
| `pnpm db:migrate`            | Apply the checked-in PostgreSQL migration                                   |
| `pnpm db:grant`              | Refresh table-specific web/importer grants after a migration                |
| `pnpm db:test:prepare`       | Create and mark the disposable `tuxgg_test` database                        |
| `pnpm test:auth-integration` | Run the mocked Discord lifecycle against a marked disposable database       |
| `pnpm import:validate`       | Validate the selected source archives without writing to PostgreSQL         |
| `pnpm import:sample`         | Import up to 1,000 records from each selected snapshot                      |
| `pnpm import:all`            | Import all normalized records and rebuild summary rows                      |

The web app uses `DATABASE_URL` and cannot write imported reports or compatibility summaries. The importer uses `IMPORTER_DATABASE_URL` and has no authentication-table access. Drizzle migrations require the dedicated `MIGRATION_DATABASE_URL`; there is no fallback to the maintenance URL or web URL. Run `pnpm db:grant` after each schema migration so only reviewed tables receive runtime privileges.

The importer loads the project `.env` for local commands such as `pnpm import:sample` and `pnpm import:all`. Variables already exported by the shell or injected by production take precedence; connection credentials are not printed.

## Dataset, scoring, and limitations

The importer reads only the last selected pre-questionnaire-change export and the newest nested-schema export. It streams archive contents, excludes records whose primary operating system is ChromeOS/Chromebook, redacts email-shaped strings from displayable text, fingerprints full canonical source records, and preserves source provenance. See [docs/data-analysis.md](docs/data-analysis.md) for measured coverage, field mapping, scoring, licensing, and known limitations.

TuxGG tiers are independent summaries, not official ProtonDB ratings. The method uses documented source-signal mappings, a 365-day half-life, and minimum evidence thresholds. Original source verdict/rating counts stay visible on game pages. Steam account linking and native report publishing are intentionally unavailable until ownership verification is implemented.

## Deployment

See [docs/deployment.md](docs/deployment.md) for the container workflow and environment checklist. Do not put passwords, OAuth secrets, production URLs, or generated `.env` files in source control.

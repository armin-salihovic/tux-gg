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
3. Set `PGADMIN_URL` to a PostgreSQL administrator URL connected to the `postgres` maintenance database. The setup script only checks PostgreSQL roles/databases and creates the `tuxgg` database and `tuxgg_app` login if they do not already exist.
4. Install importer dependencies with `python -m pip install -r importer/requirements.txt`.
5. Run `pnpm db:setup`. It generates a random application password if needed, writes local connection strings to the ignored `.env`, and grants the runtime role table-level access without schema or role creation privileges.
6. Run `pnpm db:migrate` with the migration/admin URL, then `pnpm db:grant` to refresh runtime grants for the new tables.
7. Run `pnpm import:inspect` and `pnpm import:validate` to inspect the selected source snapshots. Use `pnpm import:sample` for a 1,000-row-per-snapshot smoke import, then `pnpm import:stats` to inspect it.
8. Run `pnpm import:all` to import the complete selected corpus and rebuild compatibility summaries.
9. Start the app with `pnpm dev`.

For optional Discord sign-in, configure `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `DISCORD_CLIENT_ID`, and `DISCORD_CLIENT_SECRET` in `.env`. The site remains browseable without Discord configuration; sign-in returns a clear unavailable state. Set `PUBLIC_SITE_URL` to the canonical public origin and `PUBLIC_CONTACT_EMAIL` to a monitored address before public deployment.

## Useful commands

| Command                | Purpose                                                             |
| ---------------------- | ------------------------------------------------------------------- |
| `pnpm check`           | Svelte and TypeScript checks                                        |
| `pnpm test`            | Unit and browser tests                                              |
| `pnpm build`           | Production build                                                    |
| `pnpm db:setup`        | Create the project database/runtime role and update local `.env`    |
| `pnpm db:migrate`      | Apply the checked-in PostgreSQL migration                           |
| `pnpm db:grant`        | Refresh runtime table grants after a migration                      |
| `pnpm import:validate` | Validate the selected source archives without writing to PostgreSQL |
| `pnpm import:sample`   | Import up to 1,000 records from each selected snapshot              |
| `pnpm import:all`      | Import all normalized records and rebuild summary rows              |

The importer uses the `DATABASE_URL` runtime credential. Drizzle migrations use `MIGRATION_DATABASE_URL` or `PGADMIN_URL`, which must have schema/extension privileges. The runtime account cannot create tables, roles, databases, or extensions. Run the grant command after each schema migration.

## Dataset, scoring, and limitations

The importer reads only the last selected pre-questionnaire-change export and the newest nested-schema export. It streams archive contents, excludes records whose primary operating system is ChromeOS/Chromebook, redacts email-shaped strings from displayable text, fingerprints full canonical source records, and preserves source provenance. See [docs/data-analysis.md](docs/data-analysis.md) for measured coverage, field mapping, scoring, licensing, and known limitations.

TuxGG tiers are independent summaries, not official ProtonDB ratings. The method uses documented source-signal mappings, a 365-day half-life, and minimum evidence thresholds. Original source verdict/rating counts stay visible on game pages. Steam account linking and native report publishing are intentionally unavailable until ownership verification is implemented.

## Deployment

See [docs/deployment.md](docs/deployment.md) for the container workflow and environment checklist. Do not put passwords, OAuth secrets, production URLs, or generated `.env` files in source control.

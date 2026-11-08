# VapourDB

VapourDB is a searchable Steam game catalog for Linux and Steam Deck players. It preserves the existing Steam AppIDs, titles, slugs, artwork URLs, metadata, and timestamps. Steam store metadata can fill catalog gaps and refresh selected entries; Steam-authenticated players can submit native community reports.

## Requirements

- Node.js 24 or newer
- pnpm 11
- PostgreSQL 15 or newer
- Python 3.11 or newer for database provisioning and test setup

## Local setup

1. Install dependencies with `pnpm install --frozen-lockfile`.
2. Copy `.env.example` to `.env` and keep the file private.
3. Install database setup dependencies with `python -m pip install -r scripts/requirements.txt`.
4. For a new local installation, set `PGADMIN_URL` to a PostgreSQL administrator connection on the `postgres` maintenance database, then run `pnpm db:setup` and `pnpm db:migrate`.
5. Set `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `ORIGIN`, and `PUBLIC_SITE_URL`. Set `STEAM_API_KEY` for Steam profile enrichment or catalog discovery, then start the app with `pnpm dev`.

The baseline contains the Steam AppID catalog, Better Auth tables, saved devices, and native reports. Compatibility is calculated from published native reports when pages load. Pending, hidden, and removed reports do not affect ratings. A game needs at least three recency-weighted reports and an effective sample size of three before it receives a compatibility tier.

## Games catalog backups

Before catalog maintenance, create and verify a backup:

```sh
pnpm db:backup:games
```

The command writes a PostgreSQL custom archive, CSV, and SHA-256 manifest outside the repository. It checks the AppID set, restores the archive to a disposable database, and compares representative metadata and timestamps. New files use `vapourdb-games-YYYYMMDD` names. The default directory is `%USERPROFILE%\.vapourdb-backups` on Windows or `~/.vapourdb-backups` elsewhere. Set `VAPOURDB_BACKUP_DIR` to choose another private external directory; the deprecated `TUXGG_BACKUP_DIR` variable remains a fallback.

Restore an external catalog CSV after the schema is ready:

```sh
pnpm db:restore:games -- "<path-to-vapourdb-games-YYYYMMDD.csv>"
```

Historical `tuxgg-games-YYYYMMDD.csv` and `.dump` files with `tuxgg-games-backup-v1` manifests remain verifiable and restorable. Keep those files unchanged. The restore merges metadata recursively, preserves unknown keys, and uses AppID-based upserts without changing public game URLs.

## Accounts, devices, and reports

Steam OpenID is the only sign-in provider. Better Auth stores Steam-linked accounts and manages sessions. Existing local TuxGG database and role names remain supported until a verified local cutover; see [database setup and recovery](docs/database.md). The VapourDB cookie prefix is `vapourdb`, so existing browsers may need to sign in again after the release. The cookie change does not delete user, linked-account, or session rows.

Signed-in players can save Linux PCs and Steam Decks under **Settings → Devices**. Reports require a validated device, remain private while pending, and become public only after operator review. See [device handling](docs/devices.md) and [native reports](docs/native-reports.md).

The web role cannot edit the catalog or moderate reports. The importer can upsert games but cannot read account data. Migration/admin/importer credentials and Better Auth secrets stay out of Git and out of the web container.

## Development safety

`pnpm db:dev:reset -- --force` is refused. The replacement `pnpm db:dev:reset -- --initialize-empty` works only when the verified local database contains no application objects or data; it never drops a schema. Existing data should be migrated in place only after the database identity, full backup, catalog backup, row-count inventory, and rollback plan are verified. See [database setup and recovery](docs/database.md).

Integration tests use only the marked `vapourdb_test` database. Database backup fixtures verify the test marker before inserting rows, and browser fixtures refuse any other database.

## Useful commands

| Command                                   | Purpose                                          |
| ----------------------------------------- | ------------------------------------------------ |
| `pnpm check`                              | Svelte and TypeScript checks                     |
| `pnpm lint`                               | Svelte checks with warnings treated as errors    |
| `pnpm test:unit`                          | Unit tests                                       |
| `pnpm test:auth-integration`              | Steam auth, report, and device integration tests |
| `pnpm test:e2e`                           | Browser tests                                    |
| `pnpm build`                              | Production build                                 |
| `pnpm db:backup:games`                    | Export and verify the games catalog              |
| `pnpm db:restore:games -- <csv>`          | Idempotently restore game rows                   |
| `pnpm db:migrate`                         | Apply the baseline schema                        |
| `pnpm db:dev:reset -- --initialize-empty` | Initialize only a verified empty local schema    |

See [deployment](docs/deployment.md), [data sources](docs/data-sources.md), and [architecture](docs/architecture.md) for more detail.

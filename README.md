# VapourDB

VapourDB is a searchable Steam game catalog for Linux and Steam Deck players. It preserves the existing Steam AppIDs, titles, slugs, artwork URLs, metadata, and timestamps. Steam store metadata can fill catalog gaps and refresh selected entries; Steam-authenticated players can submit native community reports.

## Requirements

- Node.js 24 or newer
- pnpm 11
- PostgreSQL 15 or newer

## Local setup

The primary local workflow is a PostgreSQL Docker container with the application running on the Windows host.

1. Install dependencies and copy the minimal environment file:

   ```powershell
   pnpm install --frozen-lockfile
   Copy-Item .env.example .env
   ```

2. In `.env`, set `DB_PASSWORD` to the running PostgreSQL account's password and set a private `BETTER_AUTH_SECRET`. The example uses the Docker-published PostgreSQL host port and keeps browser URLs on `127.0.0.1`.
3. Check the host port and current database connection:

   ```powershell
   docker ps --format "table {{.Names}}`t{{.Ports}}"
   Test-NetConnection 127.0.0.1 -Port 5432
   ```

4. Run setup and inspect the connection:

   ```powershell
   pnpm db:setup
   pnpm db:doctor
   ```

   Setup creates the missing `vapourdb` database through PostgreSQL's `postgres` maintenance database using the same `DB_USERNAME` and `DB_PASSWORD`, then verifies schema permissions. The login needs `CREATEDB` only when `vapourdb` is missing; no prompt or extra connection setting is used.

5. Run `pnpm db:migrate`. To load an exported catalog, run `pnpm db:restore:games -- "C:\path\to\tuxgg-games-YYYYMMDD.csv"`, then verify it with `pnpm db:games:count`.
6. Start the app on the same browser origin:

   ```powershell
   pnpm dev
   ```

All application and database commands use the one `DB_*` account in `.env`. See [database setup and recovery](docs/database.md) for privileges and troubleshooting.

The baseline contains the Steam AppID catalog, Better Auth tables, saved devices, and native reports. Compatibility is calculated from pending and published native reports when pages load. Reports appear publicly immediately; hidden and removed reports do not affect ratings. Each report uses its submission date with a 365-day half-life. A game needs at least three recency-weighted reports and an effective sample size of three before it receives a compatibility tier.

## Games catalog backups

Before catalog maintenance, create and verify a backup:

```sh
pnpm db:backup:games
```

The command writes a PostgreSQL custom archive, CSV, and SHA-256 manifest outside the repository. It reports `full-disposable-restore` when it restores into a uniquely named disposable database and checks row counts, AppIDs, and representative records. Otherwise it reports `archive-readable`: CSV rows and AppIDs, checksums, and archive readability are checked, but the archive itself has not been restored or independently checked. Files use a `vapourdb-games-YYYYMMDD` or `tuxgg-games-YYYYMMDD` name matching the source database. The default directory is `%USERPROFILE%\.vapourdb-backups` on Windows or `~/.vapourdb-backups` elsewhere. Set `VAPOURDB_BACKUP_DIR` to choose another private external directory.

Restore an external catalog CSV after the schema is ready:

```sh
pnpm db:restore:games -- "<path-to-tuxgg-games-YYYYMMDD.csv>"
pnpm db:games:count
```

Historical `tuxgg-games-YYYYMMDD.csv` and `.dump` files with `tuxgg-games-backup-v1` manifests remain verifiable and restorable. Keep those files unchanged. The restore merges metadata recursively, preserves unknown keys, and uses AppID-based upserts without changing public game URLs.

## Accounts, devices, and reports

Steam OpenID is the only sign-in provider. Better Auth stores Steam-linked accounts and manages sessions. The previous local `tuxgg` database is left untouched; only a previously exported games CSV is needed to restore the catalog. The VapourDB cookie prefix is `vapourdb`, so existing browsers may need to sign in again after the release.

Signed-in players can save Linux PCs and Steam Decks under **Settings → Devices**. Reports require a validated device and appear publicly after submission, including the report text, public username, and chosen device details. Operators can moderate reports afterward. See [device handling](docs/devices.md) and [native reports](docs/native-reports.md).

In production, use a dedicated non-superuser PostgreSQL account with only the database and schema privileges the application needs. Keep the account password and Better Auth secret out of Git.

## Development safety

`pnpm db:setup` is non-interactive and repeatable. It never resets an existing database, changes passwords, or rewrites `.env`. Application setup and writes require `DB_DATABASE=vapourdb`; the legacy `tuxgg` database is never selected.

Integration tests use only the marked `vapourdb_test` database. Database backup fixtures verify the test marker before inserting rows, and browser fixtures refuse any other database.

## Useful commands

| Command                          | Purpose                                                 |
| -------------------------------- | ------------------------------------------------------- |
| `pnpm check`                     | Svelte and TypeScript checks                            |
| `pnpm lint`                      | Svelte checks with warnings treated as errors           |
| `pnpm test:unit`                 | Unit tests                                              |
| `pnpm test:auth-integration`     | Steam auth, report, and device integration tests        |
| `pnpm test:e2e`                  | Browser tests                                           |
| `pnpm build`                     | Production build                                        |
| `pnpm db:backup:games`           | Export and verify the games catalog                     |
| `pnpm db:restore:games -- <csv>` | Idempotently restore game rows                          |
| `pnpm db:doctor`                 | Read-only database configuration and connectivity check |
| `pnpm db:games:count`            | Read-only row and distinct-AppID count                  |
| `pnpm db:migrate`                | Apply the baseline schema                               |

See [deployment](docs/deployment.md), [data sources](docs/data-sources.md), and [architecture](docs/architecture.md) for more detail.

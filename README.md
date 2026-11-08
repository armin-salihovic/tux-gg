# VapourDB

VapourDB is a searchable Steam game catalog for Linux and Steam Deck players. It preserves the existing Steam AppIDs, titles, slugs, artwork URLs, metadata, and timestamps. Steam store metadata can fill catalog gaps and refresh selected entries; Steam-authenticated players can submit native community reports.

## Requirements

- Node.js 24 or newer
- pnpm 11
- PostgreSQL 15 or newer
- Python 3.11 or newer for database provisioning and test setup

## Local setup

The primary local workflow is a PostgreSQL Docker container with the application running on the Windows host.

1. Install dependencies and copy the minimal environment file:

   ```powershell
   pnpm install --frozen-lockfile
   Copy-Item .env.example .env
   ```

2. In `.env`, set a private `BETTER_AUTH_SECRET`. The example keeps the database and browser URLs on `127.0.0.1`; use the Docker-published PostgreSQL host port.
3. Check the host port, then verify the configured URL:

   ```powershell
   docker ps --format "table {{.Names}}`t{{.Ports}}"
   Test-NetConnection 127.0.0.1 -Port 5432
   pnpm db:doctor
   ```

4. Run `pnpm db:setup`. If `vapourdb` and `vapourdb_dev` do not exist, run `pnpm db:setup -- --bootstrap`; it asks once for a maintenance URL with hidden input. This requires an administrator allowed to create a role and database. The admin connection is not saved. Setup never takes over an existing database or changes a role password.
5. Run `pnpm db:migrate`. To load an exported catalog, run `pnpm db:restore:games -- "C:\path\to\tuxgg-games-YYYYMMDD.csv"`, then verify it with `pnpm db:games:count`.
6. Start the app on the same browser origin:

   ```powershell
   pnpm exec vite dev --host 127.0.0.1 --port 5174 --strictPort
   ```

Ordinary local database commands use only `DATABASE_URL`. See [database setup and recovery](docs/database.md) for bootstrap details and troubleshooting.

The baseline contains the Steam AppID catalog, Better Auth tables, saved devices, and native reports. Compatibility is calculated from published native reports when pages load. Pending, hidden, and removed reports do not affect ratings. A game needs at least three recency-weighted reports and an effective sample size of three before it receives a compatibility tier.

## Games catalog backups

Before catalog maintenance, create and verify a backup:

```sh
pnpm db:backup:games
```

The command writes a PostgreSQL custom archive, CSV, and SHA-256 manifest outside the repository. It checks the AppID set, restores the archive to a disposable database, and compares representative metadata and timestamps. Files use a `vapourdb-games-YYYYMMDD` or `tuxgg-games-YYYYMMDD` name matching the source database. The default directory is `%USERPROFILE%\.vapourdb-backups` on Windows or `~/.vapourdb-backups` elsewhere. Set `VAPOURDB_BACKUP_DIR` to choose another private external directory; the deprecated `TUXGG_BACKUP_DIR` variable remains a fallback.

Restore an external catalog CSV after the schema is ready:

```sh
pnpm db:restore:games -- "<path-to-tuxgg-games-YYYYMMDD.csv>"
pnpm db:games:count
```

Historical `tuxgg-games-YYYYMMDD.csv` and `.dump` files with `tuxgg-games-backup-v1` manifests remain verifiable and restorable. Keep those files unchanged. The restore merges metadata recursively, preserves unknown keys, and uses AppID-based upserts without changing public game URLs.

## Accounts, devices, and reports

Steam OpenID is the only sign-in provider. Better Auth stores Steam-linked accounts and manages sessions. The previous local `tuxgg` database is left untouched; only a previously exported games CSV is needed to restore the catalog. The VapourDB cookie prefix is `vapourdb`, so existing browsers may need to sign in again after the release.

Signed-in players can save Linux PCs and Steam Decks under **Settings → Devices**. Reports require a validated device, remain private while pending, and become public only after operator review. See [device handling](docs/devices.md) and [native reports](docs/native-reports.md).

In production, the web role cannot edit the catalog or moderate reports. The importer can upsert games but cannot read account data. Migration/admin/importer credentials and Better Auth secrets stay out of Git and out of the web container.

## Development safety

`pnpm db:setup` is read-only and idempotent for an existing local installation. It does not reset schemas, change passwords, or rewrite `.env`. The old `tuxgg` database is never selected by local write commands.

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

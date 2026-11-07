# TuxGG

TuxGG is a searchable Steam game catalog for Linux and Steam Deck players. It preserves Steam AppIDs, titles, slugs, artwork URLs, metadata, and timestamps from the existing `public.games` catalog. Steam store metadata can refresh that catalog, and Steam-authenticated users can submit native community reports.

## Requirements

- Node.js 24 or newer
- pnpm 11
- PostgreSQL 15 or newer
- Python 3.11 or newer for database provisioning and test setup

## Back up and restore the game catalog

Before any schema cleanup, run:

```sh
pnpm db:backup:games
```

The command verifies the source database is `tuxgg`, exports every `public.games` row to a custom PostgreSQL archive and UTF-8 CSV, checks the CSV row count and unique AppIDs, reads and restores the archive into a disposable database, compares the restored count and representative records (including JSONB metadata and timestamps), and writes SHA-256 checksums. It does not change the source database. By default the timestamped files are stored in `%USERPROFILE%\.tuxgg-backups` on Windows or `~/.tuxgg-backups` elsewhere. Set `TUXGG_BACKUP_DIR` to a private directory outside this repository. The command needs `PGADMIN_URL` to create and remove its own uniquely named verification database, plus host `pg_dump`/`pg_restore` tools or Docker.

After the new schema is available, restore the complete CSV with AppID-based upserts:

```sh
pnpm db:restore:games -- "<path-to-tuxgg-games-YYYYMMDD.csv>"
```

The restore command uses `IMPORTER_DATABASE_URL`. It merges JSON metadata recursively, preserves unknown keys, ignores empty incoming values, and keeps the earlier creation time and later update time on conflicts.

## Local setup

1. Install dependencies with `pnpm install`.
2. Copy `.env.example` to `.env` and keep it private.
3. Install PostgreSQL setup dependencies with `python -m pip install -r scripts/requirements.txt`.
4. For a new database only, set `PGADMIN_URL` to an administrator connection on PostgreSQL's `postgres` database and run `pnpm db:setup` once.
5. Run `pnpm db:migrate` to create the current baseline schema, then restore the CSV as described above.
6. Set `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `ORIGIN`, and `PUBLIC_SITE_URL`; set `STEAM_API_KEY` if using catalog discovery or Steam profile enrichment. Start with `pnpm dev`.

The baseline contains `games`, Better Auth tables, `user_devices`, and `native_reports`. The game catalog remains keyed by Steam AppID. Compatibility is calculated from published native reports when a page is read; pending, hidden, and removed reports do not affect it. Ratings stay Unknown until there is at least three recency-weighted reports and an effective sample size of three.

Game pages are indexable when they have a title and a Steam short description of at least 50 characters. The game sitemap uses the same rule, so catalog completeness rather than fabricated reports determines indexability.

The migration baseline is intended for a clean schema. Do not run it against a legacy schema without first completing and reviewing a migration plan. The repository includes no command that resets a database or automatically drops legacy tables. The verified games backup must be in hand before an operator performs any legacy cleanup.

## Steam catalog commands

Steam metadata is cached for 30 days using `metadata.steam.lastFetchedAt`. A default sync selects at most 10 stale existing games; no catalog import runs automatically. Preview mode performs a database read only and makes zero Steam requests or writes:

```sh
pnpm steam:sync -- --dry-run
```

To refresh selected games, pass no more than 20 IDs and set `--limit` to the same upper bound when it exceeds 10. Requests are sequential and at least two seconds apart. `--force` bypasses the freshness cache. Steam failures use bounded retries, respect reasonable `Retry-After` values, and never log API keys.

```sh
pnpm steam:sync -- --limit 20 --ids "440,570,730"
pnpm steam:sync -- --limit 20 --ids "440,570,730" --force
```

Discover additional catalog entries using Steam's paginated `IStoreService/GetAppList` endpoint:

```sh
pnpm steam:discover -- --limit 1000
pnpm steam:discover -- --limit 1000 --apply
```

Discovery defaults to preview mode, makes one catalog request for up to 1,000 entries, skips AppIDs already in `games`, and does not make per-game detail requests. Larger runs can use up to 50,000 entries; each extra page waits at least two seconds. See the [Steamworks IStoreService documentation](https://partner.steamgames.com/doc/webapi/IStoreService?l=english).

## Accounts, devices, and community reports

Steam is the only sign-in provider. Steam OpenID supplies the verified SteamID64; TuxGG stores it in Better Auth's `account` table and uses a private, unverified placeholder email. Better Auth manages user sessions.

Signed-in Steam users can save Linux PCs and Steam Decks under **Settings → Devices**. Device specifications are parsed and validated from Steam System Information and stay read-only. A validated device is required for report submission. Reports begin in private `pending` moderation state, appear on `/my-reports`, and become public only after operator approval. See [docs/devices.md](docs/devices.md) and [docs/native-reports.md](docs/native-reports.md).

The web process uses `DATABASE_URL` and cannot edit the catalog or moderate reports. `IMPORTER_DATABASE_URL` can upsert games but cannot read authentication data. `MIGRATION_DATABASE_URL` is reserved for Drizzle migrations. Keep database credentials, Better Auth secrets, and Steam API keys out of Git.

## Local development and recovery

For a new local database, configure `PGADMIN_URL` for the PostgreSQL `postgres` maintenance database, then run `pnpm db:setup` and `pnpm db:migrate`. Before a destructive local rebuild, create and verify a complete backup with `pnpm db:backup:games`. Backup CSV, archive, and checksum manifest are stored outside the repository under `%USERPROFILE%\.tuxgg-backups` by default.

The reset command only accepts the local `tuxgg` database and requires an explicit flag. Supplying a verified backup CSV also restores every catalog row:

```sh
pnpm db:dev:reset -- --force --games "<path-to-verified-games.csv>"
```

It removes old development schema and migration history, applies the clean baseline and grants, restores the optional CSV, and verifies the result. The reset discards development accounts, devices, and reports. Start the app with `pnpm dev`; check `/`, `/games`, and a restored detail page such as `/games/440/team-fortress-2`. Sign in before checking private settings and reporting flows.

## Checks and disposable database

CI provisions an isolated PostgreSQL service and a marked `tuxgg_test` database. Local integration tests require the same dedicated database; they reject unmarked or differently named databases before touching fixture data.

Useful commands:

| Command                          | Purpose                                                 |
| -------------------------------- | ------------------------------------------------------- |
| `pnpm check`                     | Svelte and TypeScript checks                            |
| `pnpm lint`                      | Svelte checks with warnings treated as errors           |
| `pnpm test:unit`                 | Unit tests                                              |
| `pnpm test:auth-integration`     | Steam auth, native report, and device integration tests |
| `pnpm test:e2e`                  | Browser tests                                           |
| `pnpm build`                     | Production build                                        |
| `pnpm db:backup:games`           | Export and verify the full games catalog                |
| `pnpm db:restore:games -- <csv>` | Idempotently restore game rows                          |
| `pnpm db:migrate`                | Apply the clean baseline to a new schema                |
| `pnpm db:dev:reset -- --force`   | Destructively rebuild local `tuxgg`                     |

See [docs/deployment.md](docs/deployment.md) for deployment configuration and [docs/data-sources.md](docs/data-sources.md) for Steam metadata provenance.

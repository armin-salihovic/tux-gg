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

The baseline contains `games`, Better Auth tables, `user_devices`, and `native_reports`. The game catalog remains keyed by Steam AppID. Native report rows keep their foreign keys to games and authors; imported ProtonDB reports, import batches, and derived scoring tables are no longer part of the application schema.

The migration baseline is intended for a clean schema. Do not run it against a legacy schema without first completing and reviewing a migration plan. The repository includes no command that resets a database or automatically drops legacy tables. The verified games backup must be in hand before an operator performs any legacy cleanup.

## Steam catalog commands

Refresh metadata for 10 existing catalog entries (the default) or choose up to 20 AppIDs:

```sh
pnpm steam:sync -- --ids "440,570,730" --dry-run
```

The sync command requests one app at a time, with a minimum two-second delay between requests. It refreshes the Steam detail fields under `metadata.steam`, fills or updates non-empty title and artwork fields, and preserves other metadata. `--dry-run` uses the read-only `DATABASE_URL`, fetches and reports results without writing. An applied sync uses `IMPORTER_DATABASE_URL`. Without `--ids`, it selects up to 10 existing games that have missing catalog information.

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

See [docs/deployment.md](docs/deployment.md) for deployment configuration and [docs/data-sources.md](docs/data-sources.md) for Steam metadata provenance.

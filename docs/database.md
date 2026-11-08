# Database setup and recovery

## New database

1. Copy `.env.example` to `.env` and set private PostgreSQL URLs.
2. Install Python setup dependencies with `python -m pip install -r scripts/requirements.txt`.
3. Set `PGADMIN_URL` to a PostgreSQL administrator connection on the `postgres` maintenance database.
4. Run `pnpm db:setup` to create the `vapourdb` database and its `vapourdb_web`, `vapourdb_importer`, and `vapourdb_migrator` roles.
5. Run `pnpm db:migrate` to apply the baseline schema, then restore a verified catalog CSV with `pnpm db:restore:games -- <games.csv>`.

`DATABASE_URL`, `DATABASE_URL_DOCKER`, `IMPORTER_DATABASE_URL`, `MIGRATION_DATABASE_URL`, `PGADMIN_URL`, `BETTER_AUTH_URL`, `PUBLIC_SITE_URL`, and `ORIGIN` remain the environment-variable names. Production Compose passes only the web role to the app container.

## Roles and grants

- `vapourdb_web` uses `DATABASE_URL`; it reads games, manages Better Auth records and private devices, and may insert only approved native-report fields. It cannot edit the games catalog or moderate reports.
- `vapourdb_importer` uses `IMPORTER_DATABASE_URL`; it can select and upsert games and cannot read account data.
- `vapourdb_migrator` uses `MIGRATION_DATABASE_URL`; it owns the schema and applies Drizzle migrations.
- Report moderation uses a separate operator connection.

`pnpm db:grant` reapplies the reviewed grants after a schema change. `pnpm db:setup` is a provisioning command, not a routine application update. If the private `.env` still points to the legacy `tuxgg` database and roles, setup and the database scripts continue to recognize that identity until a reviewed cutover. Do not mix legacy and VapourDB role URLs in one configuration.

## Games backup compatibility

Before any catalog cleanup, run `pnpm db:backup:games`. The command reads the selected application catalog, writes a PostgreSQL custom archive and UTF-8 CSV, verifies unique AppIDs, restores the archive into a disposable database, compares representative metadata and timestamps, and writes SHA-256 hashes and a manifest. The source remains read-only.

New files use `vapourdb-games-YYYYMMDD.csv`, `.dump`, and `.manifest.json`. The default external directory is `%USERPROFILE%\.vapourdb-backups` on Windows or `~/.vapourdb-backups` elsewhere. `VAPOURDB_BACKUP_DIR` takes precedence; `TUXGG_BACKUP_DIR` remains a deprecated fallback for existing setups. Neither directory should be inside Git.

Existing `tuxgg-games-YYYYMMDD.csv` and `.dump` files with `tuxgg-games-backup-v1` manifests remain readable and checksum-verified. Keep those files in place; do not rename or rewrite them. The importer preserves game AppIDs, titles, slugs, artwork, metadata JSON, and creation/update timestamps. It merges JSON recursively and does not replace non-empty fields with empty backup values.

```sh
pnpm db:restore:games -- "<path-to-vapourdb-games-YYYYMMDD.csv>"
```

The command also accepts historical TuxGG CSV paths. It requires the matching importer role and a recognized application database. In a test database it additionally requires the disposable database marker.

## Empty development initialization

`pnpm db:dev:reset -- --force` is refused. The command no longer drops or recreates a schema. Its only supported operation is a deliberately named empty initialization:

```sh
pnpm db:dev:reset -- --initialize-empty
```

This is allowed only for a local loopback PostgreSQL server with the matching migrator/admin identities, no application tables, no routines, no extra application schemas, and no user or report data. An optional `--games <csv>` must point to an external CSV with a valid legacy or new manifest and matching hashes. Existing databases with any application objects are refused, even if `--force` or a games-only backup is supplied. Use `pnpm db:migrate` for a new empty schema and `pnpm db:restore:games` for an additive catalog restore.

## Safe legacy database identity cutover

The repository currently remains compatible with an existing local configuration that uses `tuxgg`, `tuxgg_test`, `tuxgg_web`, `tuxgg_importer`, and `tuxgg_migrator`. The local `.env` and database identifiers must be changed together. Renaming roles or the database does not delete application rows, but changing the Better Auth cookie prefix can sign out browsers; user, account, and session rows are retained.

Do not run a cutover unless all these prerequisites are satisfied:

1. The migration URL, server address, PostgreSQL version, database owner, current roles, schema version, and exact pre-migration counts are positively verified as a local development server. A hostname of `localhost` alone is insufficient; `inet_server_addr()` must be loopback.
2. The games CSV, custom archive, and manifest exist outside the repository, their hashes and counts match, and the archive restores successfully into a disposable database.
3. A separate full database custom dump exists outside the repository, has a recorded SHA-256 hash, and restores into a disposable database. This backup must include the Better Auth, device, and report tables as well as games.
4. No new `vapourdb` database or `vapourdb_*` roles exist, the rollback sequence is ready, and the application and background jobs are stopped.

The game backup alone does not protect users, sessions, devices, or native reports. The cutover stops if the full backup or any inventory is missing. Keep all existing backup files.

Before cutover, record these identities and counts from the legacy local database:

```sql
SELECT current_database(), current_user, inet_server_addr(), current_setting('server_version');
SELECT count(*) AS games, count(DISTINCT app_id) AS distinct_app_ids FROM public.games;
SELECT 'user' AS table_name, count(*) FROM public."user"
UNION ALL SELECT 'account', count(*) FROM public.account
UNION ALL SELECT 'session', count(*) FROM public.session
UNION ALL SELECT 'user_devices', count(*) FROM public.user_devices
UNION ALL SELECT 'native_reports', count(*) FROM public.native_reports;
```

Create and verify both backups before changing identifiers. Set a private external directory in the operator shell, create the catalog export, then create a full custom-format dump from the local migrator connection and record its SHA-256. Use a unique disposable database for `pg_restore` verification and compare the table counts and game AppID set. Never use a production or staging URL for this procedure.

After that verification, connect through `PGADMIN_URL` to the local `postgres` maintenance database. Check that the target is exactly the local legacy `tuxgg` database and that no client sessions remain. If any session is still active, stop and close its process before continuing. Rename the existing roles and database in place:

```sql
ALTER ROLE tuxgg_web RENAME TO vapourdb_web;
ALTER ROLE tuxgg_importer RENAME TO vapourdb_importer;
ALTER ROLE tuxgg_migrator RENAME TO vapourdb_migrator;
ALTER DATABASE tuxgg RENAME TO vapourdb;
```

PostgreSQL updates ownership and grants to follow role renames; passwords remain unchanged. Update only the usernames and database path in the private `.env`, preserving valid passwords and all auth secrets. Then reconnect with the new URLs and compare the complete game AppID set plus row counts for `user`, `account`, `session`, `user_devices`, and `native_reports`. Check representative JSON metadata and timestamps, foreign-key relationships, schema version, and role grants. Run `pnpm db:grant` only after the new identity has been verified, then smoke-test the app and Steam sign-in.

For rollback, stop the app, restore the old names in `.env`, and use the local maintenance connection to rename `vapourdb` back to `tuxgg` and each `vapourdb_*` role back to its `tuxgg_*` name. Do not restore the full dump unless the data comparison shows a real change that cannot be reversed by renaming.

In this environment, the local `.env` still uses the legacy names, but the read-only inventory could not be completed, so the server identity and data counts were not established. The existing games CSV and dump are missing their verification manifest, and no verified full-database backup was found. The database and `.env` have therefore been left untouched; the code supports the active legacy configuration until the checks above can be completed.

## Disposable integration database

`pnpm db:test:prepare` accepts `vapourdb_test` and the legacy `tuxgg_test`. It marks only an empty disposable database; it refuses to mark an existing unmarked database containing application objects. Tests use `vapourdb_test`, require the marker before inserting fixtures, and never target the normal development database. CI provisions its own ephemeral PostgreSQL service and verifies grants, backup/restore, auth, native reports, devices, browser behavior, and the production build.

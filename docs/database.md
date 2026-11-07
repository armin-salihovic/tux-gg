# Database setup and recovery

## New database

1. Copy `.env.example` to `.env` and set private PostgreSQL URLs.
2. Install Python setup dependencies: `python -m pip install -r scripts/requirements.txt`.
3. Set `PGADMIN_URL` to an administrator connection on PostgreSQL's `postgres` database.
4. Run `pnpm db:setup` once to create the `tuxgg` database and the web, catalog-writer, and migration roles.
5. Run `pnpm db:migrate` to apply the baseline schema.
6. Restore the verified catalog with `pnpm db:restore:games -- <games.csv>`.

## Database roles

- `tuxgg_web` uses `DATABASE_URL`; it reads games, can insert only user-submitted native report fields, manages Better Auth records and private devices, and cannot moderate reports or edit the games catalog.
- `tuxgg_importer` uses `IMPORTER_DATABASE_URL`; it can select and upsert games only. It cannot read account data.
- `tuxgg_migrator` uses `MIGRATION_DATABASE_URL`; it owns the schema and applies Drizzle migrations.
- A separate operator connection is used for report moderation.

`pnpm db:grant` reapplies the reviewed grants after a schema change. `pnpm db:setup` is an operator provisioning command, not a routine application update.

## Full games backup

Before any legacy database cleanup, run `pnpm db:backup:games`. The command requires a read-capable `DATABASE_URL` to `tuxgg` and a `PGADMIN_URL` used only for a temporary verification database. It exports every original non-generated game column, verifies the row count and unique AppIDs, checks the custom archive, restores that archive into a uniquely named disposable database, compares all AppIDs and representative JSON/timestamp values, computes SHA-256 checksums, and retains both output files. The source database stays read-only.

Backups are saved outside Git under `%USERPROFILE%\.tuxgg-backups` on Windows or `~/.tuxgg-backups` on other systems. `TUXGG_BACKUP_DIR` can select another external directory. Install PostgreSQL client tools or Docker. The command prints the paths, file sizes, checksums, and verification results.

To re-import the games CSV into the new schema:

```sh
pnpm db:restore:games -- "<path-to-tuxgg-games-YYYYMMDD.csv>"
```

The restore is idempotent on `app_id`. It keeps existing non-empty titles and artwork when the CSV value is empty, recursively merges JSONB without discarding unknown keys, and keeps the earliest `created_at` and latest `updated_at` on conflicts.

## Existing legacy database

The checked-in baseline is for a clean schema. It does not automatically reset a database, delete imported-report tables, or convert an old Drizzle migration ledger. For a database with the previous schema, create and verify the full games backup first. Review an explicit cutover plan for auth, devices, and native reports before applying any schema cleanup. No destructive cleanup is run by `pnpm db:backup:games` or `pnpm db:migrate`.

## Disposable integration database

`pnpm db:test:prepare` creates or verifies only `tuxgg_test` and places a safety marker before integration tests use it. Point `TEST_DATABASE_URL` to an administrator connection for this disposable database. Tests that use application roles require `DATABASE_URL` to use `tuxgg_web` and `MIGRATION_DATABASE_URL` to use `tuxgg_migrator` on `tuxgg_test`. Do not point test commands at the live database.

The CI workflow provisions an ephemeral PostgreSQL service, applies the baseline independently to `tuxgg` and `tuxgg_test`, verifies database grants, and runs auth, native-report, device, and browser checks.

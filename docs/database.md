# Database setup and upgrades

## New installation

1. Copy `.env.example` to `.env` and fill the database connections privately.
2. Install the Python database dependencies with `python -m pip install -r importer/requirements.txt`.
3. Run `pnpm db:setup` once to provision the new database and dedicated roles.
4. Run `pnpm db:upgrade` to create the schema, apply reviewed migrations, grant the configured runtime role only its reviewed privileges, and verify access.

`pnpm db:setup` is for initial provisioning. Do not run it during an ordinary application update or as part of `pnpm db:upgrade`.

## Existing installation

After pulling new code, point the private configuration at the existing installation and run:

```powershell
pnpm db:upgrade
```

The required variables are:

- `DATABASE_URL`: the actual web runtime credential, normally `tuxgg_web`; an existing `tuxgg_app` login is supported when that is still the configured runtime role.
- `MIGRATION_DATABASE_URL`: the dedicated `tuxgg_migrator` login on the same `tuxgg` database.
- `PGADMIN_URL`: the PostgreSQL maintenance connection on the same server, connected to the `postgres` database. The configured administrator must be able to apply reviewed table grants; the current implementation requires a PostgreSQL superuser.

The command checks `current_database()` and `current_user` for each connection, verifies that they reach the same PostgreSQL installation and intended database, and refuses `postgres`, `tuxgg_test`, and other databases in normal mode. It never prints passwords or complete database URLs. Shell environment variables take precedence over `.env`; the script never edits `.env`, generates passwords, creates roles, or changes authentication credentials.

Before applying migrations, it checks that the database's Drizzle history matches the checked-in migration journal and SQL hashes. Existing application tables without a migration ledger, an unknown ledger entry, or a changed applied migration fail safely for manual review. Pending SQL is checked for destructive statements and only reviewed additive migrations are run. Migration permissions are checked before applying; the command does not change table ownership to work around an underprivileged migration login.

After migrations, the command applies least-privilege grants only to the configured runtime role. It repairs `user_devices` permissions even when `0003_user_devices.sql` is already recorded as applied. It preserves column-limited native report inserts, removes runtime write access to imported ProtonDB tables and compatibility summaries, and verifies real PostgreSQL privileges through `DATABASE_URL`. Any missing or excessive privilege is reported by table and operation.

The upgrade is idempotent. An already-current database with correct grants succeeds without making changes or creating another backup. When migrations or grants need to change, a verified backup is created first. After schema changes, the tool compares row counts for existing games, imported reports, summaries, auth data, and native reports. Migrations and permission updates never rebuild compatibility summaries.

## Dry run

Inspect the target, migration state, pending SQL, and grant changes without applying anything:

```powershell
pnpm db:upgrade --dry-run
```

Dry run does not create a backup. Do not use `--allow-test-database` for normal deployments; that option exists only for marked disposable PostgreSQL integration tests.

## Backup and recovery

When a live change is needed, `db:upgrade` runs `pg_dump` in custom archive format, then uses `pg_restore` to list and extract the complete archive before changing the database. By default backups are stored in `.tuxgg-backups` under the current user's home directory. Set `TUXGG_BACKUP_DIR` to use another secured location. The backup is retained after success. Install PostgreSQL client utilities and keep `pg_dump` and `pg_restore` on `PATH`; Windows users can set `TUXGG_PG_DUMP` and `TUXGG_PG_RESTORE` to their executable paths.

To inspect or test a backup, restore it to a separate review database. Do not restore over the live database until the application is stopped and the recovery target has been independently confirmed.

```powershell
pg_restore --list "C:\path\to\tuxgg-YYYYMMDDTHHMMSS.dump"
createdb tuxgg_restore_review
pg_restore --no-owner --no-acl --dbname=tuxgg_restore_review "C:\path\to\tuxgg-YYYYMMDDTHHMMSS.dump"
```

The archive contains the database schema and rows, not PostgreSQL roles or their passwords. Existing role credentials remain unchanged. Keep backups access-restricted because they contain account and community report data.

If migration succeeds but a later grant check fails, the database is not reset or rolled back automatically. Review the diagnostic, correct the missing maintenance/migration permission, and rerun `pnpm db:upgrade`; the recorded migration will not be duplicated, and the grant repair is independently repeatable.

## Disposable integration database

`scripts/prepare_test_database.py` creates or verifies only the marked `tuxgg_test` database. The upgrade integration suite clones that marked database into a uniquely named temporary database with its own marker and only applies destructive fixture setup to that disposable clone. Normal `pnpm db:upgrade` refuses all test database names.

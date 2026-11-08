# Database setup and recovery

## One configured PostgreSQL account

Copy `.env.example` to `.env` and fill in the database password and private auth secret. Keep `.env` outside Git.

```dotenv
DB_CONNECTION=pgsql
DB_HOST=127.0.0.1
DB_PORT=5432
DB_DATABASE=vapourdb
DB_USERNAME=postgres
DB_PASSWORD=YOUR_POSTGRES_PASSWORD
BETTER_AUTH_SECRET=YOUR_EXISTING_AUTH_SECRET
BETTER_AUTH_URL=http://127.0.0.1:5174
PUBLIC_SITE_URL=http://127.0.0.1:5174
ORIGIN=http://127.0.0.1:5174
STEAM_API_KEY=
PUBLIC_CONTACT_EMAIL=
NODE_ENV=development
```

`DB_CONNECTION=pgsql` selects PostgreSQL. The same username and password are used by the web runtime, Better Auth, Drizzle migrations, setup, restore and Steam commands, backup, and diagnostics. The password is passed as a PostgreSQL option and may contain URL-special characters. `DATABASE_URL` and old role-specific URLs are ignored.

With Docker PostgreSQL published on the Windows host, `DB_HOST=127.0.0.1` and `DB_PORT` is the published **host** port. Inspect it with:

```powershell
docker ps --format "table {{.Names}}`t{{.Ports}}"
Test-NetConnection 127.0.0.1 -Port 5432
```

The application browser origin remains `http://127.0.0.1:5174`. A Windows-host process uses the published host port. A container must use a database service name on a shared Docker network or a host gateway address; `127.0.0.1` inside the app container points back to that app container.

## Zero-prompt setup and restore

Run these commands in PowerShell after `pnpm install` and after filling in `.env`:

```powershell
pnpm db:setup
pnpm db:doctor
pnpm db:migrate
pnpm db:restore:games -- "$HOME\.tuxgg-backups\tuxgg-games-20261107.csv"
pnpm db:games:count
pnpm dev
```

If `vapourdb` is absent, `db:setup` first tries the configured target. It then connects internally to PostgreSQL's conventional `postgres` maintenance database with the exact same `DB_HOST`, `DB_PORT`, `DB_USERNAME`, and `DB_PASSWORD`, creates `vapourdb`, reconnects to verify it, and prepares the Drizzle tracking schema if needed. The account needs `CREATEDB` (or superuser) only when creating a missing database. No other URL, account, password, prompt, wizard, or admin variable is involved.

For an existing `vapourdb`, setup only checks the target and schema permissions. It never drops, replaces, resets, renames, takes ownership of, or changes the password or attributes of an existing database or role. It preserves `drizzle.__drizzle_migrations`. `DB_DATABASE` must be exactly `vapourdb` for setup and ordinary application commands; `tuxgg` is never selected by setup, migrations, restore, or writes.

The configured login must be able to connect to `vapourdb`, create application objects in schema `public`, and create migration tracking objects in schema `drizzle`. If the `drizzle` schema is absent, setup can create it when the login has database-level `CREATE`; if it exists, the login needs `CREATE` on that schema. Catalog restore needs `SELECT`, `INSERT`, and `UPDATE` on `public.games`. A role with sufficient schema/database rights can perform all local development operations. A local PostgreSQL superuser such as `postgres` is accepted. For publicly exposed production deployments, choose a non-superuser login with only the required database/schema/table rights.

## Diagnostics and migrations

`pnpm db:doctor` is read-only. It reports the configured host, port, database, username, connection status, server address, relevant privileges, application tables, and Drizzle migration history without printing a password or full connection string. It also prints Windows/Docker published-port checks. Connection attempts use a bounded timeout.

`pnpm db:migrate` applies pending historical SQL from `drizzle/` with the configured login. It uses connection, lock, and statement timeouts. On failure it reports visible blocked sessions for inspection and never terminates sessions automatically. Setup and migration can be rerun safely; no migration history is dropped or regenerated.

If the missing database cannot be created, grant `CREATEDB` to the configured account or create `vapourdb` deliberately, then rerun setup. If PostgreSQL cannot be reached, check `docker ps`, the published host port, and `Test-NetConnection`. If schema checks fail, grant the configured account `CREATE` on `public` and `drizzle` (or database `CREATE` when `drizzle` does not yet exist). Authentication and privilege errors do not print credentials.

## Games data and legacy backup files

The historical export `%USERPROFILE%\.tuxgg-backups\tuxgg-games-20261107.csv` is an external user file and must remain unchanged. Restore its contents into `vapourdb` only after migrations. The restore validates the CSV header and unique AppIDs, inserts/upserts in one transaction, merges nested metadata, and preserves usable artwork, slugs, Unicode, NULL values, and timestamps. Repeating the restore is safe. `db:games:count` is read-only and checks total rows against distinct AppIDs; the expected 36,884 / 36,884 count refers to the user's real catalog, not CI fixtures.

Historical `tuxgg-games-*` CSV, dump, and manifest formats remain supported. Checksum and manifest identity validation remains strict. The old `tuxgg` database is never a restore target and is not migrated or modified.

`pnpm db:backup:games` uses the configured account for source export and checksums. Its manifest records either `full-disposable-restore` or `archive-readable`, and the command prints the same level. With `CREATEDB`, it restores into a strictly named disposable database (`vapourdb_games_verify_*`), confirms every row and AppID plus representative records, then cleans up that database. For an empty catalog, the full-level evidence is zero restored rows and zero representative records because no sample exists. Without `CREATEDB`, the CSV row/AppID checks, checksums, and PostgreSQL archive readability are verified; the archive itself is not restored or independently checked. The verifier returns the recorded level, rejects fabricated restore evidence, and continues to accept historical manifests without a level only when their full restore evidence is valid. The command does not ask for an admin URL and never restores into live `public.games`.

## Disposable tests

Integration tests run only against the dedicated `vapourdb_test` database with `VAPOURDB_TEST_DATABASE=1`, `GITHUB_ACTIONS=true`, and a verified safety marker. The web runtime accepts `vapourdb` in normal operation; its test exception requires both CI flags and checks `current_database()` plus the database marker before serving requests. CI provisions its own disposable PostgreSQL service and uses the same configured login for the test database. Test fixtures refuse unmarked databases and never accept `vapourdb` or `tuxgg` as a write target. Do not set the test marker for a real database.

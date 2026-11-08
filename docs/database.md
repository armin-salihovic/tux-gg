# Database setup and recovery

## Local development: one database URL

This workflow assumes PostgreSQL is running in a Docker container and VapourDB runs on the Windows host. The host connects to the container through a **published host port**. It does not use a Docker-only service name.

Copy `.env.example` to `.env` and keep it private. The database setting is one URL:

```dotenv
DATABASE_URL=postgresql://vapourdb_dev:YOUR_LOCAL_PASSWORD@127.0.0.1:5432/vapourdb
BETTER_AUTH_SECRET=YOUR_EXISTING_SECRET
BETTER_AUTH_URL=http://127.0.0.1:5174
PUBLIC_SITE_URL=http://127.0.0.1:5174
ORIGIN=http://127.0.0.1:5174
STEAM_API_KEY=
```

Set `YOUR_LOCAL_PASSWORD` to a private local password and use the same host spelling and port throughout the browser session. The auth secret must be a private random value. Ordinary local database commands do not need `DATABASE_URL_DOCKER`, `PGADMIN_URL`, `MIGRATION_DATABASE_URL`, or `IMPORTER_DATABASE_URL`.

In PowerShell, inspect the current container port mappings and test the host-side port:

```powershell
docker ps --format "table {{.Names}}`t{{.Ports}}"
Test-NetConnection 127.0.0.1 -Port 5432
pnpm db:doctor
```

If Docker published PostgreSQL on another host port, use that port in `DATABASE_URL` and in `Test-NetConnection`. `db:doctor` is read-only. It reports the configured target without its password, attempts a bounded connection, checks the current database and role, schema/migration tables, and optionally lists running Docker port mappings. It cannot inspect a stopped or remote Docker daemon.

Run setup and migrations:

```powershell
pnpm db:setup
pnpm db:migrate
```

`db:setup` only verifies an existing local `vapourdb_dev` role and `vapourdb` database. On a fresh cluster, if either is missing, run:

```powershell
pnpm db:setup -- --bootstrap
```

The command asks for a one-time maintenance URL with hidden input. That login must connect to the `postgres` maintenance database through the same loopback host and published port and be authorized to create roles and databases. It creates a non-administrator `vapourdb_dev` login and, only if absent, an empty `vapourdb` database owned by that role. It uses the password already configured in `DATABASE_URL`; it never stores the admin URL, rewrites `.env`, rotates an existing role password, changes old databases, or resets schema/data. For noninteractive setup, pass the admin URL only to that process as `VAPOURDB_BOOTSTRAP_ADMIN_URL` and remove it from the shell afterward.

If the database exists but lacks `vapourdb_dev`, setup stops rather than taking over a potentially populated database. Have an administrator inspect that database and provision ownership deliberately. The restricted production `vapourdb_web` account must not be converted into a schema owner or administrator.

Apply the schema, restore the historical CSV, and verify the catalog:

```powershell
pnpm db:migrate
pnpm db:restore:games -- "C:\path\to\tuxgg-games-YYYYMMDD.csv"
pnpm db:games:count
pnpm exec vite dev --host 127.0.0.1 --port 5174 --strictPort
```

The CSV may be restored without its old database, `.dump`, or a manifest. The importer validates the CSV header and unique AppIDs, performs an AppID-based upsert in one transaction, recursively merges JSON metadata, and preserves usable artwork, slugs, Unicode, NULLs, and timestamps. `db:games:count` is read-only and reports total rows and distinct AppIDs. Repeating an import is safe.

`pnpm db:grant` is not part of this local workflow. A local `vapourdb_dev` role owns the development database and can migrate its schema and update its catalog; it has no superuser, role-creation, database-creation, replication, or broad data-access membership.

### Local troubleshooting

| Symptom                                                 | Check                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `localhost` fails but `127.0.0.1` works, or the reverse | `localhost` may resolve to `::1` while Docker publishes only IPv4. Choose one reachable host and keep the Vite/auth URLs on one origin. `::1` is not proof that IPv4 works.                                                                                                      |
| `Test-NetConnection` fails                              | Inspect `docker ps --format "table {{.Names}}\t{{.Ports}}"`; confirm PostgreSQL is published on the Windows host. `docker port <selected-container>` shows that container's mapping.                                                                                             |
| Port 5432 is already in use                             | Check listeners with `Get-NetTCPConnection -LocalPort 5432 -State Listen                                                                                                                                                                                                         | Select-Object LocalAddress,LocalPort,OwningProcess`, then inspect the PID using `Get-Process -Id <PID>`. A listener alone does not prove it belongs to Docker or accepts the expected address family. |
| Wrong PostgreSQL port                                   | Put the published **host** port in `DATABASE_URL`; the container's internal port is often 5432 but can differ.                                                                                                                                                                   |
| Host app works, app container does not                  | `127.0.0.1` inside a container points to that container. Use the database service/container name on a shared Docker network, or the host gateway/published host port. Set that reachable address in the container's `DATABASE_URL`; there is no duplicate `DATABASE_URL_DOCKER`. |
| Authentication failed                                   | Confirm the username is `vapourdb_dev` and that `DATABASE_URL` has the current password. `db:setup` never changes it.                                                                                                                                                            |
| Database or role is missing                             | Use the explicit one-time bootstrap only when the database is absent and the maintenance login is authorized. Existing databases missing their owner role require deliberate administrator review.                                                                               |
| Migration waits or fails after connecting               | Preflight uses a five-second connection timeout. Drizzle is given a 15-second lock timeout and 120-second statement timeout. On a lock failure, inspect the reported `pg_stat_activity` PIDs and `pg_blocking_pids`; the command does not terminate another session.             |

## Production and advanced operations

Production keeps three restricted credentials. `DATABASE_URL` is the web runtime role; `IMPORTER_DATABASE_URL` is limited to catalog reads/upserts; and `MIGRATION_DATABASE_URL` is the schema owner used by a deliberate migration process. The web role cannot edit games, moderate reports, or change schema. Importer and migration URLs are required for their production operations; no production command falls back to the web credential. Report moderation keeps its separate operator connection.

For provisioning, configure the three role URLs and a protected operator-only `PGADMIN_URL`, then run `pnpm db:setup:production`. The role URLs identify the intended roles and passwords; setup will not rotate existing passwords or write URLs into `.env`. For the reviewed post-migration grants, run `pnpm db:grant`. This command exists for production/multi-role deployments, not single-role local development. Keep operator URLs in a secret manager or transient process environment, never in the web container. See [deployment](deployment.md) for Compose and release operations.

Compose passes one `DATABASE_URL` to the app container. Point that URL at an address the app container can reach: a database service name on a shared network, or the published host gateway address. A Windows-host app instead uses the Windows loopback host port.

## Games backups and legacy data

`pnpm db:backup:games` creates a PostgreSQL custom archive, CSV, and SHA-256 manifest outside the repository. Archive verification creates a disposable database, so provide an operator URL transiently as `GAMES_BACKUP_VERIFY_ADMIN_URL` when one is not configured. Backups use self-consistent `vapourdb-games-*` or `tuxgg-games-*` names and manifests based on the source database identity. Historical manifests remain supported and checksum verification stays strict.

The previous `tuxgg` database is not renamed, migrated, reset, or selected by local write commands. The developer workflow restores only the previously exported games CSV into a fresh `vapourdb` schema. Old account, device, report, and session data remains in the untouched legacy database.

## Test database safety

Integration fixtures use only the explicitly named `vapourdb_test` database and require its safety marker. The marker is created only for a fresh empty database; an unmarked database with application objects is refused. Normal `vapourdb` and legacy `tuxgg` databases are never accepted for fixture writes. Keep `TEST_DATABASE_URL` and administrator/test role URLs confined to ephemeral test infrastructure.

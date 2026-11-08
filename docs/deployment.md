# Deployment

## Database setup

For a **new installation**, configure `PGADMIN_URL` to an administrator connection on PostgreSQL's `postgres` database, install Python dependencies, run `pnpm db:setup` once, and apply the current baseline with `pnpm db:migrate`. Restore the verified games CSV with `pnpm db:restore:games -- <games.csv>` before starting the app.

The baseline is intended for an empty schema. `pnpm db:dev:reset -- --force` is refused. `pnpm db:dev:reset -- --initialize-empty` accepts only a verified local database with no application objects; it never drops or recreates existing data. Never run development setup or reset commands against production or staging. Production schema changes remain an explicit operator migration. See [database.md](database.md).

Run migrations with `vapourdb_migrator`; the web process receives only `DATABASE_URL`. Keep `IMPORTER_DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `PGADMIN_URL` in a host-side secret file or secret manager. Existing local `tuxgg_*` role URLs remain supported until a verified in-place identity migration is completed.

## Application configuration

Set a random `BETTER_AUTH_SECRET` of at least 32 bytes, `BETTER_AUTH_URL`, canonical `PUBLIC_SITE_URL`, and externally visible `ORIGIN`. `BETTER_AUTH_URL` and `PUBLIC_SITE_URL` must match and have no path; production origins must use HTTPS. `STEAM_API_KEY` is optional for public profile enrichment and is required for Steamworks catalog discovery. Set `PUBLIC_CONTACT_EMAIL` to a monitored address and replace example operator/legal details before public launch.

Steam OpenID does not use a client ID or secret. The realm is `PUBLIC_SITE_URL`, and the callback path comes from Better Auth's configured base path. The server validates the origin, SteamID64, signed OpenID fields, assertion, and nonce. Tests mock Steam and need no real account credentials.

## Docker Compose

Copy `.env.production.example` to `.env`, fill in the secrets and database URLs, then run:

```sh
docker compose build
docker compose up -d
docker compose ps
```

The app listens on container port 3000 and checks `/healthz`, which also verifies database connectivity. Compose binds it to `127.0.0.1:3000` for a reverse proxy on the host. Terminate TLS at the proxy, forward the original host and protocol, and set `ORIGIN`, `PUBLIC_SITE_URL`, and `BETTER_AUTH_URL` to the public HTTPS origin. For a proxy in Docker, use a private Docker network instead of the host port mapping. `DATABASE_URL_DOCKER` can point to PostgreSQL as seen from the app container. Compose passes only the web credential and public application settings to the app.

## Operations

- Run `pnpm db:backup:games` and confirm all verification steps pass before catalog maintenance.
- Keep the archive, CSV, and manifest in a secured location outside Git. Before any operation touching accounts, sessions, devices, or reports, create and verify a separate full-database backup.
- Use `pnpm steam:sync -- --dry-run` to preview stale metadata without Steam requests or database writes. Applied refreshes select at most 10 games by default, can be raised to 20, skip entries fetched in the last 30 days, and wait at least two seconds between requests. Add `--force` only for an intentional refresh.
- Use `pnpm steam:discover -- --limit 1000` to preview a page of new Steam catalog entries; pass `--apply` to upsert new entries.
- Keep `NATIVE_REPORT_OPERATOR_DATABASE_URL` outside the web container and use it only for `python scripts/moderate_native_reports.py` commands.
- Keep database and authentication credentials in a host secret store or a permission-restricted environment file.

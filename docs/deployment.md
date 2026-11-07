# Deployment

## Database setup

For a **new installation**, configure `PGADMIN_URL` to an administrator connection on PostgreSQL's `postgres` database, install Python dependencies, run `pnpm db:setup` once, and apply the current baseline with `pnpm db:migrate`. Restore the verified games CSV with `pnpm db:restore:games -- <games.csv>` before starting the app.

The baseline is intended for an empty schema. This repository does not reset a database or automatically drop ProtonDB-era tables. For a database using the previous schema, first create and verify `pnpm db:backup:games`, then review a controlled cutover plan for native reports, auth, devices, and any legacy data before changing its schema. See [database.md](database.md).

Run migrations with `tuxgg_migrator`; the web process receives only `DATABASE_URL`. Keep `IMPORTER_DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `PGADMIN_URL` in a host-side secret file or secret manager.

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

- Run `pnpm db:backup:games` and confirm all verification steps pass before a schema cleanup.
- Keep the archive and CSV in a secured location outside Git.
- Use `pnpm steam:sync -- --ids <appids> --dry-run` to preview up to 20 existing games. The default request spacing is at least two seconds.
- Use `pnpm steam:discover -- --limit 1000` to preview a page of new Steam catalog entries; pass `--apply` to upsert new entries.
- Keep `NATIVE_REPORT_OPERATOR_DATABASE_URL` outside the web container and use it only for `python scripts/moderate_native_reports.py` commands.
- Keep database and authentication credentials in a host secret store or a permission-restricted environment file.

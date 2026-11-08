# Deployment

## Database account

Configure one PostgreSQL account in the deployment environment with `DB_CONNECTION=pgsql`, `DB_HOST`, `DB_PORT`, `DB_DATABASE=vapourdb`, `DB_USERNAME`, and `DB_PASSWORD`. The same account is used by the web runtime and operational commands. Setup and migrations require `CREATE` on application schema `public` and Drizzle schema `drizzle`; setup also needs `CREATEDB` only when the target database is missing. Catalog restore requires `SELECT`, `INSERT`, and `UPDATE` on `public.games`.

For a publicly exposed deployment, use an independently chosen non-superuser account with only the required privileges. The application does not require a role matrix or second maintenance URL. See [database setup](database.md).

## Application configuration

Set a random `BETTER_AUTH_SECRET` of at least 32 bytes, `BETTER_AUTH_URL`, canonical `PUBLIC_SITE_URL`, and externally visible `ORIGIN`. `BETTER_AUTH_URL` and `PUBLIC_SITE_URL` must match and have no path; production origins must use HTTPS. `STEAM_API_KEY` is optional for public profile enrichment and is required for Steamworks catalog discovery. Set `PUBLIC_CONTACT_EMAIL` to a monitored address and replace example operator/legal details before public launch.

Steam OpenID does not use a client ID or secret. The realm is `PUBLIC_SITE_URL`, and the callback path comes from Better Auth's configured base path. The server validates the origin, SteamID64, signed OpenID fields, assertion, and nonce. Tests mock Steam and need no real account credentials.

## Docker Compose

Copy `.env.production.example` to `.env`, set the database fields and application secrets, then run:

```sh
docker compose build
docker compose up -d
docker compose ps
```

The app listens on container port 3000 and checks `/healthz`, which also verifies database connectivity. Compose binds it to `127.0.0.1:3000` for a reverse proxy on the host. Terminate TLS at the proxy, forward the original host and protocol, and set `ORIGIN`, `PUBLIC_SITE_URL`, and `BETTER_AUTH_URL` to the public HTTPS origin. For a proxy in Docker, use a private Docker network instead of the host port mapping. `DB_HOST` must be reachable from the app container, such as a database service name on a shared Docker network or the published host gateway. A Windows-host app uses the Windows loopback host port.

## Operations

- Run `pnpm db:backup:games` and review its reported verification level before catalog maintenance.
- Keep archive, CSV, and manifest files in a secured location outside Git. Before an operation touching accounts, sessions, devices, or reports, create and verify a separate full-database backup.
- Use `pnpm steam:sync -- --dry-run` to preview stale metadata without database writes. Applied refreshes select at most 10 games by default, can be raised to 20, skip entries fetched in the last 30 days, and wait at least two seconds between requests. Add `--force` only for an intentional refresh.
- Use `pnpm steam:discover -- --limit 1000` to preview a page of new Steam catalog entries; pass `--apply` to upsert new entries.
- Keep the database password and authentication secrets in a host secret store or permission-restricted environment file.

# Deployment

## Before deployment

1. Set `PGADMIN_URL` to an administrator connection on the `postgres` maintenance database. Keep it on the deployment host and run `pnpm db:setup` once. Setup creates `tuxgg_web`, `tuxgg_importer`, and `tuxgg_migrator`, and changes schema privileges only after connecting to `tuxgg`.
2. Run `pnpm db:migrate` with the generated `MIGRATION_DATABASE_URL`, then run `pnpm db:grant` to apply the reviewed table grants. Repeat the grant command after each migration that adds tables.
3. Import and inspect the local corpus using `IMPORTER_DATABASE_URL`. Do not pass importer or migration credentials to the web container. Do not add source archives or private `.env` files to the container image.
4. Set a random `BETTER_AUTH_SECRET` of at least 32 bytes, Discord OAuth credentials, the exact HTTPS `BETTER_AUTH_URL`, canonical `PUBLIC_SITE_URL`, and the externally visible `ORIGIN`.
5. Set `PUBLIC_CONTACT_EMAIL` to a monitored address and replace example operator/legal details before opening the service publicly.
6. Register `${BETTER_AUTH_URL}/api/auth/callback/discord` as the Discord application's OAuth redirect URI.

## Docker Compose

Copy `.env.production.example` to `.env`, fill in the secrets and generated database URLs, then run:

```sh
docker compose build
docker compose up -d
docker compose ps
```

The app listens on container port 3000 and checks `/healthz`, which also verifies database connectivity. Compose binds it to `127.0.0.1:3000` for a reverse proxy running on the host. Terminate TLS at the proxy, forward the original host and protocol, and set `ORIGIN` to the exact public HTTPS origin so SvelteKit can validate requests behind the proxy. Keep `PUBLIC_SITE_URL` and `BETTER_AUTH_URL` on that same origin. For a proxy in Docker, attach both services to a private Docker network and remove the host port mapping. `DATABASE_URL_DOCKER` should point to PostgreSQL as seen from the container (for a host PostgreSQL service, `host.docker.internal`). Compose reads `.env` for interpolation but passes only the web credential and application settings to the app. The production image runs as the Node user and excludes report archives.

## Operations

- Back up PostgreSQL and test restore procedures.
- Rebuild summaries after full import or any scoring logic change.
- Run migrations with `tuxgg_migrator`, then refresh the web/importer table grants. Keep the migration URL out of the web process.
- Use `tuxgg_web` for the SvelteKit process and `tuxgg_importer` for ProtonDB imports. The web role can read imported reports but cannot insert/update them or change summaries; the importer role has no access to Better Auth tables.
- For existing installations using `tuxgg_app`, rerun `pnpm db:setup`, review the generated URLs, restart the web service, and switch import jobs to `IMPORTER_DATABASE_URL`. The legacy login receives web-only grants so an old process can continue during the credential transition.
- Keep database and authentication credentials in the host secret store or a permission-restricted environment file.
- Review privacy, contact, licensing, and operator details before public launch.

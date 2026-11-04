# Deployment

## Before deployment

1. Create a PostgreSQL database and configure separate administrator/migration and runtime credentials. Keep `PGADMIN_URL` and `MIGRATION_DATABASE_URL` in a host-side secret file or secret manager; the Compose app service receives only `DATABASE_URL` and application settings.
2. Apply migrations with `MIGRATION_DATABASE_URL` using `pnpm db:migrate`, then run `pnpm db:grant` as an administrator.
3. Import and inspect the local corpus using the importer. Do not add the source archives or private `.env` file to the container image.
4. Set a random `BETTER_AUTH_SECRET` of at least 32 bytes, Discord OAuth credentials, the exact HTTPS `BETTER_AUTH_URL`, and the canonical `PUBLIC_SITE_URL`.
5. Set `PUBLIC_CONTACT_EMAIL` to a monitored address and replace example operator/legal details before opening the service publicly.
6. Register the Discord callback URL as `${BETTER_AUTH_URL}/api/auth/callback/discord` in the Discord application.

## Docker Compose

Copy `.env.production.example` to `.env`, fill in the secrets and database URLs, then run:

```sh
docker compose build
docker compose up -d
docker compose ps
```

The app listens on container port 3000 and checks `/healthz`, which also verifies database connectivity. Compose binds it to `127.0.0.1:3000` for a reverse proxy running on the host. For a proxy in Docker, attach both services to a private Docker network and remove the host port mapping. `DATABASE_URL_DOCKER` should point to the database host as seen from the container (for a local host PostgreSQL instance, `host.docker.internal`). Compose reads `.env` for interpolation but explicitly passes only the runtime allowlist to the app. The production image uses the Node 24 runtime user and excludes the report archives.

## Operations

- Back up PostgreSQL and test restore procedures.
- Rebuild summaries after full import or any scoring logic change.
- Apply migrations with the migration/admin URL; never grant schema creation privileges to `tuxgg_app`.
- Keep database and authentication credentials in the host secret store or a permission-restricted environment file.
- Review privacy, contact, licensing, and operator details before public launch.

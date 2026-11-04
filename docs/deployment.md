# Deployment

## Before deployment

1. Create a PostgreSQL database and configure separate administrator/migration and runtime credentials.
2. Apply `drizzle/0000_tuxgg_initial.sql` with `pnpm db:migrate`, then run `pnpm db:grant` as an administrator.
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

The app listens on port 3000 and checks `/healthz`, which also verifies database connectivity. `DATABASE_URL_DOCKER` should point to the database host as seen from the container (for a local host PostgreSQL instance, `host.docker.internal`). The production image uses the Node 24 runtime user and excludes the report archives.

## Operations

- Back up PostgreSQL and test restore procedures.
- Rebuild summaries after full import or any scoring logic change.
- Apply migrations with the migration/admin URL; never grant schema creation privileges to `tuxgg_app`.
- Keep database and authentication credentials in the host secret store or a permission-restricted environment file.
- Review privacy, contact, licensing, and operator details before public launch.

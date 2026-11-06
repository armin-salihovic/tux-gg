# Deployment

## Database setup

For a **new installation**, configure `PGADMIN_URL` as an administrator connection to the PostgreSQL `postgres` maintenance database, install Python dependencies, run `pnpm db:setup` once to provision the database and roles, then run `pnpm db:upgrade` to create the schema and verify the runtime grants.

For an **existing installation**, keep the current credentials and run this deployment step after pulling the new application code:

```powershell
pnpm db:upgrade
```

Do not run `pnpm db:setup` against an existing database. The upgrade checks that `DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `PGADMIN_URL` reach the expected `tuxgg` database on the same PostgreSQL installation. It checks applied migration hashes, verifies a backup before live changes, applies pending reviewed migrations, repairs the configured runtime role's least-privilege grants, and checks access through the real runtime connection. If migration or administrator permissions are insufficient, it stops with a diagnostic; it does not recreate roles, alter ownership, replace credentials, or drop data. See [database.md](database.md) for dry-run and recovery instructions.

The upgrade is an operator/deployment step, not a web application request. Run it before starting the new application version. The application process receives only `DATABASE_URL`; keep `IMPORTER_DATABASE_URL`, `MIGRATION_DATABASE_URL`, and `PGADMIN_URL` in a host-side secret file or secret manager.

## Application configuration

Set a random `BETTER_AUTH_SECRET` of at least 32 bytes, `BETTER_AUTH_URL`, canonical `PUBLIC_SITE_URL`, and externally visible `ORIGIN`. `BETTER_AUTH_URL` and `PUBLIC_SITE_URL` must be matching origin URLs with no path; production origins must use HTTPS. `STEAM_API_KEY` is optional and is used only to retrieve public Steam profile details. Set `PUBLIC_CONTACT_EMAIL` to a monitored address and replace example operator/legal details before opening the service publicly.

Steam OpenID does not use a client ID, client secret, or OAuth registration. The realm is the trusted `PUBLIC_SITE_URL` origin, and the callback path comes from Better Auth's configured authentication base path (normally `/api/auth/steam/callback`). The server checks that Better Auth's internal URL has the same origin and expected base path. Automated tests mock Steam and need no Steam credentials.

This Steam integration reuses the existing Better Auth user, account, session, and verification tables. Authentication setup does not reset or rewrite those tables.

## Docker Compose

Copy `.env.production.example` to `.env`, fill in the secrets and generated database URLs, then run:

```sh
docker compose build
docker compose up -d
docker compose ps
```

The app listens on container port 3000 and checks `/healthz`, which also verifies database connectivity. Compose binds it to `127.0.0.1:3000` for a reverse proxy running on the host. Terminate TLS at the proxy, forward the original host and protocol, and set `ORIGIN` to the exact public HTTPS origin so SvelteKit can validate requests behind the proxy. Keep `PUBLIC_SITE_URL` and `BETTER_AUTH_URL` on that same origin. For a proxy in Docker, attach both services to a private Docker network and remove the host port mapping. `DATABASE_URL_DOCKER` should point to PostgreSQL as seen from the container (for a host PostgreSQL service, `host.docker.internal`). Compose reads `.env` for interpolation but passes only the web credential and application settings to the app.

## Operations

- Keep the verified `pg_dump` backup created by each upgrade in a secured location. Test restores in a separate review database before a recovery operation.
- Rebuild summaries only after a full import or a scoring-logic change. Schema upgrades do not rebuild summaries.
- Run migrations with `tuxgg_migrator`; the configured web runtime role receives only reviewed table grants. Keep migration and administration credentials out of the web process.
- Use `tuxgg_web` for the SvelteKit process and `tuxgg_importer` for ProtonDB imports. The web role cannot insert/update imported reports or change summaries; the importer has no access to Better Auth tables.
- Keep `NATIVE_REPORT_OPERATOR_DATABASE_URL` outside the web container. Set it only in the operator's shell for `python scripts/moderate_native_reports.py list|approve|hide|remove`; see [native-reports.md](native-reports.md) for examples.
- Existing installations configured with `tuxgg_app` remain supported by `pnpm db:upgrade`; the upgrade grants that configured role and does not rotate credentials.
- Keep database and authentication credentials in the host secret store or a permission-restricted environment file.
- Review privacy, contact, licensing, and operator details before public launch.

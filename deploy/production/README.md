# VapourDB production runbook

This runbook deploys the private `armin-salihovic/tux-gg` repository as the GHCR package `ghcr.io/armin-salihovic/vapourdb` at `https://vapourdb.com`. Releases use a separate Compose project named `vapourdb`. VapourDB uses its already-created `vapourdb` database and login on the shared Netcup VPS, reached through the existing ElecParts PostgreSQL 17 container's `production_internal` Docker network. The application and database stay separate from ElecParts; this configuration never creates, recreates, or publishes a PostgreSQL service.

The GitHub release workflow runs the complete CI workflow at the tagged commit, publishes app and migration images tagged by release and commit, then connects over verified SSH. On the VPS it pulls both matching images, runs the migration command once, and only if that succeeds replaces the app container. The app is bound to `127.0.0.1:3000` for host Nginx. Compose's raw env-file format requires Docker Compose 2.30.0 or newer.

Without independent backups, a host, volume, or database failure, or an irreversible migration, can permanently lose VapourDB accounts, sessions, reports, devices, and game catalog. A Docker volume provides persistence, not a backup. Backups are not a deployment prerequisite; the operator accepts this recovery trade-off.

## 1. Verify the existing VPS resources

Run these read-only checks as the operator. Do not change the `production` Compose project or its PostgreSQL service.

```sh
docker --version
docker compose version
sudo ss -ltnp '( sport = :3000 )'
docker network inspect production_internal
docker inspect --format '{{.State.Running}}' production-postgres-1
docker inspect --format '{{range $name, $network := .NetworkSettings.Networks}}{{if eq $name "production_internal"}}{{range $network.Aliases}}{{println .}}{{end}}{{end}}{{end}}' production-postgres-1
```

Port 3000 should have no listener before the first deployment. The network inspection should show an existing `production_internal` network, and the final command should include the `postgres` alias. Confirm that the existing database and role accept the existing password without displaying it:

```sh
read -r -s -p 'Existing vapourdb role password: ' PGPASSWORD
printf '\n'
export PGPASSWORD
docker exec --env PGPASSWORD production-postgres-1 psql \
  -h 127.0.0.1 -U vapourdb -d vapourdb -v ON_ERROR_STOP=1 \
  -Atc "select current_database(), current_user, has_schema_privilege(current_user, 'public', 'CREATE');"
unset PGPASSWORD
```

The returned identity must be `vapourdb` / `vapourdb`, and schema CREATE must be true for the migration role. Do not reset the password, recreate the database, or change the ElecParts role. If authentication, database identity, or permissions do not match, stop and resolve that with the database operator before releasing.

## 2. Set up DNS, the origin certificate, and a separate Nginx site

Prepare an A record for `vapourdb.com` pointing at the VPS IPv4 address; keep it proxied when enabled. Add an AAAA record only if the VPS has a working public IPv6 address. Generate a Cloudflare Origin CA certificate specifically for `vapourdb.com`; the template does not assume the ElecParts certificate covers this domain. Store the certificate and private key outside the repository, for example at:

- `/etc/ssl/cloudflare/vapourdb.com.pem`
- `/etc/ssl/cloudflare/vapourdb.com.key`

Keep the private key readable only by root. From the local checkout, securely copy [`nginx.conf`](nginx.conf) to the VPS, then install it as a new site at `/etc/nginx/sites-available/vapourdb` and enable that same VapourDB site with a symlink at `/etc/nginx/sites-enabled/vapourdb`. Never replace `/etc/nginx/sites-available/elecparts`.

```sh
# From the local repository checkout:
scp deploy/production/nginx.conf elecparts@DEPLOY_HOST:/tmp/vapourdb.nginx.conf

# On the VPS:
sudo install -d -o root -g root -m 0755 /etc/ssl/cloudflare
sudo install -o root -g root -m 0644 /secure/location/vapourdb.com.pem /etc/ssl/cloudflare/vapourdb.com.pem
sudo install -o root -g root -m 0600 /secure/location/vapourdb.com.key /etc/ssl/cloudflare/vapourdb.com.key
sudo install -o root -g root -m 0644 /tmp/vapourdb.nginx.conf /etc/nginx/sites-available/vapourdb
sudo ln -s /etc/nginx/sites-available/vapourdb /etc/nginx/sites-enabled/vapourdb
sudo nginx -t
sudo systemctl reload nginx
```

Set Cloudflare SSL/TLS mode to **Full (strict)**. Keep the DNS record proxied during initial validation. The HTTPS server includes the host-maintained `/etc/nginx/cloudflare-realip.conf`, then uses `CF-Connecting-IP`; keep that include up to date with trusted Cloudflare ranges. The template overwrites `X-Forwarded-For` with `$remote_addr`, so client-supplied forwarding chains are not trusted. The site config only serves `vapourdb.com`; `www.vapourdb.com` needs its own DNS and certificate coverage before being enabled.

Keep public launch gated while the operator validates the origin and smoke tests the site. If available, configure a temporary Cloudflare Access allowlist for the operator before enabling the proxied DNS record; remove the gate only after the operator approves launch. If Access is unavailable, defer enabling the public DNS record until the operator finishes origin checks and approves cutover.

After deployment, check the public Cloudflare path with `curl -fsS https://vapourdb.com/healthz`. To test the origin directly, use the VPS origin address and a trusted Cloudflare Origin CA root, for example `curl --resolve vapourdb.com:443:ORIGIN_IP --cacert cloudflare-origin-ca-root.pem -fsS https://vapourdb.com/healthz`. An Origin CA certificate is trusted by Cloudflare for Full (strict), but not by an ordinary browser connecting directly to the origin.

## 3. Create the restricted runtime environment file

The existing directories should be owned by `elecparts` with modes `/opt/vapourdb` 0750 and `/opt/vapourdb-config` 0700. Create the config file as the deployment user and edit it using a secure terminal editor:

```sh
sudo install -o elecparts -g elecparts -m 0600 /dev/null /opt/vapourdb-config/vapourdb.env
sudoedit /opt/vapourdb-config/vapourdb.env
```

Use [`env.example`](env.example) as the field list. Set the existing database password and generate a new production-only Better Auth secret; do not reuse a local-development secret. This command generates a URL-safe secret for insertion into the file:

```sh
openssl rand -base64 48 | tr '+/' '-_' | tr -d '='
```

Keep these values exact: `NODE_ENV=production`, `HOST=0.0.0.0`, `PORT=3000`, `ORIGIN=https://vapourdb.com`, `BETTER_AUTH_URL=https://vapourdb.com`, `PUBLIC_SITE_URL=https://vapourdb.com`, `DB_CONNECTION=pgsql`, `DB_HOST=postgres`, `DB_PORT=5432`, `DB_DATABASE=vapourdb`, and `DB_USERNAME=vapourdb`. `STEAM_API_KEY` and `PUBLIC_CONTACT_EMAIL` are optional. The Compose file reads this as a raw env file, so special characters in the existing PostgreSQL password are passed literally; write each setting as one `KEY=value` line without shell expansion.

```sh
sudo chown elecparts:elecparts /opt/vapourdb-config/vapourdb.env
sudo chmod 0600 /opt/vapourdb-config/vapourdb.env
sudo -u elecparts test -r /opt/vapourdb-config/vapourdb.env
stat -c '%U:%a' /opt/vapourdb-config /opt/vapourdb-config/vapourdb.env
```

Do not `source` this file or put its values in GitHub Actions. The deploy script checks required non-secret values and verifies that the password and auth secret are present without printing either.

## 4. Configure private GHCR pulls and GitHub deployment access

On the VPS, sign in as `elecparts` and authenticate Docker to GHCR using a narrowly scoped read-only token with `read:packages` only. A credential helper is preferred if one is already configured. Otherwise Docker stores credentials in the deployment user's Docker config; keep that directory and file mode 0700/0600 and do not copy the token into a script or the repository.

```sh
sudo -iu elecparts
mkdir -p "$HOME/.docker"
chmod 0700 "$HOME/.docker"
read -r -p 'GHCR username: ' GHCR_USER
read -r -s -p 'GHCR read:packages token: ' GHCR_TOKEN
printf '\n'
printf '%s' "$GHCR_TOKEN" | docker login ghcr.io --username "$GHCR_USER" --password-stdin
unset GHCR_TOKEN GHCR_USER
chmod 0600 "$HOME/.docker/config.json"
```

In the private GitHub repository, create the `production` environment, require the intended reviewer approval, and allow the version tag pattern `v*` under its deployment branch/tag rules. Add these environment secrets and variable:

| Name                     | GitHub setting | Value                                             |
| ------------------------ | -------------- | ------------------------------------------------- |
| `DEPLOY_HOST`            | Secret         | VPS DNS name or address                           |
| `DEPLOY_SSH_PRIVATE_KEY` | Secret         | Dedicated non-root deployment key                 |
| `DEPLOY_KNOWN_HOSTS`     | Secret         | Host key line verified through a trusted channel  |
| `DEPLOY_USER`            | Variable       | Authorized non-root account, normally `elecparts` |

The account must be able to use Docker and write only to the pre-created `/opt/vapourdb` deployment directory. The workflow enforces strict SSH host-key checking, verifies the existing directory ownership and modes, and transfers only `compose.yml` and `deploy.sh` into `/opt/vapourdb`. It does not need a Git checkout or GitHub access token on the VPS. Keep the GHCR package private; if it is deliberately made public later, the VPS read token may be omitted and that visibility change should be documented.

## 5. Recovery limits

This release workflow does not create backups or require a backup approval. The existing Docker volume is the database's persistent storage; it does not protect against host, volume, or database loss. If recovery is needed, use an independently prepared recovery plan that targets only VapourDB. Do not modify ElecParts data or the historical `tuxgg` database or CSV.

## 6. Release, migrate, deploy, and smoke-test

After the VPS, DNS, certificate, environment file, GHCR pull access, and GitHub environment are ready, make sure the commit has passed normal CI on `main`. Create a new annotated semver-like tag from a clean, current `main`; never reuse or move a published tag:

```sh
git switch main
git pull --ff-only origin main
git status --short
git tag -a v0.1.0 -m 'VapourDB v0.1.0'
git push origin v0.1.0
```

The release workflow re-runs every CI check at that exact tagged commit, rejects tags not reachable from `main`, and refuses to replace any existing release or SHA image tags. It publishes the runtime image as both `v0.1.0` and `sha-<commit>`, with matching `-migration` tags and OCI revision labels. It then waits for the protected `production` environment and deploys. The VPS does not build the app and does not need Node, pnpm, Git, or a source checkout.

The remote deploy command is:

```sh
bash /opt/vapourdb/deploy.sh v0.1.0 <40-character-commit-sha>
```

Use the full commit SHA from the same successful release run as the `v0.1.0` tag.

It validates the release and private environment file, checks the existing PostgreSQL container/network alias, verifies both image revision labels, runs the one-off `node scripts/db_migrate.mjs` job against database `vapourdb`, then updates and checks the app. A migration failure exits before replacing the currently running app. It does not run `db:setup`, create a database, or migrate on every app start.

After the action reports success, verify the Docker health status and both endpoints:

```sh
VAPOURDB_IMAGE_REVISION=<deployed-commit-sha> VAPOURDB_RUNTIME_ENV_FILE=/opt/vapourdb-config/vapourdb.env \
  docker compose --project-name vapourdb --file /opt/vapourdb/compose.yml ps
curl -fsS http://127.0.0.1:3000/healthz
curl -fsS https://vapourdb.com/healthz
```

Then smoke-test `/`, `/games`, Steam OpenID login and callback, authorized access to the Users tab, unauthenticated access restrictions, and contact/legal pages. Confirm there are no HTTPS redirect loops. Do not run real Steam login E2E tests against production automatically.

If and only if all production app tables are empty, a specific source file has been reviewed, and the operator explicitly approves importing it, copy that CSV to a restricted, temporary path on the VPS. Verify its checksum and expected row/AppID count first. The migration image contains the repository's existing transactional `restore_games.mjs`; this command mounts only the approved CSV read-only and imports it only when manually run:

```sh
sudo install -d -o elecparts -g elecparts -m 0700 /opt/vapourdb-config/catalog-import
# From the local machine, transfer only the approved CSV to that directory.
scp /secure/local/path/approved-games.csv elecparts@DEPLOY_HOST:/opt/vapourdb-config/catalog-import/games.csv

# On the VPS, confirm every app table is empty before proceeding.
sha256sum /opt/vapourdb-config/catalog-import/games.csv
read -r -s -p 'Existing vapourdb role password: ' PGPASSWORD
printf '\n'
export PGPASSWORD
docker exec --env PGPASSWORD production-postgres-1 psql \
  -h 127.0.0.1 -U vapourdb -d vapourdb -v ON_ERROR_STOP=1 \
  -c "select (select count(*) from public.games) as games, (select count(*) from public.user) as users, (select count(*) from public.account) as accounts, (select count(*) from public.session) as sessions, (select count(*) from public.verification) as verifications, (select count(*) from public.native_reports) as reports, (select count(*) from public.user_devices) as devices;"
unset PGPASSWORD

# After all counts are zero and the source/hash are reviewed and approved:
export VAPOURDB_IMAGE_REVISION=<release-commit-sha>
export VAPOURDB_RUNTIME_ENV_FILE=/opt/vapourdb-config/vapourdb.env
docker compose --project-name vapourdb --file /opt/vapourdb/compose.yml --profile migrations run \
  --rm --no-deps \
  --volume /opt/vapourdb-config/catalog-import/games.csv:/input/games.csv:ro \
  --entrypoint node migrate scripts/restore_games.mjs /input/games.csv
```

Check the importer summary and independently verify the expected row count and AppIDs afterward. The deployment workflow never performs this import and never reaches into local Windows files. Retain or remove the temporary source file according to the operator's data-retention decision.

## 7. Roll back or pause deployment

Record the previous release tag and its matching commit SHA from the same successful Actions run. Check that the older app image is compatible with the current database schema before selecting it. To redeploy that app revision, the `elecparts` user can run the same guarded deploy command:

```sh
previous_tag='<tag-from-the-successful-release-run>'
previous_sha='<matching-40-character-commit-sha-from-that-run>'
bash /opt/vapourdb/deploy.sh "$previous_tag" "$previous_sha"
```

This reuses the immutable SHA-tagged images and runs any still-pending migrations before recreating the app. A prior image or release tag does not reverse database migrations. Stop if compatibility with the current schema is uncertain; the deploy command does not restore or reset the database.

For safe logs, provide the deployed revision and runtime env file when running Compose: `VAPOURDB_IMAGE_REVISION=<deployed-commit-sha> VAPOURDB_RUNTIME_ENV_FILE=/opt/vapourdb-config/vapourdb.env docker compose --project-name vapourdb --file /opt/vapourdb/compose.yml logs --tail=100 app`. Also inspect migration output from the deployment job. Do not run `docker inspect` without a format because it can display environment values. To pause new releases during an incident, disable the `Release production` workflow in GitHub Actions or remove its deployment authorization through the protected `production` environment. Do not stop or remove ElecParts services.

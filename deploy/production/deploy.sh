#!/usr/bin/env bash
set -Eeuo pipefail

readonly ROOT=/opt/vapourdb
readonly CONFIG_DIR=/opt/vapourdb-config
readonly RUNTIME_ENV_FILE="$CONFIG_DIR/vapourdb.env"
readonly COMPOSE_FILE="$ROOT/compose.yml"
readonly DB_CONTAINER=production-postgres-1
readonly DB_NETWORK=production_internal
readonly PROJECT=vapourdb
readonly APP_IMAGE=ghcr.io/armin-salihovic/vapourdb

fail() {
	printf 'VapourDB deployment stopped: %s\n' "$1" >&2
	exit 1
}

require_setting() {
	local key=$1 expected=$2
	if ! awk -F= -v key="$key" -v expected="$expected" '
		{
			line = $0
			sub(/\r$/, "", line)
			if (line ~ /^[[:space:]]*#/ || line ~ /^[[:space:]]*$/) next
			separator = index(line, "=")
			if (!separator) next
			name = substr(line, 1, separator - 1)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
			if (name != key) next
			count++
			value = substr(line, separator + 1)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
			if (value != expected) invalid = 1
		}
		END { exit !(count == 1 && !invalid) }
	' "$RUNTIME_ENV_FILE"; then
		fail "runtime configuration must set $key to its documented production value"
	fi
}

require_secret() {
	local key=$1
	if ! awk -F= -v key="$key" '
		{
			line = $0
			sub(/\r$/, "", line)
			if (line ~ /^[[:space:]]*#/ || line ~ /^[[:space:]]*$/) next
			separator = index(line, "=")
			if (!separator) next
			name = substr(line, 1, separator - 1)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", name)
			if (name != key) next
			count++
			value = substr(line, separator + 1)
			gsub(/^[[:space:]]+|[[:space:]]+$/, "", value)
			if (value == "") invalid = 1
			if (value == "replace-with-existing-vapourdb-role-password") invalid = 1
			if (value == "replace-with-a-new-production-secret") invalid = 1
			if (value ~ /^<.*>$/) invalid = 1
		}
		END { exit !(count == 1 && !invalid) }
	' "$RUNTIME_ENV_FILE"; then
		fail "runtime configuration must contain a non-placeholder $key"
	fi
}

[[ $# -eq 2 ]] || fail 'expected a release tag and 40-character commit SHA'
release_tag=$1
revision=$2
[[ $release_tag =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z.-]+)?$ ]] ||
	fail 'release tag is not a supported semver-like v* tag'
[[ $revision =~ ^[a-f0-9]{40}$ ]] || fail 'commit SHA is invalid'

[[ -f "$COMPOSE_FILE" && ! -L "$COMPOSE_FILE" ]] || fail 'Compose file is missing or is a symlink'
[[ -f "$RUNTIME_ENV_FILE" && ! -L "$RUNTIME_ENV_FILE" ]] ||
	fail 'VPS runtime environment file is missing or is a symlink'
grep -Fxq 'name: vapourdb' "$COMPOSE_FILE" || fail 'Compose project name must be vapourdb'
grep -Fxq '    external: true' "$COMPOSE_FILE" || fail 'PostgreSQL network must be external'
grep -Fxq '    name: production_internal' "$COMPOSE_FILE" ||
	fail 'PostgreSQL network name must be production_internal'
grep -Fq '127.0.0.1:3000:3000' "$COMPOSE_FILE" ||
	fail 'app port must be bound only to host loopback'
if grep -Eq '^  postgres:' "$COMPOSE_FILE"; then
	fail 'VapourDB Compose must not define a PostgreSQL service'
fi
[[ $(stat -c '%a' "$CONFIG_DIR") == 700 ]] || fail 'VPS config directory must have mode 0700'
[[ $(stat -c '%a' "$RUNTIME_ENV_FILE") == 600 ]] ||
	fail 'VPS runtime environment file must have mode 0600'
[[ $(stat -c '%U' "$RUNTIME_ENV_FILE") == "$(id -un)" ]] ||
	fail 'VPS runtime environment file must be owned by the deployment user'

require_setting NODE_ENV production
require_setting HOST 0.0.0.0
require_setting PORT 3000
require_setting ORIGIN https://vapourdb.com
require_setting BETTER_AUTH_URL https://vapourdb.com
require_setting PUBLIC_SITE_URL https://vapourdb.com
require_setting DB_CONNECTION pgsql
require_setting DB_HOST postgres
require_setting DB_PORT 5432
require_setting DB_DATABASE vapourdb
require_setting DB_USERNAME vapourdb
require_secret DB_PASSWORD
require_secret BETTER_AUTH_SECRET

docker network inspect "$DB_NETWORK" >/dev/null 2>&1 || fail 'existing PostgreSQL network is unavailable'
docker inspect --format '{{.State.Running}}' "$DB_CONTAINER" 2>/dev/null | grep -qx true ||
	fail 'existing PostgreSQL container is not running'
aliases=$(docker inspect --format '{{range $name, $network := .NetworkSettings.Networks}}{{if eq $name "production_internal"}}{{range $network.Aliases}}{{println .}}{{end}}{{end}}{{end}}' "$DB_CONTAINER") ||
	fail 'could not inspect the existing PostgreSQL network alias'
grep -Fxq postgres <<<"$aliases" || fail 'existing PostgreSQL container lacks the postgres network alias'

export VAPOURDB_IMAGE_REVISION="$revision"
export VAPOURDB_RUNTIME_ENV_FILE="$RUNTIME_ENV_FILE"
compose=(docker compose --project-name "$PROJECT" --file "$COMPOSE_FILE")
"${compose[@]}" config --quiet || fail 'production Compose configuration is invalid'

app_image="$APP_IMAGE:sha-$revision"
migration_image="$APP_IMAGE:sha-$revision-migration"
docker pull "$app_image" >/dev/null || fail 'could not pull the requested app image'
docker pull "$migration_image" >/dev/null || fail 'could not pull the matching migration image'

verify_image_revision() {
	local image=$1 actual
	actual=$(docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$image") ||
		fail 'could not inspect a pulled release image'
	[[ $actual == "$revision" ]] || fail 'pulled image revision does not match the requested commit'
}

verify_image_revision "$app_image"
verify_image_revision "$migration_image"

printf 'Running the one-off migration for %s (%s).\n' "$release_tag" "$revision"
"${compose[@]}" --profile migrations run --rm --no-deps migrate ||
	fail 'migration failed; the current app container was not replaced'

"${compose[@]}" up -d --no-deps --force-recreate app || fail 'app container update failed'
container_id=$("${compose[@]}" ps --quiet app)
[[ -n $container_id ]] || fail 'updated app container could not be found'
actual=$(docker inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$container_id") ||
	fail 'could not inspect the running app revision'
[[ $actual == "$revision" ]] || fail 'running app revision does not match the requested commit'

deadline=$((SECONDS + 180))
while (( SECONDS < deadline )); do
	health=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$container_id" 2>/dev/null || true)
	case "$health" in
		healthy) break ;;
		unhealthy) fail 'updated app failed its Docker healthcheck' ;;
		missing) fail 'updated app has no Docker healthcheck' ;;
	esac
	sleep 5
done
[[ ${health:-} == healthy ]] || fail 'updated app did not become healthy within 180 seconds'
curl --fail --silent --show-error --max-time 10 --output /dev/null http://127.0.0.1:3000/healthz ||
	fail 'host-local HTTP health verification failed'

printf 'VapourDB release %s (%s) is healthy.\n' "$release_tag" "$revision"

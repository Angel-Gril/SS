#!/usr/bin/env bash
# Build and deploy the supported Compose stack without running old API/Worker
# processes across migrations or the AI Media dark-rollout gate.

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
DEPLOY_RUN_USER="${DEPLOY_RUN_USER:-deploy}"
PROCESS_MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT-}"
unset MIGRATION_TIMEOUT
ENV_SNAPSHOT_DIR=""
SOURCE_SNAPSHOT_ROOT=""

fail() {
  printf '[deploy-compose] ERROR: %s\n' "$*" >&2
  exit 1
}

if [ "$(id -u)" = "0" ]; then
  fail "deploy-compose.sh must run as a non-root deployment operator"
fi
if [[ ! "$DEPLOY_RUN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] \
  || [ "$(id -un)" != "$DEPLOY_RUN_USER" ]; then
  fail "deploy-compose.sh must run directly as DEPLOY_RUN_USER"
fi

if ! REPOSITORY_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" \
  || [ "$(pwd -P)" != "$(cd -- "$REPOSITORY_ROOT" && pwd -P)" ]; then
  fail "deploy-compose.sh must run from the exact repository root"
fi

case "$COMPOSE_FILE" in
  docker-compose.prod.yml) DEPLOY_COMPOSE_PROJECT=ss-erp-prod ;;
  docker-compose.staging.yml) DEPLOY_COMPOSE_PROJECT=ss-erp-staging ;;
  *) fail "COMPOSE_FILE must be docker-compose.prod.yml or docker-compose.staging.yml" ;;
esac
command -v flock >/dev/null 2>&1 || fail "flock is required for serialized Compose deployment"
LOCK_ROOT="/var/lib/ss-erp-deploy-locks"
LOCK_FILE="$LOCK_ROOT/$DEPLOY_COMPOSE_PROJECT.lock"
DEPLOY_RUN_GID="$(id -g)"
if [ -L "$LOCK_ROOT" ] || [ ! -d "$LOCK_ROOT" ] \
  || [ "$(readlink -f -- "$LOCK_ROOT")" != "$LOCK_ROOT" ] \
  || [ "$(stat -c '%u:%g:%a' "$LOCK_ROOT")" != "0:$DEPLOY_RUN_GID:750" ] \
  || [ -L "$LOCK_FILE" ] || [ ! -f "$LOCK_FILE" ] \
  || [ "$(stat -c '%u:%g:%h:%a' "$LOCK_FILE")" != "0:$DEPLOY_RUN_GID:1:660" ]; then
  fail "global Compose deployment lock must be preinstalled by init-server.sh"
fi
exec 9<>"$LOCK_FILE"
flock -n 9 || fail "another $DEPLOY_COMPOSE_PROJECT deployment is already running"
if [ -L "$COMPOSE_FILE" ] || [ ! -f "$COMPOSE_FILE" ] || [ ! -r "$COMPOSE_FILE" ]; then
  fail "compose file must be one readable regular non-symbolic-link file: $COMPOSE_FILE"
fi
if [ -L "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ] || [ ! -r "$ENV_FILE" ]; then
  fail "environment file must be one readable regular non-symbolic-link file: $ENV_FILE"
fi

cleanup_environment_snapshot() {
  if [ -n "$ENV_SNAPSHOT_DIR" ] && [ -d "$ENV_SNAPSHOT_DIR" ]; then
    rm -rf -- "$ENV_SNAPSHOT_DIR"
  fi
}
trap cleanup_environment_snapshot EXIT
ENV_SNAPSHOT_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ss-erp-compose-env.XXXXXXXXXX")"
chmod 0700 "$ENV_SNAPSHOT_DIR"
SOURCE_ENV_FILE="$ENV_FILE"
SOURCE_COMPOSE_FILE="$COMPOSE_FILE"
ENV_FILE="$ENV_SNAPSHOT_DIR/environment.env"
COMPOSE_FILE="$ENV_SNAPSHOT_DIR/compose.yml"

if ! COMMIT_HASH="$(git rev-parse --verify --end-of-options 'HEAD^{commit}' 2>/dev/null)"; then
  fail "Compose deployment HEAD is not a commit"
fi
if [[ ! "$COMMIT_HASH" =~ ^[0-9a-f]{40}$ ]]; then
  fail "Compose deployment HEAD did not resolve to a full 40-character commit OID"
fi
readonly TARGET_GIT_COMMIT="$COMMIT_HASH"
if ! WORKTREE_STATUS="$(git status --porcelain --untracked-files=all -- . ':(exclude)DEPLOYED_COMMIT')"; then
  fail "could not inspect Compose deployment Git worktree"
fi
if [ -n "$WORKTREE_STATUS" ]; then
  fail "Compose deployment requires a clean Git worktree"
fi
node scripts/verify-deploy-build-inputs.mjs "$TARGET_GIT_COMMIT" "$SOURCE_ENV_FILE"
SOURCE_ARCHIVE="$ENV_SNAPSHOT_DIR/source.tar"
SOURCE_SNAPSHOT_ROOT="$ENV_SNAPSHOT_DIR/source"
mkdir -m 0700 "$SOURCE_SNAPSHOT_ROOT"
git archive --format=tar -o "$SOURCE_ARCHIVE" "$TARGET_GIT_COMMIT"
DEPLOY_SOURCE_ARCHIVE_SHA256="$(sha256sum "$SOURCE_ARCHIVE" | awk '{print $1}')"
if [[ ! "$DEPLOY_SOURCE_ARCHIVE_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  fail "could not hash the target commit source archive"
fi
tar -xf "$SOURCE_ARCHIVE" -C "$SOURCE_SNAPSHOT_ROOT"
mv "$SOURCE_ARCHIVE" "$SOURCE_SNAPSHOT_ROOT/.ss-erp-source.tar"
SOURCE_COMPOSE_FILE="$SOURCE_SNAPSHOT_ROOT/$SOURCE_COMPOSE_FILE"
DEPLOY_ENV_TOOL="$SOURCE_SNAPSHOT_ROOT/scripts/deploy-environment.mjs"
node "$DEPLOY_ENV_TOOL" snapshot "$SOURCE_ENV_FILE" "$ENV_FILE"
node "$DEPLOY_ENV_TOOL" snapshot-file "$SOURCE_COMPOSE_FILE" "$COMPOSE_FILE"
node "$SOURCE_SNAPSHOT_ROOT/scripts/validate-env.mjs" \
  --profile cloud-bootstrap --env "$ENV_FILE"
if [ -L DEPLOYED_COMMIT ] || [ -e DEPLOYED_COMMIT ]; then
  if [ -L DEPLOYED_COMMIT ] || [ ! -f DEPLOYED_COMMIT ]; then
    fail "DEPLOYED_COMMIT must be one regular non-symbolic-link file"
  fi
  if ! MARKER_COMMIT="$(node -e '
const fs = require("node:fs");
const value = fs.readFileSync("DEPLOYED_COMMIT", "utf8");
const match = value.match(/^([a-f0-9]{40})(?:\n)?$/);
if (!match) process.exit(1);
process.stdout.write(match[1]);
')" || [ "$MARKER_COMMIT" != "$COMMIT_HASH" ]; then
    fail "DEPLOYED_COMMIT must exactly match Compose deployment HEAD"
  fi
fi

if [ -n "$PROCESS_MIGRATION_TIMEOUT" ]; then
  MIGRATION_TIMEOUT="$PROCESS_MIGRATION_TIMEOUT"
else
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    if [[ ! "$line" =~ ^[[:space:]]*(export[[:space:]]+)?MIGRATION_TIMEOUT[[:space:]]*= ]]; then
      continue
    fi
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?MIGRATION_TIMEOUT[[:space:]]*=[[:space:]]*([1-9][0-9]*[smh])[[:space:]]*(#.*)?$ ]]; then
      MIGRATION_TIMEOUT="${BASH_REMATCH[2]}"
    elif [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?MIGRATION_TIMEOUT[[:space:]]*=[[:space:]]*\"([1-9][0-9]*[smh])\"[[:space:]]*(#.*)?$ ]]; then
      MIGRATION_TIMEOUT="${BASH_REMATCH[2]}"
    elif [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?MIGRATION_TIMEOUT[[:space:]]*=[[:space:]]*\'([1-9][0-9]*[smh])\'[[:space:]]*(#.*)?$ ]]; then
      MIGRATION_TIMEOUT="${BASH_REMATCH[2]}"
    else
      fail "MIGRATION_TIMEOUT in $ENV_FILE must be a literal positive duration ending in s, m, or h"
    fi
  done < "$ENV_FILE"
fi
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-20m}"
if [[ ! "$MIGRATION_TIMEOUT" =~ ^[1-9][0-9]*[smh]$ ]]; then
  fail "MIGRATION_TIMEOUT must be a positive duration ending in s, m, or h"
fi

readonly COMPOSE_FILE ENV_FILE MIGRATION_TIMEOUT DEPLOY_COMPOSE_PROJECT DEPLOY_RUN_USER \
  DEPLOY_SOURCE_ARCHIVE_SHA256 SOURCE_SNAPSHOT_ROOT
DEPLOY_TARGET_GIT_COMMIT="$TARGET_GIT_COMMIT"

export ENV_FILE MIGRATION_TIMEOUT DEPLOY_TARGET_GIT_COMMIT DEPLOY_SOURCE_ARCHIVE_SHA256
unset COMPOSE_PROJECT_NAME DEPLOY_BACKUP_LOCAL_DIR \
  NEXT_PUBLIC_ADMIN_HOSTNAME NEXT_PUBLIC_API_BASE_URL NEXT_PUBLIC_MARKETING_HOSTNAME \
  NEXT_PUBLIC_RUNTIME_MODE NEXT_PUBLIC_SENTRY_DSN NEXT_PUBLIC_TURNSTILE_SITE_KEY \
  NEXT_PUBLIC_USER_HOSTNAME
COMPOSE=(docker compose --project-name "$DEPLOY_COMPOSE_PROJECT" \
  --project-directory "$SOURCE_SNAPSHOT_ROOT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
"${COMPOSE[@]}" config --quiet

printf '[deploy-compose] Building images\n'
"${COMPOSE[@]}" build
node "$DEPLOY_ENV_TOOL" compare "$SOURCE_ENV_FILE" "$ENV_FILE"

SERVICES_QUIESCED=0
keep_quiesced_on_failure() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$SERVICES_QUIESCED" = "1" ]; then
    "${COMPOSE[@]}" stop worker api web || true
    printf '[deploy-compose] API/Worker/Web remain stopped; inspect migrate logs and the recovery runbook\n' >&2
  fi
  cleanup_environment_snapshot
  exit "$status"
}
trap keep_quiesced_on_failure EXIT

printf '[deploy-compose] Quiescing application services before migration\n'
"${COMPOSE[@]}" stop worker api web
SERVICES_QUIESCED=1

infra=(redis)
if "${COMPOSE[@]}" config --services | grep -qx postgres; then
  infra=(postgres redis)
fi
"${COMPOSE[@]}" up -d --wait "${infra[@]}"

printf '[deploy-compose] Running bounded migration and AI Media dark gate\n'
"${COMPOSE[@]}" run --rm --no-deps migrate

printf '[deploy-compose] Starting application services after successful gate\n'
"${COMPOSE[@]}" up -d --wait --force-recreate --no-deps api worker web
SERVICES_QUIESCED=0

printf '[deploy-compose] Deployment complete\n'

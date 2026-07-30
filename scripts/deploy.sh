#!/usr/bin/env bash
set -euo pipefail

# SS ERP release deployment with symlink rollback.
#
# Required env:
#   DEPLOY_HOST=your-server
#
# Optional env:
#   DEPLOY_USER=root
#   SSH_KEY=~/.ssh/ss_erp_vultr_sg
#   DEPLOY_BASE=/opt/ss-erp
#   RELEASES_DIR=$DEPLOY_BASE/releases
#   CURRENT_LINK=$DEPLOY_BASE/current
#   SHARED_DIR=$DEPLOY_BASE/shared
#   ENV_FILE_NAME=.env.staging
#   API_SERVICE=ss-erp-api
#   WEB_SERVICE=ss-erp-web
#   WORKER_SERVICE=ss-erp-worker
#   HEALTH_URL=http://127.0.0.1:3001/ready
#   KEEP_RELEASES=5
#   MIGRATION_TIMEOUT=20m
#   DEPLOY_ENV_PROFILE=cloud-r2   # optional: validate shared env before build
#
# Usage:
#   DEPLOY_HOST=45.76.49.64 DEPLOY_USER=root ./scripts/deploy.sh [commit]

DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
SSH_KEY="${SSH_KEY:-}"
DEPLOY_BASE="${DEPLOY_BASE:-/opt/ss-erp}"
RELEASES_DIR="${RELEASES_DIR:-$DEPLOY_BASE/releases}"
CURRENT_LINK="${CURRENT_LINK:-$DEPLOY_BASE/current}"
SHARED_DIR="${SHARED_DIR:-$DEPLOY_BASE/shared}"
ENV_FILE_NAME="${ENV_FILE_NAME:-.env.staging}"
API_SERVICE="${API_SERVICE:-ss-erp-api}"
WEB_SERVICE="${WEB_SERVICE:-ss-erp-web}"
WORKER_SERVICE="${WORKER_SERVICE:-ss-erp-worker}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/ready}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-20m}"
DEPLOY_ENV_PROFILE="${DEPLOY_ENV_PROFILE:-}"

log() { printf '[deploy] %s\n' "$*"; }
fail() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

if [ -z "$DEPLOY_HOST" ]; then
  fail "DEPLOY_HOST is required"
fi
if [[ ! "$MIGRATION_TIMEOUT" =~ ^[1-9][0-9]*[smh]$ ]]; then
  fail "MIGRATION_TIMEOUT must be a positive duration ending in s, m, or h"
fi

SSH_ARGS=(-o BatchMode=yes)
if [ -n "$SSH_KEY" ]; then
  SSH_ARGS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes)
fi

DEPLOY_REF="${1:-HEAD}"
if ! COMMIT_HASH="$(git rev-parse --verify --end-of-options "${DEPLOY_REF}^{commit}" 2>/dev/null)"; then
  fail "deployment ref is not a commit: $DEPLOY_REF"
fi
if [[ ! "$COMMIT_HASH" =~ ^[0-9a-f]{40}$ ]]; then
  fail "deployment ref did not resolve to a full 40-character commit OID: $DEPLOY_REF"
fi
RELEASE_DIR="$RELEASES_DIR/$COMMIT_HASH"
TARBALL="build/ss-erp-release-$COMMIT_HASH.tar.gz"

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  fail "tracked working tree has uncommitted changes"
fi

mkdir -p build
log "Packaging $COMMIT_HASH"
git archive --format=tar.gz --prefix=ss-erp/ -o "$TARBALL" "$COMMIT_HASH"

log "Uploading package to $DEPLOY_USER@$DEPLOY_HOST"
scp "${SSH_ARGS[@]}" "$TARBALL" "$DEPLOY_USER@$DEPLOY_HOST:/tmp/$(basename "$TARBALL")"

log "Deploying release"
ssh "${SSH_ARGS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" bash -s -- \
  "$COMMIT_HASH" "$RELEASE_DIR" "$RELEASES_DIR" "$CURRENT_LINK" "$SHARED_DIR" "$ENV_FILE_NAME" \
  "$API_SERVICE" "$WEB_SERVICE" "$WORKER_SERVICE" "$HEALTH_URL" "$KEEP_RELEASES" "$(basename "$TARBALL")" \
  "$DEPLOY_ENV_PROFILE" "$MIGRATION_TIMEOUT" <<'REMOTE'
set -euo pipefail

COMMIT_HASH="$1"
RELEASE_DIR="$2"
RELEASES_DIR="$3"
CURRENT_LINK="$4"
SHARED_DIR="$5"
ENV_FILE_NAME="$6"
API_SERVICE="$7"
WEB_SERVICE="$8"
WORKER_SERVICE="$9"
HEALTH_URL="${10}"
KEEP_RELEASES="${11}"
TARBALL="${12}"
DEPLOY_ENV_PROFILE="${13}"
REQUESTED_MIGRATION_TIMEOUT="${14}"

echo "[deploy] Preparing $RELEASE_DIR"
mkdir -p "$RELEASE_DIR" "$SHARED_DIR"
tar -xzf "/tmp/$TARBALL" -C "$RELEASE_DIR" --strip-components=1
rm -f "/tmp/$TARBALL"

if [ ! -f "$SHARED_DIR/$ENV_FILE_NAME" ]; then
  echo "[deploy] ERROR: missing shared env file: $SHARED_DIR/$ENV_FILE_NAME" >&2
  exit 1
fi

ln -sfn "$SHARED_DIR/$ENV_FILE_NAME" "$RELEASE_DIR/$ENV_FILE_NAME"
ln -sfn "$SHARED_DIR/$ENV_FILE_NAME" "$RELEASE_DIR/.env.staging"
mkdir -p "$SHARED_DIR/uploads" "$SHARED_DIR/backups"
mkdir -p "$RELEASE_DIR/apps/server/public"
ln -sfn "$SHARED_DIR/uploads" "$RELEASE_DIR/apps/server/public/uploads"
ln -sfn "$SHARED_DIR/backups" "$RELEASE_DIR/backups"
echo "$COMMIT_HASH" > "$RELEASE_DIR/DEPLOYED_COMMIT"

cd "$RELEASE_DIR"
set -a
# shellcheck disable=SC1090
. "$ENV_FILE_NAME"
set +a
MIGRATION_TIMEOUT="$REQUESTED_MIGRATION_TIMEOUT"

if [ -n "$DEPLOY_ENV_PROFILE" ]; then
  if [ "$DEPLOY_ENV_PROFILE" = "cloud-r2" ]; then
    echo "[deploy] Validating bootstrap env for profile: $DEPLOY_ENV_PROFILE"
    node scripts/validate-env.mjs --profile cloud-bootstrap --env "$ENV_FILE_NAME"
  else
    echo "[deploy] Validating env profile: $DEPLOY_ENV_PROFILE"
    node scripts/validate-env.mjs --profile "$DEPLOY_ENV_PROFILE" --env "$ENV_FILE_NAME"
  fi
fi

echo "[deploy] Installing dependencies"
pnpm install --frozen-lockfile

echo "[deploy] Generating Prisma client"
cd apps/server
npx prisma generate
cd "$RELEASE_DIR"

echo "[deploy] Building server and web"
pnpm --filter server build
pnpm --filter web build

echo "[deploy] Building cloud and local extension packages"
PREVIOUS_RELEASE="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
EXTENSION_PREVIOUS_BUILD_ROOT="$PREVIOUS_RELEASE/build/extensions" pnpm package:extension

SERVICES_QUIESCED=0
restore_quiesced_services() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$SERVICES_QUIESCED" = "1" ]; then
    systemctl stop "$WORKER_SERVICE" "$API_SERVICE" || true
    echo "[deploy] Worker/API remain stopped after failed migration or gate; operator recovery is required" >&2
  fi
  exit "$status"
}
trap restore_quiesced_services EXIT

rollback() {
  if [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE" ]; then
    echo "[deploy] Rolling back to ${PREVIOUS_RELEASE##*/}"
    ln -sfn "$PREVIOUS_RELEASE" "$CURRENT_LINK"
  fi
  systemctl restart "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE" || true
  SERVICES_QUIESCED=0
}

echo "[deploy] Quiescing AI provider services before migration"
if ! systemctl stop "$WORKER_SERVICE" "$API_SERVICE"; then
  systemctl restart "$WORKER_SERVICE" "$API_SERVICE" || true
  echo "[deploy] ERROR: could not quiesce Worker/API before database migration" >&2
  exit 1
fi
SERVICES_QUIESCED=1

echo "[deploy] Migrating database"
cd apps/server
timeout --signal=TERM --kill-after=30s "$MIGRATION_TIMEOUT" npx prisma migrate deploy
echo "[deploy] Verifying AI media suite post-migration database invariants"
timeout --signal=TERM --kill-after=30s "$MIGRATION_TIMEOUT" node scripts/verify-ai-media-suite-post-migration.mjs
cd "$RELEASE_DIR"

if [ "$DEPLOY_ENV_PROFILE" = "cloud-r2" ]; then
  echo "[deploy] Validating runtime upload config for profile: $DEPLOY_ENV_PROFILE"
  DEPLOY_DIR="$RELEASE_DIR" \
  ENV_FILE="$ENV_FILE_NAME" \
  SKIP_SERVICE_CHECKS=1 \
  SKIP_PROCESS_ENV_CHECKS=1 \
  SKIP_HTTP_CHECK=1 \
  bash scripts/diagnose-runtime-env.sh
fi

echo "[deploy] Verifying AI Media rollout remains dark"
DEPLOY_DIR="$RELEASE_DIR" ENV_FILE="$ENV_FILE_NAME" bash scripts/verify-ai-media-dark.sh

echo "[deploy] Switching current symlink"
ln -sfn "$RELEASE_DIR" "$CURRENT_LINK"

echo "[deploy] Restarting services"
if ! systemctl restart "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"; then
  rollback
  exit 1
fi
SERVICES_QUIESCED=0

sleep 3
echo "[deploy] Health check: $HEALTH_URL"
if ! curl -fsS "$HEALTH_URL" >/dev/null; then
  rollback
  exit 1
fi

echo "[deploy] Cleaning old releases"
cd "$RELEASES_DIR"
ls -1t | tail -n +"$((KEEP_RELEASES + 1))" | xargs -r rm -rf

echo "[deploy] Success: $COMMIT_HASH"
REMOTE

rm -f "$TARBALL"
log "Deployment complete"

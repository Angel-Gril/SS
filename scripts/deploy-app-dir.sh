#!/usr/bin/env bash
set -euo pipefail

# Deploy into the existing /opt/ss-erp/app directory layout.
#
# This is for servers that already run systemd services from:
#   /opt/ss-erp/app/apps/server
#   /opt/ss-erp/app/apps/web
#
# Required env:
#   DEPLOY_HOST=your-server
#
# Optional env:
#   DEPLOY_USER=root
#   SSH_KEY=~/.ssh/ss_erp_vultr_sg
#   DEPLOY_BASE=/opt/ss-erp
#   APP_DIR=$DEPLOY_BASE/app
#   BACKUP_DIR=$DEPLOY_BASE/backups
#   BACKUP_LOG_DIR=/var/log/ss-erp
#   ENV_FILE_NAME=.env.staging
#   DEPLOY_RUN_USER=deploy
#   DEPLOY_ENV_PROFILE=cloud-r2
#   RUN_DB_BACKUP=false
#   KEEP_APP_BACKUPS=3
#   API_SERVICE=ss-erp-api
#   WEB_SERVICE=ss-erp-web
#   WORKER_SERVICE=ss-erp-worker
#   HEALTH_URL=http://127.0.0.1:3001/ready
#   MIGRATION_TIMEOUT=20m
#
# Usage:
#   DEPLOY_HOST=45.76.49.64 SSH_KEY=~/.ssh/ss_erp_vultr_sg ./scripts/deploy-app-dir.sh [commit]

DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
SSH_KEY="${SSH_KEY:-}"
DEPLOY_BASE="${DEPLOY_BASE:-/opt/ss-erp}"
APP_DIR="${APP_DIR:-$DEPLOY_BASE/app}"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_BASE/backups}"
BACKUP_LOG_DIR="${BACKUP_LOG_DIR:-/var/log/ss-erp}"
ENV_FILE_NAME="${ENV_FILE_NAME:-.env.staging}"
DEPLOY_RUN_USER="${DEPLOY_RUN_USER:-deploy}"
DEPLOY_ENV_PROFILE="${DEPLOY_ENV_PROFILE:-}"
RUN_DB_BACKUP="${RUN_DB_BACKUP:-false}"
KEEP_APP_BACKUPS="${KEEP_APP_BACKUPS:-3}"
API_SERVICE="${API_SERVICE:-ss-erp-api}"
WEB_SERVICE="${WEB_SERVICE:-ss-erp-web}"
WORKER_SERVICE="${WORKER_SERVICE:-ss-erp-worker}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/ready}"
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-20m}"

log() { printf '[deploy-app] %s\n' "$*"; }
fail() { printf '[deploy-app] ERROR: %s\n' "$*" >&2; exit 1; }

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

COMMIT_HASH="${1:-$(git rev-parse --short HEAD)}"
TARBALL="build/ss-erp-app-$COMMIT_HASH.tar.gz"

shell_escape() {
  printf '%q' "$1"
}

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  fail "tracked working tree has uncommitted changes"
fi

mkdir -p build
log "Packaging $COMMIT_HASH"
git archive --format=tar.gz --prefix=ss-erp/ -o "$TARBALL" "$COMMIT_HASH"

log "Uploading package to $DEPLOY_USER@$DEPLOY_HOST"
scp "${SSH_ARGS[@]}" "$TARBALL" "$DEPLOY_USER@$DEPLOY_HOST:/tmp/$(basename "$TARBALL")"

log "Deploying app-dir release"
REMOTE_COMMAND="COMMIT_HASH=$(shell_escape "$COMMIT_HASH") DEPLOY_BASE=$(shell_escape "$DEPLOY_BASE") APP_DIR=$(shell_escape "$APP_DIR") BACKUP_DIR=$(shell_escape "$BACKUP_DIR") BACKUP_LOG_DIR=$(shell_escape "$BACKUP_LOG_DIR") ENV_FILE_NAME=$(shell_escape "$ENV_FILE_NAME") DEPLOY_RUN_USER=$(shell_escape "$DEPLOY_RUN_USER") DEPLOY_ENV_PROFILE=$(shell_escape "$DEPLOY_ENV_PROFILE") RUN_DB_BACKUP=$(shell_escape "$RUN_DB_BACKUP") KEEP_APP_BACKUPS=$(shell_escape "$KEEP_APP_BACKUPS") API_SERVICE=$(shell_escape "$API_SERVICE") WEB_SERVICE=$(shell_escape "$WEB_SERVICE") WORKER_SERVICE=$(shell_escape "$WORKER_SERVICE") HEALTH_URL=$(shell_escape "$HEALTH_URL") MIGRATION_TIMEOUT=$(shell_escape "$MIGRATION_TIMEOUT") TARBALL_NAME=$(shell_escape "$(basename "$TARBALL")") bash -s"
ssh "${SSH_ARGS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$REMOTE_COMMAND" <<'REMOTE'
set -euo pipefail

COMMIT_HASH="${COMMIT_HASH:?}"
DEPLOY_BASE="${DEPLOY_BASE:?}"
APP_DIR="${APP_DIR:?}"
BACKUP_DIR="${BACKUP_DIR:?}"
BACKUP_LOG_DIR="${BACKUP_LOG_DIR:?}"
ENV_FILE_NAME="${ENV_FILE_NAME:?}"
DEPLOY_RUN_USER="${DEPLOY_RUN_USER:?}"
DEPLOY_ENV_PROFILE="${DEPLOY_ENV_PROFILE:-}"
RUN_DB_BACKUP="${RUN_DB_BACKUP:-false}"
KEEP_APP_BACKUPS="${KEEP_APP_BACKUPS:?}"
API_SERVICE="${API_SERVICE:?}"
WEB_SERVICE="${WEB_SERVICE:?}"
WORKER_SERVICE="${WORKER_SERVICE:?}"
HEALTH_URL="${HEALTH_URL:?}"
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:?}"
TARBALL="${TARBALL_NAME:?}"

log() { printf '[deploy-app] %s\n' "$*"; }
fail() { printf '[deploy-app] ERROR: %s\n' "$*" >&2; exit 1; }

run_in_dir() {
  local dir="$1"
  local command="$2"
  if id "$DEPLOY_RUN_USER" >/dev/null 2>&1; then
    sudo -u "$DEPLOY_RUN_USER" bash -lc "cd '$dir' && $command"
  else
    bash -lc "cd '$dir' && $command"
  fi
}

if [ ! -d "$APP_DIR" ]; then
  fail "app dir missing: $APP_DIR"
fi
if [ ! -f "$APP_DIR/$ENV_FILE_NAME" ]; then
  fail "env file missing: $APP_DIR/$ENV_FILE_NAME"
fi

mkdir -p "$DEPLOY_BASE" "$BACKUP_DIR" "$BACKUP_LOG_DIR"
chown root:root "$BACKUP_LOG_DIR"
chmod 0750 "$BACKUP_LOG_DIR"

if [ "$RUN_DB_BACKUP" = "true" ] || [ "$RUN_DB_BACKUP" = "1" ]; then
  if [ -f /etc/ss-erp-backup.env ] && [ -f "$APP_DIR/scripts/backup-db.sh" ]; then
    log "Running database backup before deploy"
    # shellcheck disable=SC1091
    set -a
    . /etc/ss-erp-backup.env
    set +a
    bash "$APP_DIR/scripts/backup-db.sh"
  else
    fail "RUN_DB_BACKUP requested but /etc/ss-erp-backup.env or backup-db.sh is missing"
  fi
fi

NEXT_DIR="$DEPLOY_BASE/app-next-$COMMIT_HASH-$$"
FAILED_DIR="$DEPLOY_BASE/app-failed-$COMMIT_HASH-$(date +%Y%m%d%H%M%S)"
BACKUP_TARGET="$BACKUP_DIR/app-before-$(date +%Y%m%d%H%M%S)"

rm -rf "$NEXT_DIR"
mkdir -p "$NEXT_DIR"
tar -xzf "/tmp/$TARBALL" -C "$NEXT_DIR" --strip-components=1
rm -f "/tmp/$TARBALL"

cp -p "$APP_DIR/$ENV_FILE_NAME" "$NEXT_DIR/$ENV_FILE_NAME"
mkdir -p "$NEXT_DIR/apps/server/public"
for runtime_dir in uploads watermarked resized tmp; do
  mkdir -p "$DEPLOY_BASE/shared/$runtime_dir"
  if [ -d "$APP_DIR/apps/server/public/$runtime_dir" ] && [ ! -L "$APP_DIR/apps/server/public/$runtime_dir" ]; then
    cp -a "$APP_DIR/apps/server/public/$runtime_dir/." "$DEPLOY_BASE/shared/$runtime_dir/" 2>/dev/null || true
  fi
  ln -sfn "$DEPLOY_BASE/shared/$runtime_dir" "$NEXT_DIR/apps/server/public/$runtime_dir"
done
mkdir -p "$DEPLOY_BASE/shared/backups"
echo "$COMMIT_HASH" > "$NEXT_DIR/DEPLOYED_COMMIT"

if id "$DEPLOY_RUN_USER" >/dev/null 2>&1; then
  chown -R "$DEPLOY_RUN_USER:$DEPLOY_RUN_USER" "$NEXT_DIR" "$DEPLOY_BASE/shared"
fi

if [ -n "$DEPLOY_ENV_PROFILE" ]; then
  if [ "$DEPLOY_ENV_PROFILE" = "cloud-r2" ]; then
    log "Validating bootstrap env for profile: $DEPLOY_ENV_PROFILE"
    run_in_dir "$NEXT_DIR" "node scripts/validate-env.mjs --profile 'cloud-bootstrap' --env '$ENV_FILE_NAME'"
  else
    log "Validating env profile: $DEPLOY_ENV_PROFILE"
    run_in_dir "$NEXT_DIR" "node scripts/validate-env.mjs --profile '$DEPLOY_ENV_PROFILE' --env '$ENV_FILE_NAME'"
  fi
fi

log "Installing dependencies"
run_in_dir "$NEXT_DIR" "set -a; . './$ENV_FILE_NAME'; set +a; pnpm install --frozen-lockfile"

log "Generating Prisma client"
run_in_dir "$NEXT_DIR/apps/server" "set -a; . '../../$ENV_FILE_NAME'; set +a; npx prisma generate"

log "Building server and web"
run_in_dir "$NEXT_DIR" "set -a; . './$ENV_FILE_NAME'; set +a; pnpm --filter server build && pnpm --filter web build"

log "Building cloud and local extension packages"
run_in_dir "$NEXT_DIR" "set -a; . './$ENV_FILE_NAME'; set +a; EXTENSION_PREVIOUS_BUILD_ROOT='$APP_DIR/build/extensions' pnpm package:extension:cloud && EXTENSION_PREVIOUS_BUILD_ROOT='$APP_DIR/build/extensions' pnpm package:extension:local"

SERVICES_QUIESCED=0
restore_quiesced_services() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$SERVICES_QUIESCED" = "1" ]; then
    systemctl stop "$WORKER_SERVICE" "$API_SERVICE" || true
    log "Worker/API remain stopped after failed migration or gate; operator recovery is required"
  fi
  exit "$status"
}
trap restore_quiesced_services EXIT

rollback() {
  log "Rolling back app dir"
  systemctl stop "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE" || true
  if [ -d "$APP_DIR" ]; then
    rm -rf "$FAILED_DIR"
    mv "$APP_DIR" "$FAILED_DIR"
  fi
  if [ -d "$BACKUP_TARGET" ]; then
    mv "$BACKUP_TARGET" "$APP_DIR"
  fi
  systemctl restart "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE" || true
  SERVICES_QUIESCED=0
}

log "Quiescing AI provider services before migration"
if ! systemctl stop "$WORKER_SERVICE" "$API_SERVICE"; then
  systemctl restart "$WORKER_SERVICE" "$API_SERVICE" || true
  fail "could not quiesce Worker/API before database migration"
fi
SERVICES_QUIESCED=1

log "Migrating database"
run_in_dir "$NEXT_DIR/apps/server" "set -a; . '../../$ENV_FILE_NAME'; set +a; timeout --signal=TERM --kill-after=30s '$MIGRATION_TIMEOUT' npx prisma migrate deploy"

if [ "$DEPLOY_ENV_PROFILE" = "cloud-r2" ]; then
  log "Validating runtime upload config for profile: $DEPLOY_ENV_PROFILE"
  run_in_dir "$NEXT_DIR" "DEPLOY_DIR='$NEXT_DIR' ENV_FILE='$ENV_FILE_NAME' SKIP_SERVICE_CHECKS=1 SKIP_PROCESS_ENV_CHECKS=1 SKIP_HTTP_CHECK=1 bash scripts/diagnose-runtime-env.sh"
fi

log "Verifying AI Media rollout remains dark"
run_in_dir "$NEXT_DIR" "DEPLOY_DIR='$NEXT_DIR' ENV_FILE='$ENV_FILE_NAME' bash scripts/verify-ai-media-dark.sh"

log "Switching $APP_DIR"
mv "$APP_DIR" "$BACKUP_TARGET"
mv "$NEXT_DIR" "$APP_DIR"

log "Restarting services"
if ! systemctl restart "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"; then
  rollback
  exit 1
fi
SERVICES_QUIESCED=0

sleep 3
for service in "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"; do
  if ! systemctl is-active --quiet "$service"; then
    echo "[deploy-app] ERROR: service is not active after restart: $service" >&2
    rollback
    exit 1
  fi
done

log "Health check: $HEALTH_URL"
if ! curl -fsS "$HEALTH_URL" >/dev/null; then
  rollback
  exit 1
fi

log "Cleaning old app backups"
find "$BACKUP_DIR" -maxdepth 1 -mindepth 1 -type d -name 'app-before-*' -printf '%T@ %p\n' \
  | sort -nr \
  | tail -n +"$((KEEP_APP_BACKUPS + 1))" \
  | cut -d' ' -f2- \
  | xargs -r rm -rf

log "Success: $COMMIT_HASH"
REMOTE

rm -f "$TARBALL"
log "Deployment complete"

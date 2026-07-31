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
#   DEPLOY_BUILD_USER=ss-erp-build
#   DEPLOY_BACKUP_GATE_ROOT=/usr/local/lib/ss-erp-deploy-gate
#   DEPLOY_ENV_PROFILE=cloud-r2
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
DEPLOY_BUILD_USER="${DEPLOY_BUILD_USER:-ss-erp-build}"
DEPLOY_BACKUP_GATE_ROOT="${DEPLOY_BACKUP_GATE_ROOT:-/usr/local/lib/ss-erp-deploy-gate}"
DEPLOY_ENV_PROFILE="${DEPLOY_ENV_PROFILE:-}"
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
if [[ ! "$ENV_FILE_NAME" =~ ^\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  fail "ENV_FILE_NAME must be one dot-prefixed basename"
fi
if [[ ! "$KEEP_APP_BACKUPS" =~ ^[1-9][0-9]{0,2}$ ]] || [ "$KEEP_APP_BACKUPS" -gt 100 ]; then
  fail "KEEP_APP_BACKUPS must be an integer from 1 through 100"
fi

SSH_ARGS=(-o BatchMode=yes)
if [ -n "$SSH_KEY" ]; then
  SSH_ARGS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes)
fi

DEPLOY_REF="${1:-HEAD}"
if ! COMMIT_HASH="$(git rev-parse --verify --end-of-options "${DEPLOY_REF}^{commit}" 2>/dev/null)"; then
  fail "deployment ref is not a commit: $DEPLOY_REF"
fi
if [[ ! "$COMMIT_HASH" =~ ^[0-9a-fA-F]{40}$ ]]; then
  fail "deployment ref did not resolve to a full 40-character commit OID: $DEPLOY_REF"
fi
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
ARCHIVE_SHA256="$(node -e '
const fs = require("node:fs");
const crypto = require("node:crypto");
const hash = crypto.createHash("sha256");
const stream = fs.createReadStream(process.argv[1]);
stream.on("data", (chunk) => hash.update(chunk));
stream.on("end", () => process.stdout.write(hash.digest("hex")));
stream.on("error", () => process.exit(1));
' "$TARBALL")"
if [[ ! "$ARCHIVE_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  fail "could not hash deployment archive"
fi

log "Uploading package to $DEPLOY_USER@$DEPLOY_HOST"
REMOTE_UPLOAD_DIR="$(ssh "${SSH_ARGS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" \
  'set -eu; [ "$(id -u)" = "0" ]; umask 077; mktemp -d /tmp/ss-erp-deploy-upload.XXXXXXXXXX')"
if [[ ! "$REMOTE_UPLOAD_DIR" =~ ^/tmp/ss-erp-deploy-upload\.[A-Za-z0-9]{10}$ ]]; then
  fail "server did not create a private root deployment upload directory"
fi
if ! scp "${SSH_ARGS[@]}" "$TARBALL" \
  "$DEPLOY_USER@$DEPLOY_HOST:$REMOTE_UPLOAD_DIR/archive.tar.gz"; then
  ssh "${SSH_ARGS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" \
    "rmdir $(shell_escape "$REMOTE_UPLOAD_DIR") 2>/dev/null || true" || true
  fail "deployment archive upload failed"
fi

log "Deploying app-dir release"
REMOTE_COMMAND="COMMIT_HASH=$(shell_escape "$COMMIT_HASH") DEPLOY_BASE=$(shell_escape "$DEPLOY_BASE") APP_DIR=$(shell_escape "$APP_DIR") BACKUP_DIR=$(shell_escape "$BACKUP_DIR") BACKUP_LOG_DIR=$(shell_escape "$BACKUP_LOG_DIR") ENV_FILE_NAME=$(shell_escape "$ENV_FILE_NAME") DEPLOY_RUN_USER=$(shell_escape "$DEPLOY_RUN_USER") DEPLOY_BUILD_USER=$(shell_escape "$DEPLOY_BUILD_USER") DEPLOY_BACKUP_GATE_ROOT=$(shell_escape "$DEPLOY_BACKUP_GATE_ROOT") DEPLOY_ENV_PROFILE=$(shell_escape "$DEPLOY_ENV_PROFILE") KEEP_APP_BACKUPS=$(shell_escape "$KEEP_APP_BACKUPS") API_SERVICE=$(shell_escape "$API_SERVICE") WEB_SERVICE=$(shell_escape "$WEB_SERVICE") WORKER_SERVICE=$(shell_escape "$WORKER_SERVICE") HEALTH_URL=$(shell_escape "$HEALTH_URL") MIGRATION_TIMEOUT=$(shell_escape "$MIGRATION_TIMEOUT") UPLOAD_DIR=$(shell_escape "$REMOTE_UPLOAD_DIR") ARCHIVE_SHA256=$(shell_escape "$ARCHIVE_SHA256") bash -s"
ssh "${SSH_ARGS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$REMOTE_COMMAND" <<'REMOTE'
set -euo pipefail
umask 077

COMMIT_HASH="${COMMIT_HASH:?}"
readonly TARGET_GIT_COMMIT="$COMMIT_HASH"
DEPLOY_BASE="${DEPLOY_BASE:?}"
APP_DIR="${APP_DIR:?}"
BACKUP_DIR="${BACKUP_DIR:?}"
BACKUP_LOG_DIR="${BACKUP_LOG_DIR:?}"
ENV_FILE_NAME="${ENV_FILE_NAME:?}"
DEPLOY_RUN_USER="${DEPLOY_RUN_USER:?}"
readonly DEPLOY_BUILD_USER="${DEPLOY_BUILD_USER:?}"
DEPLOY_BACKUP_GATE_ROOT="${DEPLOY_BACKUP_GATE_ROOT:?}"
DEPLOY_ENV_PROFILE="${DEPLOY_ENV_PROFILE:-}"
KEEP_APP_BACKUPS="${KEEP_APP_BACKUPS:?}"
API_SERVICE="${API_SERVICE:?}"
WEB_SERVICE="${WEB_SERVICE:?}"
WORKER_SERVICE="${WORKER_SERVICE:?}"
HEALTH_URL="${HEALTH_URL:?}"
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:?}"
UPLOAD_DIR="${UPLOAD_DIR:?}"
ARCHIVE_SHA256="${ARCHIVE_SHA256:?}"
TARBALL="$UPLOAD_DIR/archive.tar.gz"
readonly DEPLOY_BASE APP_DIR BACKUP_DIR BACKUP_LOG_DIR ENV_FILE_NAME DEPLOY_RUN_USER \
  DEPLOY_BACKUP_GATE_ROOT DEPLOY_ENV_PROFILE KEEP_APP_BACKUPS API_SERVICE WEB_SERVICE \
  WORKER_SERVICE HEALTH_URL MIGRATION_TIMEOUT UPLOAD_DIR ARCHIVE_SHA256 TARBALL
DEPLOY_ENV_SNAPSHOT_DIR=""
DEPLOY_ENV_SNAPSHOT=""
DEPLOY_BUILD_HOME=""
DEPLOY_SOURCE_MANIFEST=""
DEPLOY_BUILD_MANIFEST=""

if [[ ! "$KEEP_APP_BACKUPS" =~ ^[1-9][0-9]{0,2}$ ]] || [ "$KEEP_APP_BACKUPS" -gt 100 ]; then
  printf '[deploy-app] ERROR: backup retention must be an integer from 1 through 100\n' >&2
  exit 1
fi

log() { printf '[deploy-app] %s\n' "$*"; }
fail() { printf '[deploy-app] ERROR: %s\n' "$*" >&2; exit 1; }

run_in_dir() {
  local dir="$1"
  local environment_mode="$2"
  shift 2
  local child_environment=(
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    "HOME=/home/$DEPLOY_RUN_USER"
    "LANG=C.UTF-8"
  )
  local key
  if ! id "$DEPLOY_RUN_USER" >/dev/null 2>&1; then
    fail "deployment runtime user is missing: $DEPLOY_RUN_USER"
  fi
  for key in DEPLOY_DIR ENV_FILE EXTENSION_PREVIOUS_BUILD_ROOT SKIP_HTTP_CHECK \
    SKIP_PROCESS_ENV_CHECKS SKIP_SERVICE_CHECKS; do
    if [ -n "${!key:-}" ]; then
      child_environment+=("$key=${!key}")
    fi
  done
  env -i "${child_environment[@]}" \
    node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-environment.mjs" \
    "${environment_mode}-as" "$NEXT_DIR/$ENV_FILE_NAME" "$dir" \
    "$([ "$environment_mode" = "exec-build" ] && printf '%s' "$DEPLOY_BUILD_UID" || printf '%s' "$DEPLOY_RUN_UID")" \
    "$([ "$environment_mode" = "exec-build" ] && printf '%s' "$DEPLOY_BUILD_GID" || printf '%s' "$DEPLOY_RUN_GID")" \
    "$([ "$environment_mode" = "exec-build" ] && printf '%s' "$DEPLOY_BUILD_HOME" || printf '/home/%s' "$DEPLOY_RUN_USER")" \
    -- "$@"
}

install_target_backup_gate() {
  local source_root="$1"
  bash "$source_root/scripts/install-deploy-backup-gate.sh" \
    "$TARGET_GIT_COMMIT" "$source_root" "$DEPLOY_BACKUP_GATE_ROOT"
}

cleanup_environment_snapshot() {
  if [ -n "$DEPLOY_ENV_SNAPSHOT_DIR" ] && [ -d "$DEPLOY_ENV_SNAPSHOT_DIR" ]; then
    rm -rf -- "$DEPLOY_ENV_SNAPSHOT_DIR"
  fi
  if [ -n "$DEPLOY_BUILD_HOME" ] && [ -d "$DEPLOY_BUILD_HOME" ]; then
    rm -rf -- "$DEPLOY_BUILD_HOME"
  fi
}

assert_real_directory() {
  local directory="$1"
  if [ -L "$directory" ] || [ ! -d "$directory" ] \
    || [ "$(readlink -f -- "$directory")" != "$directory" ]; then
    fail "managed path must be one real canonical directory: $directory"
  fi
}

assert_root_directory() {
  local directory="$1"
  local mode
  assert_real_directory "$directory"
  if [ "$(stat -c '%u' "$directory")" != "0" ]; then
    fail "managed directory must be root-owned: $directory"
  fi
  mode="$(stat -c '%a' "$directory")"
  if (( (8#$mode & 8#022) != 0 )); then
    fail "managed root directory must not be group/world writable: $directory"
  fi
}

assert_root_ancestor_chain() {
  local current="$1"
  while true; do
    assert_root_directory "$current"
    [ "$current" = "/" ] && break
    current="$(dirname -- "$current")"
  done
}

install_root_runtime_symlink() {
  local target="$1"
  local link="$2"
  local target_real
  if [ -L "$target" ] || [ ! -d "$target" ]; then
    fail "runtime symlink target is not one trusted directory: $target"
  fi
  if [ -e "$link" ] || [ -L "$link" ]; then
    fail "build produced a reserved runtime path: $link"
  fi
  assert_root_ancestor_chain "$(dirname -- "$link")"
  target_real="$(readlink -f -- "$target")"
  ln -sT -- "$target_real" "$link"
  chown -h root:root "$link"
  if [ "$(readlink -f -- "$link")" != "$target_real" ] \
    || [ "$(stat -c '%u' "$link")" != "0" ]; then
    fail "runtime symlink verification failed: $link"
  fi
}

if [ "$(id -u)" != "0" ]; then
  fail "app-dir deployment must run as root"
fi
if [[ ! "$DEPLOY_RUN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] \
  || ! id -- "$DEPLOY_RUN_USER" >/dev/null 2>&1; then
  fail "deployment runtime user is missing: $DEPLOY_RUN_USER"
fi
if [[ ! "$DEPLOY_BUILD_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] \
  || ! id -- "$DEPLOY_BUILD_USER" >/dev/null 2>&1 \
  || [ "$DEPLOY_BUILD_USER" = "$DEPLOY_RUN_USER" ]; then
  fail "a distinct deployment build user is required: $DEPLOY_BUILD_USER"
fi
DEPLOY_RUN_GROUP="$(id -gn -- "$DEPLOY_RUN_USER")"
DEPLOY_RUN_UID="$(id -u -- "$DEPLOY_RUN_USER")"
DEPLOY_RUN_GID="$(id -g -- "$DEPLOY_RUN_USER")"
DEPLOY_BUILD_GROUP="$(id -gn -- "$DEPLOY_BUILD_USER")"
DEPLOY_BUILD_UID="$(id -u -- "$DEPLOY_BUILD_USER")"
DEPLOY_BUILD_GID="$(id -g -- "$DEPLOY_BUILD_USER")"
if [ "$DEPLOY_RUN_UID" = "0" ] || [ "$DEPLOY_RUN_GID" = "0" ] \
  || [ "$DEPLOY_BUILD_UID" = "0" ] || [ "$DEPLOY_BUILD_GID" = "0" ] \
  || [ "$DEPLOY_BUILD_UID" = "$DEPLOY_RUN_UID" ] \
  || [ "$DEPLOY_BUILD_GID" = "$DEPLOY_RUN_GID" ]; then
  fail "build and runtime users require distinct non-root UIDs and GIDs"
fi
if [[ ! "$UPLOAD_DIR" =~ ^/tmp/ss-erp-deploy-upload\.[A-Za-z0-9]{10}$ ]] \
  || [ -L "$UPLOAD_DIR" ] || [ ! -d "$UPLOAD_DIR" ] \
  || [ "$(stat -c '%u:%a' "$UPLOAD_DIR" 2>/dev/null)" != "0:700" ]; then
  fail "deployment upload directory is not private and root-owned"
fi
if [ -L "$TARBALL" ] || [ ! -f "$TARBALL" ] \
  || [ "$(stat -c '%u' "$TARBALL" 2>/dev/null)" != "0" ] \
  || [ "$(sha256sum "$TARBALL" | awk '{print $1}')" != "$ARCHIVE_SHA256" ]; then
  fail "deployment archive identity or SHA-256 is invalid"
fi
assert_root_ancestor_chain "$DEPLOY_BASE"
assert_root_ancestor_chain "$BACKUP_DIR"
assert_root_ancestor_chain "$BACKUP_LOG_DIR"
case "$APP_DIR/" in
  "$DEPLOY_BASE"/*/) ;;
  *) fail "app directory must be located beneath DEPLOY_BASE" ;;
esac
assert_root_ancestor_chain "$(dirname -- "$APP_DIR")"
if [ -L "$APP_DIR" ] || [ ! -d "$APP_DIR" ] \
  || [ "$(readlink -f -- "$APP_DIR")" != "$APP_DIR" ]; then
  fail "app dir missing: $APP_DIR"
fi
APP_DIR_REAL="$APP_DIR"
CURRENT_ENV_FILE="$APP_DIR/$ENV_FILE_NAME"
if [ -L "$CURRENT_ENV_FILE" ] || [ ! -f "$CURRENT_ENV_FILE" ] \
  || ! sudo -u "$DEPLOY_RUN_USER" test -r "$CURRENT_ENV_FILE"; then
  fail "env file missing: $APP_DIR/$ENV_FILE_NAME"
fi

chown root:root "$BACKUP_LOG_DIR"
chmod 0750 "$BACKUP_LOG_DIR"

NEXT_DIR="$DEPLOY_BASE/app-next-$COMMIT_HASH-$$"
FAILED_DIR="$DEPLOY_BASE/app-failed-$COMMIT_HASH-$(date +%Y%m%d%H%M%S)"
BACKUP_TARGET="$BACKUP_DIR/app-before-$(date +%Y%m%d%H%M%S)"

rm -rf "$NEXT_DIR"
mkdir -p "$NEXT_DIR"
tar -xzf "$TARBALL" -C "$NEXT_DIR" --strip-components=1
rm -f -- "$TARBALL"
rmdir -- "$UPLOAD_DIR"
install_target_backup_gate "$NEXT_DIR"
DEPLOY_ENV_SNAPSHOT_DIR="$(mktemp -d /run/ss-erp-deploy-env.XXXXXXXXXX)"
DEPLOY_BUILD_HOME="$(mktemp -d /run/ss-erp-build-home.XXXXXXXXXX)"
chown "$DEPLOY_BUILD_USER:$DEPLOY_BUILD_GROUP" "$DEPLOY_BUILD_HOME"
chmod 0700 "$DEPLOY_BUILD_HOME"
chmod 0700 "$DEPLOY_ENV_SNAPSHOT_DIR"
DEPLOY_ENV_SNAPSHOT="$DEPLOY_ENV_SNAPSHOT_DIR/environment.env"
DEPLOY_SOURCE_MANIFEST="$DEPLOY_ENV_SNAPSHOT_DIR/source-manifest.json"
DEPLOY_BUILD_MANIFEST="$DEPLOY_ENV_SNAPSHOT_DIR/build-manifest.json"
trap cleanup_environment_snapshot EXIT
node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-environment.mjs" snapshot \
  "$CURRENT_ENV_FILE" "$DEPLOY_ENV_SNAPSHOT"
chown "root:$DEPLOY_RUN_GROUP" "$DEPLOY_ENV_SNAPSHOT_DIR" "$DEPLOY_ENV_SNAPSHOT"
chmod 0750 "$DEPLOY_ENV_SNAPSHOT_DIR"
chmod 0640 "$DEPLOY_ENV_SNAPSHOT"
chmod 0700 "$DEPLOY_ENV_SNAPSHOT_DIR"
node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-source-manifest.mjs" create \
  "$NEXT_DIR" "$DEPLOY_SOURCE_MANIFEST" "$TARGET_GIT_COMMIT"
chmod 0750 "$DEPLOY_ENV_SNAPSHOT_DIR"

# Sandbox evidence must survive the app-dir swap without entering a public
# static-file tree. Existing shared evidence wins on name collisions.
mkdir -p "$NEXT_DIR/tmp"
assert_root_ancestor_chain "$DEPLOY_BASE/shared"
for sandbox_dir in ai-image-sandbox ai-image-translation-sandbox; do
  current_sandbox_dir="$APP_DIR/tmp/$sandbox_dir"
  shared_sandbox_dir="$DEPLOY_BASE/shared/$sandbox_dir"
  mkdir -p "$shared_sandbox_dir"
  assert_real_directory "$shared_sandbox_dir"
  chown "$DEPLOY_RUN_USER:$DEPLOY_RUN_GROUP" "$shared_sandbox_dir"
  chmod 0700 "$shared_sandbox_dir"
  shared_sandbox_target="$(readlink -f "$shared_sandbox_dir")"

  if [ -L "$current_sandbox_dir" ]; then
    current_sandbox_target="$(readlink -f "$current_sandbox_dir")"
    [ "$current_sandbox_target" = "$shared_sandbox_target" ] \
      || fail "sandbox evidence symlink does not target managed shared storage: $current_sandbox_dir"
  elif [ -e "$current_sandbox_dir" ]; then
    [ -d "$current_sandbox_dir" ] || fail "sandbox evidence source is not a directory"
    current_sandbox_target="$(readlink -f "$current_sandbox_dir")"
    case "$current_sandbox_target/" in
      "$APP_DIR_REAL"/tmp/*/) ;;
      *) fail "sandbox evidence source escapes the current app directory" ;;
    esac
    sudo -u "$DEPLOY_RUN_USER" cp -a -n -- "$current_sandbox_dir/." "$shared_sandbox_dir/"
  fi

  if [ -e "$NEXT_DIR/tmp/$sandbox_dir" ] || [ -L "$NEXT_DIR/tmp/$sandbox_dir" ]; then
    fail "target archive contains a reserved sandbox runtime path: tmp/$sandbox_dir"
  fi
done

mkdir -p "$NEXT_DIR/apps/server/public"
for runtime_dir in uploads watermarked resized tmp; do
  current_runtime_dir="$APP_DIR/apps/server/public/$runtime_dir"
  shared_runtime_dir="$DEPLOY_BASE/shared/$runtime_dir"
  mkdir -p "$shared_runtime_dir"
  assert_real_directory "$shared_runtime_dir"
  chown "$DEPLOY_RUN_USER:$DEPLOY_RUN_GROUP" "$shared_runtime_dir"
  chmod 0750 "$shared_runtime_dir"
  if [ -L "$current_runtime_dir" ]; then
    [ "$(readlink -f "$current_runtime_dir")" = "$(readlink -f "$shared_runtime_dir")" ] \
      || fail "runtime media symlink does not target managed shared storage: $current_runtime_dir"
  elif [ -e "$current_runtime_dir" ]; then
    [ -d "$current_runtime_dir" ] || fail "runtime media source is not a directory"
    current_runtime_target="$(readlink -f "$current_runtime_dir")"
    case "$current_runtime_target/" in
      "$APP_DIR_REAL"/apps/server/public/*/) ;;
      *) fail "runtime media source escapes the current app directory" ;;
    esac
    sudo -u "$DEPLOY_RUN_USER" cp -a -n -- "$current_runtime_dir/." "$shared_runtime_dir/"
  fi
  if [ -e "$NEXT_DIR/apps/server/public/$runtime_dir" ] \
    || [ -L "$NEXT_DIR/apps/server/public/$runtime_dir" ]; then
    fail "target archive contains a reserved media runtime path: $runtime_dir"
  fi
done
mkdir -p "$DEPLOY_BASE/shared/backups"
assert_real_directory "$DEPLOY_BASE/shared/backups"
chown "$DEPLOY_RUN_USER:$DEPLOY_RUN_GROUP" "$DEPLOY_BASE/shared/backups"
chmod 0750 "$DEPLOY_BASE/shared/backups"

find "$NEXT_DIR" -mindepth 1 -maxdepth 1 \
  -exec chown -hR -P "$DEPLOY_BUILD_USER:$DEPLOY_BUILD_GROUP" -- {} +
chown root:root "$NEXT_DIR"
chmod 0755 "$NEXT_DIR"
for writable_root in node_modules build .turbo; do
  mkdir -p "$NEXT_DIR/$writable_root"
  chown -R "$DEPLOY_BUILD_USER:$DEPLOY_BUILD_GROUP" "$NEXT_DIR/$writable_root"
done
if [ -e "$NEXT_DIR/$ENV_FILE_NAME" ] || [ -L "$NEXT_DIR/$ENV_FILE_NAME" ]; then
  fail "target archive must not contain the deployment environment file"
fi
install -o root -g "$DEPLOY_RUN_GROUP" -m 0640 \
  "$DEPLOY_ENV_SNAPSHOT" "$NEXT_DIR/$ENV_FILE_NAME"
printf '%s\n' "$TARGET_GIT_COMMIT" > "$NEXT_DIR/DEPLOYED_COMMIT"
chown root:root "$NEXT_DIR/DEPLOYED_COMMIT"
chmod 0444 "$NEXT_DIR/DEPLOYED_COMMIT"

if [ -n "$DEPLOY_ENV_PROFILE" ]; then
  if [ "$DEPLOY_ENV_PROFILE" = "cloud-r2" ]; then
    log "Validating bootstrap env for profile: $DEPLOY_ENV_PROFILE"
    run_in_dir "$NEXT_DIR" exec-check node scripts/validate-env.mjs --profile cloud-bootstrap --env "$ENV_FILE_NAME"
  else
    log "Validating env profile: $DEPLOY_ENV_PROFILE"
    run_in_dir "$NEXT_DIR" exec-check node scripts/validate-env.mjs --profile "$DEPLOY_ENV_PROFILE" --env "$ENV_FILE_NAME"
  fi
fi

log "Installing dependencies"
run_in_dir "$NEXT_DIR" exec-build pnpm install --frozen-lockfile

log "Generating Prisma client"
run_in_dir "$NEXT_DIR/apps/server" exec-build npx prisma generate

log "Building server and web"
run_in_dir "$NEXT_DIR" exec-build pnpm --filter server build
run_in_dir "$NEXT_DIR" exec-build pnpm --filter web build

log "Building cloud and local extension packages"
EXTENSION_PREVIOUS_BUILD_ROOT="$APP_DIR/build/extensions" \
  run_in_dir "$NEXT_DIR" exec-build pnpm package:extension

log "Recording closed post-build source manifest"
chmod 0700 "$DEPLOY_ENV_SNAPSHOT_DIR"
node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-source-manifest.mjs" create-closed \
  "$NEXT_DIR" "$DEPLOY_BUILD_MANIFEST" "$TARGET_GIT_COMMIT"
chmod 0750 "$DEPLOY_ENV_SNAPSHOT_DIR"

log "Sealing built source on new root-owned inodes"
SEALED_NEXT_DIR="$NEXT_DIR.sealed"
UNSEALED_NEXT_DIR="$NEXT_DIR.unsealed"
bash "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/freeze-deploy-source.sh" \
  seal "$TARGET_GIT_COMMIT" "$NEXT_DIR" "$SEALED_NEXT_DIR"
node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-source-manifest.mjs" verify \
  "$SEALED_NEXT_DIR" "$DEPLOY_SOURCE_MANIFEST" "$TARGET_GIT_COMMIT"
node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-source-manifest.mjs" verify \
  "$SEALED_NEXT_DIR" "$DEPLOY_BUILD_MANIFEST" "$TARGET_GIT_COMMIT"
mv "$NEXT_DIR" "$UNSEALED_NEXT_DIR"
mv "$SEALED_NEXT_DIR" "$NEXT_DIR"
rm -rf -- "$UNSEALED_NEXT_DIR"
for sandbox_dir in ai-image-sandbox ai-image-translation-sandbox; do
  install_root_runtime_symlink \
    "$DEPLOY_BASE/shared/$sandbox_dir" "$NEXT_DIR/tmp/$sandbox_dir"
done
for runtime_dir in uploads watermarked resized tmp; do
  install_root_runtime_symlink \
    "$DEPLOY_BASE/shared/$runtime_dir" "$NEXT_DIR/apps/server/public/$runtime_dir"
done
bash "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/freeze-deploy-source.sh" \
  verify "$TARGET_GIT_COMMIT" "$NEXT_DIR"

SERVICES_QUIESCED=0
restore_quiesced_services() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$SERVICES_QUIESCED" = "1" ]; then
    systemctl stop "$WORKER_SERVICE" "$API_SERVICE" || true
    log "Worker/API remain stopped after failed migration or gate; operator recovery is required"
  fi
  cleanup_environment_snapshot
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

log "Verifying commit/database/restore-bound backup attestation"
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-backup-gate.mjs" \
  --mode migrate \
  --env-file "$NEXT_DIR/$ENV_FILE_NAME" \
  --target-git-commit "$TARGET_GIT_COMMIT" \
  --server-dir "$NEXT_DIR/apps/server" \
  --run-user "$DEPLOY_RUN_USER" \
  --migration-timeout "$MIGRATION_TIMEOUT"

if [ "$DEPLOY_ENV_PROFILE" = "cloud-r2" ]; then
  log "Validating runtime upload config for profile: $DEPLOY_ENV_PROFILE"
  DEPLOY_DIR="$NEXT_DIR" ENV_FILE="$ENV_FILE_NAME" SKIP_SERVICE_CHECKS=1 \
    SKIP_PROCESS_ENV_CHECKS=1 SKIP_HTTP_CHECK=1 \
    run_in_dir "$NEXT_DIR" exec-check bash scripts/diagnose-runtime-env.sh
fi

log "Verifying AI Media rollout remains dark"
DEPLOY_DIR="$NEXT_DIR" ENV_FILE="$ENV_FILE_NAME" \
  run_in_dir "$NEXT_DIR" exec-check bash scripts/verify-ai-media-dark.sh

WEB_NEXT_DIR="$NEXT_DIR/apps/web/.next"
WEB_CACHE_DIR="$WEB_NEXT_DIR/cache"
if [ -L "$WEB_NEXT_DIR" ] || [ ! -d "$WEB_NEXT_DIR" ] \
  || [ "$(readlink -f -- "$WEB_NEXT_DIR")" != "$WEB_NEXT_DIR" ]; then
  fail "sealed Web build output must be one real directory"
fi
rm -rf -- "$WEB_CACHE_DIR"
install -d -o "$DEPLOY_RUN_USER" -g "$DEPLOY_RUN_GROUP" -m 0750 "$WEB_CACHE_DIR"
if [ -L "$WEB_CACHE_DIR" ] \
  || [ "$(stat -c '%u:%g:%a' "$WEB_CACHE_DIR")" != "$DEPLOY_RUN_UID:$DEPLOY_RUN_GID:750" ]; then
  fail "runtime Web cache could not be created safely"
fi

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

log "Success: $TARGET_GIT_COMMIT"
REMOTE

rm -f "$TARBALL"
log "Deployment complete"

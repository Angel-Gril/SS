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
#   DEPLOY_RUN_USER=deploy
#   DEPLOY_BUILD_USER=ss-erp-build
#   DEPLOY_BACKUP_GATE_ROOT=/usr/local/lib/ss-erp-deploy-gate
#   EXTENSION_RELEASE_ROOT=/var/lib/ss-erp-extension-releases/<commit>
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
DEPLOY_RUN_USER="${DEPLOY_RUN_USER:-deploy}"
DEPLOY_BUILD_USER="${DEPLOY_BUILD_USER:-ss-erp-build}"
DEPLOY_BACKUP_GATE_ROOT="${DEPLOY_BACKUP_GATE_ROOT:-/usr/local/lib/ss-erp-deploy-gate}"
EXTENSION_RELEASE_ROOT="${EXTENSION_RELEASE_ROOT:-}"
API_SERVICE="${API_SERVICE:-ss-erp-api}"
WEB_SERVICE="${WEB_SERVICE:-ss-erp-web}"
WORKER_SERVICE="${WORKER_SERVICE:-ss-erp-worker}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/ready}"
KEEP_RELEASES="${KEEP_RELEASES:-5}"
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-20m}"
DEPLOY_ENV_PROFILE="${DEPLOY_ENV_PROFILE:-}"

log() { printf '[deploy] %s\n' "$*"; }
fail() { printf '[deploy] ERROR: %s\n' "$*" >&2; exit 1; }

shell_escape() {
  printf '%q' "$1"
}

if [ -z "$DEPLOY_HOST" ]; then
  fail "DEPLOY_HOST is required"
fi
if [[ ! "$MIGRATION_TIMEOUT" =~ ^[1-9][0-9]*[smh]$ ]]; then
  fail "MIGRATION_TIMEOUT must be a positive duration ending in s, m, or h"
fi
if [[ ! "$ENV_FILE_NAME" =~ ^\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  fail "ENV_FILE_NAME must be one dot-prefixed basename"
fi
if [[ ! "$EXTENSION_RELEASE_ROOT" =~ ^/ ]]; then
  fail "EXTENSION_RELEASE_ROOT must be one absolute pre-staged release directory"
fi
if [[ ! "$KEEP_RELEASES" =~ ^[1-9][0-9]{0,2}$ ]] || [ "$KEEP_RELEASES" -gt 100 ]; then
  fail "KEEP_RELEASES must be an integer from 1 through 100"
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
    "rmdir '$REMOTE_UPLOAD_DIR' 2>/dev/null || true" || true
  fail "deployment archive upload failed"
fi

log "Deploying release"
REMOTE_COMMAND="TARGET_GIT_COMMIT=$(shell_escape "$COMMIT_HASH") RELEASE_DIR=$(shell_escape "$RELEASE_DIR") RELEASES_DIR=$(shell_escape "$RELEASES_DIR") CURRENT_LINK=$(shell_escape "$CURRENT_LINK") SHARED_DIR=$(shell_escape "$SHARED_DIR") ENV_FILE_NAME=$(shell_escape "$ENV_FILE_NAME") API_SERVICE=$(shell_escape "$API_SERVICE") WEB_SERVICE=$(shell_escape "$WEB_SERVICE") WORKER_SERVICE=$(shell_escape "$WORKER_SERVICE") HEALTH_URL=$(shell_escape "$HEALTH_URL") KEEP_RELEASES=$(shell_escape "$KEEP_RELEASES") UPLOAD_DIR=$(shell_escape "$REMOTE_UPLOAD_DIR") ARCHIVE_SHA256=$(shell_escape "$ARCHIVE_SHA256") DEPLOY_ENV_PROFILE=$(shell_escape "$DEPLOY_ENV_PROFILE") REQUESTED_MIGRATION_TIMEOUT=$(shell_escape "$MIGRATION_TIMEOUT") DEPLOY_RUN_USER=$(shell_escape "$DEPLOY_RUN_USER") DEPLOY_BUILD_USER=$(shell_escape "$DEPLOY_BUILD_USER") DEPLOY_BACKUP_GATE_ROOT=$(shell_escape "$DEPLOY_BACKUP_GATE_ROOT") EXTENSION_RELEASE_ROOT=$(shell_escape "$EXTENSION_RELEASE_ROOT") bash -s"
ssh "${SSH_ARGS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "$REMOTE_COMMAND" <<'REMOTE'
set -euo pipefail
umask 077

readonly TARGET_GIT_COMMIT="${TARGET_GIT_COMMIT:?}"
readonly RELEASE_DIR="${RELEASE_DIR:?}"
readonly RELEASES_DIR="${RELEASES_DIR:?}"
readonly CURRENT_LINK="${CURRENT_LINK:?}"
readonly SHARED_DIR="${SHARED_DIR:?}"
readonly ENV_FILE_NAME="${ENV_FILE_NAME:?}"
readonly API_SERVICE="${API_SERVICE:?}"
readonly WEB_SERVICE="${WEB_SERVICE:?}"
readonly WORKER_SERVICE="${WORKER_SERVICE:?}"
readonly HEALTH_URL="${HEALTH_URL:?}"
readonly KEEP_RELEASES="${KEEP_RELEASES:?}"
readonly UPLOAD_DIR="${UPLOAD_DIR:?}"
readonly ARCHIVE_SHA256="${ARCHIVE_SHA256:?}"
readonly DEPLOY_ENV_PROFILE="${DEPLOY_ENV_PROFILE:-}"
readonly REQUESTED_MIGRATION_TIMEOUT="${REQUESTED_MIGRATION_TIMEOUT:?}"
readonly DEPLOY_RUN_USER="${DEPLOY_RUN_USER:?}"
readonly DEPLOY_BUILD_USER="${DEPLOY_BUILD_USER:?}"
readonly DEPLOY_BACKUP_GATE_ROOT="${DEPLOY_BACKUP_GATE_ROOT:?}"
readonly EXTENSION_RELEASE_ROOT="${EXTENSION_RELEASE_ROOT:?}"
readonly TARBALL="$UPLOAD_DIR/archive.tar.gz"
DEPLOY_ENV_SNAPSHOT_DIR=""
DEPLOY_ENV_SNAPSHOT=""
DEPLOY_BUILD_HOME=""
DEPLOY_SOURCE_MANIFEST=""
DEPLOY_BUILD_MANIFEST=""
current_target=""
previous_git_commit=""
PREVIOUS_RELEASE=""

if [[ ! "$TARGET_GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[deploy] ERROR: target commit must be one lowercase full 40-character object ID" >&2
  exit 1
fi
if [ "$(id -u)" != "0" ]; then
  echo "[deploy] ERROR: release deployment must run as root" >&2
  exit 1
fi
if [[ ! "$DEPLOY_RUN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] \
  || ! id -- "$DEPLOY_RUN_USER" >/dev/null 2>&1; then
  echo "[deploy] ERROR: deployment runtime user is missing: $DEPLOY_RUN_USER" >&2
  exit 1
fi
if [[ ! "$DEPLOY_BUILD_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] \
  || ! id -- "$DEPLOY_BUILD_USER" >/dev/null 2>&1 \
  || [ "$DEPLOY_BUILD_USER" = "$DEPLOY_RUN_USER" ]; then
  echo "[deploy] ERROR: a distinct deployment build user is required: $DEPLOY_BUILD_USER" >&2
  exit 1
fi
readonly DEPLOY_RUN_GROUP="$(id -gn -- "$DEPLOY_RUN_USER")"
readonly DEPLOY_RUN_UID="$(id -u -- "$DEPLOY_RUN_USER")"
readonly DEPLOY_RUN_GID="$(id -g -- "$DEPLOY_RUN_USER")"
readonly DEPLOY_BUILD_GROUP="$(id -gn -- "$DEPLOY_BUILD_USER")"
readonly DEPLOY_BUILD_UID="$(id -u -- "$DEPLOY_BUILD_USER")"
readonly DEPLOY_BUILD_GID="$(id -g -- "$DEPLOY_BUILD_USER")"
if [ "$DEPLOY_RUN_UID" = "0" ] || [ "$DEPLOY_RUN_GID" = "0" ] \
  || [ "$DEPLOY_BUILD_UID" = "0" ] || [ "$DEPLOY_BUILD_GID" = "0" ] \
  || [ "$DEPLOY_BUILD_UID" = "$DEPLOY_RUN_UID" ] \
  || [ "$DEPLOY_BUILD_GID" = "$DEPLOY_RUN_GID" ]; then
  echo "[deploy] ERROR: build and runtime users require distinct non-root UIDs and GIDs" >&2
  exit 1
fi
if [[ ! "$UPLOAD_DIR" =~ ^/tmp/ss-erp-deploy-upload\.[A-Za-z0-9]{10}$ ]] \
  || [ -L "$UPLOAD_DIR" ] || [ ! -d "$UPLOAD_DIR" ] \
  || [ "$(stat -c '%u:%a' "$UPLOAD_DIR" 2>/dev/null)" != "0:700" ] \
  || [ -L "$TARBALL" ] || [ ! -f "$TARBALL" ] \
  || [ "$(stat -c '%u' "$TARBALL" 2>/dev/null)" != "0" ] \
  || [ "$(sha256sum "$TARBALL" | awk '{print $1}')" != "$ARCHIVE_SHA256" ]; then
  echo "[deploy] ERROR: deployment archive identity or SHA-256 is invalid" >&2
  exit 1
fi
readonly MIGRATION_TIMEOUT="$REQUESTED_MIGRATION_TIMEOUT"
if [[ ! "$MIGRATION_TIMEOUT" =~ ^[1-9][0-9]*[smh]$ ]]; then
  echo "[deploy] ERROR: migration timeout is invalid" >&2
  exit 1
fi
if [[ ! "$KEEP_RELEASES" =~ ^[1-9][0-9]{0,2}$ ]] || [ "$KEEP_RELEASES" -gt 100 ]; then
  echo "[deploy] ERROR: release retention must be an integer from 1 through 100" >&2
  exit 1
fi

run_in_dir() {
  local directory="$1"
  local environment_mode="$2"
  shift 2
  local child_environment=(
    "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
    "HOME=/home/$DEPLOY_RUN_USER"
    "LANG=C.UTF-8"
  )
  local key
  if ! id "$DEPLOY_RUN_USER" >/dev/null 2>&1; then
    echo "[deploy] ERROR: deployment runtime user is missing: $DEPLOY_RUN_USER" >&2
    exit 1
  fi
  for key in DEPLOY_DIR ENV_FILE SKIP_HTTP_CHECK \
    SKIP_PROCESS_ENV_CHECKS SKIP_SERVICE_CHECKS; do
    if [ -n "${!key:-}" ]; then
      child_environment+=("$key=${!key}")
    fi
  done
  env -i "${child_environment[@]}" \
    node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-environment.mjs" \
    "${environment_mode}-as" "$DEPLOY_ENV_SNAPSHOT" "$directory" \
    "$([ "$environment_mode" = "exec-build" ] && printf '%s' "$DEPLOY_BUILD_UID" || printf '%s' "$DEPLOY_RUN_UID")" \
    "$([ "$environment_mode" = "exec-build" ] && printf '%s' "$DEPLOY_BUILD_GID" || printf '%s' "$DEPLOY_RUN_GID")" \
    "$([ "$environment_mode" = "exec-build" ] && printf '%s' "$DEPLOY_BUILD_HOME" || printf '/home/%s' "$DEPLOY_RUN_USER")" \
    -- "$@"
}

cleanup_environment_snapshot() {
  if [ -n "$DEPLOY_ENV_SNAPSHOT_DIR" ] && [ -d "$DEPLOY_ENV_SNAPSHOT_DIR" ]; then
    rm -rf -- "$DEPLOY_ENV_SNAPSHOT_DIR"
  fi
  if [ -n "$DEPLOY_BUILD_HOME" ] && [ -d "$DEPLOY_BUILD_HOME" ]; then
    rm -rf -- "$DEPLOY_BUILD_HOME"
  fi
}

install_target_backup_gate() {
  local source_root="$1"
  bash "$source_root/scripts/install-deploy-backup-gate.sh" \
    "$TARGET_GIT_COMMIT" "$source_root" "$DEPLOY_BACKUP_GATE_ROOT"
}

assert_root_directory() {
  local directory="$1"
  local mode
  if [ -L "$directory" ] || [ ! -d "$directory" ] \
    || [ "$(readlink -f -- "$directory")" != "$directory" ] \
    || [ "$(stat -c '%u' "$directory")" != "0" ]; then
    echo "[deploy] ERROR: release parent must be one root-owned canonical directory: $directory" >&2
    exit 1
  fi
  mode="$(stat -c '%a' "$directory")"
  if (( (8#$mode & 8#022) != 0 )); then
    echo "[deploy] ERROR: release parent must not be group/world writable: $directory" >&2
    exit 1
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

assert_extension_release_files() {
  local ancestor="$EXTENSION_RELEASE_ROOT"
  local file
  local mode
  local count=0
  while true; do
    mode="$(stat -c '%a' "$ancestor")"
    if (( (8#$mode & 8#001) == 0 )); then
      echo "[deploy] ERROR: extension release ancestors must be traversable by the build user" >&2
      exit 1
    fi
    [ "$ancestor" = "/" ] && break
    ancestor="$(dirname -- "$ancestor")"
  done
  if [ "$(stat -c '%a' "$EXTENSION_RELEASE_ROOT")" != "755" ]; then
    echo "[deploy] ERROR: extension release root must use mode 0755" >&2
    exit 1
  fi
  while IFS= read -r -d '' file; do
    count=$((count + 1))
    if [ -L "$file" ] || [ ! -f "$file" ] || [ ! -r "$file" ] \
      || [ "$(stat -c '%u' "$file")" != "0" ]; then
      echo "[deploy] ERROR: extension release input must be a readable root-owned regular file" >&2
      exit 1
    fi
    mode="$(stat -c '%a' "$file")"
    if [ "$mode" != "644" ]; then
      echo "[deploy] ERROR: extension release input must use mode 0644" >&2
      exit 1
    fi
  done < <(find -P "$EXTENSION_RELEASE_ROOT" -mindepth 1 -maxdepth 1 -print0)
  if [ "$count" -ne 4 ]; then
    echo "[deploy] ERROR: extension release root must contain exactly four files" >&2
    exit 1
  fi
}

install_root_runtime_symlink() {
  local target="$1"
  local link="$2"
  local target_real
  if [ -L "$target" ] || { [ ! -d "$target" ] && [ ! -f "$target" ]; }; then
    echo "[deploy] ERROR: runtime symlink target is not a trusted file or directory: $target" >&2
    exit 1
  fi
  if [ -e "$link" ] || [ -L "$link" ]; then
    echo "[deploy] ERROR: build produced a reserved runtime path: $link" >&2
    exit 1
  fi
  assert_root_ancestor_chain "$(dirname -- "$link")"
  target_real="$(readlink -f -- "$target")"
  ln -sT -- "$target_real" "$link"
  chown -h root:root "$link"
  if [ "$(readlink -f -- "$link")" != "$target_real" ] \
    || [ "$(stat -c '%u' "$link")" != "0" ]; then
    echo "[deploy] ERROR: runtime symlink verification failed: $link" >&2
    exit 1
  fi
}

echo "[deploy] Preparing $RELEASE_DIR"
if [ -L "$RELEASE_DIR" ] || [ -e "$RELEASE_DIR" ]; then
  echo "[deploy] ERROR: release directory already exists: $RELEASE_DIR" >&2
  exit 1
fi
assert_root_ancestor_chain "$RELEASES_DIR"
assert_root_ancestor_chain "$SHARED_DIR"
assert_root_ancestor_chain "$(dirname -- "$CURRENT_LINK")"
assert_root_ancestor_chain "$EXTENSION_RELEASE_ROOT"
assert_extension_release_files
if [ -e "$CURRENT_LINK" ] || [ -L "$CURRENT_LINK" ]; then
  if [ ! -L "$CURRENT_LINK" ]; then
    echo "[deploy] ERROR: current path must be a symlink: $CURRENT_LINK" >&2
    exit 1
  fi
  current_target="$(readlink -f -- "$CURRENT_LINK")"
  if [ ! -d "$current_target" ]; then
    echo "[deploy] ERROR: current symlink target is not one release directory" >&2
    exit 1
  fi
  previous_git_commit="${current_target##*/}"
  if [ "$(dirname -- "$current_target")" != "$RELEASES_DIR" ] \
    || [[ ! "$previous_git_commit" =~ ^[0-9a-f]{40}$ ]]; then
    echo "[deploy] ERROR: current symlink must target one direct commit release" >&2
    exit 1
  fi
fi
mkdir "$RELEASE_DIR"
tar -xzf "$TARBALL" -C "$RELEASE_DIR" --strip-components=1
rm -f -- "$TARBALL"
rmdir -- "$UPLOAD_DIR"
install_target_backup_gate "$RELEASE_DIR"
if [ -n "$current_target" ]; then
  bash "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/freeze-deploy-source.sh" \
    verify "$previous_git_commit" "$current_target"
fi

if [ -L "$SHARED_DIR/$ENV_FILE_NAME" ] || [ ! -f "$SHARED_DIR/$ENV_FILE_NAME" ] \
  || [ "$(stat -c '%u:%g:%a' "$SHARED_DIR/$ENV_FILE_NAME")" \
    != "0:$(id -g "$DEPLOY_RUN_USER"):640" ]; then
  echo "[deploy] ERROR: missing shared env file: $SHARED_DIR/$ENV_FILE_NAME" >&2
  exit 1
fi
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
  "$SHARED_DIR/$ENV_FILE_NAME" "$DEPLOY_ENV_SNAPSHOT"
chown "root:$DEPLOY_RUN_GROUP" "$DEPLOY_ENV_SNAPSHOT_DIR" "$DEPLOY_ENV_SNAPSHOT"
chmod 0750 "$DEPLOY_ENV_SNAPSHOT_DIR"
chmod 0640 "$DEPLOY_ENV_SNAPSHOT"
chmod 0700 "$DEPLOY_ENV_SNAPSHOT_DIR"
node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-source-manifest.mjs" create \
  "$RELEASE_DIR" "$DEPLOY_SOURCE_MANIFEST" "$TARGET_GIT_COMMIT"
chmod 0750 "$DEPLOY_ENV_SNAPSHOT_DIR"

for shared_child in uploads backups; do
  if [ -L "$SHARED_DIR/$shared_child" ]; then
    echo "[deploy] ERROR: shared runtime directory must not be a symlink: $shared_child" >&2
    exit 1
  fi
  mkdir -p "$SHARED_DIR/$shared_child"
  chown "$DEPLOY_RUN_USER:$DEPLOY_RUN_GROUP" "$SHARED_DIR/$shared_child"
  chmod 0750 "$SHARED_DIR/$shared_child"
done
find "$RELEASE_DIR" -mindepth 1 -maxdepth 1 \
  ! -name "$ENV_FILE_NAME" ! -name '.env.staging' \
  -exec chown -hR -P "$DEPLOY_BUILD_USER:$DEPLOY_BUILD_GROUP" -- {} +
chown root:root "$RELEASE_DIR"
chmod 0755 "$RELEASE_DIR"
for writable_root in node_modules build .turbo; do
  mkdir -p "$RELEASE_DIR/$writable_root"
  chown -R "$DEPLOY_BUILD_USER:$DEPLOY_BUILD_GROUP" "$RELEASE_DIR/$writable_root"
done
printf '%s\n' "$TARGET_GIT_COMMIT" > "$RELEASE_DIR/DEPLOYED_COMMIT"
chown root:root "$RELEASE_DIR/DEPLOYED_COMMIT"
chmod 0444 "$RELEASE_DIR/DEPLOYED_COMMIT"

if [ -n "$DEPLOY_ENV_PROFILE" ]; then
  if [ "$DEPLOY_ENV_PROFILE" = "cloud-r2" ]; then
    echo "[deploy] Validating bootstrap env for profile: $DEPLOY_ENV_PROFILE"
    run_in_dir "$RELEASE_DIR" exec-check node scripts/validate-env.mjs --profile cloud-bootstrap --env "$DEPLOY_ENV_SNAPSHOT"
  else
    echo "[deploy] Validating env profile: $DEPLOY_ENV_PROFILE"
    run_in_dir "$RELEASE_DIR" exec-check node scripts/validate-env.mjs --profile "$DEPLOY_ENV_PROFILE" --env "$DEPLOY_ENV_SNAPSHOT"
  fi
fi

echo "[deploy] Installing dependencies"
run_in_dir "$RELEASE_DIR" exec-build pnpm install --frozen-lockfile

echo "[deploy] Generating Prisma client"
run_in_dir "$RELEASE_DIR/apps/server" exec-build npx prisma generate

echo "[deploy] Building server and web"
run_in_dir "$RELEASE_DIR" exec-build pnpm --filter server build
run_in_dir "$RELEASE_DIR" exec-build pnpm --filter web build

PREVIOUS_RELEASE="$current_target"
echo "[deploy] Staging the prebuilt cloud and local extension release"
EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN="$(node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-environment.mjs" value "$DEPLOY_ENV_SNAPSHOT" EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN)"
EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN="$(node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-environment.mjs" value "$DEPLOY_ENV_SNAPSHOT" EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN)"
EXTENSION_RELEASE_EXPECTED_API_ORIGIN="$(node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-environment.mjs" value "$DEPLOY_ENV_SNAPSHOT" EXTENSION_RELEASE_EXPECTED_API_ORIGIN)"
EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN="$(node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-environment.mjs" value "$DEPLOY_ENV_SNAPSHOT" EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN)"
run_in_dir "$RELEASE_DIR" exec-build node scripts/stage-extension-release.mjs \
  --build-root "$EXTENSION_RELEASE_ROOT" \
  --output-dir "$RELEASE_DIR/build/extensions" \
  --target-git-commit "$TARGET_GIT_COMMIT" \
  --expected-web-origin "$EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN" \
  --expected-admin-origin "$EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN" \
  --expected-api-origin "$EXTENSION_RELEASE_EXPECTED_API_ORIGIN" \
  --expected-local-origin "${EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN:-http://127.0.0.1:3001}"

echo "[deploy] Revoking build-user writes to the staged extension release"
chown root:root "$RELEASE_DIR/build"
chmod 0755 "$RELEASE_DIR/build"
if [ -L "$RELEASE_DIR/build/extensions" ] || [ ! -d "$RELEASE_DIR/build/extensions" ]; then
  echo "[deploy] ERROR: staged extension release must be one real directory" >&2
  exit 1
fi
chown root:root "$RELEASE_DIR/build/extensions"
chmod 0755 "$RELEASE_DIR/build/extensions"
find -P "$RELEASE_DIR/build/extensions" -xdev -type f -exec chown root:root -- {} +
find -P "$RELEASE_DIR/build/extensions" -xdev -type f -exec chmod 0644 -- {} +

echo "[deploy] Recording closed post-build source manifest"
chmod 0700 "$DEPLOY_ENV_SNAPSHOT_DIR"
node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-source-manifest.mjs" create-closed \
  "$RELEASE_DIR" "$DEPLOY_BUILD_MANIFEST" "$TARGET_GIT_COMMIT"
chmod 0750 "$DEPLOY_ENV_SNAPSHOT_DIR"

echo "[deploy] Sealing built source on new root-owned inodes"
SEALED_RELEASE_DIR="$RELEASE_DIR.sealed.$$"
UNSEALED_RELEASE_DIR="$RELEASE_DIR.unsealed.$$"
bash "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/freeze-deploy-source.sh" \
  seal "$TARGET_GIT_COMMIT" "$RELEASE_DIR" "$SEALED_RELEASE_DIR"
node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-source-manifest.mjs" verify \
  "$SEALED_RELEASE_DIR" "$DEPLOY_SOURCE_MANIFEST" "$TARGET_GIT_COMMIT"
node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-source-manifest.mjs" verify \
  "$SEALED_RELEASE_DIR" "$DEPLOY_BUILD_MANIFEST" "$TARGET_GIT_COMMIT"
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$SEALED_RELEASE_DIR/scripts/stage-extension-release.mjs" \
  --build-root "$EXTENSION_RELEASE_ROOT" \
  --verify-output-dir "$SEALED_RELEASE_DIR/build/extensions" \
  --target-git-commit "$TARGET_GIT_COMMIT" \
  --expected-web-origin "$EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN" \
  --expected-admin-origin "$EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN" \
  --expected-api-origin "$EXTENSION_RELEASE_EXPECTED_API_ORIGIN" \
  --expected-local-origin "${EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN:-http://127.0.0.1:3001}"
mv "$RELEASE_DIR" "$UNSEALED_RELEASE_DIR"
mv "$SEALED_RELEASE_DIR" "$RELEASE_DIR"
rm -rf -- "$UNSEALED_RELEASE_DIR"
install_root_runtime_symlink \
  "$SHARED_DIR/$ENV_FILE_NAME" "$RELEASE_DIR/$ENV_FILE_NAME"
if [ "$ENV_FILE_NAME" != ".env.staging" ]; then
  install_root_runtime_symlink \
    "$SHARED_DIR/$ENV_FILE_NAME" "$RELEASE_DIR/.env.staging"
fi
install_root_runtime_symlink \
  "$SHARED_DIR/uploads" "$RELEASE_DIR/apps/server/public/uploads"
install_root_runtime_symlink "$SHARED_DIR/backups" "$RELEASE_DIR/backups"
bash "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/freeze-deploy-source.sh" \
  verify "$TARGET_GIT_COMMIT" "$RELEASE_DIR"

SERVICES_QUIESCED=0
restore_quiesced_services() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$SERVICES_QUIESCED" = "1" ]; then
    systemctl stop "$WORKER_SERVICE" "$API_SERVICE" || true
    echo "[deploy] Worker/API remain stopped after failed migration or gate; operator recovery is required" >&2
  fi
  cleanup_environment_snapshot
  exit "$status"
}
trap restore_quiesced_services EXIT

rollback() {
  if [ -n "$PREVIOUS_RELEASE" ] && [ -d "$PREVIOUS_RELEASE" ]; then
    echo "[deploy] Rolling back to ${PREVIOUS_RELEASE##*/}"
    ln -sfnT "$PREVIOUS_RELEASE" "$CURRENT_LINK"
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

echo "[deploy] Verifying commit/database/restore-bound backup attestation"
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-backup-gate.mjs" \
  --mode migrate \
  --env-file "$DEPLOY_ENV_SNAPSHOT" \
  --target-git-commit "$TARGET_GIT_COMMIT" \
  --server-dir "$RELEASE_DIR/apps/server" \
  --run-user "$DEPLOY_RUN_USER" \
  --migration-timeout "$MIGRATION_TIMEOUT"

if [ "$DEPLOY_ENV_PROFILE" = "cloud-r2" ]; then
  echo "[deploy] Validating runtime upload config for profile: $DEPLOY_ENV_PROFILE"
  DEPLOY_DIR="$RELEASE_DIR" ENV_FILE="$ENV_FILE_NAME" SKIP_SERVICE_CHECKS=1 \
    SKIP_PROCESS_ENV_CHECKS=1 SKIP_HTTP_CHECK=1 \
    run_in_dir "$RELEASE_DIR" exec-check bash scripts/diagnose-runtime-env.sh
fi

echo "[deploy] Verifying AI Media rollout remains dark"
DEPLOY_DIR="$RELEASE_DIR" ENV_FILE="$ENV_FILE_NAME" \
  run_in_dir "$RELEASE_DIR" exec-check bash scripts/verify-ai-media-dark.sh

WEB_NEXT_DIR="$RELEASE_DIR/apps/web/.next"
WEB_CACHE_DIR="$WEB_NEXT_DIR/cache"
if [ -L "$WEB_NEXT_DIR" ] || [ ! -d "$WEB_NEXT_DIR" ] \
  || [ "$(readlink -f -- "$WEB_NEXT_DIR")" != "$WEB_NEXT_DIR" ]; then
  echo "[deploy] ERROR: sealed Web build output must be one real directory" >&2
  exit 1
fi
rm -rf -- "$WEB_CACHE_DIR"
install -d -o "$DEPLOY_RUN_USER" -g "$DEPLOY_RUN_GROUP" -m 0750 "$WEB_CACHE_DIR"
if [ -L "$WEB_CACHE_DIR" ] \
  || [ "$(stat -c '%u:%g:%a' "$WEB_CACHE_DIR")" != "$DEPLOY_RUN_UID:$DEPLOY_RUN_GID:750" ]; then
  echo "[deploy] ERROR: runtime Web cache could not be created safely" >&2
  exit 1
fi

node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-environment.mjs" compare \
  "$SHARED_DIR/$ENV_FILE_NAME" "$DEPLOY_ENV_SNAPSHOT"
echo "[deploy] Switching current symlink"
ln -sfnT "$RELEASE_DIR" "$CURRENT_LINK"

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

echo "[deploy] Success: $TARGET_GIT_COMMIT"
REMOTE

rm -f "$TARBALL"
log "Deployment complete"

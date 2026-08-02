#!/usr/bin/env bash
set -euo pipefail

# Initialize directories for release-directory deployment.
#
# Optional env:
#   DEPLOY_BASE=/opt/ss-erp
#   DEPLOY_USER=deploy
#   DEPLOY_BUILD_USER=ss-erp-build
#   DEPLOY_BUILD_ROOT=/var/lib/ss-erp-deploy-build
#   ENV_FILE_NAME=.env.staging

DEPLOY_BASE="${DEPLOY_BASE:-/opt/ss-erp}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_BUILD_USER="${DEPLOY_BUILD_USER:-ss-erp-build}"
ENV_FILE_NAME="${ENV_FILE_NAME:-.env.staging}"
RELEASES_DIR="$DEPLOY_BASE/releases"
SHARED_DIR="$DEPLOY_BASE/shared"
CURRENT_LINK="$DEPLOY_BASE/current"

fail() {
  printf '[init] ERROR: %s\n' "$*" >&2
  exit 1
}

for required_command in findmnt flock mountpoint; do
  if ! command -v "$required_command" >/dev/null 2>&1; then
    fail "required deployment command is missing: $required_command"
  fi
done

if [[ ! "$DEPLOY_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] \
  || ! id -- "$DEPLOY_USER" >/dev/null 2>&1; then
  echo "[init] ERROR: deployment runtime user is missing: $DEPLOY_USER" >&2
  exit 1
fi
if [[ ! "$DEPLOY_BUILD_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  fail "deployment build user name is invalid"
fi
if ! id -- "$DEPLOY_BUILD_USER" >/dev/null 2>&1; then
  sudo useradd --system --user-group --home-dir /nonexistent --shell /usr/sbin/nologin \
    -- "$DEPLOY_BUILD_USER"
fi
if [ "$DEPLOY_BUILD_USER" = "$DEPLOY_USER" ]; then
  echo "[init] ERROR: deployment build user must differ from runtime user" >&2
  exit 1
fi
DEPLOY_GROUP="$(id -gn -- "$DEPLOY_USER")"
DEPLOY_UID="$(id -u -- "$DEPLOY_USER")"
DEPLOY_GID="$(id -g -- "$DEPLOY_USER")"
DEPLOY_BUILD_UID="$(id -u -- "$DEPLOY_BUILD_USER")"
DEPLOY_BUILD_GID="$(id -g -- "$DEPLOY_BUILD_USER")"
if [ "$DEPLOY_UID" = "0" ] || [ "$DEPLOY_GID" = "0" ] \
  || [ "$DEPLOY_BUILD_UID" = "0" ] || [ "$DEPLOY_BUILD_GID" = "0" ] \
  || [ "$DEPLOY_BUILD_UID" = "$DEPLOY_UID" ] \
  || [ "$DEPLOY_BUILD_GID" = "$DEPLOY_GID" ]; then
  fail "build and runtime users require distinct non-root UIDs and GIDs"
fi

case "$DEPLOY_BASE" in
  /*) ;;
  *) fail "DEPLOY_BASE must be an absolute path" ;;
esac
if [ "$(readlink -m -- "$DEPLOY_BASE")" != "$DEPLOY_BASE" ]; then
  fail "DEPLOY_BASE must be one canonical absolute path"
fi
if [[ ! "$ENV_FILE_NAME" =~ ^\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  fail "ENV_FILE_NAME must be one dot-prefixed basename"
fi

assert_real_directory_or_absent() {
  local directory="$1"
  if [ -L "$directory" ] || { [ -e "$directory" ] && [ ! -d "$directory" ]; }; then
    fail "managed directory must not be a symlink or non-directory: $directory"
  fi
  if [ -d "$directory" ] && [ "$(readlink -f -- "$directory")" != "$directory" ]; then
    fail "managed directory must be canonical: $directory"
  fi
}

assert_root_owned_ancestor_chain() {
  local current="$1"
  local label="$2"
  local mode
  while true; do
    if [ -L "$current" ] || [ ! -d "$current" ] \
      || [ "$(readlink -f -- "$current")" != "$current" ] \
      || [ "$(stat -c '%u' "$current")" != "0" ]; then
      fail "$label ancestors must be readable root-owned canonical directories"
    fi
    mode="$(stat -c '%a' "$current")"
    if (( (8#$mode & 8#022) != 0 )); then
      fail "$label ancestors must not be group/world writable"
    fi
    [ "$current" = "/" ] && break
    current="$(dirname -- "$current")"
  done
}

assert_real_directory_or_absent "$DEPLOY_BASE"
DEPLOY_PARENT="$(dirname -- "$DEPLOY_BASE")"
assert_root_owned_ancestor_chain "$DEPLOY_PARENT" "DEPLOY_BASE"

echo "[init] Creating release deployment directories"
sudo install -d -o root -g root -m 0755 "$DEPLOY_BASE"
sudo chown root:root "$DEPLOY_BASE"
sudo chmod 0755 "$DEPLOY_BASE"
assert_real_directory_or_absent "$RELEASES_DIR"
assert_real_directory_or_absent "$SHARED_DIR"
sudo install -d -o root -g root -m 0755 "$RELEASES_DIR" "$SHARED_DIR"
for managed_child in "$SHARED_DIR/uploads" "$SHARED_DIR/backups"; do
  assert_real_directory_or_absent "$managed_child"
done
sudo install -d -o "$DEPLOY_USER" -g "$DEPLOY_GROUP" -m 0750 \
  "$SHARED_DIR/uploads" "$SHARED_DIR/backups"
sudo chown root:root "$DEPLOY_BASE" "$RELEASES_DIR" "$SHARED_DIR"
sudo chmod 0755 "$DEPLOY_BASE" "$RELEASES_DIR" "$SHARED_DIR"

if [ -e "$CURRENT_LINK" ] || [ -L "$CURRENT_LINK" ]; then
  if [ ! -L "$CURRENT_LINK" ]; then
    fail "current path must be a symlink when it already exists"
  fi
  CURRENT_TARGET="$(readlink -f -- "$CURRENT_LINK")"
  CURRENT_COMMIT="${CURRENT_TARGET##*/}"
  if [ "$(dirname -- "$CURRENT_TARGET")" != "$RELEASES_DIR" ] \
    || [[ ! "$CURRENT_COMMIT" =~ ^[0-9a-f]{40}$ ]] \
    || [ ! -d "$CURRENT_TARGET" ]; then
    fail "current symlink must target one direct commit release beneath $RELEASES_DIR"
  fi
fi

ENV_PATH="$SHARED_DIR/$ENV_FILE_NAME"
if [ -L "$ENV_PATH" ] || { [ -e "$ENV_PATH" ] && [ ! -f "$ENV_PATH" ]; }; then
  fail "environment path must be a regular non-symbolic-link file"
fi
if [ -f "$ENV_PATH" ] && [ "$(stat -c '%h' "$ENV_PATH")" != "1" ]; then
  fail "environment file must not have additional hard links"
fi
if [ ! -e "$ENV_PATH" ]; then
  sudo install -o root -g "$DEPLOY_GROUP" -m 0640 /dev/null "$ENV_PATH"
fi
sudo chown "root:$DEPLOY_GROUP" "$ENV_PATH"
sudo chmod 0640 "$ENV_PATH"

COMPOSE_LOCK_ROOT=/var/lib/ss-erp-deploy-locks
DEPLOY_BUILD_ROOT="${DEPLOY_BUILD_ROOT:-/var/lib/ss-erp-deploy-build}"
DEPLOY_BUILD_LOCK_FILE="$DEPLOY_BUILD_ROOT/deploy.lock"
EXTENSION_RELEASE_BASE="${EXTENSION_RELEASE_BASE:-/var/lib/ss-erp-extension-releases}"
if [ -L "$COMPOSE_LOCK_ROOT" ] \
  || { [ -e "$COMPOSE_LOCK_ROOT" ] && [ ! -d "$COMPOSE_LOCK_ROOT" ]; }; then
  fail "Compose deployment lock root must be one real directory"
fi
sudo install -d -o root -g "$DEPLOY_GROUP" -m 0750 "$COMPOSE_LOCK_ROOT"
if [[ "$DEPLOY_BUILD_ROOT" != /* ]] \
  || [ "$(readlink -m -- "$DEPLOY_BUILD_ROOT")" != "$DEPLOY_BUILD_ROOT" ] \
  || [ -L "$DEPLOY_BUILD_ROOT" ] \
  || { [ -e "$DEPLOY_BUILD_ROOT" ] && [ ! -d "$DEPLOY_BUILD_ROOT" ]; }; then
  fail "deployment build root must be one absolute real canonical directory"
fi
assert_root_owned_ancestor_chain "$(dirname -- "$DEPLOY_BUILD_ROOT")" "deployment build root"
if [ ! -e "$DEPLOY_BUILD_ROOT" ]; then
  sudo install -d -o root -g root -m 0711 "$DEPLOY_BUILD_ROOT"
fi
if [ "$(stat -c '%u:%g:%a' "$DEPLOY_BUILD_ROOT")" != "0:0:711" ]; then
  fail "deployment build root must be root:root mode 0711"
fi
DEPLOY_BUILD_FS_TYPE="$(findmnt -n -o FSTYPE --target "$DEPLOY_BUILD_ROOT")"
case "$DEPLOY_BUILD_FS_TYPE" in
  tmpfs|ramfs) fail "deployment build root must use a disk-backed filesystem" ;;
  '') fail "deployment build root filesystem could not be resolved" ;;
esac
if [ -L "$DEPLOY_BUILD_LOCK_FILE" ] \
  || { [ -e "$DEPLOY_BUILD_LOCK_FILE" ] && [ ! -f "$DEPLOY_BUILD_LOCK_FILE" ]; }; then
  fail "deployment build lock must be one regular file"
fi
if [ ! -e "$DEPLOY_BUILD_LOCK_FILE" ]; then
  sudo install -o root -g "$DEPLOY_GROUP" -m 0660 /dev/null "$DEPLOY_BUILD_LOCK_FILE"
fi
if [ "$(stat -c '%u:%g:%a:%h' "$DEPLOY_BUILD_LOCK_FILE")" \
  != "0:$DEPLOY_GID:660:1" ]; then
  fail "deployment build lock ownership, mode, or link count is invalid"
fi
if [[ "$EXTENSION_RELEASE_BASE" != /* ]] \
  || [ "$(readlink -m -- "$EXTENSION_RELEASE_BASE")" != "$EXTENSION_RELEASE_BASE" ] \
  || [ -L "$EXTENSION_RELEASE_BASE" ] \
  || { [ -e "$EXTENSION_RELEASE_BASE" ] && [ ! -d "$EXTENSION_RELEASE_BASE" ]; }; then
  fail "extension release base must be one absolute real canonical directory"
fi
assert_real_directory_or_absent "$EXTENSION_RELEASE_BASE"
assert_root_owned_ancestor_chain "$(dirname -- "$EXTENSION_RELEASE_BASE")" "extension release base"
sudo install -d -o root -g root -m 0755 "$EXTENSION_RELEASE_BASE"
sudo chown root:root "$EXTENSION_RELEASE_BASE"
sudo chmod 0755 "$EXTENSION_RELEASE_BASE"
for compose_project in ss-erp-prod ss-erp-staging; do
  COMPOSE_LOCK_FILE="$COMPOSE_LOCK_ROOT/$compose_project.lock"
  if [ -L "$COMPOSE_LOCK_FILE" ] \
    || { [ -e "$COMPOSE_LOCK_FILE" ] && [ ! -f "$COMPOSE_LOCK_FILE" ]; }; then
    fail "Compose deployment lock path must be one regular file"
  fi
  if [ ! -e "$COMPOSE_LOCK_FILE" ]; then
    sudo install -o root -g "$DEPLOY_GROUP" -m 0660 /dev/null "$COMPOSE_LOCK_FILE"
  fi
  sudo chown "root:$DEPLOY_GROUP" "$COMPOSE_LOCK_FILE"
  sudo chmod 0660 "$COMPOSE_LOCK_FILE"
done

cat <<EOF
[init] Done.

Directories:
  releases: $RELEASES_DIR
  shared:   $SHARED_DIR
  current:  $CURRENT_LINK

Next steps:
  1. Put production env values in $SHARED_DIR/$ENV_FILE_NAME
  2. Install the target-bound database gate and signed four-file extension candidate
  3. Create and verify the target-bound backup/restore attestation
  4. Deploy with:
     DEPLOY_HOST=<server> DEPLOY_USER=<ssh-user> ./scripts/deploy.sh
     deploy.sh snapshots the existing units, installs verified release-mode units after
     switching current, and restores the snapshot automatically if activation fails.
EOF

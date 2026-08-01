#!/usr/bin/env bash
set -euo pipefail
umask 077

# Install or restore systemd units for release-directory deployment.
#
# Install:
#   DEPLOY_BASE=/opt/ss-erp \
#   UNIT_SNAPSHOT_DIR=/var/lib/ss-erp-deploy-systemd/<commit> \
#     bash scripts/install-release-systemd.sh [--restart]
#
# Restore a previously captured unit set (does not restart services):
#   UNIT_SNAPSHOT_DIR=/var/lib/ss-erp-deploy-systemd/<commit> \
#     bash scripts/install-release-systemd.sh --restore

DEPLOY_BASE="${DEPLOY_BASE:-/opt/ss-erp}"
ENV_FILE_NAME="${ENV_FILE_NAME:-.env.staging}"
UNIT_SRC_DIR="${UNIT_SRC_DIR:-deploy/systemd-release}"
UNIT_DST_DIR="${UNIT_DST_DIR:-/etc/systemd/system}"
UNIT_SNAPSHOT_DIR="${UNIT_SNAPSHOT_DIR:-}"
API_SERVICE="${API_SERVICE:-ss-erp-api}"
WORKER_SERVICE="${WORKER_SERVICE:-ss-erp-worker}"
WEB_SERVICE="${WEB_SERVICE:-ss-erp-web}"
RESTART=false
RESTORE=false
CURRENT_LINK="$DEPLOY_BASE/current"
SHARED_ENV_FILE="$DEPLOY_BASE/shared/$ENV_FILE_NAME"
SERVICES=("$API_SERVICE" "$WORKER_SERVICE" "$WEB_SERVICE")

fail() {
  echo "[systemd] ERROR: $*" >&2
  exit 1
}

run_root() {
  if [ "$(id -u)" = "0" ]; then
    "$@"
  else
    sudo "$@"
  fi
}

canonical_absolute_path() {
  local value="$1"
  [ "${value#/}" != "$value" ] && [ "$(readlink -m -- "$value")" = "$value" ]
}

assert_real_regular_file() {
  local file="$1"
  local field="$2"
  [ -f "$file" ] && [ ! -L "$file" ] \
    || fail "$field must be one real regular file: $file"
  [ "$(stat -c '%h' "$file")" = "1" ] \
    || fail "$field must not have multiple hard links: $file"
  [ "$(stat -c '%u' "$file")" = "0" ] \
    || fail "$field must be root-owned: $file"
  local mode
  mode="$(stat -c '%a' "$file")"
  (( (8#$mode & 8#022) == 0 )) \
    || fail "$field must not be group/world writable: $file"
}

assert_root_directory() {
  local directory="$1"
  [ -d "$directory" ] && [ ! -L "$directory" ] \
    && [ "$(readlink -f -- "$directory")" = "$directory" ] \
    && [ "$(stat -c '%u' "$directory")" = "0" ] \
    || fail "trusted path must be one root-owned canonical directory: $directory"
  local mode
  mode="$(stat -c '%a' "$directory")"
  (( (8#$mode & 8#022) == 0 )) \
    || fail "trusted path must not be group/world writable: $directory"
}

assert_root_ancestor_chain() {
  local current="$1"
  while true; do
    assert_root_directory "$current"
    [ "$current" = "/" ] && break
    current="$(dirname -- "$current")"
  done
}

assert_service_name() {
  [[ "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.@-]{0,127}$ ]] \
    || fail "invalid systemd service name: $1"
}

for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=true ;;
    --restore) RESTORE=true ;;
    *) fail "unknown argument: $arg" ;;
  esac
done

if [ "$RESTART" = true ] && [ "$RESTORE" = true ]; then
  fail "--restart and --restore are mutually exclusive"
fi
if [[ ! "$ENV_FILE_NAME" =~ ^\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  fail "ENV_FILE_NAME must be one dot-prefixed basename"
fi
for service in "${SERVICES[@]}"; do
  assert_service_name "$service"
done
if [ "$(printf '%s\n' "${SERVICES[@]}" | sort -u | wc -l)" -ne 3 ]; then
  fail "API, Worker and Web service names must be distinct"
fi
canonical_absolute_path "$DEPLOY_BASE" || fail "DEPLOY_BASE must be one canonical absolute path"
canonical_absolute_path "$UNIT_DST_DIR" || fail "UNIT_DST_DIR must be one canonical absolute path"
if [ -z "$UNIT_SNAPSHOT_DIR" ]; then
  fail "UNIT_SNAPSHOT_DIR is required"
fi
canonical_absolute_path "$UNIT_SNAPSHOT_DIR" \
  || fail "UNIT_SNAPSHOT_DIR must be one canonical absolute path"

SNAPSHOT_MANIFEST="$UNIT_SNAPSHOT_DIR/manifest"

validate_snapshot_directory() {
  [ -d "$UNIT_SNAPSHOT_DIR" ] && [ ! -L "$UNIT_SNAPSHOT_DIR" ] \
    || fail "unit snapshot directory is missing or unsafe: $UNIT_SNAPSHOT_DIR"
  [ "$(stat -c '%u:%g:%a' "$UNIT_SNAPSHOT_DIR")" = "0:0:700" ] \
    || fail "unit snapshot directory must be root:root mode 0700"
  assert_real_regular_file "$SNAPSHOT_MANIFEST" "unit snapshot manifest"
  [ "$(stat -c '%u:%g:%a' "$SNAPSHOT_MANIFEST")" = "0:0:600" ] \
    || fail "unit snapshot manifest must be root:root mode 0600"
  local expected="schemaVersion=1"
  local service
  local enabled_state
  for service in "${SERVICES[@]}"; do
    if [ -f "$UNIT_SNAPSHOT_DIR/$service.service" ]; then
      assert_real_regular_file "$UNIT_SNAPSHOT_DIR/$service.service" "snapshotted unit"
      [ "$(stat -c '%u:%g' "$UNIT_SNAPSHOT_DIR/$service.service")" = "0:0" ] \
        || fail "snapshotted unit must be root-owned: $service"
      expected="$expected
$service=present"
    else
      expected="$expected
$service=absent"
    fi
    assert_real_regular_file "$UNIT_SNAPSHOT_DIR/$service.enabled" "snapshotted enable state"
    [ "$(stat -c '%u:%g:%a' "$UNIT_SNAPSHOT_DIR/$service.enabled")" = "0:0:600" ] \
      || fail "snapshotted enable state must be root:root mode 0600"
    enabled_state="$(cat -- "$UNIT_SNAPSHOT_DIR/$service.enabled")"
    case "$enabled_state" in
      enabled|enabled-runtime|disabled) ;;
      *) fail "snapshotted enable state is invalid: $service" ;;
    esac
    expected="$expected
$service-enabled=$enabled_state"
  done
  expected="$expected
"
  [ "$(cat -- "$SNAPSHOT_MANIFEST")"$'\n' = "$expected" ] \
    || fail "unit snapshot manifest is not canonical"
  local names
  names="$(find "$UNIT_SNAPSHOT_DIR" -mindepth 1 -maxdepth 1 -printf '%f\n' | sort)"
  local expected_names="manifest"
  for service in "${SERVICES[@]}"; do
    expected_names="$expected_names
$service.enabled"
    if [ -f "$UNIT_SNAPSHOT_DIR/$service.service" ]; then
      expected_names="$expected_names
$service.service"
    fi
  done
  [ "$names" = "$(printf '%s\n' "$expected_names" | sort)" ] \
    || fail "unit snapshot directory contains unexpected files"
}

restore_snapshot() {
  validate_snapshot_directory
  local service
  local destination
  local temporary
  for service in "${SERVICES[@]}"; do
    destination="$UNIT_DST_DIR/$service.service"
    [ ! -L "$destination" ] || fail "unit destination must not be a symlink: $destination"
    if [ -f "$UNIT_SNAPSHOT_DIR/$service.service" ]; then
      temporary="$UNIT_DST_DIR/.$service.service.restore.$$"
      run_root install -o root -g root -m 0644 \
        "$UNIT_SNAPSHOT_DIR/$service.service" "$temporary"
      run_root mv -fT -- "$temporary" "$destination"
    else
      if [ -e "$destination" ] && [ ! -f "$destination" ]; then
        fail "unit destination is not a regular file: $destination"
      fi
      run_root rm -f -- "$destination"
    fi
  done
  run_root systemctl daemon-reload
  for service in "${SERVICES[@]}"; do
    case "$(cat -- "$UNIT_SNAPSHOT_DIR/$service.enabled")" in
      enabled) run_root systemctl enable "$service" ;;
      enabled-runtime) run_root systemctl enable --runtime "$service" ;;
      disabled) run_root systemctl disable "$service" ;;
    esac
  done
  echo "[systemd] Restored unit snapshot: $UNIT_SNAPSHOT_DIR"
}

if [ "$RESTORE" = true ]; then
  assert_root_ancestor_chain "$UNIT_DST_DIR"
  assert_root_ancestor_chain "$(dirname -- "$UNIT_SNAPSHOT_DIR")"
  restore_snapshot
  exit 0
fi

[ -d "$UNIT_SRC_DIR" ] && [ ! -L "$UNIT_SRC_DIR" ] \
  || fail "unit source directory is missing or unsafe: $UNIT_SRC_DIR"
[ -d "$UNIT_DST_DIR" ] && [ ! -L "$UNIT_DST_DIR" ] \
  || fail "unit destination directory is missing or unsafe: $UNIT_DST_DIR"
assert_root_ancestor_chain "$(readlink -f -- "$UNIT_SRC_DIR")"
assert_root_ancestor_chain "$UNIT_DST_DIR"
assert_root_ancestor_chain "$(dirname -- "$UNIT_SNAPSHOT_DIR")"
if [ ! -L "$CURRENT_LINK" ]; then
  fail "current must be one release symlink: $CURRENT_LINK"
fi
CURRENT_TARGET="$(readlink -f -- "$CURRENT_LINK")"
[ "$(dirname -- "$CURRENT_TARGET")" = "$DEPLOY_BASE/releases" ] \
  && [[ "${CURRENT_TARGET##*/}" =~ ^[a-f0-9]{40}$ ]] \
  || fail "current must target one direct full-commit release"
assert_root_ancestor_chain "$CURRENT_TARGET"
[ -d "$CURRENT_TARGET/apps/server" ] && [ -d "$CURRENT_TARGET/apps/web" ] \
  || fail "current release does not contain apps/server and apps/web: $CURRENT_LINK"
assert_real_regular_file "$SHARED_ENV_FILE" "shared environment file"

for service in "${SERVICES[@]}"; do
  assert_real_regular_file "$UNIT_SRC_DIR/$service.service" "release unit template"
done

if [ -e "$UNIT_SNAPSHOT_DIR" ] || [ -L "$UNIT_SNAPSHOT_DIR" ]; then
  fail "unit snapshot path already exists: $UNIT_SNAPSHOT_DIR"
fi
run_root install -d -o root -g root -m 0700 "$UNIT_SNAPSHOT_DIR"
manifest="schemaVersion=1"
for service in "${SERVICES[@]}"; do
  destination="$UNIT_DST_DIR/$service.service"
  [ ! -L "$destination" ] || fail "unit destination must not be a symlink: $destination"
  if [ -e "$destination" ]; then
    assert_real_regular_file "$destination" "installed unit"
    run_root install -o root -g root -m 0600 \
      "$destination" "$UNIT_SNAPSHOT_DIR/$service.service"
    manifest="$manifest
$service=present"
  else
    manifest="$manifest
$service=absent"
  fi
  enabled_state="$(systemctl is-enabled "$service" 2>/dev/null || true)"
  case "$enabled_state" in
    enabled|enabled-runtime) ;;
    *) enabled_state=disabled ;;
  esac
  printf '%s\n' "$enabled_state" | run_root tee \
    "$UNIT_SNAPSHOT_DIR/$service.enabled" >/dev/null
  run_root chown root:root "$UNIT_SNAPSHOT_DIR/$service.enabled"
  run_root chmod 0600 "$UNIT_SNAPSHOT_DIR/$service.enabled"
  manifest="$manifest
$service-enabled=$enabled_state"
done
printf '%s\n' "$manifest" | run_root tee "$SNAPSHOT_MANIFEST" >/dev/null
run_root chown root:root "$SNAPSHOT_MANIFEST"
run_root chmod 0600 "$SNAPSHOT_MANIFEST"
validate_snapshot_directory

INSTALL_COMPLETE=false
restore_on_error() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$INSTALL_COMPLETE" != true ]; then
    echo "[systemd] Install failed; restoring previous unit files" >&2
    restore_snapshot || echo "[systemd] ERROR: automatic unit restore failed" >&2
  fi
  exit "$status"
}
trap restore_on_error EXIT

run_root systemd-analyze verify \
  "$UNIT_SRC_DIR/$API_SERVICE.service" \
  "$UNIT_SRC_DIR/$WORKER_SERVICE.service" \
  "$UNIT_SRC_DIR/$WEB_SERVICE.service"

echo "[systemd] Installing release-mode units from $UNIT_SRC_DIR"
for service in "${SERVICES[@]}"; do
  temporary="$UNIT_DST_DIR/.$service.service.install.$$"
  run_root install -o root -g root -m 0644 "$UNIT_SRC_DIR/$service.service" "$temporary"
  run_root mv -fT -- "$temporary" "$UNIT_DST_DIR/$service.service"
done
run_root systemctl daemon-reload
run_root systemctl enable "$API_SERVICE" "$WORKER_SERVICE" "$WEB_SERVICE"

assert_effective_unit() {
  local service="$1"
  local expected_working_directory="$2"
  local expected_exec="$3"
  local fragment
  local working_directory
  local environment_files
  local exec_start
  fragment="$(systemctl show "$service" -p FragmentPath --value)"
  working_directory="$(systemctl show "$service" -p WorkingDirectory --value)"
  environment_files="$(systemctl show "$service" -p EnvironmentFiles --value)"
  exec_start="$(systemctl show "$service" -p ExecStart --value)"
  [ "$(readlink -f -- "$fragment")" = "$(readlink -f -- "$UNIT_DST_DIR/$service.service")" ] \
    || fail "$service FragmentPath does not use the installed release unit"
  [ "$working_directory" = "$expected_working_directory" ] \
    || fail "$service WorkingDirectory does not target the current release"
  printf '%s\n' "$environment_files" | grep -Fq -- "$SHARED_ENV_FILE" \
    || fail "$service does not use the shared release environment"
  printf '%s\n' "$exec_start" | grep -Fq -- "$expected_exec" \
    || fail "$service ExecStart does not match the release contract"
}

assert_effective_unit "$API_SERVICE" "$CURRENT_LINK/apps/server" "/usr/bin/node dist/index.js"
assert_effective_unit "$WORKER_SERVICE" "$CURRENT_LINK/apps/server" "/usr/bin/node dist/worker.js"
assert_effective_unit \
  "$WEB_SERVICE" "$CURRENT_LINK/apps/web" \
  "/usr/bin/node node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1"

if [ "$RESTART" = true ]; then
  echo "[systemd] Restarting services"
  run_root systemctl restart "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"
fi

INSTALL_COMPLETE=true
trap - EXIT
echo "[systemd] Installed release-mode units; snapshot retained at $UNIT_SNAPSHOT_DIR"

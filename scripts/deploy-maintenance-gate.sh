#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '[deploy-maintenance] ERROR: %s\n' "$*" >&2
  exit 1
}

MODE="${1:-}"
WORKER_SERVICE="${2:-}"
API_SERVICE="${3:-}"
WEB_SERVICE="${4:-}"
RUNTIME_ROOT="${5:-}"
DEPLOY_ROOT="${6:-}"
MARKER_ROOT=/var/lib/ss-erp-deploy-maintenance
MARKER="$MARKER_ROOT/in-place-staging"
DROPIN_NAME=10-ss-erp-deploy-maintenance.conf
EXPECTED_MARKER="schemaVersion=1
worker=$WORKER_SERVICE
api=$API_SERVICE
web=$WEB_SERVICE
runtimeRoot=$RUNTIME_ROOT
deployRoot=$DEPLOY_ROOT"

if [ "$(id -u)" != "0" ]; then
  fail "maintenance gate must run as root"
fi
if [ "$#" -ne 6 ] || { [ "$MODE" != "enter" ] && [ "$MODE" != "leave" ] \
  && [ "$MODE" != "verify" ]; }; then
  fail "usage: deploy-maintenance-gate <enter|leave|verify> <worker> <api> <web> <runtime-root> <deploy-root>"
fi
for service in "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"; do
  if [[ ! "$service" =~ ^[A-Za-z0-9_.@-]{1,128}$ ]]; then
    fail "service name is not canonical: $service"
  fi
done
if [[ ! "$RUNTIME_ROOT" =~ ^/[A-Za-z0-9._/-]{1,240}$ ]] \
  || [ "$(readlink -m -- "$RUNTIME_ROOT")" != "$RUNTIME_ROOT" ] \
  || [ "$RUNTIME_ROOT" = "/" ]; then
  fail "runtime root is not one canonical absolute path"
fi
if [[ ! "$DEPLOY_ROOT" =~ ^/[A-Za-z0-9._/-]{1,240}$ ]] \
  || [ "$(readlink -m -- "$DEPLOY_ROOT")" != "$DEPLOY_ROOT" ] \
  || [ "$DEPLOY_ROOT" = "/" ] || [ -L "$DEPLOY_ROOT" ] \
  || [ ! -d "$DEPLOY_ROOT" ] \
  || [ "$(readlink -f -- "$DEPLOY_ROOT")" != "$DEPLOY_ROOT" ]; then
  fail "deploy root is not one real canonical absolute directory"
fi
if [ "$(dirname -- "$RUNTIME_ROOT")" != "$(dirname -- "$DEPLOY_ROOT")" ] \
  || [ "$RUNTIME_ROOT" = "$DEPLOY_ROOT" ]; then
  fail "runtime root must be one canonical sibling of the deploy root"
fi
if [ "$WORKER_SERVICE" = "$API_SERVICE" ] || [ "$WORKER_SERVICE" = "$WEB_SERVICE" ] \
  || [ "$API_SERVICE" = "$WEB_SERVICE" ]; then
  fail "maintenance gate requires three distinct services"
fi

assert_root_directory() {
  local directory="$1"
  local mode
  if [ -L "$directory" ] || [ ! -d "$directory" ] \
    || [ "$(readlink -f -- "$directory")" != "$directory" ] \
    || [ "$(stat -c '%u' "$directory")" != "0" ]; then
    fail "trusted maintenance directory is invalid: $directory"
  fi
  mode="$(stat -c '%a' "$directory")"
  if (( (8#$mode & 8#022) != 0 )); then
    fail "trusted maintenance directory is writable by group/world: $directory"
  fi
}

assert_root_directory /etc
assert_root_directory /etc/systemd
assert_root_directory /etc/systemd/system
trusted_parent="$(dirname -- "$DEPLOY_ROOT")"
while true; do
  assert_root_directory "$trusted_parent"
  [ "$trusted_parent" = "/" ] && break
  trusted_parent="$(dirname -- "$trusted_parent")"
done
install -d -o root -g root -m 0755 "$MARKER_ROOT"
assert_root_directory /var
assert_root_directory /var/lib
assert_root_directory "$MARKER_ROOT"

install_dropin() {
  local service="$1"
  local writable_path="$2"
  local directory="/etc/systemd/system/$service.d"
  local destination="$directory/$DROPIN_NAME"
  local temporary
  local expected_dropin="[Unit]
ConditionPathExists=!/var/lib/ss-erp-deploy-maintenance/in-place-staging

[Service]
ReadWritePaths=$writable_path"
  install -d -o root -g root -m 0755 "$directory"
  assert_root_directory "$directory"
  if [ -e "$destination" ] || [ -L "$destination" ]; then
    if [ -L "$destination" ] || [ ! -f "$destination" ] \
      || [ "$(stat -c '%u:%h:%a' "$destination")" != "0:1:644" ] \
      || ! printf '%s\n' "$expected_dropin" | cmp -s -- - "$destination"; then
      fail "maintenance unit drop-in differs from the trusted contract: $destination"
    fi
    return
  fi
  temporary="$(mktemp "$directory/.${DROPIN_NAME}.XXXXXXXXXX")"
  printf '%s\n' "$expected_dropin" > "$temporary"
  chown root:root "$temporary"
  chmod 0644 "$temporary"
  mv -T -- "$temporary" "$destination"
  sync -f "$directory"
}

assert_marker() {
  if [ -L "$MARKER" ] || [ ! -f "$MARKER" ] \
    || [ "$(stat -c '%u:%g:%h:%a' "$MARKER")" != "0:0:1:444" ] \
    || ! printf '%s\n' "$EXPECTED_MARKER" | cmp -s -- - "$MARKER"; then
    fail "persistent maintenance marker is missing or invalid"
  fi
}

APPLICATION_WRITABLE_PATHS="$RUNTIME_ROOT/uploads $RUNTIME_ROOT/watermarked $RUNTIME_ROOT/resized $RUNTIME_ROOT/public-tmp $RUNTIME_ROOT/backups"
install_dropin "$WORKER_SERVICE" "$APPLICATION_WRITABLE_PATHS"
install_dropin "$API_SERVICE" "$APPLICATION_WRITABLE_PATHS"
install_dropin "$WEB_SERVICE" "$RUNTIME_ROOT/web-cache"
systemctl daemon-reload

if [ "$MODE" = "enter" ]; then
  if [ -e "$MARKER" ] || [ -L "$MARKER" ]; then
    assert_marker
  else
    temporary="$(mktemp "$MARKER_ROOT/.in-place-staging.XXXXXXXXXX")"
    printf '%s\n' "$EXPECTED_MARKER" > "$temporary"
    chown root:root "$temporary"
    chmod 0444 "$temporary"
    mv -T -- "$temporary" "$MARKER"
    sync -f "$MARKER_ROOT"
  fi
  systemctl stop "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"
  for service in "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"; do
    if systemctl is-active --quiet "$service"; then
      fail "service remained active after entering maintenance: $service"
    fi
  done
  printf '[deploy-maintenance] Entered persistent maintenance state\n'
  exit 0
fi

assert_marker
if [ "$MODE" = "verify" ]; then
  for service in "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"; do
    if systemctl is-active --quiet "$service"; then
      fail "service is active during persistent maintenance: $service"
    fi
  done
  printf '[deploy-maintenance] Verified persistent maintenance state\n'
  exit 0
fi

rm -- "$MARKER"
sync -f "$MARKER_ROOT"
systemctl daemon-reload
printf '[deploy-maintenance] Left persistent maintenance state\n'

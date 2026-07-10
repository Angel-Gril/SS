#!/usr/bin/env bash
set -euo pipefail

# Remove the one-time bootstrap SETUP_TOKEN after the first super admin exists.
# This is an operations script, not an application route: it edits the deploy env,
# removes the root-only sidecar token file, restarts services, and verifies setup
# remains initialized.
#
# Optional env:
#   DEPLOY_DIR=/opt/ss-erp/app
#   ENV_FILE=.env.staging
#   SETUP_TOKEN_FILE=/root/ss-erp-initial-setup-token.txt
#   API_BASE_URL=http://127.0.0.1:3001
#   RESTART_SERVICES="ss-erp-api ss-erp-web"
#   CURL_BIN=curl
#   SYSTEMCTL_BIN=systemctl

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ss-erp/app}"
ENV_FILE="${ENV_FILE:-.env.staging}"
SETUP_TOKEN_FILE="${SETUP_TOKEN_FILE:-/root/ss-erp-initial-setup-token.txt}"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3001}"
RESTART_SERVICES="${RESTART_SERVICES:-ss-erp-api ss-erp-web}"
CURL_BIN="${CURL_BIN:-curl}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-systemctl}"

log() { printf '[cleanup-setup-token] %s\n' "$*"; }
fail() { printf '[cleanup-setup-token] ERROR: %s\n' "$*" >&2; exit 1; }

case "$ENV_FILE" in
  /*) ENV_PATH="$ENV_FILE" ;;
  *) ENV_PATH="$DEPLOY_DIR/$ENV_FILE" ;;
esac

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "missing command: $1"
}

setup_status_json() {
  "$CURL_BIN" -fsS --max-time 10 "$API_BASE_URL/api/setup/status"
}

assert_has_admin() {
  local status_json="$1"
  SETUP_STATUS_JSON="$status_json" node -e '
const status = JSON.parse(process.env.SETUP_STATUS_JSON || "{}");
if (status?.code === 1 && status?.data?.hasAdmin === true && status?.data?.needsSetup === false) {
  process.exit(0);
}
console.error(JSON.stringify(status));
process.exit(1);
'
}

remove_setup_token_from_env() {
  local tmp
  tmp="$(mktemp)"
  awk '!($0 ~ /^[[:space:]]*(export[[:space:]]+)?SETUP_TOKEN=/)' "$ENV_PATH" > "$tmp"
  cat "$tmp" > "$ENV_PATH"
  rm -f "$tmp"
}

require_command "$CURL_BIN"
require_command node
require_command awk
require_command mktemp

[ -f "$ENV_PATH" ] || fail "env file missing: $ENV_PATH"

log "Checking setup status at $API_BASE_URL"
status_before="$(setup_status_json)"
if ! assert_has_admin "$status_before"; then
  fail "refusing to cleanup before setup is initialized; expected hasAdmin=true and needsSetup=false"
fi

backup_path="$ENV_PATH.bak.cleanup-setup-$(date +%Y%m%d%H%M%S)"
cp -p "$ENV_PATH" "$backup_path"
log "Backed up env to $backup_path"

remove_setup_token_from_env
rm -f "$SETUP_TOKEN_FILE"
log "Removed SETUP_TOKEN from env and deleted sidecar token file if present"

if [ -n "$RESTART_SERVICES" ]; then
  require_command "$SYSTEMCTL_BIN"
  # Intentionally split RESTART_SERVICES into service names.
  # shellcheck disable=SC2086
  "$SYSTEMCTL_BIN" restart $RESTART_SERVICES
  log "Restarted services: $RESTART_SERVICES"
fi

status_after="$(setup_status_json)"
if ! assert_has_admin "$status_after"; then
  fail "setup status changed unexpectedly after cleanup"
fi

if grep -Eq '^[[:space:]]*(export[[:space:]]+)?SETUP_TOKEN=' "$ENV_PATH"; then
  fail "SETUP_TOKEN still exists in $ENV_PATH"
fi

log "Cleanup complete"

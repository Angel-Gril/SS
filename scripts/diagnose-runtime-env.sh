#!/usr/bin/env bash
# Read-only runtime/environment diagnostics for SS ERP deployments.
# Does not print secrets; only reports presence and runtime-observable values.

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ss-erp/app}"
ENV_FILE="${ENV_FILE:-.env.staging}"
API_SERVICE="${API_SERVICE:-ss-erp-api}"
WORKER_SERVICE="${WORKER_SERVICE:-ss-erp-worker}"
WEB_SERVICE="${WEB_SERVICE:-ss-erp-web}"
API_BASE_URL="${API_BASE_URL:-http://127.0.0.1:3001}"

FAILURES=0
WARNINGS=0

pass() { echo "PASS $1"; }
warn() { WARNINGS=$((WARNINGS + 1)); echo "WARN $1"; }
fail() { FAILURES=$((FAILURES + 1)); echo "FAIL $1"; }

mask_state() {
  local key="$1"
  local value="${!key-}"
  if [ -n "$value" ]; then
    echo "set"
  else
    echo "empty"
  fi
}

load_env_file() {
  local path="$1"
  if [ ! -f "$path" ]; then
    fail "env file missing: $path"
    return
  fi
  pass "env file exists: $path"
  set -a
  # shellcheck disable=SC1090
  . "$path"
  set +a
}

check_expected_env() {
  local expected_runtime="${EXPECTED_RUNTIME_MODE:-cloud}"
  local expected_storage="${EXPECTED_IMAGE_STORAGE_BACKEND:-oss}"

  if [ "${RUNTIME_MODE:-}" = "$expected_runtime" ]; then
    pass "RUNTIME_MODE=$expected_runtime"
  else
    fail "RUNTIME_MODE expected $expected_runtime, got ${RUNTIME_MODE:-empty}"
  fi

  if [ "${IMAGE_STORAGE_BACKEND:-}" = "$expected_storage" ]; then
    pass "IMAGE_STORAGE_BACKEND=$expected_storage"
  else
    fail "IMAGE_STORAGE_BACKEND expected $expected_storage, got ${IMAGE_STORAGE_BACKEND:-empty}"
  fi

  for key in OSS_ENDPOINT OSS_BUCKET OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET OSS_REGION; do
    local state
    state=$(mask_state "$key")
    if [ "$state" = "set" ]; then
      pass "$key is set"
    else
      fail "$key is empty"
    fi
  done
}

check_service_envfile() {
  local service="$1"
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemctl not available; skip service env check"
    return
  fi
  local fragment
  fragment=$(systemctl show "$service" -p FragmentPath --value 2>/dev/null || true)
  if [ -z "$fragment" ] || [ ! -f "$fragment" ]; then
    warn "$service unit file not found"
    return
  fi
  if grep -q 'EnvironmentFile' "$fragment"; then
    pass "$service has EnvironmentFile: $(grep 'EnvironmentFile' "$fragment" | tr -d '[:space:]')"
  else
    warn "$service has no EnvironmentFile in $fragment"
  fi
}

check_runtime_endpoint() {
  if ! command -v curl >/dev/null 2>&1; then
    warn "curl not available; skip HTTP runtime check"
    return
  fi

  local body
  if ! body=$(curl -fsS --max-time 10 "$API_BASE_URL/ready"); then
    fail "API /ready unreachable at $API_BASE_URL"
    return
  fi
  if echo "$body" | grep -q '"status":"ready"'; then
    pass "API /ready reports ready"
  else
    fail "API /ready returned unexpected body: $body"
  fi

  echo "INFO Public remote smoke should be run from local machine:"
  echo "INFO   SMOKE_CREATE_TEMP_USER=true SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote"
}

env_path="$DEPLOY_DIR/$ENV_FILE"
echo "=== SS ERP runtime env diagnostics ==="
echo "Deploy dir: $DEPLOY_DIR"
echo "Env file: $env_path"
echo "API base URL: $API_BASE_URL"
echo ""

load_env_file "$env_path"
check_expected_env

check_service_envfile "$API_SERVICE"
check_service_envfile "$WORKER_SERVICE"
check_service_envfile "$WEB_SERVICE"

check_runtime_endpoint

echo ""
echo "=== Result: ${FAILURES} failure(s), ${WARNINGS} warning(s) ==="
if [ "$FAILURES" -gt 0 ]; then
  exit 1
fi


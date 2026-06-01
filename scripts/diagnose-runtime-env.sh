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
EXPECTED_API_WORKING_DIR="${EXPECTED_API_WORKING_DIR:-$DEPLOY_DIR/apps/server}"
EXPECTED_WORKER_WORKING_DIR="${EXPECTED_WORKER_WORKING_DIR:-$DEPLOY_DIR/apps/server}"
EXPECTED_WEB_WORKING_DIR="${EXPECTED_WEB_WORKING_DIR:-$DEPLOY_DIR/apps/web}"
if [ -z "${EXPECTED_ENV_FILE_PATH:-}" ]; then
  case "$DEPLOY_DIR" in
    */current) EXPECTED_ENV_FILE_PATH="${DEPLOY_DIR%/current}/shared/$ENV_FILE" ;;
    *) EXPECTED_ENV_FILE_PATH="$DEPLOY_DIR/$ENV_FILE" ;;
  esac
fi

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
  local expected_working_dir="$2"
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemctl not available; skip service env check"
    return
  fi
  if ! systemctl is-active --quiet "$service"; then
    fail "$service is not active"
  else
    pass "$service active"
  fi
  local fragment
  fragment=$(systemctl show "$service" -p FragmentPath --value 2>/dev/null || true)
  if [ -z "$fragment" ] || [ ! -f "$fragment" ]; then
    warn "$service unit file not found"
    return
  fi
  local working_dir
  working_dir=$(systemctl show "$service" -p WorkingDirectory --value 2>/dev/null || true)
  if [ "$working_dir" = "$expected_working_dir" ]; then
    pass "$service WorkingDirectory=$expected_working_dir"
  else
    fail "$service WorkingDirectory expected $expected_working_dir, got ${working_dir:-empty}"
  fi

  if grep -q 'EnvironmentFile' "$fragment"; then
    pass "$service has EnvironmentFile: $(grep 'EnvironmentFile' "$fragment" | tr -d '[:space:]')"
  else
    warn "$service has no EnvironmentFile in $fragment"
  fi

  local env_files
  env_files=$(systemctl show "$service" -p EnvironmentFiles --value 2>/dev/null || true)
  if [ -n "$env_files" ]; then
    pass "$service systemd EnvironmentFiles=$env_files"
    if printf '%s\n' "$env_files" | grep -Fq "$EXPECTED_ENV_FILE_PATH"; then
      pass "$service uses expected env file: $EXPECTED_ENV_FILE_PATH"
    else
      fail "$service EnvironmentFiles expected to include $EXPECTED_ENV_FILE_PATH"
    fi
  else
    warn "$service systemd EnvironmentFiles empty"
  fi
}

read_proc_env_value() {
  local pid="$1"
  local key="$2"
  if [ ! -r "/proc/$pid/environ" ]; then
    echo ""
    return
  fi
  tr '\0' '\n' < "/proc/$pid/environ" | awk -F= -v k="$key" '$1 == k {print substr($0, length(k) + 2); exit}'
}

check_process_env() {
  local service="$1"
  if ! command -v systemctl >/dev/null 2>&1; then
    return
  fi
  local pid
  pid=$(systemctl show "$service" -p MainPID --value 2>/dev/null || true)
  if [ -z "$pid" ] || [ "$pid" = "0" ]; then
    warn "$service MainPID not available"
    return
  fi
  pass "$service MainPID=$pid"

  local expected_runtime="${EXPECTED_RUNTIME_MODE:-cloud}"
  local expected_storage="${EXPECTED_IMAGE_STORAGE_BACKEND:-oss}"
  local runtime
  runtime=$(read_proc_env_value "$pid" RUNTIME_MODE)
  local storage
  storage=$(read_proc_env_value "$pid" IMAGE_STORAGE_BACKEND)

  if [ "$runtime" = "$expected_runtime" ]; then
    pass "$service process RUNTIME_MODE=$expected_runtime"
  else
    fail "$service process RUNTIME_MODE expected $expected_runtime, got ${runtime:-empty}"
  fi

  if [ "$storage" = "$expected_storage" ]; then
    pass "$service process IMAGE_STORAGE_BACKEND=$expected_storage"
  else
    fail "$service process IMAGE_STORAGE_BACKEND expected $expected_storage, got ${storage:-empty}"
  fi

  for key in OSS_ENDPOINT OSS_BUCKET OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET OSS_REGION; do
    local value
    value=$(read_proc_env_value "$pid" "$key")
    if [ -n "$value" ]; then
      pass "$service process $key is set"
    else
      fail "$service process $key is empty"
    fi
  done
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
echo "Expected systemd env file: $EXPECTED_ENV_FILE_PATH"
echo "API base URL: $API_BASE_URL"
echo ""

load_env_file "$env_path"
check_expected_env

check_service_envfile "$API_SERVICE" "$EXPECTED_API_WORKING_DIR"
check_service_envfile "$WORKER_SERVICE" "$EXPECTED_WORKER_WORKING_DIR"
check_service_envfile "$WEB_SERVICE" "$EXPECTED_WEB_WORKING_DIR"
check_process_env "$API_SERVICE"
check_process_env "$WORKER_SERVICE"

check_runtime_endpoint

echo ""
echo "=== Result: ${FAILURES} failure(s), ${WARNINGS} warning(s) ==="
if [ "$FAILURES" -gt 0 ]; then
  exit 1
fi

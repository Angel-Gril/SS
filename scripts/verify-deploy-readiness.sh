#!/usr/bin/env bash
# Read-only pre-deploy checks for SS ERP.

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ss-erp/app}"
ENV_FILE="${ENV_FILE:-.env.staging}"
EXPECTED_PROFILE="${EXPECTED_PROFILE:-cloud-r2}"
EXPECTED_COMMIT="${EXPECTED_COMMIT:-}"
API_SERVICE="${API_SERVICE:-ss-erp-api}"
WEB_SERVICE="${WEB_SERVICE:-ss-erp-web}"
WORKER_SERVICE="${WORKER_SERVICE:-ss-erp-worker}"

FAILURES=0
WARNINGS=0

pass() { echo "PASS $1"; }
warn() { WARNINGS=$((WARNINGS + 1)); echo "WARN $1"; }
fail() { FAILURES=$((FAILURES + 1)); echo "FAIL $1"; }

mask_env_line() {
  sed -E 's/(ACCESS_KEY_ID|ACCESS_KEY_SECRET|SECRET|PASSWORD|TOKEN)=.*/\1=***MASKED***/'
}

check_file() {
  local path="$1"
  if [ -f "$path" ]; then
    pass "file exists: $path"
  else
    fail "file missing: $path"
  fi
}

check_optional_file() {
  local path="$1"
  if [ -f "$path" ]; then
    pass "file exists: $path"
  else
    warn "optional file missing: $path"
  fi
}

check_service() {
  local service="$1"
  local expected_dir="$2"
  if ! command -v systemctl >/dev/null 2>&1; then
    warn "systemctl not available; skip $service"
    return
  fi

  if systemctl is-active --quiet "$service"; then
    pass "$service active"
  else
    fail "$service not active"
  fi

  local working_dir
  working_dir=$(systemctl show "$service" -p WorkingDirectory --value 2>/dev/null || true)
  if [ "$working_dir" = "$expected_dir" ]; then
    pass "$service WorkingDirectory=$expected_dir"
  else
    fail "$service WorkingDirectory expected $expected_dir, got ${working_dir:-empty}"
  fi

  local env_files
  env_files=$(systemctl show "$service" -p EnvironmentFiles --value 2>/dev/null || true)
  if printf '%s\n' "$env_files" | grep -Fq "$DEPLOY_DIR/$ENV_FILE"; then
    pass "$service uses env file $DEPLOY_DIR/$ENV_FILE"
  else
    fail "$service EnvironmentFiles expected to include $DEPLOY_DIR/$ENV_FILE, got ${env_files:-empty}"
  fi
}

echo "=== SS ERP deploy readiness ==="
echo "Deploy dir: $DEPLOY_DIR"
echo "Env file: $ENV_FILE"
echo "Expected profile: $EXPECTED_PROFILE"
echo "Expected commit: ${EXPECTED_COMMIT:-skip}"
echo ""

if [ -d "$DEPLOY_DIR" ]; then
  pass "deploy dir exists"
else
  fail "deploy dir missing: $DEPLOY_DIR"
fi

ENV_PATH="$DEPLOY_DIR/$ENV_FILE"
check_file "$ENV_PATH"
check_file "$DEPLOY_DIR/package.json"
check_optional_file "$DEPLOY_DIR/scripts/deploy-app-dir.sh"
check_file "$DEPLOY_DIR/scripts/configure-cloud-r2-env.sh"
check_file "$DEPLOY_DIR/scripts/verify-vps-deploy.sh"
check_file "$DEPLOY_DIR/scripts/verify-backup-restore.sh"

if [ -f "$DEPLOY_DIR/DEPLOYED_COMMIT" ]; then
  deployed_commit=$(cat "$DEPLOY_DIR/DEPLOYED_COMMIT")
  pass "DEPLOYED_COMMIT=$deployed_commit"
  if [ -n "$EXPECTED_COMMIT" ] && [ "$deployed_commit" != "$EXPECTED_COMMIT" ]; then
    warn "deployed commit differs from expected: expected $EXPECTED_COMMIT, got $deployed_commit"
  fi
else
  warn "DEPLOYED_COMMIT missing"
fi

if [ -f "$ENV_PATH" ]; then
  echo ""
  echo "--- Selected env (masked) ---"
  grep -E '^(RUNTIME_MODE|NEXT_PUBLIC_RUNTIME_MODE|IMAGE_STORAGE_BACKEND|OSS_ENDPOINT|OSS_BUCKET|OSS_ACCESS_KEY_ID|OSS_ACCESS_KEY_SECRET|OSS_REGION|LOCAL_BASE_URL)=' "$ENV_PATH" \
    | mask_env_line || true

  set -a
  # shellcheck disable=SC1090
  . "$ENV_PATH"
  set +a

  if [ "$EXPECTED_PROFILE" = "cloud-r2" ]; then
    [ "${RUNTIME_MODE:-}" = "cloud" ] || fail "RUNTIME_MODE expected cloud, got ${RUNTIME_MODE:-empty}"
    [ "${NEXT_PUBLIC_RUNTIME_MODE:-}" = "cloud" ] || fail "NEXT_PUBLIC_RUNTIME_MODE expected cloud, got ${NEXT_PUBLIC_RUNTIME_MODE:-empty}"
    [ "${IMAGE_STORAGE_BACKEND:-}" = "oss" ] || fail "IMAGE_STORAGE_BACKEND expected oss, got ${IMAGE_STORAGE_BACKEND:-empty}"
    for key in OSS_ENDPOINT OSS_BUCKET OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET OSS_REGION; do
      if [ -n "${!key:-}" ]; then
        pass "$key is set"
      else
        fail "$key is empty"
      fi
    done
  fi
fi

if [ -f "$DEPLOY_DIR/scripts/validate-env.mjs" ] && [ -f "$ENV_PATH" ]; then
  if node "$DEPLOY_DIR/scripts/validate-env.mjs" --profile "$EXPECTED_PROFILE" --env "$ENV_PATH"; then
    pass "env profile validation passed: $EXPECTED_PROFILE"
  else
    fail "env profile validation failed: $EXPECTED_PROFILE"
  fi
else
  warn "validate-env.mjs unavailable; cannot validate env profile"
fi

check_service "$API_SERVICE" "$DEPLOY_DIR/apps/server"
check_service "$WORKER_SERVICE" "$DEPLOY_DIR/apps/server"
check_service "$WEB_SERVICE" "$DEPLOY_DIR/apps/web"

if [ -f /var/backups/ss-erp/backup-status.json ]; then
  pass "backup-status.json exists"
else
  warn "backup-status.json missing"
fi

echo ""
echo "=== Result: ${FAILURES} failure(s), ${WARNINGS} warning(s) ==="
if [ "$FAILURES" -gt 0 ]; then
  echo "INFO Fix failures before deploying with DEPLOY_ENV_PROFILE=$EXPECTED_PROFILE."
  exit 1
fi

echo "INFO Ready for deployment checks. After deploy, run:"
echo "INFO   DEPLOY_DIR=$DEPLOY_DIR ENV_FILE=$ENV_FILE bash scripts/verify-cloud-runtime.sh"

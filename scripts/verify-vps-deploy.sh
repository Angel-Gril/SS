#!/usr/bin/env bash
# SS ERP VPS deployment verification.
# Read-only checks for systemd, Nginx, ports, firewall, cron, migrations and live health.

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ss-erp/app}"
ENV_FILE="${ENV_FILE:-.env.staging}"
DOMAIN="${VERIFY_DOMAIN:-ss-erp.com}"
READY_URL="${VERIFY_READY_URL:-https://${DOMAIN}/ready}"
LOCAL_READY_URL="${VERIFY_LOCAL_READY_URL:-http://127.0.0.1:3001/ready}"
LOG_SINCE="${VERIFY_LOG_SINCE:-10 minutes ago}"

FAILURES=0
WARNINGS=0

pass() {
  echo "PASS $1"
}

warn() {
  WARNINGS=$((WARNINGS + 1))
  echo "WARN $1"
}

fail() {
  FAILURES=$((FAILURES + 1))
  echo "FAIL $1"
}

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    pass "command available: $1"
  else
    fail "missing command: $1"
  fi
}

check_service() {
  local name="$1"
  if systemctl is-active --quiet "$name"; then
    pass "service active: $name"
  else
    fail "service not active: $name"
  fi
}

check_http_json_ready() {
  local label="$1"
  local url="$2"
  local body
  if ! body=$(curl -k -fsS --max-time 10 "$url"); then
    fail "$label unreachable: $url"
    return
  fi
  if node -e '
const body = process.argv[1];
try {
  const data = JSON.parse(body);
  if (data.status === "ready" && data.checks?.db === "ok" && data.checks?.redis === "ok") process.exit(0);
} catch {}
process.exit(1);
' "$body"; then
    pass "$label ready: db+redis ok"
  else
    fail "$label returned unexpected body: ${body}"
  fi
}

check_port_loopback() {
  local port="$1"
  local label="$2"
  local rows
  rows=$(ss -H -ltn "sport = :${port}" 2>/dev/null || true)
  if [ -z "$rows" ]; then
    fail "$label port ${port} is not listening"
    return
  fi
  if echo "$rows" | awk '{print $4}' | grep -Ev '^(127\.0\.0\.1|\[::1\]|::1):'"${port}"'$' >/dev/null; then
    fail "$label port ${port} is not loopback-only: $(echo "$rows" | awk '{print $4}' | paste -sd ',' -)"
  else
    pass "$label port ${port} loopback-only"
  fi
}

check_public_port() {
  local port="$1"
  local label="$2"
  local rows
  rows=$(ss -H -ltn "sport = :${port}" 2>/dev/null || true)
  if [ -z "$rows" ]; then
    fail "$label port ${port} is not listening"
    return
  fi
  pass "$label port ${port} listening"
}

check_ufw() {
  if ! command -v ufw >/dev/null 2>&1; then
    warn "ufw not installed"
    return
  fi
  local status
  status=$(ufw status verbose 2>/dev/null || true)
  if echo "$status" | grep -q '^Status: active'; then
    pass "ufw active"
  else
    fail "ufw inactive"
    return
  fi
  if echo "$status" | grep -q 'Default: deny (incoming)'; then
    pass "ufw incoming default deny"
  else
    fail "ufw incoming default is not deny"
  fi
  for port in 80 443; do
    if echo "$status" | grep -Eq "^${port}/tcp[[:space:]]+ALLOW IN"; then
      pass "ufw allows ${port}/tcp"
    else
      fail "ufw missing allow ${port}/tcp"
    fi
  done
  for port in 3000 3001; do
    if echo "$status" | grep -Eq "^${port}/tcp[[:space:]]+DENY IN"; then
      pass "ufw denies ${port}/tcp"
    else
      warn "ufw does not explicitly deny ${port}/tcp"
    fi
  done
}

check_cloudflare_origin_guard() {
  if grep -Rqs 'real_ip_header CF-Connecting-IP' /etc/nginx/conf.d /etc/nginx/sites-enabled; then
    pass "nginx restores Cloudflare real IP"
  else
    fail "nginx missing real_ip_header CF-Connecting-IP"
  fi
  if grep -Rqs 'is_cloudflare' /etc/nginx/conf.d /etc/nginx/sites-enabled; then
    pass "nginx has Cloudflare origin guard"
  else
    fail "nginx missing Cloudflare origin guard"
  fi
}

check_cron() {
  local cron
  cron=$(crontab -l 2>/dev/null || true)
  if echo "$cron" | grep -q 'backup-db.sh'; then
    pass "cron includes database backup"
  else
    fail "cron missing database backup"
  fi
  if echo "$cron" | grep -q 'update-cloudflare-ips.sh'; then
    pass "cron includes Cloudflare IP update"
  else
    warn "cron missing Cloudflare IP update"
  fi
}

check_backup_status() {
  local status_file="${BACKUP_LOCAL_DIR:-/var/backups/ss-erp}/backup-status.json"
  if [ ! -f "$status_file" ]; then
    fail "backup status file missing: $status_file"
    return
  fi
  if node -e '
const fs = require("fs");
const file = process.argv[1];
const data = JSON.parse(fs.readFileSync(file, "utf8"));
if (!data.lastBackupAt || !data.lastLocalFile || !data.lastLocalSize) process.exit(1);
' "$status_file"; then
    pass "backup status JSON is readable"
  else
    fail "backup status JSON invalid"
  fi
}

check_prisma_migrations() {
  if [ ! -d "${DEPLOY_DIR}/apps/server" ]; then
    fail "server directory missing: ${DEPLOY_DIR}/apps/server"
    return
  fi
  (
    cd "${DEPLOY_DIR}/apps/server"
    set -a
    # shellcheck disable=SC1091
    . "../../${ENV_FILE}"
    set +a
    npx prisma migrate status
  ) >/tmp/ss-erp-prisma-status.$$ 2>&1
  local code=$?
  if [ "$code" -ne 0 ]; then
    fail "prisma migrate status failed: $(tail -20 /tmp/ss-erp-prisma-status.$$ | tr '\n' ' ')"
  elif grep -qi 'Database schema is up to date' /tmp/ss-erp-prisma-status.$$; then
    pass "prisma migrations up to date"
  else
    warn "prisma migrate status did not report up to date"
  fi
  rm -f /tmp/ss-erp-prisma-status.$$
}

check_recent_logs() {
  local service="$1"
  if journalctl -u "$service" --since "$LOG_SINCE" --no-pager | grep -Eiq 'fatal|exception|unhandled|panic'; then
    fail "$service recent logs contain fatal/exception/unhandled/panic"
  else
    pass "$service recent logs clean"
  fi
}

check_no_restore_temp_db() {
  if ! command -v sudo >/dev/null 2>&1 || ! id postgres >/dev/null 2>&1; then
    warn "cannot check restore temp DBs without local postgres user"
    return
  fi
  local temp_dbs
  temp_dbs=$(sudo -u postgres psql -tAc "select datname from pg_database where datname like 'ss_erp_restore_check_%';" 2>/dev/null | tr -d '[:space:]' || true)
  if [ -z "$temp_dbs" ]; then
    pass "no restore temp databases remain"
  else
    fail "restore temp databases remain: $temp_dbs"
  fi
}

echo "=== SS ERP VPS deployment verification ==="
echo "Deploy dir: ${DEPLOY_DIR}"
echo "Domain: ${DOMAIN}"
echo ""

require_command node
require_command curl
require_command ss
require_command nginx
require_command systemctl

if [ -f "${DEPLOY_DIR}/DEPLOYED_COMMIT" ]; then
  pass "DEPLOYED_COMMIT=$(cat "${DEPLOY_DIR}/DEPLOYED_COMMIT")"
else
  warn "DEPLOYED_COMMIT missing"
fi

check_service nginx
check_service postgresql
check_service redis-server
check_service ss-erp-api
check_service ss-erp-worker
check_service ss-erp-web

if nginx -t >/tmp/ss-erp-nginx-test.$$ 2>&1; then
  pass "nginx config test"
else
  fail "nginx config test failed: $(cat /tmp/ss-erp-nginx-test.$$ | tr '\n' ' ')"
fi
rm -f /tmp/ss-erp-nginx-test.$$

check_public_port 80 nginx
check_public_port 443 nginx
check_port_loopback 3000 web
check_port_loopback 3001 api
check_port_loopback 5432 postgres
check_port_loopback 6379 redis

check_ufw
check_cloudflare_origin_guard
check_cron
check_backup_status
check_prisma_migrations
check_no_restore_temp_db

check_http_json_ready "local /ready" "$LOCAL_READY_URL"
check_http_json_ready "public /ready" "$READY_URL"

check_recent_logs ss-erp-api
check_recent_logs ss-erp-worker

echo ""
echo "=== Result: ${FAILURES} failure(s), ${WARNINGS} warning(s) ==="
if [ "$FAILURES" -gt 0 ]; then
  exit 1
fi

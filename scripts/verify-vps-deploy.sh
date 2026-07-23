#!/usr/bin/env bash
# SS ERP VPS deployment verification.
# Read-only checks for systemd, Nginx, ports, firewall, cron, migrations and live health.

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ss-erp/app}"
ENV_FILE="${ENV_FILE:-.env.staging}"
DOMAIN="${VERIFY_DOMAIN:-}"
PUBLIC_BASE_URL="${VERIFY_PUBLIC_BASE_URL:-}"
READY_URL="${VERIFY_READY_URL:-}"
LOCAL_READY_URL="${VERIFY_LOCAL_READY_URL:-http://127.0.0.1:3001/ready}"
LOG_SINCE="${VERIFY_LOG_SINCE:-10 minutes ago}"
BACKUP_ENV_FILE="${BACKUP_ENV_FILE:-/etc/ss-erp-backup.env}"
BACKUP_LOG_DIR="${BACKUP_LOG_DIR:-/var/log/ss-erp}"
BACKUP_MAX_AGE_HOURS="${BACKUP_MAX_AGE_HOURS:-36}"
VERIFY_ORIGIN_MODE="${VERIFY_ORIGIN_MODE:-cloudflare}"
VERIFY_DIRECT_HOSTNAMES="${VERIFY_DIRECT_HOSTNAMES:-}"
VERIFY_EXPECT_LOGISTICS_DISTRIBUTION_ENABLED="${VERIFY_EXPECT_LOGISTICS_DISTRIBUTION_ENABLED:-false}"
VERIFY_EXPECT_NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED="${VERIFY_EXPECT_NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED:-false}"
VERIFY_EXPECT_EXTENSION_AUTH_MODE="${VERIFY_EXPECT_EXTENSION_AUTH_MODE:-compat}"
VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED="${VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED:-false}"
VERIFY_EXPECT_LOCAL_POSTGRES="${VERIFY_EXPECT_LOCAL_POSTGRES:-true}"

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

validate_boolean_setting() {
  local name="$1"
  local value="$2"
  case "$value" in
    true|false) return 0 ;;
    *)
      echo "[verify-vps] ERROR: $name must be true or false, got ${value:-empty}" >&2
      return 1
      ;;
  esac
}

validate_origin_mode() {
  case "$1" in
    cloudflare|direct) return 0 ;;
    *)
      echo "[verify-vps] ERROR: VERIFY_ORIGIN_MODE must be cloudflare or direct, got ${1:-empty}" >&2
      return 1
      ;;
  esac
}

validate_ready_protocol() {
  local origin_mode="$1"
  local protocol="$2"
  if [ "$origin_mode" = "direct" ] && [ "$protocol" != "https:" ]; then
    echo "[verify-vps] ERROR: direct origin verification requires an HTTPS public /ready URL" >&2
    return 1
  fi
}

is_valid_direct_hostname() {
  local hostname="$1"
  local labels=()
  local label

  if [ "${#hostname}" -gt 253 ] || [[ "$hostname" != *.* ]] || \
     [[ "$hostname" =~ ^[0-9.]+$ ]] || \
     [[ ! "$hostname" =~ ^[a-z0-9.-]+$ ]] || \
     [[ "$hostname" == *..* ]]; then
    return 1
  fi

  IFS='.' read -r -a labels <<< "$hostname"
  for label in "${labels[@]}"; do
    if [ -z "$label" ] || [ "${#label}" -gt 63 ] || \
       [[ ! "$label" =~ ^[a-z0-9]([a-z0-9-]*[a-z0-9])?$ ]]; then
      return 1
    fi
  done
}

DIRECT_HOSTNAMES=()
load_direct_hostnames() {
  if [ "$VERIFY_ORIGIN_MODE" != "direct" ]; then
    return 0
  fi
  if [ -z "$VERIFY_DIRECT_HOSTNAMES" ]; then
    echo "[verify-vps] ERROR: VERIFY_DIRECT_HOSTNAMES is required in direct mode" >&2
    return 1
  fi

  local candidates=()
  local candidate
  local existing
  local duplicate
  IFS=',' read -r -a candidates <<< "$VERIFY_DIRECT_HOSTNAMES"
  for candidate in "${candidates[@]}"; do
    candidate="${candidate#"${candidate%%[![:space:]]*}"}"
    candidate="${candidate%"${candidate##*[![:space:]]}"}"
    candidate="${candidate,,}"
    if ! is_valid_direct_hostname "$candidate"; then
      echo "[verify-vps] ERROR: invalid direct hostname: ${candidate:-empty}" >&2
      return 1
    fi

    duplicate=0
    for existing in "${DIRECT_HOSTNAMES[@]}"; do
      if [ "$existing" = "$candidate" ]; then
        duplicate=1
        break
      fi
    done
    if [ "$duplicate" -eq 0 ]; then
      DIRECT_HOSTNAMES+=("$candidate")
    fi
  done

  if [ "${#DIRECT_HOSTNAMES[@]}" -eq 0 ] || [ "${#DIRECT_HOSTNAMES[@]}" -gt 16 ]; then
    echo "[verify-vps] ERROR: direct hostname list must contain between 1 and 16 unique hosts" >&2
    return 1
  fi
}

validate_direct_ready_hostname() {
  local ready_hostname="$1"
  local hostname
  if [ "$VERIFY_ORIGIN_MODE" != "direct" ]; then
    return 0
  fi
  for hostname in "${DIRECT_HOSTNAMES[@]}"; do
    if [ "$hostname" = "$ready_hostname" ]; then
      return 0
    fi
  done
  echo "[verify-vps] ERROR: public /ready hostname is not in VERIFY_DIRECT_HOSTNAMES: $ready_hostname" >&2
  return 1
}

if ! validate_origin_mode "$VERIFY_ORIGIN_MODE"; then
  exit 1
fi
if ! validate_boolean_setting VERIFY_EXPECT_LOCAL_POSTGRES "$VERIFY_EXPECT_LOCAL_POSTGRES"; then
  exit 1
fi
if ! load_direct_hostnames; then
  exit 1
fi

load_backup_config() {
  if [ ! -e "$BACKUP_ENV_FILE" ]; then
    warn "backup env file missing; using current environment: $BACKUP_ENV_FILE"
    return
  fi
  if [ ! -r "$BACKUP_ENV_FILE" ]; then
    fail "backup env file is not readable: $BACKUP_ENV_FILE"
    return
  fi
  # shellcheck disable=SC1090
  if . "$BACKUP_ENV_FILE"; then
    pass "backup configuration loaded: $BACKUP_ENV_FILE"
  else
    fail "backup env file could not be loaded: $BACKUP_ENV_FILE"
  fi
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
  if ! body=$(curl -fsS --max-time 10 "$url"); then
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
  if echo "$rows" | awk '{print $4}' | grep -Ev '^(127\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|\[::1\]|::1):'"${port}"'$' >/dev/null; then
    fail "$label port ${port} is not loopback-only: $(echo "$rows" | awk '{print $4}' | paste -sd ',' -)"
  else
    pass "$label port ${port} loopback-only"
  fi
}

check_port_absent() {
  local port="$1"
  local label="$2"
  local rows
  if ! rows=$(ss -H -ltn "sport = :${port}" 2>/dev/null); then
    fail "$label port ${port} check failed: ss query failed"
    return
  fi
  if [ -z "$rows" ]; then
    pass "$label port ${port} not listening (external service expected)"
  else
    fail "$label port ${port} must not listen when an external service is expected: $(echo "$rows" | awk '{print $4}' | paste -sd ',' -)"
  fi
}

check_postgres_topology() {
  if [ "$VERIFY_EXPECT_LOCAL_POSTGRES" = "true" ]; then
    check_service postgresql
    check_port_loopback 5432 postgres
  else
    pass "postgres service check skipped (external postgres expected)"
    check_port_absent 5432 postgres
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
    fail "ufw not installed"
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

check_proxy_ip_forwarding() {
  local nginx_dump
  if ! nginx_dump=$(nginx -T 2>&1); then
    fail "unable to inspect active Nginx client IP forwarding"
    return
  fi
  if printf '%s\n' "$nginx_dump" | grep -q 'proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;'; then
    fail "active Nginx trusts a client-supplied X-Forwarded-For chain"
    return
  fi
  if printf '%s\n' "$nginx_dump" | grep -q 'proxy_set_header X-Forwarded-For \$remote_addr;'; then
    pass "active Nginx overwrites X-Forwarded-For with the trusted client address"
  else
    fail "active Nginx does not set X-Forwarded-For from \$remote_addr"
  fi
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

check_direct_rejected_host() {
  local scheme="$1"
  local invalid_host="verify-rejected-host.invalid"
  local status

  if [ "$scheme" = "https" ]; then
    # Local-only policy probe: certificate verification is intentionally disabled
    # so the request reaches the default TLS virtual host. Public probes below
    # always validate the certificate for every configured hostname.
    status=$(curl --insecure --silent --show-error --max-time 5 --noproxy '*' \
      --output /dev/null --write-out '%{http_code}' \
      --resolve "${invalid_host}:443:127.0.0.1" \
      "https://${invalid_host}/" 2>/dev/null || true)
  else
    status=$(curl --silent --show-error --max-time 5 --noproxy '*' \
      --output /dev/null --write-out '%{http_code}' \
      --header "Host: ${invalid_host}" \
      'http://127.0.0.1/' 2>/dev/null || true)
  fi

  if [ "$status" = "000" ]; then
    pass "direct-origin rejects unknown ${scheme^^} Host"
  else
    fail "direct-origin accepted unknown ${scheme^^} Host (HTTP ${status:-missing})"
  fi
}

check_direct_origin_security() {
  local nginx_dump
  local hostname
  local result
  local status
  local redirect
  local acme_path="/.well-known/acme-challenge/ss-erp-verifier-$$"

  if ! nginx_dump=$(nginx -T 2>&1); then
    fail "cannot inspect active Nginx configuration"
    return
  fi
  if printf '%s\n' "$nginx_dump" | grep -Fq 'location ^~ /.well-known/acme-challenge/'; then
    pass "active Nginx configuration exposes the ACME HTTP-01 location"
  else
    fail "active Nginx configuration is missing the ACME HTTP-01 location"
  fi

  for hostname in "${DIRECT_HOSTNAMES[@]}"; do
    if printf '%s\n' "$nginx_dump" | grep -Fq "$hostname"; then
      pass "active Nginx configuration includes direct hostname: $hostname"
    else
      fail "active Nginx configuration is missing direct hostname: $hostname"
    fi

    result=$(curl --silent --show-error --max-time 5 --noproxy '*' \
      --output /dev/null --write-out '%{http_code}\t%{redirect_url}' \
      --header "Host: ${hostname}" 'http://127.0.0.1/ready' 2>/dev/null || true)
    IFS=$'\t' read -r status redirect <<< "$result"
    if { [ "$status" = "301" ] || [ "$status" = "308" ]; } && \
       [ "$redirect" = "https://${hostname}/ready" ]; then
      pass "direct hostname redirects HTTP to HTTPS: $hostname"
    else
      fail "direct hostname HTTP redirect is invalid: $hostname (HTTP ${status:-missing}, location ${redirect:-missing})"
    fi

    result=$(curl --silent --show-error --max-time 5 --noproxy '*' \
      --output /dev/null --write-out '%{http_code}\t%{redirect_url}' \
      --header "Host: ${hostname}" "http://127.0.0.1${acme_path}" 2>/dev/null || true)
    IFS=$'\t' read -r status redirect <<< "$result"
    if [ "$status" = "404" ] && [ -z "$redirect" ]; then
      pass "ACME HTTP-01 path is served without redirect: $hostname"
    else
      fail "ACME HTTP-01 path must return local 404 without redirect: $hostname (HTTP ${status:-missing}, location ${redirect:-none})"
    fi
  done

  check_direct_rejected_host http
  check_direct_rejected_host https
}

check_origin_security() {
  if [ "$VERIFY_ORIGIN_MODE" = "cloudflare" ]; then
    check_cloudflare_origin_guard
  else
    check_direct_origin_security
  fi
}

check_cloudflare_ip_update_cron() {
  local cron="$1"
  if printf '%s\n' "$cron" | grep -Ev '^[[:space:]]*#' \
    | grep -q 'update-cloudflare-ips.sh'; then
    pass "cron includes Cloudflare IP update"
  else
    warn "cron missing Cloudflare IP update"
  fi
}

check_acme_sh_renewal() {
  local cron="$1"
  local services
  local service

  if printf '%s\n' "$cron" | grep -Ev '^[[:space:]]*#' \
    | grep -Eq 'acme\.sh.*--cron|--cron.*acme\.sh'; then
    pass "cron includes acme.sh certificate renewal"
    return
  fi

  services=$(systemctl list-timers --all --no-legend --plain 2>/dev/null \
    | awk '{print $NF}' | sort -u || true)
  while IFS= read -r service; do
    case "$service" in
      *.service)
        if systemctl show "$service" -p ExecStart --value 2>/dev/null \
          | grep -Eq 'acme\.sh.*--cron|--cron.*acme\.sh'; then
          pass "systemd timer activates acme.sh certificate renewal: $service"
          return
        fi
        ;;
    esac
  done <<< "$services"

  fail "direct-origin mode requires an acme.sh renewal cron or timer"
}

check_cron() {
  local cron
  cron=$(crontab -l 2>/dev/null || true)
  if echo "$cron" | grep -Ev '^[[:space:]]*#' | grep -Fq 'set -a; . /etc/ss-erp-backup.env; set +a; bash /opt/ss-erp/app/scripts/backup-db.sh'; then
    pass "cron exports backup env and targets the app-dir backup script"
  else
    fail "cron database backup command does not export env or target the app-dir script"
  fi
  if [ -d "$BACKUP_LOG_DIR" ] && [ -w "$BACKUP_LOG_DIR" ]; then
    pass "backup log directory is present and writable: $BACKUP_LOG_DIR"
    local backup_log_mode
    local backup_log_owner
    backup_log_mode=$(stat -c '%a' "$BACKUP_LOG_DIR")
    backup_log_owner=$(stat -c '%U:%G' "$BACKUP_LOG_DIR")
    if [ "$backup_log_mode" = "750" ]; then
      pass "backup log directory mode is 750: $BACKUP_LOG_DIR"
    else
      fail "backup log directory mode must be 750: $BACKUP_LOG_DIR (found $backup_log_mode)"
    fi
    if [ "$backup_log_owner" = "root:root" ]; then
      pass "backup log directory owner is root:root: $BACKUP_LOG_DIR"
    else
      fail "backup log directory owner must be root:root: $BACKUP_LOG_DIR (found $backup_log_owner)"
    fi
  else
    fail "backup log directory is missing or not writable: $BACKUP_LOG_DIR"
  fi

  if [ "$VERIFY_ORIGIN_MODE" = "direct" ]; then
    check_acme_sh_renewal "$cron"
  else
    check_cloudflare_ip_update_cron "$cron"
  fi
}

check_direct_public_hosts() {
  local hostname
  if [ "$VERIFY_ORIGIN_MODE" != "direct" ]; then
    return
  fi
  for hostname in "${DIRECT_HOSTNAMES[@]}"; do
    check_http_json_ready "certificate-valid public /ready ($hostname)" "https://${hostname}/ready"
  done
}

check_backup_status() {
  local backup_dir="${BACKUP_LOCAL_DIR:-/var/backups/ss-erp}"
  local status_file="${backup_dir}/backup-status.json"
  if [ ! -r "$status_file" ]; then
    fail "backup status file missing or unreadable: $status_file"
    return
  fi

  local validation
  if validation=$(node -e '
const fs = require("fs");
const path = require("path");
const statusFile = process.argv[1];
const backupDir = path.resolve(process.argv[2]);
const maxAgeHours = Number(process.argv[3]);
const reject = (message) => {
  console.error(message);
  process.exit(1);
};

if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
  reject("BACKUP_MAX_AGE_HOURS must be a positive number");
}

let data;
try {
  data = JSON.parse(fs.readFileSync(statusFile, "utf8"));
} catch (error) {
  reject("backup status JSON is invalid: " + error.message);
}

const backupAt = Date.parse(data.lastBackupAt);
if (!Number.isFinite(backupAt)) {
  reject("lastBackupAt is missing or invalid");
}
const ageMs = Date.now() - backupAt;
if (ageMs < -5 * 60 * 1000) {
  reject("lastBackupAt is unexpectedly in the future");
}
const ageHours = Math.max(0, ageMs / (60 * 60 * 1000));
if (ageHours > maxAgeHours) {
  reject("lastBackupAt is stale: " + ageHours.toFixed(2) + " hours old");
}

if (typeof data.lastLocalFile !== "string" || data.lastLocalFile.trim() === "") {
  reject("lastLocalFile is missing or invalid");
}
const localFile = path.resolve(backupDir, data.lastLocalFile);
const relativeFile = path.relative(backupDir, localFile);
if (relativeFile === ".." || relativeFile.startsWith(".." + path.sep) || path.isAbsolute(relativeFile)) {
  reject("lastLocalFile resolves outside the backup directory");
}
if (!fs.existsSync(localFile)) {
  reject("lastLocalFile does not exist");
}
try {
  fs.accessSync(localFile, fs.constants.R_OK);
} catch {
  reject("lastLocalFile is not readable");
}
const stats = fs.statSync(localFile);
if (!stats.isFile() || stats.size <= 0) {
  reject("lastLocalFile is empty or not a regular file");
}
if (typeof data.remoteUploaded !== "boolean") {
  reject("remoteUploaded is missing or invalid");
}

process.stdout.write(String(data.remoteUploaded) + "\t" + ageHours.toFixed(2) + "\t" + stats.size);
' "$status_file" "$backup_dir" "$BACKUP_MAX_AGE_HOURS" 2>&1); then
    local remote_uploaded
    local age_hours
    local local_size
    IFS=$'\t' read -r remote_uploaded age_hours local_size <<< "$validation"
    pass "latest backup is ${age_hours} hours old and local artifact is readable (${local_size} bytes)"
  else
    fail "backup status validation failed: $validation"
    return
  fi

  local remote_configured=0
  if [ -n "${BACKUP_S3_BUCKET:-}${BACKUP_S3_ENDPOINT:-}${BACKUP_S3_ACCESS_KEY_ID:-}${BACKUP_S3_SECRET_ACCESS_KEY:-}" ]; then
    if [ -z "${BACKUP_S3_BUCKET:-}" ] || [ -z "${BACKUP_S3_ENDPOINT:-}" ] || \
       [ -z "${BACKUP_S3_ACCESS_KEY_ID:-}" ] || [ -z "${BACKUP_S3_SECRET_ACCESS_KEY:-}" ]; then
      fail "remote backup configuration is incomplete"
      return
    fi
    remote_configured=1
  fi

  if [ "$remote_configured" -eq 1 ]; then
    if [ "$remote_uploaded" = "true" ]; then
      pass "latest backup reports successful remote upload"
    else
      fail "remote backup is configured but latest upload was not successful"
    fi
  elif [ "$remote_uploaded" = "true" ]; then
    warn "remote backup is not configured; latest status reports a remote upload"
  else
    warn "remote backup is not configured; latest backup is local only"
  fi
}

check_logistics_rollout_expectations() {
  local expected_logistics="$VERIFY_EXPECT_LOGISTICS_DISTRIBUTION_ENABLED"
  local expected_public="$VERIFY_EXPECT_NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED"
  local expected_auth_mode="$VERIFY_EXPECT_EXTENSION_AUTH_MODE"
  local expected_cloud_extension="$VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED"

  local rollout_expectations=(
    "VERIFY_EXPECT_LOGISTICS_DISTRIBUTION_ENABLED:$expected_logistics"
    "VERIFY_EXPECT_NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED:$expected_public"
    "VERIFY_EXPECT_CLOUD_EXTENSION_DISTRIBUTION_ENABLED:$expected_cloud_extension"
  )
  local expectation
  for expectation in "${rollout_expectations[@]}"; do
    case "${expectation#*:}" in
      true|false) ;;
      *)
        fail "${expectation%%:*} must be true or false"
        return
        ;;
    esac
  done
  case "$expected_auth_mode" in
    compat|device-only) ;;
    *)
      fail "VERIFY_EXPECT_EXTENSION_AUTH_MODE must be compat or device-only"
      return
      ;;
  esac

  local env_path="${DEPLOY_DIR}/${ENV_FILE}"
  if [ ! -r "$env_path" ]; then
    fail "deployment env file is missing or unreadable: $env_path"
    return
  fi

  local actual_values
  if ! actual_values=$(
    set +u
    # shellcheck disable=SC1090
    . "$env_path"
    printf '%s|%s|%s' "${LOGISTICS_DISTRIBUTION_ENABLED-}" "${NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED-}" "${EXTENSION_AUTH_MODE-}"
  ); then
    fail "deployment env file could not be loaded: $env_path"
    return
  fi

  local actual_logistics
  local actual_public
  local actual_auth_mode
  IFS='|' read -r actual_logistics actual_public actual_auth_mode <<< "$actual_values"
  if [ "$actual_logistics" = "$expected_logistics" ]; then
    pass "LOGISTICS_DISTRIBUTION_ENABLED matches rollout expectation: $expected_logistics"
  else
    fail "LOGISTICS_DISTRIBUTION_ENABLED expected $expected_logistics, found ${actual_logistics:-<unset>}"
  fi
  if [ "$actual_public" = "$expected_public" ]; then
    pass "NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED matches rollout expectation: $expected_public"
  else
    fail "NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED expected $expected_public, found ${actual_public:-<unset>}"
  fi
  if [ "$actual_auth_mode" = "$expected_auth_mode" ]; then
    pass "EXTENSION_AUTH_MODE matches rollout expectation: $expected_auth_mode"
  else
    fail "EXTENSION_AUTH_MODE expected $expected_auth_mode, found ${actual_auth_mode:-<unset>}"
  fi

  local cloud_feature_file="${DEPLOY_DIR}/build/extensions/ss-erp-cloud/shared/logistics-rules/distribution-feature.js"
  if [ ! -r "$cloud_feature_file" ]; then
    fail "cloud extension logistics feature file is missing or unreadable: $cloud_feature_file"
    return
  fi
  if grep -Eq "^[[:space:]]*enabled:[[:space:]]*${expected_cloud_extension},?[[:space:]]*$" "$cloud_feature_file"; then
    pass "cloud extension logistics distribution matches rollout expectation: $expected_cloud_extension"
  else
    fail "cloud extension logistics distribution expected $expected_cloud_extension: $cloud_feature_file"
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

check_ai_media_dark_rollout() {
  local verifier="${DEPLOY_DIR}/scripts/verify-ai-media-dark.sh"
  if [ ! -r "$verifier" ]; then
    fail "AI Media dark-rollout verifier is missing or unreadable: $verifier"
    return
  fi
  if DEPLOY_DIR="$DEPLOY_DIR" ENV_FILE="$ENV_FILE" bash "$verifier"; then
    return
  fi
  fail "AI Media dark-rollout verification failed"
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
  if [ "$VERIFY_EXPECT_LOCAL_POSTGRES" != "true" ]; then
    pass "local restore temp DB check skipped (external postgres expected)"
    return
  fi
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

if [ -z "$READY_URL" ]; then
  if [ -n "$PUBLIC_BASE_URL" ]; then
    READY_URL="${PUBLIC_BASE_URL%/}/ready"
  elif [ -n "$DOMAIN" ]; then
    READY_URL="https://${DOMAIN}/ready"
  elif [ -r "$DEPLOY_DIR/$ENV_FILE" ]; then
    PUBLIC_BASE_URL=$(
      set +u
      set -a
      # shellcheck disable=SC1090
      . "$DEPLOY_DIR/$ENV_FILE"
      set +a
      printf '%s' "${NEXT_PUBLIC_API_BASE_URL:-}"
    )
    if [ -n "$PUBLIC_BASE_URL" ]; then
      READY_URL="${PUBLIC_BASE_URL%/}/ready"
    fi
  fi
fi

if [ -z "$READY_URL" ]; then
  echo "[verify-vps] ERROR: set VERIFY_READY_URL, VERIFY_PUBLIC_BASE_URL, VERIFY_DOMAIN, or NEXT_PUBLIC_API_BASE_URL" >&2
  exit 1
fi

PARSED_READY_TARGET=$(node -e '
try {
  const url = new URL(process.argv[1]);
  if (!["http:", "https:"].includes(url.protocol)
    || !url.hostname
    || url.username
    || url.password
    || url.pathname !== "/ready"
    || url.search
    || url.hash) process.exit(1);
  const host = url.hostname.toLowerCase();
  const configured = String(process.argv[2] || "").toLowerCase();
  const privateIpv4 = /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(host);
  if (configured && configured !== host) process.exit(1);
  if (host === "localhost" || host === "::1" || host === "[::1]" || privateIpv4) process.exit(1);
  process.stdout.write(url.hostname + "\t" + url.protocol);
} catch {
  process.exit(1);
}
' "$READY_URL" "$DOMAIN") || {
  echo "[verify-vps] ERROR: public ready URL must be an http(s) /ready endpoint without credentials, query, or hash: $READY_URL" >&2
  exit 1
}
IFS=$'\t' read -r PARSED_READY_DOMAIN PARSED_READY_PROTOCOL <<< "$PARSED_READY_TARGET"
if ! validate_ready_protocol "$VERIFY_ORIGIN_MODE" "$PARSED_READY_PROTOCOL"; then
  exit 1
fi
if ! validate_direct_ready_hostname "${PARSED_READY_DOMAIN,,}"; then
  exit 1
fi
if [ -z "$DOMAIN" ]; then DOMAIN="$PARSED_READY_DOMAIN"; fi

echo "=== SS ERP VPS deployment verification ==="
echo "Deploy dir: ${DEPLOY_DIR}"
echo "Domain: ${DOMAIN}"
echo "Public ready URL: ${READY_URL}"
echo "Origin mode: ${VERIFY_ORIGIN_MODE}"
if [ "$VERIFY_ORIGIN_MODE" = "direct" ]; then
  echo "Direct hostnames: ${DIRECT_HOSTNAMES[*]}"
fi
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
check_postgres_topology
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
check_port_loopback 6379 redis

check_ufw
check_proxy_ip_forwarding
check_origin_security
load_backup_config
check_cron
check_backup_status
check_prisma_migrations
check_ai_media_dark_rollout
check_logistics_rollout_expectations
check_no_restore_temp_db

check_http_json_ready "local /ready" "$LOCAL_READY_URL"
check_http_json_ready "public /ready" "$READY_URL"
check_direct_public_hosts

check_recent_logs ss-erp-api
check_recent_logs ss-erp-worker

echo ""
echo "=== Result: ${FAILURES} failure(s), ${WARNINGS} warning(s) ==="
if [ "$FAILURES" -gt 0 ]; then
  exit 1
fi

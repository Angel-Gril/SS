#!/usr/bin/env bash
# Read-only Redis runtime and observability diagnostic.
# It reports current availability separately from HA, persistence, and alerting.

set -euo pipefail

REDIS_CLI="${REDIS_CLI:-redis-cli}"
REDIS_HOST="${REDIS_HOST:-127.0.0.1}"
REDIS_PORT="${REDIS_PORT:-6379}"
FAILURES=0
WARNINGS=0

pass() { printf 'PASS %s\n' "$1"; }
warn() { WARNINGS=$((WARNINGS + 1)); printf 'WARN %s\n' "$1"; }
fail() { FAILURES=$((FAILURES + 1)); printf 'FAIL %s\n' "$1"; }

require_command() {
  if command -v "$1" >/dev/null 2>&1; then
    return 0
  fi
  fail "required command is missing: $1"
  return 1
}

redis_cli() {
  "$REDIS_CLI" --no-auth-warning -h "$REDIS_HOST" -p "$REDIS_PORT" "$@"
}

info_value() {
  local section="$1"
  local key="$2"
  redis_cli INFO "$section" | awk -F: -v key="$key" '$1 == key { sub(/\r$/, "", $2); print $2; exit }'
}

config_value() {
  local key="$1"
  redis_cli CONFIG GET "$key" | awk -v key="$key" '
    NR == 1 { wanted = ($0 == key); next }
    wanted { sub(/\r$/, ""); print; exit }
  '
}

if ! require_command "$REDIS_CLI"; then
  printf 'REDIS_RUNTIME_STATUS=FAIL\n'
  exit 1
fi

if ! ping_result="$(redis_cli PING 2>/dev/null)" || [ "$ping_result" != 'PONG' ]; then
  fail "Redis PING failed at ${REDIS_HOST}:${REDIS_PORT}"
  printf 'REDIS_RUNTIME_STATUS=FAIL\n'
  printf 'REDIS_WARNINGS=%s\n' "$WARNINGS"
  exit 1
fi
pass "Redis PING succeeded at ${REDIS_HOST}:${REDIS_PORT}"

redis_mode="$(info_value server redis_mode || true)"
role="$(info_value replication role || true)"
connected_slaves="$(info_value replication connected_slaves || true)"
cluster_enabled="$(info_value cluster cluster_enabled || true)"
cluster_connections="$(info_value clients cluster_connections || true)"
connected_clients="$(info_value clients connected_clients || true)"
blocked_clients="$(info_value clients blocked_clients || true)"
uptime_seconds="$(info_value server uptime_in_seconds || true)"
used_memory="$(info_value memory used_memory || true)"
aof_enabled="$(info_value persistence aof_enabled || true)"
rdb_last_status="$(info_value persistence rdb_last_bgsave_status || true)"
maxmemory="$(config_value maxmemory || true)"
maxmemory_policy="$(config_value maxmemory-policy || true)"

for numeric in connected_slaves cluster_enabled cluster_connections connected_clients blocked_clients uptime_seconds used_memory aof_enabled maxmemory; do
  value="${!numeric}"
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    value='unknown'
  fi
  printf 'REDIS_%s=%s\n' "$(printf '%s' "$numeric" | tr '[:lower:]' '[:upper:]')" "$value"
done
printf 'REDIS_MODE=%s\n' "${redis_mode:-unknown}"
printf 'REDIS_ROLE=%s\n' "${role:-unknown}"
printf 'REDIS_MAXMEMORY_POLICY=%s\n' "${maxmemory_policy:-unknown}"
printf 'REDIS_RDB_LAST_STATUS=%s\n' "${rdb_last_status:-unknown}"

if [ "$redis_mode" = 'cluster' ] || [ "${cluster_enabled:-0}" = '1' ]; then
  printf 'REDIS_TOPOLOGY=cluster\n'
  pass 'Redis cluster topology is active'
else
  printf 'REDIS_TOPOLOGY=standalone\n'
  warn 'Redis is not running in cluster mode'
fi

if [ "$role" = 'master' ] && [ "${connected_slaves:-0}" != '0' ]; then
  printf 'REDIS_REPLICATION_STATUS=replicas_connected\n'
  pass "Redis master has ${connected_slaves} connected replica(s)"
else
  printf 'REDIS_REPLICATION_STATUS=no_replicas\n'
  warn 'Redis has no connected replicas'
fi

if [ "$aof_enabled" = '1' ] && [ "$rdb_last_status" = 'ok' ]; then
  printf 'REDIS_PERSISTENCE_STATUS=aof_and_rdb_ok\n'
  pass 'Redis AOF and latest RDB background save are healthy'
elif [ "$rdb_last_status" = 'ok' ]; then
  printf 'REDIS_PERSISTENCE_STATUS=rdb_only\n'
  warn 'Redis AOF is disabled; persistence relies on RDB snapshots'
else
  printf 'REDIS_PERSISTENCE_STATUS=degraded\n'
  warn "Redis persistence status is ${rdb_last_status:-unknown}"
fi

alert_units=''
if command -v systemctl >/dev/null 2>&1; then
  unit_list="$(systemctl list-unit-files --no-legend 2>/dev/null || true)"
  alert_units="$(printf '%s\n' "$unit_list" | grep -Eic 'prometheus|alertmanager|redis-exporter|redis-monitor|redis-sentinel' || true)"
else
  alert_units='unknown'
fi
cron_entries="$(crontab -l 2>/dev/null || true)"
cron_alerts="$(printf '%s\n' "$cron_entries" | grep -Eic 'redis[^[:space:]]*[^[:alnum:]]*(health|monitor|alert)|redis-cli[^[:space:]]+ping' || true)"
if [ "$alert_units" = 'unknown' ]; then
  printf 'REDIS_ALERTING_STATUS=unavailable\n'
  warn 'systemd is unavailable; Redis alerting could not be inspected'
elif [ "$alert_units" != '0' ] || [ "$cron_alerts" != '0' ]; then
  printf 'REDIS_ALERTING_STATUS=detected\n'
  pass "Redis monitoring hooks detected (units=${alert_units}; cron=${cron_alerts})"
else
  printf 'REDIS_ALERTING_STATUS=not_detected\n'
  warn 'No Redis-specific monitoring unit or cron check was detected'
fi

if [ "$FAILURES" -eq 0 ]; then
  printf 'REDIS_RUNTIME_STATUS=PASS\n'
else
  printf 'REDIS_RUNTIME_STATUS=FAIL\n'
fi
printf 'REDIS_WARNINGS=%s\n' "$WARNINGS"
printf 'REDIS_FAILURES=%s\n' "$FAILURES"
exit "$FAILURES"

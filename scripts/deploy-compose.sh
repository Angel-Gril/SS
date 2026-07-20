#!/usr/bin/env bash
# Build and deploy the supported Compose stack without running old API/Worker
# processes across migrations or the AI Media dark-rollout gate.

set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
PROCESS_MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT-}"
unset MIGRATION_TIMEOUT

fail() {
  printf '[deploy-compose] ERROR: %s\n' "$*" >&2
  exit 1
}

[ -r "$COMPOSE_FILE" ] || fail "compose file is missing or unreadable: $COMPOSE_FILE"
[ -r "$ENV_FILE" ] || fail "environment file is missing or unreadable: $ENV_FILE"

if [ -n "$PROCESS_MIGRATION_TIMEOUT" ]; then
  MIGRATION_TIMEOUT="$PROCESS_MIGRATION_TIMEOUT"
else
  while IFS= read -r line || [ -n "$line" ]; do
    line="${line%$'\r'}"
    if [[ ! "$line" =~ ^[[:space:]]*(export[[:space:]]+)?MIGRATION_TIMEOUT[[:space:]]*= ]]; then
      continue
    fi
    if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?MIGRATION_TIMEOUT[[:space:]]*=[[:space:]]*([1-9][0-9]*[smh])[[:space:]]*(#.*)?$ ]]; then
      MIGRATION_TIMEOUT="${BASH_REMATCH[2]}"
    elif [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?MIGRATION_TIMEOUT[[:space:]]*=[[:space:]]*\"([1-9][0-9]*[smh])\"[[:space:]]*(#.*)?$ ]]; then
      MIGRATION_TIMEOUT="${BASH_REMATCH[2]}"
    elif [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?MIGRATION_TIMEOUT[[:space:]]*=[[:space:]]*\'([1-9][0-9]*[smh])\'[[:space:]]*(#.*)?$ ]]; then
      MIGRATION_TIMEOUT="${BASH_REMATCH[2]}"
    else
      fail "MIGRATION_TIMEOUT in $ENV_FILE must be a literal positive duration ending in s, m, or h"
    fi
  done < "$ENV_FILE"
fi
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-20m}"
if [[ ! "$MIGRATION_TIMEOUT" =~ ^[1-9][0-9]*[smh]$ ]]; then
  fail "MIGRATION_TIMEOUT must be a positive duration ending in s, m, or h"
fi

export ENV_FILE MIGRATION_TIMEOUT
COMPOSE=(docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE")
"${COMPOSE[@]}" config --quiet

printf '[deploy-compose] Building images\n'
"${COMPOSE[@]}" build

SERVICES_QUIESCED=0
keep_quiesced_on_failure() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$SERVICES_QUIESCED" = "1" ]; then
    "${COMPOSE[@]}" stop worker api web || true
    printf '[deploy-compose] API/Worker/Web remain stopped; inspect migrate logs and the recovery runbook\n' >&2
  fi
  exit "$status"
}
trap keep_quiesced_on_failure EXIT

printf '[deploy-compose] Quiescing application services before migration\n'
"${COMPOSE[@]}" stop worker api web
SERVICES_QUIESCED=1

infra=(redis)
if "${COMPOSE[@]}" config --services | grep -qx postgres; then
  infra=(postgres redis)
fi
"${COMPOSE[@]}" up -d --wait "${infra[@]}"

printf '[deploy-compose] Running bounded migration and AI Media dark gate\n'
"${COMPOSE[@]}" run --rm --no-deps migrate

printf '[deploy-compose] Starting application services after successful gate\n'
"${COMPOSE[@]}" up -d --wait --force-recreate --no-deps api worker web
SERVICES_QUIESCED=0

printf '[deploy-compose] Deployment complete\n'

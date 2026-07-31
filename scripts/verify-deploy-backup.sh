#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '[deploy-backup] ERROR: %s\n' "$*" >&2
  exit 1
}

TARGET_GIT_COMMIT="${1:-${DEPLOY_TARGET_GIT_COMMIT:-}}"
DEPLOY_EVIDENCE_DIR="${DEPLOY_BACKUP_LOCAL_DIR:-}"
DEPLOY_DATABASE_ID="${DEPLOY_DATABASE_ID:-}"
DEPLOY_BACKUP_MAX_AGE_MINUTES="${DEPLOY_BACKUP_MAX_AGE_MINUTES:-120}"
DEPLOY_BACKUP_VERIFY_TIMEOUT="${DEPLOY_BACKUP_VERIFY_TIMEOUT:-20m}"
command -v readlink >/dev/null 2>&1 || fail "readlink is required"

if [[ ! "$TARGET_GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  fail "target Git commit must be one lowercase full 40-character object ID"
fi
if [ -n "${DEPLOY_TARGET_GIT_COMMIT:-}" ] \
  && [ "$DEPLOY_TARGET_GIT_COMMIT" != "$TARGET_GIT_COMMIT" ]; then
  fail "DEPLOY_TARGET_GIT_COMMIT does not match the requested target commit"
fi
if [[ ! "$DEPLOY_DATABASE_ID" =~ ^[a-z0-9][a-z0-9._-]{0,127}$ ]]; then
  fail "DEPLOY_DATABASE_ID must be a canonical deployment database identifier"
fi
if [ -z "${DATABASE_URL:-}" ]; then
  fail "DATABASE_URL is required to bind the migration database identity"
fi
case "$DEPLOY_EVIDENCE_DIR" in
  /*) ;;
  *) fail "DEPLOY_BACKUP_LOCAL_DIR must be an explicit absolute path" ;;
esac
if [ "$(readlink -m -- "$DEPLOY_EVIDENCE_DIR")" != "$DEPLOY_EVIDENCE_DIR" ]; then
  fail "DEPLOY_BACKUP_LOCAL_DIR must be one canonical absolute path"
fi
if [ -n "${BACKUP_LOCAL_DIR:-}" ]; then
  case "$BACKUP_LOCAL_DIR" in
    /*) ;;
    *) fail "BACKUP_LOCAL_DIR must be an absolute path when set in the application env" ;;
  esac
  if [ "$(readlink -m -- "$BACKUP_LOCAL_DIR")" != "$BACKUP_LOCAL_DIR" ]; then
    fail "BACKUP_LOCAL_DIR must be one canonical absolute path"
  fi
  if [ -e "$BACKUP_LOCAL_DIR" ] \
    && [ "$(readlink -f -- "$BACKUP_LOCAL_DIR")" = "$(readlink -f -- "$DEPLOY_EVIDENCE_DIR")" ]; then
    fail "application BACKUP_LOCAL_DIR must be separate from deployment backup evidence"
  fi
fi
if [[ ! "$DEPLOY_BACKUP_MAX_AGE_MINUTES" =~ ^[1-9][0-9]{0,3}$ ]] \
  || [ "$DEPLOY_BACKUP_MAX_AGE_MINUTES" -gt 1440 ]; then
  fail "DEPLOY_BACKUP_MAX_AGE_MINUTES must be an integer from 1 through 1440"
fi
if [[ ! "$DEPLOY_BACKUP_VERIFY_TIMEOUT" =~ ^[1-9][0-9]*[smh]$ ]]; then
  fail "DEPLOY_BACKUP_VERIFY_TIMEOUT must be a positive duration ending in s, m, or h"
fi
VERIFY_TIMEOUT_AMOUNT="${DEPLOY_BACKUP_VERIFY_TIMEOUT%?}"
VERIFY_TIMEOUT_UNIT="${DEPLOY_BACKUP_VERIFY_TIMEOUT: -1}"
case "$VERIFY_TIMEOUT_UNIT" in
  s) VERIFY_TIMEOUT_MAX=86400 ;;
  m) VERIFY_TIMEOUT_MAX=1440 ;;
  h) VERIFY_TIMEOUT_MAX=24 ;;
esac
if [ "${#VERIFY_TIMEOUT_AMOUNT}" -gt 5 ] \
  || [ "$VERIFY_TIMEOUT_AMOUNT" -gt "$VERIFY_TIMEOUT_MAX" ]; then
  fail "DEPLOY_BACKUP_VERIFY_TIMEOUT must not exceed 24 hours"
fi
if [ -n "${DEPLOY_BACKUP_ATTESTATION_TEST_NOW:-}" ]; then
  fail "DEPLOY_BACKUP_ATTESTATION_TEST_NOW is forbidden in deployment"
fi

EXPECTED_ATTESTATION="${DEPLOY_EVIDENCE_DIR}/deploy-backup-${TARGET_GIT_COMMIT}.attestation.json"
ATTESTATION_FILE="${DEPLOY_BACKUP_ATTESTATION_FILE:-$EXPECTED_ATTESTATION}"
if [ "$ATTESTATION_FILE" != "$EXPECTED_ATTESTATION" ]; then
  fail "DEPLOY_BACKUP_ATTESTATION_FILE must be exactly $EXPECTED_ATTESTATION"
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || fail "node is required"
command -v psql >/dev/null 2>&1 || fail "psql is required"
command -v timeout >/dev/null 2>&1 || fail "timeout is required"

DATABASE_BINDING="$(DEPLOY_DATABASE_ID="$DEPLOY_DATABASE_ID" \
  DEPLOY_DATABASE_URL="$DATABASE_URL" \
  node "$SCRIPT_DIR/deploy-database-identity.mjs" --backup-binding)"
IFS=$'\t' read -r DATABASE_IDENTITY_SHA256 DATABASE_UUID_SHA256 <<< "$DATABASE_BINDING"
if [[ ! "$DATABASE_IDENTITY_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || [[ ! "$DATABASE_UUID_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  fail "could not derive the migration database identity and UUID digests"
fi

exec timeout --signal=TERM --kill-after=30s "$DEPLOY_BACKUP_VERIFY_TIMEOUT" \
  node "$SCRIPT_DIR/deploy-backup-attestation.mjs" verify \
  --attestation "$ATTESTATION_FILE" \
  --backup-dir "$DEPLOY_EVIDENCE_DIR" \
  --expected-database-id "$DEPLOY_DATABASE_ID" \
  --expected-database-identity-sha256 "$DATABASE_IDENTITY_SHA256" \
  --expected-database-uuid-sha256 "$DATABASE_UUID_SHA256" \
  --expected-target-git-commit "$TARGET_GIT_COMMIT" \
  --max-age-minutes "$DEPLOY_BACKUP_MAX_AGE_MINUTES"

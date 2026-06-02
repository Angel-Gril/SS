#!/usr/bin/env bash
set -euo pipefail

# Safely update an existing SS ERP env file for Cloudflare R2 / S3-compatible OSS.
#
# This script is intended to run on the VPS. It does not print secrets.
# It creates a timestamped backup next to the env file before writing.
#
# Required env:
#   OSS_ENDPOINT
#   OSS_BUCKET
#   OSS_ACCESS_KEY_ID
#   OSS_ACCESS_KEY_SECRET
#
# Optional env:
#   DEPLOY_DIR=/opt/ss-erp/app
#   ENV_FILE=.env.staging
#   OSS_REGION=auto
#   OSS_CDN_DOMAIN=
#   OSS_FALLBACK_TO_CDN=true
#   LOCAL_BASE_URL=https://app.ss-erp.com
#
# Usage:
#   OSS_ENDPOINT=... OSS_BUCKET=... OSS_ACCESS_KEY_ID=... OSS_ACCESS_KEY_SECRET=... \
#     DEPLOY_DIR=/opt/ss-erp/app bash scripts/configure-cloud-r2-env.sh

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ss-erp/app}"
ENV_FILE="${ENV_FILE:-.env.staging}"
ENV_PATH="$DEPLOY_DIR/$ENV_FILE"

fail() { printf '[cloud-r2-env] ERROR: %s\n' "$*" >&2; exit 1; }
info() { printf '[cloud-r2-env] %s\n' "$*"; }

if [ ! -f "$ENV_PATH" ]; then
  fail "env file not found: $ENV_PATH"
fi

for key in OSS_ENDPOINT OSS_BUCKET OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET; do
  if [ -z "${!key:-}" ]; then
    fail "$key is required"
  fi
done

OSS_REGION="${OSS_REGION:-auto}"
OSS_CDN_DOMAIN="${OSS_CDN_DOMAIN:-}"
OSS_FALLBACK_TO_CDN="${OSS_FALLBACK_TO_CDN:-true}"
LOCAL_BASE_URL="${LOCAL_BASE_URL:-https://app.ss-erp.com}"

escape_env_value() {
  local value="$1"
  if printf '%s' "$value" | grep -Eq '^[A-Za-z0-9_./:@%+=,-]+$'; then
    printf '%s' "$value"
  else
    value=${value//\\/\\\\}
    value=${value//\"/\\\"}
    printf '"%s"' "$value"
  fi
}

upsert_env() {
  local key="$1"
  local value="$2"
  local escaped
  escaped=$(escape_env_value "$value")

  if grep -qE "^${key}=" "$ENV_PATH"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$ENV_PATH"
  else
    printf '%s=%s\n' "$key" "$escaped" >> "$ENV_PATH"
  fi
}

BACKUP_PATH="${ENV_PATH}.bak.$(date +%Y%m%d%H%M%S)"
cp -p "$ENV_PATH" "$BACKUP_PATH"
info "backup created: $BACKUP_PATH"

upsert_env RUNTIME_MODE cloud
upsert_env NEXT_PUBLIC_RUNTIME_MODE cloud
upsert_env IMAGE_STORAGE_BACKEND oss
upsert_env OSS_ENDPOINT "$OSS_ENDPOINT"
upsert_env OSS_BUCKET "$OSS_BUCKET"
upsert_env OSS_ACCESS_KEY_ID "$OSS_ACCESS_KEY_ID"
upsert_env OSS_ACCESS_KEY_SECRET "$OSS_ACCESS_KEY_SECRET"
upsert_env OSS_REGION "$OSS_REGION"
if [ -n "$OSS_CDN_DOMAIN" ]; then
  upsert_env OSS_CDN_DOMAIN "$OSS_CDN_DOMAIN"
fi
upsert_env OSS_FALLBACK_TO_CDN "$OSS_FALLBACK_TO_CDN"
upsert_env LOCAL_BASE_URL "$LOCAL_BASE_URL"

info "updated cloud R2 env: $ENV_PATH"
grep -E '^(RUNTIME_MODE|NEXT_PUBLIC_RUNTIME_MODE|IMAGE_STORAGE_BACKEND|OSS_ENDPOINT|OSS_BUCKET|OSS_ACCESS_KEY_ID|OSS_ACCESS_KEY_SECRET|OSS_REGION|OSS_CDN_DOMAIN|OSS_FALLBACK_TO_CDN|LOCAL_BASE_URL)=' "$ENV_PATH" \
  | sed -E 's/(OSS_ACCESS_KEY_ID|OSS_ACCESS_KEY_SECRET)=.*/\1=***MASKED***/'

if [ -f "$DEPLOY_DIR/scripts/validate-env.mjs" ]; then
  info "validating cloud-r2 profile"
  node "$DEPLOY_DIR/scripts/validate-env.mjs" --profile cloud-r2 --env "$ENV_PATH"
else
  info "validate-env.mjs not found in current deploy; validation will run after deploying the latest code"
fi

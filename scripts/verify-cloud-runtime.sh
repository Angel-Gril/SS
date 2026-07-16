#!/usr/bin/env bash
set -euo pipefail

# Read-only cloud runtime verification for a VPS deployment.
#
# Usage:
#   DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging bash scripts/verify-cloud-runtime.sh

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ss-erp/current}"
ENV_FILE="${ENV_FILE:-.env.staging}"
VERIFY_DOMAIN="${VERIFY_DOMAIN:-}"
VERIFY_PUBLIC_BASE_URL="${VERIFY_PUBLIC_BASE_URL:-}"
VERIFY_READY_URL="${VERIFY_READY_URL:-}"
LOCAL_API_BASE_URL="${LOCAL_API_BASE_URL:-${LOCAL_READY_URL:-http://127.0.0.1:3001}}"
LOCAL_API_BASE_URL="${LOCAL_API_BASE_URL%/ready}"
LOCAL_API_BASE_URL="${LOCAL_API_BASE_URL%/}"

if [ ! -d "$DEPLOY_DIR" ]; then
  echo "[cloud-runtime] ERROR: deploy dir missing: $DEPLOY_DIR" >&2
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/scripts/diagnose-runtime-env.sh" ]; then
  echo "[cloud-runtime] ERROR: diagnose script missing in deploy dir" >&2
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/scripts/verify-vps-deploy.sh" ]; then
  echo "[cloud-runtime] ERROR: VPS verify script missing in deploy dir" >&2
  exit 1
fi

if [ ! -f "$DEPLOY_DIR/scripts/validate-env.mjs" ]; then
  echo "[cloud-runtime] ERROR: env validation script missing in deploy dir" >&2
  exit 1
fi

if [ -z "$VERIFY_READY_URL" ]; then
  if [ -n "$VERIFY_PUBLIC_BASE_URL" ]; then
    VERIFY_READY_URL="${VERIFY_PUBLIC_BASE_URL%/}/ready"
  elif [ -n "$VERIFY_DOMAIN" ]; then
    VERIFY_READY_URL="https://${VERIFY_DOMAIN}/ready"
  else
    VERIFY_PUBLIC_BASE_URL=$(
      set +u
      set -a
      # shellcheck disable=SC1090
      . "$DEPLOY_DIR/$ENV_FILE"
      set +a
      printf '%s' "${NEXT_PUBLIC_API_BASE_URL:-}"
    )
    if [ -n "$VERIFY_PUBLIC_BASE_URL" ]; then
      VERIFY_READY_URL="${VERIFY_PUBLIC_BASE_URL%/}/ready"
    fi
  fi
fi

if [ -z "$VERIFY_READY_URL" ]; then
  echo "[cloud-runtime] ERROR: set VERIFY_READY_URL, VERIFY_PUBLIC_BASE_URL, VERIFY_DOMAIN, or NEXT_PUBLIC_API_BASE_URL" >&2
  exit 1
fi

PARSED_READY_DOMAIN=$(node -e '
try {
  const url = new URL(process.argv[1]);
  if (!['http:', 'https:'].includes(url.protocol)
    || !url.hostname
    || url.username
    || url.password
    || url.pathname !== '/ready'
    || url.search
    || url.hash) process.exit(1);
  const host = url.hostname.toLowerCase();
  const configured = String(process.argv[2] || '').toLowerCase();
  const privateIpv4 = /^(?:127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/u.test(host);
  if (configured && configured !== host) process.exit(1);
  if (host === 'localhost' || host === '::1' || privateIpv4) process.exit(1);
  process.stdout.write(url.hostname);
} catch {
  process.exit(1);
}
' "$VERIFY_READY_URL" "$VERIFY_DOMAIN") || {
  echo "[cloud-runtime] ERROR: public ready URL must be an http(s) /ready endpoint without credentials, query, or hash: $VERIFY_READY_URL" >&2
  exit 1
}
if [ -z "$VERIFY_DOMAIN" ]; then VERIFY_DOMAIN="$PARSED_READY_DOMAIN"; fi

echo "=== SS ERP cloud runtime verification ==="
echo "Deploy dir: $DEPLOY_DIR"
echo "Env file: $ENV_FILE"
echo "Domain: $VERIFY_DOMAIN"
echo "Public ready URL: $VERIFY_READY_URL"
echo "Local API base URL: $LOCAL_API_BASE_URL"
echo ""

echo "[1/3] Bootstrap env file validation"
(
  cd "$DEPLOY_DIR"
  node scripts/validate-env.mjs --profile cloud-bootstrap --env "$ENV_FILE"
)

echo ""
echo "[2/3] Runtime/env diagnostics"
DEPLOY_DIR="$DEPLOY_DIR" \
ENV_FILE="$ENV_FILE" \
API_BASE_URL="$LOCAL_API_BASE_URL" \
bash "$DEPLOY_DIR/scripts/diagnose-runtime-env.sh"

echo ""
echo "[3/3] VPS deployment checks"
DEPLOY_DIR="$DEPLOY_DIR" \
ENV_FILE="$ENV_FILE" \
VERIFY_DOMAIN="$VERIFY_DOMAIN" \
VERIFY_READY_URL="$VERIFY_READY_URL" \
VERIFY_LOCAL_READY_URL="$LOCAL_API_BASE_URL/ready" \
bash "$DEPLOY_DIR/scripts/verify-vps-deploy.sh"

echo ""
echo "=== Cloud runtime local checks passed ==="
echo "Run the public R2 smoke from your local machine:"
echo "  SMOKE_CREATE_TEMP_USER=true SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote"

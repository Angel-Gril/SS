#!/usr/bin/env bash
set -euo pipefail

# Read-only cloud runtime verification for a VPS deployment.
#
# Usage:
#   DEPLOY_DIR=/opt/ss-erp/current ENV_FILE=.env.staging bash scripts/verify-cloud-runtime.sh

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ss-erp/current}"
ENV_FILE="${ENV_FILE:-.env.staging}"
VERIFY_DOMAIN="${VERIFY_DOMAIN:-ss-erp.com}"
LOCAL_READY_URL="${LOCAL_READY_URL:-http://127.0.0.1:3001/ready}"

echo "=== SS ERP cloud runtime verification ==="
echo "Deploy dir: $DEPLOY_DIR"
echo "Env file: $ENV_FILE"
echo "Domain: $VERIFY_DOMAIN"
echo ""

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

echo "[1/2] Runtime/env diagnostics"
DEPLOY_DIR="$DEPLOY_DIR" \
ENV_FILE="$ENV_FILE" \
API_BASE_URL="$LOCAL_READY_URL" \
bash "$DEPLOY_DIR/scripts/diagnose-runtime-env.sh"

echo ""
echo "[2/2] VPS deployment checks"
DEPLOY_DIR="$DEPLOY_DIR" \
ENV_FILE="$ENV_FILE" \
VERIFY_DOMAIN="$VERIFY_DOMAIN" \
VERIFY_LOCAL_READY_URL="$LOCAL_READY_URL" \
bash "$DEPLOY_DIR/scripts/verify-vps-deploy.sh"

echo ""
echo "=== Cloud runtime local checks passed ==="
echo "Run the public R2 smoke from your local machine:"
echo "  SMOKE_CREATE_TEMP_USER=true SMOKE_EXPECT_UPLOAD=true SMOKE_EXPECT_OSS=true pnpm smoke:remote"

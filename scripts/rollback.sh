#!/usr/bin/env bash
set -euo pipefail

# Roll back a release-directory deployment.
#
# Required env:
#   DEPLOY_HOST=your-server
#
# Optional env:
#   DEPLOY_USER=root
#   SSH_KEY=~/.ssh/ss_erp_vultr_sg
#   DEPLOY_BASE=/opt/ss-erp
#   RELEASES_DIR=$DEPLOY_BASE/releases
#   CURRENT_LINK=$DEPLOY_BASE/current
#   API_SERVICE=ss-erp-api
#   WEB_SERVICE=ss-erp-web
#   WORKER_SERVICE=ss-erp-worker
#   HEALTH_URL=http://127.0.0.1:3001/ready
#
# Usage:
#   DEPLOY_HOST=45.76.49.64 ./scripts/rollback.sh [commit]

DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_HOST="${DEPLOY_HOST:-}"
SSH_KEY="${SSH_KEY:-}"
DEPLOY_BASE="${DEPLOY_BASE:-/opt/ss-erp}"
RELEASES_DIR="${RELEASES_DIR:-$DEPLOY_BASE/releases}"
CURRENT_LINK="${CURRENT_LINK:-$DEPLOY_BASE/current}"
API_SERVICE="${API_SERVICE:-ss-erp-api}"
WEB_SERVICE="${WEB_SERVICE:-ss-erp-web}"
WORKER_SERVICE="${WORKER_SERVICE:-ss-erp-worker}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3001/ready}"

fail() { printf '[rollback] ERROR: %s\n' "$*" >&2; exit 1; }

if [ -z "$DEPLOY_HOST" ]; then
  fail "DEPLOY_HOST is required"
fi

SSH_ARGS=(-o BatchMode=yes)
if [ -n "$SSH_KEY" ]; then
  SSH_ARGS+=(-i "$SSH_KEY" -o IdentitiesOnly=yes)
fi

TARGET_COMMIT="${1:-}"

ssh "${SSH_ARGS[@]}" "$DEPLOY_USER@$DEPLOY_HOST" bash -s -- \
  "$TARGET_COMMIT" "$RELEASES_DIR" "$CURRENT_LINK" "$API_SERVICE" "$WEB_SERVICE" "$WORKER_SERVICE" "$HEALTH_URL" <<'REMOTE'
set -euo pipefail

TARGET_COMMIT="$1"
RELEASES_DIR="$2"
CURRENT_LINK="$3"
API_SERVICE="$4"
WEB_SERVICE="$5"
WORKER_SERVICE="$6"
HEALTH_URL="$7"

if [ -z "$TARGET_COMMIT" ]; then
  TARGET_COMMIT="$(cd "$RELEASES_DIR" && ls -1t | sed -n '2p')"
fi

if [ -z "$TARGET_COMMIT" ]; then
  echo "[rollback] ERROR: no rollback target found" >&2
  exit 1
fi

TARGET_DIR="$RELEASES_DIR/$TARGET_COMMIT"
if [ ! -d "$TARGET_DIR" ]; then
  echo "[rollback] ERROR: release not found: $TARGET_DIR" >&2
  exit 1
fi

health_check() {
  local attempt=1
  local max_attempts=30
  local retry_delay_seconds=1
  local http_code
  while true; do
    http_code=""
    if http_code="$(curl --silent --show-error --max-time 2 \
      --output /dev/null --write-out '%{http_code}' "$HEALTH_URL")"; then
      if [ "$http_code" = "200" ]; then
        printf '[rollback] Health check passed after %s attempt(s) (HTTP %s)\n' \
          "$attempt" "$http_code"
        return 0
      fi
    else
      http_code=000
    fi
    printf '[rollback] Health check attempt %s returned HTTP %s\n' "$attempt" "$http_code" >&2
    if [ "$attempt" -ge "$max_attempts" ]; then
      printf '[rollback] ERROR: health check failed after %s attempts\n' \
        "$max_attempts" >&2
      return 1
    fi
    attempt=$((attempt + 1))
    sleep "$retry_delay_seconds"
  done
}

CURRENT_RELEASE="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
echo "[rollback] Current: ${CURRENT_RELEASE##*/}"
echo "[rollback] Target: $TARGET_COMMIT"

ln -sfn "$TARGET_DIR" "$CURRENT_LINK"
systemctl restart "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"

if ! health_check; then
  echo "[rollback] ERROR: health check failed after rollback" >&2
  if [ -n "$CURRENT_RELEASE" ] && [ -d "$CURRENT_RELEASE" ]; then
    echo "[rollback] Restoring previous current symlink"
    ln -sfn "$CURRENT_RELEASE" "$CURRENT_LINK"
    systemctl restart "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"
  fi
  exit 1
fi

echo "[rollback] Success: $TARGET_COMMIT"
REMOTE

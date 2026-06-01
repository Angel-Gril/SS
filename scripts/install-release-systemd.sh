#!/usr/bin/env bash
set -euo pipefail

# Install systemd units for release-directory deployment.
#
# Usage:
#   DEPLOY_BASE=/opt/ss-erp bash scripts/install-release-systemd.sh [--restart]

DEPLOY_BASE="${DEPLOY_BASE:-/opt/ss-erp}"
UNIT_SRC_DIR="${UNIT_SRC_DIR:-deploy/systemd-release}"
UNIT_DST_DIR="${UNIT_DST_DIR:-/etc/systemd/system}"
API_SERVICE="${API_SERVICE:-ss-erp-api}"
WORKER_SERVICE="${WORKER_SERVICE:-ss-erp-worker}"
WEB_SERVICE="${WEB_SERVICE:-ss-erp-web}"
RESTART=false

for arg in "$@"; do
  case "$arg" in
    --restart) RESTART=true ;;
    *)
      echo "[systemd] ERROR: unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

if [ ! -d "$UNIT_SRC_DIR" ]; then
  echo "[systemd] ERROR: unit source directory missing: $UNIT_SRC_DIR" >&2
  exit 1
fi

for service in "$API_SERVICE" "$WORKER_SERVICE" "$WEB_SERVICE"; do
  if [ ! -f "$UNIT_SRC_DIR/$service.service" ]; then
    echo "[systemd] ERROR: missing unit template: $UNIT_SRC_DIR/$service.service" >&2
    exit 1
  fi
done

echo "[systemd] Installing release-mode units from $UNIT_SRC_DIR"
sudo cp "$UNIT_SRC_DIR/$API_SERVICE.service" "$UNIT_DST_DIR/$API_SERVICE.service"
sudo cp "$UNIT_SRC_DIR/$WORKER_SERVICE.service" "$UNIT_DST_DIR/$WORKER_SERVICE.service"
sudo cp "$UNIT_SRC_DIR/$WEB_SERVICE.service" "$UNIT_DST_DIR/$WEB_SERVICE.service"

echo "[systemd] Reloading systemd"
sudo systemctl daemon-reload
sudo systemctl enable "$API_SERVICE" "$WORKER_SERVICE" "$WEB_SERVICE"

echo "[systemd] Expected release paths:"
echo "[systemd]   current: $DEPLOY_BASE/current"
echo "[systemd]   env:     $DEPLOY_BASE/shared/.env.staging"

if [ "$RESTART" = true ]; then
  echo "[systemd] Restarting services"
  sudo systemctl restart "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"
fi

echo "[systemd] Done"

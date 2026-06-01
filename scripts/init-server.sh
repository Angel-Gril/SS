#!/usr/bin/env bash
set -euo pipefail

# Initialize directories for release-directory deployment.
#
# Optional env:
#   DEPLOY_BASE=/opt/ss-erp
#   DEPLOY_USER=deploy
#   ENV_FILE_NAME=.env.staging

DEPLOY_BASE="${DEPLOY_BASE:-/opt/ss-erp}"
DEPLOY_USER="${DEPLOY_USER:-deploy}"
ENV_FILE_NAME="${ENV_FILE_NAME:-.env.staging}"
RELEASES_DIR="$DEPLOY_BASE/releases"
SHARED_DIR="$DEPLOY_BASE/shared"
CURRENT_LINK="$DEPLOY_BASE/current"

echo "[init] Creating release deployment directories"
sudo mkdir -p "$RELEASES_DIR" "$SHARED_DIR/uploads" "$SHARED_DIR/backups"
sudo chown -R "$DEPLOY_USER:$DEPLOY_USER" "$DEPLOY_BASE"

if [ ! -e "$SHARED_DIR/$ENV_FILE_NAME" ]; then
  sudo -u "$DEPLOY_USER" touch "$SHARED_DIR/$ENV_FILE_NAME"
fi

cat <<EOF
[init] Done.

Directories:
  releases: $RELEASES_DIR
  shared:   $SHARED_DIR
  current:  $CURRENT_LINK

Next steps:
  1. Put production env values in $SHARED_DIR/$ENV_FILE_NAME
  2. Install release-mode systemd units:
     DEPLOY_BASE=$DEPLOY_BASE bash scripts/install-release-systemd.sh --restart
  3. Ensure systemd uses EnvironmentFile=$SHARED_DIR/$ENV_FILE_NAME
  4. Deploy with:
     DEPLOY_HOST=<server> DEPLOY_USER=<ssh-user> ./scripts/deploy.sh
EOF

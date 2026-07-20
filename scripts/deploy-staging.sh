#!/usr/bin/env bash
set -euo pipefail

# SS ERP Staging 部署脚本
# 用法: ./scripts/deploy-staging.sh [--skip-build]
# 前提: 服务器已安装 Node 22+, pnpm, PostgreSQL, Redis, Nginx

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ss-erp}"
ENV_FILE="${ENV_FILE:-.env.staging}"
DEPLOY_ENV_PROFILE="${DEPLOY_ENV_PROFILE:-}"
API_SERVICE="${API_SERVICE:-ss-erp-api}"
WEB_SERVICE="${WEB_SERVICE:-ss-erp-web}"
WORKER_SERVICE="${WORKER_SERVICE:-ss-erp-worker}"
SKIP_BUILD=false

for arg in "$@"; do
  case $arg in
    --skip-build) SKIP_BUILD=true ;;
    *)
      echo "ERROR: unknown argument: $arg"
      exit 1
      ;;
  esac
done

cd "$DEPLOY_DIR"

if [ ! -d .git ]; then
  echo "ERROR: $DEPLOY_DIR is not a git checkout"
  exit 1
fi

BRANCH="${DEPLOY_BRANCH:-$(git branch --show-current)}"
BRANCH="${BRANCH:-main}"

if [ ! -f "$ENV_FILE" ]; then
  echo "ERROR: missing env file: $DEPLOY_DIR/$ENV_FILE"
  exit 1
fi

echo "=== SS ERP Staging Deploy ==="
echo "Branch: $BRANCH"
echo "Dir: $DEPLOY_DIR"
echo "Env: $ENV_FILE"
echo "Env profile: ${DEPLOY_ENV_PROFILE:-skip}"
echo ""

# 加载 staging 环境变量，供 prisma migrate 和 next build 使用。
# 注意：env 文件需要保持 shell-compatible，含特殊字符的值请加引号。
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-20m}"
if [[ ! "$MIGRATION_TIMEOUT" =~ ^[1-9][0-9]*[smh]$ ]]; then
  echo "ERROR: MIGRATION_TIMEOUT must be a positive duration ending in s, m, or h" >&2
  exit 1
fi

if [ -n "$DEPLOY_ENV_PROFILE" ]; then
  if [ "$DEPLOY_ENV_PROFILE" = "cloud-r2" ]; then
    echo "[0/7] Validating bootstrap env for profile: $DEPLOY_ENV_PROFILE"
    node scripts/validate-env.mjs --profile cloud-bootstrap --env "$ENV_FILE"
  else
    echo "[0/7] Validating env profile: $DEPLOY_ENV_PROFILE"
    node scripts/validate-env.mjs --profile "$DEPLOY_ENV_PROFILE" --env "$ENV_FILE"
  fi
fi

# 1. 拉取最新代码
echo "[1/7] Pulling latest code..."
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

# 2. 安装依赖
echo "[2/7] Installing dependencies..."
pnpm install --frozen-lockfile

# 3. Prisma Client
echo "[3/7] Generating Prisma client..."
cd apps/server
npx prisma generate
cd "$DEPLOY_DIR"

SERVICES_QUIESCED=0
restore_quiesced_services() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$SERVICES_QUIESCED" = "1" ]; then
    sudo systemctl stop "$WORKER_SERVICE" "$API_SERVICE" || true
    echo "[deploy] Worker/API remain stopped after failed build, migration, or gate; operator recovery is required" >&2
  fi
  exit "$status"
}
trap restore_quiesced_services EXIT

echo "[3b/7] Quiescing AI provider services before in-place build and migration..."
if ! sudo systemctl stop "$WORKER_SERVICE" "$API_SERVICE"; then
  sudo systemctl restart "$WORKER_SERVICE" "$API_SERVICE" || true
  echo "ERROR: could not quiesce Worker/API before build and database migration" >&2
  exit 1
fi
SERVICES_QUIESCED=1

# 4. 构建
if [ "$SKIP_BUILD" = false ]; then
  echo "[4/7] Building server..."
  pnpm --filter server build

  echo "[5/7] Building web..."
  pnpm --filter web build
else
  echo "[4-5/7] Skipping build (--skip-build)"
fi

# 6. 迁移并重启服务
echo "[6b/7] Running database migrations..."
cd apps/server
timeout --signal=TERM --kill-after=30s "$MIGRATION_TIMEOUT" npx prisma migrate deploy
cd "$DEPLOY_DIR"

if [ "$DEPLOY_ENV_PROFILE" = "cloud-r2" ]; then
  echo "[6c/7] Validating runtime upload config..."
  DEPLOY_DIR="$DEPLOY_DIR" \
  ENV_FILE="$ENV_FILE" \
  SKIP_SERVICE_CHECKS=1 \
  SKIP_PROCESS_ENV_CHECKS=1 \
  SKIP_HTTP_CHECK=1 \
  bash scripts/diagnose-runtime-env.sh
fi

echo "[6d/7] Verifying AI Media rollout remains dark..."
if ! DEPLOY_DIR="$DEPLOY_DIR" ENV_FILE="$ENV_FILE" bash scripts/verify-ai-media-dark.sh; then
  SERVICES_QUIESCED=0
  echo "ERROR: AI Media rollout is not dark; Worker/API remain stopped" >&2
  exit 1
fi

echo "[6/7] Restarting services..."
sudo systemctl restart "$WORKER_SERVICE"
sudo systemctl restart "$API_SERVICE"
sudo systemctl restart "$WEB_SERVICE"
SERVICES_QUIESCED=0

# 7. 健康检查
echo "[7/7] Health check..."
sleep 3
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3001/ready || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  echo "API /ready: OK"
else
  echo "API /ready: FAILED (HTTP $HTTP_CODE)"
  echo "Check logs: journalctl -u ss-erp-api -n 50"
  exit 1
fi

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000 || echo "000")
if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ]; then
  echo "Web: OK"
else
  echo "Web: FAILED (HTTP $HTTP_CODE)"
  echo "Check logs: journalctl -u ss-erp-web -n 50"
  exit 1
fi

echo ""
echo "=== Deploy complete ==="

#!/usr/bin/env bash
set -euo pipefail

# SS ERP Staging 部署脚本
# 用法: ./scripts/deploy-staging.sh [--skip-build]
# 前提: 服务器已安装 Node 22+, pnpm, PostgreSQL, Redis, Nginx

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ss-erp}"
ENV_FILE="${ENV_FILE:-.env.staging}"
DEPLOY_ENV_PROFILE="${DEPLOY_ENV_PROFILE:-}"
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

if [ -n "$DEPLOY_ENV_PROFILE" ]; then
  echo "[0/7] Validating env profile: $DEPLOY_ENV_PROFILE"
  node scripts/validate-env.mjs --profile "$DEPLOY_ENV_PROFILE" --env "$ENV_FILE"
fi

# 1. 拉取最新代码
echo "[1/7] Pulling latest code..."
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"

# 2. 安装依赖
echo "[2/7] Installing dependencies..."
pnpm install --frozen-lockfile

# 3. 数据库迁移
echo "[3/7] Running database migrations..."
cd apps/server
npx prisma generate
npx prisma migrate deploy
cd "$DEPLOY_DIR"

# 4. 构建
if [ "$SKIP_BUILD" = false ]; then
  echo "[4/7] Building server..."
  pnpm --filter server build

  echo "[5/7] Building web..."
  pnpm --filter web build
else
  echo "[4-5/7] Skipping build (--skip-build)"
fi

# 6. 重启服务
echo "[6/7] Restarting services..."
sudo systemctl restart ss-erp-worker
sudo systemctl restart ss-erp-api
sudo systemctl restart ss-erp-web

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

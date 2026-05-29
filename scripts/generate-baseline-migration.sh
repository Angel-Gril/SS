#!/bin/bash
# 生成 Prisma baseline migration
# 用途：将当前 schema 状态标记为已应用的基线，让后续 migrate deploy 可以正常工作
#
# 前提：
#   1. 数据库已经通过 db push 同步到最新 schema
#   2. 本地 .env 中 DATABASE_URL 指向目标数据库
#
# 执行步骤：
#   1. 生成基线 migration 目录（不执行 SQL）
#   2. 在目标数据库标记该 migration 为已应用

set -e

MIGRATION_NAME="baseline_$(date +%Y%m%d%H%M%S)"

echo "=== Step 1: 生成基线 migration ==="
cd apps/server
mkdir -p "prisma/migrations/${MIGRATION_NAME}"
npx prisma migrate diff \
  --from-empty \
  --to-schema-datamodel prisma/schema.prisma \
  --script > "prisma/migrations/${MIGRATION_NAME}/migration.sql"

echo ""
echo "=== Step 2: 标记为已应用（在已有数据的生产库上执行） ==="
echo "运行以下命令将基线标记为已应用（不会执行 SQL）："
echo ""
echo "  npx prisma migrate resolve --applied ${MIGRATION_NAME}"
echo ""
echo "=== 完成后 ==="
echo "后续所有 schema 变更必须走 'npx prisma migrate dev'，禁止 db push"
echo "生产部署用 'npx prisma migrate deploy'"

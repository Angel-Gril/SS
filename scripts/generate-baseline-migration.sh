#!/bin/bash
# Prisma Migration 使用指南
#
# === 新环境首次部署（空库）===
# 直接执行所有 migration：
#   cd apps/server
#   npx prisma migrate deploy
#
# === 已有数据的开发库（之前用 db push 同步的）===
# 标记 baseline 为已应用（不执行 SQL，只记录状态）：
#   cd apps/server
#   npx prisma migrate resolve --applied 20260529000000_baseline
#
# === 后续开发流程 ===
# 1. 修改 schema.prisma
# 2. 生成新 migration：
#      npx prisma migrate dev --name describe_your_change
# 3. 检查生成的 SQL 是否合理
# 4. 提交 migration 文件到 Git
#
# === 生产部署 ===
#   npx prisma migrate deploy
#
# === 禁止事项 ===
# - 禁止在生产环境使用 db push
# - 大表加列/加索引必须手写 SQL 使用 CONCURRENTLY
# - 不要手动修改 _prisma_migrations 表

set -e

echo "=== Prisma Migration 状态检查 ==="
cd apps/server
npx prisma migrate status

echo ""
echo "如果显示 'Database schema is up to date'，说明一切正常。"
echo "如果显示 pending migrations，执行: npx prisma migrate deploy"

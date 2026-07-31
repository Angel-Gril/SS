#!/bin/bash
# Prisma Migration 使用指南
#
# === 新环境首次部署（空库）===
# 唯一空库 bootstrap 必须先运行 scripts/verify-empty-bootstrap-database.mjs；见 docs/RUNBOOK.md。
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
# 只使用 docs/deployment.md 中带目标 commit 备份恢复认证的标准部署入口。
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
echo "如果显示 pending migrations，请按 docs/deployment.md 使用标准部署入口；不要裸跑 migrate deploy。"

#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "=== SS ERP 安全扫描 ==="
echo "目录: $ROOT"
echo

FAIL=0

# ─── 1. 依赖漏洞扫描 ───
echo "[1/4] pnpm audit (依赖漏洞)..."
# 本地常用 npmmirror（无 audit 接口），临时切到官方 registry 跑 audit
set +e
pnpm audit --audit-level=high --prod --registry=https://registry.npmjs.org/ > /tmp/ss-erp-audit.log 2>&1
AUDIT_CODE=$?
set -e
cat /tmp/ss-erp-audit.log
if grep -q "ERR_PNPM_AUDIT_ENDPOINT_NOT_EXISTS" /tmp/ss-erp-audit.log; then
  echo "  - registry 不支持 audit 接口，跳过（CI 会用官方 registry 跑）"
elif [ "$AUDIT_CODE" = "0" ]; then
  echo "  ✓ 无 high/critical 依赖漏洞"
else
  echo "  ✗ 发现 high/critical 依赖漏洞，详见 /tmp/ss-erp-audit.log"
  FAIL=1
fi
echo

# ─── 2. 敏感信息扫描 ───
echo "[2/4] 敏感信息扫描 (硬编码密钥/token)..."
PATTERNS=(
  "AKIA[0-9A-Z]{16}"
  "AIza[0-9A-Za-z_-]{35}"
  "sk_live_[0-9a-zA-Z]{24,}"
  "ghp_[0-9a-zA-Z]{36}"
  "BEGIN (RSA |OPENSSH |EC )?PRIVATE KEY"
)
LEAKS=0
for p in "${PATTERNS[@]}"; do
  if git --no-pager grep -E "$p" -- ':!*.lock' ':!pnpm-lock.yaml' ':!docs/**' ':!*.md' 2>/dev/null; then
    echo "  ✗ 发现潜在密钥泄漏: $p"
    LEAKS=1
  fi
done
if [ "$LEAKS" = "0" ]; then
  echo "  ✓ 未发现硬编码密钥"
else
  FAIL=1
fi
echo

# ─── 3. 危险代码模式扫描 ───
echo "[3/4] 危险代码模式扫描..."
DANGEROUS=0
# eval 使用（除测试 + node_modules + dist）
if git --no-pager grep -nE "[^a-zA-Z_](eval|new Function)\(" -- '*.ts' '*.tsx' '*.js' \
    ':!**/__tests__/**' ':!**/*.test.*' ':!**/dist/**' ':!**/node_modules/**' \
    ':!extensions/**' 2>/dev/null | grep -v "eval5"; then
  echo "  ⚠ 发现 eval / new Function 调用（需人工 review）"
  DANGEROUS=1
fi
# child_process exec 拼接（命令注入风险）
if git --no-pager grep -nE "(exec|execSync)\(.*\\\$\{" -- '*.ts' '*.tsx' '*.js' \
    ':!**/__tests__/**' ':!**/dist/**' ':!**/node_modules/**' 2>/dev/null; then
  echo "  ⚠ 发现 exec 字符串拼接（潜在命令注入，应使用 spawn/execFile + args 数组）"
  DANGEROUS=1
fi
if [ "$DANGEROUS" = "0" ]; then
  echo "  ✓ 未发现明显危险代码模式"
fi
echo

# ─── 4. semgrep（可选，需本地安装）───
echo "[4/4] semgrep 静态分析..."
if command -v semgrep &> /dev/null; then
  if semgrep --config=auto --severity=ERROR --error \
      --exclude='node_modules' --exclude='dist' --exclude='.next' \
      --exclude='extensions/**/plugins' --exclude='extensions/**/common' \
      --quiet 2>&1; then
    echo "  ✓ semgrep ERROR 级别无问题"
  else
    echo "  ✗ semgrep 发现 ERROR 级别问题"
    FAIL=1
  fi
else
  echo "  - semgrep 未安装（pip install semgrep 或 brew install semgrep）"
fi
echo

if [ "$FAIL" = "0" ]; then
  echo "=== 扫描通过 ==="
  exit 0
else
  echo "=== 扫描发现问题，请修复后重试 ==="
  exit 1
fi

#!/usr/bin/env bash
# SS ERP 数据库备份脚本
# 用法：直接执行或通过 cron 定时调用
# 依赖：pg_dump, gzip, aws-cli（如需上传 S3）
#
# 环境变量（可写入 /etc/ss-erp-backup.env 或 cron 内 source）：
#   BACKUP_DB_URL          — PostgreSQL 连接串（必填）
#   BACKUP_LOCAL_DIR       — 本地暂存目录（默认 /var/backups/ss-erp）
#   BACKUP_KEEP_DAYS       — 本地保留天数（默认 7）
#   BACKUP_S3_BUCKET       — S3 桶名（留空则不上传）
#   BACKUP_S3_ENDPOINT     — S3 endpoint（阿里云/腾讯云/R2/AWS）
#   BACKUP_S3_ACCESS_KEY_ID / BACKUP_S3_SECRET_ACCESS_KEY — 备份桶凭证
#   BACKUP_S3_PREFIX       — 桶内路径前缀（默认 db/）
#   BACKUP_S3_REGION       — S3 region（默认 auto）

set -euo pipefail
umask 077

BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/var/backups/ss-erp}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-7}"
BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX:-db/}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-auto}"
S3_ENABLED=0
TMP_FILE=""

cleanup() {
  if [ -n "$TMP_FILE" ] && [ -f "$TMP_FILE" ]; then
    rm -f -- "$TMP_FILE"
  fi
}
trap cleanup EXIT

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[backup] ERROR: 缺少依赖命令: $1" >&2
    exit 1
  fi
}

if [ -z "${BACKUP_DB_URL:-}" ]; then
  echo "[backup] ERROR: BACKUP_DB_URL 未设置" >&2
  exit 1
fi

case "$BACKUP_KEEP_DAYS" in
  ''|*[!0-9]*)
    echo "[backup] ERROR: BACKUP_KEEP_DAYS 必须是非负整数" >&2
    exit 1
    ;;
esac

if [ -n "${BACKUP_S3_BUCKET:-}" ] || [ -n "${BACKUP_S3_ENDPOINT:-}" ] || \
   [ -n "${BACKUP_S3_ACCESS_KEY_ID:-}" ] || [ -n "${BACKUP_S3_SECRET_ACCESS_KEY:-}" ]; then
  S3_ENABLED=1
  if [ -z "${BACKUP_S3_BUCKET:-}" ] || [ -z "${BACKUP_S3_ENDPOINT:-}" ] || \
     [ -z "${BACKUP_S3_ACCESS_KEY_ID:-}" ] || [ -z "${BACKUP_S3_SECRET_ACCESS_KEY:-}" ]; then
    echo "[backup] ERROR: S3 上传已启用但 BACKUP_S3_BUCKET/ENDPOINT/ACCESS_KEY/SECRET 未填完整" >&2
    exit 1
  fi
  require_command aws
fi

require_command pg_dump
require_command gzip

case "$BACKUP_S3_PREFIX" in
  '') ;;
  */) ;;
  *) BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX}/" ;;
esac

mkdir -p "$BACKUP_LOCAL_DIR"

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="ss_erp_${TIMESTAMP}.sql.gz"
FILEPATH="${BACKUP_LOCAL_DIR}/${FILENAME}"
TMP_FILE="${FILEPATH}.tmp.$$"

echo "[backup] $(date '+%F %T') 开始备份..."

pg_dump --dbname="$BACKUP_DB_URL" --clean --if-exists --no-owner --no-privileges | gzip -c > "$TMP_FILE"
mv -f -- "$TMP_FILE" "$FILEPATH"
TMP_FILE=""

SIZE=$(du -h "$FILEPATH" | cut -f1)
echo "[backup] 本地备份完成: ${FILEPATH} (${SIZE})"

# 上传到 S3 兼容存储
if [ "$S3_ENABLED" -eq 1 ]; then
  export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID}"
  export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY}"
  S3_KEY="${BACKUP_S3_PREFIX}${FILENAME}"
  echo "[backup] 上传到 s3://${BACKUP_S3_BUCKET}/${S3_KEY} ..."

  aws s3 cp "$FILEPATH" "s3://${BACKUP_S3_BUCKET}/${S3_KEY}" \
    --endpoint-url "$BACKUP_S3_ENDPOINT" \
    --region "$BACKUP_S3_REGION" \
    --only-show-errors

  echo "[backup] S3 上传完成"
fi

# 清理本地旧备份
DELETED=$(find "$BACKUP_LOCAL_DIR" -maxdepth 1 -type f -name "ss_erp_*.sql.gz" -mtime +"$BACKUP_KEEP_DAYS" -print -delete | wc -l | tr -d '[:space:]')
if [ "$DELETED" -gt 0 ]; then
  echo "[backup] 已清理 ${DELETED} 个超过 ${BACKUP_KEEP_DAYS} 天的旧备份"
fi

echo "[backup] $(date '+%F %T') 完成"

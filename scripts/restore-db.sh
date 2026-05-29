#!/usr/bin/env bash
# SS ERP 数据库恢复脚本
# 用法：
#   bash scripts/restore-db.sh                     — 列出本地可用备份
#   bash scripts/restore-db.sh <filename>          — 从本地备份恢复
#   bash scripts/restore-db.sh --from-s3 <s3-key>  — 从 S3 下载后恢复
#
# 环境变量（同 backup-db.sh）：
#   BACKUP_DB_URL / BACKUP_LOCAL_DIR / BACKUP_S3_*

set -euo pipefail
umask 077

BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/var/backups/ss-erp}"
BACKUP_S3_REGION="${BACKUP_S3_REGION:-auto}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[restore] ERROR: 缺少依赖命令: $1" >&2
    exit 1
  fi
}

validate_backup_filename() {
  case "$1" in
    ss_erp_*.sql.gz) ;;
    *)
      echo "[restore] ERROR: 备份文件名必须匹配 ss_erp_*.sql.gz" >&2
      exit 1
      ;;
  esac
}

mask_db_url() {
  printf '%s' "$BACKUP_DB_URL" | sed -E 's#(postgres(ql)?://)[^/@:]+(:[^/@]*)?@#\1***:***@#'
}

# 列出本地备份
if [ $# -eq 0 ]; then
  echo "[restore] 本地可用备份（${BACKUP_LOCAL_DIR}）："
  ls -lh "$BACKUP_LOCAL_DIR"/ss_erp_*.sql.gz 2>/dev/null || echo "  （无备份文件）"
  echo ""
  echo "用法："
  echo "  $0 <filename>            从本地恢复"
  echo "  $0 --from-s3 <s3-key>    从 S3 下载后恢复"
  exit 0
fi

if [ -z "${BACKUP_DB_URL:-}" ]; then
  echo "[restore] ERROR: BACKUP_DB_URL 未设置" >&2
  exit 1
fi

require_command gunzip
require_command psql

# 从 S3 下载
if [ "${1:-}" = "--from-s3" ]; then
  S3_KEY="${2:-}"
  if [ -z "$S3_KEY" ]; then
    echo "[restore] ERROR: 请指定 S3 key" >&2
    exit 1
  fi
  if [ -z "${BACKUP_S3_BUCKET:-}" ] || [ -z "${BACKUP_S3_ENDPOINT:-}" ] || \
     [ -z "${BACKUP_S3_ACCESS_KEY_ID:-}" ] || [ -z "${BACKUP_S3_SECRET_ACCESS_KEY:-}" ]; then
    echo "[restore] ERROR: 从 S3 恢复需要 BACKUP_S3_BUCKET/ENDPOINT/ACCESS_KEY/SECRET" >&2
    exit 1
  fi
  require_command aws

  export AWS_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID}"
  export AWS_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY}"
  FILENAME=$(basename "$S3_KEY")
  validate_backup_filename "$FILENAME"
  mkdir -p "$BACKUP_LOCAL_DIR"
  FILEPATH="${BACKUP_LOCAL_DIR}/${FILENAME}"

  echo "[restore] 从 S3 下载: s3://${BACKUP_S3_BUCKET}/${S3_KEY} ..."
  aws s3 cp "s3://${BACKUP_S3_BUCKET}/${S3_KEY}" "$FILEPATH" \
    --endpoint-url "${BACKUP_S3_ENDPOINT}" \
    --region "$BACKUP_S3_REGION" \
    --only-show-errors

  echo "[restore] 下载完成: ${FILEPATH}"
else
  FILENAME=$(basename "$1")
  if [ "$1" != "$FILENAME" ]; then
    echo "[restore] ERROR: 本地恢复只接受备份文件名，不接受路径" >&2
    exit 1
  fi
  validate_backup_filename "$FILENAME"
  FILEPATH="${BACKUP_LOCAL_DIR}/${FILENAME}"
fi

if [ ! -f "$FILEPATH" ]; then
  echo "[restore] ERROR: 文件不存在: ${FILEPATH}" >&2
  exit 1
fi

echo ""
echo "=========================================="
echo "  即将恢复数据库！当前数据将被覆盖！"
echo "  备份文件: ${FILENAME}"
echo "  目标库:   $(mask_db_url)"
echo "  请先停止 API/worker，避免恢复过程中继续写库。"
echo "=========================================="
echo ""
read -r -p "确认恢复？(输入 yes 继续): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "[restore] 已取消"
  exit 0
fi
read -r -p "再次输入备份文件名确认 (${FILENAME}): " CONFIRM_FILE
if [ "$CONFIRM_FILE" != "$FILENAME" ]; then
  echo "[restore] 已取消：文件名不匹配"
  exit 0
fi

echo "[restore] $(date '+%F %T') 开始恢复..."
gunzip -c "$FILEPATH" | psql --dbname="$BACKUP_DB_URL" --quiet --single-transaction -v ON_ERROR_STOP=1
echo "[restore] $(date '+%F %T') 恢复完成"

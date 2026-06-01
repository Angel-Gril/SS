#!/usr/bin/env bash
# SS ERP 备份恢复演练脚本（无损）
# 用法：
#   . /etc/ss-erp-backup.env
#   bash scripts/verify-backup-restore.sh [backup-file]
#
# 行为：
#   1. 选择指定备份，或 backup-status.json 中的 lastLocalFile，或最新本地备份
#   2. 创建临时数据库
#   3. 将备份恢复到临时库
#   4. 检查 public schema 中存在表
#   5. 删除临时数据库
#
# 可选环境变量：
#   BACKUP_DB_URL                  — 原始数据库连接串（必填）
#   BACKUP_LOCAL_DIR               — 备份目录（默认 /var/backups/ss-erp）
#   VERIFY_RESTORE_MAINTENANCE_URL — 用于 createdb/dropdb 的维护库连接串（默认将 BACKUP_DB_URL 的库名替换为 postgres）
#   VERIFY_RESTORE_TEMP_DB         — 指定临时库名（默认 ss_erp_restore_check_<timestamp>_<pid>）
#   VERIFY_RESTORE_LOCAL_POSTGRES  — 设为 1 时使用 sudo -u postgres 创建/删除临时库，并将 owner 设为 BACKUP_DB_URL 用户

set -euo pipefail
umask 077

BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/var/backups/ss-erp}"
TEMP_DB="${VERIFY_RESTORE_TEMP_DB:-ss_erp_restore_check_$(date +%Y%m%d_%H%M%S)_$$}"
CREATED=0

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[verify-restore] ERROR: 缺少依赖命令: $1" >&2
    exit 1
  fi
}

validate_backup_filename() {
  case "$1" in
    ss_erp_*.sql.gz) ;;
    *)
      echo "[verify-restore] ERROR: 备份文件名必须匹配 ss_erp_*.sql.gz" >&2
      exit 1
      ;;
  esac
}

url_for_db() {
  node -e '
const input = process.argv[1];
const db = process.argv[2];
const url = new URL(input);
url.pathname = "/" + db;
url.search = "";
console.log(url.toString());
' "$1" "$2"
}

current_db_name() {
  node -e '
const url = new URL(process.argv[1]);
console.log(decodeURIComponent(url.pathname.replace(/^\//, "")));
' "$1"
}

db_user_name() {
  node -e '
const url = new URL(process.argv[1]);
console.log(decodeURIComponent(url.username || ""));
' "$1"
}

select_backup_file() {
  if [ $# -gt 0 ]; then
    local filename
    filename=$(basename "$1")
    if [ "$1" != "$filename" ]; then
      echo "[verify-restore] ERROR: 只接受备份文件名，不接受路径" >&2
      exit 1
    fi
    validate_backup_filename "$filename"
    echo "$filename"
    return
  fi

  local status_file="${BACKUP_LOCAL_DIR}/backup-status.json"
  if [ -f "$status_file" ]; then
    local from_status
    from_status=$(node -e '
const fs = require("fs");
try {
  const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (data.lastLocalFile) process.stdout.write(String(data.lastLocalFile));
} catch {}
' "$status_file")
    if [ -n "$from_status" ]; then
      validate_backup_filename "$from_status"
      echo "$from_status"
      return
    fi
  fi

  local latest
  latest=$(find "$BACKUP_LOCAL_DIR" -maxdepth 1 -type f -name 'ss_erp_*.sql.gz' -printf '%T@ %f\n' 2>/dev/null | sort -nr | awk 'NR==1 {print $2}')
  if [ -z "$latest" ]; then
    echo "[verify-restore] ERROR: 未找到本地备份文件: ${BACKUP_LOCAL_DIR}/ss_erp_*.sql.gz" >&2
    exit 1
  fi
  validate_backup_filename "$latest"
  echo "$latest"
}

cleanup() {
  if [ "$CREATED" -eq 1 ]; then
    echo "[verify-restore] 清理临时库: ${TEMP_DB}"
    if [ "${VERIFY_RESTORE_LOCAL_POSTGRES:-0}" = "1" ]; then
      sudo -u postgres dropdb --if-exists --force "$TEMP_DB" >/dev/null 2>&1 || true
    else
      dropdb --if-exists --force --maintenance-db="$MAINTENANCE_URL" "$TEMP_DB" >/dev/null 2>&1 || true
    fi
  fi
}
trap cleanup EXIT

if [ -z "${BACKUP_DB_URL:-}" ]; then
  echo "[verify-restore] ERROR: BACKUP_DB_URL 未设置" >&2
  exit 1
fi

require_command node
require_command createdb
require_command dropdb
require_command gunzip
require_command psql

SOURCE_DB=$(current_db_name "$BACKUP_DB_URL")
SOURCE_USER=$(db_user_name "$BACKUP_DB_URL")
if [ -z "$SOURCE_DB" ]; then
  echo "[verify-restore] ERROR: 无法从 BACKUP_DB_URL 解析数据库名" >&2
  exit 1
fi

if [ "$TEMP_DB" = "$SOURCE_DB" ] || [ "$TEMP_DB" = "postgres" ] || [ "$TEMP_DB" = "template1" ] || [ "$TEMP_DB" = "template0" ]; then
  echo "[verify-restore] ERROR: 临时库名不安全: ${TEMP_DB}" >&2
  exit 1
fi

MAINTENANCE_URL="${VERIFY_RESTORE_MAINTENANCE_URL:-$(url_for_db "$BACKUP_DB_URL" postgres)}"
TEMP_DB_URL=$(url_for_db "$BACKUP_DB_URL" "$TEMP_DB")
FILENAME=$(select_backup_file "$@")
FILEPATH="${BACKUP_LOCAL_DIR}/${FILENAME}"

if [ ! -f "$FILEPATH" ]; then
  echo "[verify-restore] ERROR: 文件不存在: ${FILEPATH}" >&2
  exit 1
fi

echo "[verify-restore] $(date '+%F %T') 开始恢复演练"
echo "[verify-restore] 备份文件: ${FILENAME}"
echo "[verify-restore] 临时库: ${TEMP_DB}"

if [ "${VERIFY_RESTORE_LOCAL_POSTGRES:-0}" = "1" ]; then
  if [ -z "$SOURCE_USER" ]; then
    echo "[verify-restore] ERROR: VERIFY_RESTORE_LOCAL_POSTGRES=1 需要 BACKUP_DB_URL 包含用户名" >&2
    exit 1
  fi
  require_command sudo
  sudo -u postgres createdb -O "$SOURCE_USER" "$TEMP_DB"
else
  CREATEDB_LOG=$(mktemp)
  if ! createdb --maintenance-db="$MAINTENANCE_URL" "$TEMP_DB" 2>"$CREATEDB_LOG"; then
    cat "$CREATEDB_LOG" >&2
    if grep -qi 'permission denied to create database' "$CREATEDB_LOG"; then
      echo "[verify-restore] ERROR: 当前数据库账号没有 CREATEDB 权限。" >&2
      echo "[verify-restore] 如果 PostgreSQL 在本机，请改用：" >&2
      echo "[verify-restore]   VERIFY_RESTORE_LOCAL_POSTGRES=1 bash scripts/verify-backup-restore.sh" >&2
    fi
    rm -f "$CREATEDB_LOG"
    exit 1
  fi
  rm -f "$CREATEDB_LOG"
fi
CREATED=1

gunzip -c "$FILEPATH" | psql --dbname="$TEMP_DB_URL" --quiet --single-transaction -v ON_ERROR_STOP=1

TABLE_COUNT=$(psql --dbname="$TEMP_DB_URL" --tuples-only --no-align -v ON_ERROR_STOP=1 \
  -c "select count(*) from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE';" | tr -d '[:space:]')

case "$TABLE_COUNT" in
  ''|*[!0-9]*)
    echo "[verify-restore] ERROR: 无法读取恢复后表数量: ${TABLE_COUNT}" >&2
    exit 1
    ;;
esac

if [ "$TABLE_COUNT" -le 0 ]; then
  echo "[verify-restore] ERROR: 恢复后 public schema 中没有表" >&2
  exit 1
fi

echo "[verify-restore] 恢复演练通过，public 表数量: ${TABLE_COUNT}"
echo "[verify-restore] $(date '+%F %T') 完成"

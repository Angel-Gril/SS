#!/usr/bin/env bash
# SS ERP 备份恢复演练脚本（无损）
# 用法：
#   . /etc/ss-erp-backup.env
#   bash scripts/verify-backup-restore.sh [backup-file]
#
# 行为：
#   1. 只选择 backup-status.json 中的 lastLocalFile；显式文件名也必须与它完全一致
#   2. 创建临时数据库
#   3. 将备份恢复到临时库
#   4. 检查 public schema 中存在表
#   5. 删除临时数据库
#   6. 只有以上步骤全部成功时才写目标 commit/database 绑定的部署认证
#
# 可选环境变量：
#   BACKUP_DB_URL                  — 原始数据库连接串（必填）
#   DATABASE_URL                   — migration 使用的数据库连接串（必填，身份必须相同）
#   BACKUP_LOCAL_DIR               — 备份目录（默认 /var/backups/ss-erp）
#   DEPLOY_DATABASE_ID             — 稳定的部署数据库标识（必填）
#   BACKUP_TARGET_GIT_COMMIT       — 本次恢复认证绑定的完整目标提交（必填）
#   DEPLOY_BACKUP_ATTESTATION_FILE — 可选；必须等于 commit 绑定的默认认证路径
#   VERIFY_RESTORE_MAINTENANCE_URL — 用于 createdb/dropdb 的维护库连接串（默认将 BACKUP_DB_URL 的库名替换为 postgres）
#   VERIFY_RESTORE_TEMP_DB         — 指定临时库名（默认 ss_erp_restore_check_<timestamp>_<pid>）
#   VERIFY_RESTORE_LOCAL_POSTGRES  — 设为 1 时使用 sudo -u postgres 创建/删除临时库，并将 owner 设为 BACKUP_DB_URL 用户

set -euo pipefail
umask 077

BACKUP_LOCAL_DIR="${BACKUP_LOCAL_DIR:-/var/backups/ss-erp}"
TEMP_DB="${VERIFY_RESTORE_TEMP_DB:-ss_erp_restore_check_$(date +%Y%m%d_%H%M%S)_$$}"
CREATED=0
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
RESTORE_PROOF_FILE=""
RESTORE_ROUTE_MARKER=""
RESTORE_ROUTE_SCHEMA=""
RESTORE_ROUTE_TABLE=""

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "[verify-restore] ERROR: 缺少依赖命令: $1" >&2
    exit 1
  fi
}

run_postgres_url() {
  local url="$1"
  local command="$2"
  shift 2
  SS_ERP_POSTGRES_URL="$url" node "$SCRIPT_DIR/run-postgres-command.mjs" \
    --url-env SS_ERP_POSTGRES_URL --command "$command" -- "$@"
}

validate_backup_filename() {
  if [[ ! "$1" =~ ^ss_erp_[a-zA-Z0-9][a-zA-Z0-9._-]{0,180}\.sql\.gz$ ]]; then
    echo "[verify-restore] ERROR: 备份文件名必须是规范的 ss_erp_*.sql.gz" >&2
    exit 1
  fi
}

url_for_db() {
  DEPLOY_DATABASE_URL_INPUT="$1" DEPLOY_DATABASE_NAME_INPUT="$2" node -e '
const input = process.env.DEPLOY_DATABASE_URL_INPUT;
const db = process.env.DEPLOY_DATABASE_NAME_INPUT;
const url = new URL(input);
url.pathname = "/" + encodeURIComponent(db);
for (const name of ["connection_limit", "pool_timeout", "schema", "socket_timeout", "pgbouncer"]) {
  url.searchParams.delete(name);
}
console.log(url.toString());
'
}

current_db_name() {
  DEPLOY_DATABASE_URL_INPUT="$1" node -e '
const url = new URL(process.env.DEPLOY_DATABASE_URL_INPUT);
console.log(decodeURIComponent(url.pathname.replace(/^\//, "")));
'
}

db_user_name() {
  DEPLOY_DATABASE_URL_INPUT="$1" node -e '
const url = new URL(process.env.DEPLOY_DATABASE_URL_INPUT);
console.log(decodeURIComponent(url.username || ""));
'
}

select_backup_file() {
  local status_file="${BACKUP_LOCAL_DIR}/backup-status.json"
  if [ ! -f "$status_file" ]; then
    echo "[verify-restore] ERROR: 缺少备份状态文件: $status_file" >&2
    exit 1
  fi
  local from_status
  if ! from_status=$(node -e '
const fs = require("fs");
const data = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
if (data.schemaVersion !== 3 || typeof data.lastLocalFile !== "string") process.exit(1);
process.stdout.write(data.lastLocalFile);
' "$status_file")
  then
    echo "[verify-restore] ERROR: backup-status.json 不是可用的 schema v3 状态" >&2
    exit 1
  fi
  validate_backup_filename "$from_status"

  if [ $# -gt 0 ]; then
    local filename
    filename=$(basename "$1")
    if [ "$1" != "$filename" ] || [ "$filename" != "$from_status" ]; then
      echo "[verify-restore] ERROR: 显式备份文件必须与 backup-status.json 完全一致" >&2
      exit 1
    fi
  fi
  echo "$from_status"
}

verify_restore_route_marker() {
  local marker_output
  local observed_marker
  if ! marker_output="$(
    run_postgres_url "$TEMP_DB_URL" psql --no-psqlrc --tuples-only --no-align \
      -v ON_ERROR_STOP=1 \
      -v "restore_route_schema=$RESTORE_ROUTE_SCHEMA" \
      -v "restore_route_table=$RESTORE_ROUTE_TABLE" <<'SQL'
SELECT marker FROM :"restore_route_schema".:"restore_route_table";
SQL
  )"; then
    echo "[verify-restore] ERROR: 维护路由与恢复路由未指向同一临时数据库" >&2
    return 1
  fi
  observed_marker="$(printf '%s' "$marker_output" | tr -d '[:space:]')"
  if [ "$observed_marker" != "$RESTORE_ROUTE_MARKER" ]; then
    echo "[verify-restore] ERROR: 维护路由与恢复路由未指向同一临时数据库" >&2
    return 1
  fi
}

write_restore_route_marker() {
  if [ "${VERIFY_RESTORE_LOCAL_POSTGRES:-0}" = "1" ]; then
    sudo -u postgres psql --dbname="$TEMP_DB" --no-psqlrc --quiet --single-transaction \
      -v ON_ERROR_STOP=1 \
      -v "restore_route_schema=$RESTORE_ROUTE_SCHEMA" \
      -v "restore_route_table=$RESTORE_ROUTE_TABLE" \
      -v "restore_route_marker=$RESTORE_ROUTE_MARKER"
  else
    run_postgres_url "$MAINTENANCE_TEMP_DB_URL" psql --no-psqlrc --quiet --single-transaction \
      -v ON_ERROR_STOP=1 \
      -v "restore_route_schema=$RESTORE_ROUTE_SCHEMA" \
      -v "restore_route_table=$RESTORE_ROUTE_TABLE" \
      -v "restore_route_marker=$RESTORE_ROUTE_MARKER"
  fi
}

drop_temp_database() {
  if [ "$CREATED" -eq 1 ]; then
    echo "[verify-restore] 清理临时库: ${TEMP_DB}"
    if [ "${VERIFY_RESTORE_LOCAL_POSTGRES:-0}" = "1" ]; then
      sudo -u postgres dropdb --force -- "$TEMP_DB" >/dev/null 2>&1 || return 1
    else
      run_postgres_url "$MAINTENANCE_URL" dropdb --force -- "$TEMP_DB" \
        >/dev/null 2>&1 || return 1
    fi
    CREATED=0
  fi
  return 0
}

cleanup() {
  if ! drop_temp_database; then
    echo "[verify-restore] ERROR: 无法清理临时恢复数据库: ${TEMP_DB}" >&2
  fi
  if [ -n "$RESTORE_PROOF_FILE" ]; then
    rm -f -- "$RESTORE_PROOF_FILE" || true
  fi
}
trap cleanup EXIT

if [ -z "${BACKUP_DB_URL:-}" ]; then
  echo "[verify-restore] ERROR: BACKUP_DB_URL 未设置" >&2
  exit 1
fi
if [ -z "${DATABASE_URL:-}" ]; then
  echo "[verify-restore] ERROR: DATABASE_URL 未设置，无法绑定 migration 数据库身份" >&2
  exit 1
fi
if [[ ! "${DEPLOY_DATABASE_ID:-}" =~ ^[a-z0-9][a-z0-9._-]{0,127}$ ]]; then
  echo "[verify-restore] ERROR: DEPLOY_DATABASE_ID 必须是规范的部署数据库标识" >&2
  exit 1
fi
if [[ ! "${BACKUP_TARGET_GIT_COMMIT:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[verify-restore] ERROR: BACKUP_TARGET_GIT_COMMIT 必须是小写完整 40 位 Git object ID" >&2
  exit 1
fi
if [ -n "${DEPLOY_BACKUP_ATTESTATION_TEST_NOW:-}" ]; then
  echo "[verify-restore] ERROR: DEPLOY_BACKUP_ATTESTATION_TEST_NOW 禁止用于恢复演练" >&2
  exit 1
fi
if [[ ! "$TEMP_DB" =~ ^ss_erp_restore_check_[a-z0-9_]{1,40}$ ]]; then
  echo "[verify-restore] ERROR: 临时库名必须使用安全的 ss_erp_restore_check_ 前缀" >&2
  exit 1
fi

EXPECTED_ATTESTATION="${BACKUP_LOCAL_DIR}/deploy-backup-${BACKUP_TARGET_GIT_COMMIT}.attestation.json"
ATTESTATION_FILE="${DEPLOY_BACKUP_ATTESTATION_FILE:-$EXPECTED_ATTESTATION}"
if [ "$ATTESTATION_FILE" != "$EXPECTED_ATTESTATION" ]; then
  echo "[verify-restore] ERROR: DEPLOY_BACKUP_ATTESTATION_FILE 必须精确等于 $EXPECTED_ATTESTATION" >&2
  exit 1
fi

require_command node
require_command createdb
require_command dropdb
require_command psql
if [ ! -f "$SCRIPT_DIR/run-postgres-command.mjs" ]; then
  echo "[verify-restore] ERROR: 缺少受控 PostgreSQL CLI wrapper" >&2
  exit 1
fi

BACKUP_DATABASE_BINDING="$(DEPLOY_DATABASE_ID="$DEPLOY_DATABASE_ID" \
  DEPLOY_DATABASE_URL="$BACKUP_DB_URL" \
  node "$SCRIPT_DIR/deploy-database-identity.mjs" --backup-binding)"
MIGRATION_DATABASE_BINDING="$(DEPLOY_DATABASE_ID="$DEPLOY_DATABASE_ID" \
  DEPLOY_DATABASE_URL="$DATABASE_URL" \
  node "$SCRIPT_DIR/deploy-database-identity.mjs" --backup-binding)"
IFS=$'\t' read -r BACKUP_DATABASE_IDENTITY_SHA256 BACKUP_DATABASE_UUID_SHA256 \
  <<< "$BACKUP_DATABASE_BINDING"
IFS=$'\t' read -r MIGRATION_DATABASE_IDENTITY_SHA256 MIGRATION_DATABASE_UUID_SHA256 \
  <<< "$MIGRATION_DATABASE_BINDING"
if [[ ! "$BACKUP_DATABASE_IDENTITY_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || [[ ! "$BACKUP_DATABASE_UUID_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || [ "$BACKUP_DATABASE_IDENTITY_SHA256" != "$MIGRATION_DATABASE_IDENTITY_SHA256" ] \
  || [ "$BACKUP_DATABASE_UUID_SHA256" != "$MIGRATION_DATABASE_UUID_SHA256" ]; then
  echo "[verify-restore] ERROR: 备份与 migration 数据库身份不一致" >&2
  exit 1
fi

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
MAINTENANCE_TEMP_DB_URL="$(url_for_db "$MAINTENANCE_URL" "$TEMP_DB")"
TEMP_DB_URL="$(url_for_db "$BACKUP_DB_URL" "$TEMP_DB")"
FILENAME=$(select_backup_file "$@")
FILEPATH="${BACKUP_LOCAL_DIR}/${FILENAME}"
STATUS_EVIDENCE_FILE="${FILEPATH}.status.json"

if [ ! -f "$FILEPATH" ]; then
  echo "[verify-restore] ERROR: 文件不存在: ${FILEPATH}" >&2
  exit 1
fi
if [ ! -f "$STATUS_EVIDENCE_FILE" ]; then
  echo "[verify-restore] ERROR: 缺少备份状态 sidecar: ${STATUS_EVIDENCE_FILE}" >&2
  exit 1
fi

echo "[verify-restore] $(date '+%F %T') 开始恢复演练"
echo "[verify-restore] 备份文件: ${FILENAME}"
echo "[verify-restore] 临时库: ${TEMP_DB}"
RESTORE_STARTED_AT="$(node -e 'process.stdout.write(new Date().toISOString())')"
RESTORE_PROOF_NONCE="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(12).toString("hex"))')"
RESTORE_PROOF_FILE="${BACKUP_LOCAL_DIR}/deploy-backup-${BACKUP_TARGET_GIT_COMMIT}.restore-proof-${RESTORE_PROOF_NONCE}.json"
RESTORE_ROUTE_NONCE="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
RESTORE_ROUTE_MARKER="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
if [[ ! "$RESTORE_ROUTE_NONCE" =~ ^[0-9a-f]{64}$ ]] \
  || [[ ! "$RESTORE_ROUTE_MARKER" =~ ^[0-9a-f]{64}$ ]]; then
  echo "[verify-restore] ERROR: 无法生成临时数据库路由标记" >&2
  exit 1
fi
RESTORE_ROUTE_SCHEMA="ss_erp_restore_route_${RESTORE_ROUTE_NONCE:0:32}"
RESTORE_ROUTE_TABLE="marker_${RESTORE_ROUTE_NONCE:32:32}"

if [ "${VERIFY_RESTORE_LOCAL_POSTGRES:-0}" = "1" ]; then
  if [ -z "$SOURCE_USER" ]; then
    echo "[verify-restore] ERROR: VERIFY_RESTORE_LOCAL_POSTGRES=1 需要 BACKUP_DB_URL 包含用户名" >&2
    exit 1
  fi
  require_command sudo
  sudo -u postgres createdb -O "$SOURCE_USER" -- "$TEMP_DB"
else
  CREATEDB_LOG=$(mktemp)
  if ! run_postgres_url "$MAINTENANCE_URL" createdb -- "$TEMP_DB" 2>"$CREATEDB_LOG"; then
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

if ! write_restore_route_marker >/dev/null <<'SQL'
CREATE SCHEMA :"restore_route_schema";
CREATE TABLE :"restore_route_schema".:"restore_route_table" (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  marker text NOT NULL CHECK (marker ~ '^[0-9a-f]{64}$')
);
INSERT INTO :"restore_route_schema".:"restore_route_table" (marker)
VALUES (:'restore_route_marker');
GRANT USAGE ON SCHEMA :"restore_route_schema" TO PUBLIC;
GRANT SELECT ON :"restore_route_schema".:"restore_route_table" TO PUBLIC;
SQL
then
  echo "[verify-restore] ERROR: 无法在维护路由创建临时数据库路由标记" >&2
  exit 1
fi

CONNECTED_TEMP_DB="$(run_postgres_url "$TEMP_DB_URL" psql --no-psqlrc --tuples-only --no-align \
  -v ON_ERROR_STOP=1 -c 'select current_database();' | tr -d '[:space:]')"
if [ "$CONNECTED_TEMP_DB" != "$TEMP_DB" ]; then
  echo "[verify-restore] ERROR: 临时连接解析到了非预期数据库" >&2
  exit 1
fi
verify_restore_route_marker

node "$SCRIPT_DIR/deploy-backup-attestation.mjs" restore-stream \
  --backup-dir "$BACKUP_LOCAL_DIR" \
  --backup-status "$STATUS_EVIDENCE_FILE" \
  --restore-proof "$RESTORE_PROOF_FILE" \
  --expected-database-id "$DEPLOY_DATABASE_ID" \
  --expected-database-identity-sha256 "$MIGRATION_DATABASE_IDENTITY_SHA256" \
  --expected-database-uuid-sha256 "$MIGRATION_DATABASE_UUID_SHA256" \
  --expected-target-git-commit "$BACKUP_TARGET_GIT_COMMIT" \
  --restore-started-at "$RESTORE_STARTED_AT" \
  | run_postgres_url "$TEMP_DB_URL" psql --no-psqlrc --quiet --single-transaction -v ON_ERROR_STOP=1

RESTORED_DATABASE_BINDING="$(DEPLOY_DATABASE_ID="$DEPLOY_DATABASE_ID" \
  DEPLOY_DATABASE_URL="$TEMP_DB_URL" \
  node "$SCRIPT_DIR/deploy-database-identity.mjs" --backup-binding)"
IFS=$'\t' read -r RESTORED_DATABASE_IDENTITY_SHA256 RESTORED_DATABASE_UUID_SHA256 \
  <<< "$RESTORED_DATABASE_BINDING"
if [[ ! "$RESTORED_DATABASE_IDENTITY_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || [ "$RESTORED_DATABASE_UUID_SHA256" != "$BACKUP_DATABASE_UUID_SHA256" ]; then
  echo "[verify-restore] ERROR: 恢复备份中的数据库 UUID 与备份前身份不一致" >&2
  exit 1
fi

TABLE_COUNT=$(run_postgres_url "$TEMP_DB_URL" psql --no-psqlrc --tuples-only --no-align -v ON_ERROR_STOP=1 \
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

verify_restore_route_marker

if ! drop_temp_database; then
  echo "[verify-restore] ERROR: 恢复成功但无法删除临时数据库；不生成部署认证" >&2
  exit 1
fi

RESTORE_COMPLETED_AT="$(node -e '
const startedAt = Date.parse(process.argv[1]);
process.stdout.write(new Date(Math.max(Date.now(), startedAt + 1)).toISOString());
' "$RESTORE_STARTED_AT")"
if [ -e "$ATTESTATION_FILE" ] || [ -L "$ATTESTATION_FILE" ]; then
  if [ "$(id -u)" != "0" ]; then
    echo "[verify-restore] ERROR: 刷新同一 commit 的部署认证必须由 root 执行" >&2
    exit 1
  fi
  node "$SCRIPT_DIR/deploy-backup-attestation.mjs" archive \
    --backup-dir "$BACKUP_LOCAL_DIR" \
    --attestation "$ATTESTATION_FILE" \
    --expected-database-id "$DEPLOY_DATABASE_ID" \
    --expected-database-identity-sha256 "$MIGRATION_DATABASE_IDENTITY_SHA256" \
    --expected-database-uuid-sha256 "$MIGRATION_DATABASE_UUID_SHA256" \
    --expected-target-git-commit "$BACKUP_TARGET_GIT_COMMIT"
fi
node "$SCRIPT_DIR/deploy-backup-attestation.mjs" record \
  --backup-dir "$BACKUP_LOCAL_DIR" \
  --backup-status "$STATUS_EVIDENCE_FILE" \
  --output "$ATTESTATION_FILE" \
  --expected-database-id "$DEPLOY_DATABASE_ID" \
  --expected-database-identity-sha256 "$MIGRATION_DATABASE_IDENTITY_SHA256" \
  --expected-database-uuid-sha256 "$MIGRATION_DATABASE_UUID_SHA256" \
  --expected-target-git-commit "$BACKUP_TARGET_GIT_COMMIT" \
  --restore-proof "$RESTORE_PROOF_FILE" \
  --restore-started-at "$RESTORE_STARTED_AT" \
  --restore-completed-at "$RESTORE_COMPLETED_AT" \
  --table-count "$TABLE_COUNT"

rm -f -- "$RESTORE_PROOF_FILE"
RESTORE_PROOF_FILE=""

echo "[verify-restore] 恢复演练通过，public 表数量: ${TABLE_COUNT}"
echo "[verify-restore] 部署备份认证: ${ATTESTATION_FILE}"
echo "[verify-restore] $(date '+%F %T') 完成"

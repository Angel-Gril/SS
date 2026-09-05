#!/usr/bin/env bash
# SS ERP 数据库备份脚本
# 用法：直接执行或通过 cron 定时调用
# 依赖：node, psql, pg_dump, gzip, aws-cli（如需上传 S3）
#
# 环境变量（可写入 /etc/ss-erp-backup.env 或 cron 内 source）：
#   BACKUP_DB_URL          — PostgreSQL 连接串（必填）
#   DEPLOY_DATABASE_ID      — 稳定的部署数据库标识（必填）
#   BACKUP_TARGET_GIT_COMMIT — 本次备份绑定的完整目标提交；未设置时读取 marker
#   BACKUP_DEPLOYED_COMMIT_FILE — marker 路径（默认 /opt/ss-erp/app/DEPLOYED_COMMIT）
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
BACKUP_STATUS_GROUP="${BACKUP_STATUS_GROUP:-deploy}"
BACKUP_DEPLOYED_COMMIT_FILE="${BACKUP_DEPLOYED_COMMIT_FILE:-/opt/ss-erp/app/DEPLOYED_COMMIT}"
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
S3_ENABLED=0
TMP_FILE=""
STATUS_TMP=""
LATEST_STATUS_TMP=""

cleanup() {
  if [ -n "$TMP_FILE" ] && [ -f "$TMP_FILE" ]; then
    rm -f -- "$TMP_FILE"
  fi
  if [ -n "$STATUS_TMP" ] && [ -f "$STATUS_TMP" ]; then
    rm -f -- "$STATUS_TMP"
  fi
  if [ -n "$LATEST_STATUS_TMP" ] && [ -f "$LATEST_STATUS_TMP" ]; then
    rm -f -- "$LATEST_STATUS_TMP"
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
if [[ ! "${DEPLOY_DATABASE_ID:-}" =~ ^[a-z0-9][a-z0-9._-]{0,127}$ ]]; then
  echo "[backup] ERROR: DEPLOY_DATABASE_ID 必须是规范的部署数据库标识" >&2
  exit 1
fi
require_command node

TARGET_GIT_COMMIT="${BACKUP_TARGET_GIT_COMMIT:-}"
if [ -z "$TARGET_GIT_COMMIT" ]; then
  if [ -L "$BACKUP_DEPLOYED_COMMIT_FILE" ] || [ ! -f "$BACKUP_DEPLOYED_COMMIT_FILE" ] \
    || [ ! -r "$BACKUP_DEPLOYED_COMMIT_FILE" ]; then
    echo "[backup] ERROR: BACKUP_TARGET_GIT_COMMIT 未设置且 marker 不可读: $BACKUP_DEPLOYED_COMMIT_FILE" >&2
    exit 1
  fi
  if ! TARGET_GIT_COMMIT="$(node -e '
const fs = require("node:fs");
const value = fs.readFileSync(process.argv[1], "utf8");
const match = value.match(/^([a-f0-9]{40})(?:\n)?$/);
if (!match) process.exit(1);
process.stdout.write(match[1]);
' "$BACKUP_DEPLOYED_COMMIT_FILE")"; then
    echo "[backup] ERROR: marker 必须只包含小写完整 40 位 Git object ID" >&2
    exit 1
  fi
fi
if [[ ! "$TARGET_GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  echo "[backup] ERROR: BACKUP_TARGET_GIT_COMMIT 必须是小写完整 40 位 Git object ID" >&2
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
require_command psql
require_command gzip
require_command ln
require_command sha256sum
require_command stat
require_command sync
require_command id

case "$BACKUP_S3_PREFIX" in
  '') ;;
  */) ;;
  *) BACKUP_S3_PREFIX="${BACKUP_S3_PREFIX}/" ;;
esac

mkdir -p "$BACKUP_LOCAL_DIR"
if [ -L "$BACKUP_LOCAL_DIR" ] || [ ! -d "$BACKUP_LOCAL_DIR" ]; then
  echo "[backup] ERROR: BACKUP_LOCAL_DIR 必须是真实目录，不能是符号链接" >&2
  exit 1
fi
BACKUP_DIR_UID="$(stat -c '%u' "$BACKUP_LOCAL_DIR")"
BACKUP_DIR_MODE="$(stat -c '%a' "$BACKUP_LOCAL_DIR")"
if [ "$BACKUP_DIR_UID" != "$(id -u)" ] \
  || (( (8#$BACKUP_DIR_MODE & 0022) != 0 )); then
  echo "[backup] ERROR: BACKUP_LOCAL_DIR 必须由备份用户所有且不可被 group/world 写入" >&2
  exit 1
fi

TIMESTAMP=$(date +%Y%m%d_%H%M%S)
FILENAME="ss_erp_${TIMESTAMP}.sql.gz"
FILEPATH="${BACKUP_LOCAL_DIR}/${FILENAME}"
TMP_FILE="${FILEPATH}.tmp.$$"

echo "[backup] $(date '+%F %T') 开始备份..."

BACKUP_AT="$(node -e 'process.stdout.write(new Date().toISOString())')"
DATABASE_BINDING="$(DEPLOY_DATABASE_ID="$DEPLOY_DATABASE_ID" DEPLOY_DATABASE_URL="$BACKUP_DB_URL" \
  node "$SCRIPT_DIR/deploy-database-identity.mjs" --backup-binding)"
IFS=$'\t' read -r DATABASE_IDENTITY_SHA256 DATABASE_UUID_SHA256 <<< "$DATABASE_BINDING"
if [[ ! "$DATABASE_IDENTITY_SHA256" =~ ^[0-9a-f]{64}$ ]] \
  || [[ ! "$DATABASE_UUID_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "[backup] ERROR: 无法取得数据库身份与 UUID 摘要" >&2
  exit 1
fi

node "$SCRIPT_DIR/run-postgres-command.mjs" \
  --url-env BACKUP_DB_URL --command pg_dump -- \
  --clean --if-exists --no-owner --no-privileges | gzip -c > "$TMP_FILE"
gzip -t "$TMP_FILE"
LOCAL_BYTES="$(stat -c '%s' "$TMP_FILE")"
LOCAL_SHA256="$(sha256sum "$TMP_FILE" | awk '{print $1}')"
if [[ ! "$LOCAL_BYTES" =~ ^[1-9][0-9]*$ ]] || [[ ! "$LOCAL_SHA256" =~ ^[0-9a-f]{64}$ ]]; then
  echo "[backup] ERROR: 无法取得规范的备份字节数或 SHA-256" >&2
  exit 1
fi
sync -f "$TMP_FILE"
ln -- "$TMP_FILE" "$FILEPATH"
rm -f -- "$TMP_FILE"
TMP_FILE=""
chmod 0600 "$FILEPATH"

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

# 写入备份状态 JSON（供后台 API 读取）
STATUS_FILE="${BACKUP_LOCAL_DIR}/backup-status.json"
STATUS_EVIDENCE_FILE="${FILEPATH}.status.json"
STATUS_TMP="${STATUS_EVIDENCE_FILE}.tmp.$$"
LATEST_STATUS_TMP="${STATUS_FILE}.tmp.$$"
REMOTE_UPLOADED="false"
REMOTE_KEY=""
if [ "$S3_ENABLED" -eq 1 ]; then
  REMOTE_UPLOADED="true"
  REMOTE_KEY="${S3_KEY}"
fi

node - "$STATUS_TMP" "$BACKUP_AT" "$FILENAME" "$SIZE" "$LOCAL_BYTES" "$LOCAL_SHA256" \
  "$DEPLOY_DATABASE_ID" "$DATABASE_IDENTITY_SHA256" "$DATABASE_UUID_SHA256" \
  "$TARGET_GIT_COMMIT" \
  "$REMOTE_UPLOADED" "$REMOTE_KEY" <<'NODE'
const fs = require('node:fs');
const [
  output,
  lastBackupAt,
  lastLocalFile,
  lastLocalSize,
  lastLocalBytesText,
  lastLocalSha256,
  databaseId,
  databaseIdentitySha256,
  databaseUuidSha256,
  targetGitCommit,
  remoteUploadedText,
  lastRemoteKey,
] = process.argv.slice(2);
const lastLocalBytes = Number(lastLocalBytesText);
if (!Number.isSafeInteger(lastLocalBytes) || lastLocalBytes < 1) {
  throw new Error('backup byte count is invalid');
}
const status = {
  schemaVersion: 3,
  lastBackupAt,
  lastLocalFile,
  lastLocalSize,
  lastLocalBytes,
  lastLocalSha256,
  databaseId,
  databaseIdentitySha256,
  databaseUuidSha256,
  targetGitCommit,
  remoteUploaded: remoteUploadedText === 'true',
  lastRemoteKey,
};
const descriptor = fs.openSync(
  output,
  fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
  0o600,
);
try {
  fs.writeFileSync(descriptor, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  fs.fsyncSync(descriptor);
} finally {
  fs.closeSync(descriptor);
}
NODE
ln -- "$STATUS_TMP" "$STATUS_EVIDENCE_FILE"
rm -f -- "$STATUS_TMP"
STATUS_TMP=""
cp -- "$STATUS_EVIDENCE_FILE" "$LATEST_STATUS_TMP"
mv -f -- "$LATEST_STATUS_TMP" "$STATUS_FILE"
LATEST_STATUS_TMP=""
node -e '
const fs = require("node:fs");
const descriptor = fs.openSync(process.argv[1], fs.constants.O_RDONLY);
try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
' "$BACKUP_LOCAL_DIR"

# API 进程通常以 deploy 用户运行，需要能读取状态文件，但不需要读取备份包。
if command -v getent >/dev/null 2>&1 && getent group "$BACKUP_STATUS_GROUP" >/dev/null 2>&1; then
  chgrp "$BACKUP_STATUS_GROUP" "$BACKUP_LOCAL_DIR" "$STATUS_FILE" || true
  chmod 750 "$BACKUP_LOCAL_DIR" || true
  chmod 640 "$STATUS_FILE" || true
fi

# 清理本地旧备份，但保留 backup-status.json 和部署 attestation 引用的证据文件。
DELETED="$(node "$SCRIPT_DIR/prune-backup-retention.mjs" \
  --backup-dir "$BACKUP_LOCAL_DIR" --keep-days "$BACKUP_KEEP_DAYS" --count)"
if [[ ! "$DELETED" =~ ^[0-9]+$ ]]; then
  echo "[backup] ERROR: 备份保留策略未返回规范的删除计数" >&2
  exit 1
fi
if [ "$DELETED" -gt 0 ]; then
  echo "[backup] 已清理 ${DELETED} 个超过 ${BACKUP_KEEP_DAYS} 天且未被部署证据引用的旧备份"
fi

echo "[backup] $(date '+%F %T') 完成"

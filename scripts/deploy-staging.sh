#!/usr/bin/env bash
set -euo pipefail

# SS ERP Staging 部署脚本
# 用法: ./scripts/deploy-staging.sh
# 前提: 服务器已安装 Node 22+, pnpm, PostgreSQL, Redis, Nginx

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ss-erp}"
ENV_FILE="${ENV_FILE:-.env.staging}"
DEPLOY_ENV_PROFILE="${DEPLOY_ENV_PROFILE:-}"
API_SERVICE="${API_SERVICE:-ss-erp-api}"
WEB_SERVICE="${WEB_SERVICE:-ss-erp-web}"
WORKER_SERVICE="${WORKER_SERVICE:-ss-erp-worker}"
DEPLOY_RUN_USER="${DEPLOY_RUN_USER:-deploy}"
DEPLOY_BUILD_USER="${DEPLOY_BUILD_USER:-ss-erp-build}"
EXTENSION_RELEASE_ROOT="${EXTENSION_RELEASE_ROOT:-}"
DEPLOY_BACKUP_GATE_ROOT=/usr/local/lib/ss-erp-deploy-gate

if [ "$#" -ne 0 ]; then
  echo "ERROR: deploy-staging.sh does not accept arguments; every target commit must be rebuilt"
  exit 1
fi

if [[ ! "$DEPLOY_RUN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]]; then
  echo "ERROR: DEPLOY_RUN_USER must be one canonical system user name" >&2
  exit 1
fi
if [ "$(id -u)" = "0" ] || [ "$(id -un)" != "$DEPLOY_RUN_USER" ]; then
  echo "ERROR: deploy-staging.sh must run directly as DEPLOY_RUN_USER, never through sudo/root" >&2
  exit 1
fi

readonly DEPLOY_DIR ENV_FILE DEPLOY_ENV_PROFILE API_SERVICE WEB_SERVICE WORKER_SERVICE \
  DEPLOY_RUN_USER DEPLOY_BUILD_USER DEPLOY_BACKUP_GATE_ROOT EXTENSION_RELEASE_ROOT

if [[ ! "$ENV_FILE" =~ ^\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]]; then
  echo "ERROR: ENV_FILE must be one dot-prefixed basename" >&2
  exit 1
fi

case "$DEPLOY_DIR" in
  /*) ;;
  *) echo "ERROR: DEPLOY_DIR must be an absolute path" >&2; exit 1 ;;
esac
case "$EXTENSION_RELEASE_ROOT" in
  /*) ;;
  *) echo "ERROR: EXTENSION_RELEASE_ROOT must be one absolute pre-staged release directory" >&2; exit 1 ;;
esac
if [ "$(readlink -m -- "$DEPLOY_DIR")" != "$DEPLOY_DIR" ] \
  || [ -L "$DEPLOY_DIR" ] || [ ! -d "$DEPLOY_DIR" ]; then
  echo "ERROR: DEPLOY_DIR must be one real canonical directory" >&2
  exit 1
fi
DEPLOY_PARENT="$(dirname -- "$DEPLOY_DIR")"
CURRENT_ANCESTOR="$DEPLOY_PARENT"
while true; do
  if [ -L "$CURRENT_ANCESTOR" ] || [ ! -d "$CURRENT_ANCESTOR" ] \
    || [ "$(readlink -f -- "$CURRENT_ANCESTOR")" != "$CURRENT_ANCESTOR" ] \
    || [ "$(stat -c '%u' "$CURRENT_ANCESTOR")" != "0" ]; then
    echo "ERROR: DEPLOY_DIR ancestors must be root-owned canonical directories" >&2
    exit 1
  fi
  DEPLOY_PARENT_MODE="$(stat -c '%a' "$CURRENT_ANCESTOR")"
  if (( (8#$DEPLOY_PARENT_MODE & 8#022) != 0 )); then
    echo "ERROR: DEPLOY_DIR ancestors must not be group/world writable" >&2
    exit 1
  fi
  [ "$CURRENT_ANCESTOR" = "/" ] && break
  CURRENT_ANCESTOR="$(dirname -- "$CURRENT_ANCESTOR")"
done

CURRENT_ANCESTOR="$EXTENSION_RELEASE_ROOT"
while true; do
  if [ -L "$CURRENT_ANCESTOR" ] || [ ! -d "$CURRENT_ANCESTOR" ] \
    || [ ! -r "$CURRENT_ANCESTOR" ] \
    || [ "$(readlink -f -- "$CURRENT_ANCESTOR")" != "$CURRENT_ANCESTOR" ] \
    || [ "$(stat -c '%u' "$CURRENT_ANCESTOR")" != "0" ]; then
    echo "ERROR: EXTENSION_RELEASE_ROOT ancestors must be readable root-owned canonical directories" >&2
    exit 1
  fi
  EXTENSION_RELEASE_MODE="$(stat -c '%a' "$CURRENT_ANCESTOR")"
  if (( (8#$EXTENSION_RELEASE_MODE & 8#022) != 0 )); then
    echo "ERROR: EXTENSION_RELEASE_ROOT ancestors must not be group/world writable" >&2
    exit 1
  fi
  if (( (8#$EXTENSION_RELEASE_MODE & 8#001) == 0 )); then
    echo "ERROR: EXTENSION_RELEASE_ROOT ancestors must be traversable by the build user" >&2
    exit 1
  fi
  [ "$CURRENT_ANCESTOR" = "/" ] && break
  CURRENT_ANCESTOR="$(dirname -- "$CURRENT_ANCESTOR")"
done

if [ "$(stat -c '%a' "$EXTENSION_RELEASE_ROOT")" != "755" ]; then
  echo "ERROR: extension release root must use mode 0755" >&2
  exit 1
fi

EXTENSION_RELEASE_FILE_COUNT=0
while IFS= read -r -d '' EXTENSION_RELEASE_FILE; do
  EXTENSION_RELEASE_FILE_COUNT=$((EXTENSION_RELEASE_FILE_COUNT + 1))
  if [ -L "$EXTENSION_RELEASE_FILE" ] || [ ! -f "$EXTENSION_RELEASE_FILE" ] \
    || [ ! -r "$EXTENSION_RELEASE_FILE" ] \
    || [ "$(stat -c '%u' "$EXTENSION_RELEASE_FILE")" != "0" ]; then
    echo "ERROR: extension release input must be a readable root-owned regular file" >&2
    exit 1
  fi
  EXTENSION_RELEASE_FILE_MODE="$(stat -c '%a' "$EXTENSION_RELEASE_FILE")"
  if [ "$EXTENSION_RELEASE_FILE_MODE" != "644" ]; then
    echo "ERROR: extension release input must use mode 0644" >&2
    exit 1
  fi
done < <(find -P "$EXTENSION_RELEASE_ROOT" -mindepth 1 -maxdepth 1 -print0)
if [ "$EXTENSION_RELEASE_FILE_COUNT" -ne 4 ]; then
  echo "ERROR: extension release root must contain exactly four files" >&2
  exit 1
fi

cd "$DEPLOY_DIR"

if [ -L .git ] || [ ! -d .git ]; then
  echo "ERROR: $DEPLOY_DIR must contain a real .git directory"
  exit 1
fi

assert_clean_staging_checkout() {
  local expected_commit="${1:-}"
  local current_commit
  local worktree_status
  if ! current_commit="$(git -c safe.directory="$DEPLOY_DIR" rev-parse --verify --end-of-options "HEAD^{commit}" 2>/dev/null)"; then
    echo "ERROR: staging HEAD is not a commit" >&2
    exit 1
  fi
  if [[ ! "$current_commit" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ERROR: staging HEAD did not resolve to a full 40-character commit OID" >&2
    exit 1
  fi
  if [ -n "$expected_commit" ] && [ "$current_commit" != "$expected_commit" ]; then
    echo "ERROR: staging HEAD changed during deployment" >&2
    exit 1
  fi
  if ! worktree_status="$(git -c safe.directory="$DEPLOY_DIR" status --porcelain --untracked-files=all -- . ':(exclude)DEPLOYED_COMMIT')"; then
    echo "ERROR: could not inspect the complete staging worktree" >&2
    exit 1
  fi
  if [ -n "$worktree_status" ]; then
    echo "ERROR: staging deployment requires a clean complete worktree" >&2
    exit 1
  fi
  printf '%s' "$current_commit"
}

assert_installed_target_backup_gate() {
  local target_commit="$1"
  local target_dir="$DEPLOY_BACKUP_GATE_ROOT/$target_commit"
  local path
  local mode
  local name
  local files=(
    deploy-backup-gate.mjs
    deploy-backup-attestation.mjs
    deploy-database-identity.mjs
    deploy-environment.mjs
    deploy-source-manifest.mjs
    freeze-deploy-source.sh
    verify-deploy-backup.sh
  )
  for path in "$DEPLOY_BACKUP_GATE_ROOT" "$target_dir"; do
    if [ -L "$path" ] || [ ! -d "$path" ] || [ "$(stat -c '%u' "$path" 2>/dev/null)" != "0" ]; then
      echo "ERROR: staging requires a preinstalled root-owned target gate: $target_dir" >&2
      exit 1
    fi
    mode="$(stat -c '%a' "$path")"
    if (( (8#$mode & 8#022) != 0 )); then
      echo "ERROR: deployment gate directories must not be group/world writable: $path" >&2
      exit 1
    fi
  done
  for name in "${files[@]}" TARGET_GIT_COMMIT; do
    path="$target_dir/$name"
    if [ -L "$path" ] || [ ! -f "$path" ] || [ ! -r "$path" ] \
      || [ "$(stat -c '%u' "$path" 2>/dev/null)" != "0" ]; then
      echo "ERROR: installed target gate file is not trusted: $path" >&2
      exit 1
    fi
    mode="$(stat -c '%a' "$path")"
    if (( (8#$mode & 8#022) != 0 )); then
      echo "ERROR: installed target gate file must not be group/world writable: $path" >&2
      exit 1
    fi
  done
  if [ "$(cat "$target_dir/TARGET_GIT_COMMIT")" != "$target_commit" ]; then
    echo "ERROR: installed target gate marker does not match staging HEAD" >&2
    exit 1
  fi
  for name in "${files[@]}"; do
    if ! cmp -- "$DEPLOY_DIR/scripts/$name" "$target_dir/$name"; then
      echo "ERROR: installed target gate differs from staging HEAD: $name" >&2
      exit 1
    fi
  done
}

assert_git_bound_build_inputs() {
  node scripts/verify-deploy-build-inputs.mjs "$TARGET_GIT_COMMIT" "$ENV_FILE"
}

reset_generated_build_paths() {
  local parent
  local generated
  local parents=(
    "$DEPLOY_DIR"
    "$DEPLOY_DIR/apps/server"
    "$DEPLOY_DIR/apps/web"
    "$DEPLOY_DIR/packages/shared"
  )
  local generated_paths=(
    "$DEPLOY_DIR/node_modules"
    "$DEPLOY_DIR/build"
    "$DEPLOY_DIR/.turbo"
    "$DEPLOY_DIR/apps/server/node_modules"
    "$DEPLOY_DIR/apps/server/dist"
    "$DEPLOY_DIR/apps/server/coverage"
    "$DEPLOY_DIR/apps/web/node_modules"
    "$DEPLOY_DIR/apps/web/.next"
    "$DEPLOY_DIR/apps/web/.next-dev"
    "$DEPLOY_DIR/apps/web/coverage"
    "$DEPLOY_DIR/packages/shared/node_modules"
    "$DEPLOY_DIR/packages/shared/dist"
    "$DEPLOY_DIR/packages/shared/coverage"
  )
  for parent in "${parents[@]}"; do
    if [ -L "$parent" ] || [ ! -d "$parent" ] \
      || [ "$(readlink -f -- "$parent")" != "$parent" ]; then
      echo "ERROR: generated build path parent must be one real directory: $parent" >&2
      exit 1
    fi
  done
  for generated in "${generated_paths[@]}"; do
    rm -rf -- "$generated"
  done
  for parent in "${parents[@]}"; do
    find -P "$parent" -maxdepth 1 -type f -name '*.tsbuildinfo' -delete
  done
}

BRANCH="${DEPLOY_BRANCH:-$(git branch --show-current)}"
BRANCH="${BRANCH:-main}"

if [ -L "$ENV_FILE" ] || [ ! -f "$ENV_FILE" ] || [ ! -r "$ENV_FILE" ]; then
  echo "ERROR: missing env file: $DEPLOY_DIR/$ENV_FILE"
  exit 1
fi

echo "=== SS ERP Staging Deploy ==="
echo "Branch: $BRANCH"
echo "Dir: $DEPLOY_DIR"
echo "Env: $ENV_FILE"
echo "Env profile: ${DEPLOY_ENV_PROFILE:-skip}"
echo ""

# 1. 拉取最新代码
echo "[1/7] Pulling latest code..."
assert_clean_staging_checkout >/dev/null
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git pull --ff-only origin "$BRANCH"
readonly TARGET_GIT_COMMIT="$(assert_clean_staging_checkout)"
assert_installed_target_backup_gate "$TARGET_GIT_COMMIT"
assert_git_bound_build_inputs
if [[ ! "$DEPLOY_RUN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] \
  || ! id -- "$DEPLOY_RUN_USER" >/dev/null 2>&1; then
  echo "ERROR: deployment runtime user is missing: $DEPLOY_RUN_USER" >&2
  exit 1
fi
if [[ ! "$DEPLOY_BUILD_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] \
  || ! id -- "$DEPLOY_BUILD_USER" >/dev/null 2>&1 \
  || [ "$DEPLOY_BUILD_USER" = "$DEPLOY_RUN_USER" ]; then
  echo "ERROR: a distinct deployment build user is required: $DEPLOY_BUILD_USER" >&2
  exit 1
fi
DEPLOY_RUN_GROUP="$(id -gn -- "$DEPLOY_RUN_USER")"
DEPLOY_RUN_UID="$(id -u -- "$DEPLOY_RUN_USER")"
DEPLOY_RUN_GID="$(id -g -- "$DEPLOY_RUN_USER")"
DEPLOY_BUILD_GROUP="$(id -gn -- "$DEPLOY_BUILD_USER")"
DEPLOY_BUILD_UID="$(id -u -- "$DEPLOY_BUILD_USER")"
DEPLOY_BUILD_GID="$(id -g -- "$DEPLOY_BUILD_USER")"
if [ "$DEPLOY_RUN_UID" = "0" ] || [ "$DEPLOY_RUN_GID" = "0" ] \
  || [ "$DEPLOY_BUILD_UID" = "0" ] || [ "$DEPLOY_BUILD_GID" = "0" ] \
  || [ "$DEPLOY_BUILD_UID" = "$DEPLOY_RUN_UID" ] \
  || [ "$DEPLOY_BUILD_GID" = "$DEPLOY_RUN_GID" ]; then
  echo "ERROR: build and runtime users require distinct non-root UIDs and GIDs" >&2
  exit 1
fi
DEPLOY_ENV_TOOL="$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-environment.mjs"
DEPLOY_ENV_SNAPSHOT_DIR="$(sudo mktemp -d /run/ss-erp-deploy-env.XXXXXXXXXX)"
DEPLOY_ENV_SNAPSHOT="$DEPLOY_ENV_SNAPSHOT_DIR/environment.env"
DEPLOY_SOURCE_MANIFEST="$DEPLOY_ENV_SNAPSHOT_DIR/source-manifest.json"
DEPLOY_BUILD_MANIFEST="$DEPLOY_ENV_SNAPSHOT_DIR/build-manifest.json"
DEPLOY_BUILD_HOME="$(sudo mktemp -d /run/ss-erp-build-home.XXXXXXXXXX)"
cleanup_environment_snapshot() {
  if [ -n "${DEPLOY_ENV_SNAPSHOT_DIR:-}" ]; then
    sudo rm -rf -- "$DEPLOY_ENV_SNAPSHOT_DIR"
    sudo rm -rf -- "$DEPLOY_BUILD_HOME"
  fi
}
trap cleanup_environment_snapshot EXIT
sudo chmod 0700 "$DEPLOY_ENV_SNAPSHOT_DIR"
sudo chown "$DEPLOY_BUILD_USER:$DEPLOY_BUILD_GROUP" "$DEPLOY_BUILD_HOME"
sudo chmod 0700 "$DEPLOY_BUILD_HOME"
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_ENV_TOOL" snapshot "$DEPLOY_DIR/$ENV_FILE" "$DEPLOY_ENV_SNAPSHOT"
sudo chown "root:$DEPLOY_RUN_GROUP" "$DEPLOY_ENV_SNAPSHOT_DIR" "$DEPLOY_ENV_SNAPSHOT"
sudo chmod 0750 "$DEPLOY_ENV_SNAPSHOT_DIR"
sudo chmod 0640 "$DEPLOY_ENV_SNAPSHOT"
MIGRATION_TIMEOUT="$(node "$DEPLOY_ENV_TOOL" value "$DEPLOY_ENV_SNAPSHOT" MIGRATION_TIMEOUT)"
MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-20m}"
if [[ ! "$MIGRATION_TIMEOUT" =~ ^[1-9][0-9]*[smh]$ ]]; then
  echo "ERROR: MIGRATION_TIMEOUT must be a positive duration ending in s, m, or h" >&2
  exit 1
fi

if [ -n "$DEPLOY_ENV_PROFILE" ]; then
  if [ "$DEPLOY_ENV_PROFILE" = "cloud-r2" ]; then
    echo "[1b/7] Validating bootstrap env for profile: $DEPLOY_ENV_PROFILE"
    node scripts/validate-env.mjs --profile cloud-bootstrap --env "$DEPLOY_ENV_SNAPSHOT"
  else
    echo "[1b/7] Validating env profile: $DEPLOY_ENV_PROFILE"
    node scripts/validate-env.mjs --profile "$DEPLOY_ENV_PROFILE" --env "$DEPLOY_ENV_SNAPSHOT"
  fi
fi

SERVICES_QUIESCED=0
SOURCE_FROZEN=0
restore_source_ownership() {
  if [ "$SOURCE_FROZEN" = "1" ]; then
    sudo bash "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/freeze-deploy-source.sh" \
      thaw "$TARGET_GIT_COMMIT" "$DEPLOY_DIR" "$DEPLOY_RUN_USER" "$ENV_FILE" || true
    SOURCE_FROZEN=0
  fi
}
restore_quiesced_services() {
  local status=$?
  trap - EXIT
  if [ "$status" -ne 0 ] && [ "$SERVICES_QUIESCED" = "1" ]; then
    sudo systemctl stop "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE" || true
    echo "[deploy] Worker/API/Web remain stopped after failed build, migration, or gate; operator recovery is required" >&2
  fi
  restore_source_ownership
  cleanup_environment_snapshot
  exit "$status"
}
trap restore_quiesced_services EXIT

echo "[1c/7] Quiescing application services before in-place dependency or build changes..."
if ! sudo systemctl stop "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE"; then
  sudo systemctl restart "$WORKER_SERVICE" "$API_SERVICE" "$WEB_SERVICE" || true
  echo "ERROR: could not quiesce Worker/API/Web before in-place deployment" >&2
  exit 1
fi
SERVICES_QUIESCED=1
printf '%s\n' "$TARGET_GIT_COMMIT" > DEPLOYED_COMMIT
echo "[1d/7] Removing prior generated dependencies and build outputs..."
reset_generated_build_paths
sudo chmod 0700 "$DEPLOY_ENV_SNAPSHOT_DIR"
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-source-manifest.mjs" create \
  "$DEPLOY_DIR" "$DEPLOY_SOURCE_MANIFEST" "$TARGET_GIT_COMMIT"
sudo chmod 0750 "$DEPLOY_ENV_SNAPSHOT_DIR"
sudo chown root:root "$DEPLOY_DIR"
sudo chmod 0755 "$DEPLOY_DIR"
sudo chown -hR -P root:root "$DEPLOY_DIR/.git"
sudo find -P "$DEPLOY_DIR/.git" -xdev \( -type d -o -type f \) -exec chmod go-w -- {} +
sudo find "$DEPLOY_DIR" -mindepth 1 -maxdepth 1 \
  ! -name .git ! -name "$ENV_FILE" ! -name DEPLOYED_COMMIT \
  -exec chown -hR -P "$DEPLOY_BUILD_USER:$DEPLOY_BUILD_GROUP" -- {} +
sudo chown "root:$DEPLOY_RUN_GROUP" "$DEPLOY_DIR/$ENV_FILE"
sudo chmod 0640 "$DEPLOY_DIR/$ENV_FILE"
sudo chown root:root "$DEPLOY_DIR/DEPLOYED_COMMIT"
sudo chmod 0444 "$DEPLOY_DIR/DEPLOYED_COMMIT"
for writable_root in node_modules build .turbo; do
  sudo mkdir -p "$DEPLOY_DIR/$writable_root"
  sudo chown -R "$DEPLOY_BUILD_USER:$DEPLOY_BUILD_GROUP" "$DEPLOY_DIR/$writable_root"
done

# 2. 安装依赖
echo "[2/7] Installing dependencies..."
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_ENV_TOOL" exec-build-as "$DEPLOY_ENV_SNAPSHOT" "$DEPLOY_DIR" \
  "$DEPLOY_BUILD_UID" "$DEPLOY_BUILD_GID" "$DEPLOY_BUILD_HOME" -- \
  pnpm install --frozen-lockfile --force

# 3. Prisma Client
echo "[3/7] Generating Prisma client..."
cd apps/server
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_ENV_TOOL" exec-build-as "$DEPLOY_ENV_SNAPSHOT" "$DEPLOY_DIR/apps/server" \
  "$DEPLOY_BUILD_UID" "$DEPLOY_BUILD_GID" "$DEPLOY_BUILD_HOME" -- \
  npx prisma generate
cd "$DEPLOY_DIR"

# 4. 构建
echo "[4/7] Building server..."
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_ENV_TOOL" exec-build-as "$DEPLOY_ENV_SNAPSHOT" "$DEPLOY_DIR" \
  "$DEPLOY_BUILD_UID" "$DEPLOY_BUILD_GID" "$DEPLOY_BUILD_HOME" -- \
  pnpm --filter server build

echo "[5/7] Building web..."
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_ENV_TOOL" exec-build-as "$DEPLOY_ENV_SNAPSHOT" "$DEPLOY_DIR" \
  "$DEPLOY_BUILD_UID" "$DEPLOY_BUILD_GID" "$DEPLOY_BUILD_HOME" -- \
  pnpm --filter web build

echo "[5b/7] Staging the prebuilt cloud and local extension release..."
EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN="$(node "$DEPLOY_ENV_TOOL" value "$DEPLOY_ENV_SNAPSHOT" EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN)"
EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN="$(node "$DEPLOY_ENV_TOOL" value "$DEPLOY_ENV_SNAPSHOT" EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN)"
EXTENSION_RELEASE_EXPECTED_API_ORIGIN="$(node "$DEPLOY_ENV_TOOL" value "$DEPLOY_ENV_SNAPSHOT" EXTENSION_RELEASE_EXPECTED_API_ORIGIN)"
EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN="$(node "$DEPLOY_ENV_TOOL" value "$DEPLOY_ENV_SNAPSHOT" EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN)"
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_ENV_TOOL" exec-build-as "$DEPLOY_ENV_SNAPSHOT" "$DEPLOY_DIR" \
  "$DEPLOY_BUILD_UID" "$DEPLOY_BUILD_GID" "$DEPLOY_BUILD_HOME" -- \
  node scripts/stage-extension-release.mjs \
  --build-root "$EXTENSION_RELEASE_ROOT" \
  --output-dir "$DEPLOY_DIR/build/extensions" \
  --target-git-commit "$TARGET_GIT_COMMIT" \
  --expected-web-origin "$EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN" \
  --expected-admin-origin "$EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN" \
  --expected-api-origin "$EXTENSION_RELEASE_EXPECTED_API_ORIGIN" \
  --expected-local-origin "${EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN:-http://127.0.0.1:3001}"

echo "[5b/7] Revoking build-user writes to the staged extension release..."
sudo chown root:root "$DEPLOY_DIR/build"
sudo chmod 0755 "$DEPLOY_DIR/build"
if sudo test -L "$DEPLOY_DIR/build/extensions" || ! sudo test -d "$DEPLOY_DIR/build/extensions"; then
  echo "ERROR: staged extension release must be one real directory" >&2
  exit 1
fi
sudo chown root:root "$DEPLOY_DIR/build/extensions"
sudo chmod 0755 "$DEPLOY_DIR/build/extensions"
sudo find -P "$DEPLOY_DIR/build/extensions" -xdev -type f -exec chown root:root -- {} +
sudo find -P "$DEPLOY_DIR/build/extensions" -xdev -type f -exec chmod 0644 -- {} +

echo "[5c/7] Verifying current commit extension release set..."
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_ENV_TOOL" exec-build-as "$DEPLOY_ENV_SNAPSHOT" "$DEPLOY_DIR" \
  "$DEPLOY_BUILD_UID" "$DEPLOY_BUILD_GID" "$DEPLOY_BUILD_HOME" -- \
  node scripts/verify-extension-release.mjs \
  --build-root "$DEPLOY_DIR/build/extensions" \
  --expected-web-origin "$EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN" \
  --expected-admin-origin "$EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN" \
  --expected-api-origin "$EXTENSION_RELEASE_EXPECTED_API_ORIGIN" \
  --expected-local-origin "${EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN:-http://127.0.0.1:3001}"

echo "[5d/7] Sealing checkout source on new root-owned inodes..."
sudo chmod 0700 "$DEPLOY_ENV_SNAPSHOT_DIR"
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-source-manifest.mjs" create-closed \
  "$DEPLOY_DIR" "$DEPLOY_BUILD_MANIFEST" "$TARGET_GIT_COMMIT"
sudo chmod 0750 "$DEPLOY_ENV_SNAPSHOT_DIR"
SEALED_DEPLOY_DIR="$DEPLOY_DIR.sealed.$$"
UNSEALED_DEPLOY_DIR="$DEPLOY_DIR.unsealed.$$"
cd /
sudo bash "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/freeze-deploy-source.sh" \
  seal "$TARGET_GIT_COMMIT" "$DEPLOY_DIR" "$SEALED_DEPLOY_DIR"
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-source-manifest.mjs" verify \
  "$SEALED_DEPLOY_DIR" "$DEPLOY_SOURCE_MANIFEST" "$TARGET_GIT_COMMIT"
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-source-manifest.mjs" verify \
  "$SEALED_DEPLOY_DIR" "$DEPLOY_BUILD_MANIFEST" "$TARGET_GIT_COMMIT"
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$SEALED_DEPLOY_DIR/scripts/stage-extension-release.mjs" \
  --build-root "$EXTENSION_RELEASE_ROOT" \
  --verify-output-dir "$SEALED_DEPLOY_DIR/build/extensions" \
  --target-git-commit "$TARGET_GIT_COMMIT" \
  --expected-web-origin "$EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN" \
  --expected-admin-origin "$EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN" \
  --expected-api-origin "$EXTENSION_RELEASE_EXPECTED_API_ORIGIN" \
  --expected-local-origin "${EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN:-http://127.0.0.1:3001}"
shopt -s nullglob
for reserved_runtime_link in \
  "$SEALED_DEPLOY_DIR"/.env.* \
  "$SEALED_DEPLOY_DIR/backups" \
  "$SEALED_DEPLOY_DIR/apps/server/public/uploads" \
  "$SEALED_DEPLOY_DIR/apps/server/public/watermarked" \
  "$SEALED_DEPLOY_DIR/apps/server/public/resized" \
  "$SEALED_DEPLOY_DIR/apps/server/public/tmp" \
  "$SEALED_DEPLOY_DIR/tmp/ai-image-sandbox" \
  "$SEALED_DEPLOY_DIR/tmp/ai-image-translation-sandbox"; do
  if sudo test -L "$reserved_runtime_link"; then
    echo "ERROR: staging build produced a reserved external runtime symlink" >&2
    exit 1
  fi
done
shopt -u nullglob
sudo mv "$DEPLOY_DIR" "$UNSEALED_DEPLOY_DIR"
sudo mv "$SEALED_DEPLOY_DIR" "$DEPLOY_DIR"
sudo rm -rf -- "$UNSEALED_DEPLOY_DIR"
cd "$DEPLOY_DIR"
sudo bash "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/freeze-deploy-source.sh" \
  verify "$TARGET_GIT_COMMIT" "$DEPLOY_DIR"
SOURCE_FROZEN=1

# 6. 迁移并重启服务
echo "[6a-b/7] Verifying backup attestation and running the bound database migration..."
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_BACKUP_GATE_ROOT/$TARGET_GIT_COMMIT/deploy-backup-gate.mjs" \
  --mode migrate \
  --env-file "$DEPLOY_ENV_SNAPSHOT" \
  --target-git-commit "$TARGET_GIT_COMMIT" \
  --server-dir "$DEPLOY_DIR/apps/server" \
  --run-user "$DEPLOY_RUN_USER" \
  --migration-timeout "$MIGRATION_TIMEOUT"

if [ "$DEPLOY_ENV_PROFILE" = "cloud-r2" ]; then
  echo "[6c/7] Validating runtime upload config..."
  DEPLOY_DIR="$DEPLOY_DIR" \
  ENV_FILE="$ENV_FILE" \
  SKIP_SERVICE_CHECKS=1 \
  SKIP_PROCESS_ENV_CHECKS=1 \
  SKIP_HTTP_CHECK=1 \
  node "$DEPLOY_ENV_TOOL" exec-check "$DEPLOY_ENV_SNAPSHOT" "$DEPLOY_DIR" -- \
    bash scripts/diagnose-runtime-env.sh
fi

WEB_NEXT_DIR="$DEPLOY_DIR/apps/web/.next"
WEB_CACHE_DIR="$WEB_NEXT_DIR/cache"
if sudo test -L "$WEB_NEXT_DIR" || ! sudo test -d "$WEB_NEXT_DIR" \
  || [ "$(sudo readlink -f -- "$WEB_NEXT_DIR")" != "$WEB_NEXT_DIR" ]; then
  echo "ERROR: sealed Web build output must be one real directory" >&2
  exit 1
fi
sudo rm -rf -- "$WEB_CACHE_DIR"
sudo install -d -o "$DEPLOY_RUN_USER" -g "$DEPLOY_RUN_GROUP" -m 0750 "$WEB_CACHE_DIR"
if sudo test -L "$WEB_CACHE_DIR" \
  || [ "$(sudo stat -c '%u:%g:%a' "$WEB_CACHE_DIR")" != "$DEPLOY_RUN_UID:$DEPLOY_RUN_GID:750" ]; then
  echo "ERROR: runtime Web cache could not be created safely" >&2
  exit 1
fi

echo "[6d/7] Verifying AI Media rollout remains dark..."
if ! DEPLOY_DIR="$DEPLOY_DIR" ENV_FILE="$ENV_FILE" \
  node "$DEPLOY_ENV_TOOL" exec-check "$DEPLOY_ENV_SNAPSHOT" "$DEPLOY_DIR" -- \
    bash scripts/verify-ai-media-dark.sh; then
  echo "ERROR: AI Media rollout is not dark; Worker/API remain stopped" >&2
  exit 1
fi

echo "[6/7] Restarting services..."
sudo env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
  HOME=/root LANG=C.UTF-8 \
  node "$DEPLOY_ENV_TOOL" compare "$DEPLOY_DIR/$ENV_FILE" "$DEPLOY_ENV_SNAPSHOT"
sudo systemctl restart "$WORKER_SERVICE"
sudo systemctl restart "$API_SERVICE"
sudo systemctl restart "$WEB_SERVICE"

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

SERVICES_QUIESCED=0
restore_source_ownership

echo ""
echo "=== Deploy complete ==="

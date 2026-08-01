#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '[deploy-source] ERROR: %s\n' "$*" >&2
  exit 1
}

MODE="${1:-}"
TARGET_GIT_COMMIT="${2:-}"
SOURCE_ROOT="${3:-}"
RUN_USER="${4:-}"
ENV_FILE_NAME="${5:-}"
SEALED_ENV_FILE_NAME="${6:-}"
VERIFY_MOUNT_LIST=""
VERIFY_PATH_LIST=""
SEALED_ROOT=""
SEALED_COMPLETE=0

cleanup() {
  [ -n "$VERIFY_MOUNT_LIST" ] && rm -f -- "$VERIFY_MOUNT_LIST"
  [ -n "$VERIFY_PATH_LIST" ] && rm -f -- "$VERIFY_PATH_LIST"
  if [ "$SEALED_COMPLETE" = "0" ] && [ -n "$SEALED_ROOT" ] && [ -d "$SEALED_ROOT" ]; then
    rm -rf -- "$SEALED_ROOT"
  fi
}
trap cleanup EXIT

if [ "$(id -u)" != "0" ]; then
  fail "deployment source ownership changes must run as root"
fi
for required_command in chown chmod cmp cp find findmnt mktemp readlink stat; do
  command -v "$required_command" >/dev/null 2>&1 \
    || fail "required command is missing: $required_command"
done
if [ "$MODE" != "freeze" ] && [ "$MODE" != "seal" ] \
  && [ "$MODE" != "verify" ] && [ "$MODE" != "thaw" ]; then
  fail "mode must be freeze, seal, verify, or thaw"
fi
if [[ ! "$TARGET_GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  fail "target commit must be one lowercase full 40-character object ID"
fi
case "$SOURCE_ROOT" in
  /*) ;;
  *) fail "source root must be an absolute path" ;;
esac
if [ -L "$SOURCE_ROOT" ] || [ ! -d "$SOURCE_ROOT" ] \
  || [ "$(readlink -f -- "$SOURCE_ROOT")" != "$SOURCE_ROOT" ]; then
  fail "source root must be one real canonical directory"
fi
MARKER="$SOURCE_ROOT/DEPLOYED_COMMIT"
if [ -L "$MARKER" ] || [ ! -f "$MARKER" ] \
  || [ "$(stat -c '%h' "$MARKER")" != "1" ] \
  || ! printf '%s\n' "$TARGET_GIT_COMMIT" | cmp -s -- - "$MARKER"; then
  fail "deployment source marker does not match the target commit"
fi

verify_frozen_source() {
  local path_entry
  local relative
  local resolved
  local metadata
  local mount_target
  VERIFY_MOUNT_LIST="$(mktemp /run/ss-erp-deploy-mounts.XXXXXX)"
  VERIFY_PATH_LIST="$(mktemp /run/ss-erp-deploy-paths.XXXXXX)"
  chmod 0600 "$VERIFY_MOUNT_LIST" "$VERIFY_PATH_LIST"
  findmnt -rn -o TARGET > "$VERIFY_MOUNT_LIST" \
    || fail "could not enumerate deployment source mounts"
  find -P "$SOURCE_ROOT" -xdev -mindepth 1 -print0 > "$VERIFY_PATH_LIST" \
    || fail "could not enumerate deployment source entries"
  while IFS= read -r mount_target; do
    case "$mount_target/" in
      "$SOURCE_ROOT/"|"$SOURCE_ROOT"/*/) fail "deployment source must not contain a mount point" ;;
    esac
  done < "$VERIFY_MOUNT_LIST"

  while IFS= read -r -d '' path_entry; do
    relative="${path_entry#"$SOURCE_ROOT"/}"
    case "$relative" in
      apps/web/.next/cache)
        if [ -L "$path_entry" ]; then
          :
        elif [ ! -d "$path_entry" ]; then
          fail "runtime Web cache root is not a directory or managed symlink"
        else
          continue
        fi
        ;;
      apps/web/.next/cache/*)
        if [ -L "$path_entry" ] || { [ ! -d "$path_entry" ] && [ ! -f "$path_entry" ]; }; then
          fail "runtime Web cache contains an unsupported entry: $relative"
        fi
        continue
        ;;
    esac
    if [ -L "$path_entry" ]; then
      if [ "$(stat -c '%u' "$path_entry")" != "0" ]; then
        fail "deployment source symlink must be root-owned: $relative"
      fi
      case "$relative" in
        .env.*|backups|apps/server/public/uploads|apps/server/public/watermarked|\
        apps/server/public/resized|apps/server/public/tmp|tmp/ai-image-sandbox|\
        tmp/ai-image-translation-sandbox|apps/web/.next/cache) continue ;;
      esac
      resolved="$(readlink -f -- "$path_entry")"
      case "$resolved/" in
        "$SOURCE_ROOT"/*/) ;;
        *) fail "deployment source symlink escapes the frozen source: $relative" ;;
      esac
      continue
    fi
    if [ ! -d "$path_entry" ] && [ ! -f "$path_entry" ]; then
      fail "deployment source contains an unsupported filesystem entry: $relative"
    fi
    metadata="$(stat -c '%u:%a' "$path_entry")"
    if [ "${metadata%%:*}" != "0" ] \
      || (( (8#${metadata#*:} & 8#022) != 0 )); then
      fail "deployment source entry is not frozen: $relative"
    fi
  done < "$VERIFY_PATH_LIST"
  rm -f -- "$VERIFY_MOUNT_LIST" "$VERIFY_PATH_LIST"
  VERIFY_MOUNT_LIST=""
  VERIFY_PATH_LIST=""
}

if [ "$MODE" = "seal" ]; then
  SEALED_ROOT="$RUN_USER"
  SEALED_RUN_USER="$ENV_FILE_NAME"
  case "$SEALED_ROOT" in
    /*) ;;
    *) fail "sealed source destination must be an absolute path" ;;
  esac
  if [ "$(readlink -m -- "$SEALED_ROOT")" != "$SEALED_ROOT" ] \
    || [ "$(dirname -- "$SEALED_ROOT")" != "$(dirname -- "$SOURCE_ROOT")" ] \
    || [ -e "$SEALED_ROOT" ] || [ -L "$SEALED_ROOT" ]; then
    fail "sealed source destination must be a new canonical sibling"
  fi
  if [[ ! "$SEALED_RUN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] \
    || ! id "$SEALED_RUN_USER" >/dev/null 2>&1 \
    || [ "$(id -u "$SEALED_RUN_USER")" = "0" ]; then
    fail "sealed source runtime user must be one non-root system identity"
  fi
  SEALED_RUN_GROUP="$(id -gn "$SEALED_RUN_USER")"
  parent="$(dirname -- "$SOURCE_ROOT")"
  while true; do
    mode="$(stat -c '%a' "$parent")"
    if [ -L "$parent" ] || [ ! -d "$parent" ] \
      || [ "$(readlink -f -- "$parent")" != "$parent" ] \
      || [ "$(stat -c '%u' "$parent")" != "0" ] \
      || (( (8#$mode & 8#022) != 0 )); then
      fail "sealed source parent chain must be root-owned and non-writable"
    fi
    [ "$parent" = "/" ] && break
    parent="$(dirname -- "$parent")"
  done
  mkdir -m 0700 "$SEALED_ROOT"
  cp -a --reflink=never -- "$SOURCE_ROOT/." "$SEALED_ROOT/"
  SOURCE_ROOT="$SEALED_ROOT"
  MARKER="$SOURCE_ROOT/DEPLOYED_COMMIT"
  chown -hR -P "root:$SEALED_RUN_GROUP" -- "$SOURCE_ROOT"
  find -P "$SOURCE_ROOT" -xdev -type d \
    -exec chmod u+rwx,g+rx,o-rwx -- {} +
  find -P "$SOURCE_ROOT" -xdev -type f \
    -exec chmod u+rw,g+rX,o-rwx -- {} +
  if [ -n "$SEALED_ENV_FILE_NAME" ] && [ -e "$SOURCE_ROOT/$SEALED_ENV_FILE_NAME" ]; then
    if [[ ! "$SEALED_ENV_FILE_NAME" =~ ^\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] \
      || [ -L "$SOURCE_ROOT/$SEALED_ENV_FILE_NAME" ] \
      || [ ! -f "$SOURCE_ROOT/$SEALED_ENV_FILE_NAME" ] \
      || [ "$(stat -c '%h' "$SOURCE_ROOT/$SEALED_ENV_FILE_NAME")" != "1" ]; then
      fail "sealed deployment environment file is not a trusted regular file"
    fi
    chmod 0640 "$SOURCE_ROOT/$SEALED_ENV_FILE_NAME"
  fi
  chmod 0755 "$SOURCE_ROOT"
  chmod 0444 "$MARKER"
  verify_frozen_source
  SEALED_COMPLETE=1
  printf '[deploy-source] Sealed source on new inodes: %s\n' "$SOURCE_ROOT"
  exit 0
fi

if [ "$MODE" = "freeze" ]; then
  chown -hR -P root:root -- "$SOURCE_ROOT"
  find -P "$SOURCE_ROOT" -xdev \( -type d -o -type f \) -exec chmod go-w -- {} +
  chmod 0444 "$MARKER"
  verify_frozen_source
  printf '[deploy-source] Frozen source for migration: %s\n' "$SOURCE_ROOT"
  exit 0
fi

if [ "$MODE" = "verify" ]; then
  verify_frozen_source
  printf '[deploy-source] Verified frozen migration source: %s\n' "$SOURCE_ROOT"
  exit 0
fi

if [[ ! "$RUN_USER" =~ ^[a-z_][a-z0-9_-]{0,31}$ ]] || ! id "$RUN_USER" >/dev/null 2>&1; then
  fail "deployment runtime user is invalid"
fi
RUN_GROUP="$(id -gn "$RUN_USER")"
if [ "$(stat -c '%u' "$SOURCE_ROOT")" != "0" ]; then
  fail "only a root-owned frozen source can be thawed"
fi
chown -hR -P "$RUN_USER:$RUN_GROUP" -- "$SOURCE_ROOT"
chown "$RUN_USER:$RUN_GROUP" "$MARKER"
chmod 0644 "$MARKER"
if [ -n "$ENV_FILE_NAME" ]; then
  if [[ ! "$ENV_FILE_NAME" =~ ^\.[A-Za-z0-9][A-Za-z0-9._-]{0,63}$ ]] \
    || [ -L "$SOURCE_ROOT/$ENV_FILE_NAME" ] \
    || [ ! -f "$SOURCE_ROOT/$ENV_FILE_NAME" ] \
    || [ "$(stat -c '%h' "$SOURCE_ROOT/$ENV_FILE_NAME")" != "1" ]; then
    fail "deployment environment file is not a trusted regular file"
  fi
  chown "root:$RUN_GROUP" "$SOURCE_ROOT/$ENV_FILE_NAME"
  chmod 0640 "$SOURCE_ROOT/$ENV_FILE_NAME"
fi
printf '[deploy-source] Restored checkout ownership: %s\n' "$SOURCE_ROOT"

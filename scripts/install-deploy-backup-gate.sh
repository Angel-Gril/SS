#!/usr/bin/env bash
set -euo pipefail

fail() {
  printf '[install-deploy-gate] ERROR: %s\n' "$*" >&2
  exit 1
}

TARGET_GIT_COMMIT="${1:-}"
SOURCE_ROOT="${2:-}"
GATE_ROOT="${3:-/usr/local/lib/ss-erp-deploy-gate}"
FILES=(
  deploy-backup-gate.mjs
  deploy-backup-attestation.mjs
  deploy-database-identity.mjs
  deploy-environment.mjs
  deploy-maintenance-gate.sh
  deploy-source-manifest.mjs
  freeze-deploy-source.sh
  git-commit-tree.mjs
  verify-deploy-build-inputs.mjs
  verify-deploy-backup.sh
)
STAGE_DIR=""

cleanup() {
  if [ -n "$STAGE_DIR" ] && [ -d "$STAGE_DIR" ]; then
    rm -rf -- "$STAGE_DIR"
  fi
}
trap cleanup EXIT

if [ "$(id -u)" != "0" ]; then
  fail "the deployment gate installer must run as root"
fi
if [[ ! "$TARGET_GIT_COMMIT" =~ ^[0-9a-f]{40}$ ]]; then
  fail "target commit must be one lowercase full 40-character object ID"
fi
case "$SOURCE_ROOT" in
  /*) ;;
  *) fail "source root must be an absolute path" ;;
esac
case "$GATE_ROOT" in
  /*) ;;
  *) fail "gate root must be an absolute path" ;;
esac
if [ "$(readlink -f -- "$SOURCE_ROOT")" != "$SOURCE_ROOT" ] \
  || [ -L "$SOURCE_ROOT" ] || [ ! -d "$SOURCE_ROOT" ]; then
  fail "source root must be one real canonical directory"
fi
if [ "$(readlink -m -- "$GATE_ROOT")" != "$GATE_ROOT" ]; then
  fail "gate root must be one canonical absolute path"
fi

assert_trusted_directory() {
  local directory="$1"
  local mode
  if [ -L "$directory" ] || [ ! -d "$directory" ] \
    || [ "$(stat -c '%u' "$directory" 2>/dev/null)" != "0" ]; then
    fail "trusted directory must be root-owned and non-symbolic: $directory"
  fi
  mode="$(stat -c '%a' "$directory")"
  if (( (8#$mode & 8#022) != 0 )); then
    fail "trusted directory must not be group/world writable: $directory"
  fi
}

assert_trusted_ancestor_chain() {
  local current="$1"
  while true; do
    assert_trusted_directory "$current"
    [ "$current" = "/" ] && break
    current="$(dirname -- "$current")"
  done
}

assert_trusted_file() {
  local file="$1"
  local mode
  if [ -L "$file" ] || [ ! -f "$file" ] || [ ! -s "$file" ] \
    || [ "$(stat -c '%u' "$file" 2>/dev/null)" != "0" ]; then
    fail "trusted file must be root-owned, nonempty, regular, and non-symbolic: $file"
  fi
  mode="$(stat -c '%a' "$file")"
  if (( (8#$mode & 8#022) != 0 )); then
    fail "trusted file must not be group/world writable: $file"
  fi
}

assert_trusted_ancestor_chain "$SOURCE_ROOT"
assert_trusted_directory "$SOURCE_ROOT/scripts"
for name in "${FILES[@]}"; do
  assert_trusted_file "$SOURCE_ROOT/scripts/$name"
done

GATE_PARENT="$(dirname -- "$GATE_ROOT")"
assert_trusted_ancestor_chain "$GATE_PARENT"
install -d -o root -g root -m 0755 "$GATE_ROOT"
assert_trusted_ancestor_chain "$GATE_ROOT"
TARGET_DIR="$GATE_ROOT/$TARGET_GIT_COMMIT"

if [ -e "$TARGET_DIR" ] || [ -L "$TARGET_DIR" ]; then
  assert_trusted_directory "$TARGET_DIR"
  assert_trusted_file "$TARGET_DIR/TARGET_GIT_COMMIT"
  if ! printf '%s\n' "$TARGET_GIT_COMMIT" | cmp -s -- - "$TARGET_DIR/TARGET_GIT_COMMIT"; then
    fail "existing target gate marker is invalid"
  fi
  for name in "${FILES[@]}"; do
    assert_trusted_file "$TARGET_DIR/$name"
    cmp -s -- "$SOURCE_ROOT/scripts/$name" "$TARGET_DIR/$name" \
      || fail "existing target gate differs for $name"
  done
  printf '[install-deploy-gate] Reusing exact target gate: %s\n' "$TARGET_DIR"
  exit 0
fi

STAGE_DIR="$(mktemp -d "$GATE_ROOT/.${TARGET_GIT_COMMIT}.XXXXXX")"
chmod 0700 "$STAGE_DIR"
for name in "${FILES[@]}"; do
  install -o root -g root -m 0755 "$SOURCE_ROOT/scripts/$name" "$STAGE_DIR/$name"
done
printf '%s\n' "$TARGET_GIT_COMMIT" > "$STAGE_DIR/TARGET_GIT_COMMIT"
chmod 0444 "$STAGE_DIR/TARGET_GIT_COMMIT"
sync -f "$STAGE_DIR"
chmod 0755 "$STAGE_DIR"
mv -T -- "$STAGE_DIR" "$TARGET_DIR"
STAGE_DIR=""
sync -f "$GATE_ROOT"
printf '[install-deploy-gate] Installed target gate: %s\n' "$TARGET_DIR"

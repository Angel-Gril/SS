#!/bin/sh
set -eu

MIGRATION_TIMEOUT="${MIGRATION_TIMEOUT:-20m}"
duration="${MIGRATION_TIMEOUT%?}"
unit="${MIGRATION_TIMEOUT#"$duration"}"

case "$duration" in
  [1-9]*)
    case "$duration" in
      *[!0-9]*)
        echo "ERROR: MIGRATION_TIMEOUT must be a positive duration ending in s, m, or h" >&2
        exit 1
        ;;
    esac
    ;;
  *)
    echo "ERROR: MIGRATION_TIMEOUT must be a positive duration ending in s, m, or h" >&2
    exit 1
    ;;
esac

case "$unit" in
  s|m|h) ;;
  *)
    echo "ERROR: MIGRATION_TIMEOUT must be a positive duration ending in s, m, or h" >&2
    exit 1
    ;;
esac

case "${DEPLOY_TARGET_GIT_COMMIT:-}" in
  *[!0-9a-f]*|'') echo "ERROR: DEPLOY_TARGET_GIT_COMMIT is invalid" >&2; exit 1 ;;
esac
case "${DEPLOY_SOURCE_ARCHIVE_SHA256:-}" in
  *[!0-9a-f]*|'') echo "ERROR: DEPLOY_SOURCE_ARCHIVE_SHA256 is invalid" >&2; exit 1 ;;
esac
if [ "${#DEPLOY_TARGET_GIT_COMMIT}" -ne 40 ] \
  || [ "${#DEPLOY_SOURCE_ARCHIVE_SHA256}" -ne 64 ] \
  || [ -L DEPLOYED_COMMIT ] || [ ! -f DEPLOYED_COMMIT ] \
  || [ -L DEPLOYED_SOURCE_ARCHIVE_SHA256 ] || [ ! -f DEPLOYED_SOURCE_ARCHIVE_SHA256 ] \
  || [ "$(cat DEPLOYED_COMMIT)" != "$DEPLOY_TARGET_GIT_COMMIT" ] \
  || [ "$(cat DEPLOYED_SOURCE_ARCHIVE_SHA256)" != "$DEPLOY_SOURCE_ARCHIVE_SHA256" ]; then
  echo "ERROR: migration image provenance does not match the requested source snapshot" >&2
  exit 1
fi

bash scripts/verify-deploy-backup.sh "${DEPLOY_TARGET_GIT_COMMIT:?DEPLOY_TARGET_GIT_COMMIT is required}"
timeout --signal=TERM --kill-after=30s "$MIGRATION_TIMEOUT" npx prisma migrate deploy
timeout --signal=TERM --kill-after=30s "$MIGRATION_TIMEOUT" node scripts/verify-ai-media-suite-post-migration.mjs
node scripts/verify-ai-media-dark.mjs

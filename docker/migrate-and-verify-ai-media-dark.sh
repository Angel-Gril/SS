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

timeout --signal=TERM --kill-after=30s "$MIGRATION_TIMEOUT" npx prisma migrate deploy
node scripts/verify-ai-media-dark.mjs

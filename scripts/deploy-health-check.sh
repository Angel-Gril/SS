#!/usr/bin/env bash
set -euo pipefail

readonly MAX_ATTEMPTS=30
readonly RETRY_DELAY_SECONDS=1

health_url="${1:-}"
allowed_statuses="${2:-200}"
if [ -z "$health_url" ]; then
  printf '[deploy-health] ERROR: health URL is required\n' >&2
  exit 1
fi
if [[ ! "$allowed_statuses" =~ ^[0-9]{3}(,[0-9]{3})*$ ]]; then
  printf '[deploy-health] ERROR: allowed HTTP statuses are invalid\n' >&2
  exit 1
fi

attempt=1
while true; do
  http_code=""
  if http_code="$(curl --silent --show-error --max-time 2 \
    --output /dev/null --write-out '%{http_code}' "$health_url")"; then
    case ",$allowed_statuses," in
      *,"$http_code",*)
        printf '[deploy-health] PASS after %s attempt(s) (HTTP %s)\n' "$attempt" "$http_code"
        exit 0
        ;;
    esac
  else
    http_code=000
  fi
  printf '[deploy-health] attempt %s returned HTTP %s\n' "$attempt" "$http_code" >&2
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then
    printf '[deploy-health] ERROR: health check failed after %s attempts\n' \
      "$MAX_ATTEMPTS" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  sleep "$RETRY_DELAY_SECONDS"
done

#!/usr/bin/env bash
set -euo pipefail

# Restricted hosted-AI pilot deployment. This entrypoint never changes flags;
# the target release must prove the explicit pilot snapshot after migration and
# before switching current or restarting services.

if [ "${AI_MEDIA_ROLLOUT_EXPECTATION:-}" != "hosted-pilot" ]; then
  echo '[deploy-pilot] ERROR: AI_MEDIA_ROLLOUT_EXPECTATION=hosted-pilot is required' >&2
  exit 1
fi
if [ -z "${AI_MEDIA_PILOT_EXPECTATIONS_JSON:-}" ]; then
  echo '[deploy-pilot] ERROR: AI_MEDIA_PILOT_EXPECTATIONS_JSON is required' >&2
  exit 1
fi
if [ "${#AI_MEDIA_PILOT_EXPECTATIONS_JSON}" -gt 65536 ]; then
  echo '[deploy-pilot] ERROR: AI_MEDIA_PILOT_EXPECTATIONS_JSON is too large' >&2
  exit 1
fi
node -e 'JSON.parse(process.argv[1])' "$AI_MEDIA_PILOT_EXPECTATIONS_JSON" \
  || { echo '[deploy-pilot] ERROR: AI_MEDIA_PILOT_EXPECTATIONS_JSON must be valid JSON' >&2; exit 1; }

exec bash scripts/deploy.sh "$@"

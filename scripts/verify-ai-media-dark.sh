#!/usr/bin/env bash
# Verify the AI Media entry-point flags and tenant rollout remain disabled in SystemConfig.

set -euo pipefail

DEPLOY_DIR="${DEPLOY_DIR:-/opt/ss-erp/app}"
ENV_FILE="${ENV_FILE:-.env.staging}"
SERVER_DIR="${DEPLOY_DIR}/apps/server"
ENV_PATH="${DEPLOY_DIR}/${ENV_FILE}"
POLICY_VERIFIER="${DEPLOY_DIR}/scripts/verify-ai-media-dark-policy.mjs"

if [ ! -d "$SERVER_DIR" ]; then
  echo "FAIL AI Media dark-rollout check: server directory missing: $SERVER_DIR" >&2
  exit 1
fi
if [ ! -r "$ENV_PATH" ]; then
  echo "FAIL AI Media dark-rollout check: env file missing or unreadable: $ENV_PATH" >&2
  exit 1
fi
if [ ! -r "$POLICY_VERIFIER" ]; then
  echo "FAIL AI Media dark-rollout check: policy verifier missing or unreadable: $POLICY_VERIFIER" >&2
  exit 1
fi

query_error="/tmp/ss-erp-ai-media-dark.$$"
trap 'rm -f "$query_error"' EXIT

if ! rows=$(
  cd "$SERVER_DIR"
  AI_MEDIA_ENV_PATH="$ENV_PATH" node --input-type=module <<'NODE' 2>"$query_error"
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config({ path: process.env.AI_MEDIA_ENV_PATH });
const prisma = new PrismaClient();
try {
  const rows = await prisma.systemConfig.findMany({
    where: {
      key: {
        in: [
          'feature_ai_media_workflow_v2',
          'feature_ai_media_image_to_image',
          'feature_ai_media_suite',
          'feature_ai_media_full_edit',
          'feature_ai_media_inpaint',
          'feature_source_listing_web_media',
          'feature_source_listing_extension_workbench',
          'feature_source_ozon_publisher_v2',
          'ai_image_generation_enabled',
          'ai_image_provider',
          'feature_image_translate',
          'ai_image_translation_provider',
          'ai_media_workflow_v2_rollout_policy',
        ],
      },
    },
    select: { key: true, value: true },
  });
  process.stdout.write(JSON.stringify(rows));
} finally {
  await prisma.$disconnect();
}
NODE
); then
  echo "FAIL AI Media dark-rollout check could not read SystemConfig: $(tr '\n' ' ' <"$query_error")" >&2
  exit 1
fi

node "$POLICY_VERIFIER" "$rows"

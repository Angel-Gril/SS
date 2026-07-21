#!/usr/bin/env node

import { PrismaClient } from '@prisma/client';
import { verifyAiMediaDarkPolicy } from './verify-ai-media-dark-policy.mjs';

const keys = [
  'feature_ai_media_workflow_v2',
  'feature_ai_media_image_to_image',
  'feature_ai_media_suite',
  'feature_ai_media_full_edit',
  'feature_ai_media_inpaint',
  'feature_source_listing_web_media',
  'feature_source_listing_extension_workbench',
  'ai_image_generation_enabled',
  'ai_image_provider',
  'feature_image_translate',
  'ai_image_translation_provider',
  'ai_media_workflow_v2_rollout_policy',
];

const prisma = new PrismaClient();
try {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: keys } },
    select: { key: true, value: true },
  });
  const result = verifyAiMediaDarkPolicy(rows);
  console.log(
    `PASS AI Media rollout is dark (master=${result.master}; imageToImage=${result.imageToImage}; suite=${result.suite}; fullEdit=${result.fullEdit}; inpaint=${result.inpaint}; webMedia=${result.webMedia}; extensionWorkbench=${result.extensionWorkbench}; legacyGeneration=${result.legacyGeneration}; imageTranslation=${result.imageTranslation}; policy=${result.policy})`,
  );
} catch (error) {
  console.error(
    `FAIL AI Media rollout is not dark: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
} finally {
  try {
    await prisma.$disconnect();
  } catch (error) {
    console.error(
      `FAIL AI Media dark-rollout verifier could not disconnect: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

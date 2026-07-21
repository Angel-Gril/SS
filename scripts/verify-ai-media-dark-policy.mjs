#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

function fail(message) {
  throw new Error(message);
}

function verifyDarkFlag(values, key) {
  const value = values.get(key);
  if (value !== undefined && value.trim() !== 'false') {
    fail(`${key} must be false or absent, found ${JSON.stringify(value)}`);
  }
  return value === undefined ? 'absent' : 'false';
}

function verifyInactiveProviderChannel(values, enabledKey, providerKey) {
  const rawEnabled = values.get(enabledKey);
  if (rawEnabled !== undefined && !['true', 'false'].includes(rawEnabled.trim())) {
    fail(`${enabledKey} must be true, false, or absent, found ${JSON.stringify(rawEnabled)}`);
  }
  const enabled = rawEnabled?.trim() === 'true';
  const provider = (values.get(providerKey) || 'disabled').trim();
  if (enabled && provider !== 'disabled') {
    fail(`${enabledKey} and ${providerKey} must not activate a paid Provider while AI Media is dark`);
  }
  return `${enabled ? 'enabled' : rawEnabled === undefined ? 'absent' : 'disabled'}/${provider || 'invalid'}`;
}

export function verifyAiMediaDarkPolicy(rows) {
  if (!Array.isArray(rows)) fail('SystemConfig query did not return an array');

  const values = new Map();
  for (const row of rows) {
    if (!row || typeof row.key !== 'string' || typeof row.value !== 'string') {
      fail('SystemConfig row is invalid');
    }
    values.set(row.key, row.value);
  }

  const master = verifyDarkFlag(values, 'feature_ai_media_workflow_v2');
  const imageToImage = verifyDarkFlag(values, 'feature_ai_media_image_to_image');
  const suite = verifyDarkFlag(values, 'feature_ai_media_suite');
  const fullEdit = verifyDarkFlag(values, 'feature_ai_media_full_edit');
  const inpaint = verifyDarkFlag(values, 'feature_ai_media_inpaint');
  const webMedia = verifyDarkFlag(values, 'feature_source_listing_web_media');
  const extensionWorkbench = verifyDarkFlag(values, 'feature_source_listing_extension_workbench');
  const legacyGeneration = verifyInactiveProviderChannel(
    values,
    'ai_image_generation_enabled',
    'ai_image_provider',
  );
  const imageTranslation = verifyInactiveProviderChannel(
    values,
    'feature_image_translate',
    'ai_image_translation_provider',
  );

  const rawPolicy = values.get('ai_media_workflow_v2_rollout_policy');
  if (rawPolicy === undefined) {
    return {
      master, imageToImage, suite, fullEdit, inpaint, webMedia,
      extensionWorkbench, legacyGeneration, imageTranslation, policy: 'absent',
    };
  }

  let policy;
  try {
    policy = JSON.parse(rawPolicy);
  } catch {
    fail('ai_media_workflow_v2_rollout_policy must be valid JSON');
  }
  if (!policy || Array.isArray(policy) || typeof policy !== 'object') {
    fail('ai_media_workflow_v2_rollout_policy must be a JSON object');
  }
  if (!Number.isSafeInteger(policy.revision) || policy.revision < 0) {
    fail('ai_media_workflow_v2_rollout_policy revision must be a non-negative safe integer');
  }
  if (!Array.isArray(policy.tenantIds)) {
    fail('ai_media_workflow_v2_rollout_policy tenantIds must be an array');
  }
  if (policy.tenantIds.length !== 0) {
    fail(
      `ai_media_workflow_v2_rollout_policy must not allow tenants, found ${policy.tenantIds.length}`,
    );
  }

  return {
    master,
    imageToImage,
    suite,
    fullEdit,
    inpaint,
    webMedia,
    extensionWorkbench,
    legacyGeneration,
    imageTranslation,
    policy: `revision:${policy.revision},tenantIds:0`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const rows = JSON.parse(process.argv[2] || 'null');
    const result = verifyAiMediaDarkPolicy(rows);
    console.log(
      `PASS AI Media rollout is dark (master=${result.master}; imageToImage=${result.imageToImage}; suite=${result.suite}; fullEdit=${result.fullEdit}; inpaint=${result.inpaint}; webMedia=${result.webMedia}; extensionWorkbench=${result.extensionWorkbench}; legacyGeneration=${result.legacyGeneration}; imageTranslation=${result.imageTranslation}; policy=${result.policy})`,
    );
  } catch (error) {
    console.error(
      `FAIL AI Media rollout is not dark: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

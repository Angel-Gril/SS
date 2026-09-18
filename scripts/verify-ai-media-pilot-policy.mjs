#!/usr/bin/env node

import { realpathSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const REQUIRED_FLAGS = Object.freeze([
  'feature_ai_media_workflow_v2',
  'feature_ai_media_suite',
  'feature_extension_hosted_ai',
  'feature_source_listing_workflow',
  'feature_source_listing_extension_workbench',
  'feature_source_listing_web_media',
]);

const OPERATION_FLAGS = Object.freeze({
  IMAGE_TO_IMAGE: 'feature_ai_media_image_to_image',
  FULL_EDIT: 'feature_ai_media_full_edit',
  INPAINT: 'feature_ai_media_inpaint',
});

const FORBIDDEN_FLAGS = Object.freeze([
  'feature_source_ozon_publisher_v2',
  'feature_extension_byok_ai',
  'feature_extension_byok_ingest',
  'feature_extension_byok_publish',
]);

const REQUIRED_SCOPES = Object.freeze([
  'capture:write',
  'listing:review',
  'listing:write',
  'media:execute',
]);
const OPERATIONS = new Set(['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT', 'SUITE']);

function fail(message) {
  throw new Error(message);
}

function exactObject(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail(`${label} has unexpected or missing fields`);
  }
  return value;
}

function identifierList(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 50) {
    fail(`${label} must be a non-empty list`);
  }
  const result = value.map((item) => {
    if (typeof item !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/u.test(item)) {
      fail(`${label} contains an invalid identifier`);
    }
    return item;
  });
  if (new Set(result).size !== result.length) fail(`${label} contains duplicates`);
  return result;
}

function sameList(actual, expected, label) {
  if (actual.length !== expected.length || actual.some((item, index) => item !== expected[index])) {
    fail(`${label} does not match the explicit pilot expectation`);
  }
}

function parsePolicy(rows, key) {
  const row = rows.find((candidate) => candidate?.key === key);
  if (!row || typeof row.value !== 'string') fail(`${key} is required`);
  try {
    return JSON.parse(row.value);
  } catch {
    fail(`${key} must be valid JSON`);
  }
}

function parseExpected(expected) {
  exactObject(expected, [
    'ownerUserIds',
    'shopIds',
    'deviceSessionIds',
    'rolloutRevision',
    'sourcePolicyRevision',
    'allowedOperations',
  ], 'pilot expectation');
  const operations = expected.allowedOperations;
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > OPERATIONS.size
    || operations.some((operation) => !OPERATIONS.has(operation))
    || new Set(operations).size !== operations.length) {
    fail('pilot expectation.allowedOperations is invalid');
  }
  if (!Number.isSafeInteger(expected.rolloutRevision) || expected.rolloutRevision < 0) {
    fail('pilot expectation.rolloutRevision is invalid');
  }
  if (typeof expected.sourcePolicyRevision !== 'string' || !expected.sourcePolicyRevision.trim()) {
    fail('pilot expectation.sourcePolicyRevision is invalid');
  }
  return {
    ownerUserIds: identifierList(expected.ownerUserIds, 'pilot expectation.ownerUserIds'),
    shopIds: identifierList(expected.shopIds, 'pilot expectation.shopIds'),
    deviceSessionIds: identifierList(expected.deviceSessionIds, 'pilot expectation.deviceSessionIds'),
    rolloutRevision: expected.rolloutRevision,
    sourcePolicyRevision: expected.sourcePolicyRevision,
    allowedOperations: [...operations],
  };
}

export function verifyAiMediaHostedPilotPolicy(snapshot, rawExpected) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    fail('pilot snapshot must be an object');
  }
  if (!Array.isArray(snapshot.configRows) || !Array.isArray(snapshot.deviceSessions)) {
    fail('pilot snapshot requires configRows and deviceSessions arrays');
  }
  const expected = parseExpected(rawExpected);
  const values = new Map();
  for (const row of snapshot.configRows) {
    if (!row || typeof row.key !== 'string' || typeof row.value !== 'string' || values.has(row.key)) {
      fail('pilot config rows are invalid or duplicated');
    }
    values.set(row.key, row.value);
  }
  for (const key of REQUIRED_FLAGS) {
    if (values.get(key)?.trim() !== 'true') fail(`${key} must be true for hosted pilot`);
  }
  for (const operation of expected.allowedOperations) {
    const key = OPERATION_FLAGS[operation];
    if (key && values.get(key)?.trim() !== 'true') {
      fail(`${key} must be true for the explicitly allowed ${operation} operation`);
    }
  }
  for (const key of FORBIDDEN_FLAGS) {
    if (values.has(key) && values.get(key)?.trim() === 'true') fail(`${key} must remain false for hosted pilot`);
  }

  const aiPolicy = parsePolicy(snapshot.configRows, 'ai_media_workflow_v2_rollout_policy');
  exactObject(aiPolicy, ['revision', 'tenantIds', 'mode'], 'ai_media_workflow_v2_rollout_policy');
  if (aiPolicy.mode !== 'allowlist' || aiPolicy.revision !== expected.rolloutRevision) {
    fail('AI Media rollout policy is not the expected allowlist revision');
  }
  sameList(identifierList(aiPolicy.tenantIds, 'ai_media_workflow_v2_rollout_policy.tenantIds'), expected.ownerUserIds,
    'AI Media rollout policy tenantIds');

  const sourcePolicy = parsePolicy(snapshot.configRows, 'source_workflow_rollout_policy');
  if (!sourcePolicy || typeof sourcePolicy !== 'object' || Array.isArray(sourcePolicy)
    || sourcePolicy.revision !== expected.sourcePolicyRevision
    || !sourcePolicy.features || typeof sourcePolicy.features !== 'object') {
    fail('source_workflow_rollout_policy is not the expected revision');
  }
  for (const [feature, requireShop] of [
    ['SOURCE_LISTING_WORKFLOW', true],
    ['SOURCE_LISTING_EXTENSION_WORKBENCH', false],
    ['SOURCE_LISTING_WEB_MEDIA', false],
  ]) {
    const policy = sourcePolicy.features[feature];
    if (!policy || policy.mode !== 'pilot') fail(`${feature} must be in pilot mode`);
    sameList(identifierList(policy.ownerUserIds, `${feature}.ownerUserIds`), expected.ownerUserIds,
      `${feature}.ownerUserIds`);
    if (requireShop) sameList(identifierList(policy.shopIds, `${feature}.shopIds`), expected.shopIds, `${feature}.shopIds`);
  }
  const listing = sourcePolicy.features.SOURCE_LISTING_WORKFLOW;
  if (listing.listingStage !== 'dual_read' || JSON.stringify(listing.platforms) !== JSON.stringify(['OZON'])) {
    fail('SOURCE_LISTING_WORKFLOW must remain dual_read and OZON-only');
  }

  const sessions = snapshot.deviceSessions;
  const sessionIds = sessions.map((session) => session?.id);
  sameList(identifierList(sessionIds, 'deviceSessions.ids'), expected.deviceSessionIds, 'active device session ids');
  for (const session of sessions) {
    if (!session || session.status !== 'ACTIVE' || session.actorUserId !== session.ownerUserId
      || !expected.ownerUserIds.includes(session.ownerUserId)) {
      fail('pilot device session is not an active owner session');
    }
    sameList(identifierList(session.scopes, `device session ${session.id}.scopes`), REQUIRED_SCOPES,
      `device session ${session.id}.scopes`);
    sameList(identifierList(session.shopIds, `device session ${session.id}.shopIds`), expected.shopIds,
      `device session ${session.id}.shopIds`);
  }
  return {
    expectation: 'hosted-pilot',
    ownerUserIds: expected.ownerUserIds,
    shopIds: expected.shopIds,
    deviceSessionIds: expected.deviceSessionIds,
    rolloutRevision: expected.rolloutRevision,
    sourcePolicyRevision: expected.sourcePolicyRevision,
    allowedOperations: expected.allowedOperations,
  };
}

if (process.argv[1]
  && realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]))) {
  try {
    if (process.argv.length !== 4) fail('usage: verify-ai-media-pilot-policy.mjs <snapshot-json> <expectation-json>');
    const result = verifyAiMediaHostedPilotPolicy(JSON.parse(process.argv[2]), JSON.parse(process.argv[3]));
    console.log(`PASS AI Media hosted pilot contract (owners=${result.ownerUserIds.length}; shops=${result.shopIds.length}; devices=${result.deviceSessionIds.length}; operations=${result.allowedOperations.join(',')}; rolloutRevision=${result.rolloutRevision})`);
  } catch (error) {
    console.error(`FAIL AI Media hosted pilot contract: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}

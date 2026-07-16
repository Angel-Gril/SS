#!/usr/bin/env node

import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

function fail(message) {
  throw new Error(message);
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

  const master = values.get('feature_ai_media_workflow_v2');
  if (master !== undefined && master.trim() !== 'false') {
    fail(`feature_ai_media_workflow_v2 must be false or absent, found ${JSON.stringify(master)}`);
  }

  const rawPolicy = values.get('ai_media_workflow_v2_rollout_policy');
  if (rawPolicy === undefined) {
    return { master: master === undefined ? 'absent' : 'false', policy: 'absent' };
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
    master: master === undefined ? 'absent' : 'false',
    policy: `revision:${policy.revision},tenantIds:0`,
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const rows = JSON.parse(process.argv[2] || 'null');
    const result = verifyAiMediaDarkPolicy(rows);
    console.log(`PASS AI Media rollout is dark (master=${result.master}; policy=${result.policy})`);
  } catch (error) {
    console.error(
      `FAIL AI Media rollout is not dark: ${error instanceof Error ? error.message : String(error)}`,
    );
    process.exitCode = 1;
  }
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const verifier = 'scripts/verify-ai-media-dark-policy.mjs';
const verifyVpsDeploy = readFileSync('scripts/verify-vps-deploy.sh', 'utf8');
const verifyDeployReadiness = readFileSync('scripts/verify-deploy-readiness.sh', 'utf8');

function run(rows) {
  return spawnSync(process.execPath, [verifier, JSON.stringify(rows)], { encoding: 'utf8' });
}

for (const rows of [
  [],
  [{ key: 'feature_ai_media_workflow_v2', value: 'false' }],
  [{ key: 'ai_media_workflow_v2_rollout_policy', value: '{"revision":0,"tenantIds":[]}' }],
  [
    { key: 'feature_ai_media_workflow_v2', value: 'false' },
    { key: 'ai_media_workflow_v2_rollout_policy', value: '{"revision":8,"tenantIds":[]}' },
  ],
]) {
  const result = run(rows);
  assert.equal(result.status, 0, `safe AI Media rollout should pass: ${result.stderr}`);
  assert.match(result.stdout, /PASS AI Media rollout is dark/u);
}

for (const rows of [
  [{ key: 'feature_ai_media_workflow_v2', value: 'true' }],
  [{ key: 'feature_ai_media_workflow_v2', value: 'invalid' }],
  [{ key: 'ai_media_workflow_v2_rollout_policy', value: '{}' }],
  [{ key: 'ai_media_workflow_v2_rollout_policy', value: '{bad json' }],
  [{ key: 'ai_media_workflow_v2_rollout_policy', value: '{"revision":0,"tenantIds":["owner-1"]}' }],
]) {
  const result = run(rows);
  assert.notEqual(result.status, 0, 'unsafe AI Media rollout must fail deployment verification');
  assert.match(result.stderr, /FAIL AI Media rollout is not dark/u);
}

assert.match(
  verifyVpsDeploy,
  /verify-ai-media-dark\.sh/u,
  'VPS verification must assert AI Media remains dark',
);
assert.match(
  verifyDeployReadiness,
  /verify-ai-media-dark\.sh/u,
  'deploy readiness must assert AI Media remains dark before switching releases',
);

console.log('PASS AI Media dark deployment guards');

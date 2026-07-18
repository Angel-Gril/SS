import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('scripts/fixtures/ai-media-evaluation/model-planning-v1');
const read = (name) => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
const manifest = read('manifest.json');
const groups = [
  read('curation/contract-cases.json'),
  read('vision/contract-cases.json'),
  read('slot-plan/contract-cases.json'),
];

assert.equal(manifest.schemaVersion, 'ai-media-model-planning-fixture-set/v1');
assert.equal(manifest.evidenceLevel, 'CONTRACT_FIXTURE');
assert.equal(manifest.readiness, 'NOT_READY');
assert.equal(manifest.corpusAvailable, false);
assert.equal(manifest.qualityMeasured, false);
assert.ok(Array.isArray(manifest.limitations) && manifest.limitations.length >= 3);

const cases = groups.flat();
assert.ok(groups.every((group) => Array.isArray(group) && group.length > 0));
assert.deepEqual([...new Set(cases.map((entry) => entry.kind))].sort(), [
  'curation',
  'slot_planning',
  'vision',
]);
assert.equal(new Set(cases.map((entry) => entry.id)).size, cases.length);

const acceptance = JSON.parse(fs.readFileSync(
  'docs/contracts/ai-media-model-planning-evaluation.json',
  'utf8',
));
assert.equal(acceptance.status, 'NOT_READY');
assert.equal(acceptance.fixtureSet.evidenceLevel, 'CONTRACT_FIXTURE');
assert.equal(acceptance.rollout.featureFlagsRemainOff, true);
assert.equal(acceptance.rollout.tenantAllowlistRemainsEmpty, true);
assert.equal(acceptance.rollout.paidCallsPerformed, false);
assert.ok(acceptance.blockers.length >= 5);

const gateSource = fs.readFileSync(
  'apps/server/src/services/ai-media-model-planning-gate.ts',
  'utf8',
);
assert.match(gateSource, /AI_MEDIA_MODEL_PLANNING_GATE_POLICY/);
assert.match(gateSource, /state:\s*'NOT_READY'/);
assert.match(gateSource, /evidence_not_sandbox_recorded/);
assert.match(gateSource, /durable_gate_not_implemented/);
assert.doesNotMatch(gateSource, /return\s+\{\s*enabled:\s*true/u);

console.log('PASS AI media model-planning fixtures remain contract-only and fail closed');

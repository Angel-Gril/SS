import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateEvaluationDirectory } from './sandbox/ai-media-evaluation.mjs';

const sourceDir = path.resolve('scripts/fixtures/ai-media-evaluation');

function withPolicies(mutator) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ss-erp-ai-media-evaluation-'));
  fs.cpSync(sourceDir, dir, { recursive: true });
  try {
    mutator(dir);
    return validateEvaluationDirectory(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function mutatePolicy(dir, name, mutate) {
  const file = path.join(dir, name);
  const policy = JSON.parse(fs.readFileSync(file, 'utf8'));
  mutate(policy);
  fs.writeFileSync(file, `${JSON.stringify(policy, null, 2)}\n`);
}

const baseline = validateEvaluationDirectory(sourceDir);
assert.equal(baseline.policyCount, 3);
assert.deepEqual(baseline.metricKeys, [
  'identity_preservation_score',
  'russian_readability_score',
  'untranslated_chinese_ratio',
]);

assert.doesNotThrow(() =>
  withPolicies((dir) => {
    mutatePolicy(dir, 'identity-consistency.json', (policy) => {
      policy.metric.threshold.value = policy.metric.validRange.minimum;
    });
    mutatePolicy(dir, 'chinese-residue.json', (policy) => {
      policy.metric.threshold.value = policy.metric.validRange.maximum;
    });
  }),
);

assert.throws(
  () =>
    withPolicies((dir) => {
      mutatePolicy(dir, 'russian-readability.json', (policy) => {
        policy.schemaVersion = 2;
      });
    }),
  /schema.*schemaVersion/u,
);

assert.throws(
  () =>
    withPolicies((dir) => {
      mutatePolicy(dir, 'identity-consistency.json', (policy) => {
        policy.metric.threshold.value = 1.1;
      });
    }),
  /threshold\.value must be inside the valid range/u,
);

assert.throws(
  () =>
    withPolicies((dir) => {
      mutatePolicy(dir, 'identity-consistency.json', (policy) => {
        policy.metric.threshold.operator = 'lte';
      });
    }),
  /higher_is_better metrics require a gte threshold/u,
);

assert.throws(
  () =>
    withPolicies((dir) => {
      mutatePolicy(dir, 'chinese-residue.json', (policy) => {
        policy.metric.validRange.minimum = 1;
        policy.metric.validRange.maximum = 0;
      });
    }),
  /minimum must be less than maximum/u,
);

assert.throws(
  () =>
    withPolicies((dir) => {
      mutatePolicy(dir, 'identity-consistency.json', (policy) => {
        policy.manualReview.required = false;
      });
    }),
  /schema.*manualReview/u,
);

console.log('PASS AI media evaluation policy schema and semantic boundaries');

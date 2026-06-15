import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadPolicy() {
  const source = fs.readFileSync('extensions/ss-erp/shared/ozon/collection-policy.js', 'utf8');
  const sandbox = { console };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'collection-policy.js' });
  return sandbox.SS_ERP_OZON_COLLECTION_POLICY;
}

test('defaults Ozon ERP collection to quick mode', () => {
  const policy = loadPolicy().resolveOzonCollectionPolicy();

  assert.equal(policy.mode, 'quick');
  assert.equal(policy.discoverVariants, false);
  assert.equal(policy.fetchRootSellerInsights, true);
  assert.equal(policy.fetchVariantSellerInsights, false);
  assert.equal(policy.rootProductDelayMs, 0);
});

test('enables recursive discovery and per-variant seller details only in complete mode', () => {
  const policy = loadPolicy().resolveOzonCollectionPolicy({ mode: 'complete' });

  assert.equal(policy.mode, 'complete');
  assert.equal(policy.discoverVariants, true);
  assert.equal(policy.fetchVariantSellerInsights, true);
  assert.equal(policy.recursive.maxDepth, 3);
  assert.equal(policy.recursive.maxPages, 120);
  assert.equal(policy.recursive.delayMs, 0);
});

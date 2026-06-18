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
  assert.equal(policy.fetchDescriptionDetails, true);
  assert.equal(policy.rootProductDelayMs, 0);
});

test('enables recursive discovery and per-variant seller details only in complete mode', () => {
  const policy = loadPolicy().resolveOzonCollectionPolicy({ mode: 'complete' });

  assert.equal(policy.mode, 'complete');
  assert.equal(policy.discoverVariants, true);
  assert.equal(policy.fetchVariantSellerInsights, true);
  assert.equal(policy.fetchRootSellerInsights, true);
  assert.equal(policy.fetchDescriptionDetails, true);
  assert.equal(policy.recursive.maxDepth, 3);
  assert.equal(policy.recursive.maxPages, 120);
  assert.equal(policy.recursive.delayMs, 0);
});

test('balanced Ozon ERP collection keeps the first pass fast and queues details', () => {
  const policy = loadPolicy().resolveOzonCollectionPolicy({ mode: 'balanced' });

  assert.equal(policy.mode, 'balanced');
  assert.equal(policy.discoverVariants, false);
  assert.equal(policy.fetchRootSellerInsights, false);
  assert.equal(policy.fetchVariantSellerInsights, false);
  assert.equal(policy.fetchDescriptionDetails, false);
  assert.equal(policy.rootProductDelayMs, 0);
  assert.equal(policy.recursive.maxPages, 0);
  assert.equal(policy.recursive.maxDepth, 0);
});

test('popup ERP collection asks background for balanced Ozon variant discovery', () => {
  const source = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');

  assert.match(
    source,
    /type:\s*['"]spb-self-hosted:fetch-ozon-product-to-erp['"][\s\S]*collectMode:\s*['"]balanced['"]/,
  );
});

test('background ERP collection message defaults to complete mode', () => {
  const source = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

  assert.match(
    source,
    /collectOzonProductsToErp\(message\.productIds,\s*\{[\s\S]*mode:\s*message\.mode\s*\|\|\s*message\.collectMode\s*\|\|\s*["']complete["']/,
  );
});

test('all interactive Ozon ERP collection entry points explicitly request complete mode', () => {
  const panelSource = fs.readFileSync('extensions/ss-erp/content/ozon-panel.js', 'utf8');
  const collectPageSource = fs.readFileSync('apps/web/src/app/(dashboard)/collect/page.tsx', 'utf8');
  const batchCollectSource = fs.readFileSync('apps/web/src/app/(dashboard)/collect/batch/page.tsx', 'utf8');

  assert.match(
    panelSource,
    /type:\s*['"]spb-self-hosted:fetch-ozon-product-to-erp['"][\s\S]*collectMode:\s*['"]balanced['"]/,
  );
  assert.match(
    collectPageSource,
    /type:\s*['"]spb-self-hosted:fetch-ozon-product-to-erp['"][\s\S]*collectMode:\s*['"]balanced['"]/,
  );
  assert.match(
    batchCollectSource,
    /type:\s*['"]spb-self-hosted:fetch-ozon-product-to-erp['"][\s\S]*collectMode:\s*['"]balanced['"]/,
  );
});

test('balanced collection queues a complete enrichment pass after the first ERP push', () => {
  const source = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

  assert.match(
    source,
    /collectPolicy\.mode\s*===\s*["']balanced["'][\s\S]*enqueueOzonCollectEnrichment/,
  );
});

test('balanced first pass forwards collection policy into the Ozon tab fetcher', () => {
  const source = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

  assert.match(
    source,
    /fetchOzonProductViaTab\(pid,\s*[^,\n]+,\s*collectPolicy\)/,
  );
  assert.match(
    source,
    /fetchDescriptionDetails:\s*!!collectPolicy\.fetchDescriptionDetails/,
  );
});

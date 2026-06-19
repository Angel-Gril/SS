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

test('popup ERP collection asks background for complete Ozon variant discovery', () => {
  const source = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');

  assert.match(
    source,
    /type:\s*['"]spb-self-hosted:fetch-ozon-product-to-erp['"][\s\S]*collectMode:\s*['"]complete['"]/,
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
    /type:\s*['"]spb-self-hosted:fetch-ozon-product-to-erp['"][\s\S]*collectMode:\s*['"]complete['"]/,
  );
  assert.match(
    collectPageSource,
    /type:\s*['"]spb-self-hosted:fetch-ozon-product-to-erp['"][\s\S]*collectMode:\s*['"]complete['"]/,
  );
  assert.match(
    batchCollectSource,
    /type:\s*['"]spb-self-hosted:fetch-ozon-product-to-erp['"][\s\S]*collectMode:\s*['"]complete['"]/,
  );
});

test('recursive Ozon discovery skips variant description details by default', () => {
  const source = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

  assert.match(
    source,
    /discoverOzonVariantsRecursively\(productData,\s*productId,\s*\{[\s\S]*fetchVariantDescriptionDetails:\s*options\.fetchVariantDescriptionDetails\s*===\s*true/,
  );
  assert.match(
    source,
    /doFetchOzonProductViaTab\(tab,\s*fetchId,\s*productPath,\s*\{[\s\S]*fetchDescriptionDetails:\s*options\.fetchVariantDescriptionDetails\s*===\s*true/,
  );
  assert.match(
    source,
    /variantDescriptionMode:\s*options\.fetchVariantDescriptionDetails\s*===\s*true\s*\?\s*["']per-variant["']\s*:\s*["']root-shared["']/,
  );
  assert.match(
    source,
    /fetchVariantDescriptionDetails:\s*message\.fetchVariantDescriptionDetails\s*===\s*true/,
  );
  assert.match(
    source,
    /fetchVariantDescriptionDetails:\s*job\s*&&\s*job\.fetchVariantDescriptionDetails\s*===\s*true/,
  );
  assert.match(
    source,
    /completeOzonProductVariantsForCollection\(productData,\s*pid,\s*collectionRunOptions\)/,
  );
});

test('balanced collection queues a complete enrichment pass after the first ERP push', () => {
  const source = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

  assert.match(
    source,
    /collectPolicy\.mode\s*===\s*["']balanced["'][\s\S]*enqueueOzonCollectEnrichment/,
  );
});

test('Ozon collect payload distinguishes manual collection from enrichment updates', () => {
  const source = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

  assert.match(
    source,
    /function buildOzonCollectBatchPayload\(collected,\s*options\s*=\s*\{\}\)/,
  );
  assert.match(
    source,
    /collectPhase:\s*options\.phase\s*\|\|\s*["']collect["']/,
  );
  assert.match(
    source,
    /buildOzonCollectBatchPayload\(collected,\s*options\)/,
  );
  assert.match(
    source,
    /phase:\s*["']enrichment["']/,
  );
});

test('collection run forwards root policy and skips per-variant descriptions by default', () => {
  const source = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

  assert.match(
    source,
    /const collectionRunOptions\s*=\s*\{[\s\S]*\.\.\.collectPolicy[\s\S]*fetchVariantDescriptionDetails:\s*options\.fetchVariantDescriptionDetails\s*===\s*true[\s\S]*\}/,
  );
  assert.match(
    source,
    /fetchOzonProductViaTab\(pid,\s*sourceUrl,\s*collectionRunOptions\)/,
  );
  assert.match(
    source,
    /completeOzonProductVariantsForCollection\(productData,\s*pid,\s*collectionRunOptions\)/,
  );
  assert.match(
    source,
    /fetchDescriptionDetails:\s*!!collectPolicy\.fetchDescriptionDetails/,
  );
});

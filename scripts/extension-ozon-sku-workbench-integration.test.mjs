import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));
const serviceWorker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const background = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
const overlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');
const collectRoute = fs.readFileSync('apps/server/src/routes/collect.ts', 'utf8');

test('loads Ozon SKU workbench helper before background and product content scripts use it', () => {
  assert.match(
    serviceWorker,
    /importScripts\('\.\.\/shared\/ozon\/sku-workbench\.js'\)/,
    'service worker should import Ozon SKU workbench helper before collect-background',
  );
  assert.ok(
    serviceWorker.indexOf("../shared/ozon/sku-workbench.js") < serviceWorker.indexOf("collect-background.js"),
    'Ozon SKU workbench helper should load before collect-background.js',
  );

  const productScript = manifest.content_scripts.find((entry) => {
    return Array.isArray(entry.matches)
      && entry.matches.some((pattern) => pattern.includes('ozon.ru/product'))
      && Array.isArray(entry.js)
      && entry.js.includes('content/collect-content-script.js');
  });
  assert.ok(productScript, 'Ozon product content script entry must exist');
  assert.ok(productScript.js.includes('shared/ozon/sku-workbench.js'));
  assert.ok(
    productScript.js.indexOf('shared/ozon/sku-workbench.js') < productScript.js.indexOf('content/collect-content-script.js'),
    'Ozon SKU workbench helper should load before collect-content-script.js',
  );
});

test('background normalizes analytics rows, caches them, and serves Ozon seller offers', () => {
  assert.match(background, /SS_ERP_OZON_SKU_WORKBENCH/);
  assert.match(background, /normalizeOzonAnalyticsRow\(/);
  assert.match(background, /fetchOzonSellerOffers\(/);
  assert.match(background, /parseOzonSellerOffers\(/);
  assert.match(background, /spb-self-hosted:get-ozon-seller-offers/);
  assert.match(background, /spb-self-hosted:fetch-ozon-workbench-rows/);
});

test('background queries seller analytics with the monthly SKU request shape used by richer Ozon collectors', () => {
  const requestBody = background.match(/function buildOzonAnalyticsRequestBody[\s\S]*?\r?\n}\r?\n\r?\nfunction extractOzonSpecifications/);
  assert.ok(requestBody, 'buildOzonAnalyticsRequestBody should be present');
  assert.match(requestBody[0], /period:\s*"monthly"/);
  assert.match(requestBody[0], /categories:\s*\[\]/);
  assert.match(requestBody[0], /sort:\s*\{[\s\S]*key:\s*"sum_gmv_desc"/);
});

test('background enriches seller analytics with seller search-by-SKU details', () => {
  assert.match(background, /search:\s*"https:\/\/seller\.ozon\.ru\/api\/v1\/search"/);
  assert.match(background, /function buildOzonSellerSearchRequestBody/);
  assert.match(background, /input_leaf:\s*\{\s*sku:\s*\{\s*values:\s*\[/);
  assert.match(background, /async function fetchOzonSellerSearchBySku/);
  assert.match(background, /fetchOzonSellerSearchBySku\((?:sku|productId),\s*companyId\)/);
  assert.match(background, /sources\.push\("seller-search"\)/);
});

test('Ozon collection keeps analytics snapshots in ERP metadata for table display', () => {
  assert.match(
    background,
    /productData\.ozonInsights\s*=\s*normalizeOzonCollectionInsights\(/,
    'collected Ozon products should carry normalized analytics snapshots',
  );
  assert.match(
    collectRoute,
    /if\s*\(input\.ozonInsights\)\s*metadata\.ozonInsights\s*=/,
    'collect route should persist ozonInsights metadata',
  );
});

test('background fetches SKU workbench rows in parallel without duplicate offers requests', () => {
  const fetchRows = background.match(/async function fetchOzonWorkbenchRows[\s\S]*?\r?\n}\r?\n\r?\nfunction setDefinedField/);
  assert.ok(fetchRows, 'fetchOzonWorkbenchRows should be present');
  assert.match(fetchRows[0], /workerCount/);
  assert.match(fetchRows[0], /Promise\.all/);
  assert.match(fetchRows[0], /includeOffers:\s*options\.includeOffers\s*!==\s*false/);
  assert.match(fetchRows[0], /hasRichWorkbenchSeedRow\(seed,\s*\{\s*includeOffers\s*\}\)/);
  assert.doesNotMatch(fetchRows[0], /setTimeout\(\(resolve\)\s*=>\s*setTimeout\(resolve,\s*300\)/);
  assert.doesNotMatch(fetchRows[0], /fetchOzonSellerOffers\(sku\)/);
});

test('Ozon workbench keeps optional offer enrichment while list workbench stays publish-only', () => {
  const aggregate = background.match(/async function aggregateOzonProductInsights[\s\S]*?\r?\n}\r?\n\r?\nasync function getStoredErpConnection/);
  assert.ok(aggregate, 'aggregateOzonProductInsights should be present');
  assert.match(background, /function\s+getOzonWorkbenchInsightCacheKey/, 'workbench insight cache should distinguish light and full enrichment');
  assert.match(background, /function\s+hasRichWorkbenchSeedRow\(seed,\s*options\s*=\s*\{\}\)/);
  assert.match(background, /if\s*\(options\.includeOffers\s*!==\s*false[\s\S]*sellerOffers/);
  assert.match(background, /includeOffers\s*\?\s*"offers"\s*:\s*"base"/, 'workbench insight cache should not let profit-only reads poison full offer reads');
  assert.match(aggregate[0], /options\s*=\s*\{\}/, 'aggregate insights should accept fetch options');
  assert.match(aggregate[0], /includeOffers\s*=\s*options\.includeOffers\s*!==\s*false/);
  assert.match(aggregate[0], /getOzonInsights\(sku,\s*\{[\s\S]*includeOffers[\s\S]*includeDetail/);
  assert.match(background, /if\s*\(includeOffers\)\s*\{[\s\S]*fetchOzonSellerOffers\(productId\)/);
  assert.match(
    overlay,
    /function\s+normalizeListWorkbenchMode\(mode\)\s*\{\s*return 'publish';\s*\}/,
    'list workbench should normalize every entry point to publish mode',
  );
  assert.match(
    overlay,
    /includeOffers:\s*modal\.__ssErpWorkbenchFocus\s*===\s*'publish'/,
    'list publish mode should keep full seller-offer enrichment before one-click listing',
  );
  assert.doesNotMatch(overlay, /focus:\s*'data'|data-mode=["']data["']|data-mode=["']profit["']/);
});

test('ordinary Ozon list enrichment is parallel, context-bound, and reuses the shared cache', () => {
  const getInsights = background.match(/async function getOzonInsights[\s\S]*?\r?\n}\r?\n\r?\n\/\/ 并发批量/);
  assert.ok(getInsights, 'getOzonInsights should be present');
  assert.match(
    getInsights[0],
    /Promise\.all\(\[analyticsPromise,\s*searchPromise,\s*offersPromise\]\)/,
    'seller analytics and seller search should run concurrently for each SKU',
  );
  assert.match(
    background,
    /OZON_LIST_INSIGHT_REQUEST_CONCURRENCY\s*=\s*3[\s\S]*function\s+enqueueOzonListInsightRequest/,
    'parallel list enrichment should retain a global three-request Seller concurrency limit',
  );
  assert.match(
    background,
    /OZON_LIST_INSIGHT_REQUEST_MAX_PENDING\s*=\s*60[\s\S]*OZON_LIST_INSIGHT_REQUEST_DEADLINE_MS\s*=\s*18\s*\*\s*1000/,
    'list enrichment should have bounded pending work and a queue deadline',
  );
  assert.match(
    background,
    /ozonListInsightRequestQueue\.sort\([\s\S]{0,300}left\.priority - right\.priority/,
    'interactive Seller requests should take priority over list preloading',
  );
  assert.match(
    background,
    /function\s+getOzonWorkbenchInsightCacheKey[\s\S]*contextKey[\s\S]*profile/,
    'shared insight cache keys should include the live Seller company context and enrichment profile',
  );
  assert.match(
    background,
    /function invalidateOzonWorkbenchInsightContext[\s\S]{0,300}ozonWorkbenchInsightContextEpoch \+= 1[\s\S]{0,300}ozonWorkbenchInsightCache\.clear\(\)[\s\S]{0,200}ozonWorkbenchInsightInFlight\.clear\(\)/,
    'Seller company changes should invalidate both background cache and in-flight generations',
  );
  assert.match(
    background,
    /contextEpoch === ozonWorkbenchInsightContextEpoch[\s\S]{0,300}setCachedOzonWorkbenchInsight[\s\S]{0,500}ozonWorkbenchInsightInFlight\.get\(key\) === request/,
    'an old company generation must not write cache or delete a newer in-flight request',
  );
  assert.match(
    background,
    /getOzonWorkbenchInsightCacheKey[\s\S]{0,600}includeDetail[\s\S]{0,300}["']detail["'][\s\S]{0,100}["']summary["']/,
    'summary cache entries must not satisfy later detail-required reads',
  );
  assert.match(
    background,
    /OZON_WORKBENCH_INSIGHT_MAX_ENTRIES\s*=\s*300/,
    'shared insight cache should have a bounded entry count',
  );
  assert.match(
    background,
    /case ["']spb-self-hosted:aggregate-product-insights["'][\s\S]{0,700}fetchCachedOzonWorkbenchInsight/,
    'direct list-card aggregation should reuse the background cache and in-flight deduplication',
  );
  assert.match(
    background,
    /profile === ["']list-card["'][\s\S]{0,320}item\.title[\s\S]{0,320}item\.brand/,
    'the list-card public fallback should require only fields actually needed by the list card',
  );
});

test('background passes synced commission rules into Ozon SKU workbench row building', () => {
  const fetchRows = background.match(/async function fetchOzonWorkbenchRows[\s\S]*?\r?\n}\r?\n\r?\nfunction setDefinedField/);
  assert.ok(fetchRows, 'fetchOzonWorkbenchRows should be present');
  assert.match(fetchRows[0], /getOzonCommissionSnapshotForWorkbench\(\)/);
  assert.match(fetchRows[0], /commissionSnapshot:\s*commissionSnapshot/);
  assert.match(background, /ozon-calculator:commission-snapshot/);
});

test('background falls back to local Ozon commission rules when no synced snapshot exists', () => {
  assert.match(
    serviceWorker,
    /globalThis\.OZON_COMMISSION_FALLBACK_SNAPSHOT\s*=\s*OZON_COMMISSION_FALLBACK_SNAPSHOT/,
    'service worker should expose the local commission fallback to collect-background',
  );
  const snapshotReader = background.match(/async function getOzonCommissionSnapshotForWorkbench[\s\S]*?\r?\n}\r?\n\r?\nasync function fetchOzonWorkbenchRows/);
  assert.ok(snapshotReader, 'getOzonCommissionSnapshotForWorkbench should be present');
  assert.match(
    snapshotReader[0],
    /globalThis\.OZON_COMMISSION_FALLBACK_SNAPSHOT/,
    'workbench should use local fallback commission rules when storage has no synced snapshot',
  );
});

test('aggregate Ozon product insights applies category IDs and computed commission to list cards', () => {
  const aggregate = background.match(/async function aggregateOzonProductInsights[\s\S]*?\r?\n}\r?\n\r?\nasync function getStoredErpConnection/);
  assert.ok(aggregate, 'aggregateOzonProductInsights should be present');
  for (const field of ['category1Id', 'category2Id', 'category3Id']) {
    assert.match(aggregate[0], new RegExp(`${field}:\\s*analytics\\.item\\.${field}`), `aggregate list cards should preserve ${field}`);
  }
  assert.match(
    aggregate[0],
    /applyOzonCommissionToAggregatedItem\(item,\s*sku\)/,
    'aggregate list cards should apply the same commission calculation used by SKU workbench rows',
  );
});

test('extension workbench publish only creates a backend one-click listing job', () => {
  assert.doesNotMatch(background, /publishOzonWorkbenchRowsDirect/);
  assert.doesNotMatch(background, /buildOzonWorkbenchDirectImportItems/);
  assert.doesNotMatch(background, /\/api\/listing\/ozon\/import-by-sku/);
  assert.doesNotMatch(background, /async function publishOzonWorkbenchRows/);
  assert.doesNotMatch(background, /\/api\/collect\/publish-ozon/);
  assert.match(background, /globalThis\.SS_ERP_EXTENSION_DEVICE_ONE_CLICK[\s\S]*deviceApi\.create/);
  assert.match(background, /globalThis\.SS_ERP_EXTENSION_DEVICE_ONE_CLICK[\s\S]*deviceApi\.patch/);
  assert.match(background, /createOzonWorkbenchPublishJob\(productIds,\s*options\)[\s\S]*queued:\s*true/);
  assert.doesNotMatch(background, /directPublish/);
});

test('background downloads Ozon workbench Excel exports through Chrome downloads API', () => {
  assert.match(background, /spb-self-hosted:download-ozon-workbench-excel/);
  assert.match(background, /chrome\.downloads\.download\(/);
  assert.match(background, /application\/vnd\.ms-excel/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const background = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
const collectRoute = fs.readFileSync('apps/server/src/routes/collect.ts', 'utf8');
const listOverlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');

test('browser one-click listing uses temporary collect records instead of polluting SKU collect page', () => {
  assert.match(
    background,
    /collectOzonProductsToErp\(productIds,[\s\S]*ephemeralListing:\s*true/,
    'one-click publish should collect into temporary ERP records',
  );
  assert.match(
    background,
    /includeEphemeral=1/,
    'publish follow-up lookup should explicitly include temporary collect records',
  );
  assert.match(
    background,
    /ephemeralHit[\s\S]*metadata[\s\S]*ephemeralListing\s*===\s*true/,
    'publish follow-up lookup should prefer the newly created temporary record over older normal collect rows',
  );
  assert.match(
    collectRoute,
    /function\s+visibleSupplyGoodsWhereSql/,
    'collect list queries should use a Postgres-compatible visible-record filter',
  );
  assert.match(
    collectRoute,
    /coalesce\(\(metadata->>'ephemeralListing'\)::boolean,\s*false\)\s+is\s+not\s+true/,
    'visible-record filter should hide temporary records while keeping legacy records without ephemeralListing metadata visible',
  );
  assert.match(
    collectRoute,
    /query\.includeEphemeral\s*===\s*'1'/,
    'collect list endpoint should only show temporary records when explicitly requested',
  );
  assert.match(
    collectRoute,
    /scheduleEphemeralListingCleanup\(items,\s*userId,\s*5\s*\*\s*60\s*\*\s*1000\)/,
    'successful publish should schedule temporary collect records for cleanup after five minutes',
  );
  assert.match(
    collectRoute,
    /function\s+purgeExpiredEphemeralListingRecords/,
    'server should have a best-effort cleanup for temporary records after restart',
  );
  const purgeFn = collectRoute.match(/function\s+purgeExpiredEphemeralListingRecords[\s\S]*?\n}\n/);
  assert.ok(purgeFn, 'restart-safe cleanup function should be present');
  assert.match(
    purgeFn[0],
    /updatedAt:\s*\{\s*lt:\s*new Date\(Date\.now\(\)\s*-\s*EPHEMERAL_LISTING_TTL_MS\)/,
    'restart-safe cleanup should purge expired temporary records after the TTL',
  );
  assert.doesNotMatch(
    purgeFn[0],
    /status:\s*'listed'/,
    'restart-safe cleanup should also purge temporary records that never reached listed status',
  );
});

test('manual Ozon ERP collection remains persistent and visible in SKU collect page', () => {
  const currentTabCase = background.match(/case "spb-self-hosted:collect-current-tab":[\s\S]*?case "spb-self-hosted:get-ozon-insights":/);
  assert.ok(currentTabCase, 'collect-current-tab message case should be present');
  assert.match(
    currentTabCase[0],
    /collectFromCurrentTab\(\)/,
    'manual current-tab collection should use the normal persistent collect path',
  );
  assert.doesNotMatch(
    currentTabCase[0],
    /ephemeralListing:\s*true/,
    'manual current-tab collection must not create temporary one-click listing records',
  );

  const fetchToErpCase = background.match(/case "spb-self-hosted:fetch-ozon-product-to-erp":[\s\S]*?\n\s*}\n\s*\}\)/);
  assert.ok(fetchToErpCase, 'fetch-ozon-product-to-erp message case should be present');
  assert.match(
    fetchToErpCase[0],
    /collectOzonProductsToErp\(message\.productIds,\s*\{/,
    'manual product-page ERP collection should call the normal collect endpoint',
  );
  assert.doesNotMatch(
    fetchToErpCase[0],
    /ephemeralListing:\s*true/,
    'manual product-page ERP collection must persist in SKU collect instead of being hidden as temporary listing data',
  );
});

test('Ozon list publish mode keeps the SKU/KPI table for pre-publish validation', () => {
  assert.match(
    listOverlay,
    /data-role="workbench-table-wrap"/,
    'list publish workbench should use the existing SKU/KPI table surface',
  );
  assert.match(
    listOverlay,
    /月销量|广告费占比|跟卖最低价|利润率/,
    'list publish workbench should keep KPI columns visible before submission',
  );
  assert.doesNotMatch(
    listOverlay,
    /data-role="publish-confirm-wrap"|function\s+renderListWorkbenchPublishConfirm/,
    'list publish mode should not replace the SKU/KPI table with a lightweight confirmation surface',
  );
  assert.doesNotMatch(
    listOverlay,
    /if\s*\(\s*modal\.__ssErpWorkbenchFocus\s*===\s*'publish'\s*\)\s*\{\s*renderListWorkbenchPublishConfirm[\s\S]*?return;/,
    'list publish mode should not bypass seller/KPI enrichment before rendering rows',
  );
});

test('browser one-click listing reuses the pre-created listing-log job through publish-ozon', () => {
  const publishOzonStart = collectRoute.indexOf("app.post('/publish-ozon'");
  const publishOzonEnd = collectRoute.indexOf('  // 诊断端点', publishOzonStart);
  assert.ok(publishOzonStart >= 0 && publishOzonEnd > publishOzonStart, 'publish-ozon route should be present');
  const publishOzonRoute = collectRoute.slice(publishOzonStart, publishOzonEnd);

  assert.match(
    publishOzonRoute,
    /jobId\?:\s*string/,
    'publish-ozon should accept a pre-created listing job id from the browser one-click flow',
  );
  assert.match(
    publishOzonRoute,
    /prisma\.syncJob\.findFirst\([\s\S]*body\.jobId[\s\S]*type:\s*'PRODUCT_PUSH'[\s\S]*shop:\s*\{\s*select:\s*\{\s*userId:\s*true/,
    'publish-ozon should verify the pre-created job belongs to the same authenticated user',
  );
  assert.match(
    publishOzonRoute,
    /upsertPublishOzonSyncJob\([\s\S]*jobId:\s*body\.jobId[\s\S]*payload:/,
    'publish-ozon should update the accepted job instead of creating a second listing-log row',
  );
  assert.match(
    publishOzonRoute,
    /data:\s*\{[\s\S]*jobId:/,
    'publish-ozon should return the listing job id so the extension can point users to the ERP log',
  );
});

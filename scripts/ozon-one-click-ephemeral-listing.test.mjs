import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const background = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
const collectRoute = fs.readFileSync('apps/server/src/routes/collect.ts', 'utf8');
const listingRoute = fs.readFileSync('apps/server/src/routes/listing.ts', 'utf8');
const backendWorker = fs.existsSync('apps/server/src/workers/browser-one-click-listing.ts')
  ? fs.readFileSync('apps/server/src/workers/browser-one-click-listing.ts', 'utf8')
  : '';
const workerEntry = fs.readFileSync('apps/server/src/worker.ts', 'utf8');
const serverEntry = fs.readFileSync('apps/server/src/index.ts', 'utf8');
const listOverlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');

test('browser one-click listing uses temporary collect records instead of polluting SKU collect page', () => {
  assert.match(
    backendWorker,
    /ephemeralListing:\s*true/,
    'ERP backend worker should create temporary collect records for one-click listing',
  );
  assert.match(
    backendWorker,
    /ephemeralListingExpiresAt:\s*expiresAt\.toISOString\(\)/,
    'temporary one-click listing records should carry an expiry timestamp',
  );
  assert.match(
    backendWorker,
    /supplyGoodsIds/,
    'backend worker should store the generated temporary collect record ids on the listing job for retry safety',
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
    /id:\s*\{\s*not:\s*body\.jobId\s*\}/,
    'publish-ozon retry checks should not block the current pre-created job as a duplicate fallback publish',
  );
  assert.match(
    publishOzonRoute,
    /browserOneClickJob/,
    'publish-ozon should preserve browser-one-click identity when fallback payload replaces the submitted payload',
  );
  assert.match(
    publishOzonRoute,
    /publish:\s*existingPublishPayload\.publish/,
    'publish-ozon should preserve browser-one-click pricing and offer settings across backend worker retries',
  );
  assert.match(
    publishOzonRoute,
    /data:\s*\{[\s\S]*jobId:/,
    'publish-ozon should return the listing job id so the extension can point users to the ERP log',
  );
});

test('browser one-click listing logs surface stale extension background interruptions', () => {
  assert.match(
    listingRoute,
    /BROWSER_ONE_CLICK_STAGE_STALE_MS\s*=\s*15\s*\*\s*60\s*\*\s*1000/,
    'listing logs should have a stale threshold for browser-extension stages that stop updating',
  );
  assert.match(
    listingRoute,
    /function\s+isBrowserOneClickStageStale[\s\S]*preparing_browser_data[\s\S]*watermarking[\s\S]*watermarked[\s\S]*publishing/,
    'listing logs should detect stale browser-data/collect/watermark/publish stages before an Ozon taskId exists',
  );
  assert.match(
    listingRoute,
    /missingTaskIdMessage[\s\S]*isBrowserOneClickStageStale\(data\)[\s\S]*后台队列执行可能已中断/,
    'listing logs should not keep saying "打水印中" forever when the backend queue has stopped advancing',
  );
});

test('watermark route processes one-click listing items with bounded concurrency', () => {
  const watermarkStart = collectRoute.indexOf("app.post('/watermark'");
  const watermarkEnd = collectRoute.indexOf('/** 解析 OZON 输入', watermarkStart);
  assert.ok(watermarkStart >= 0 && watermarkEnd > watermarkStart, 'watermark route should be present');
  const watermarkRoute = collectRoute.slice(watermarkStart, watermarkEnd);

  assert.match(
    collectRoute,
    /WATERMARK_ITEM_CONCURRENCY\s*=\s*3/,
    'watermark route should use a small bounded item concurrency instead of processing every item sequentially',
  );
  assert.match(
    collectRoute,
    /async function\s+processWatermarkItemsWithConcurrency[\s\S]*Promise\.all\(\s*Array\.from\(\{\s*length:\s*workerCount\s*\}/,
    'watermark route should run a bounded worker pool so large one-click listing batches finish before the extension background is reclaimed',
  );
  assert.doesNotMatch(
    watermarkRoute,
    /for\s*\(\s*const\s+item\s+of\s+items\s*\)\s*\{[\s\S]*processItemWatermarks[\s\S]*await\s+prisma\.supplyGoods\.update/,
    'watermark route should not process all selected items in one fully sequential loop',
  );
});

test('browser one-click listing is executed by the ERP backend worker queue', () => {
  assert.match(
    listingRoute,
    /addBrowserOneClickListingJob\(job\.id\)/,
    'browser one-click job creation should enqueue the ERP backend worker',
  );
  assert.match(
    backendWorker,
    /payload\.source\s*!==\s*'browser-one-click-listing'[\s\S]*payload\.browserOneClickJob\s*!==\s*true/,
    'backend worker should resume browser one-click jobs even after publish-ozon rewrites the payload to fallback mode',
  );
  assert.match(
    backendWorker,
    /export async function\s+addBrowserOneClickListingJob[\s\S]*browserOneClickListingQueue!?\s*\.add/,
    'backend worker should expose a BullMQ enqueue function for one-click listing jobs',
  );
  assert.match(
    backendWorker,
    /export function\s+startBrowserOneClickListingWorker[\s\S]*new Worker/,
    'backend worker should consume one-click listing jobs outside the extension background',
  );
  assert.match(
    workerEntry,
    /startBrowserOneClickListingWorker/,
    'standalone worker process should start the browser one-click listing worker',
  );
  assert.match(
    serverEntry,
    /startBrowserOneClickListingWorker/,
    'single-process API mode should start the browser one-click listing worker when workers are enabled',
  );
});

test('browser one-click listing streams complete Ozon publish data into ERP temporary goods', () => {
  const publishRowsFn = background.match(/async function\s+buildOzonWorkbenchPublishRows[\s\S]*?\n}\n\nasync function\s+buildOzonWorkbenchPublishPayload/);
  assert.ok(publishRowsFn, 'extension should have a dedicated publish-row enrichment function');
  assert.match(
    publishRowsFn[0],
    /fetchOzonProductViaTab/,
    'extension should collect complete Ozon product data for selected SKUs before creating the backend queue job',
  );
  assert.match(
    publishRowsFn[0],
    /completeOzonProductVariantsForCollection/,
    'one-click listing publish rows should include completed multi-variant data when available',
  );
  assert.match(
    background,
    /mapOzonProductToWorkbenchPublishRow[\s\S]*ozonAttributes[\s\S]*descriptionCategoryId[\s\S]*typeId[\s\S]*variants/,
    'publish rows should carry Ozon attributes/category/type/variants so publish-ozon uses product import instead of import-by-sku fallback',
  );
  assert.doesNotMatch(
    publishRowsFn[0],
    /collectOzonProductsToErp/,
    'publish data preparation must not write browser-collected goods directly into ERP; the backend queue owns temporary collect records',
  );
  assert.match(
    background,
    /streamOzonWorkbenchPublishRowsToJob[\s\S]*browserPayloadBatch:\s*true[\s\S]*rows:\s*\[row\]/,
    'extension should stream enriched rows into the visible ERP job one SKU at a time',
  );
  assert.match(
    listingRoute,
    /appendBrowserOneClickListingRows\(job\.id,\s*patchPayload\.rows\.map\(objectRecord\)\)/,
    'ERP should convert each streamed row into temporary collect records before the backend queue starts',
  );
  assert.match(
    backendWorker,
    /export async function\s+appendBrowserOneClickListingRows[\s\S]*prisma\.supplyGoods\.create/,
    'backend worker helper should persist streamed browser rows as temporary SupplyGoods',
  );
  assert.match(
    backendWorker,
    /buildBrowserOneClickOzonMetadata[\s\S]*ozonAttributes[\s\S]*descriptionCategoryId[\s\S]*typeId[\s\S]*sourceRichDescriptionJson/,
    'backend worker should store enriched Ozon fields in the same metadata shape as manual SKU collection',
  );
});

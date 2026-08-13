import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const background = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
const serviceWorker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const collectRoute = fs.readFileSync('apps/server/src/routes/collect.ts', 'utf8');
const listingRoute = fs.readFileSync('apps/server/src/routes/listing.ts', 'utf8');
const sourceListingWorkflowRoute = fs.readFileSync('apps/server/src/routes/source-listing-workflows.ts', 'utf8');
const sourceListingWorkbench = fs.readFileSync('apps/web/src/components/source-listing/source-listing-workbench.tsx', 'utf8');
const reviewHandoff = fs.readFileSync('apps/server/src/services/browser-one-click-review-handoff.ts', 'utf8');
const backendWorker = fs.existsSync('apps/server/src/workers/browser-one-click-listing.ts')
  ? fs.readFileSync('apps/server/src/workers/browser-one-click-listing.ts', 'utf8')
  : '';
const listOverlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');

test('browser one-click listing creates reviewed source projections instead of temporary publish records', () => {
  assert.doesNotMatch(
    backendWorker,
    /ephemeralListing|ensureBrowserOneClickSupplyGoods|appendBrowserOneClickListingRows|prisma\.supplyGoods\.create/,
    'the compatibility worker must not create temporary goods from browser evidence',
  );
  assert.match(
    listingRoute,
    /sourceCaptureService\.ensureLegacyProjection\([\s\S]*sourceCaptureService\.ingestLegacy\(/,
    'ERP should normalize browser evidence through the source-capture boundary',
  );
  assert.match(
    listingRoute,
    /resolveLegacySourceListingCompatibility\([\s\S]*browserOneClickV2Handoff\(/,
    'ERP should create reviewed source-listing drafts before completing the handoff',
  );
  assert.match(
    listingRoute,
    /stage:\s*'review_required'[\s\S]*browserOneClickPublishHandoff:\s*handoff/,
    'a complete evidence upload should stop at the explicit review-required state',
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

test('browser one-click listing hands off to reviewed V2 drafts and has no legacy worker publisher', () => {
  const publishOzonStart = collectRoute.indexOf("app.post('/publish-ozon'");
  const publishOzonEnd = collectRoute.indexOf('  // 诊断端点', publishOzonStart);
  assert.ok(publishOzonStart >= 0 && publishOzonEnd > publishOzonStart, 'legacy publish-ozon route should be present');
  const publishOzonRoute = collectRoute.slice(publishOzonStart, publishOzonEnd);

  assert.match(reviewHandoff, /BROWSER_ONE_CLICK_V2_HANDOFF_VERSION\s*=\s*'browser-one-click-v2-handoff\/v1'/);
  assert.match(listingRoute, /contractVersion:\s*BROWSER_ONE_CLICK_V2_HANDOFF_VERSION/);
  assert.match(listingRoute, /REVIEW_REQUIRED/);
  assert.doesNotMatch(backendWorker, /\/api\/collect\/publish-ozon/);
  assert.doesNotMatch(backendWorker, /createInternalAuthToken|signToken|storeSession/);
  assert.doesNotMatch(backendWorker, /fetch\s*\(/);
  assert.match(listingRoute, /publisherRollout/);
  assert.match(listingRoute, /browserOneClickPublishHandoff/);
  assert.match(listingRoute, /需在 ERP 草稿工作台完成审核后发布/);
  assert.match(publishOzonRoute, /browser_one_click_review_required[\s\S]*terminal:\s*true/);
  assert.match(
    publishOzonRoute,
    /\['dual_read',\s*'v2_only'\]\.includes\(sourceListingCompatibility\.stage\)[\s\S]*normalizeSourceListingDraftIdentityRefs\(body\.draftRefs\)[\s\S]*assertSourceListingDraftIdentity/,
    'legacy compatibility publishing must require an exact reviewed draft identity in interactive rollout stages',
  );
  assert.match(
    publishOzonRoute,
    /errorCode:\s*'source_listing_v2_publisher_required'[\s\S]{0,120}terminal:\s*true/,
    'the mutable legacy publisher must terminally refuse a reviewed source-listing draft',
  );
  const v2RefusalIndex = publishOzonRoute.indexOf("errorCode: 'source_listing_v2_publisher_required'");
  const ozonConstructionIndex = publishOzonRoute.indexOf("const { OzonClient } = await import('../services/ozon-client.js')");
  assert.ok(
    v2RefusalIndex >= 0 && ozonConstructionIndex > v2RefusalIndex,
    'reviewed drafts must be refused before the legacy route constructs an Ozon client',
  );
  assert.match(publishOzonRoute, /已审核来源草稿只能通过不可变 V2 发布器提交/);
  assert.match(
    listingRoute,
    /app\.post\('\/batch'[\s\S]*sendLegacyDraftPublisherRequired[\s\S]*app\.post\('\/ozon\/import-by-sku'[\s\S]*sendLegacyDraftPublisherRequired/,
    'every mutable listing publisher must refuse an explicit source-listing draft identity',
  );
  assert.match(
    listingRoute,
    /previousPayload\.source\s*!==\s*'browser-one-click-listing'[\s\S]*previousPayload\.browserOneClickJob\s*!==\s*true[\s\S]*任务不存在/,
    'the browser one-click patch route must reject ordinary PRODUCT_PUSH jobs',
  );
  assert.match(
    listingRoute,
    /persistBrowserOneClickTerminalFailure[\s\S]*browserOneClickTerminalFailure[\s\S]*browser_payload_revision_required/,
    'terminal browser payload failures must be persisted before the extension queue is released',
  );
  assert.match(
    sourceListingWorkflowRoute,
    /app\.post\('\/:draftId\/publish-attempts'[\s\S]*requireV2PublisherFeature[\s\S]*options\.publisher\.publish\(/,
    'the source-listing workflow must retain the immutable V2 publish-attempt route',
  );
  assert.match(sourceListingWorkbench, /sourceListingWorkflowClient\.createPublishAttempt\(/);
  assert.doesNotMatch(sourceListingWorkbench, /\/api\/collect\/publish-ozon|draftRefs/);
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

test('browser one-click listing does not enter the legacy ERP publish worker', () => {
  const createStart = listingRoute.indexOf('export async function createBrowserOneClickListingJobForActor');
  const createEnd = listingRoute.indexOf('export async function patchBrowserOneClickListingJobForActor', createStart);
  assert.ok(createStart >= 0 && createEnd > createStart, 'browser one-click create handler should be present');
  const createHandler = listingRoute.slice(createStart, createEnd);
  assert.doesNotMatch(
    createHandler,
    /addBrowserOneClickListingJob/,
    'browser one-click job creation must wait for evidence instead of enqueuing a publisher',
  );
  assert.match(
    createHandler,
    /queued:\s*false[\s\S]*deferred:\s*true/,
    'the create response should tell the extension that browser evidence is still required',
  );
  assert.match(
    backendWorker,
    /parseBrowserOneClickReviewHandoff\(payload\.browserOneClickPublishHandoff\)[\s\S]*if\s*\(handoff\)[\s\S]*reason:\s*'v2_review_required'/,
    'the retained compatibility worker should only recognize a completed review handoff',
  );
  assert.match(
    backendWorker,
    /stage:\s*'review_handoff_failed'[\s\S]*doNotRetry:\s*true[\s\S]*reason:\s*'v2_handoff_required'/,
    'legacy queued jobs without a review handoff should fail closed without replay',
  );
  assert.doesNotMatch(backendWorker, /fetch\s*\(|\/api\/collect\/publish-ozon|prisma\.supplyGoods\.create/);
});

test('Ozon one-click publish syncs target shop cookie before creating the backend job', () => {
  const createJobFn = background.match(/async function\s+createOzonWorkbenchPublishJob[\s\S]*?\n}\n\nasync function\s+submitOzonWorkbenchPublishJob/);
  assert.ok(createJobFn, 'extension should create one-click publish jobs through a dedicated helper');
  assert.match(
    createJobFn[0],
    /await\s+ensureOzonWorkbenchPublishCookieSynced\(\s*shopId\s*,\s*options\s*\)/,
    'one-click publish should refresh the selected shop Ozon cookie/company_id before the ERP backend tries Ozon CDN uploads',
  );
  assert.match(
    background,
    /async function\s+ensureOzonWorkbenchPublishCookieSynced[\s\S]*syncOzonCookieToShopForSync/,
    'collect background should reuse the service-worker Ozon cookie sync helper instead of duplicating sync logic',
  );
});

test('Ozon one-click cookie sync keeps the target shop company_id when available', () => {
  const syncFn = serviceWorker.match(/async function\s+syncOzonCookieToShopForSync[\s\S]*?\n}\n\nglobalThis\.syncOzonCookieToShopForSync/);
  assert.ok(syncFn, 'service worker should expose a dedicated target-shop cookie sync helper');
  assert.match(
    syncFn[0],
    /preferStoredCompanyId[\s\S]*options[\s\S]*useStoredCompanyId[\s\S]*\[storedCompanyId,\s*payloadCompanyId,\s*tabCompanyId,\s*capturedCompanyId,\s*cookieCompanyId\]/,
    'one-click sync should prefer the target shop stored company_id over the currently active seller tab company_id',
  );
});

test('Ozon one-click cookie sync targets the paired device ERP backend', () => {
  assert.match(
    serviceWorker,
    /async function\s+getOzonAutoSyncConnection[\s\S]*OZON_CALC_ERP_ENDPOINT_KEY[\s\S]*'ss_erp_connection'[\s\S]*apiBase:\s*endpoint\s*\?\s*endpoint\.replace\(\/\\\/api\\\/\.\*\$\/,\s*''\)\s*:\s*''/,
    'cookie sync should derive apiBase from the configured ERP endpoint instead of assuming localhost',
  );
  assert.match(
    serviceWorker,
    /fetch\(\s*operation\.baseUrl\s*\+\s*'\/api\/extension-device\/shops\/'[\s\S]*encodeURIComponent\(normalizedShopId\)\s*\+\s*'\/ozon-cdn-auth'/,
    'cookie sync should write the selected shop login state through the scoped device endpoint',
  );
  assert.match(
    serviceWorker,
    /Authorization:\s*'Bearer '\s*\+\s*operation\.accessToken/,
    'cookie sync should authenticate with the paired device session instead of a tenant token',
  );
  assert.match(
    serviceWorker,
    /ss_erp_connection:\s*\{\s*baseUrl,\s*token\s*\}/,
    'saving a VPS/cloud ERP endpoint should keep the legacy one-click connection in sync',
  );
});

test('Ozon one-click publish payload completion survives MV3 background restarts', () => {
  const createJobFn = background.match(/async function\s+createOzonWorkbenchPublishJob[\s\S]*?\n}\n\nasync function\s+submitOzonWorkbenchPublishJob/);
  assert.ok(createJobFn, 'extension should create one-click publish jobs through a dedicated helper');
  assert.match(
    background,
    /OZON_WORKBENCH_PUBLISH_PAYLOAD_QUEUE_KEY/,
    'extension should persist unfinished one-click publish payload jobs in chrome.storage.local',
  );
  assert.match(
    createJobFn[0],
    /await\s+upsertOzonWorkbenchPublishPayloadJob\(\s*\{[\s\S]*jobId[\s\S]*productIds[\s\S]*options/,
    'one-click publish should persist the browser payload job before running async enrichment',
  );
  assert.match(
    createJobFn[0],
    /void\s+flushOzonWorkbenchPublishPayloadQueue\(\)/,
    'one-click publish should run the persisted payload queue instead of relying on one detached promise',
  );
  assert.match(
    background,
    /async function\s+flushOzonWorkbenchPublishPayloadQueue[\s\S]*completeOzonWorkbenchPublishJobPayload[\s\S]*removeOzonWorkbenchPublishPayloadJob/,
    'payload queue flush should complete and then remove recovered jobs',
  );
  assert.match(
    background,
    /chrome\.runtime\.onInstalled[\s\S]*flushOzonWorkbenchPublishPayloadQueue/,
    'extension install/reload should resume unfinished browser payload jobs',
  );
  assert.match(
    background,
    /chrome\.runtime\.onStartup[\s\S]*flushOzonWorkbenchPublishPayloadQueue/,
    'browser startup should resume unfinished browser payload jobs',
  );
  assert.match(
    background,
    /chrome\.alarms\.create\(OZON_WORKBENCH_PUBLISH_PAYLOAD_ALARM_NAME[\s\S]*chrome\.alarms\.onAlarm[\s\S]*OZON_WORKBENCH_PUBLISH_PAYLOAD_ALARM_NAME[\s\S]*flushOzonWorkbenchPublishPayloadQueue/,
    'alarm wakeups should keep retrying unfinished browser payload jobs on VPS/local deployments',
  );
});
test('browser one-click listing streams complete Ozon evidence into ERP review drafts', () => {
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
    'evidence rows should carry Ozon attributes/category/type/variants for ERP draft generation',
  );
  assert.doesNotMatch(
    publishRowsFn[0],
    /collectOzonProductsToErp/,
    'evidence preparation must not write browser-collected goods directly into ERP',
  );
  assert.match(
    background,
    /streamOzonWorkbenchPublishRowsToJob[\s\S]*browserPayloadBatch:\s*true[\s\S]*rows:\s*\[row\]/,
    'extension should stream enriched rows into the visible ERP job one SKU at a time',
  );
  assert.match(
    listingRoute,
    /sourceCaptureService\.ensureLegacyProjection\([\s\S]*sourceCaptureService\.ingestLegacy\(/,
    'ERP should turn each completed evidence row into a stable source capture',
  );
  assert.match(
    listingRoute,
    /browserOneClickPublishHandoff:\s*handoff[\s\S]*sourceListingDraftRefs:\s*draftRefs/,
    'ERP should bind captured evidence to review drafts and expose the handoff on the listing job',
  );
  assert.doesNotMatch(
    backendWorker,
    /buildBrowserOneClickOzonMetadata|appendBrowserOneClickListingRows|prisma\.supplyGoods\.create|fetch\s*\(/,
    'the compatibility worker must not persist evidence or call a publisher',
  );
});

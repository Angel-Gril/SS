import assert from 'node:assert/strict';
import fs from 'node:fs';

const overlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');
const background = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
function functionSlice(source, name) {
  const start = source.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} should exist`);
  const next = source.indexOf('\n  function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

const listQuickDock = functionSlice(overlay, 'ensureListQuickActions');
const listWorkbench = functionSlice(overlay, 'openListSkuWorkbench');

assert.doesNotMatch(
  overlay,
  /轻量商品指标条|ss-erp-details|更多数据|需授权/,
  'Ozon list overlay should not regress to the accidental lightweight redesign',
);
assert.match(
  overlay,
  /ss-erp-collect-btn/,
  'Ozon list overlay should keep the established list-card collect action',
);
assert.match(
  overlay,
  /ss-erp-expand-btn/,
  'Ozon list overlay should keep the established list-card expansion control',
);
assert.doesNotMatch(
  overlay,
  /className\s*=\s*['"]ss-erp-list-workbench-bar['"]/,
  'Ozon list overlay should not render a second bottom workbench launcher alongside the right ERP tool dock',
);
assert.match(
  overlay,
  /ss-erp-list-quick-actions/,
  'Ozon list pages should expose the same right-side ERP tool panel as product pages',
);
for (const role of [
  'quick-open-workbench',
  'quick-profit',
  'quick-bind-cookie',
  'quick-selection-settings',
  'quick-auto-scroll',
  'quick-open-erp',
]) {
  assert.match(listQuickDock, new RegExp(`data-role="${role}"`), `Ozon list quick toolbar should expose ${role}`);
}
assert.doesNotMatch(
  listQuickDock,
  /data-role="quick-open-insights"/,
  'Ozon list quick toolbar should not expose the old selection-data entry point',
);
assert.match(
  listQuickDock,
  /quick-selection-settings[\s\S]*showProductSelectionRulesModal\(\)/,
  'Ozon list quick toolbar should keep the selection rule settings entry',
);
assert.doesNotMatch(
  overlay,
  /data-role="quick-pricing"|定价策略|openErpPage\('\/products'\)/,
  'Ozon list quick toolbar should not expose a standalone pricing strategy button unrelated to the current page',
);
assert.match(
  overlay,
  /function\s+openExtensionSettingsPage/,
  'Ozon list quick toolbar should retain the extension settings helper for non-cookie setup flows',
);
assert.match(
  overlay,
  /function\s+syncOzonCookieFromQuickAction/,
  'Ozon list quick Cookie button should sync cookies directly from the page toolbar',
);
assert.match(
  overlay,
  /ozon-calc:sync-current-ozon-cookie/,
  'Ozon list quick Cookie button should reuse the popup Cookie sync backend path',
);
assert.match(
  overlay,
  /function\s+autoSyncCurrentOzonCookieForListData[\s\S]*ozon-calc:sync-current-ozon-cookie/,
  'Ozon list KPI loading should automatically sync the currently logged-in seller cookie before relying on ERP-side Ozon data',
);
assert.match(
  overlay,
  /autoSyncCurrentOzonCookieForListData\(\)[\s\S]*failedPremiumCache\.clear\(\)/,
  'Ozon list KPI auto cookie sync should clear stale Premium failure cache after the seller shop is corrected',
);
assert.doesNotMatch(
  overlay,
  /quick-bind-cookie[\s\S]{0,500}openExtensionSettingsPage\('cookie'\)/,
  'Ozon list quick Cookie button should not navigate to settings.html#cookie from the Ozon page',
);
assert.match(
  listQuickDock,
  /quick-open-workbench[\s\S]*quickActionButtonStyle\(SS_ERP_LIST_THEME\.primary,\s*'#ffffff'/,
  'Ozon list quick toolbar should use the shared ERP theme token for the primary one-click listing action',
);
assert.match(
  overlay,
  /quick-open-workbench[\s\S]*openListSkuWorkbench\(\{\s*focus:\s*'publish'\s*\}\)/,
  'Ozon list primary action should open the SKU publishing workbench',
);
assert.doesNotMatch(
  overlay,
  /data-role="quick-filter-matched"/,
  'Ozon list quick toolbar should not have a separate rule-match button that opens the same seller workbench',
);
assert.match(
  listQuickDock,
  /data-role="quick-match-summary"/,
  'Ozon list quick toolbar should show selection-rule match counters for listing candidate filtering',
);
assert.match(
  overlay,
  /展示字段/,
  'Ozon list overlay should expose the field display configuration entry',
);
assert.match(
  overlay,
  /选择需要展示的数据/,
  'Ozon list overlay should render the dense field-selection modal from the workbench toolbar',
);
for (const sourceLabel of ['Ozon seller直出', '接口补充', '规则/计算']) {
  assert.match(overlay, new RegExp(sourceLabel), `Ozon list field config should label ${sourceLabel} fields`);
}
for (const sourceKey of ["source: 'seller'", "source: 'supplement'", "source: 'computed'"]) {
  assert.match(overlay, new RegExp(sourceKey.replace(/[']/g, "['\"]")), `Ozon list display field definitions should include ${sourceKey}`);
}
assert.match(
  overlay,
  /ss-erp:ozon-list-display-fields/,
  'Ozon list overlay should persist selected display fields',
);
assert.match(
  overlay,
  /spb-self-hosted:fetch-ozon-workbench-rows/,
  'Ozon list overlay workbench should reuse the same row-fetch message as the detail workbench',
);
assert.match(
  overlay,
  /function\s+showSellerListModal/,
  'Ozon list overlay should let users inspect follow sellers instead of showing a dead seller text field',
);
assert.match(
  overlay,
  /SS ERP 跟卖列表/,
  'Ozon seller list modal should use the SS ERP dialog title',
);
assert.match(
  overlay,
  /SS_ERP_LIST_THEME/,
  'Ozon list overlay dialogs should share the SS ERP warm theme tokens',
);
assert.match(
  overlay,
  /linear-gradient\(135deg,\s*#9a3412[\s\S]*#ea580c/,
  'Ozon list dialogs should use the same orange ERP header tone as the extension data panel',
);
assert.doesNotMatch(
  overlay,
  /background:rgba\(124,45,18/,
  'Ozon list dialogs should not tint the whole Ozon page yellow/brown when a modal opens',
);
assert.match(
  overlay,
  /跟卖数[\s\S]*最低[\s\S]*最高/,
  'Ozon seller list modal should show seller count and min/max price summary',
);
assert.doesNotMatch(
  overlay,
  />头像</,
  'Ozon seller list modal should not use a separate avatar header that breaks the square table style',
);
assert.match(
  overlay,
  /data-role="open-seller-list"/,
  'Ozon list overlay should render the seller list as a clickable control when seller data is available',
);
assert.match(
  overlay,
  /sellerOffers/,
  'Ozon list overlay should understand the raw seller offers passed through from the Ozon seller list source',
);
assert.match(
  overlay,
  /function\s+buildListWorkbenchSeedRows/,
  'Ozon list workbench should render page/cache seed rows immediately before slow seller enrichment returns',
);
assert.match(
  overlay,
  /renderListWorkbenchRows\(modal,\s*seedRows,\s*skus\)/,
  'Ozon list workbench should show cached page rows immediately',
);
assert.match(
  overlay,
  /rows:\s*seedRows/,
  'Ozon list workbench should pass seed rows to background so it can reuse already-loaded card data',
);
assert.match(
  overlay,
  /spb-self-hosted:publish-ozon-workbench-rows/,
  'Ozon list overlay workbench should reuse the same direct publish message as the detail workbench',
);
assert.match(
  overlay,
  /data-role="workbench-table-wrap"/,
  'Ozon list workbench should isolate the scroll container used by sticky table headers',
);
assert.match(
  overlay,
  /data-role="workbench-shell"[\s\S]*resize:both/,
  'Ozon list workbench shell should be manually resizable when the table needs more width',
);
assert.match(
  overlay,
  /position:sticky;\s*top:0;\s*z-index:3/,
  'Ozon list workbench should stick individual header cells above table rows instead of letting the header pierce through content',
);
assert.doesNotMatch(
  overlay,
  /<th[^>]+border:1px solid #4b5563/,
  'Ozon list workbench header cells should use light grid lines instead of dark borders that look like table bleed-through',
);
assert.doesNotMatch(
  listWorkbench,
  /data-role="export-workbench-skus"/,
  'Ozon list workbench should not expose export from the listing-only panel',
);
assert.match(
  overlay,
  /LIST_WORKBENCH_COLUMN_WIDTHS_STORAGE_KEY/,
  'Ozon list workbench should persist user-adjusted table column widths',
);
assert.match(
  overlay,
  /data-role="workbench-col-resize-handle"/,
  'Ozon list workbench headers should expose drag handles for manual column width adjustment',
);
assert.match(
  overlay,
  /resize-grip/,
  'Ozon list workbench should keep resize hit targets for manual column width adjustment',
);
assert.match(
  overlay,
  /\.resize-grip::after[\s\S]*opacity:0/,
  'Ozon list workbench resize grips should be visually hidden by default so header dividers do not appear in the middle of columns',
);
assert.match(
  overlay,
  /th:hover \.resize-grip::after[\s\S]*opacity:\.55/,
  'Ozon list workbench resize grips should only become subtly visible on header hover',
);
assert.match(
  overlay,
  /initListWorkbenchColumnResize\(modal\)/,
  'Ozon list workbench should initialize column resize interactions when the modal opens',
);
assert.match(
  overlay,
  /downloadListWorkbenchExcel\(/,
  'Ozon list workbench export should download an Excel-compatible table file',
);
assert.match(
  overlay,
  /function\s+buildListWorkbenchXlsxBytes[\s\S]*createZipArchive/,
  'Ozon list workbench export should generate a real xlsx workbook instead of an HTML file with an Excel extension',
);
assert.match(
  overlay,
  /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
  'Ozon list workbench export should use the xlsx MIME type',
);
assert.match(
  overlay,
  /\.xlsx/,
  'Ozon list workbench export should create a real .xlsx file that Excel can open without format-mismatch warnings',
);
assert.match(
  overlay,
  /spb-self-hosted:download-ozon-workbench-excel/,
  'Ozon list workbench Excel export should use the extension downloads API instead of relying only on page clipboard permissions',
);
assert.match(
  background,
  /base64:\s*message\.base64[\s\S]*mime:\s*message\.mime/,
  'Ozon workbench Excel export should pass xlsx base64/mime through the background downloads API',
);
assert.match(
  overlay,
  /observedListSkuSet/,
  'Ozon list workbench should keep an accumulated SKU pool across Ozon virtual scrolling',
);
assert.match(
  overlay,
  /rememberVisibleListSkus\(\)/,
  'Ozon list scans should remember newly visible SKUs before refreshing the quick action count',
);
assert.match(
  overlay,
  /LIST_PRELOAD_ROOT_MARGIN/,
  'Ozon list overlay should preload a bounded look-ahead window instead of waiting until cards are directly visible',
);
assert.match(
  overlay,
  /rootMargin:\s*LIST_PRELOAD_ROOT_MARGIN/,
  'Ozon list IntersectionObserver should use the bounded preload window',
);
assert.doesNotMatch(
  overlay,
  /rootMargin:\s*['"]200px['"]/,
  'Ozon list KPI loading should not wait until the card is almost in view before starting data fetches',
);
assert.match(
  overlay,
  /data-role="follow-brand"/,
  'Ozon list workbench should expose the follow-brand option before publishing',
);
assert.match(
  overlay,
  /data-role="watermark-template"/,
  'Ozon list workbench should expose watermark template selection before publishing',
);
assert.match(
  overlay,
  /function\s+loadListWorkbenchWatermarkTemplates/,
  'Ozon list workbench should load ERP watermark templates for the selected shop',
);
assert.match(
  overlay,
  /loadListWorkbenchShops[\s\S]*if\s*\(\s*!response\s*\|\|\s*!response\.ok\s*\)\s*throw new Error/,
  'Ozon list workbench should surface ERP shop loading errors instead of rendering an empty shop dropdown',
);
assert.match(
  overlay,
  /没有可用 OZON 店铺/,
  'Ozon list workbench should explain when the current ERP account has no Ozon shops',
);
assert.match(
  overlay,
  /loadListWorkbenchWatermarkTemplates[\s\S]*if\s*\(\s*!response\s*\|\|\s*!response\.ok\s*\)\s*throw new Error/,
  'Ozon list workbench should surface watermark loading errors instead of rendering an empty watermark dropdown',
);
assert.match(
  overlay,
  /没有可用水印/,
  'Ozon list workbench should explain when the current ERP account has no watermark templates',
);
assert.match(
  overlay,
  /function\s+buildListWorkbenchWatermarkConfig[\s\S]*type[\s\S]*text[\s\S]*imageUrl[\s\S]*position[\s\S]*opacity[\s\S]*fontSize[\s\S]*fontColor[\s\S]*scale/,
  'Ozon list workbench should pass the same watermark fields as the detail publish panel',
);
assert.match(
  overlay,
  /publishListWorkbenchSelectedRows[\s\S]*watermark:\s*watermark/,
  'Ozon list publish should send watermark config to the backend listing job',
);
assert.match(
  background,
  /\/api\/listing\/browser-one-click-jobs/,
  'Ozon one-click publish should create a listing-log job before long collect/watermark work starts',
);
assert.doesNotMatch(
  background,
  /submitOzonWorkbenchPublishJob[\s\S]*const\s+result\s*=\s*await\s+publishOzonWorkbenchRows/,
  'Ozon one-click publish should not keep the page message open while waiting for Ozon taskId',
);
assert.doesNotMatch(
  background,
  /const\s+run\s*=\s*publishOzonWorkbenchRows/,
  'Ozon one-click publish should not rely on a detached Promise after returning from the MV3 message handler',
);
assert.doesNotMatch(
  background,
  /submitOzonWorkbenchPublishJob[\s\S]*enqueueOzonWorkbenchPublishQueueJob/,
  'Ozon one-click publish should not enqueue the long flow in the extension background; ERP worker owns it',
);
assert.match(
  background,
  /createOzonWorkbenchPublishJob\(productIds,\s*options\)[\s\S]*return\s*\{[\s\S]*queued:\s*true/,
  'Ozon one-click publish should return after ERP accepts the backend queued job',
);
assert.match(
  background,
  /function\s+buildOzonWorkbenchInitialPublishPayload[\s\S]*deferStart:\s*true/,
  'Ozon one-click publish should create a visible deferred listing-log job before browser-side enrichment starts',
);
assert.doesNotMatch(
  background,
  /async function createOzonWorkbenchPublishJob[\s\S]*await\s+buildOzonWorkbenchPublishPayload[\s\S]*\/api\/listing\/browser-one-click-jobs/,
  'Ozon one-click publish should not wait for full browser-side enrichment before creating the ERP listing log',
);
assert.match(
  background,
  /patchOzonWorkbenchPublishJob[\s\S]*\/api\/listing\/browser-one-click-jobs\/"\s*\+\s*encodeURIComponent\(jobId\)/,
  'Ozon one-click publish should patch the pre-created listing-log job by id',
);
assert.match(
  background,
  /completeOzonWorkbenchPublishJobPayload[\s\S]*browserPayloadReady:\s*true/,
  'Ozon one-click publish should patch enriched rows back to the pre-created listing-log job and then let ERP start the backend queue',
);
assert.match(
  background,
  /streamOzonWorkbenchPublishRowsToJob[\s\S]*browserPayloadBatch:\s*true[\s\S]*rows:\s*\[row\]/,
  'Ozon one-click publish should stream each enriched SKU row into ERP instead of waiting for the whole batch',
);
assert.doesNotMatch(
  background,
  /completeOzonWorkbenchPublishJobPayload[\s\S]*const\s+payload\s*=\s*await\s+buildOzonWorkbenchPublishPayload/,
  'Ozon one-click publish should not build the full publish payload before ERP can ingest temporary goods',
);
assert.doesNotMatch(
  background,
  /OZON_WORKBENCH_PUBLISH_QUEUE_KEY[\s\S]*runQueuedOzonWorkbenchPublishJob/,
  'Ozon one-click publish should not keep a browser-side persisted publish queue for long-running work',
);
assert.doesNotMatch(
  background,
  /onStartup[\s\S]*flushOzonWorkbenchPublishQueue/,
  'MV3 startup should not be responsible for resuming Ozon publish jobs after the backend owns the queue',
);
assert.doesNotMatch(
  background,
  /fetchOzonWorkbenchPublishJob[\s\S]*publishOzonWorkbenchRows/,
  'extension background should not replay ERP listing jobs locally',
);
assert.doesNotMatch(
  background,
  /function\s+hasOzonWorkbenchWatermarkOutput[\s\S]*watermarkedImages/,
  'watermark resume detection belongs in ERP worker, not in the extension background',
);
assert.doesNotMatch(
  background,
  /function\s+shouldResumeOzonWorkbenchPublishFromCollectedRows[\s\S]*watermarking[\s\S]*watermarked[\s\S]*publishing/,
  'ERP worker should own interrupted collect/watermark/publish stage recovery',
);
assert.doesNotMatch(
  background,
  /withOzonWorkbenchPublishStage[\s\S]*"collecting"[\s\S]*setOzonWorkbenchPublishStage[\s\S]*"watermarking"[\s\S]*setOzonWorkbenchPublishStage[\s\S]*"publishing"/,
  'extension background should not update collect/watermark/publish stages for backend-owned jobs',
);
assert.doesNotMatch(
  background,
  /OZON_ONE_CLICK_COLLECT_PRODUCT_TIMEOUT_MS[\s\S]*withTimeout\([\s\S]*fetchOzonProductViaTab/,
  'Ozon one-click listing should not run browser-tab product collection after the backend owns the job',
);
assert.match(
  overlay,
  /上架任务已提交到 ERP 上架日志/,
  'Ozon list publish panel should hand users off to ERP listing logs after submission',
);
assert.match(
  overlay,
  /loadListWorkbenchConnectionStatus[\s\S]*ozon-calc:erp-endpoint-get/,
  'Ozon list publish panel should show which ERP endpoint the extension is currently connected to',
);
assert.match(
  overlay,
  /function\s+loadListWorkbenchWatermarkTemplatesFallback[\s\S]*spb-self-hosted:get-watermark-templates[\s\S]*loadListWorkbenchWatermarkTemplates[\s\S]*loadListWorkbenchWatermarkTemplatesFallback/,
  'Ozon list publish panel should fall back to all watermark templates when a selected shop has no matching templates',
);
assert.match(
  overlay,
  /LIST_WORKBENCH_PUBLISH_TIMEOUT_MS\s*=\s*45\s*\*\s*1000/,
  'Ozon list publish panel should wait only for job acceptance, not for the full long-running publish flow',
);
assert.match(
  listWorkbench,
  /data-role="row-filter"[\s\S]*仅规则命中/,
  'Ozon list workbench should keep selection-rule filters for choosing listing candidates',
);
assert.match(
  overlay,
  /LIST_WORKBENCH_COLUMNS[\s\S]*key:\s*'select'[\s\S]*key:\s*'sku'[\s\S]*key:\s*'title'[\s\S]*key:\s*'selection'[\s\S]*key:\s*'price'/,
  'Ozon list workbench headers should align with rendered row cells when showing selection-rule tags',
);
assert.match(
  overlay,
  /value="rule:\$\{escapeHtml\(rule\.id\)\}"[\s\S]*rowFilter\.startsWith\('rule:'\)[\s\S]*matchedRules\.some/,
  'Ozon list workbench should offer rule-specific filters and apply them before listing',
);
assert.match(
  overlay,
  /function\s+listWorkbenchModeButtonStyle/,
  'Ozon list workbench should centralize its mode button style',
);
assert.match(
  overlay,
  /function\s+setListWorkbenchMode/,
  'Ozon list workbench should update mode state through one function',
);
assert.match(
  overlay,
  /function\s+getListWorkbenchModeTitle/,
  'Ozon list workbench should give each quick-action mode a distinct title',
);
assert.match(
  overlay,
  /data-role="workbench-title"/,
  'Ozon list workbench should expose a title element that changes by mode',
);
assert.match(
  overlay,
  /data-role="workbench-subtitle"/,
  'Ozon list workbench should expose a subtitle element that explains the current mode',
);
assert.doesNotMatch(
  listWorkbench,
  /data-role="workbench-view"|data-mode="data"|data-mode="profit"/,
  'Ozon list workbench should not expose data/profit mode tabs',
);
assert.match(
  listQuickDock,
  /quick-profit[\s\S]*openProfitCalculatorFromQuickAction\(\)/,
  'Ozon list profit action should open the dedicated calculator entry instead of the same SKU workbench',
);
assert.doesNotMatch(
  listQuickDock,
  /quick-open-insights[\s\S]*openListSkuWorkbench\(\{\s*rowFilter:\s*'all',\s*focus:\s*'data'\s*\}\)/,
  'Ozon list quick toolbar should not expose a selection-data workbench action',
);
assert.match(
  overlay,
  /setListWorkbenchMode\(modal,\s*modal\.__ssErpWorkbenchFocus/,
  'Ozon list workbench should apply its initial mode after rendering',
);
for (const role of [
  'workbench-filter-toolbar',
  'workbench-batch-toolbar',
  'publish-target-controls',
  'pricing-controls',
  'workbench-footer-actions',
]) {
  assert.match(listWorkbench, new RegExp(`data-role="${role}"`), `Ozon list workbench should expose ${role}`);
}
assert.doesNotMatch(
  listWorkbench,
  /data-role="save-workbench-data"|data-role="add-selected-workbench-skus-to-pool"|data-role="delete-selected-workbench-skus"|data-role="export-workbench-skus"/,
  'Ozon list workbench should not expose save/pool/delete/export actions in the listing-only panel',
);
assert.match(
  overlay,
  /function\s+listWorkbenchFooterStyle/,
  'Ozon list workbench should centralize its footer surface style',
);
assert.match(
  overlay,
  /data-role="workbench-batch-toolbar"[\s\S]*background:\$\{SS_ERP_LIST_THEME\.surface\}/,
  'Ozon list workbench batch toolbar should use a neutral surface instead of a large orange band',
);
assert.match(
  overlay,
  /listWorkbenchFooterStyle\(\)/,
  'Ozon list workbench footer should use the neutral workbench footer style',
);
assert.match(
  overlay,
  /data-mode-scope="publish"/,
  'Ozon list workbench should mark publish-only controls so data/profit modes do not look like the same seller publish panel',
);
assert.match(
  overlay,
  /data-mode-scope="pricing"/,
  'Ozon list workbench should mark pricing controls so the data mode can stay focused on metrics',
);
assert.match(
  overlay,
  /const\s+includeOffers\s*=\s*modal\.__ssErpWorkbenchFocus\s*===\s*'publish'[\s\S]*includeOffers:\s*(?:includeOffers|modal\.__ssErpWorkbenchFocus\s*===\s*'publish')/,
  'Ozon list workbench should fetch slow seller-offer details only in publish mode',
);
assert.match(
  overlay,
  /function\s+shouldReloadListWorkbenchRowsForMode/,
  'Ozon list workbench should avoid full seller-data reloads when switching between already-loaded data/profit views',
);
assert.match(
  overlay,
  /__ssErpListWorkbenchRowsHaveOffers/,
  'Ozon list workbench should remember whether slow publish offer details have already been loaded',
);
assert.match(
  overlay,
  /const\s+lockSkus\s*=\s*Boolean\(options\s*&&\s*options\.lockSkus\)/,
  'Ozon list single-card publish should support a locked SKU scope',
);
assert.match(
  overlay,
  /const\s+observedSkus\s*=\s*modal\.__ssErpLockSkus\s*\?\s*\[\]\s*:\s*getCurrentPageSkus\(\)/,
  'Ozon list locked SKU workbench should not merge in the whole current page',
);
assert.match(
  overlay,
  /ss-erp-publish-btn[\s\S]*openListSkuWorkbench\(\{\s*skus:\s*\[sku\],\s*lockSkus:\s*true,\s*focus:\s*'publish'\s*\}\)/,
  'Ozon list card publish action should open the workbench locked to that SKU',
);
assert.match(
  overlay,
  /AUTO_SCROLL_STEP_DELAY_MIN_MS\s*=\s*3000[\s\S]*AUTO_SCROLL_STEP_DELAY_MAX_MS\s*=\s*5000[\s\S]*AUTO_SCROLL_MAX_STEPS\s*=\s*400/,
  'Ozon list auto-scroll should use a slower 3-5s random interval while keeping the hard step cap',
);
assert.match(
  overlay,
  /function\s+getAutoScrollStepDelayMs\(\)[\s\S]*Math\.random\(\)/,
  'Ozon list auto-scroll should randomize each wait instead of using a fixed one-second cadence',
);
assert.doesNotMatch(
  overlay,
  /setTimeout\([^,\n]+,\s*AUTO_SCROLL_STEP_MS\)/,
  'Ozon list auto-scroll should not schedule steps with the old fixed one-second delay',
);
assert.match(
  overlay,
  /stableRounds\s*>=\s*AUTO_SCROLL_MAX_STABLE\s*&&\s*atBottom/,
  'Ozon list auto-scroll should only stop as loaded when stable and actually at the bottom',
);
assert.match(listWorkbench, /一键上架选中商品/, 'Ozon list workbench footer should expose the one-click listing action');
assert.doesNotMatch(
  listWorkbench,
  /保存|加入选品池|删除选中 SKU|导出选中 SKU/,
  'Ozon list workbench footer should not expose selection-data management actions',
);
assert.doesNotMatch(
  overlay,
  /选中后直接提交|不进入采集列表|规则保存在 ERP|字段为空表示|本地生效缓存|列表卡片打标|工作台可筛选|跳过慢跟卖明细|读取完整跟卖明细/,
  'Ozon list dialogs should avoid explanation-style helper copy in the operational UI',
);
assert.match(
  overlay,
  /ssErpModalIn/,
  'Ozon list dialogs should use the same lightweight entrance motion',
);
assert.match(
  overlay,
  /function\s+showProductSelectionRulesModal/,
  'Ozon list overlay should provide a local product selection rule settings modal',
);
assert.match(
  overlay,
  /data-role="selection-rule-list-table"/,
  'Ozon selection rules modal should use a Maozi-style rule list table as the first layer',
);
assert.match(
  overlay,
  /function\s+selectionRuleTableRow/,
  'Ozon selection rules modal should render compact table rows before opening the full editor',
);
assert.match(
  overlay,
  /data-role="selection-rule-editor"/,
  'Ozon selection rules modal should open a separate add/edit editor instead of inlining every condition',
);
assert.match(
  overlay,
  /function\s+selectionRuleSection/,
  'Ozon selection rule editor should group conditions into Maozi-style sections',
);
assert.match(
  overlay,
  /function\s+selectionRuleRange/,
  'Ozon selection rule editor should render min/max conditions as compact range inputs',
);
for (const sectionTitle of ['规则基础', '商品基础', '销售与价格', '流量转化', '促销与时间', '跟卖与利润']) {
  assert.match(overlay, new RegExp(sectionTitle), `Ozon selection rule editor should expose ${sectionTitle} section`);
}
assert.doesNotMatch(
  overlay,
  /selection-rules-list">\$\{editableRules\.map\(\(rule,\s*index\)\s*=>\s*selectionRuleEditorRow/,
  'Ozon selection rules modal should not dump the full condition editor into the rule list',
);
for (const tableHeader of ['规则名称', '标签', '自动入池', '是否启用', '优先级', '更新时间', '操作']) {
  assert.match(overlay, new RegExp(tableHeader), `Ozon selection rule list should expose ${tableHeader}`);
}
assert.doesNotMatch(
  overlay,
  /自动收藏/,
  'Ozon selection rule UI should not imply it writes to the Ozon favorite list',
);
assert.match(
  overlay,
  /rule-priority/,
  'Ozon selection rule editor should support rule priority/sort like Maozi rules',
);
assert.match(
  overlay,
  /function\s+sortProductSelectionRulesByPriority/,
  'Ozon selection rules should centralize priority ordering',
);
assert.match(
  overlay,
  /function\s+normalizeProductSelectionRuleList[\s\S]*sortProductSelectionRulesByPriority/,
  'Ozon selection rules should apply high-priority rules first in lists and matching',
);
assert.match(
  overlay,
  /PRODUCT_SELECTION_RULES_STORAGE_KEY/,
  'Ozon selection rules should persist locally before backend rule-center sync exists',
);
assert.match(
  overlay,
  /autoFavorite:\s*normalizeRuleBoolean\([\s\S]*item\.autoFavorite[\s\S]*item\.auto_favorite[\s\S]*\)\s*===\s*true/,
  'Ozon selection rules should accept Maozi-style numeric/string auto_favorite snapshots',
);
assert.match(
  overlay,
  /function\s+maybeAutoFavoriteProductPool/,
  'Ozon selection rules should apply auto-favorite matches to a concrete local product pool action',
);
assert.match(
  overlay,
  /ozon-calc:product-pool-upsert/,
  'Ozon auto-favorite should write matched products into the extension product pool',
);
assert.match(
  overlay,
  /function\s+matchProductSelectionRules/,
  'Ozon list overlay should run a local selection-rule matching engine on row metrics',
);
for (const label of [
  '品牌包含',
  '有品牌',
  '价格≥',
  '价格≤',
  '重量≤',
  '上架天数≥',
  '上架天数≤',
  '促销天数≥',
  '促销天数≤',
  '折扣≤',
  '促销转化≥',
  '付费推广≥',
  '商品卡浏览≥',
  '商品卡加购≥',
  '搜索加购≥',
  '展示转化≥',
  '跟卖最低≤',
]) {
  assert.match(overlay, new RegExp(label), `Ozon selection rule editor should expose ${label}`);
}
for (const role of [
  'brand-contains',
  'has-brand',
  'min-price-rub',
  'max-price-rub',
  'max-weight-grams',
  'min-create-days',
  'max-create-days',
  'min-promo-days',
  'max-promo-days',
  'max-discount-percent',
  'min-promo-revenue-share',
  'min-paid-promotion-days',
  'min-product-card-views',
  'min-product-card-add-to-cart-rate',
  'min-search-catalog-add-to-cart-rate',
  'min-conv-view-to-order',
  'max-follow-min-price-rub',
]) {
  assert.match(overlay, new RegExp(`['"]${role}['"]`), `Ozon selection rule editor should wire ${role}`);
}
for (const metric of [
  'createDays',
  'promoDays',
  'discountPercent',
  'promoRevenueShare',
  'paidPromotionDays',
  'productCardViews',
  'productCardAddToCartRate',
  'searchCatalogAddToCartRate',
  'convViewToOrder',
  'followMinPriceRub',
]) {
  assert.match(overlay, new RegExp(metric), `Ozon selection-rule matching should use ${metric}`);
}
assert.doesNotMatch(
  overlay,
  /height:52px;background:#111827[\s\S]*close-selection-rules/,
  'Ozon selection rules modal should use the SS ERP warm theme instead of a deep black header',
);
assert.match(
  overlay,
  /function\s+deriveSelectionReturnCancelRate/,
  'Ozon selection-rule matching should derive return/cancel rate from redemption rate instead of relabeling it',
);
assert.doesNotMatch(
  overlay,
  /returnCancelRate:\s*firstPresentValue\(p\.returnCancelRate,\s*p\.nullableRedemptionRate/,
  'Ozon selection-rule rows should not use nullableRedemptionRate as the raw return/cancel rate',
);
assert.match(
  overlay,
  /data-ss-erp-selection-matched/,
  'Ozon list rows/cards should expose whether they matched selection rules',
);
assert.doesNotMatch(
  listWorkbench,
  /成本¥|物流费¥|佣金%|data-role="cost-cny"|data-role="logistics-fee-cny"|data-role="commission-rate"/,
  'Ozon list workbench should not expose profit-only cost/logistics/commission controls',
);
assert.match(
  overlay,
  /publishListWorkbenchSelectedRows[\s\S]*markupPct/,
  'Ozon list workbench publish should pass markup context through the full publish request',
);
for (const label of [
  '广告费占比',
  '退货取消率',
  '佣金',
  '利润率',
  '发货模式',
  '重量',
]) {
  assert.match(overlay, new RegExp(label), `Ozon list workbench table should expose ${label}`);
}
for (const field of [
  'row.adExpenseShare',
  'row.returnCancelRate',
  'row.commissionRate',
  'row.profitMarginPct',
  'row.salesSchema',
  'row.weightGrams',
]) {
  assert.match(overlay, new RegExp(field.replace(/[.]/g, '\\.')), `Ozon list workbench rows should render ${field}`);
}
assert.match(
  overlay,
  /'广告费占比'[\s\S]*'退货取消率'[\s\S]*'佣金'[\s\S]*'利润率'[\s\S]*'发货模式'[\s\S]*'重量'/,
  'Ozon list workbench export should include richer KPI columns, not only SKU/title/price',
);
assert.match(
  overlay,
  /function\s+getListWorkbenchDynamicExportFields/,
  'Ozon list workbench export should append currently selected display fields to the Excel file',
);
assert.match(
  overlay,
  /readSelectedDisplayFieldIds\(\)[\s\S]*DISPLAY_FIELD_DEFS/,
  'Ozon list workbench export should use the same display-field configuration as the card panel',
);
assert.match(
  overlay,
  /getDisplayFieldValue\(field\.id,\s*sku,\s*dom,\s*row\)/,
  'Ozon list workbench export should export the values users can show in the card display panel',
);
for (const label of [
  '类目',
  'SKU',
  '品牌',
  '月销量',
  '月销售额',
  '广告费占比',
  '浏览下单率',
  '搜索转换率',
  '结单率',
  '参与促销天数',
  '模板活动天数',
  '促销收入占比',
  '商品卡浏览量',
  '搜索目录浏览量',
  '商品点击率',
  '发货模式',
  '跟卖最低价',
  '跟卖最高价',
  '佣金',
  '价格指数',
]) {
  assert.match(overlay, new RegExp(label), `Ozon list field config should include ${label}`);
}

for (const fieldCase of [
  "case 'convViewToOrder'",
  "case 'convToCartSearch'",
  "case 'nullableRedemptionRate'",
  "case 'daysWithTrafarets'",
  "case 'promoRevenueShare'",
  "case 'commission'",
  "case 'ptj'",
]) {
  assert.match(overlay, new RegExp(fieldCase.replace(/[']/g, "['\"]")), `Ozon list overlay should render ${fieldCase}`);
}

assert.match(
  overlay,
  /ss-erp-overlay-card-expanded/,
  'Ozon list overlay should keep the established expanded-card styling hook',
);

assert.match(
  overlay,
  /ss-erp-status-pill["'][^>]+display:none/,
  'Ozon list overlay should hide the internal data-source pill without removing it',
);
assert.match(
  overlay,
  /Object\.assign\(\{\},\s*resp\.item,\s*\{\s*_sources:\s*resp\.sources\s*\|\|\s*\[\]/,
  'Ozon list overlay should still pass premium/source payloads into metric rendering',
);
assert.match(
  overlay,
  /_sourceErrors/,
  'Ozon list overlay should keep source failure details available for diagnostics',
);
assert.match(
  overlay,
  /hasDisplayablePremiumData/,
  'Ozon list overlay should not cache empty premium responses as successful detailed data',
);
assert.match(
  overlay,
  /function\s+normalizePercentMetric\(/,
  'Ozon list overlay should normalize percent metrics before rendering add-to-cart rate',
);
assert.match(
  overlay,
  /function\s+formatCategoryDisplay\(/,
  'Ozon list overlay should format category path together with Ozon seller category IDs',
);
assert.match(
  overlay,
  /case ['"]category['"]:[\s\S]*formatCategoryDisplay\(p\)/,
  'Ozon list category field should show the category ID context used by commission matching',
);
assert.match(
  overlay,
  /类目ID/,
  'Ozon expanded metrics should expose category IDs for commission/debug comparison',
);
assert.match(
  overlay,
  /pickAddCart\(p\)[\s\S]*normalizePercentMetric\(v\)/,
  'Ozon list overlay should render convToCartPdp as a percent whether the source sends 0.084 or 8.4',
);
assert.doesNotMatch(
  overlay,
  /Number\(v\)\s*\*\s*100/,
  'Ozon list overlay should not inflate already-normalized percent values by multiplying every value by 100',
);
assert.doesNotMatch(
  overlay,
  /数据状态|sourceErrors\.join/,
  'Ozon list overlay should not show raw seller/public/ERP source failures directly to users',
);
assert.match(
  background,
  /sourceErrors/,
  'Ozon insights aggregation should return sourceErrors instead of silently hiding data-source failures',
);
assert.doesNotMatch(
  background,
  /if\s*\(\s*!item\.soldCount\s*&&\s*!item\.sellerName\s*\)/,
  'Ozon insights aggregation should not skip public fallback just because seller returned partial fields',
);

console.log('PASS Ozon list overlay established UI');

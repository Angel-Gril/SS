import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const content = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');
const panel = fs.readFileSync('extensions/ss-erp/content/ozon-panel.js', 'utf8');
const background = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

test('Ozon product data panel keeps data actions separate from listing actions', () => {
  assert.doesNotMatch(content, /data-role="open-workbench"/);
  assert.match(content, /showOzonSkuWorkbench\(/);
  assert.match(content, /ss-erp-ozon-workbench-modal/);
  assert.match(content, /SS ERP 一键上架工作台/);
  assert.match(content, /SS ERP 利润测算工作台/);
  assert.match(content, /SS ERP 选品数据工作台/);
  assert.match(content, /一键上架选中商品/);
  assert.match(content, /data-role="quick-open-workbench"/);
  assert.match(content, /renderOzonPanel\(\{\s*expand:\s*false\s*\}\)/, 'product detail should keep the data panel collapsed on page load');
  assert.match(content, /quick-open-insights[\s\S]*renderOzonPanel\(\{\s*expand:\s*true\s*\}\)/, 'product detail should expand data metrics from the quick action dock');
  assert.doesNotMatch(content, /默认展开数据一览窗|📊/, 'product detail should not auto-open a second large floating panel or use emoji chrome');
});

test('Ozon product page exposes an SS ERP right quick action toolbar', () => {
  assert.match(content, /ss-erp-ozon-quick-actions/);
  assert.match(content, /renderOzonQuickActions\(/);
  assert.match(content, /data-role="quick-open-workbench"/);
  assert.match(content, /width:128px/, 'product quick toolbar should use the same width as the list quick toolbar');
  assert.match(
    content,
    /quick-open-workbench[\s\S]*quickActionButtonStyle\("#ea580c",\s*"#ffffff"/,
    'product quick toolbar should use ERP orange for the primary one-click listing action',
  );
  assert.doesNotMatch(
    content,
    /data-role="quick-pricing"|定价策略/,
    'product quick toolbar should not expose standalone pricing because pricing belongs inside the workbench controls',
  );
  for (const label of [
    '一键上架',
    '利润测算',
    '绑定Cookie',
    '选品数据',
    '设置选品',
  ]) {
    assert.match(content, new RegExp(label), `right toolbar should show ${label}`);
  }
  assert.doesNotMatch(content, /localhost:3002/, 'right toolbar ERP entry should not default to the old temporary 3002 test port');
  assert.doesNotMatch(content, /background:rgba\(124,45,18/, 'product dialogs should not tint the whole Ozon page yellow/brown when a modal opens');
  assert.match(content, /http:\/\/localhost:3000/, 'right toolbar ERP entry should default to the local web app on port 3000');
  assert.match(content, /function\s+inferErpWebBaseUrl/, 'right toolbar should infer the ERP web URL from the configured API URL');
  assert.match(content, /function\s+syncOzonCookieFromQuickAction/, 'right toolbar should sync Ozon cookies directly instead of opening a blocked extension settings page');
  assert.match(content, /ozon-calc:sync-current-ozon-cookie/, 'product quick Cookie button should reuse the popup Cookie sync backend path');
  assert.doesNotMatch(content, /quick-bind-cookie[\s\S]{0,500}openExtensionSettingsPage\("cookie"\)/, 'product quick Cookie button should not navigate to settings.html#cookie from the Ozon page');
  assert.doesNotMatch(
    content,
    /quick-profit[\s\S]{0,240}showOzonSkuWorkbench\(productId,\s*"profit"\)/,
    'product quick Profit button should open the dedicated calculator panel instead of the SKU listing workbench',
  );
  assert.match(
    content,
    /quick-profit[\s\S]{0,500}openOzonProfitCalculatorFromQuickAction\(\)/,
    'product quick Profit button should delegate to the dedicated Ozon calculator drawer',
  );
  assert.match(
    content,
    /function\s+openOzonProfitCalculatorFromQuickAction[\s\S]*OZON_CALC_OZON_PANEL[\s\S]*renderDrawerContent/,
    'product quick Profit button should expand the rich calculator drawer when it is available',
  );
  const competitorBrandPattern = new RegExp([
    '\\u6bdb\\u5b50ERP',
    '\\u4f01\\u9e45\\u52a9\\u624b',
    '\\u4f01\\u9e45\\u5e97\\u957f',
  ].join('|'));
  assert.doesNotMatch(content, competitorBrandPattern);
});

test('Ozon product workbench fetches table rows and seller offer metrics through background', () => {
  assert.match(content, /spb-self-hosted:fetch-ozon-workbench-rows/);
  assert.match(content, /renderOzonWorkbenchRows\(/);
  assert.match(content, /跟卖数量/);
  assert.match(content, /跟卖最低价/);
  assert.match(content, /跟卖最高价/);
  assert.match(content, /利润率/);
  assert.match(content, /SS_ERP_PRODUCT_THEME/, 'product workbench should share SS ERP product-page theme tokens');
  assert.match(content, /function\s+productWorkbenchFooterStyle/, 'product workbench should centralize its footer surface style');
  assert.match(
    content,
    /data-role="workbench-toolbar"[\s\S]*background:\$\{SS_ERP_PRODUCT_THEME\.surface\}/,
    'product workbench toolbar should use a neutral surface instead of a large orange band',
  );
  assert.match(content, /data-role="workbench-table-wrap"/, 'product workbench should isolate table scrolling for sticky headers');
  assert.match(content, /position:sticky;\s*top:0;\s*z-index:3/, 'product workbench header cells should stay above rows without piercing the toolbar');
  assert.doesNotMatch(content, /data-mode="pricing"/, 'product detail workbench should use the same data/profit/publish modes as the list workbench');
  assert.match(content, /function\s+getProductWorkbenchModeTitle/, 'product workbench should show a mode-specific title so profit does not look like listing');
  assert.doesNotMatch(
    content,
    /<th[^>]+border:1px solid #4b5563/,
    'product workbench header cells should use light grid lines instead of dark borders that look like table bleed-through',
  );
  assert.match(
    content,
    /function\s+resolveOzonWorkbenchProductRows/,
    'product workbench should expand current detail page variants before fetching rows',
  );
  assert.match(
    content,
    /rows:\s*variantSeedRows/,
    'product workbench should pass parsed variant seed rows to the background row builder',
  );
  assert.doesNotMatch(
    content,
    /productIds:\s*\[productId\]/,
    'product workbench should not be limited to only the current product id on multi-variant pages',
  );
});

test('Ozon product publish mode keeps the SKU/KPI table for pre-publish validation', () => {
  assert.match(
    content,
    /data-role="workbench-table-wrap"/,
    'product publish workbench should use the existing SKU/KPI table surface',
  );
  assert.match(
    content,
    /跟卖数量|跟卖最低价|跟卖最高价|利润率|30天销量|广告费占比/,
    'product publish workbench should keep SKU/KPI columns visible before submission',
  );
  assert.doesNotMatch(
    content,
    /data-role="publish-confirm-wrap"|function\s+renderOzonProductPublishConfirm/,
    'product publish mode should not replace the SKU/KPI table with a lightweight confirmation surface',
  );
  assert.doesNotMatch(
    content,
    /if\s*\(\s*modal\.__ssErpProductWorkbenchMode\s*===\s*"publish"\s*\)\s*\{\s*renderOzonProductPublishConfirm[\s\S]*?return;/,
    'product publish mode should not bypass seller/KPI enrichment before rendering rows',
  );
});

test('Ozon product workbench matches list publish controls for pricing and watermark params', () => {
  for (const role of [
    'publish-target-controls',
    'pricing-controls',
    'cost-cny',
    'logistics-fee-cny',
    'commission-rate',
    'watermark-template',
  ]) {
    assert.match(content, new RegExp(`data-role="${role}"`), `product SKU workbench should expose ${role}`);
  }
  assert.match(
    content,
    /data-mode-scope="publish"/,
    'product SKU workbench should mark publish-only controls so data/profit modes do not look like the same seller publish panel',
  );
  assert.match(
    content,
    /data-mode-scope="pricing"/,
    'product SKU workbench should mark pricing controls so data mode can stay focused on metrics',
  );
  assert.match(
    content,
    /function\s+readOzonWorkbenchNumber/,
    'product SKU workbench should use a shared numeric reader for pricing inputs',
  );
  assert.match(
    content,
    /loadOzonWorkbenchRows[\s\S]*const costCny = readOzonWorkbenchNumber\(modal,\s*"cost-cny"\)[\s\S]*const logisticsFeeCny = readOzonWorkbenchNumber\(modal,\s*"logistics-fee-cny"\)[\s\S]*const commissionRate = readOzonWorkbenchNumber\(modal,\s*"commission-rate"\)/,
    'product SKU workbench data refresh should read cost, logistics fee, and commission rate',
  );
  assert.match(
    content,
    /loadOzonWorkbenchRows[\s\S]*costs:\s*costCny > 0 \? Object\.fromEntries\(productIds\.map\(\(sku\) => \[String\(sku\), costCny\]\)\) : undefined[\s\S]*logisticsFeeCny:\s*logisticsFeeCny > 0 \? logisticsFeeCny : undefined[\s\S]*commissionRate:\s*commissionRate > 0 \? commissionRate : undefined/,
    'product SKU workbench data refresh should send pricing params to background enrichment',
  );
  assert.match(
    content,
    /publishSelectedOzonWorkbenchRows[\s\S]*const costCny = readOzonWorkbenchNumber\(modal,\s*"cost-cny"\)[\s\S]*const logisticsFeeCny = readOzonWorkbenchNumber\(modal,\s*"logistics-fee-cny"\)[\s\S]*const commissionRate = readOzonWorkbenchNumber\(modal,\s*"commission-rate"\)/,
    'product SKU workbench publish should read cost, logistics fee, and commission rate',
  );
  assert.match(
    content,
    /publishSelectedOzonWorkbenchRows[\s\S]*costs:\s*costCny > 0 \? Object\.fromEntries\(selected\.map\(\(sku\) => \[String\(sku\), costCny\]\)\) : undefined[\s\S]*logisticsFeeCny:\s*logisticsFeeCny > 0 \? logisticsFeeCny : undefined[\s\S]*commissionRate:\s*commissionRate > 0 \? commissionRate : undefined/,
    'product SKU workbench publish should pass pricing params through the normal collect-then-publish path',
  );
});

test('Ozon workbench enrichment avoids duplicate slow seller fetches', () => {
  assert.match(background, /OZON_WORKBENCH_INSIGHT_TTL_MS/, 'background should cache workbench insight aggregation results briefly');
  assert.match(background, /ozonWorkbenchInsightCache/, 'background should keep an in-memory workbench insight cache');
  assert.match(background, /ozonWorkbenchInsightInFlight/, 'background should de-duplicate concurrent workbench insight requests for the same SKU');
  assert.match(background, /function\s+hasRichWorkbenchSeedRow/, 'background should detect rows that already have enough card or premium data');
  assert.match(background, /hasRichWorkbenchSeedRow\(seed,\s*\{\s*includeOffers\s*\}\)/, 'fetchOzonWorkbenchRows should reuse rich seed rows with the current enrichment mode instead of re-fetching every SKU');
});

test('Ozon product data panel and workbench expose operating metrics from connected data sources', () => {
  for (const label of [
    '广告费占比',
    '参与促销天数',
    '参与促销的折扣',
    '促销活动的转化率',
    '付费推广天数',
    '商品卡浏览量',
    '商品卡加购率',
    '搜索目录浏览量',
    '搜索目录加购率',
    '浏览下单率',
    '搜索转换率',
    '展示转化率',
    '商品点击率',
    '结单率',
    '模板活动天数',
    '促销收入占比',
    '佣金',
    '价格指数',
    '跟卖列表',
    '跟卖最高价',
  ]) {
    assert.match(content, new RegExp(label), `Ozon product UI should show ${label}`);
  }
  assert.match(content, /spb-self-hosted:get-ozon-seller-offers/);
});

test('Ozon product data panel opens a seller-list modal from follow seller data', () => {
  assert.match(content, /function\s+showOzonSellerListModal/);
  assert.match(content, /data-role=["']open-seller-list["']/);
  assert.match(content, /sellerOffers/);
  assert.match(content, /sellerNames/);
  assert.match(content, /showOzonSellerListModal\(data\)/);
});

test('product-detail one-click listing keeps the normal collect-then-publish workflow', () => {
  assert.match(background, /publishOzonWorkbenchRows\(/);
  assert.match(background, /spb-self-hosted:publish-ozon-workbench-rows/);
  const publishFunction = background.match(/async function publishOzonWorkbenchRows[\s\S]*?\n}\n\nasync function getWatermarkTemplates/);
  assert.ok(publishFunction, 'publishOzonWorkbenchRows function should be present');
  assert.match(publishFunction[0], /ozon-product-detail/);
  assert.match(publishFunction[0], /collectOzonProductsToErp\(productIds/);
  assert.match(publishFunction[0], /fetchCollectedOzonItemsBySkus/);
  assert.match(background, /\/api\/collect\?/);
  assert.match(publishFunction[0], /\/api\/collect\/publish-ozon/);
  assert.match(publishFunction[0], /useItemCategory:\s*true/);
  assert.match(publishFunction[0], /watermarkFailedCount[\s\S]*已中断上架/, 'selected watermark failures should stop publish before creating an Ozon listing');
  assert.doesNotMatch(content, /选中后会先采集到 ERP，再走正常 Ozon 上架流程。/);
  assert.match(content, /正在采集并上架/);
  assert.match(content, /entry:\s*"ozon-product-detail"/);
  assert.match(content, /markupPct/);
  assert.match(content, /data-role="watermark-template"/, 'product SKU workbench should expose ERP watermark templates in the publish toolbar');
  assert.match(content, /function\s+loadOzonWorkbenchWatermarkTemplates/, 'product SKU workbench should load ERP watermark templates');
  assert.match(content, /shop-select['"\]\)][\s\S]*change[\s\S]*loadOzonWorkbenchWatermarkTemplates/, 'product SKU workbench should reload watermark templates when the selected shop changes');
  assert.match(content, /loadOzonWorkbenchShops[\s\S]*if\s*\(\s*!response\s*\|\|\s*!response\.ok\s*\)\s*throw new Error/, 'product SKU workbench should surface ERP shop loading errors instead of rendering an empty shop dropdown');
  assert.match(content, /没有可用 OZON 店铺/, 'product SKU workbench should explain when the current ERP account has no Ozon shops');
  assert.match(content, /loadOzonWorkbenchWatermarkTemplates[\s\S]*if\s*\(\s*!response\s*\|\|\s*!response\.ok\s*\)\s*throw new Error/, 'product SKU workbench should surface watermark loading errors instead of rendering an empty watermark dropdown');
  assert.match(content, /没有可用水印/, 'product SKU workbench should explain when the current ERP account has no watermark templates');
  assert.match(content, /function\s+buildOzonWorkbenchWatermarkConfig[\s\S]*type[\s\S]*text[\s\S]*imageUrl[\s\S]*position[\s\S]*opacity[\s\S]*fontSize[\s\S]*fontColor[\s\S]*scale/, 'product SKU workbench watermark config should match the server watermark input fields');
  assert.match(content, /publishSelectedOzonWorkbenchRows[\s\S]*const watermark = buildOzonWorkbenchWatermarkConfig\(modal\)/, 'product SKU workbench publish should read the selected watermark template');
  assert.match(content, /publishSelectedOzonWorkbenchRows[\s\S]*watermark:\s*watermark/, 'product SKU workbench publish should pass watermark config through the normal collect-then-publish path');
  assert.doesNotMatch(panel, /function\s+buildPublishCardBody|上架到 OZON/, 'detail calculator/profit drawer should not render a separate publish card');
  assert.doesNotMatch(panel, /data-publish-shop|data-publish-mode|data-publish-brand|data-publish-watermark|data-action="publish-product"/, 'publish controls belong in the SKU workbench, not the calculator drawer');
  assert.doesNotMatch(panel, /sendRuntimeMessage\(\{\s*type:\s*'spb-self-hosted:publish-ozon-workbench-rows'[\s\S]*entry:\s*'ozon-product-detail'/, 'calculator drawer should not submit one-click listing jobs');
  assert.doesNotMatch(panel, /function\s+buildWatermarkConfig/, 'calculator drawer should not duplicate workbench watermark logic');
  assert.equal((background.match(/case "spb-self-hosted:get-watermark-templates"/g) || []).length, 1, 'watermark template message case should be registered once');
});

test('list-page one-click listing uses collect-then-publish by default, not SKU-only direct import', () => {
  const overlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');
  assert.doesNotMatch(
    background,
    /publishOzonWorkbenchRowsDirect\(/,
    'extension background should not keep a browser-panel fast-follow import-by-sku path',
  );
  assert.doesNotMatch(
    background,
    /\/api\/listing\/ozon\/import-by-sku/,
    'browser extension publishing should not call the SKU-only import-by-sku route directly',
  );

  const publishFunction = background.match(/async function publishOzonWorkbenchRows[\s\S]*?\n}\n\nasync function getWatermarkTemplates/);
  assert.ok(publishFunction, 'publishOzonWorkbenchRows function should be present');
  assert.doesNotMatch(
    publishFunction[0],
    /directPublish/,
    'extension workbench publishing should not expose a directPublish escape hatch',
  );
  assert.doesNotMatch(
    publishFunction[0],
    /String\(options\.entry\s*\|\|\s*""\)\s*===\s*"ozon-list-page"/,
    'ozon-list-page entries should no longer be silently downgraded to SKU-only import',
  );

  const listPublishFunction = overlay.match(/async function publishListWorkbenchSelectedRows[\s\S]*?\n  }\n\n  \/\/ === 注入卡片/);
  assert.ok(listPublishFunction, 'list-page publish handler should be present');
  assert.match(listPublishFunction[0], /entry:\s*'ozon-list-page-full'/, 'list-page default publish should use the full collect-then-publish entry');
  assert.doesNotMatch(listPublishFunction[0], /entry:\s*'ozon-list-page'/, 'list-page default publish should not trigger direct import routing');
  assert.doesNotMatch(overlay, /SKU 快速跟卖|快速跟卖/, 'browser extension workbench should not expose a SKU fast-follow action');
  assert.doesNotMatch(overlay, /一键上架选中 SKU/, 'full listing action should be worded as product listing, not SKU fast-follow');
});

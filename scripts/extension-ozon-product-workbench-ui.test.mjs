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

test('Ozon product publish mode renders a lightweight confirmation instead of the dense KPI table', () => {
  const publishConfirmFunction = content.match(/function\s+renderOzonProductPublishConfirm[\s\S]*?\n  }\n\n  async function publishSelectedOzonWorkbenchRows/);
  assert.ok(publishConfirmFunction, 'product publish confirmation renderer should be present');
  assert.match(
    content,
    /data-role="publish-confirm-wrap"/,
    'product workbench should have a dedicated publish confirmation surface',
  );
  assert.match(
    content,
    /function\s+renderOzonProductPublishConfirm/,
    'product publish mode should render through a dedicated confirmation renderer',
  );
  assert.match(
    content,
    /modal\.__ssErpProductWorkbenchMode\s*===\s*"publish"[\s\S]*renderOzonProductPublishConfirm/,
    'product publish mode should bypass the dense KPI table renderer',
  );
  assert.doesNotMatch(
    publishConfirmFunction[0],
    /月销量|广告费占比|跟卖最低价|跟卖最高价/,
    'product publish confirmation should not render KPI/analytics columns',
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
  assert.match(panel, /function\s+buildPublishCardBody/, 'detail data panel should render a rich publish card');
  assert.match(panel, /data-publish-shop[\s\S]*data-publish-mode[\s\S]*data-publish-brand[\s\S]*data-publish-watermark/, 'detail publish card should expose shop, mode, brand, and watermark controls');
  assert.match(panel, /entry:\s*'ozon-product-detail'/, 'detail publish card should use the collect-then-publish entry');
  assert.match(panel, /followBrand\s*=\s*String\(publishBrandSelect[\s\S]*!==\s*'strip'/, 'detail publish brand selector should map "no brand" to followBrand false');
  assert.match(panel, /function\s+buildWatermarkConfig[\s\S]*type[\s\S]*text[\s\S]*imageUrl[\s\S]*position[\s\S]*opacity[\s\S]*fontSize[\s\S]*fontColor[\s\S]*scale/, 'detail watermark config should match the server watermark input fields');
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

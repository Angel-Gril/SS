import assert from 'node:assert/strict';
import fs from 'node:fs';

const overlay = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');
const background = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

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
  'quick-pricing',
  'quick-open-insights',
  'quick-bind-cookie',
  'quick-selection-settings',
  'quick-open-erp',
]) {
  assert.match(overlay, new RegExp(`data-role="${role}"`), `Ozon list quick toolbar should expose ${role}`);
}
assert.match(
  overlay,
  /function\s+openExtensionSettingsPage/,
  'Ozon list quick toolbar should open the extension settings for cookie and selection setup',
);
assert.match(
  overlay,
  /quick-open-workbench[\s\S]*quickActionButtonStyle\('#ea580c',\s*'#ffffff'/,
  'Ozon list quick toolbar should use ERP orange only for the primary one-click listing action',
);
assert.doesNotMatch(
  overlay,
  /data-role="quick-filter-matched"/,
  'Ozon list quick toolbar should not have a separate rule-match button that opens the same seller workbench',
);
assert.match(
  overlay,
  /data-role="quick-match-summary"/,
  'Ozon list quick toolbar should show rule-match count as status instead of a duplicate action button',
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
  /position:sticky;\s*top:0;\s*z-index:3/,
  'Ozon list workbench should stick individual header cells above table rows instead of letting the header pierce through content',
);
assert.doesNotMatch(
  overlay,
  /<th[^>]+border:1px solid #4b5563/,
  'Ozon list workbench header cells should use light grid lines instead of dark borders that look like table bleed-through',
);
assert.match(
  overlay,
  /data-role="export-workbench-skus"/,
  'Ozon list workbench should support Penguin-style one-click export of selected SKUs',
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
  /application\/vnd\.ms-excel/,
  'Ozon list workbench export should use an Excel MIME type',
);
assert.match(
  overlay,
  /\.xls/,
  'Ozon list workbench export should create an .xls file that Excel can open',
);
assert.match(
  overlay,
  /data-role="follow-brand"/,
  'Ozon list workbench should expose the follow-brand option before publishing',
);
assert.match(
  overlay,
  /data-role="row-filter"/,
  'Ozon list workbench should switch between all rows and selection-rule matched rows',
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
for (const mode of ['data', 'profit', 'publish']) {
  assert.match(
    overlay,
    new RegExp(`data-role="workbench-view"[^>]+data-mode="${mode}"`),
    `Ozon list workbench should expose ${mode} mode`,
  );
}
assert.match(
  overlay,
  /quick-profit[\s\S]*openListSkuWorkbench\(\{\s*rowFilter:\s*'all',\s*focus:\s*'profit'\s*\}\)/,
  'Ozon list profit action should open the list workbench in profit mode',
);
assert.match(
  overlay,
  /quick-pricing[\s\S]*openListSkuWorkbench\(\{\s*rowFilter:\s*'all',\s*focus:\s*'publish'\s*\}\)/,
  'Ozon list pricing action should open the list workbench in publish/pricing mode',
);
assert.match(
  overlay,
  /quick-open-insights[\s\S]*openListSkuWorkbench\(\{\s*rowFilter:\s*'all',\s*focus:\s*'data'\s*\}\)/,
  'Ozon list data action should open the list workbench in data mode',
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
  'save-workbench-data',
  'delete-selected-workbench-skus',
]) {
  assert.match(overlay, new RegExp(`data-role="${role}"`), `Ozon list workbench should expose ${role}`);
}
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
  /includeOffers:\s*modal\.__ssErpWorkbenchFocus\s*===\s*'publish'/,
  'Ozon list workbench should fetch slow seller-offer details only in publish mode',
);
for (const actionLabel of ['保存', '删除选中 SKU', '导出选中 SKU', '一键上架选中 SKU']) {
  assert.match(overlay, new RegExp(actionLabel), `Ozon list workbench footer should expose ${actionLabel}`);
}
assert.match(
  overlay,
  /仅规则命中/,
  'Ozon list workbench should provide a Maozi-style selection-rule matched filter',
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
for (const tableHeader of ['规则名称', '标签', '自动收藏', '是否启用', '优先级', '更新时间', '操作']) {
  assert.match(overlay, new RegExp(tableHeader), `Ozon selection rule list should expose ${tableHeader}`);
}
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
for (const label of ['成本¥', '物流费¥', '佣金%']) {
  assert.match(overlay, new RegExp(label), `Ozon list workbench should expose ${label}`);
}
assert.match(
  overlay,
  /exportListWorkbenchSelectedSkus\(modal\)/,
  'Ozon list workbench export button should use the selected workbench rows',
);
assert.match(
  overlay,
  /publishListWorkbenchSelectedRows[\s\S]*const costCny = readListWorkbenchNumber\(modal,\s*['"]cost-cny['"]\)/,
  'Ozon list workbench publish should read the current cost input at submit time',
);
assert.match(
  overlay,
  /publishListWorkbenchSelectedRows[\s\S]*costs:\s*costCny > 0 \? Object\.fromEntries\(selected\.map\(\(sku\) => \[String\(sku\), costCny\]\)\) : undefined/,
  'Ozon list workbench publish should pass selected SKU cost map to direct import metadata',
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

import assert from 'node:assert/strict';
import fs from 'node:fs';

const sidebar = fs.readFileSync('apps/web/src/components/layout/sidebar.tsx', 'utf8');
const pagePath = 'apps/web/src/app/(dashboard)/collect/source/page.tsx';
const page = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';

assert.match(
  sidebar,
  /label:\s*['"]1688商品采集['"][\s\S]*href:\s*['"]\/collect\/source['"]/,
  'sidebar should expose a dedicated 1688 source collection menu entry',
);
assert.match(
  page,
  /api\.get<[\s\S]*\/api\/collect\?/,
  'source collection page should read collected source goods from the collect API',
);
assert.match(
  page,
  /sourceGroup:\s*['"]source['"]|sourceGroup['"]?\s*,\s*['"]source['"]|sourceGroup=source/,
  'source collection page should request only domestic source collect records',
);
for (const label of ['1688', 'PDD', '淘宝', '天猫', '闲鱼']) {
  assert.match(page, new RegExp(label), `source collection page should support ${label} filtering`);
}
assert.match(
  page,
  /sourcePlatform/i,
  'source collection page should separate source-platform goods from Ozon SKU collection',
);
assert.match(
  page,
  /sourceMissingFields/,
  'source collection detail should compute Ozon listing missing fields',
);
assert.match(
  page,
  /sourcePreviewImages/,
  'source collection detail should filter previewable product images before rendering thumbnails',
);
for (const pattern of ['-tps-', 'gg_dtc', 'rate', '160-160']) {
  assert.match(page, new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `source collection detail should reject Alibaba platform image noise: ${pattern}`);
}
assert.match(
  page,
  /onError=\{\(event\)/,
  'source collection thumbnails should hide broken image previews',
);
assert.match(
  page,
  /sourceReadinessBadges/,
  'source collection page should compute workflow readiness badges',
);
assert.match(
  page,
  /evaluateSourceListingReadiness/,
  'source collection page should reuse shared Ozon listing readiness evaluation',
);
for (const label of ['可上架', '待复核', '阻断', 'Ozon 必填属性/字典值', '销售受限/出口限制']) {
  assert.match(page, new RegExp(label), `source listing readiness should expose status/risk label: ${label}`);
}
assert.match(
  page,
  /SourceProductRow/,
  'source collection page should render each item as a preview-focused product row',
);
for (const field of ['translationStatus', 'untranslatedTerms']) {
  assert.match(page, new RegExp(field), `Ozon category candidates should expose ${field} from the catalog audit`);
}
for (const label of ['部分翻译', '翻译缺失']) {
  assert.match(page, new RegExp(label), `Ozon category candidate cards should show translation audit badge: ${label}`);
}
for (const label of ['待翻译', '图片待处理', '待水印', '待改图', '可上架']) {
  assert.match(page, new RegExp(label), `source collection row should expose workflow badge: ${label}`);
}

for (const helper of ['sourceRussianText', 'sourceTranslatedTitleText', 'sourceTranslatedDescriptionText']) {
  assert.match(page, new RegExp(helper), `source collection translation should validate Cyrillic text with helper: ${helper}`);
}
for (const label of ['俄语本地化', '生成Ozon文案草稿', 'AI 搜索标签', 'AI 卖点', 'AI 风险提示', 'AI 置信度']) {
  assert.match(page, new RegExp(label), `source collection AI localization panel should expose label: ${label}`);
}
for (const label of ['详情图原始素材', '包装信息', '原始富内容待处理', '富内容待处理']) {
  assert.match(page, new RegExp(label), `source collection page should expose 1688 source asset workflow label: ${label}`);
}
for (const label of ['视频转存', '已转存', '防盗链/不可直连', 'Ozon视频可自动绑定', '源站下载超时']) {
  assert.match(page, new RegExp(label), `source collection page should expose source video diagnostic label: ${label}`);
}
for (const helper of ['sourceVideoTransferSummary', 'sourceVideoRows', 'sourceVideoStatusLabel', 'sourceVideoEffectiveStatus']) {
  assert.match(page, new RegExp(helper), `source collection page should expose source video diagnostic helper: ${helper}`);
}
assert.match(
  page,
  /sourceVideoTransferEntries\(item\)[\s\S]*<SourceVideoList/,
  'source video list should merge stored transfer diagnostics so legacy transfer_failed timeout rows render clearly',
);
for (const helper of ['sourceDetailPreviewImages', 'sourcePackagingRows', 'sourceRichContentDraft']) {
  assert.match(page, new RegExp(helper), `source collection page should read 1688 source asset helper: ${helper}`);
}
for (const helper of ['sourceProductProfile', 'sourcePackagingProfile', 'sourcePackagingReasonText']) {
  assert.match(page, new RegExp(helper), `source collection page should expose source profile packaging helper: ${helper}`);
}
assert.match(
  page,
  /sourcePackagingBadge/,
  'source collection row should render a dedicated packaging status badge',
);
for (const label of ['包装完整', '缺包装尺寸', '无包装表', '包装解析失败']) {
  assert.match(page, new RegExp(label), `source collection row should expose packaging status label: ${label}`);
}
for (const label of ['页面没有包装表', '只采到重量，缺包装尺寸', '有包装表但未解析出件重尺']) {
  assert.match(page, new RegExp(label), `source collection detail should explain packaging evidence: ${label}`);
}
for (const field of ['sourceProductProfile', 'reasonCode', 'reasonLabel', 'extractionDiagnostics']) {
  assert.match(page, new RegExp(field), `source collection detail should consume packaging diagnostic field: ${field}`);
}
const sourceSkuSection = page.match(/function SourceSkuSection\(\{ item \}: \{ item: SourceCollectItem \}\) \{[\s\S]*?\nfunction SourceAttributesSection/)?.[0] || '';
assert.match(
  sourceSkuSection,
  /sourceStandardAttributeModel\(item\)/,
  'source packaging detail should read normalized package fields when packaging rows are absent',
);
assert.match(
  sourceSkuSection,
  /sourcePackagingProfile\(item\)/,
  'source packaging detail should show source profile packaging status and reason',
);
assert.match(
  sourceSkuSection,
  /sourceStandardPackageText\(standard\)/,
  'source packaging detail should show normalized package weight or dimensions as fallback evidence',
);
for (const helper of ['sourcePriceModelText', 'sourceRejectedAssetCount', 'rejectedAssets', 'priceConfidence', 'ladderPrices']) {
  assert.match(page, new RegExp(helper), `source collection page should expose source collection quality helper: ${helper}`);
}
for (const readablePriceSource of ['visibleRangeHigh', '可见高价', '低']) {
  assert.match(page, new RegExp(readablePriceSource), `source collection page should render readable price source text: ${readablePriceSource}`);
}
assert.match(
  page,
  /break-words|break-all|overflow-wrap|word-break/,
  'source collection metric blocks should wrap long values inside their card boundary',
);
for (const label of ['价格来源', '过滤图片', '字段级采集质量', '强命中', '弱猜测', '缺失']) {
  assert.match(page, new RegExp(label), `source collection diagnostics should expose label: ${label}`);
}
for (const label of ['概览', 'SKU', '属性', '图片', '翻译', '上架检查']) {
  assert.match(page, new RegExp(label), `source detail dialog should expose section: ${label}`);
}
for (const icon of ['Languages', 'Droplets', 'Wand2', 'Calculator']) {
  assert.match(page, new RegExp(icon), `source collection row should expose ${icon} action entry`);
}
for (const label of ['真实商品标题', '俄文标题/描述', 'Ozon 类目/type', '颜色尺码变体', '重量', '包装尺寸']) {
  assert.match(page, new RegExp(label), `source detail should expose missing field label: ${label}`);
}
for (const label of ['手动补录件重尺', '重量(g)', '长(mm)', '宽(mm)', '高(mm)', '保存件重尺']) {
  assert.match(page, new RegExp(label.replace(/[()]/g, '\\$&')), `source listing detail should expose manual package edit control: ${label}`);
}
assert.match(
  page,
  /api\.post<[\s\S]*\/api\/collect\/save-customization|api\.post\(['"`]\/api\/collect\/save-customization/,
  'source listing detail should save manual package weight and dimensions via collect customization API',
);
assert.match(
  page,
  /Upload/,
  'source collection row should expose a publish action icon',
);
assert.doesNotMatch(
  page,
  /\/collect\?sourceGroup=source/,
  'source collection page should not hand source products back to the SKU follow publish page',
);
assert.doesNotMatch(
  page,
  /去Ozon上架台/,
  'source collection page should not label the old mixed publish handoff as the source publish entry',
);
for (const label of ['上架到OZON', '源商品上架', '确认发布到Ozon', '稳定货号']) {
  assert.match(page, new RegExp(label), `source collection page should expose in-page source publish control: ${label}`);
}
for (const label of ['候选待确认', '点击确认类目后解除 Ozon 类目/type 阻断']) {
  assert.match(page, new RegExp(label), `source Ozon category candidate panel should clarify confirmation state: ${label}`);
}
for (const token of [
  'handleSourcePublish',
  '/api/collect/publish-ozon',
  "source: 'source-publish-page'",
  'useItemCategory: true',
  'randomOfferId: false',
  'buildStableSourceOfferId',
  'buildStableSourceVariantOfferIds',
]) {
  assert.match(page, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `source publish flow should contain ${token}`);
}
assert.match(
  page,
  /categoryId:\s*selectedCandidate\.categoryId[\s\S]*typeId:\s*selectedCandidate\.typeId/,
  'source publish should submit the selected source Ozon category candidate instead of a title-search category',
);

const skuCollectPage = fs.readFileSync('apps/web/src/app/(dashboard)/collect/page.tsx', 'utf8');
assert.match(
  skuCollectPage,
  /defaultCollectSourceGroup\s*=\s*['"]ozon['"]/,
  'SKU follow collection page should default to Ozon collect records',
);
assert.match(
  skuCollectPage,
  /sourceGroup:\s*defaultCollectSourceGroup/,
  'SKU publish page should only request Ozon collect records',
);
assert.doesNotMatch(
  skuCollectPage,
  /sourceGroupParam|collectSourceGroup|sourceGroupFromQuery|sourceGroup\s*===\s*['"]source['"]|货源商品上架台|1688\/PDD 货源商品/,
  'SKU publish page should no longer support the old sourceGroup=source mixed publish mode',
);

console.log('PASS web source collect routing');

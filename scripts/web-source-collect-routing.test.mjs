import assert from 'node:assert/strict';
import fs from 'node:fs';

const sidebar = fs.readFileSync('apps/web/src/components/layout/sidebar.tsx', 'utf8');
const pagePath = 'apps/web/src/app/(dashboard)/collect/source/page.tsx';
const page = fs.existsSync(pagePath) ? fs.readFileSync(pagePath, 'utf8') : '';
const attributeEditorPath = 'apps/web/src/components/source-listing/ozon-attribute-editor.tsx';
const attributeEditor = fs.existsSync(attributeEditorPath) ? fs.readFileSync(attributeEditorPath, 'utf8') : '';

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
for (const field of ['catalogRevision', 'sourceSnapshotId', 'sourceProfileHash', 'historyMode', 'transitionVersion']) {
  assert.match(page, new RegExp(field), `Ozon category candidates should expose authoritative V2 contract field: ${field}`);
}
const sourceCategoryConfirmation = page.match(/async function confirmSelectedCandidate\(\)[\s\S]*?\n  function setPackageField/)?.[0] || '';
for (const field of ['shopId', 'categoryId', 'typeId', 'expectedCatalogRevision', 'expectedTransitionVersion']) {
  assert.match(sourceCategoryConfirmation, new RegExp(`\\b${field}\\s*(?:,|:)`), `source category confirmation should submit authoritative field: ${field}`);
}
for (const forgedField of ['signature:', 'categoryName:', 'typeName:']) {
  assert.doesNotMatch(
    sourceCategoryConfirmation,
    new RegExp(forgedField),
    `source category confirmation should not submit client-owned ${forgedField.slice(0, -1)}`,
  );
}
assert.match(
  sourceCategoryConfirmation,
  /metadataPatch/,
  'source category confirmation should project the server-owned metadata patch instead of rebuilding metadata locally',
);
assert.match(
  page,
  /SOURCE_OZON_CATEGORY_MAPPING_VERSION_CONFLICT|ozon_category_catalog_stale/,
  'source category confirmation should recognize mapping CAS and catalog revision conflicts',
);
assert.match(
  sourceCategoryConfirmation,
  /sourceOzonCategoryConflictRequiresRefresh/,
  'source category confirmation should route authoritative conflicts through the refresh classifier',
);
assert.match(
  sourceCategoryConfirmation,
  /refreshCategoryCandidates/,
  'source category confirmation should refresh candidates after an authoritative conflict',
);
assert.match(
  sourceCategoryConfirmation,
  /finally\s*\{/,
  'source category confirmation should always release its busy state in finally',
);
for (const guard of ['candidateRequestIdRef', 'confirmationRequestIdRef', 'categoryContextKeyRef']) {
  assert.match(page, new RegExp(guard), `source category requests should use stale-response guard: ${guard}`);
}
for (const token of [
  '/api/source-listing-workflows',
  'listingWorkflowRequestIdRef',
  'selectedSkuKeys: target.selectedSkuKeys',
  'expectedRevision: candidate.revision',
  'syncConfirmedCategoryToWorkflow',
]) {
  assert.match(
    page,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `source listing workbench should resume and CAS-update the durable server draft via ${token}`,
  );
}
const workflowCreate = page.match(/api\.post<OzonListingDraft>\(['"]\/api\/source-listing-workflows['"][\s\S]*?\n\s*\}\);/)?.[0] || '';
assert.match(workflowCreate, /supplyGoodsId:\s*target\.itemId[\s\S]*shopId:\s*target\.shopId[\s\S]*selectedSkuKeys:\s*target\.selectedSkuKeys/, 'workflow creation should submit only frozen server-resolvable identity hints');
assert.doesNotMatch(workflowCreate, /sourceCaptureHash|ownerUserId/, 'workflow creation must not submit client-owned capture hash or owner identity');
assert.match(page, /草稿 v\{listingWorkflow\.draftVersion\} \/ r\{listingWorkflow\.revision\}/, 'source listing workbench should expose the resumed draft version and CAS revision');
for (const token of [
  'listingWorkflowStageLabel(listingWorkflow.stage)',
  'listingWorkflowRunStateLabel(listingWorkflow.runState)',
  'listingWorkflowValidationLabel(listingWorkflow.validation.status)',
  'listingWorkflow.blockers.length',
  'listingWorkflow.warnings.length',
  'listingWorkflow.copy.candidates.length',
]) {
  assert.match(
    page,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `source listing workbench should show compact server workflow state via ${token}`,
  );
}
const workflowIdentitySync = page.match(/const syncIdentity = async[\s\S]*?\n    const queued = listingWorkflowIdentityQueueRef\.current/i)?.[0] || '';
for (const token of ['api.patch<OzonListingDraft>', '{ shopId: target.shopId }', '{ selectedSkuKeys: target.selectedSkuKeys }', 'expectedRevision: candidate.revision']) {
  assert.match(
    workflowIdentitySync,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `existing source listing workflow should append identity changes through PATCH via ${token}`,
  );
}
assert.match(
  workflowIdentitySync,
  /const resumedFromServer = !current[\s\S]*?if \(!resumedFromServer && requestedSkuSelectionChanged/,
  'the source listing workbench should adopt a create/resume canonical SKU response without alias-driven re-patching',
);
assert.doesNotMatch(
  workflowIdentitySync,
  /current\.shopId === target\.shopId\s*&&\s*sameRequestedSkuKeys\(current\)/,
  'the source listing workbench should not discard an authoritative canonical selection because the UI supplied an alias',
);
for (const token of [
  'listingWorkflowIdentityQueueRef.current',
  '.then(syncIdentity)',
  'listingWorkflowIdentityQueueRef.current = queued',
  'desiredListingWorkflowIdentityRef',
  'rememberServerDraft(res.data)',
  'rememberServerDraft(conflict)',
]) {
  assert.match(
    page,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `source listing workflow identity changes should serialize against the latest server draft via ${token}`,
  );
}
const selectedCandidateConfirmationGuard = page.match(/const persistedCategoryConfirmation[\s\S]*?const stableOfferId/)?.[0] || '';
for (const token of [
  'sourceOzonCategoryConfirmed',
  'persistedCategoryConfirmation.version',
  'source-ozon-category-confirmed/v2',
  'source-ozon-category-confirmed/legacy-v1',
  'persistedCategoryConfirmation.categoryId',
  'persistedCategoryConfirmation.typeId',
  'persistedCategoryConfirmation.catalogRevision',
  'persistedCategoryConfirmation.transitionVersion',
  'categoryData.catalogRevision',
  'selectedCandidate.transitionVersion',
]) {
  assert.match(
    selectedCandidateConfirmationGuard,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `publish eligibility should require the persisted category confirmation contract via ${token}`,
  );
}
const saveSourcePublishInputs = page.match(/async function saveSourcePublishInputs[\s\S]*?\n  function handleSourcePublishShopChange/)?.[0] || '';
assert.doesNotMatch(
  saveSourcePublishInputs,
  /\bcategoryId\s*:|\btypeId\s*:/,
  'generic publish-input persistence must not overwrite category/type outside the confirmation endpoint',
);
const legacySourcePublish = page.match(/async function handleSourcePublish\(\)[\s\S]*?\n  return \(/)?.[0] || '';
assert.doesNotMatch(
  legacySourcePublish,
  /publish-intent/,
  'legacy source publish must not create a future authoritative publish intent',
);
assert.doesNotMatch(legacySourcePublish, /\/manual-facts|\/pricing/, 'legacy publish must not mutate strict V2 readiness state');
assert.match(legacySourcePublish, /\/api\/collect\/publish-ozon/, 'legacy-compatible shops should retain the explicit legacy publisher');
for (const token of ['if (!selectedCandidateConfirmed)', 'const publishItem = item', 'const publishShopId = shopId', 'captureListingWorkflowContext', 'publishContextIsCurrent']) {
  assert.match(
    legacySourcePublish,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `legacy source publish should freeze and verify its authoritative context via ${token}`,
  );
}
const publishAfterFirstAwait = legacySourcePublish.slice(legacySourcePublish.indexOf('await '));
assert.doesNotMatch(
  publishAfterFirstAwait,
  /listingWorkflowRef\.current/,
  'publish must not fetch a mutable workflow draft after asynchronous work has started',
);
assert.match(
  page,
  /disabled=\{publishing[\s\S]{0,400}!legacyPublisherAllowed[\s\S]{0,300}!selectedCandidateConfirmed\}/,
  'legacy publish should remain disabled until capability, attempt history, and category confirmation are current',
);
for (const token of ['getPublisherCapability', 'listPublishAttempts', 'hasV2PublishAttempt', 'legacyPublisherAllowed']) {
  assert.match(legacySourcePublish + page, new RegExp(token), `legacy publish should fail closed through ${token}`);
}
assert.match(
  sourceCategoryConfirmation,
  /latestItemRef\.current[\s\S]*metadataPatch/,
  'source category confirmation should merge the server patch into the latest same-item metadata',
);
const sourceCategoryRefresh = page.match(/const refreshCategoryCandidates[\s\S]*?\n  useEffect\(\(\) => \{\n    void refreshCategoryCandidates/)?.[0] || '';
assert.match(
  sourceCategoryRefresh,
  /candidateRequestIdRef\.current !== requestId[\s\S]*categoryContextKeyRef\.current !== requestContextKey/,
  'source category candidate refresh should reject responses from an older item or shop context',
);
assert.match(
  sourceCategoryRefresh,
  /finally\s*\{/,
  'source category candidate refresh should always release its busy state in finally',
);
const categoryWorkflowSync = page.match(/async function syncConfirmedCategoryToWorkflow[\s\S]*?\n  async function confirmSelectedCandidate/)?.[0] || '';
assert.match(
  sourceCategoryConfirmation,
  /captureListingWorkflowContext/,
  'category confirmation should capture the item/shop/workflow context before awaiting the server',
);
assert.ok(
  (categoryWorkflowSync.match(/workflowContextIsCurrent/g) || []).length >= 2,
  'category-to-workflow synchronization should verify its captured context before the request and before applying the response',
);
assert.match(
  page,
  /disabled=\{shopsLoading \|\| candidateLoading \|\| confirming \|\| publishing \|\| listingWorkflowLoading\}/,
  'shop identity changes should be disabled during confirmation, publication, and workflow identity synchronization',
);
assert.match(
  page,
  /disabled=\{confirming \|\| publishing \|\| listingWorkflowLoading\}/,
  'category candidate changes should be disabled during confirmation, publication, and workflow identity synchronization',
);
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
for (const label of ['视频素材', '已采集源视频', '发布时上传Ozon视频', '防盗链/不可直连', 'Ozon视频可自动绑定', '源站下载超时']) {
  assert.match(page, new RegExp(label), `source collection page should expose source video diagnostic label: ${label}`);
}
for (const helper of ['sourceVideoTransferSummary', 'sourceVideoRows', 'sourceVideoStatusLabel', 'sourceVideoEffectiveStatus']) {
  assert.match(page, new RegExp(helper), `source collection page should expose source video diagnostic helper: ${helper}`);
}
assert.match(
  fs.readFileSync('apps/server/src/routes/collect.ts', 'utf8'),
  /\/:id\/videos\/retransfer/,
  'server should keep the manual video retransfer endpoint available for explicit maintenance flows',
);
const sourceImagesSection = page.match(/function SourceImagesSection\([\s\S]*?\nfunction SourceVideoList/)?.[0] || '';
assert.doesNotMatch(
  sourceImagesSection,
  /videos\/retransfer|重新转存视频|api\.get<OzonShopOption\[\]>\(['"`]\/api\/shops['"`]\)/,
  'source image material panel should not upload videos before the publish step selects an Ozon shop',
);
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
assert.match(
  page,
  /marker === 'complete'[\s\S]*包装完整/,
  'source collection row should show complete packaging only for complete packaging diagnostics',
);
assert.doesNotMatch(
  page,
  /rows\.length[\s\S]{0,220}包装完整/,
  'source collection row should not mark rows with weight-only packaging as complete',
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
const sourceSkuSection = page.match(/function SourceSkuSection\(\{ item[\s\S]*?\nfunction SourceAttributesSection/)?.[0] || '';
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
for (const icon of ['Languages', 'Droplets', 'Wand2', 'Calculator', 'Trash2']) {
  assert.match(page, new RegExp(icon), `source collection row should expose ${icon} action entry`);
}
assert.match(
  page,
  /api\.delete\(`\/api\/collect\/\$\{id\}`\)/,
  'source collection page should delete domestic source records through the collect delete API',
);
for (const label of ['真实商品标题', '俄文标题/描述', 'Ozon 类目/type', '颜色尺码变体', '重量', '包装尺寸']) {
  assert.match(page, new RegExp(label), `source detail should expose missing field label: ${label}`);
}
for (const label of ['手动补录件重尺', '重量(g)', '长(mm)', '宽(mm)', '高(mm)', '保存件重尺']) {
  assert.match(page, new RegExp(label.replace(/[()]/g, '\\$&')), `source listing detail should expose manual package edit control: ${label}`);
}
for (const label of ['通用件重尺', '按 SKU 补录', '应用到全部SKU', '保存SKU件重尺']) {
  assert.match(page, new RegExp(label.replace(/[()]/g, '\\$&')), `source listing detail should expose variant package edit control: ${label}`);
}
for (const token of ['handleDeleteSourceVariant', '/api/collect/${item.id}/variants/${encodeURIComponent(sku)}', '删除SKU']) {
  assert.match(page, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `source SKU detail should expose variant delete control: ${token}`);
}
assert.match(
  sourceSkuSection,
  /pendingDeleteVariant/,
  'source SKU delete confirmation should use in-system dialog state instead of a native browser confirm',
);
assert.doesNotMatch(
  sourceSkuSection,
  /window\.confirm/,
  'source SKU delete confirmation should not use the disconnected browser confirm dialog',
);
assert.match(
  page,
  /api\.post<[\s\S]*\/api\/collect\/save-customization|api\.post\(['"`]\/api\/collect\/save-customization/,
  'source listing detail should save manual package weight and dimensions via collect customization API',
);
for (const label of ['删除图片', '保存图片筛选']) {
  assert.match(page, new RegExp(label), `source image material panel should expose manual image filtering control: ${label}`);
}
assert.match(
  page,
  /images:\s*nextImages|sourceMainImages:\s*nextImages/,
  'source image material panel should persist filtered source images through collect customization API',
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
for (const label of ['上架到OZON', '源商品上架', '兼容旧版发布到 Ozon', '稳定货号']) {
  assert.match(page, new RegExp(label), `source collection page should expose in-page source publish control: ${label}`);
}
for (const token of ['SOURCE_PUBLISH_SHOP_STORAGE_KEY', 'localStorage.getItem(SOURCE_PUBLISH_SHOP_STORAGE_KEY)', 'localStorage.setItem(SOURCE_PUBLISH_SHOP_STORAGE_KEY']) {
  assert.match(page, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `source publish shop selector should remember the last manually used Ozon shop via ${token}`);
}
assert.match(
  page,
  /上次使用的店铺|店铺不可用/,
  'source publish shop selector should explain remembered shop fallback in Chinese',
);
for (const label of ['发布字段诊断', '自动填充', '需要确认', '阻断缺失', '人工补录']) {
  assert.match(page, new RegExp(label), `source publish confirmation should expose field diagnostic label: ${label}`);
}
for (const helper of ['evaluateSourceListingFieldDiagnostics', 'SourcePublishFieldDiagnostics']) {
  assert.match(page, new RegExp(helper), `source publish confirmation should use ${helper}`);
}
for (const label of ['候选待确认', '当前候选尚未完成权威确认，发布已阻断']) {
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
  /categoryId:\s*publishCandidate\.categoryId[\s\S]*typeId:\s*publishCandidate\.typeId/,
  'source publish should submit the selected source Ozon category candidate instead of a title-search category',
);

assert.match(
  page,
  /<OzonAttributeEditor[\s\S]*itemId=\{item\.id\}[\s\S]*selectedSkuKeys=/,
  'source attribute detail should mount the durable Ozon full-field editor for the current item and SKU identity',
);
assert.match(
  page,
  /function sourceWorkflowVariantKey[\s\S]*variant\.key \|\| sourceVariantKey/,
  'listing workflow identity should prefer the canonical Capture V2 SKU key over the supplier SKU alias',
);
assert.match(
  page,
  /displayVariants\.map\(\(variant, index\) => sourceWorkflowVariantKey\(variant, index\)\)/,
  'listing workflow synchronization should use canonical Capture V2 SKU keys',
);
for (const endpoint of [
  '/attributes`',
  '/attributes/${field.attributeId}/dictionary?',
  '/attributes/suggestions/apply',
  '/validate',
]) {
  assert.match(
    attributeEditor,
    new RegExp(endpoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `Ozon attribute editor should call durable workflow endpoint ${endpoint}`,
  );
}
const applyAttributeSuggestion = attributeEditor.match(/async function applyAttributeSuggestion[\s\S]*?\n  async function validateOnServer/)?.[0] || '';
for (const token of [
  'expectedRevision: context.revision',
  'candidateId: suggestion.candidateId',
  'candidateHash: suggestion.candidateHash',
  'schemaRevision: suggestion.schemaRevision',
  'candidates: [candidate]',
  'suggestion.draftRevision !== context.revision',
  'applyListingWorkflowDraft',
  'refreshAttributeWorkspace',
]) {
  assert.match(
    applyAttributeSuggestion,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `attribute suggestions should persist only through explicit apply using ${token}`,
  );
}
assert.doesNotMatch(
  attributeEditor,
  /useEffect\([\s\S]{0,500}attributes\/suggestions\/apply/,
  'attribute suggestions must never auto-apply from an effect',
);
for (const token of [
  'authoritativeValidationFromDraft',
  'setAuthoritativeValidation(authoritativeValidationFromDraft(draft))',
  'authoritativeValidation || workspace?.validationPreview',
  "authoritativeValidation ? '服务器终检' : '缓存预检'",
]) {
  assert.match(
    attributeEditor,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `authoritative validation must survive a cached workspace refresh via ${token}`,
  );
}
const dictionarySearch = attributeEditor.match(/async function searchAttributeDictionary[\s\S]*?\n  async function saveAttribute/)?.[0] || '';
for (const token of ['query=', 'limit=50', 'dictionaryRequestIdsRef', 'attributeScopeKey', 'attributeContextIsCurrent', 'dictionaryValueId', 'dictionaryValueIds']) {
  assert.match(
    attributeEditor,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `dictionary editing should use canonical server search and IDs via ${token}`,
  );
}
for (const guard of ['invalidateDictionarySearches', 'handleDictionaryQueryChange']) {
  assert.match(
    attributeEditor,
    new RegExp(guard),
    `dictionary editing should invalidate obsolete query state via ${guard}`,
  );
}
for (const reset of ["setWorkspaceLoading(false);", "setBusyAction('');"]) {
  assert.match(
    attributeEditor,
    new RegExp(reset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `attribute identity changes should clear obsolete request state via ${reset}`,
  );
}
for (const token of [
  'canonicalSkuKeys',
  'canonicalSkuIdentity',
  'activeSkuKeys',
  'setActiveSkuKeys(canonicalSkuKeys)',
  'adoptCanonicalSkuIdentity',
  'buildEditStates(res.data, desired.canonicalSkuKeys)',
  "[...draft.selectedSkuKeys].sort().join('\\u0000') !== desired.canonicalSkuIdentity",
]) {
  assert.match(
    attributeEditor,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `attribute identity should adopt the server canonical SKU selection via ${token}`,
  );
}
assert.match(
  attributeEditor,
  /const resumedFromServer = !current[\s\S]*?if \(!resumedFromServer && requestedSkuSelectionChanged/,
  'a create/resume response should be authoritative and must not be patched again merely because aliases differ',
);
assert.doesNotMatch(
  attributeEditor,
  /normalizedSkuKeys\.includes\(skuKey\)|normalizedSkuKeys\.map\(\(skuKey\) => renderAttributeScope/,
  'SKU edits and matrix rows must use the server-adopted canonical keys rather than supplier aliases',
);
assert.match(
  attributeEditor,
  /const editorLocked = listingWorkflowLoading \|\| workspaceLoading \|\| !!busyAction;[\s\S]*disabled=\{readOnly \|\| editorLocked\}/,
  'attribute controls should prevent edits while a revision-changing mutation is in flight',
);
const saveAttribute = attributeEditor.match(/async function saveAttribute[\s\S]*?\n  async function applyAttributeSuggestion/)?.[0] || '';
for (const token of ['expectedRevision: context.revision', 'changes: [change]', 'skuKey', 'evidence', 'applyListingWorkflowDraft', 'refreshAttributeWorkspace']) {
  assert.match(
    saveAttribute,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `manual attribute editing should CAS and refresh through ${token}`,
  );
}
const clearAttribute = attributeEditor.match(/async function clearAttribute[\s\S]*?\n  async function applyAttributeSuggestion/)?.[0] || '';
for (const token of [
  "action: 'CLEAR' as const",
  'expectedRevision: context.revision',
  'changes: [change]',
  'manual:web-source-attribute-editor:clear',
  'applyListingWorkflowDraft',
  'refreshAttributeWorkspace',
]) {
  assert.match(
    clearAttribute,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `manual attribute clearing should CAS, audit and refresh through ${token}`,
  );
}
assert.match(attributeEditor, /onClick=\{\(\) => clearAttribute\(field, skuKey\)\}/, 'SKU attribute leaves should expose an explicit clear command');
assert.match(attributeEditor, /onClick=\{\(\) => clearAttribute\(field\)\}/, 'product attributes should expose an explicit clear command');
assert.match(attributeEditor, /aria-label=\{skuKey \? `清除 \$\{skuKey\} 的 \$\{field\.name\}`/, 'SKU clear command should have a scope-specific accessible name');
for (const token of [
  'skuValues?.[skuKey]',
  'visibleSkuKeys.map((skuKey)',
  'attributeScopeKey(field.attributeId, skuKey)',
  'suggestion?.skuValues?.[skuKey]',
  'suggestedSkuCount',
  '当前 SKU 值缺失',
  '该 SKU 暂无建议',
]) {
  assert.match(
    attributeEditor,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `SKU-owned attributes should render isolated selected-SKU leaves via ${token}`,
  );
}
for (const token of [
  'const SKU_MATRIX_PAGE_SIZE = 10',
  'skuPageByAttribute',
  'activeSkuKeys.slice(skuPageStart, skuPageEnd)',
  '显示 SKU {skuPageStart + 1}-{skuPageEnd}',
  'SKU 上一页',
  'SKU 下一页',
]) {
  assert.match(
    attributeEditor,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `SKU matrix rendering should remain page-bounded via ${token}`,
  );
}
assert.doesNotMatch(
  attributeEditor,
  /normalizedSkuKeys\.map\(\(skuKey\) => renderAttributeScope/,
  'SKU matrix must not mount every selected SKU editor at once',
);
for (const token of [
  'aria-label={`${field.name} 官方字典搜索`}',
  'aria-label={`搜索 ${field.name} 官方字典`}',
  'aria-label={`${field.name} 值`}',
]) {
  assert.match(
    attributeEditor,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `product-level attribute controls should expose an accessible name via ${token}`,
  );
}
assert.equal(
  (attributeEditor.match(/aria-pressed=\{selected\}/g) || []).length,
  2,
  'product and SKU dictionary options should expose their selected state',
);
const validateAttributes = attributeEditor.match(/async function validateOnServer[\s\S]*?\n  return \(/)?.[0] || '';
for (const token of ['expectedRevision: context.revision', 'applyListingWorkflowDraft', 'refreshAttributeWorkspace']) {
  assert.match(
    validateAttributes,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `server validation should use the current draft and refresh through ${token}`,
  );
}
for (const guard of [
  'listingWorkflowRequestIdRef',
  'attributeWorkspaceRequestIdRef',
  'dictionaryRequestIdsRef',
  'desiredListingWorkflowIdentityRef',
  'listingWorkflowIdentityQueueRef',
  'captureAttributeContext',
  'attributeContextIsCurrent',
]) {
  assert.match(attributeEditor, new RegExp(guard), `attribute workflow should reject stale async state via ${guard}`);
}
for (const label of [
  '必填',
  '严格字典',
  '开放字典',
  '字段归属',
  '当前值',
  '置信度',
  '证据',
  '复核状态',
  '采用建议',
  '阻断原因',
  'Ozon 导入',
  '库存激活',
  '成本定价',
  '服务器校验',
]) {
  assert.match(attributeEditor, new RegExp(label), `attribute editor should expose operator state: ${label}`);
}

const collectRoute = fs.readFileSync('apps/server/src/routes/collect.ts', 'utf8');
assert.match(
  collectRoute,
  /transferSourceProductVideos\(\{[\s\S]*shopId:\s*body\.shopId[\s\S]*\}\)/,
  'source publish should upload collected source videos with the selected Ozon shop before generating video attributes',
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

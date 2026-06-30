import { normalizeSourceStandardAttributes } from 'shared/source-standard-attributes';

export type SourceListingReadinessStatus = 'ready' | 'needs_review' | 'blocked';

export interface SourceListingReadinessResult {
  status: SourceListingReadinessStatus;
  missingFields: string[];
  blockers: string[];
  warnings: string[];
  restrictionRisks: string[];
}

export type SourceListingFieldDiagnosticStatus = 'auto' | 'review' | 'blocked' | 'manual';
export type SourceListingFieldConfidence = 'strong' | 'weak' | 'missing' | 'ai' | 'manual';

export interface SourceListingFieldDiagnostic {
  key: string;
  label: string;
  status: SourceListingFieldDiagnosticStatus;
  confidence: SourceListingFieldConfidence;
  value: string;
  source: string;
  evidence: string;
  action: string;
}

interface SourceListingItemLike {
  title?: unknown;
  images?: unknown;
  variants?: unknown;
  metadata?: Record<string, unknown> | null;
}

const RESTRICTED_PRODUCT_RE = /(仿|高仿|a货|copy|复制品|1\s*[:：]\s*1|原版|正品|战术|军用|无人机|电子烟|烟草|酒|药品|处方|医疗器械|刀具|弩|枪|弹药|化学品|农药|危险品|成人用品)/i;
const CYRILLIC_TEXT_RE = /[А-Яа-яЁё]/;
const CJK_TEXT_RE = /[\u3400-\u9fff]/;

function metadataArray(item: SourceListingItemLike, key: string): unknown[] {
  const value = item.metadata?.[key];
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return String(value || '').trim();
}

function isRussianText(value: unknown): boolean {
  const text = stringValue(value);
  return Boolean(text && CYRILLIC_TEXT_RE.test(text) && !CJK_TEXT_RE.test(text));
}

function hasRussianMetadataValue(item: SourceListingItemLike, keys: string[]): boolean {
  return keys.some((key) => {
    const value = item.metadata?.[key];
    if (Array.isArray(value)) return value.some((entry) => isRussianText(entry));
    return isRussianText(value);
  });
}

function hasRussianAiContentDraft(item: SourceListingItemLike): boolean {
  const drafts = item.metadata?.aiContentDrafts;
  if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) return false;
  return ['title', 'description'].some((field) => {
    const draft = (drafts as Record<string, unknown>)[field];
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)) return false;
    return isRussianText((draft as Record<string, unknown>).text);
  });
}

function aiContentDraft(item: SourceListingItemLike, field: 'title' | 'description'): Record<string, unknown> {
  const drafts = item.metadata?.aiContentDrafts;
  if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts)) return {};
  const draft = (drafts as Record<string, unknown>)[field];
  return draft && typeof draft === 'object' && !Array.isArray(draft) ? draft as Record<string, unknown> : {};
}

function aiContentDraftText(item: SourceListingItemLike, field: 'title' | 'description'): string {
  const draft = aiContentDraft(item, field);
  return isRussianText(draft.text) ? stringValue(draft.text) : '';
}

function aiContentDraftConfidence(item: SourceListingItemLike, field: 'title' | 'description'): number | null {
  const draft = aiContentDraft(item, field);
  const structured = draft.structured && typeof draft.structured === 'object' && !Array.isArray(draft.structured)
    ? draft.structured as Record<string, unknown>
    : {};
  const confidence = Number(structured.confidence);
  return Number.isFinite(confidence) ? confidence : null;
}

function sourceAttributes(item: SourceListingItemLike): Array<Record<string, unknown>> {
  return metadataArray(item, 'sourceAttributes')
    .filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry));
}

function sourceVariants(item: SourceListingItemLike): Array<Record<string, unknown>> {
  const variants = Array.isArray(item.variants) ? item.variants : item.metadata?.skuItems;
  return Array.isArray(variants)
    ? variants.filter((entry): entry is Record<string, unknown> => !!entry && typeof entry === 'object' && !Array.isArray(entry))
    : [];
}



function hasStock(item: SourceListingItemLike): boolean {
  return sourceVariants(item).some((variant) => {
    const stock = Number(variant.stock ?? variant.stockNum ?? variant.quantity);
    return Number.isFinite(stock) && stock >= 0;
  });
}

function hasAnyImage(item: SourceListingItemLike): boolean {
  if (metadataArray(item, 'sourceMainImages').length) return true;
  return Array.isArray(item.images) && item.images.some((image) => /^https?:\/\//i.test(stringValue(image)));
}

function hasMetadataValue(item: SourceListingItemLike, keys: string[]): boolean {
  return keys.some((key) => {
    const value = item.metadata?.[key];
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'string') return value.trim().length > 0;
    return Boolean(value);
  });
}

function hasCategoryAndType(item: SourceListingItemLike): boolean {
  return hasMetadataValue(item, ['descriptionCategoryId', 'ozonCategoryId'])
    && hasMetadataValue(item, ['typeId', 'ozonTypeId']);
}

function categoryValue(item: SourceListingItemLike): string {
  const categoryId = stringValue(item.metadata?.descriptionCategoryId || item.metadata?.ozonCategoryId);
  const typeId = stringValue(item.metadata?.typeId || item.metadata?.ozonTypeId);
  if (!categoryId || !typeId) return '';
  return `${categoryId} / ${typeId}`;
}

function packageValue(standard: ReturnType<typeof normalizeSourceStandardAttributes>): string {
  const dims = standard.packageDimensionsMm;
  const weight = standard.packageWeightG ? `${standard.packageWeightG}g` : '';
  const size = dims ? `${dims.length}x${dims.width}x${dims.height}mm` : '';
  return [weight, size].filter(Boolean).join(' / ');
}

function extractionPackagingReason(item: SourceListingItemLike): string {
  const diagnostics = item.metadata?.extractionDiagnostics;
  if (!diagnostics || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) return '';
  const packaging = (diagnostics as Record<string, unknown>).packaging;
  if (!packaging || typeof packaging !== 'object' || Array.isArray(packaging)) return '';
  const row = packaging as Record<string, unknown>;
  return stringValue(row.reasonLabel || row.message || row.reason || row.status);
}

function richContentValue(item: SourceListingItemLike): string {
  if (hasMetadataValue(item, ['sourceRichDescriptionJson'])) return '本地 RichContentJson 字段';
  const draft = item.metadata?.sourceRichContentDraft;
  if (draft && typeof draft === 'object' && !Array.isArray(draft)) {
    const blocks = (draft as Record<string, unknown>).blocks;
    if (Array.isArray(blocks) && blocks.length) return `本地草稿 ${blocks.length} 块`;
  }
  return '';
}

function diagnosticRow(input: SourceListingFieldDiagnostic): SourceListingFieldDiagnostic {
  return input;
}

export function evaluateSourceListingFieldDiagnostics(item: SourceListingItemLike): SourceListingFieldDiagnostic[] {
  const standard = normalizeSourceStandardAttributes(item);
  const publishTitle = isRussianText(item.metadata?.publishTitleRu) ? stringValue(item.metadata?.publishTitleRu) : '';
  const aiTitle = aiContentDraftText(item, 'title');
  const publishDescription = hasRussianMetadataValue(item, ['publishDescriptionRu', 'sourceDescriptionRu', 'descriptionRu'])
    ? stringValue(item.metadata?.publishDescriptionRu || item.metadata?.sourceDescriptionRu || item.metadata?.descriptionRu)
    : '';
  const aiDescription = aiContentDraftText(item, 'description');
  const descriptionConfidence = aiContentDraftConfidence(item, 'description');
  const category = categoryValue(item);
  const packageText = packageValue(standard);
  const packageReason = extractionPackagingReason(item);
  const hasCompletePackage = Boolean(standard.packageWeightG && standard.packageDimensionsMm);
  const hasPartialPackage = Boolean(standard.packageWeightG || standard.packageDimensionsMm);
  const title = publishTitle || aiTitle;
  const description = publishDescription || aiDescription;

  const rows: SourceListingFieldDiagnostic[] = [
    diagnosticRow({
      key: 'title',
      label: '俄语标题',
      status: title ? 'auto' : 'blocked',
      confidence: publishTitle ? 'strong' : (aiTitle ? 'ai' : 'missing'),
      value: title || '未生成',
      source: publishTitle ? '发布字段' : (aiTitle ? 'AI 草稿' : '缺失'),
      evidence: title ? '发布时会写入 Ozon 商品标题' : '缺少可发布俄语标题',
      action: title ? '无需手填，可在发布前覆盖' : '生成或填写俄语标题',
    }),
    diagnosticRow({
      key: 'description',
      label: '商品描述',
      status: description ? (!publishDescription && descriptionConfidence !== null && descriptionConfidence < 0.75 ? 'review' : 'auto') : 'blocked',
      confidence: publishDescription ? 'strong' : (aiDescription ? 'ai' : 'missing'),
      value: description || '未生成',
      source: publishDescription ? '发布字段' : (aiDescription ? 'AI 草稿' : '缺失'),
      evidence: descriptionConfidence !== null ? `AI 置信度 ${Math.round(descriptionConfidence * 100)}%` : (description ? '俄语描述可用' : '缺少可发布俄语描述'),
      action: description ? '低置信度时建议复核文案' : '生成或填写俄语描述',
    }),
    diagnosticRow({
      key: 'category',
      label: 'Ozon 类目/type',
      status: category ? 'auto' : 'blocked',
      confidence: category ? 'strong' : 'missing',
      value: category || '未选择',
      source: category ? '已确认类目' : '缺失',
      evidence: category ? '发布时使用已确认 Ozon 类目' : '没有 description_category_id/type_id',
      action: category ? '无需手填' : '选择并确认 Ozon 类目',
    }),
    diagnosticRow({
      key: 'gender',
      label: '性别',
      status: standard.gender.value ? 'auto' : 'review',
      confidence: standard.gender.value ? 'strong' : 'missing',
      value: standard.gender.value || '未识别',
      source: standard.gender.source || (standard.gender.value ? '标准属性' : '缺失'),
      evidence: standard.gender.value ? '会映射到 Ozon 性别属性' : '标题/属性未提供明确性别',
      action: standard.gender.value ? '无需手填' : '确认适用性别',
    }),
    diagnosticRow({
      key: 'originCountry',
      label: '原产国',
      status: category ? 'auto' : 'review',
      confidence: category ? 'strong' : 'weak',
      value: category ? 'Китай' : '待类目确认后补 Китай',
      source: '系统默认',
      evidence: category ? '国内源商品发布时自动补中国' : '需要先知道类目是否有原产国属性',
      action: category ? '无需手填' : '先确认 Ozon 类目',
    }),
    diagnosticRow({
      key: 'package',
      label: '件重尺',
      status: hasCompletePackage ? 'auto' : 'blocked',
      confidence: hasCompletePackage ? 'strong' : (hasPartialPackage ? 'weak' : 'missing'),
      value: packageText || '未填写',
      source: hasCompletePackage ? '采集/人工补录' : (hasPartialPackage ? '部分采集' : '缺失'),
      evidence: packageReason || (packageText ? packageText : '缺少重量、长、宽、高'),
      action: hasCompletePackage ? '发布时直接使用' : '填写重量、长、宽、高',
    }),
    diagnosticRow({
      key: 'material',
      label: '材质/成分',
      status: standard.materials.length ? 'auto' : 'review',
      confidence: standard.materials.length ? 'strong' : 'missing',
      value: standard.materials.join(' / ') || '未识别',
      source: standard.materials.length ? '源属性归一' : '缺失',
      evidence: standard.materials.length ? '会尝试映射到 Ozon 材质属性' : '源属性未提供材质',
      action: standard.materials.length ? '无需手填，字典不命中时会提示' : '补充材质/成分',
    }),
    diagnosticRow({
      key: 'richContent',
      label: '富内容',
      status: richContentValue(item) ? 'review' : 'review',
      confidence: richContentValue(item) ? 'weak' : 'missing',
      value: richContentValue(item) || '未生成',
      source: richContentValue(item) ? '本地采集/AI 草稿' : '缺失',
      evidence: richContentValue(item) ? '发布时会尝试转换并附加到 Ozon RichContentJson，最终以发布任务/Ozon 审核结果为准' : '不阻断主体上架',
      action: richContentValue(item) ? '发布后查看任务富内容结果' : '可先发布主体，后续补富内容',
    }),
  ];

  return rows;
}


function displayTitle(item: SourceListingItemLike): string {
  return stringValue(item.metadata?.sourceTitleRaw || item.title);
}

function titleNeedsReview(item: SourceListingItemLike): boolean {
  if (isRussianText(item.metadata?.publishTitleRu)) return false;
  const title = displayTitle(item);
  return !title || /^(1688|PDD|拼多多|淘宝|天猫)?\s*商品\s*\d*$/i.test(title) || Boolean(item.metadata?.titleNeedsReview);
}

function hasOzonAttributeReadiness(item: SourceListingItemLike): boolean {
  if (!('ozonRequiredAttributesResolved' in (item.metadata || {}))
    && !('ozonRequiredAttributesReady' in (item.metadata || {}))
    && !('ozonDictionaryValuesResolved' in (item.metadata || {}))
    && !('ozonDictionaryValuesReady' in (item.metadata || {}))) {
    return true;
  }
  return Boolean(item.metadata?.ozonRequiredAttributesResolved || item.metadata?.ozonRequiredAttributesReady)
    && Boolean(item.metadata?.ozonDictionaryValuesResolved || item.metadata?.ozonDictionaryValuesReady);
}

export function evaluateSourceListingReadiness(item: SourceListingItemLike): SourceListingReadinessResult {
  const standard = normalizeSourceStandardAttributes(item);
  const missingFields: string[] = [];
  const blockers: string[] = [];
  const warnings: string[] = [];
  const restrictionRisks: string[] = [];

  const addMissing = (label: string, severity: 'blocker' | 'warning') => {
    if (!missingFields.includes(label)) missingFields.push(label);
    const target = severity === 'blocker' ? blockers : warnings;
    if (!target.includes(label)) target.push(label);
  };

  if (titleNeedsReview(item)) addMissing('真实商品标题', 'blocker');
  if (!hasRussianMetadataValue(item, ['publishTitleRu', 'sourceDescriptionRu', 'titleRu', 'descriptionRu']) && !hasRussianAiContentDraft(item)) addMissing('俄文标题/描述', 'warning');
  if (!hasCategoryAndType(item)) addMissing('Ozon 类目/type', 'blocker');
  if (!hasOzonAttributeReadiness(item)) addMissing('Ozon 必填属性/字典值', 'warning');
  if (!standard.brand.value && !standard.brand.isBrandless) addMissing('品牌/无品牌', 'warning');
  if (!standard.colors.length || !standard.sizes.length) addMissing('颜色尺码变体', 'blocker');
  if (!hasStock(item)) addMissing('SKU 库存', 'blocker');
  if (!standard.materials.length) addMissing('材质/成分', 'warning');
  if (!standard.gender.value || !standard.seasons.length) addMissing('性别/季节', 'warning');
  if (!standard.packageWeightG) addMissing('重量', 'blocker');
  if (!standard.packageDimensionsMm) addMissing('包装尺寸', 'blocker');
  if (!hasAnyImage(item)) addMissing('可用主图清洗', 'blocker');
  if (!hasMetadataValue(item, ['watermarkedImages', 'sourceWatermarkedImages', 'watermarkImages'])
    || !hasMetadataValue(item, ['editedImages', 'processedImages', 'sourceEditedImages', 'imageProcessingResult'])) {
    warnings.push('图片待水印/改图');
  }
  if (!hasMetadataValue(item, ['sourceVideos', 'sourceRichDescriptionJson', 'sourceRichContentDraft'])) warnings.push('视频/富内容待处理');

  if (RESTRICTED_PRODUCT_RE.test(displayTitle(item))
    || sourceAttributes(item).some((attr) => RESTRICTED_PRODUCT_RE.test(`${stringValue(attr.name)} ${stringValue(attr.value)}`))) {
    restrictionRisks.push('销售受限/出口限制风险');
    blockers.push('销售受限/出口限制风险');
  }

  const status: SourceListingReadinessStatus = blockers.length
    ? 'blocked'
    : (missingFields.length || warnings.length ? 'needs_review' : 'ready');

  return {
    status,
    missingFields,
    blockers,
    warnings,
    restrictionRisks,
  };
}

export function sourceListingStatusLabel(status: SourceListingReadinessStatus): string {
  if (status === 'ready') return '可上架';
  if (status === 'blocked') return '阻断';
  return '待复核';
}

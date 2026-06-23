export type SourceListingReadinessStatus = 'ready' | 'needs_review' | 'blocked';

export interface SourceListingReadinessResult {
  status: SourceListingReadinessStatus;
  missingFields: string[];
  blockers: string[];
  warnings: string[];
  restrictionRisks: string[];
}

interface SourceListingItemLike {
  title?: unknown;
  images?: unknown;
  variants?: unknown;
  metadata?: Record<string, unknown> | null;
}

const RESTRICTED_PRODUCT_RE = /(仿|高仿|a货|copy|复制品|1\s*[:：]\s*1|原版|正品|战术|军用|无人机|电子烟|烟草|酒|药品|处方|医疗器械|刀具|弩|枪|弹药|化学品|农药|危险品|成人用品)/i;

function metadataArray(item: SourceListingItemLike, key: string): unknown[] {
  const value = item.metadata?.[key];
  return Array.isArray(value) ? value : [];
}

function stringValue(value: unknown): string {
  return String(value || '').trim();
}

function hasPositiveNumber(value: unknown): boolean {
  const num = Number(value);
  return Number.isFinite(num) && num > 0;
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

function hasAttribute(item: SourceListingItemLike, pattern: RegExp): boolean {
  return sourceAttributes(item).some((attr) => pattern.test(stringValue(attr.name || attr.key)) || pattern.test(stringValue(attr.value || attr.attrValue || attr.text)));
}

function hasVariantAttribute(item: SourceListingItemLike, pattern: RegExp): boolean {
  return sourceVariants(item).some((variant) => {
    const attrs = variant.attrs && typeof variant.attrs === 'object' && !Array.isArray(variant.attrs)
      ? variant.attrs as Record<string, unknown>
      : {};
    return Object.entries(attrs).some(([key, value]) => pattern.test(key) || pattern.test(stringValue(value)))
      || pattern.test(stringValue(variant.name || variant.specText));
  });
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

function hasDimensions(item: SourceListingItemLike): boolean {
  return hasPositiveNumber(item.metadata?.weightG)
    && hasPositiveNumber(item.metadata?.lengthMm)
    && hasPositiveNumber(item.metadata?.widthMm)
    && hasPositiveNumber(item.metadata?.heightMm);
}

function displayTitle(item: SourceListingItemLike): string {
  return stringValue(item.metadata?.sourceTitleRaw || item.title);
}

function titleNeedsReview(item: SourceListingItemLike): boolean {
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
  if (!hasMetadataValue(item, ['publishTitleRu', 'sourceDescriptionRu', 'titleRu', 'descriptionRu'])) addMissing('俄文标题/描述', 'warning');
  if (!hasCategoryAndType(item)) addMissing('Ozon 类目/type', 'blocker');
  if (!hasOzonAttributeReadiness(item)) addMissing('Ozon 必填属性/字典值', 'warning');
  if (!hasAttribute(item, /品牌|brand/i)) addMissing('品牌/无品牌', 'warning');
  if (!hasVariantAttribute(item, /颜色|color|colour/i) || !hasVariantAttribute(item, /尺码|规格|size/i)) addMissing('颜色尺码变体', 'blocker');
  if (!hasStock(item)) addMissing('SKU 库存', 'blocker');
  if (!hasAttribute(item, /材质|成分|面料|material|composition/i)) addMissing('材质/成分', 'warning');
  if (!hasAttribute(item, /性别|适用性别|gender/i) || !hasAttribute(item, /季节|season/i)) addMissing('性别/季节', 'warning');
  if (!hasDimensions(item)) addMissing('重量尺寸', 'blocker');
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

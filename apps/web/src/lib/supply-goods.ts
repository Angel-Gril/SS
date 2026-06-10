export interface SupplyGoodsListItem {
  sourcePlatform: string | null;
  metadata?: unknown;
}

export interface SupplyGoods1688Summary {
  hasPricing: boolean;
  hasMapping: boolean;
  hasOzonSource: boolean;
  pricingText: string;
  skuPricingText: string;
  mappingText: string;
  ozonSourceText: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asDisplayNumber(value: unknown): string | null {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return String(number);
}

function getCategoryMatchLabel(value: unknown): string {
  if (value === 'sourceCategoryId') return 'ID匹配';
  if (value === 'sourceCategoryPath') return '路径匹配';
  if (value === 'sourceCategoryName') return '名称匹配';
  return '';
}

function getCategoryScopeLabel(value: unknown): string {
  if (value === 'user') return '我的映射';
  if (value === 'global') return '全局默认';
  return '';
}

export function buildSupplyGoods1688Summary(item: SupplyGoodsListItem): SupplyGoods1688Summary | null {
  if (item.sourcePlatform !== '1688') return null;

  const metadata = asRecord(item.metadata);
  const pricing = asRecord(metadata?.pricing);
  const mappedCategory = asRecord(metadata?.mappedCategory);
  const ozonSourceContext = asRecord(metadata?.ozonSourceContext);

  const priceCny = asDisplayNumber(pricing?.suggestedSalePriceCny);
  const priceRub = asDisplayNumber(pricing?.suggestedSalePriceRub);
  const margin = asDisplayNumber(pricing?.estimatedMarginPct);
  const hasPricing = !!(priceCny && priceRub && margin);
  const skuSummary = asRecord(pricing?.skuSummary);
  const skuCount = asDisplayNumber(skuSummary?.count);
  const minSkuCny = asDisplayNumber(skuSummary?.minSuggestedSalePriceCny);
  const maxSkuCny = asDisplayNumber(skuSummary?.maxSuggestedSalePriceCny);
  const minSkuRub = asDisplayNumber(skuSummary?.minSuggestedSalePriceRub);
  const maxSkuRub = asDisplayNumber(skuSummary?.maxSuggestedSalePriceRub);
  const hasSkuPricing = !!(skuCount && minSkuCny && maxSkuCny && minSkuRub && maxSkuRub);

  const targetCategoryId = asDisplayNumber(mappedCategory?.targetCategoryId);
  const targetTypeId = asDisplayNumber(mappedCategory?.targetTypeId);
  const targetCategoryName = typeof mappedCategory?.targetCategoryName === 'string' ? mappedCategory.targetCategoryName : '';
  const hasMapping = !!(targetCategoryId && targetTypeId);
  const mappingDetails = [
    targetCategoryName,
    getCategoryMatchLabel(mappedCategory?.matchType),
    getCategoryScopeLabel(mappedCategory?.scope),
  ].filter(Boolean);

  const sourceOzonProductId = typeof metadata?.sourceOzonProductId === 'string'
    ? metadata.sourceOzonProductId
    : (typeof ozonSourceContext?.productId === 'string' ? ozonSourceContext.productId : '');
  const ozonTitle = typeof ozonSourceContext?.title === 'string' ? ozonSourceContext.title : '';
  const ozonCategory = typeof ozonSourceContext?.categoryName === 'string' ? ozonSourceContext.categoryName : '';
  const hasOzonSource = !!(sourceOzonProductId || ozonTitle || ozonCategory);
  const ozonParts = [
    sourceOzonProductId ? `Ozon ${sourceOzonProductId}` : '',
    ozonTitle,
    ozonCategory,
  ].filter(Boolean);

  return {
    hasPricing,
    hasMapping,
    hasOzonSource,
    pricingText: hasPricing ? `建议 ¥${priceCny} / ₽${priceRub} · 利润率 ${margin}%` : '未生成核价',
    skuPricingText: hasSkuPricing ? `SKU ${skuCount} 个 · ¥${minSkuCny}-${maxSkuCny} / ₽${minSkuRub}-${maxSkuRub}` : '未生成 SKU 核价',
    mappingText: hasMapping
      ? `Ozon ${targetCategoryId} / type ${targetTypeId}${mappingDetails.length ? ` · ${mappingDetails.join(' · ')}` : ''}`
      : '未命中类目映射',
    ozonSourceText: hasOzonSource ? `来自 ${ozonParts.join(' · ')}` : '未关联 Ozon 来源',
  };
}

export interface SupplyGoodsListItem {
  sourcePlatform: string | null;
  metadata?: unknown;
}

export interface SupplyGoods1688Summary {
  hasPricing: boolean;
  hasMapping: boolean;
  pricingText: string;
  mappingText: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asDisplayNumber(value: unknown): string | null {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number)) return null;
  return String(number);
}

export function buildSupplyGoods1688Summary(item: SupplyGoodsListItem): SupplyGoods1688Summary | null {
  if (item.sourcePlatform !== '1688') return null;

  const metadata = asRecord(item.metadata);
  const pricing = asRecord(metadata?.pricing);
  const mappedCategory = asRecord(metadata?.mappedCategory);

  const priceCny = asDisplayNumber(pricing?.suggestedSalePriceCny);
  const priceRub = asDisplayNumber(pricing?.suggestedSalePriceRub);
  const margin = asDisplayNumber(pricing?.estimatedMarginPct);
  const hasPricing = !!(priceCny && priceRub && margin);

  const targetCategoryId = asDisplayNumber(mappedCategory?.targetCategoryId);
  const targetTypeId = asDisplayNumber(mappedCategory?.targetTypeId);
  const targetCategoryName = typeof mappedCategory?.targetCategoryName === 'string' ? mappedCategory.targetCategoryName : '';
  const hasMapping = !!(targetCategoryId && targetTypeId);

  return {
    hasPricing,
    hasMapping,
    pricingText: hasPricing ? `建议 ¥${priceCny} / ₽${priceRub} · 利润率 ${margin}%` : '未生成核价',
    mappingText: hasMapping
      ? `Ozon ${targetCategoryId} / type ${targetTypeId}${targetCategoryName ? ` · ${targetCategoryName}` : ''}`
      : '未命中类目映射',
  };
}

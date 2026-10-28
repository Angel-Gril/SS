export interface ProductSyncMeta {
  ozonBarcodes?: string[];
  ozonStatus?: {
    status?: string;
    status_failed?: string;
    moderate_status?: string;
    status_name?: string;
    status_description?: string;
    is_created?: boolean;
  } | null;
  ozonStocks?: Array<{
    warehouse_id?: number | string;
    warehouse_name?: string;
    present?: number;
    reserved?: number;
  }>;
  ozonCategory?: {
    descriptionCategoryId?: number;
    typeId?: number;
  } | null;
  ozonPrice?: {
    tier?: ProductProfitTier;
    color?: 'red' | 'yellow' | 'green' | 'unknown';
    currentPrice?: number | null;
    marketingPrice?: number | null;
    competitorMinPrice?: number | null;
    competitorCurrency?: string | null;
    rawIndex?: unknown;
    syncedAt?: string;
  } | null;
  ozonSyncedAt?: string;
}

export type OzonStatusTone = 'success' | 'warning' | 'danger' | 'muted' | 'info';
export type WarehouseStockMode = 'all' | 'in_stock' | 'out_of_stock';
export type ProductStatusFilter = 'current' | 'archived' | 'missing' | 'all';
export type ProductStatusBucket = Exclude<ProductStatusFilter, 'all'>;
export type ProductProfitFilter = 'all' | 'unprofitable' | 'medium' | 'profitable' | 'very_profitable' | 'unknown';
export type ProductProfitTier = Exclude<ProductProfitFilter, 'all'>;

export interface ProductStatusCounts {
  current: number;
  archived: number;
  missing: number;
  all: number;
}

export interface ProductListComputedFilters {
  priceMin?: number | null;
  priceMax?: number | null;
  weightMin?: number | null;
  weightMax?: number | null;
  stockMin?: number | null;
  stockMax?: number | null;
  warehouseId?: string | number | null;
  warehouseStockMode?: WarehouseStockMode;
  profitFilter?: ProductProfitFilter;
  ozonPriceIndexFilter?: ProductProfitFilter;
  rubToCnyRate?: number;
}

interface ProductListFilterTarget {
  price?: unknown;
  currency?: unknown;
  commissionRate?: unknown;
  buyerPriceCny?: unknown;
  profitCny?: unknown;
  profitMarginPct?: unknown;
  weight?: unknown;
  stock?: unknown;
  variants?: unknown;
}

interface ProductStatusTarget {
  visibility?: unknown;
  syncStatus?: unknown;
}

function positiveInt(value: unknown): number | null {
  const num = finiteNumber(value);
  if (num == null || num <= 0) return null;
  return Math.trunc(num);
}

export function normalizeOzonSku(value: unknown): string | null {
  const sku = String(value ?? '').trim();
  if (!sku || sku === '0') return null;
  return sku;
}

function statusText(value: unknown): string {
  return String(value || '').trim().toUpperCase();
}

function isArchivedProduct(product: ProductStatusTarget): boolean {
  return statusText(product.visibility) === 'ARCHIVED';
}

function isMissingProduct(product: ProductStatusTarget): boolean {
  return statusText(product.visibility) === 'MISSING' || statusText(product.syncStatus) === 'MISSING';
}

export function getProductStatusBucket(product: ProductStatusTarget): ProductStatusBucket {
  if (isArchivedProduct(product)) return 'archived';
  if (isMissingProduct(product)) return 'missing';
  return 'current';
}

export function matchesProductStatusFilter(product: ProductStatusTarget, filter: ProductStatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'archived') return isArchivedProduct(product);
  if (filter === 'missing') return isMissingProduct(product);
  return !isArchivedProduct(product) && !isMissingProduct(product);
}

export function buildProductStatusCounts(products: ProductStatusTarget[]): ProductStatusCounts {
  return {
    current: products.filter((product) => matchesProductStatusFilter(product, 'current')).length,
    archived: products.filter((product) => matchesProductStatusFilter(product, 'archived')).length,
    missing: products.filter((product) => matchesProductStatusFilter(product, 'missing')).length,
    all: products.length,
  };
}

const OZON_STATUS_LABELS: Record<string, string> = {
  price_sent: '价格已发送',
  active: '在售',
  visible: '在售',
  sale: '在售',
  archived: '已归档',
  hidden: '已隐藏',
  missing: 'Ozon 当前列表未返回',
  failed: '同步失败',
  rejected: '审核拒绝',
  blocked: '已锁定',
  moderating: '审核中',
  approved: '审核通过',
  declined: '审核拒绝',
  'в продаже': '在售',
  'продается': '在售',
  'продаётся': '在售',
  'готов к продаже': '准备出库',
  'не продается': '未在售',
  'не продаётся': '未在售',
  'на модерации': '审核中',
  'отклонен': '审核拒绝',
  'отклонён': '审核拒绝',
  'архивный': '已归档',
  'ozon 当前列表未返回': 'Ozon 当前列表未返回',
};

const OZON_MODERATE_STATUS_LABELS: Record<string, string> = {
  approved: '审核通过',
  declined: '审核拒绝',
  failed: '审核失败',
  moderating: '审核中',
  new: '待审核',
};

function translateOzonLabel(value: unknown, labels: Record<string, string>): string | null {
  const raw = String(value || '').trim();
  if (!raw) return null;
  return labels[raw.toLowerCase()] || raw;
}

function normalizeImageList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of value) {
    const image = String(raw || '').trim();
    if (!image || seen.has(image)) continue;
    seen.add(image);
    out.push(image);
  }
  return out;
}

export function resolveOzonProductImages(
  info: { primary_image?: unknown; images?: unknown },
  attributes?: { images?: unknown } | null,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const append = (image: unknown) => {
    const value = String(image || '').trim();
    if (!value || seen.has(value)) return;
    seen.add(value);
    out.push(value);
  };

  append(info.primary_image);
  for (const image of normalizeImageList(attributes?.images)) append(image);
  for (const image of normalizeImageList(info.images)) append(image);
  return out;
}

export function resolveOzonPackageWeightG(attributes?: { weight?: unknown; weight_unit?: unknown } | null): number | null {
  const weight = finiteNumber(attributes?.weight);
  if (weight == null || weight <= 0) return null;
  const unit = String(attributes?.weight_unit || 'g').trim().toLowerCase();
  if (unit === 'g' || unit === 'gram' || unit === 'grams') return Math.round(weight);
  if (unit === 'kg' || unit === 'kilogram' || unit === 'kilograms') return Math.round(weight * 1000);
  return null;
}

export function getProductSyncCategory(meta: unknown): { descriptionCategoryId: number; typeId: number | null } | null {
  const record = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as ProductSyncMeta : {};
  const descriptionCategoryId = positiveInt(record.ozonCategory?.descriptionCategoryId);
  if (!descriptionCategoryId) return null;
  return {
    descriptionCategoryId,
    typeId: positiveInt(record.ozonCategory?.typeId),
  };
}

export function resolveOzonSalesCommissionPercent(item: unknown): number | null {
  const record = item && typeof item === 'object' && !Array.isArray(item) ? item as any : {};
  const commissions = record.commissions;

  if (Array.isArray(commissions)) {
    const fbs = commissions.find((entry) => String(entry?.sale_schema || '').toLowerCase() === 'fbs');
    const first = fbs || commissions[0];
    return finiteNumber(first?.percent);
  }

  if (commissions && typeof commissions === 'object') {
    return finiteNumber((commissions as any).sales_percent_rfbs)
      ?? finiteNumber((commissions as any).sales_percent_fbs)
      ?? finiteNumber((commissions as any).sales_percent_fbo)
      ?? finiteNumber((commissions as any).sales_percent_fbp);
  }

  return null;
}

function getOzonStatusTone(values: unknown[]): OzonStatusTone {
  const text = values.map((value) => String(value || '').trim()).filter(Boolean).join(' ').toLowerCase();
  if (!text) return 'muted';
  if (text.includes('ozon 当前列表未返回') || text.includes('missing')) return 'danger';
  if (text.includes('reject') || text.includes('declined') || text.includes('failed') || text.includes('ошиб') || text.includes('отклон') || text.includes('拒绝') || text.includes('失败')) {
    return 'danger';
  }
  if (text.includes('archived') || text.includes('hidden') || text.includes('архив') || text.includes('已归档') || text.includes('已隐藏')) {
    return 'muted';
  }
  if (text.includes('moder') || text.includes('модерац') || text.includes('провер') || text.includes('审核中') || text.includes('待审核')) {
    return 'warning';
  }
  if (text.includes('готов') || text.includes('ready') || text.includes('准备')) {
    return 'warning';
  }
  if (text.includes('в продаже') || text.includes('прода') || text.includes('active') || text.includes('visible') || text.includes('sale') || text.includes('在售')) {
    return 'success';
  }
  if (text.includes('price_sent') || text.includes('价格已发送')) return 'info';
  return 'muted';
}

export function buildProductSyncMeta(
  info: {
    barcodes?: unknown;
    sku?: unknown;
    statuses?: ProductSyncMeta['ozonStatus'];
    description_category_id?: unknown;
    type_id?: unknown;
  },
  stocks: ProductSyncMeta['ozonStocks'] = [],
): ProductSyncMeta {
  const descriptionCategoryId = positiveInt(info.description_category_id);
  const typeId = positiveInt(info.type_id);
  return {
    ozonBarcodes: Array.isArray(info.barcodes) ? [...new Set(info.barcodes.filter((code): code is string => typeof code === 'string' && /^\d{8,32}$/u.test(code)))] : [],
    ozonStatus: info.statuses || null,
    ozonStocks: Array.isArray(stocks) ? stocks : [],
    ozonCategory: descriptionCategoryId ? { descriptionCategoryId, typeId: typeId ?? undefined } : null,
    ozonSyncedAt: new Date().toISOString(),
  };
}

export function getOzonStatusDisplay(meta: unknown, fallbackStatus?: string | null): {
  name: string | null;
  description: string | null;
  moderateStatus: string | null;
  tone: OzonStatusTone;
} {
  const record = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as ProductSyncMeta : {};
  const status = record.ozonStatus || {};
  const rawName = status.status_name || status.status || fallbackStatus || null;
  const name = translateOzonLabel(rawName, OZON_STATUS_LABELS);
  const description = translateOzonLabel(status.status_description, OZON_STATUS_LABELS);
  const moderateStatus = translateOzonLabel(status.moderate_status, OZON_MODERATE_STATUS_LABELS);
  return {
    name,
    description,
    moderateStatus,
    tone: getOzonStatusTone([
      rawName,
      name,
      status.status,
      status.status_failed,
      status.moderate_status,
      moderateStatus,
      fallbackStatus,
    ]),
  };
}

export function getWarehouseStock(meta: unknown, warehouseId: string | number | null | undefined): number | null {
  if (warehouseId == null || warehouseId === '') return null;
  const record = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as ProductSyncMeta : {};
  const stocks = Array.isArray(record.ozonStocks) ? record.ozonStocks : [];
  const stock = stocks.find((item) => String(item.warehouse_id || '') === String(warehouseId));
  if (!stock) return null;
  const present = Number(stock.present) || 0;
  const reserved = Number(stock.reserved) || 0;
  return present + reserved;
}

function finiteNumber(value: unknown): number | null {
  if (value == null || value === '') return null;
  const numeric = typeof value === 'object' && value && 'toString' in value
    ? Number((value as { toString: () => string }).toString())
    : Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function firstFiniteNumber(...values: unknown[]): number | null {
  for (const value of values) {
    const num = finiteNumber(value);
    if (num != null) return num;
  }
  return null;
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return null;
}

function normalizeOzonPriceIndexColor(value: unknown): 'red' | 'yellow' | 'green' | 'unknown' {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return 'unknown';
  if (text.includes('red') || text.includes('unprofitable') || text.includes('negative')) return 'red';
  if (text.includes('yellow') || text.includes('average') || text.includes('medium')) return 'yellow';
  if (text.includes('green') || text.includes('profitable') || text.includes('positive')) return 'green';
  return 'unknown';
}

function resolveCompetitorPriceData(indexData: Record<string, unknown>): { price: number | null; currency: string | null } {
  const sources = [
    asRecord(indexData.external_index_data),
    asRecord(indexData.ozon_index_data),
    asRecord(indexData.self_marketplaces_index_data),
    indexData,
  ];
  let price: number | null = null;
  let currency: string | null = null;
  for (const source of sources) {
    const candidate = firstFiniteNumber(
      source.minimal_price,
      source.min_price,
      source.competitor_min_price,
      source.market_min_price,
    );
    if (candidate != null && candidate > 0 && (price == null || candidate < price)) {
      price = candidate;
      currency = firstString(
        source.minimal_price_currency,
        source.min_price_currency,
        source.currency_code,
        source.currency,
      );
    }
  }
  return { price, currency };
}

export function resolveOzonPriceIndexSnapshot(item: unknown): ProductSyncMeta['ozonPrice'] {
  const record = asRecord(item);
  const price = asRecord(record.price);
  const indexData = asRecord(record.price_indexes ?? record.price_index);
  const currentPrice = firstFiniteNumber(price.price, record.price);
  const marketingPrice = firstFiniteNumber(
    price.marketing_price,
    price.marketing_seller_price,
    price.auto_action_enabled_price,
    record.marketing_price,
  );
  const color = normalizeOzonPriceIndexColor(firstString(
    indexData.color_index,
    indexData.price_index,
    indexData.index,
    asRecord(indexData.external_index_data).price_index,
    asRecord(indexData.ozon_index_data).price_index,
    asRecord(indexData.self_marketplaces_index_data).price_index,
  ));
  const competitor = resolveCompetitorPriceData(indexData);
  let tier: ProductProfitTier = 'unknown';
  if (color === 'red') tier = 'unprofitable';
  else if (color === 'yellow') tier = 'medium';
  else if (color === 'green') {
    tier = competitor.price != null && currentPrice != null && currentPrice > 0 && currentPrice <= competitor.price * 0.9
      ? 'very_profitable'
      : 'profitable';
  }
  return {
    tier,
    color,
    currentPrice,
    marketingPrice,
    competitorMinPrice: competitor.price,
    competitorCurrency: competitor.currency ?? firstString(price.currency_code, record.currency_code),
    rawIndex: Object.keys(indexData).length ? indexData : null,
    syncedAt: new Date().toISOString(),
  };
}

export function getOzonPriceIndexSnapshot(meta: unknown): ProductSyncMeta['ozonPrice'] {
  const record = asRecord(meta) as ProductSyncMeta;
  return record.ozonPrice && typeof record.ozonPrice === 'object' ? record.ozonPrice : null;
}

export function mergeProductOzonPriceMeta(meta: unknown, item: unknown): Record<string, unknown> {
  const base = asRecord(meta) as ProductSyncMeta;
  return {
    ...base,
    ozonPrice: resolveOzonPriceIndexSnapshot(item),
  };
}

const DEFAULT_RUB_TO_CNY_RATE = 0.095;

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function currencyToCnyRate(currency: unknown, rubToCnyRate?: number): number | null {
  const code = String(currency || 'RUB').trim().toUpperCase();
  if (code === 'CNY') return 1;
  if (code === 'RUB' || code === 'RUR') return rubToCnyRate && rubToCnyRate > 0 ? rubToCnyRate : DEFAULT_RUB_TO_CNY_RATE;
  return null;
}

export function resolveProductProfitSnapshot(
  product: ProductListFilterTarget,
  options: { rubToCnyRate?: number } = {},
): { tier: ProductProfitTier; profitCny: number | null; marginPct: number | null; saleAmountCny: number | null } {
  const price = finiteNumber(product.price);
  const rate = currencyToCnyRate(product.currency, options.rubToCnyRate);
  const buyerCost = finiteNumber(product.buyerPriceCny);
  const saleAmountCny = price != null && rate != null ? price * rate : null;
  if (price == null || price <= 0 || rate == null || buyerCost == null) {
    const existingProfit = finiteNumber(product.profitCny);
    const existingMargin = finiteNumber(product.profitMarginPct);
    if (existingMargin != null) {
      return {
        tier: tierFromMargin(existingMargin, existingProfit),
        profitCny: existingProfit != null ? round2(existingProfit) : null,
        marginPct: round2(existingMargin),
        saleAmountCny: saleAmountCny != null ? round2(saleAmountCny) : null,
      };
    }
    return { tier: 'unknown', profitCny: null, marginPct: null, saleAmountCny: saleAmountCny != null ? round2(saleAmountCny) : null };
  }

  const currentSaleAmountCny = price * rate;
  const commissionRate = Math.max(0, finiteNumber(product.commissionRate) ?? 0);
  const commissionCny = currentSaleAmountCny * commissionRate / 100;
  const profitCny = currentSaleAmountCny - commissionCny - buyerCost;
  const marginPct = currentSaleAmountCny > 0 ? profitCny / currentSaleAmountCny * 100 : null;

  return {
    tier: tierFromMargin(marginPct, profitCny),
    profitCny: round2(profitCny),
    marginPct: marginPct == null ? null : round2(marginPct),
    saleAmountCny: round2(currentSaleAmountCny),
  };
}

function tierFromMargin(marginPct: number | null, profitCny: number | null): ProductProfitTier {
  if (profitCny != null && profitCny < 0) return 'unprofitable';
  if (marginPct == null) return 'unknown';
  if (marginPct < 0) return 'unprofitable';
  if (marginPct < 20) return 'medium';
  if (marginPct < 40) return 'profitable';
  return 'very_profitable';
}

function matchesRange(value: unknown, min?: number | null, max?: number | null): boolean {
  if (min == null && max == null) return true;
  const numeric = finiteNumber(value);
  if (numeric == null) return false;
  if (min != null && numeric < min) return false;
  if (max != null && numeric > max) return false;
  return true;
}

export function matchesProductListComputedFilters(
  product: ProductListFilterTarget,
  filters: ProductListComputedFilters,
): boolean {
  if (!matchesRange(product.price, filters.priceMin, filters.priceMax)) return false;
  if (!matchesRange(product.weight, filters.weightMin, filters.weightMax)) return false;

  const warehouseStock = filters.warehouseId ? getWarehouseStock(product.variants, filters.warehouseId) : null;
  const stockForRange = warehouseStock == null ? product.stock : warehouseStock;
  if (!matchesRange(stockForRange, filters.stockMin, filters.stockMax)) return false;

  if (filters.profitFilter && filters.profitFilter !== 'all') {
    const snapshot = resolveProductProfitSnapshot(product, { rubToCnyRate: filters.rubToCnyRate });
    if (snapshot.tier !== filters.profitFilter) return false;
  }

  if (filters.ozonPriceIndexFilter && filters.ozonPriceIndexFilter !== 'all') {
    const snapshot = getOzonPriceIndexSnapshot(product.variants);
    const tier = snapshot?.tier ?? 'unknown';
    if (tier !== filters.ozonPriceIndexFilter) return false;
  }

  if (filters.warehouseStockMode === 'in_stock') return warehouseStock != null && warehouseStock > 0;
  if (filters.warehouseStockMode === 'out_of_stock') return warehouseStock == null || warehouseStock <= 0;
  return true;
}

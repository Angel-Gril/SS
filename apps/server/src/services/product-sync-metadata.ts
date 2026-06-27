export interface ProductSyncMeta {
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
  ozonSyncedAt?: string;
}

export type OzonStatusTone = 'success' | 'warning' | 'danger' | 'muted' | 'info';
export type WarehouseStockMode = 'all' | 'in_stock' | 'out_of_stock';

export interface ProductListComputedFilters {
  priceMin?: number | null;
  priceMax?: number | null;
  weightMin?: number | null;
  weightMax?: number | null;
  stockMin?: number | null;
  stockMax?: number | null;
  warehouseId?: string | number | null;
  warehouseStockMode?: WarehouseStockMode;
}

interface ProductListFilterTarget {
  price?: unknown;
  weight?: unknown;
  stock?: unknown;
  variants?: unknown;
}

export function normalizeOzonSku(value: unknown): string | null {
  const sku = String(value ?? '').trim();
  if (!sku || sku === '0') return null;
  return sku;
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

export function buildProductSyncMeta(info: { statuses?: ProductSyncMeta['ozonStatus'] }, stocks: ProductSyncMeta['ozonStocks'] = []): ProductSyncMeta {
  return {
    ozonStatus: info.statuses || null,
    ozonStocks: Array.isArray(stocks) ? stocks : [],
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

  if (filters.warehouseStockMode === 'in_stock') return warehouseStock != null && warehouseStock > 0;
  if (filters.warehouseStockMode === 'out_of_stock') return warehouseStock == null || warehouseStock <= 0;
  return true;
}

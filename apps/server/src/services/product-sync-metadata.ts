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
} {
  const record = meta && typeof meta === 'object' && !Array.isArray(meta) ? meta as ProductSyncMeta : {};
  const status = record.ozonStatus || {};
  const rawName = status.status_name || status.status || fallbackStatus || null;
  return {
    name: translateOzonLabel(rawName, OZON_STATUS_LABELS),
    description: translateOzonLabel(status.status_description, OZON_STATUS_LABELS),
    moderateStatus: translateOzonLabel(status.moderate_status, OZON_MODERATE_STATUS_LABELS),
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

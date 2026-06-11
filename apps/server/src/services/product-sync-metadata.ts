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
  return {
    name: status.status_name || fallbackStatus || null,
    description: status.status_description || null,
    moderateStatus: status.moderate_status || null,
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

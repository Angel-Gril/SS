export interface SupplyGoodsExportFilters {
  id?: string | null;
  search?: string | null;
  status?: string | null;
  sourcePlatform?: string | null;
}

export function buildSupplyGoodsExportPath(filters: SupplyGoodsExportFilters = {}): string {
  const params = new URLSearchParams();
  for (const key of ['id', 'search', 'status', 'sourcePlatform'] as const) {
    const value = filters[key]?.trim();
    if (value) params.set(key, value);
  }

  const query = params.toString();
  return query ? `/api/supply/export?${query}` : '/api/supply/export';
}

export function buildSupplyGoodsExportFilename(date = new Date()): string {
  return `supply-goods-${date.toISOString().slice(0, 10)}.csv`;
}

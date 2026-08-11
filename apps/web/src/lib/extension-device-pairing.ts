export function equalStringSets(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

export interface AutoConnectShopCandidate {
  id: string;
  platform: string;
  status?: string;
}

export function singleActiveOzonShopIds(shops: readonly AutoConnectShopCandidate[]): string[] {
  const shopIds = [...new Set(shops
    .filter((shop) => shop.platform === 'OZON' && shop.status === 'ACTIVE')
    .map((shop) => String(shop.id || '').trim())
    .filter(Boolean))].sort();
  return shopIds.length === 1 ? shopIds : [];
}

export function equalStringSets(left: readonly string[], right: readonly string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return leftSet.size === rightSet.size && [...leftSet].every((value) => rightSet.has(value));
}

export function extensionPairingSelectionLocked(input: {
  connecting: boolean;
  pairingBusy: boolean;
  hasPairingCode: boolean;
  loadingContext: boolean;
  extensionConnection: 'checking' | 'unavailable' | 'unpaired' | 'paired' | 'error';
  currentSessionId: string;
  hydratedSessionId: string;
}): boolean {
  if (input.connecting || input.pairingBusy || input.hasPairingCode || input.loadingContext) {
    return true;
  }
  if (input.extensionConnection === 'checking') return true;
  return input.extensionConnection === 'paired'
    && (!input.currentSessionId || input.hydratedSessionId !== input.currentSessionId);
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

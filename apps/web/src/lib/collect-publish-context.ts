export interface CollectPublishSourceItem {
  sourcePlatform?: string | null;
  sourceUrl?: string | null;
  metadata?: Record<string, unknown> | null;
}

export function isOzonCollectedSource(item: CollectPublishSourceItem | null | undefined): boolean {
  if (!item) return false;
  const platform = String(item.sourcePlatform || item.metadata?.sourcePlatform || '').trim().toLowerCase();
  if (platform === 'ozon' || platform.includes('ozon')) return true;

  const rawUrl = String(item.sourceUrl || item.metadata?.sourceUrl || '').trim();
  if (!rawUrl) return false;
  try {
    const host = new URL(rawUrl).hostname.toLowerCase();
    return host === 'ozon.ru'
      || host === 'www.ozon.ru'
      || host.endsWith('.ozon.ru')
      || host === 'ozon.kz'
      || host === 'www.ozon.kz'
      || host.endsWith('.ozon.kz')
      || host === 'ozon.by'
      || host === 'www.ozon.by'
      || host.endsWith('.ozon.by');
  } catch {
    return /\bozon\.(?:ru|kz|by)\b/i.test(rawUrl);
  }
}

export function shouldHideManualOzonCategoryControls(items: CollectPublishSourceItem[]): boolean {
  return items.length > 0 && items.every(isOzonCollectedSource);
}

export function shouldDefaultUseItemCategoryForPublish(items: CollectPublishSourceItem[]): boolean {
  return shouldHideManualOzonCategoryControls(items);
}

export function shouldRequireManualOzonCategory(items: CollectPublishSourceItem[]): boolean {
  return !shouldHideManualOzonCategoryControls(items);
}

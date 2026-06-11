export function normalizePlatformProductId(value: unknown): string | null {
  const id = String(value ?? '').trim();
  return id ? id : null;
}

export function getMissingPlatformProductIds(
  localPlatformProductIds: unknown[],
  syncedPlatformProductIds: Iterable<unknown>,
): string[] {
  const synced = new Set<string>();
  for (const raw of syncedPlatformProductIds) {
    const id = normalizePlatformProductId(raw);
    if (id) synced.add(id);
  }

  const missing: string[] = [];
  const seenLocal = new Set<string>();
  for (const raw of localPlatformProductIds) {
    const id = normalizePlatformProductId(raw);
    if (!id || seenLocal.has(id) || synced.has(id)) continue;
    seenLocal.add(id);
    missing.push(id);
  }
  return missing;
}

export function parseOzonDate(value: unknown): Date | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

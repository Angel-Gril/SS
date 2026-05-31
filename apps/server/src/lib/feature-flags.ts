import { getConfig, validateKey } from '../config/system-config-schema.js';

const cache = new Map<string, { value: boolean; expiry: number }>();
const CACHE_TTL_MS = 10_000;

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const fullKey = key.startsWith('feature_') ? key : `feature_${key}`;
  const now = Date.now();
  const cached = cache.get(fullKey);
  if (cached && now < cached.expiry) return cached.value;

  if (!validateKey(fullKey)) {
    cache.set(fullKey, { value: false, expiry: now + CACHE_TTL_MS });
    return false;
  }

  const enabled = await getConfig(fullKey);
  cache.set(fullKey, { value: Boolean(enabled), expiry: now + CACHE_TTL_MS });
  return Boolean(enabled);
}

export function invalidateFeatureCache(key?: string) {
  if (key) {
    const fullKey = key.startsWith('feature_') ? key : `feature_${key}`;
    cache.delete(fullKey);
  } else {
    cache.clear();
  }
}

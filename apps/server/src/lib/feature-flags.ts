import { prisma } from './prisma.js';

const cache = new Map<string, { value: boolean; expiry: number }>();
const CACHE_TTL_MS = 10_000;

export async function isFeatureEnabled(key: string): Promise<boolean> {
  const fullKey = key.startsWith('feature_') ? key : `feature_${key}`;
  const now = Date.now();
  const cached = cache.get(fullKey);
  if (cached && now < cached.expiry) return cached.value;

  const cfg = await prisma.systemConfig.findUnique({
    where: { key: fullKey },
    select: { value: true },
  });
  const enabled = cfg?.value === 'true';
  cache.set(fullKey, { value: enabled, expiry: now + CACHE_TTL_MS });
  return enabled;
}

export function invalidateFeatureCache(key?: string) {
  if (key) {
    const fullKey = key.startsWith('feature_') ? key : `feature_${key}`;
    cache.delete(fullKey);
  } else {
    cache.clear();
  }
}

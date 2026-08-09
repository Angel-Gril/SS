import { createHash } from 'node:crypto';

import { canonicalStringify, type OzonListingDraft } from 'shared';

const DEFAULT_TTL_MS = 45_000;
const DEFAULT_MAX_ENTRIES = 64;
const MIN_TTL_MS = 1_000;
const MAX_TTL_MS = 5 * 60_000;
const MAX_ENTRIES_LIMIT = 1_024;

export interface OzonListingProductionCompileInput {
  ownerUserId: string;
  draft: OzonListingDraft;
}

interface CacheEntry<T> {
  promise: Promise<T>;
  settled: boolean;
  expiresAt: number;
}

function cacheKey(input: OzonListingProductionCompileInput): string {
  const {
    revision: _revision,
    stage: _stage,
    publishTaskIds: _publishTaskIds,
    auditEvents: _auditEvents,
    updatedAt: _updatedAt,
    ...authorityDraft
  } = input.draft;
  return createHash('sha256').update(canonicalStringify({
    ownerUserId: input.ownerUserId,
    draft: authorityDraft,
  })).digest('hex');
}

function positiveInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
  label: string,
): number {
  const parsed = value == null ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} is invalid`);
  }
  return parsed;
}

export function createOzonListingProductionCompileCache<T>(options: {
  compile(input: OzonListingProductionCompileInput): Promise<T>;
  now?: () => number;
  ttlMs?: number;
  maxEntries?: number;
}) {
  const ttlMs = positiveInteger(
    options.ttlMs,
    DEFAULT_TTL_MS,
    MIN_TTL_MS,
    MAX_TTL_MS,
    'Production compile cache TTL',
  );
  const maxEntries = positiveInteger(
    options.maxEntries,
    DEFAULT_MAX_ENTRIES,
    1,
    MAX_ENTRIES_LIMIT,
    'Production compile cache capacity',
  );
  const now = options.now || Date.now;
  const entries = new Map<string, CacheEntry<T>>();

  function currentTime(): number {
    const value = now();
    if (!Number.isFinite(value) || value < 0) {
      throw new Error('Production compile cache clock is invalid');
    }
    return value;
  }

  function touch(key: string, entry: CacheEntry<T>): void {
    entries.delete(key);
    entries.set(key, entry);
  }

  function prune(at: number): void {
    for (const [key, entry] of entries) {
      if (entry.settled && entry.expiresAt <= at) entries.delete(key);
    }
  }

  function reserveCapacity(): void {
    while (entries.size >= maxEntries) {
      const settled = [...entries].find(([, entry]) => entry.settled);
      if (!settled) {
        throw new Error('Production compile cache capacity is exhausted');
      }
      entries.delete(settled[0]);
    }
  }

  return async function compileWithAuthoritySnapshot(
    input: OzonListingProductionCompileInput,
  ): Promise<T> {
    const at = currentTime();
    const snapshot = structuredClone(input);
    const key = cacheKey(snapshot);
    prune(at);
    const existing = entries.get(key);
    if (existing) {
      touch(key, existing);
      return structuredClone(await existing.promise);
    }

    reserveCapacity();
    const entry: CacheEntry<T> = {
      promise: Promise.resolve(undefined as T),
      settled: false,
      expiresAt: Number.POSITIVE_INFINITY,
    };
    entry.promise = Promise.resolve()
      .then(() => options.compile(structuredClone(snapshot)))
      .then((value) => {
        entry.settled = true;
        entry.expiresAt = currentTime() + ttlMs;
        return structuredClone(value);
      })
      .catch((error) => {
        if (entries.get(key) === entry) entries.delete(key);
        throw error;
      });
    entries.set(key, entry);
    return structuredClone(await entry.promise);
  };
}

export async function preflightOzonListingProductionCompile<T>(
  compile: (input: OzonListingProductionCompileInput) => Promise<T>,
  input: OzonListingProductionCompileInput,
): Promise<void> {
  const snapshot = structuredClone(input);
  if (snapshot.draft.stage !== 'READY_TO_PUBLISH') {
    throw new Error('Production compile preflight requires a ready draft');
  }
  snapshot.draft.stage = 'PUBLISH_INTENT_RECORDED';
  await compile(snapshot);
}

import { describe, expect, it } from 'vitest';
import {
  getCachedOzonAttributeValues,
  type OzonAttributeDictionaryCacheStore,
  type OzonAttributeDictionaryEntry,
} from '../services/ozon-attribute-dictionary-cache.js';

type CacheRecord = Awaited<ReturnType<OzonAttributeDictionaryCacheStore['find']>>;

function cacheKey(params: {
  description_category_id: number;
  type_id: number;
  attribute_id: number;
  language?: string;
}) {
  return [
    params.description_category_id,
    params.type_id,
    params.attribute_id,
    params.language || 'DEFAULT',
  ].join(':');
}

function createMemoryStore(initial: Record<string, NonNullable<CacheRecord>> = {}): OzonAttributeDictionaryCacheStore {
  const records = new Map<string, NonNullable<CacheRecord>>(Object.entries(initial));
  return {
    async find(params) {
      return records.get(cacheKey(params)) || null;
    },
    async upsert(params, record) {
      records.set(cacheKey(params), record);
    },
  };
}

const params = {
  description_category_id: 17028706,
  type_id: 95913,
  attribute_id: 10096,
  language: 'DEFAULT',
};

const dict: OzonAttributeDictionaryEntry[] = [
  { id: 101, value: 'белый' },
  { id: 102, value: 'бежевый' },
];

describe('ozon attribute dictionary cache', () => {
  it('uses fresh persisted cache without calling Ozon API', async () => {
    let apiCalls = 0;
    const now = new Date('2026-06-20T00:00:00.000Z');
    const store = createMemoryStore({
      [cacheKey(params)]: {
        values: dict,
        valuesHash: 'cached-hash',
        fetchedAt: new Date('2026-06-19T00:00:00.000Z'),
        expiresAt: new Date('2026-06-21T00:00:00.000Z'),
        source: 'ozon_api',
      },
    });

    const result = await getCachedOzonAttributeValues(params, {
      store,
      now: () => now,
      fetchValues: async () => {
        apiCalls += 1;
        return [];
      },
    });

    expect(result).toMatchObject({ source: 'cache', values: dict });
    expect(apiCalls).toBe(0);
  });

  it('fetches from Ozon once and persists values for later calls', async () => {
    let apiCalls = 0;
    const now = new Date('2026-06-20T00:00:00.000Z');
    const store = createMemoryStore();

    const first = await getCachedOzonAttributeValues(params, {
      store,
      now: () => now,
      fetchValues: async () => {
        apiCalls += 1;
        return dict;
      },
    });
    const second = await getCachedOzonAttributeValues(params, {
      store,
      now: () => new Date('2026-06-20T01:00:00.000Z'),
      fetchValues: async () => {
        apiCalls += 1;
        return [];
      },
    });

    expect(first).toMatchObject({ source: 'ozon_api', values: dict });
    expect(second).toMatchObject({ source: 'cache', values: dict });
    expect(apiCalls).toBe(1);
  });

  it('falls back to expired cache when Ozon API is unavailable', async () => {
    const now = new Date('2026-06-20T00:00:00.000Z');
    const store = createMemoryStore({
      [cacheKey(params)]: {
        values: dict,
        valuesHash: 'expired-hash',
        fetchedAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        source: 'ozon_api',
      },
    });

    const result = await getCachedOzonAttributeValues(params, {
      store,
      now: () => now,
      fetchValues: async () => {
        throw new Error('Ozon unavailable');
      },
    });

    expect(result).toMatchObject({
      source: 'stale-cache',
      values: dict,
      warning: 'Ozon unavailable',
    });
  });

  it('still fetches from Ozon when the persistent cache store is unavailable', async () => {
    let apiCalls = 0;
    const store: OzonAttributeDictionaryCacheStore = {
      async find() {
        throw new Error('cache table missing');
      },
      async upsert() {
        throw new Error('cache table missing');
      },
    };

    const result = await getCachedOzonAttributeValues(params, {
      store,
      fetchValues: async () => {
        apiCalls += 1;
        return dict;
      },
    });

    expect(result).toMatchObject({ source: 'ozon_api', values: dict });
    expect(apiCalls).toBe(1);
  });
});

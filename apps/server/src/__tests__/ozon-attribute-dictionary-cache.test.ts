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

const versionedParams = {
  ...params,
  catalogRevision: 'catalog-v7',
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

  it('bypasses a fresh cache when an authoritative refresh is required', async () => {
    let apiCalls = 0;
    const now = new Date('2026-06-20T00:00:00.000Z');
    const store = createMemoryStore({
      [cacheKey(params)]: {
        values: dict,
        valuesHash: 'cached-hash',
        fetchedAt: new Date('2026-06-19T00:00:00.000Z'),
        expiresAt: new Date('2026-07-21T00:00:00.000Z'),
        source: 'ozon_api',
        complete: true,
        catalogRevision: 'catalog-v7',
        pageCount: 1,
        finalCursor: 102,
      },
    });
    const refreshed = [{ id: 103, value: 'черный' }];

    const result = await getCachedOzonAttributeValues(versionedParams, {
      store,
      now: () => now,
      forceRefresh: true,
      fetchPage: async () => {
        apiCalls += 1;
        return { values: refreshed, hasNext: false, nextCursor: 103 };
      },
    });

    expect(result).toMatchObject({ source: 'ozon_api', values: refreshed, complete: true });
    expect(apiCalls).toBe(1);
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

  it('commits a versioned cache record only after every page is complete', async () => {
    const upserts: NonNullable<CacheRecord>[] = [];
    const pageCursors: number[] = [];
    const store: OzonAttributeDictionaryCacheStore = {
      async find() {
        return null;
      },
      async upsert(_params, record) {
        upserts.push(record);
      },
    };

    const result = await getCachedOzonAttributeValues(versionedParams, {
      store,
      fetchPage: async (page) => {
        pageCursors.push(page.last_value_id);
        return page.last_value_id === 0
          ? { values: dict, hasNext: true, nextCursor: 102 }
          : { values: [{ id: 102, value: 'бежевый' }, { id: 103, value: 'черный' }], hasNext: false, nextCursor: 103 };
      },
      pageSize: 2,
    });

    expect(result).toMatchObject({
      source: 'ozon_api',
      values: [...dict, { id: 103, value: 'черный' }],
      complete: true,
      catalogRevision: 'catalog-v7',
      pageCount: 2,
      finalCursor: 103,
    });
    expect(pageCursors).toEqual([0, 102]);
    expect(upserts).toEqual([expect.objectContaining({
      complete: true,
      catalogRevision: 'catalog-v7',
      pageCount: 2,
      finalCursor: 103,
    })]);
  });

  it('does not commit a partial refresh when a later page fails', async () => {
    let pageCalls = 0;
    let upsertCalls = 0;
    const store: OzonAttributeDictionaryCacheStore = {
      async find() {
        return null;
      },
      async upsert() {
        upsertCalls += 1;
      },
    };

    await expect(getCachedOzonAttributeValues(versionedParams, {
      store,
      fetchPage: async () => {
        pageCalls += 1;
        if (pageCalls === 1) return { values: dict, hasNext: true, nextCursor: 102 };
        throw new Error('second page unavailable');
      },
      pageSize: 2,
    })).rejects.toThrow('second page unavailable');

    expect(pageCalls).toBe(2);
    expect(upsertCalls).toBe(0);
  });

  it('falls back to an expired complete cache from the requested catalog revision', async () => {
    const now = new Date('2026-06-20T00:00:00.000Z');
    const store = createMemoryStore({
      [cacheKey(params)]: {
        values: dict,
        valuesHash: 'expired-hash',
        fetchedAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        source: 'ozon_api',
        complete: true,
        catalogRevision: 'catalog-v7',
        pageCount: 1,
        finalCursor: 102,
      },
    });

    const result = await getCachedOzonAttributeValues(versionedParams, {
      store,
      now: () => now,
      fetchPage: async () => {
        throw new Error('Ozon unavailable');
      },
    });

    expect(result).toMatchObject({
      source: 'stale-cache',
      values: dict,
      warning: 'Ozon unavailable',
    });
  });

  it('rejects an expired cache from a different catalog revision', async () => {
    const store = createMemoryStore({
      [cacheKey(params)]: {
        values: dict,
        valuesHash: 'expired-hash',
        fetchedAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        source: 'ozon_api',
        complete: true,
        catalogRevision: 'catalog-v6',
        pageCount: 1,
        finalCursor: 102,
      },
    });

    await expect(getCachedOzonAttributeValues(versionedParams, {
      store,
      now: () => new Date('2026-06-20T00:00:00.000Z'),
      fetchPage: async () => {
        throw new Error('Ozon unavailable');
      },
    })).rejects.toThrow('Ozon unavailable');
  });

  it('rejects an expired incomplete cache from the requested catalog revision', async () => {
    const store = createMemoryStore({
      [cacheKey(params)]: {
        values: dict,
        valuesHash: 'partial-hash',
        fetchedAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        source: 'ozon_api',
        complete: false,
        catalogRevision: 'catalog-v7',
        pageCount: 1,
        finalCursor: 102,
      },
    });

    await expect(getCachedOzonAttributeValues(versionedParams, {
      store,
      now: () => new Date('2026-06-20T00:00:00.000Z'),
      fetchPage: async () => {
        throw new Error('Ozon unavailable');
      },
    })).rejects.toThrow('Ozon unavailable');
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

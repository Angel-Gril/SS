import { describe, expect, it, vi } from 'vitest';
import {
  createPrismaOzonAttributeDefinitionCacheStore,
  getCachedOzonAttributeDefinitions,
  OzonAttributeDefinitionsRequiredError,
  type OzonAttributeDefinitionCacheRecord,
  type OzonAttributeDefinitionCacheStore,
} from '../services/ozon-attribute-definition-cache.js';

const key = {
  shopId: 'shop-1',
  descriptionCategoryId: 17028706,
  typeId: 95913,
  language: 'DEFAULT',
  catalogRevision: 'catalog-v7',
};

const normalizedDefinitions = [
  {
    id: 10,
    name: 'Brand',
    description: 'Required brand',
    type: 'String',
    isCollection: false,
    isRequired: true,
    dictionaryId: 100,
  },
  {
    id: 20,
    name: 'Color',
    description: '',
    type: 'String',
    isCollection: true,
    isRequired: false,
    dictionaryId: null,
  },
];

function record(overrides: Partial<OzonAttributeDefinitionCacheRecord> = {}): OzonAttributeDefinitionCacheRecord {
  return {
    definitions: normalizedDefinitions,
    definitionsHash: '15b7620f75ab145efd951cc81916c8ffc83d25d198433fad7687521f178b845a',
    complete: true,
    fetchedAt: new Date('2026-07-14T00:00:00.000Z'),
    expiresAt: new Date('2026-07-16T00:00:00.000Z'),
    source: 'ozon_api',
    ...overrides,
  };
}

describe('Ozon attribute definition cache', () => {
  it('uses only a fresh complete cache entry from the exact catalog revision', async () => {
    const fetchDefinitions = vi.fn(async () => []);
    const store: OzonAttributeDefinitionCacheStore = {
      find: vi.fn(async () => record()),
      upsert: vi.fn(async () => undefined),
    };

    const result = await getCachedOzonAttributeDefinitions(key, {
      store,
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      fetchDefinitions,
    });

    expect(result).toMatchObject({ source: 'cache', definitions: normalizedDefinitions });
    expect(fetchDefinitions).not.toHaveBeenCalled();
    expect(store.upsert).not.toHaveBeenCalled();
  });

  it('bypasses a fresh definition cache for authoritative validation', async () => {
    const refreshed = [{ ...normalizedDefinitions[0]!, description: 'Updated official definition' }];
    const fetchDefinitions = vi.fn(async () => refreshed);
    const store: OzonAttributeDefinitionCacheStore = {
      find: vi.fn(async () => record()),
      upsert: vi.fn(async () => undefined),
    };

    const result = await getCachedOzonAttributeDefinitions(key, {
      store,
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      forceRefresh: true,
      fetchDefinitions,
    });

    expect(result).toMatchObject({ source: 'ozon_api', definitions: refreshed });
    expect(fetchDefinitions).toHaveBeenCalledTimes(1);
    expect(store.upsert).toHaveBeenCalledTimes(1);
  });

  it('normalizes, stably sorts, hashes and commits one complete official response', async () => {
    const upsert = vi.fn(async () => undefined);
    const fetchDefinitions = vi.fn(async () => [
      {
        id: 20,
        name: '  Color ',
        description: null,
        type: ' String ',
        is_collection: true,
        is_required: false,
      },
      {
        id: 10,
        name: 'Brand',
        description: ' Required   brand ',
        type: 'String',
        is_collection: false,
        is_required: true,
        dictionary_id: 100,
      },
    ]);
    const store: OzonAttributeDefinitionCacheStore = {
      find: vi.fn(async () => null),
      upsert,
    };

    const result = await getCachedOzonAttributeDefinitions(key, {
      store,
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      ttlMs: 60_000,
      fetchDefinitions,
    });

    expect(fetchDefinitions).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      source: 'ozon_api',
      definitions: normalizedDefinitions,
      definitionsHash: '15b7620f75ab145efd951cc81916c8ffc83d25d198433fad7687521f178b845a',
      complete: true,
    });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(key, expect.objectContaining({
      definitions: normalizedDefinitions,
      definitionsHash: '15b7620f75ab145efd951cc81916c8ffc83d25d198433fad7687521f178b845a',
      complete: true,
      expiresAt: new Date('2026-07-15T00:01:00.000Z'),
    }));
  });

  it('uses only a complete exact-revision stale entry when refresh fails', async () => {
    const store: OzonAttributeDefinitionCacheStore = {
      find: vi.fn(async () => record({ expiresAt: new Date('2026-07-14T01:00:00.000Z') })),
      upsert: vi.fn(async () => undefined),
    };

    const result = await getCachedOzonAttributeDefinitions(key, {
      store,
      now: () => new Date('2026-07-15T00:00:00.000Z'),
      fetchDefinitions: async () => {
        throw new Error('Ozon unavailable');
      },
    });

    expect(result).toMatchObject({
      source: 'stale-cache',
      definitions: normalizedDefinitions,
      warning: 'Ozon unavailable',
    });
  });

  it.each([
    ['incomplete', record({ complete: false })],
    ['different revision', record()],
  ])('rejects a %s stale entry when refresh fails', async (kind, cached) => {
    const lookup = kind === 'different revision' ? { ...key, catalogRevision: 'catalog-v8' } : key;
    const store: OzonAttributeDefinitionCacheStore = {
      find: vi.fn(async (requested) => (
        requested.catalogRevision === key.catalogRevision ? cached : null
      )),
      upsert: vi.fn(async () => undefined),
    };

    await expect(getCachedOzonAttributeDefinitions(lookup, {
      store,
      now: () => new Date('2026-07-17T00:00:00.000Z'),
      fetchDefinitions: async () => {
        throw new Error('Ozon unavailable');
      },
    })).rejects.toThrow('Ozon unavailable');
  });

  it('caches an empty official response but blocks domestic-source preparation with a typed error', async () => {
    const upsert = vi.fn(async () => undefined);
    const store: OzonAttributeDefinitionCacheStore = {
      find: vi.fn(async () => null),
      upsert,
    };

    const caught = await getCachedOzonAttributeDefinitions(key, {
      store,
      fetchDefinitions: async () => [],
    }).catch((error) => error);

    expect(caught).toBeInstanceOf(OzonAttributeDefinitionsRequiredError);
    expect(caught).toMatchObject({ code: 'OZON_ATTRIBUTE_DEFINITIONS_REQUIRED', statusCode: 422 });
    expect(upsert).toHaveBeenCalledWith(key, expect.objectContaining({
      definitions: [],
      complete: true,
    }));
  });

  it('allows empty definitions only for an explicitly validated clone/follow flow', async () => {
    const store: OzonAttributeDefinitionCacheStore = {
      find: vi.fn(async () => null),
      upsert: vi.fn(async () => undefined),
    };

    const result = await getCachedOzonAttributeDefinitions(key, {
      store,
      fetchDefinitions: async () => [],
      emptyDefinitionsPolicy: {
        kind: 'validated_clone_follow',
        validationReference: 'clone-validation-1',
      },
    });

    expect(result).toMatchObject({
      source: 'ozon_api',
      definitions: [],
      emptyDefinitionsAllowed: true,
      validationReference: 'clone-validation-1',
    });
  });

  it('uses the planned Prisma delegate and compound cache key', async () => {
    const findUnique = vi.fn(async () => ({
      ...key,
      ...record(),
    }));
    const upsert = vi.fn(async () => undefined);
    const store = createPrismaOzonAttributeDefinitionCacheStore({
      ozonAttributeDefinitionCache: { findUnique, upsert },
    });

    await expect(store.find(key)).resolves.toMatchObject(record());
    await store.upsert(key, record());

    expect(findUnique).toHaveBeenCalledWith({
      where: { ozon_attribute_definition_cache_key: key },
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { ozon_attribute_definition_cache_key: key },
      create: expect.objectContaining(key),
      update: expect.objectContaining({
        definitions: normalizedDefinitions,
        complete: true,
      }),
    }));
  });
});

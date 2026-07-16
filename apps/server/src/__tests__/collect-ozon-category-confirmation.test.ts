import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { collectRoutes, type CollectRoutesOptions } from '../routes/collect.js';
import { buildSourceProductProfile } from '../services/source-product-profile.js';
import { SourceOzonCategoryContextError } from '../services/source-ozon-category-context.js';
import { SourceOzonCategoryMappingError } from '../services/source-ozon-category-mapping.js';
import { OzonCategoryCatalogRefreshError } from '../services/ozon-category-catalog.js';
import { SourceWorkflowOzonCredentialsUnavailableError } from '../services/source-workflow-ozon-client.js';

type PublisherParityObservation = Parameters<
  NonNullable<CollectRoutesOptions['publisherParityObserver']>['observe']
>[0];

const mocks = vi.hoisted(() => ({
  authUser: {
    userId: 'owner-1',
    actorUserId: 'actor-1',
    role: 'STAFF',
    isSuperAdmin: false,
  },
  item: {
    id: 'goods-1',
    userId: 'owner-1',
    title: '女士纯棉 T 恤',
    sourcePlatform: '1688',
    sourceProductId: 'offer-1',
    metadata: {
      categoryPath: ['服装', '女装', 'T恤'],
      categoryName: 'T恤',
      unrelatedConcurrentField: 'keep-me',
    },
    variants: [],
    updatedAt: new Date('2026-07-15T02:00:00.000Z'),
  },
  shop: {
    id: 'shop-1',
    userId: 'owner-1',
    platform: 'OZON',
    clientId: 'client-1',
    apiKeyEncrypted: 'encrypted-key',
  },
  supplyGoodsFindFirst: vi.fn(),
  supplyGoodsFindMany: vi.fn(),
  supplyGoodsUpdate: vi.fn(),
  supplyGoodsUpdateMany: vi.fn(),
  shopFindFirst: vi.fn(),
  queryRaw: vi.fn(),
  getDescriptionCategoryAttributes: vi.fn(),
  decrypt: vi.fn(),
  importBySku: vi.fn(),
  importProducts: vi.fn(),
  syncJobCreate: vi.fn(),
  syncJobFindFirst: vi.fn(),
  syncJobUpdate: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { ...mocks.authUser };
  }),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    supplyGoods: {
      findFirst: mocks.supplyGoodsFindFirst,
      findMany: mocks.supplyGoodsFindMany,
      update: mocks.supplyGoodsUpdate,
      updateMany: mocks.supplyGoodsUpdateMany,
      create: vi.fn(),
      count: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    shop: { findFirst: mocks.shopFindFirst },
    syncJob: {
      findFirst: mocks.syncJobFindFirst,
      findMany: vi.fn(async () => []),
      create: mocks.syncJobCreate,
      update: mocks.syncJobUpdate,
    },
  },
}));

vi.mock('../services/ozon-client.js', () => ({
  OzonClient: class {
    getDescriptionCategoryAttributes = mocks.getDescriptionCategoryAttributes;
    importBySku = mocks.importBySku;
    importProducts = mocks.importProducts;
  },
}));

vi.mock('../lib/crypto.js', () => ({ decrypt: mocks.decrypt }));

vi.mock('../lib/randomize.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/randomize.js')>()),
  getRandomizeConfig: vi.fn(async () => ({
    enabled: false,
    randomOfferId: false,
    dimensionJitterMm: 0,
    dimensionMinMm: 1,
    weightBuckets: [],
  })),
}));

vi.mock('../services/post-publish-sync.js', () => ({
  enqueueProductSyncAfterPublish: vi.fn(async () => undefined),
}));

const canonicalSource = {
  snapshotId: 'snapshot-1',
  profileHash: 'a'.repeat(64),
  sourcePlatform: '1688',
  sourceCategoryId: '1031910',
  sourceCategoryPath: ['服装', '女装', 'T恤'],
};

const canonicalProfile = buildSourceProductProfile({
  id: 'goods-1',
  title: '女士纯棉 T 恤',
  sourcePlatform: '1688',
  sourceProductId: 'offer-1',
  metadata: {
    categoryPath: ['服装', '女装', 'T恤'],
    categoryName: 'T恤',
  },
});

const catalogEntry = {
  descriptionCategoryId: 170001,
  typeId: 91001,
  categoryPathRu: ['Одежда', 'Женская одежда'],
  categoryPathZh: ['服装', '女装'],
  categoryLevels: [],
  categoryNameRu: 'Женская одежда',
  categoryNameZh: '女装',
  typeNameRu: 'Футболки',
  typeNameZh: 'T恤',
  displayPathRu: 'Одежда / Женская одежда / Футболки',
  displayPathZh: '服装 / 女装 / T恤',
  translationStatus: 'complete' as const,
  untranslatedTerms: [],
  keywords: ['T恤', 'футболки'],
  searchText: '服装 女装 t恤 одежда футболки',
  disabled: false,
  selectable: true,
};

function mappingRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mapping-1',
    scope: 'TENANT',
    scopeKey: 'tenant:owner-1',
    ownerUserId: 'owner-1',
    sourcePlatform: '1688',
    sourceCategoryId: '1031910',
    sourceCategoryPath: ['服装', '女装', 't恤'],
    sourceSignature: '49983d66198fa277cfdf7b422ddb02603e2c8dc77854c0ad878bb32cf2e2137d',
    sourceSnapshotId: 'snapshot-1',
    sourceProfileHash: 'a'.repeat(64),
    targetCategoryId: 170001,
    targetTypeId: 91001,
    targetCategoryName: 'Женская одежда',
    targetTypeName: 'Футболки',
    catalogRevision: 'catalog-7',
    status: 'ACTIVE',
    transitionVersion: 4,
    confirmCount: 3,
    rejectCount: 0,
    createdByUserId: 'actor-1',
    updatedByUserId: 'actor-1',
    reviewedByUserId: 'actor-1',
    reviewedAt: '2026-07-15T01:00:00.000Z',
    lastConfirmedAt: '2026-07-15T01:00:00.000Z',
    lastRejectedAt: null,
    promotedFromMappingId: null,
    createdAt: '2026-07-15T01:00:00.000Z',
    updatedAt: '2026-07-15T01:00:00.000Z',
    ...overrides,
  } as any;
}

function publishItem(confirmationOverrides: Record<string, unknown> | null = {}) {
  const sourceOzonCategoryConfirmed = confirmationOverrides === null
    ? undefined
    : {
      version: 'source-ozon-category-confirmed/v2',
      mappingId: 'mapping-1',
      signature: mappingRecord().sourceSignature,
      sourceSnapshotId: 'snapshot-1',
      sourceProfileHash: 'a'.repeat(64),
      categoryId: 170001,
      typeId: 91001,
      catalogRevision: 'catalog-7',
      transitionVersion: 4,
      ...confirmationOverrides,
    };
  return {
    ...mocks.item,
    title: 'Женская хлопковая футболка',
    sku: 'offer-1',
    currency: 'CNY',
    purchasePrice: { toString: () => '100' },
    images: [],
    metadata: {
      ...mocks.item.metadata,
      publishTitleRu: 'Женская хлопковая футболка',
      descriptionCategoryId: 170001,
      typeId: 91001,
      ...(sourceOzonCategoryConfirmed ? { sourceOzonCategoryConfirmed } : {}),
    },
  } as any;
}

function publishDependencies(overrides: Partial<CollectRoutesOptions> = {}): CollectRoutesOptions {
  return dependencies({
    featureFlags: {
      evaluate: vi.fn(async () => ({
        enabled: false,
        legacyAllowed: true,
        captureStage: null,
        reason: 'policy_off' as const,
        revision: 'legacy-publisher-1',
      })),
    },
    sourceListingWorkflowAdapter: {
      prepare: vi.fn(async () => ({ drafts: [], failures: [] })),
    },
    ...overrides,
  });
}

function dependencies(overrides: Partial<CollectRoutesOptions> = {}): CollectRoutesOptions {
  return {
    featureFlags: {
      evaluate: vi.fn(async () => ({
        enabled: true,
        legacyAllowed: false,
        captureStage: null,
        reason: 'global' as const,
        revision: 'mapping-rollout-1',
      })),
    },
    sourceOzonCategoryMappingService: {
      listVisibleMappings: vi.fn(async () => [mappingRecord()]),
      confirmTenantMapping: vi.fn(),
    },
    loadCanonicalSourceOzonCategoryContext: vi.fn(async () => ({
      source: canonicalSource,
      profile: canonicalProfile,
    })),
    loadAuthoritativeOzonCategoryCatalog: vi.fn(async () => ({
      entries: [catalogEntry],
      categoryTree: [],
      catalogRevision: 'catalog-7',
    })),
    ...overrides,
  };
}

async function buildApp(options = dependencies()) {
  const app = Fastify();
  await app.register(collectRoutes, { prefix: '/api/collect', ...options });
  await app.ready();
  return app;
}

describe('collect Ozon category confirmation routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authUser.userId = 'owner-1';
    mocks.authUser.actorUserId = 'actor-1';
    mocks.authUser.role = 'STAFF';
    mocks.authUser.isSuperAdmin = false;
    mocks.supplyGoodsFindFirst.mockResolvedValue({ ...mocks.item });
    mocks.supplyGoodsFindMany.mockResolvedValue([]);
    mocks.supplyGoodsUpdate.mockResolvedValue({ ...mocks.item });
    mocks.supplyGoodsUpdateMany.mockResolvedValue({ count: 1 });
    mocks.shopFindFirst.mockResolvedValue({ ...mocks.shop });
    mocks.queryRaw.mockResolvedValue([{ metadata: mocks.item.metadata }]);
    mocks.importBySku.mockResolvedValue({ result: { task_id: 99, unmatched_sku_list: [] } });
    mocks.importProducts.mockResolvedValue({ result: { task_id: 101 } });
    mocks.syncJobCreate.mockResolvedValue({ id: 'sync-job-1' });
    mocks.syncJobFindFirst.mockResolvedValue(null);
    mocks.syncJobUpdate.mockResolvedValue({ id: 'sync-job-existing' });
    mocks.getDescriptionCategoryAttributes.mockResolvedValue([{
      id: 10096,
      name: 'Цвет товара',
      description: '',
      type: 'String',
      is_collection: true,
      is_required: false,
      dictionary_id: 200,
    }]);
    mocks.decrypt.mockReturnValue('api-key');
  });

  it('reads V2 history from the owned canonical capture and authoritative catalog', async () => {
    const options = dependencies();
    const app = await buildApp(options);

    const response = await app.inject({
      method: 'GET',
      url: '/api/collect/goods-1/ozon-category-candidates?shopId=shop-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        signature: mappingRecord().sourceSignature,
        sourceSnapshotId: 'snapshot-1',
        sourceProfileHash: 'a'.repeat(64),
        catalogRevision: 'catalog-7',
        historyMode: 'v2',
        candidates: [{
          categoryId: 170001,
          typeId: 91001,
          confirmationCount: 3,
          transitionVersion: 4,
        }],
      },
    });
    expect(options.featureFlags?.evaluate).toHaveBeenCalledWith('SOURCE_OZON_MAPPING_V2_READ', {
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      platform: 'OZON',
    });
    expect(options.loadCanonicalSourceOzonCategoryContext).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      supplyGoodsId: 'goods-1',
    });
    expect(options.sourceOzonCategoryMappingService?.listVisibleMappings).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      source: canonicalSource,
    });

    await app.close();
  });

  it('confirms with the effective owner, real actor, and server-owned catalog values', async () => {
    const confirmTenantMapping = vi.fn(async () => ({
      mapping: mappingRecord({
        transitionVersion: 5,
        lastConfirmedAt: '2026-07-15T03:00:00.000Z',
        updatedAt: '2026-07-15T03:00:00.000Z',
      }),
      idempotent: false,
    }));
    const options = dependencies({
      sourceOzonCategoryMappingService: {
        listVisibleMappings: vi.fn(async () => []),
        confirmTenantMapping,
      },
    });
    const app = await buildApp(options);

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/goods-1/ozon-category-confirm',
      payload: {
        shopId: 'shop-1',
        categoryId: 170001,
        typeId: 91001,
        expectedCatalogRevision: 'catalog-7',
        expectedTransitionVersion: 4,
        signature: 'forged-signature',
        categoryName: 'Forged category',
        typeName: 'Forged type',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(confirmTenantMapping).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedTransitionVersion: 4,
      source: canonicalSource,
      target: {
        categoryId: 170001,
        typeId: 91001,
        categoryName: 'Женская одежда',
        typeName: 'Футболки',
        catalogRevision: 'catalog-7',
      },
    });
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        signature: mappingRecord().sourceSignature,
        categoryName: 'Женская одежда',
        typeName: 'Футболки',
        transitionVersion: 5,
        idempotent: false,
        metadataPatch: {
          descriptionCategoryId: 170001,
          typeId: 91001,
          sourceOzonCategoryConfirmed: {
            signature: mappingRecord().sourceSignature,
            categoryName: 'Женская одежда',
            typeName: 'Футболки',
            actorUserId: 'actor-1',
          },
        },
      },
    });
    expect(JSON.stringify(response.json())).not.toContain('Forged');
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('fails closed when V2 read is enabled but the owned canonical capture is missing', async () => {
    const options = dependencies({
      loadCanonicalSourceOzonCategoryContext: vi.fn(async () => null),
    });
    const app = await buildApp(options);

    const response = await app.inject({
      method: 'GET',
      url: '/api/collect/goods-1/ozon-category-candidates?shopId=shop-1',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'source_capture_v2_required',
    });
    expect(options.sourceOzonCategoryMappingService?.listVisibleMappings).not.toHaveBeenCalled();

    await app.close();
  });

  it('maps an invalid canonical capture to a recoverable conflict instead of an internal error', async () => {
    const options = dependencies({
      loadCanonicalSourceOzonCategoryContext: vi.fn(async () => {
        throw new SourceOzonCategoryContextError('Canonical source category profile is invalid');
      }),
    });
    const app = await buildApp(options);

    const response = await app.inject({
      method: 'GET',
      url: '/api/collect/goods-1/ozon-category-candidates?shopId=shop-1',
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'source_capture_v2_required',
    });

    await app.close();
  });

  it('blocks domestic-source candidates when the official category has no attribute definitions', async () => {
    mocks.getDescriptionCategoryAttributes.mockResolvedValueOnce([]);
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/collect/goods-1/ozon-category-candidates?shopId=shop-1',
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'OZON_ATTRIBUTE_DEFINITIONS_REQUIRED',
    });

    await app.close();
  });

  it('returns a retryable error when official attribute definitions are unavailable', async () => {
    mocks.getDescriptionCategoryAttributes.mockRejectedValueOnce(new Error('Ozon unavailable'));
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/collect/goods-1/ozon-category-candidates?shopId=shop-1',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'ozon_attribute_definitions_unavailable',
    });

    await app.close();
  });

  it('returns a safe retryable error when the owned shop credentials cannot be decrypted', async () => {
    mocks.decrypt.mockImplementationOnce(() => {
      throw new Error('Unsupported state or unable to authenticate data');
    });
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/collect/goods-1/ozon-category-candidates?shopId=shop-1',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: 0,
      errorCode: 'SOURCE_WORKFLOW_OZON_CREDENTIALS_UNAVAILABLE',
      msg: 'Ozon 店铺凭证不可用，请重新保存店铺 API 密钥',
    });

    await app.close();
  });

  it('unwraps a credential failure from a catalog refresh boundary', async () => {
    const app = await buildApp(dependencies({
      loadAuthoritativeOzonCategoryCatalog: vi.fn(async () => {
        throw new OzonCategoryCatalogRefreshError(
          'OZON_CATEGORY_CATALOG_REFRESH_FAILED',
          'catalog refresh failed',
          { cause: new SourceWorkflowOzonCredentialsUnavailableError() },
        );
      }),
    }));

    const response = await app.inject({
      method: 'GET',
      url: '/api/collect/goods-1/ozon-category-candidates?shopId=shop-1',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: 0,
      errorCode: 'SOURCE_WORKFLOW_OZON_CREDENTIALS_UNAVAILABLE',
      msg: 'Ozon 店铺凭证不可用，请重新保存店铺 API 密钥',
    });
    expect(mocks.getDescriptionCategoryAttributes).not.toHaveBeenCalled();
    await app.close();
  });

  it('fails closed when V2 read is disabled without an allowed legacy fallback', async () => {
    const options = dependencies({
      featureFlags: {
        evaluate: vi.fn(async () => ({
          enabled: false,
          legacyAllowed: false,
          captureStage: null,
          reason: 'policy_off' as const,
          revision: 'mapping-rollout-off',
        })),
      },
    });
    const app = await buildApp(options);

    const response = await app.inject({
      method: 'GET',
      url: '/api/collect/goods-1/ozon-category-candidates?shopId=shop-1',
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'source_workflow_rollout_unavailable',
    });
    expect(options.loadCanonicalSourceOzonCategoryContext).not.toHaveBeenCalled();
    expect(options.loadAuthoritativeOzonCategoryCatalog).not.toHaveBeenCalled();

    await app.close();
  });

  it('keeps the legacy read fallback tenant-scoped when explicitly allowed', async () => {
    mocks.supplyGoodsFindMany.mockResolvedValue([{
      metadata: {
        sourceOzonCategoryConfirmed: {
          signature: '1688|服装>女装>t恤',
          categoryId: 170001,
          typeId: 91001,
        },
      },
    }]);
    const options = dependencies({
      featureFlags: {
        evaluate: vi.fn(async () => ({
          enabled: false,
          legacyAllowed: true,
          captureStage: null,
          reason: 'policy_off' as const,
          revision: 'mapping-rollout-legacy',
        })),
      },
    });
    const app = await buildApp(options);

    const response = await app.inject({
      method: 'GET',
      url: '/api/collect/goods-1/ozon-category-candidates?shopId=shop-1',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        historyMode: 'legacy_tenant',
        sourceSnapshotId: null,
      },
    });
    expect(mocks.supplyGoodsFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ userId: 'owner-1' }),
    }));
    expect(options.loadCanonicalSourceOzonCategoryContext).not.toHaveBeenCalled();

    await app.close();
  });

  it('rejects a stale catalog revision before applying a mapping decision', async () => {
    const options = dependencies();
    const app = await buildApp(options);

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/goods-1/ozon-category-confirm',
      payload: {
        shopId: 'shop-1',
        categoryId: 170001,
        typeId: 91001,
        expectedCatalogRevision: 'catalog-old',
        expectedTransitionVersion: 4,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'ozon_category_catalog_stale',
    });
    expect(options.sourceOzonCategoryMappingService?.confirmTenantMapping).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();

    await app.close();
  });

  it('rejects disabled or absent official category/type pairs', async () => {
    const options = dependencies({
      loadAuthoritativeOzonCategoryCatalog: vi.fn(async () => ({
        entries: [{ ...catalogEntry, disabled: true, selectable: false }],
        categoryTree: [],
        catalogRevision: 'catalog-7',
      })),
    });
    const app = await buildApp(options);

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/goods-1/ozon-category-confirm',
      payload: {
        shopId: 'shop-1',
        categoryId: 170001,
        typeId: 91001,
        expectedCatalogRevision: 'catalog-7',
        expectedTransitionVersion: 4,
      },
    });

    expect(response.statusCode).toBe(422);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'ozon_category_target_invalid',
    });
    expect(options.sourceOzonCategoryMappingService?.confirmTenantMapping).not.toHaveBeenCalled();

    await app.close();
  });

  it('fails closed when V2 write is disabled without an allowed legacy fallback', async () => {
    const options = dependencies({
      featureFlags: {
        evaluate: vi.fn(async () => ({
          enabled: false,
          legacyAllowed: false,
          captureStage: null,
          reason: 'policy_off' as const,
          revision: 'mapping-rollout-off',
        })),
      },
    });
    const app = await buildApp(options);

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/goods-1/ozon-category-confirm',
      payload: {
        shopId: 'shop-1',
        categoryId: 170001,
        typeId: 91001,
        expectedCatalogRevision: 'catalog-7',
        expectedTransitionVersion: 0,
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'source_workflow_rollout_unavailable',
    });
    expect(options.loadAuthoritativeOzonCategoryCatalog).not.toHaveBeenCalled();

    await app.close();
  });

  it('keeps mapping CAS conflicts visible to clients so they can refresh', async () => {
    const confirmTenantMapping = vi.fn(async () => {
      throw new SourceOzonCategoryMappingError(
        'SOURCE_OZON_CATEGORY_MAPPING_VERSION_CONFLICT',
        'Source Ozon category mapping transition version changed',
        409,
      );
    });
    const options = dependencies({
      sourceOzonCategoryMappingService: {
        listVisibleMappings: vi.fn(async () => []),
        confirmTenantMapping,
      },
    });
    const app = await buildApp(options);

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/goods-1/ozon-category-confirm',
      payload: {
        shopId: 'shop-1',
        categoryId: 170001,
        typeId: 91001,
        expectedCatalogRevision: 'catalog-7',
        expectedTransitionVersion: 3,
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'SOURCE_OZON_CATEGORY_MAPPING_VERSION_CONFLICT',
    });
    expect(mocks.queryRaw).not.toHaveBeenCalled();

    await app.close();
  });

  it('retries an already-recorded decision after a projection failure without duplicating it', async () => {
    const firstMapping = mappingRecord({
      transitionVersion: 5,
      lastConfirmedAt: '2026-07-15T03:00:00.000Z',
      updatedAt: '2026-07-15T03:00:00.000Z',
    });
    const confirmTenantMapping = vi.fn()
      .mockResolvedValueOnce({ mapping: firstMapping, idempotent: false })
      .mockResolvedValueOnce({ mapping: firstMapping, idempotent: true });
    const options = dependencies({
      sourceOzonCategoryMappingService: {
        listVisibleMappings: vi.fn(async () => []),
        confirmTenantMapping,
      },
    });
    const app = await buildApp(options);
    mocks.queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ metadata: { ...mocks.item.metadata } }]);
    const payload = {
      shopId: 'shop-1',
      categoryId: 170001,
      typeId: 91001,
      expectedCatalogRevision: 'catalog-7',
      expectedTransitionVersion: 4,
    };

    const first = await app.inject({
      method: 'POST',
      url: '/api/collect/goods-1/ozon-category-confirm',
      payload,
    });
    const retry = await app.inject({
      method: 'POST',
      url: '/api/collect/goods-1/ozon-category-confirm',
      payload,
    });

    expect(first.statusCode).toBe(500);
    expect(first.json()).toMatchObject({
      code: 0,
      errorCode: 'source_ozon_category_projection_failed',
    });
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toMatchObject({ code: 1, data: { idempotent: true } });
    expect(confirmTenantMapping).toHaveBeenCalledTimes(2);
    expect(mocks.queryRaw).toHaveBeenCalledTimes(2);

    await app.close();
  });

  describe('source publish category confirmation gate', () => {
    async function publish(options: CollectRoutesOptions, item: ReturnType<typeof publishItem>) {
      mocks.authUser.actorUserId = 'owner-1';
      mocks.authUser.role = 'USER';
      mocks.supplyGoodsFindMany.mockResolvedValueOnce([item]);
      const app = await buildApp(options);
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/publish-ozon',
        payload: {
          ids: [item.id],
          shopId: 'shop-1',
          source: 'source-publish-page',
        },
      });
      await app.close();
      return response;
    }

    function expectNoOzonImport() {
      expect(mocks.importBySku).not.toHaveBeenCalled();
      expect(mocks.importProducts).not.toHaveBeenCalled();
    }

    it('requires a server-projected category confirmation', async () => {
      const response = await publish(publishDependencies(), publishItem(null));

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'source_ozon_category_confirmation_required',
      });
      expectNoOzonImport();
    });

    it('rejects a confirmation for a different effective category pair', async () => {
      const response = await publish(
        publishDependencies(),
        publishItem({ categoryId: 170002 }),
      );

      expect(response.statusCode).toBe(422);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'source_ozon_category_confirmation_mismatch',
      });
      expectNoOzonImport();
    });

    it('rejects a confirmation from a stale authoritative catalog revision', async () => {
      const response = await publish(
        publishDependencies(),
        publishItem({ catalogRevision: 'catalog-6' }),
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'source_ozon_category_confirmation_stale',
      });
      expectNoOzonImport();
    });

    it('rejects a V2 confirmation after the canonical source evidence changes', async () => {
      const response = await publish(
        publishDependencies(),
        publishItem({ sourceSnapshotId: 'snapshot-old' }),
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'source_ozon_category_confirmation_stale',
      });
      expectNoOzonImport();
    });

    it('rejects a V2 confirmation after its mapping transition advances', async () => {
      const response = await publish(
        publishDependencies({
          sourceOzonCategoryMappingService: {
            listVisibleMappings: vi.fn(async () => [mappingRecord({ transitionVersion: 5 })]),
            confirmTenantMapping: vi.fn(),
          },
        }),
        publishItem(),
      );

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'source_ozon_category_confirmation_stale',
      });
      expectNoOzonImport();
    });

    it('imports only after the V2 projection, canonical evidence, mapping, and catalog all match', async () => {
      const options = publishDependencies();
      const response = await publish(options, publishItem());

      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: { taskId: 101 } });
      expect(options.loadCanonicalSourceOzonCategoryContext).toHaveBeenCalledWith({
        ownerUserId: 'owner-1',
        supplyGoodsId: 'goods-1',
      });
      expect(options.sourceOzonCategoryMappingService?.listVisibleMappings).toHaveBeenCalledWith({
        ownerUserId: 'owner-1',
        source: canonicalSource,
      });
      expect(mocks.importBySku).not.toHaveBeenCalled();
      expect(mocks.importProducts).toHaveBeenCalledTimes(1);
      expect(mocks.importProducts).toHaveBeenCalledWith([
        expect.objectContaining({
          description_category_id: 170001,
          type_id: 91001,
        }),
      ]);
    });

    it('observes the finalized legacy payload before submit and stores only the returned parity report', async () => {
      const report = {
        contractVersion: 'ozon-publisher-entrypoint-parity/v1',
        status: 'MATCH',
        classification: 'EQUIVALENT',
        switchEligible: true,
      };
      const observe = vi.fn(async (_input: PublisherParityObservation) => report);
      const evaluate = vi.fn(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
        ? {
            enabled: true,
            legacyAllowed: true,
            captureStage: null,
            listingStage: 'shadow_write' as const,
            reason: 'global' as const,
            revision: 'rollout-7',
          }
        : {
            enabled: false,
            legacyAllowed: true,
            captureStage: null,
            reason: 'policy_off' as const,
            revision: 'rollout-7',
          });
      const options = publishDependencies({
        featureFlags: { evaluate },
        sourceListingWorkflowAdapter: {
          prepare: vi.fn(async () => ({
            drafts: [{
              supplyGoodsId: 'goods-1',
              draftId: 'draft-1',
              draftVersion: 4,
              revision: 9,
            }],
            failures: [],
          })),
        },
        publisherParityObserver: { observe },
      });

      const response = await publish(options, publishItem());

      expect(response.statusCode, response.body).toBe(200);
      expect(observe).toHaveBeenCalledTimes(1);
      expect(observe).toHaveBeenCalledWith(expect.objectContaining({
        ownerUserId: 'owner-1',
        shopId: 'shop-1',
        rolloutRevision: 'rollout-7',
        entrypoint: 'COLLECT_PUBLISH_OZON',
        drafts: [{
          supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 4, revision: 9,
        }],
        legacy: expect.objectContaining({ endpoint: '/v3/product/import' }),
      }));
      const observedItems = observe.mock.calls[0]![0].legacy.payload.items;
      expect(observedItems).toEqual(mocks.importProducts.mock.calls[0]![0]);
      expect(observe.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.importProducts.mock.invocationCallOrder[0]!,
      );
      expect(mocks.syncJobCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({ publisherEntrypointParity: report }),
        }),
      }));
    });

    it('keeps the legacy submit authoritative when shadow observation fails', async () => {
      const observe = vi.fn(async () => {
        throw new Error('shadow compiler unavailable with sensitive detail');
      });
      const evaluate = vi.fn(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
        ? {
            enabled: true,
            legacyAllowed: true,
            captureStage: null,
            listingStage: 'shadow_write' as const,
            reason: 'global' as const,
            revision: 'rollout-8',
          }
        : {
            enabled: false,
            legacyAllowed: true,
            captureStage: null,
            reason: 'policy_off' as const,
            revision: 'rollout-8',
          });
      const response = await publish(publishDependencies({
        featureFlags: { evaluate },
        sourceListingWorkflowAdapter: {
          prepare: vi.fn(async () => ({
            drafts: [{
              supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 1, revision: 1,
            }],
            failures: [],
          })),
        },
        publisherParityObserver: { observe },
      }), publishItem());

      expect(response.statusCode, response.body).toBe(200);
      expect(observe).toHaveBeenCalledOnce();
      expect(mocks.importProducts).toHaveBeenCalledOnce();
      expect(mocks.syncJobCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.not.objectContaining({ publisherEntrypointParity: expect.anything() }),
        }),
      }));
    });

    it('bounds a hung shadow observation without delaying the legacy submit indefinitely', async () => {
      const observe = vi.fn((_input: PublisherParityObservation) => (
        new Promise<Record<string, unknown>>(() => undefined)
      ));
      const evaluate = vi.fn(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
        ? {
            enabled: true, legacyAllowed: true, captureStage: null,
            listingStage: 'shadow_write' as const, reason: 'global' as const,
            revision: 'rollout-timeout-1',
          }
        : {
            enabled: false, legacyAllowed: true, captureStage: null,
            reason: 'policy_off' as const, revision: 'rollout-timeout-1',
          });
      const startedAt = Date.now();
      const response = await publish(publishDependencies({
        featureFlags: { evaluate },
        publisherParityTimeoutMs: 10,
        sourceListingWorkflowAdapter: {
          prepare: vi.fn(async () => ({
            drafts: [{
              supplyGoodsId: 'goods-1', draftId: 'draft-timeout', draftVersion: 1, revision: 1,
            }],
            failures: [],
          })),
        },
        publisherParityObserver: { observe },
      }), publishItem());

      expect(response.statusCode, response.body).toBe(200);
      expect(Date.now() - startedAt).toBeLessThan(1_000);
      expect(observe).toHaveBeenCalledOnce();
      expect(mocks.importProducts).toHaveBeenCalledOnce();
    });

    it('blocks an off-to-shadow rollout revision change before the Ozon submit', async () => {
      let listingEvaluations = 0;
      let publisherEvaluations = 0;
      const evaluate = vi.fn(async (feature: string) => {
        const isListing = feature === 'SOURCE_LISTING_WORKFLOW';
        const evaluation = isListing ? ++listingEvaluations : ++publisherEvaluations;
        const changed = isListing ? evaluation >= 4 : evaluation >= 3;
        return isListing
          ? changed
            ? {
                enabled: true, legacyAllowed: true, captureStage: null,
                listingStage: 'shadow_write' as const, reason: 'global' as const,
                revision: 'rollout-enabled-new',
              }
            : {
                enabled: false, legacyAllowed: true, captureStage: null,
                reason: 'policy_off' as const, revision: 'rollout-off-old',
              }
          : {
              enabled: false, legacyAllowed: true, captureStage: null,
              reason: 'policy_off' as const,
              revision: changed ? 'rollout-enabled-new' : 'rollout-off-old',
            };
      });
      const observe = vi.fn(async () => ({
        contractVersion: 'ozon-publisher-entrypoint-parity/v1',
        status: 'MATCH',
        classification: 'MATCH',
        switchEligible: true,
      }));

      const response = await publish(publishDependencies({
        featureFlags: { evaluate },
        publisherParityObserver: { observe },
      }), publishItem());

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'source_workflow_rollout_unavailable',
        rolloutRevision: 'rollout-enabled-new',
      });
      expect(observe).not.toHaveBeenCalled();
      expectNoOzonImport();
    });

    it('persists the main parity report when the post-observation rollout recheck blocks a shared job', async () => {
      let listingEvaluations = 0;
      let publisherEvaluations = 0;
      const evaluate = vi.fn(async (feature: string) => {
        const isListing = feature === 'SOURCE_LISTING_WORKFLOW';
        const evaluation = isListing ? ++listingEvaluations : ++publisherEvaluations;
        const changed = isListing ? evaluation >= 4 : evaluation >= 3;
        return isListing
          ? {
              enabled: true, legacyAllowed: true, captureStage: null,
              listingStage: 'shadow_write' as const, reason: 'global' as const,
              revision: changed ? 'rollout-main-new' : 'rollout-main-old',
            }
          : {
              enabled: false, legacyAllowed: true, captureStage: null,
              reason: 'policy_off' as const,
              revision: changed ? 'rollout-main-new' : 'rollout-main-old',
            };
      });
      const report = {
        contractVersion: 'ozon-publisher-entrypoint-parity/v1',
        status: 'DIFFERENT',
        classification: 'DEFECT',
        switchEligible: false,
      };
      const observe = vi.fn(async () => report);
      const browserItem = publishItem();
      browserItem.metadata.ozonAttributes = [{
        id: 10096,
        complex_id: 0,
        values: [{ value: 'красный', dictionary_value_id: 0 }],
      }];
      mocks.authUser.actorUserId = 'owner-1';
      mocks.authUser.role = 'USER';
      mocks.supplyGoodsFindMany.mockResolvedValueOnce([browserItem]);
      mocks.syncJobFindFirst.mockResolvedValueOnce({
        id: 'browser-rollout-job',
        payload: {
          source: 'browser-one-click-listing',
          browserOneClickJob: true,
          entry: 'extension-workbench',
        },
        shop: { userId: 'owner-1' },
      });
      const app = await buildApp(publishDependencies({
        featureFlags: { evaluate },
        sourceListingWorkflowAdapter: {
          prepare: vi.fn(async () => ({
            drafts: [{
              supplyGoodsId: 'goods-1', draftId: 'draft-main', draftVersion: 2, revision: 4,
            }],
            failures: [],
          })),
        },
        publisherParityObserver: { observe },
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/publish-ozon',
        payload: {
          ids: ['goods-1'],
          shopId: 'shop-1',
          jobId: 'browser-rollout-job',
          source: 'batch-collect-page',
        },
      });
      await app.close();

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        errorCode: 'source_workflow_rollout_unavailable',
        rolloutRevision: 'rollout-main-new',
      });
      expect(observe).toHaveBeenCalledOnce();
      expectNoOzonImport();
      const blockedPayload = mocks.syncJobUpdate.mock.calls
        .map(([call]) => (call as any)?.data?.payload)
        .find((payload) => payload?.stage === 'rollout_blocked');
      expect(blockedPayload).toMatchObject({
        publisherEntrypointParity: report,
        sourceListingWorkflow: expect.objectContaining({ rolloutRevision: 'rollout-main-old' }),
      });
    });

    it('observes the finalized import-by-sku fallback payload before the unchanged legacy call', async () => {
      const report = {
        contractVersion: 'ozon-publisher-entrypoint-parity/v1',
        status: 'V2_BLOCKED',
        classification: 'INTENTIONAL_STRICTER',
        switchEligible: false,
      };
      const observe = vi.fn(async (_input: PublisherParityObservation) => report);
      const evaluate = vi.fn(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
        ? {
            enabled: true,
            legacyAllowed: true,
            captureStage: null,
            listingStage: 'shadow_write' as const,
            reason: 'global' as const,
            revision: 'rollout-fallback-1',
          }
        : {
            enabled: false,
            legacyAllowed: true,
            captureStage: null,
            reason: 'policy_off' as const,
            revision: 'rollout-fallback-1',
          });
      const fallbackItem = {
        ...publishItem(null),
        sourcePlatform: 'ozon',
        sourceProductId: '123456',
        sku: '123456',
        metadata: { publishTitleRu: 'Товар для наследования карточки' },
      } as any;
      mocks.authUser.actorUserId = 'owner-1';
      mocks.authUser.role = 'USER';
      mocks.supplyGoodsFindMany.mockResolvedValueOnce([fallbackItem]);
      mocks.importBySku.mockResolvedValueOnce({
        result: { task_id: 99, unmatched_sku_list: [123456] },
      });
      const app = await buildApp(publishDependencies({
        featureFlags: { evaluate },
        sourceListingWorkflowAdapter: {
          prepare: vi.fn(async () => ({
            drafts: [{
              supplyGoodsId: 'goods-1', draftId: 'draft-fallback', draftVersion: 1, revision: 1,
            }],
            failures: [],
          })),
        },
        publisherParityObserver: { observe },
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/publish-ozon',
        payload: {
          ids: ['goods-1'],
          shopId: 'shop-1',
          source: 'listing-page',
          randomOfferId: false,
        },
      });
      await app.close();

      expect(response.statusCode).toBe(200);
      expect(observe).toHaveBeenCalledWith(expect.objectContaining({
        entrypoint: 'COLLECT_PUBLISH_OZON',
        rolloutRevision: 'rollout-fallback-1',
        legacy: expect.objectContaining({ endpoint: '/v1/product/import-by-sku' }),
      }));
      const observedItems = observe.mock.calls[0]![0].legacy.payload.items;
      expect(observedItems).toEqual(mocks.importBySku.mock.calls[0]![0]);
      expect(observe.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.importBySku.mock.invocationCallOrder[0]!,
      );
      expect(mocks.syncJobCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({ publisherEntrypointParity: report }),
        }),
      }));
    });

    it('rechecks fallback rollout after local writes and rolls them back before Ozon on revision drift', async () => {
      let listingEvaluations = 0;
      let publisherEvaluations = 0;
      const evaluate = vi.fn(async (feature: string) => {
        const isListing = feature === 'SOURCE_LISTING_WORKFLOW';
        const evaluation = isListing ? ++listingEvaluations : ++publisherEvaluations;
        const changed = isListing ? evaluation >= 4 : evaluation >= 3;
        return isListing
          ? {
              enabled: true, legacyAllowed: true, captureStage: null,
              listingStage: 'shadow_write' as const, reason: 'global' as const,
              revision: changed ? 'rollout-fallback-new' : 'rollout-fallback-old',
            }
          : {
              enabled: false, legacyAllowed: true, captureStage: null,
              reason: 'policy_off' as const,
              revision: changed ? 'rollout-fallback-new' : 'rollout-fallback-old',
            };
      });
      const fallbackItem = {
        ...publishItem(null),
        sourcePlatform: 'ozon',
        sourceProductId: '123456',
        sku: '123456',
        status: 'collected',
        metadata: { publishTitleRu: 'Товар для проверки переключения' },
      } as any;
      mocks.authUser.actorUserId = 'owner-1';
      mocks.authUser.role = 'USER';
      mocks.supplyGoodsFindMany.mockResolvedValueOnce([fallbackItem]);
      const app = await buildApp(publishDependencies({
        featureFlags: { evaluate },
        sourceListingWorkflowAdapter: {
          prepare: vi.fn(async () => ({
            drafts: [{
              supplyGoodsId: 'goods-1', draftId: 'draft-fallback', draftVersion: 1, revision: 1,
            }],
            failures: [],
          })),
        },
        publisherParityObserver: {
          observe: vi.fn(async () => ({
            contractVersion: 'ozon-publisher-entrypoint-parity/v1',
            status: 'NOT_COMPARABLE',
            classification: 'NOT_COMPARABLE',
            switchEligible: false,
          })),
        },
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/publish-ozon',
        payload: {
          ids: ['goods-1'],
          shopId: 'shop-1',
          source: 'listing-page',
          randomOfferId: false,
        },
      });
      await app.close();

      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'source_workflow_rollout_unavailable',
        rolloutRevision: 'rollout-fallback-new',
      });
      expect(mocks.importBySku).not.toHaveBeenCalled();
      expect(mocks.supplyGoodsUpdate).toHaveBeenCalledWith({
        where: { id: 'goods-1' },
        data: { status: 'collected' },
      });
      expect(mocks.syncJobUpdate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: 'FAILED',
          payload: expect.objectContaining({ stage: 'rollout_blocked' }),
        }),
      }));
    });

    it('attributes browser one-click to its converged collect observation exactly once', async () => {
      const report = {
        contractVersion: 'ozon-publisher-entrypoint-parity/v1',
        status: 'MATCH',
        classification: 'MATCH',
        switchEligible: true,
      };
      const observe = vi.fn(async (_input: PublisherParityObservation) => report);
      const evaluate = vi.fn(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
        ? {
            enabled: true,
            legacyAllowed: true,
            captureStage: null,
            listingStage: 'shadow_write' as const,
            reason: 'global' as const,
            revision: 'rollout-browser-1',
          }
        : {
            enabled: false,
            legacyAllowed: true,
            captureStage: null,
            reason: 'policy_off' as const,
            revision: 'rollout-browser-1',
          });
      const browserItem = publishItem();
      browserItem.metadata.ozonAttributes = [{
        id: 10096,
        complex_id: 0,
        values: [{ value: 'красный', dictionary_value_id: 0 }],
      }];
      mocks.authUser.actorUserId = 'owner-1';
      mocks.authUser.role = 'USER';
      mocks.supplyGoodsFindMany.mockResolvedValueOnce([browserItem]);
      mocks.syncJobFindFirst.mockResolvedValueOnce({
        id: 'browser-job-1',
        payload: {
          source: 'browser-one-click-listing',
          browserOneClickJob: true,
          entry: 'extension-workbench',
        },
        shop: { userId: 'owner-1' },
      });
      const app = await buildApp(publishDependencies({
        featureFlags: { evaluate },
        sourceListingWorkflowAdapter: {
          prepare: vi.fn(async () => ({
            drafts: [{
              supplyGoodsId: 'goods-1', draftId: 'draft-browser', draftVersion: 2, revision: 5,
            }],
            failures: [],
          })),
        },
        publisherParityObserver: { observe },
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/publish-ozon',
        payload: {
          ids: ['goods-1'],
          shopId: 'shop-1',
          jobId: 'browser-job-1',
          source: 'batch-collect-page',
        },
      });
      await app.close();

      expect(response.statusCode, response.body).toBe(200);
      expect(observe).toHaveBeenCalledOnce();
      expect(observe).toHaveBeenCalledWith(expect.objectContaining({
        entrypoint: 'BROWSER_ONE_CLICK',
        rolloutRevision: 'rollout-browser-1',
      }));
      expect(mocks.importProducts).toHaveBeenCalledOnce();
      expect(mocks.syncJobUpdate.mock.calls.some(([call]) => (
        (call as any)?.data?.payload?.publisherEntrypointParity?.status === 'MATCH'
      ))).toBe(true);
      expect(mocks.syncJobCreate).not.toHaveBeenCalled();
    });

    it('scopes mixed fallback and main observations to the exact emitted source goods', async () => {
      const observe = vi.fn(async (_input: PublisherParityObservation) => ({
        contractVersion: 'ozon-publisher-entrypoint-parity/v1',
        status: 'DIFFERENT',
        classification: 'DEFECT',
        switchEligible: false,
      }));
      const evaluate = vi.fn(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
        ? {
            enabled: true, legacyAllowed: true, captureStage: null,
            listingStage: 'shadow_write' as const, reason: 'global' as const,
            revision: 'rollout-mixed-1',
          }
        : {
            enabled: false, legacyAllowed: true, captureStage: null,
            reason: 'policy_off' as const, revision: 'rollout-mixed-1',
          });
      const fallbackItem = {
        ...publishItem(null),
        id: 'goods-fallback',
        sourcePlatform: 'ozon',
        sourceProductId: '123456',
        sku: '123456',
        metadata: { publishTitleRu: 'Товар для наследования карточки' },
      } as any;
      const mainItem = publishItem();
      mainItem.id = 'goods-main';
      mainItem.metadata.ozonAttributes = [{
        id: 10096,
        complex_id: 0,
        values: [{ value: 'красный', dictionary_value_id: 0 }],
      }];
      mocks.authUser.actorUserId = 'owner-1';
      mocks.authUser.role = 'USER';
      mocks.supplyGoodsFindMany.mockResolvedValueOnce([fallbackItem, mainItem]);
      mocks.syncJobFindFirst.mockResolvedValueOnce({
        id: 'browser-mixed-job',
        payload: {
          source: 'browser-one-click-listing',
          browserOneClickJob: true,
          entry: 'extension-workbench',
        },
        shop: { userId: 'owner-1' },
      });
      mocks.importBySku.mockResolvedValueOnce({
        result: { task_id: 99, unmatched_sku_list: [123456] },
      });
      const app = await buildApp(publishDependencies({
        featureFlags: { evaluate },
        sourceListingWorkflowAdapter: {
          prepare: vi.fn(async () => ({
            drafts: [
              { supplyGoodsId: 'goods-fallback', draftId: 'draft-fallback', draftVersion: 1, revision: 1 },
              { supplyGoodsId: 'goods-main', draftId: 'draft-main', draftVersion: 2, revision: 4 },
            ],
            failures: [],
          })),
        },
        publisherParityObserver: { observe },
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/publish-ozon',
        payload: {
          ids: ['goods-fallback', 'goods-main'],
          shopId: 'shop-1',
          jobId: 'browser-mixed-job',
          source: 'listing-page',
          randomOfferId: false,
        },
      });
      await app.close();

      expect(response.statusCode, response.body).toBe(200);
      expect(observe).toHaveBeenCalledTimes(2);
      const observations = observe.mock.calls.map(([input]) => input);
      expect(observations.find((input) => input.legacy.endpoint === '/v1/product/import-by-sku')?.drafts)
        .toEqual([{ supplyGoodsId: 'goods-fallback', draftId: 'draft-fallback', draftVersion: 1, revision: 1 }]);
      expect(observations.find((input) => input.legacy.endpoint === '/v3/product/import')?.drafts)
        .toEqual([{ supplyGoodsId: 'goods-main', draftId: 'draft-main', draftVersion: 2, revision: 4 }]);
      const finalPayload = mocks.syncJobUpdate.mock.calls
        .map(([call]) => (call as any)?.data?.payload)
        .find((payload) => payload?.publisherEntrypointParity && payload?.fallbackPublisherEntrypointParity);
      expect(finalPayload).toMatchObject({
        publisherEntrypointParity: { status: 'DIFFERENT' },
        fallbackPublisherEntrypointParity: { status: 'DIFFERENT' },
        fallbackPublish: { taskId: 99, itemCount: 1 },
      });
      expect(mocks.syncJobCreate).not.toHaveBeenCalled();
    });

    it('retains both mixed-branch parity reports when the main Ozon submit fails', async () => {
      const fallbackReport = {
        contractVersion: 'ozon-publisher-entrypoint-parity/v1',
        status: 'V2_BLOCKED',
        classification: 'INTENTIONAL_STRICTER',
        switchEligible: false,
      };
      const mainReport = {
        contractVersion: 'ozon-publisher-entrypoint-parity/v1',
        status: 'DIFFERENT',
        classification: 'DEFECT',
        switchEligible: false,
      };
      const observe = vi.fn(async (input: PublisherParityObservation) => (
        input.legacy.endpoint === '/v1/product/import-by-sku' ? fallbackReport : mainReport
      ));
      const evaluate = vi.fn(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
        ? {
            enabled: true, legacyAllowed: true, captureStage: null,
            listingStage: 'shadow_write' as const, reason: 'global' as const,
            revision: 'rollout-mixed-failure-1',
          }
        : {
            enabled: false, legacyAllowed: true, captureStage: null,
            reason: 'policy_off' as const, revision: 'rollout-mixed-failure-1',
          });
      const fallbackItem = {
        ...publishItem(null),
        id: 'goods-fallback',
        sourcePlatform: 'ozon',
        sourceProductId: '123456',
        sku: '123456',
        metadata: { publishTitleRu: 'Товар для наследования карточки' },
      } as any;
      const mainItem = publishItem();
      mainItem.id = 'goods-main';
      mainItem.metadata.ozonAttributes = [{
        id: 10096,
        complex_id: 0,
        values: [{ value: 'красный', dictionary_value_id: 0 }],
      }];
      mocks.authUser.actorUserId = 'owner-1';
      mocks.authUser.role = 'USER';
      mocks.supplyGoodsFindMany.mockResolvedValueOnce([fallbackItem, mainItem]);
      mocks.syncJobFindFirst.mockResolvedValueOnce({
        id: 'browser-mixed-failure-job',
        payload: {
          source: 'browser-one-click-listing',
          browserOneClickJob: true,
          entry: 'extension-workbench',
        },
        shop: { userId: 'owner-1' },
      });
      mocks.importBySku.mockResolvedValueOnce({
        result: { task_id: 99, unmatched_sku_list: [123456] },
      });
      mocks.importProducts.mockRejectedValueOnce(new Error('main submit failed'));
      const app = await buildApp(publishDependencies({
        featureFlags: { evaluate },
        sourceListingWorkflowAdapter: {
          prepare: vi.fn(async () => ({
            drafts: [
              { supplyGoodsId: 'goods-fallback', draftId: 'draft-fallback', draftVersion: 1, revision: 1 },
              { supplyGoodsId: 'goods-main', draftId: 'draft-main', draftVersion: 2, revision: 4 },
            ],
            failures: [],
          })),
        },
        publisherParityObserver: { observe },
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/publish-ozon',
        payload: {
          ids: ['goods-fallback', 'goods-main'],
          shopId: 'shop-1',
          jobId: 'browser-mixed-failure-job',
          source: 'listing-page',
          randomOfferId: false,
        },
      });
      await app.close();

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 0 });
      expect(observe).toHaveBeenCalledTimes(2);
      expect(mocks.importBySku).toHaveBeenCalledOnce();
      expect(mocks.importProducts).toHaveBeenCalledOnce();
      const failedPayload = mocks.syncJobUpdate.mock.calls
        .map(([call]) => (call as any)?.data?.payload)
        .find((payload) => payload?.stage === 'publish_failed');
      expect(failedPayload).toMatchObject({
        publisherEntrypointParity: mainReport,
        fallbackPublisherEntrypointParity: fallbackReport,
        fallbackPublish: { taskId: 99, itemCount: 1 },
      });
    });

    it('marks a branch not comparable when draft preparation coverage is partial', async () => {
      const observe = vi.fn(async (_input: PublisherParityObservation) => ({
        contractVersion: 'ozon-publisher-entrypoint-parity/v1',
        status: 'NOT_COMPARABLE',
        classification: 'NOT_COMPARABLE',
        switchEligible: false,
      }));
      const evaluate = vi.fn(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
        ? {
            enabled: true, legacyAllowed: true, captureStage: null,
            listingStage: 'shadow_write' as const, reason: 'global' as const,
            revision: 'rollout-partial-1',
          }
        : {
            enabled: false, legacyAllowed: true, captureStage: null,
            reason: 'policy_off' as const, revision: 'rollout-partial-1',
          });
      const first = publishItem();
      first.id = 'goods-1';
      first.metadata.ozonAttributes = [{ id: 10096, values: [{ value: 'красный' }] }];
      const second = publishItem();
      second.id = 'goods-2';
      second.sku = 'offer-2';
      second.metadata.ozonAttributes = [{ id: 10096, values: [{ value: 'синий' }] }];
      mocks.authUser.actorUserId = 'owner-1';
      mocks.authUser.role = 'USER';
      mocks.supplyGoodsFindMany.mockResolvedValueOnce([first, second]);
      const app = await buildApp(publishDependencies({
        featureFlags: { evaluate },
        sourceListingWorkflowAdapter: {
          prepare: vi.fn(async () => ({
            drafts: [{ supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 1, revision: 1 }],
            failures: [],
          })),
        },
        publisherParityObserver: { observe },
      }));

      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/publish-ozon',
        payload: {
          ids: ['goods-1', 'goods-2'],
          shopId: 'shop-1',
          source: 'listing-page',
        },
      });
      await app.close();

      expect(response.statusCode, response.body).toBe(200);
      expect(observe).toHaveBeenCalledOnce();
      expect(observe).toHaveBeenCalledWith(expect.objectContaining({ drafts: [] }));
      expect(mocks.importProducts).toHaveBeenCalledOnce();
    });

    it('accepts a legacy-v1 confirmation only when its current source signature and catalog pair match', async () => {
      const legacyItem = publishItem({
        version: 'source-ozon-category-confirmed/legacy-v1',
        mappingId: null,
        signature: '1688|服装>女装>t恤',
        sourceSnapshotId: null,
        sourceProfileHash: null,
        transitionVersion: 0,
      });
      const options = publishDependencies({
        loadCanonicalSourceOzonCategoryContext: vi.fn(async () => {
          throw new Error('legacy confirmation must not require V2 context');
        }),
      });
      const response = await publish(options, legacyItem);

      expect(response.statusCode, response.body).toBe(200);
      expect(mocks.importProducts).toHaveBeenCalledTimes(1);
      expect(options.loadCanonicalSourceOzonCategoryContext).not.toHaveBeenCalled();
    });
  });
});

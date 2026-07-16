import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildCollectedGoodsMetadata,
  collectRoutes,
  type CollectRoutesOptions,
} from '../routes/collect.js';
import {
  createSourceCaptureService,
  type PreparedLegacyProjection,
  type PreparedLegacySourceCapture,
  type SourceCaptureRepository,
} from '../services/source-capture.js';

const mocks = vi.hoisted(() => {
  const record = {
    id: 'collect-existing',
    userId: 'user-1',
    title: 'Old title',
    sourceUrl: 'https://www.ozon.ru/product/item-123/',
    sourcePlatform: 'ozon',
    sourceProductId: '123',
    sku: '123',
    images: ['old.jpg'],
    purchasePrice: { toString: () => '88.00' },
    currency: 'CNY',
    originalPrice: null,
    originalCurrency: null,
    exchangeRateUsed: null,
    priceNeedsReview: false,
    notes: 'old description',
    metadata: {
      publishTitleRu: 'Ручной заголовок',
      publishDescriptionRu: 'Ручное описание',
      watermarkedImages: ['custom-parent.jpg'],
      existingFlag: true,
      sourceDescriptionRu: 'Старое описание',
    },
    variants: [{ sku: '123', attrs: { Цвет: 'красный' } }],
    modelId: 'old-model',
    status: 'collected',
    createdAt: new Date('2026-06-18T00:00:00.000Z'),
    updatedAt: new Date('2026-06-18T00:00:00.000Z'),
  };

  return {
    authenticate: vi.fn(async (request: any) => {
      request.user = { userId: 'user-1' };
    }),
    supplyGoodsFindFirst: vi.fn(async ({ where }: any = {}) => ({
      ...record,
      id: typeof where?.id === 'string' ? where.id : record.id,
    })),
    supplyGoodsCreate: vi.fn(async ({ data }: any) => ({
      ...record,
      id: 'collect-new',
      ...data,
    })),
    supplyGoodsDeleteMany: vi.fn(async () => ({ count: 0 })),
    supplyGoodsUpdate: vi.fn(async ({ where, data }: any) => ({
      ...record,
      id: where.id,
      ...data,
    })),
    supplyGoodsUpdateMany: vi.fn(async (_args: any) => ({ count: 1 })),
    supplyGoodsCount: vi.fn(async () => 1),
    supplyGoodsFindMany: vi.fn(async () => [{ ...record, updatedAt: new Date('2026-06-18T01:00:00.000Z') }]),
    shopFindFirst: vi.fn(async (_args?: any): Promise<any> => null),
    prismaQueryRaw: vi.fn(async (query: any): Promise<any[]> => {
      const text = String(query?.text || query?.sql || '');
      if (/count\(\*\)/i.test(text)) return [{ count: 1 }];
      if (/select\s+id/i.test(text)) return [{ id: 'collect-existing' }];
      return [];
    }),
    resolveCollectedPrice: vi.fn(async () => ({
      purchasePriceCny: 99,
      originalPrice: 799,
      originalCurrency: 'RUB',
      exchangeRateUsed: 0.124,
      needsReview: false,
    })),
    transferSourceProductImages: vi.fn(async ({ images }: any): Promise<{ images: string[]; diagnostic: any }> => ({
      images: Array.isArray(images) ? images : [],
      diagnostic: null,
    })),
    transferSourceProductVideos: vi.fn(async ({ sourceVideos }: any): Promise<{ videos: any[]; diagnostic: any }> => ({
      videos: Array.isArray(sourceVideos) ? sourceVideos : [],
      diagnostic: null,
    })),
    featureEvaluate: vi.fn(),
    prepareSourceListingWorkflow: vi.fn(),
    sourceCaptureEnsureLegacyProjection: vi.fn(async () => ({
      kind: 'created',
      subjectId: 'subject-legacy',
      supplyGoodsId: 'collect-new',
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
    })),
    sourceCaptureIngestLegacy: vi.fn(),
  };
});

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
}));

vi.mock('../lib/crypto.js', () => ({
  decrypt: vi.fn((value: string) => value),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: mocks.prismaQueryRaw,
    supplyGoods: {
      findFirst: mocks.supplyGoodsFindFirst,
      create: mocks.supplyGoodsCreate,
      update: mocks.supplyGoodsUpdate,
      updateMany: mocks.supplyGoodsUpdateMany,
      count: mocks.supplyGoodsCount,
      findMany: mocks.supplyGoodsFindMany,
      deleteMany: mocks.supplyGoodsDeleteMany,
      delete: vi.fn(),
    },
    shop: {
      findFirst: mocks.shopFindFirst,
    },
  },
}));

vi.mock('../services/collect-pricing.js', () => ({
  resolveCollectedPrice: mocks.resolveCollectedPrice,
}));

vi.mock('../services/source-image-transfer.js', () => ({
  transferSourceProductImages: mocks.transferSourceProductImages,
}));

vi.mock('../services/source-video-transfer.js', () => ({
  transferSourceProductVideos: mocks.transferSourceProductVideos,
}));

async function buildApp(
  featureEvaluate = mocks.featureEvaluate,
  sourceCaptureService?: {
    ensureLegacyProjection?: NonNullable<CollectRoutesOptions['sourceCaptureService']>['ensureLegacyProjection'];
    ingestLegacy: NonNullable<CollectRoutesOptions['sourceCaptureService']>['ingestLegacy'];
  },
) {
  const app = Fastify();
  await app.register(collectRoutes, {
    prefix: '/api/collect',
    featureFlags: { evaluate: featureEvaluate },
    sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
    ...(sourceCaptureService ? {
      sourceCaptureService: {
        ensureLegacyProjection: mocks.sourceCaptureEnsureLegacyProjection,
        ...sourceCaptureService,
      },
    } : {}),
  });
  await app.ready();
  return app;
}

function collectedOzonItem() {
  return {
    title: 'New collected title',
    publishTitle: 'Новый исходный заголовок',
    sourceTitleRaw: 'Новый исходный заголовок',
    sourceLocale: 'ru',
    sourceUrl: 'https://www.ozon.ru/product/new-item-123/',
    sourcePlatform: 'ozon',
    sourceProductId: '123',
    sku: '123',
    images: ['new-a.jpg', 'new-b.jpg'],
    priceText: '799',
    currency: 'RUB',
    description: 'Новое описание карточки',
    richDescriptionJson: '{"blocks":[]}',
    sourceVideos: [{ url: 'https://cdn.example.com/demo.mp4', coverUrl: 'https://cdn.example.com/demo.jpg' }],
    ozonAttributes: [{ id: 1, values: [{ value: 'значение' }] }],
    descriptionCategoryId: 17028706,
    typeId: 95913,
    weightG: 510,
    lengthMm: 220,
    widthMm: 180,
    heightMm: 70,
    manufacturerName: 'Factory',
    brandName: 'Brand',
    variants: [{ sku: '123', attrs: { Цвет: 'синий' } }, { sku: '124', attrs: { Цвет: 'черный' } }],
    modelId: 'new-model',
    widgetStatesDump: { recursiveVariantDiscovery: { finalVariantCount: 2 } },
  };
}

describe('collectRoutes batch upsert', () => {
  afterEach(() => {
    vi.clearAllMocks();
    mocks.featureEvaluate.mockResolvedValue({
      enabled: false,
      legacyAllowed: true,
      captureStage: null,
      reason: 'master_off',
      revision: 'master-off',
    });
    mocks.sourceCaptureIngestLegacy.mockResolvedValue({
      kind: 'created',
      subjectId: 'subject-legacy',
      snapshotId: 'snapshot-legacy',
      snapshotVersion: 1,
      supplyGoodsId: 'collect-new',
      captureHash: 'a'.repeat(64),
      profile: {},
    });
    mocks.prepareSourceListingWorkflow.mockResolvedValue({ drafts: [], failures: [] });
    mocks.sourceCaptureEnsureLegacyProjection.mockResolvedValue({
      kind: 'created',
      subjectId: 'subject-legacy',
      supplyGoodsId: 'collect-new',
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
    });
  });

  it('shadow-writes a legacy collect as incomplete provenance without changing the legacy response', async () => {
    mocks.featureEvaluate.mockResolvedValue({
      enabled: true,
      legacyAllowed: true,
      captureStage: 'shadow_write',
      reason: 'pilot_match',
      revision: 'capture-shadow-1',
    });
    const app = await buildApp(mocks.featureEvaluate, {
      ingestLegacy: mocks.sourceCaptureIngestLegacy,
    });

    try {
      const item = collectedOzonItem();
      item.sourcePlatform = '1688';
      item.sourceProductId = '1000000000236';
      item.sourceUrl = 'https://detail.1688.com/offer/1000000000236.html';
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/batch',
        payload: { items: [item] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: { saved: 1, errors: [] } });
      expect(mocks.sourceCaptureEnsureLegacyProjection).toHaveBeenCalledWith({
        trusted: {
          ownerUserId: 'user-1',
          actorUserId: 'user-1',
          rolloutRevision: 'capture-shadow-1',
          rolloutStage: 'shadow_write',
          ingestChannel: 'LEGACY_ADAPTER',
        },
        item,
      });
      expect(mocks.sourceCaptureIngestLegacy).toHaveBeenCalledWith({
        trusted: {
          ownerUserId: 'user-1',
          actorUserId: 'user-1',
          rolloutRevision: 'capture-shadow-1',
          rolloutStage: 'shadow_write',
          ingestChannel: 'LEGACY_ADAPTER',
        },
        item,
        supplyGoodsId: 'collect-new',
      });
    } finally {
      await app.close();
    }
  });

  it('preserves a legacy batch category path through the canonical snapshot, profile, and projection', async () => {
    mocks.featureEvaluate.mockResolvedValue({
      enabled: true,
      legacyAllowed: true,
      captureStage: 'shadow_write',
      reason: 'pilot_match',
      revision: 'capture-shadow-category-1',
    });
    const capturedLegacyWrites: PreparedLegacySourceCapture[] = [];
    const repository: SourceCaptureRepository = {
      ingestNative: vi.fn(),
      ensureLegacyProjection: vi.fn(async (_input: PreparedLegacyProjection) => ({
        kind: 'created' as const,
        subjectId: 'subject-category',
        supplyGoodsId: 'collect-category',
        createdAt: new Date('2026-07-14T00:00:00.000Z'),
      })),
      loadLegacyProjection: vi.fn(async () => ({
        id: 'collect-category',
        createdAt: new Date('2026-07-14T00:00:00.000Z'),
      })),
      ingestLegacy: vi.fn(async (input: PreparedLegacySourceCapture) => {
        capturedLegacyWrites.push(input);
        return {
          kind: 'created' as const,
          subjectId: 'subject-category',
          snapshotId: 'snapshot-category',
          snapshotVersion: 1,
          supplyGoodsId: input.supplyGoodsId,
          captureHash: input.captureHash,
        };
      }),
    };
    const sourceCaptureService = createSourceCaptureService({ repository });
    const app = await buildApp(mocks.featureEvaluate, sourceCaptureService);

    try {
      const item = {
        ...collectedOzonItem(),
        sourcePlatform: '1688',
        sourceProductId: '1000000000236',
        sourceUrl: 'https://detail.1688.com/offer/1000000000236.html',
        sourceCategoryId: '1038375',
        categoryName: '保温杯',
        categoryPath: ['日用百货', '杯具', '保温杯'],
      };
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/batch',
        payload: { items: [item] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: { saved: 1, errors: [] } });
      expect(capturedLegacyWrites).toHaveLength(1);
      const prepared = capturedLegacyWrites[0]!;
      expect(prepared.capture.sourceCategory).toMatchObject({
        id: '1038375',
        name: '保温杯',
        path: [
          {
            ordinal: 0,
            id: null,
            name: '日用百货',
            fieldEvidence: {
              id: { sourceType: 'legacy', sourcePath: '/legacy/categoryPath/0/id', value: null },
              name: { sourceType: 'legacy', sourcePath: '/legacy/categoryPath/0', value: '日用百货' },
            },
          },
          { ordinal: 1, id: null, name: '杯具' },
          { ordinal: 2, id: null, name: '保温杯' },
        ],
      });
      expect(prepared.capture.completeness.sections).toContainEqual({
        section: 'category',
        status: 'complete',
        missingFieldPaths: [],
      });
      expect(prepared.capture.completeness.missingFieldPaths).not.toContain('/sourceCategory/path');
      expect(prepared.profile).toMatchObject({
        categoryPath: ['日用百货', '杯具', '保温杯'],
        categoryName: '保温杯',
      });
      expect(prepared.projection.metadata).toMatchObject({
        sourceCategoryId: '1038375',
        categoryPath: ['日用百货', '杯具', '保温杯'],
        sourceProductProfile: {
          categoryPath: ['日用百货', '杯具', '保温杯'],
          categoryName: '保温杯',
        },
      });
    } finally {
      await app.close();
    }
  });

  it('updates the snapshot-bound legacy projection on repeated shadow capture', async () => {
    mocks.featureEvaluate.mockResolvedValue({
      enabled: true,
      legacyAllowed: true,
      captureStage: 'shadow_write',
      reason: 'pilot_match',
      revision: 'capture-shadow-1',
    });
    mocks.sourceCaptureEnsureLegacyProjection.mockResolvedValueOnce({
      kind: 'reused',
      subjectId: 'subject-legacy',
      supplyGoodsId: 'collect-bound',
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
    });
    mocks.supplyGoodsFindFirst.mockResolvedValueOnce({
      id: 'collect-bound',
      userId: 'user-1',
      title: 'Previously captured title',
      sourcePlatform: '1688',
      sourceProductId: '1000000000236',
      createdAt: new Date('2026-07-14T00:00:00.000Z'),
      metadata: {
        existingFlag: true,
        sourceCaptureV2: {
          subjectId: 'subject-legacy',
          snapshotId: 'snapshot-v1',
          snapshotVersion: 1,
        },
      },
    } as any);
    const app = await buildApp(mocks.featureEvaluate, {
      ingestLegacy: mocks.sourceCaptureIngestLegacy,
    });

    try {
      const item = collectedOzonItem();
      item.sourcePlatform = '1688';
      item.sourceProductId = '1000000000236';
      item.sourceUrl = 'https://detail.1688.com/offer/1000000000236.html';
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/batch',
        payload: { items: [item] },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.supplyGoodsCreate).not.toHaveBeenCalled();
      expect(mocks.supplyGoodsUpdate).toHaveBeenCalledWith(expect.objectContaining({
        where: { id: 'collect-bound' },
        data: expect.objectContaining({
          metadata: expect.objectContaining({
            sourceCaptureV2: expect.objectContaining({
              snapshotId: 'snapshot-v1',
              snapshotVersion: 1,
            }),
          }),
        }),
      }));
      expect(mocks.sourceCaptureIngestLegacy).toHaveBeenCalledWith(expect.objectContaining({
        supplyGoodsId: 'collect-bound',
      }));
    } finally {
      await app.close();
    }
  });

  it('keeps a successful legacy collect response when its shadow snapshot fails', async () => {
    mocks.featureEvaluate.mockResolvedValue({
      enabled: true,
      legacyAllowed: true,
      captureStage: 'shadow_write',
      reason: 'pilot_match',
      revision: 'capture-shadow-1',
    });
    mocks.sourceCaptureIngestLegacy.mockRejectedValueOnce(new Error('shadow unavailable'));
    const app = await buildApp(mocks.featureEvaluate, {
      ingestLegacy: mocks.sourceCaptureIngestLegacy,
    });

    try {
      const item = collectedOzonItem();
      item.sourcePlatform = '1688';
      item.sourceProductId = '1000000000236';
      item.sourceUrl = 'https://detail.1688.com/offer/1000000000236.html';
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/batch',
        payload: { items: [item] },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: { saved: 1, errors: [] } });
    } finally {
      await app.close();
    }
  });

  it('blocks a legacy capture before persistence for a V2-only rollout', async () => {
    mocks.featureEvaluate.mockResolvedValue({
      enabled: true,
      legacyAllowed: false,
      captureStage: 'v2_only',
      reason: 'pilot_match',
      revision: 'capture-v2-only-1',
    });
    const app = await buildApp(mocks.featureEvaluate, {
      ingestLegacy: mocks.sourceCaptureIngestLegacy,
    });

    try {
      const item = collectedOzonItem();
      item.sourcePlatform = '1688';
      item.sourceProductId = '1000000000236';
      item.sourceUrl = 'https://detail.1688.com/offer/1000000000236.html';
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/batch',
        payload: { items: [item] },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'source_capture_v2_required',
        rolloutRevision: 'capture-v2-only-1',
      });
      expect(mocks.supplyGoodsCreate).not.toHaveBeenCalled();
      expect(mocks.sourceCaptureEnsureLegacyProjection).not.toHaveBeenCalled();
      expect(mocks.sourceCaptureIngestLegacy).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects an oversized legacy batch instead of silently slicing it', async () => {
    const app = await buildApp(mocks.featureEvaluate, {
      ingestLegacy: mocks.sourceCaptureIngestLegacy,
    });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/batch',
        payload: { items: Array.from({ length: 51 }, () => collectedOzonItem()) },
      });
      expect(response.statusCode).toBe(413);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'source_collect_batch_limit_exceeded',
        data: { observedCount: 51, limit: 50, recoverable: true },
      });
      expect(mocks.supplyGoodsCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('blocks the legacy publish endpoint before loading goods or an Ozon client', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      userId: 'user-1',
      platform: 'OZON',
      status: 'ACTIVE',
      clientId: 'client-id',
      apiKeyEncrypted: 'encrypted-key',
    });
    mocks.featureEvaluate.mockResolvedValue({
      enabled: true,
      legacyAllowed: false,
      captureStage: null,
      listingStage: 'v2_only',
      reason: 'pilot_match',
      revision: 'pilot-1',
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/publish-ozon',
        payload: { ids: ['source-1'], shopId: 'shop-1' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'source_ozon_publisher_v2_required',
      });
      expect(mocks.supplyGoodsFindMany).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('blocks the legacy writer when listing is v2-only but the publisher flag is off', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE',
      clientId: 'client-id', apiKeyEncrypted: 'encrypted-key',
    });
    mocks.supplyGoodsFindMany.mockResolvedValueOnce([{
      id: 'source-1', userId: 'user-1', sku: 'sku-a', title: 'Source',
      currency: 'RUB', purchasePrice: 10, metadata: {}, images: [], variants: [],
    }] as any);
    mocks.prepareSourceListingWorkflow.mockResolvedValue({
      drafts: [{ supplyGoodsId: 'source-1', draftId: 'draft-1', draftVersion: 1, revision: 1 }],
      failures: [],
    });
    mocks.featureEvaluate.mockImplementation(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
      ? { enabled: true, legacyAllowed: false, listingStage: 'v2_only', captureStage: null, reason: 'pilot_match', revision: 'listing-r1' }
      : { enabled: false, legacyAllowed: true, captureStage: null, reason: 'master_off', revision: 'publisher-off' });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/collect/publish-ozon',
        payload: { ids: ['source-1'], shopId: 'shop-1' },
      });
      expect(response.statusCode, response.body).toBe(503);
      expect(response.json()).toMatchObject({
        errorCode: 'source_workflow_rollout_unavailable',
      });
      expect(mocks.supplyGoodsFindMany).not.toHaveBeenCalled();
      expect(mocks.prepareSourceListingWorkflow).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('characterizes null and zero survival through batch metadata and source profile today', async () => {
    mocks.supplyGoodsCreate.mockImplementationOnce(async ({ data }: any) => ({
      id: 'collect-null-zero',
      ...data,
    }));
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/batch',
        payload: {
          items: [{
            title: '1688 null zero fixture',
            sourceUrl: 'https://detail.1688.com/offer/100000000001.html',
            sourcePlatform: '1688',
            sourceProductId: '100000000001',
            sku: '100000000001',
            images: ['https://img.example.com/item.jpg'],
            priceText: '10',
            currency: 'CNY',
            weightG: null,
            lengthMm: null,
            widthMm: 0,
            heightMm: 0,
            shippingCny: null,
            totalCostCny: 0,
            variants: [
              { sku: 'unknown-stock', stock: null },
              { sku: 'zero-stock', stock: 0 },
            ],
          }],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: { saved: 1, errors: [] } });
      const createData = mocks.supplyGoodsCreate.mock.calls[0]?.[0]?.data;
      expect(createData.variants).toEqual([
        { sku: 'unknown-stock', stock: null },
        { sku: 'zero-stock', stock: 0 },
      ]);
      expect(createData.metadata).toMatchObject({
        // Current V1 loss: physical nulls collapse to zero before JSONB persistence.
        weightG: 0,
        lengthMm: 0,
        widthMm: 0,
        heightMm: 0,
        // Money retains the distinction because the batch route reapplies explicit null.
        shippingCny: null,
        totalCostCny: 0,
        sourceProductProfile: {
          packaging: {
            hasWeight: false,
            hasDimensions: false,
            status: 'missing',
          },
        },
      });
      expect(createData.metadata.sourceProductProfile).not.toHaveProperty('stock');
      expect(createData.metadata.sourceProductProfile).not.toHaveProperty('shippingCny');
    } finally {
      await app.close();
    }
  });

  it('documents the metadata helper collapse independently of HTTP serialization', () => {
    const unknown = buildCollectedGoodsMetadata({
      sourcePlatform: '1688',
      sourceProductId: 'unknown',
      weightG: null,
      shippingCny: null,
    });
    const explicitZero = buildCollectedGoodsMetadata({
      sourcePlatform: '1688',
      sourceProductId: 'zero',
      weightG: 0,
      shippingCny: 0,
    });

    expect(unknown).toMatchObject({ weightG: 0, shippingCny: 0 });
    expect(explicitZero).toMatchObject({ weightG: 0, shippingCny: 0 });
  });

  it('saves manual package overrides per source variant SKU', async () => {
    mocks.supplyGoodsFindFirst.mockResolvedValueOnce({
      id: 'source-1',
      userId: 'user-1',
      title: '1688 product',
      sourcePlatform: '1688',
      sku: '977824333829',
      images: [],
      metadata: { weightG: 200, lengthMm: 370, widthMm: 320, heightMm: 60 },
      variants: [
        { sku: 'white-m', attrs: { 颜色: '白色', 尺码: 'M' }, price: '48.8' },
        { sku: 'white-l', attrs: { 颜色: '白色', 尺码: 'L' }, price: '49.8' },
      ],
    } as any);
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/save-customization',
        payload: {
          id: 'source-1',
          expectedUpdatedAt: '2026-06-18T00:00:00.000Z',
          variants: [
            { sku: 'white-m', weightG: 200, lengthMm: 370, widthMm: 320, heightMm: 60 },
            { sku: 'white-l', weightG: 211, lengthMm: 370, widthMm: 320, heightMm: 60 },
          ],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1 });
      const updateArgs = mocks.supplyGoodsUpdateMany.mock.calls[0]?.[0];
      expect(updateArgs.data.variants).toEqual([
        expect.objectContaining({ sku: 'white-m', weight: 200, depth: 370, width: 320, height: 60 }),
        expect.objectContaining({ sku: 'white-l', weight: 211, depth: 370, width: 320, height: 60 }),
      ]);
    } finally {
      await app.close();
    }
  });

  it('rejects saving an empty publish image list', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/save-customization',
        payload: {
          id: 'source-1',
          images: [],
          expectedUpdatedAt: '2026-06-18T00:00:00.000Z',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ code: 'EMPTY_PUBLISH_IMAGES' });
      expect(mocks.supplyGoodsUpdateMany).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('uses the expected target version when saving publish images', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/save-customization',
        payload: {
          id: 'source-1',
          images: ['approved.jpg'],
          sourceDetailImages: ['detail.jpg'],
          expectedUpdatedAt: '2026-06-18T00:00:00.000Z',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { images: ['approved.jpg'], metadata: { watermarkedImages: ['approved.jpg'] } },
      });
      expect(mocks.supplyGoodsUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          id: 'source-1', userId: 'user-1', updatedAt: new Date('2026-06-18T00:00:00.000Z'),
        }),
      }));
    } finally {
      await app.close();
    }
  });

  it('returns the authoritative target state when a publish image CAS conflicts', async () => {
    mocks.supplyGoodsUpdateMany.mockResolvedValueOnce({ count: 0 });
    const authoritative = {
      id: 'source-1',
      userId: 'user-1',
      title: '1688 product',
      images: ['newer.jpg'],
      metadata: { watermarkedImages: ['newer.jpg'] },
      variants: [],
      updatedAt: new Date('2026-06-18T02:00:00.000Z'),
    };
    mocks.supplyGoodsFindFirst
      .mockResolvedValueOnce({ ...authoritative, updatedAt: new Date('2026-06-18T01:00:00.000Z') } as any)
      .mockResolvedValueOnce(authoritative as any);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/save-customization',
        payload: {
          id: 'source-1',
          images: ['stale.jpg'],
          expectedUpdatedAt: '2026-06-18T01:00:00.000Z',
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 'TARGET_CONFLICT',
        data: {
          updatedAt: '2026-06-18T02:00:00.000Z',
          images: ['newer.jpg'],
          metadata: { watermarkedImages: ['newer.jpg'] },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('creates a source collect record with complete 1688 metadata through the single collect endpoint', async () => {
    mocks.transferSourceProductImages.mockResolvedValueOnce({
      images: ['https://ss-erp.com/api/cdn/users/user-1/raw/1688-main.jpg'],
      diagnostic: {
        enabled: true,
        backend: 'oss',
        attempted: 1,
        transferred: 1,
        skipped: 0,
        errors: [],
      },
    });
    mocks.transferSourceProductImages.mockResolvedValueOnce({
      images: ['https://ss-erp.com/api/cdn/users/user-1/raw/1688-detail-1.jpg'],
      diagnostic: {
        enabled: true,
        backend: 'oss',
        attempted: 1,
        transferred: 1,
        skipped: 0,
        errors: [],
      },
    });
    const app = await buildApp();

    try {
      const payload = {
        title: '智能保温杯批发',
        sourceTitleRaw: '智能保温杯批发',
        sourceLocale: 'zh-CN',
        sourceUrl: 'https://detail.1688.com/offer/744455566677.html',
        sourcePlatform: '1688',
        sourceProductId: '744455566677',
        sku: '744455566677',
        images: ['https://img.example.com/main.jpg'],
        sourceMainImages: ['https://img.example.com/main.jpg'],
        sourceDetailImages: ['https://img.example.com/detail-1.jpg'],
        sourcePackagingRows: [{
          color: '红色',
          size: '500ml',
          lengthMm: 80,
          widthMm: 80,
          heightMm: 220,
          volumeCm3: 1408,
          weightG: 350,
        }],
        sourceRichContentDraft: {
          status: 'raw_source_requires_processing',
          source: '1688',
          locale: 'zh-CN',
          blocks: [
            { type: 'text', text: '双层真空保温，适合跨境上架。' },
            { type: 'image', url: 'https://img.example.com/detail-1.jpg' },
          ],
        },
        priceText: '¥18.80 ~ ¥22.50',
        displayPrice: '18.80-22.50',
        ladderPrices: [{ minQuantity: 2, price: 22.5 }, { minQuantity: 50, price: 18.8 }],
        currency: 'CNY',
        shippingCny: 5,
        totalCostCny: 23.8,
        priceSourceType: 'sku',
        priceConfidence: 'high',
        weightG: 350,
        lengthMm: 80,
        widthMm: 80,
        heightMm: 220,
        categoryPath: ['日用百货', '杯具', '保温杯'],
        categoryName: '保温杯',
        attributes: [
          { name: '材质', value: '316不锈钢' },
          { name: '容量', value: '500ml' },
        ],
        description: '双层真空保温，适合跨境上架。',
        sourceVideos: [{ url: 'https://video.example.com/a.mp4', coverUrl: 'https://img.example.com/video.jpg' }],
        selectedSku: { skuId: 'red-500', price: 18.8, attrs: { 颜色: '红色' } },
        skuItems: [{ skuId: 'red-500', price: 18.8, images: ['https://img.example.com/red.jpg'] }],
        variants: [{ skuId: 'red-500', price: 18.8, attrs: { 颜色: '红色' } }],
        rawSourceProduct: { offerId: '744455566677' },
        rejectedAssets: [{ url: 'https://img.example.com/icon.svg', reason: 'svg' }],
        extractionDiagnostics: {
          titleFound: true,
          imageCount: 1,
          detailImageCount: 1,
          rejectedImageCount: 1,
          skuCount: 1,
          skuSource: 'skuMap',
          attributeCount: 2,
          packagingCount: 1,
          descriptionFound: true,
          videoCount: 1,
          priceSourceType: 'sku',
          priceConfidence: 'high',
          missing: [],
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/collect',
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { id: 'collect-new' },
      });

      const createArgs = mocks.supplyGoodsCreate.mock.calls[0]?.[0];
      expect(createArgs.data).toMatchObject({
        title: '智能保温杯批发',
        sourceUrl: 'https://detail.1688.com/offer/744455566677.html',
        sourcePlatform: '1688',
        sourceProductId: '744455566677',
        sku: '744455566677',
        images: ['https://ss-erp.com/api/cdn/users/user-1/raw/1688-main.jpg'],
        variants: [{ skuId: 'red-500', price: 18.8, attrs: { 颜色: '红色' } }],
      });
      expect(mocks.transferSourceProductImages).toHaveBeenCalledWith({
        images: ['https://img.example.com/main.jpg'],
        sourcePlatform: '1688',
        userId: 'user-1',
      });
      expect(mocks.transferSourceProductImages).toHaveBeenCalledWith({
        images: ['https://img.example.com/detail-1.jpg'],
        sourcePlatform: '1688',
        userId: 'user-1',
      });
      expect(mocks.transferSourceProductVideos).not.toHaveBeenCalled();
      expect(createArgs.data.metadata).toMatchObject({
        titleNeedsReview: true,
        sourcePlatform: '1688',
        sourceTitleRaw: '智能保温杯批发',
        sourceLocale: 'zh-CN',
        sourceDescriptionRaw: '双层真空保温，适合跨境上架。',
        sourceMainImages: ['https://ss-erp.com/api/cdn/users/user-1/raw/1688-main.jpg'],
        sourceDetailImages: ['https://ss-erp.com/api/cdn/users/user-1/raw/1688-detail-1.jpg'],
        sourcePackagingRows: [{
          color: '红色',
          size: '500ml',
          lengthMm: 80,
          widthMm: 80,
          heightMm: 220,
          volumeCm3: 1408,
          weightG: 350,
        }],
        sourceRichContentDraft: {
          status: 'raw_source_requires_processing',
          source: '1688',
          locale: 'zh-CN',
          blocks: [
            { type: 'text', text: '双层真空保温，适合跨境上架。' },
            { type: 'image', url: 'https://ss-erp.com/api/cdn/users/user-1/raw/1688-detail-1.jpg' },
          ],
        },
        sourceVideos: [{
          url: 'https://video.example.com/a.mp4',
          coverUrl: 'https://img.example.com/video.jpg',
        }],
        categoryPath: ['日用百货', '杯具', '保温杯'],
        categoryName: '保温杯',
        sourceAttributes: [
          { name: '材质', value: '316不锈钢' },
          { name: '容量', value: '500ml' },
        ],
        priceText: '¥18.80 ~ ¥22.50',
        displayPrice: '18.80-22.50',
        ladderPrices: [{ minQuantity: 2, price: 22.5 }, { minQuantity: 50, price: 18.8 }],
        shippingCny: 5,
        totalCostCny: 23.8,
        priceSourceType: 'sku',
        priceConfidence: 'high',
        weightG: 350,
        lengthMm: 80,
        widthMm: 80,
        heightMm: 220,
        selectedSku: { skuId: 'red-500', price: 18.8, attrs: { 颜色: '红色' } },
        skuItems: [{ skuId: 'red-500', price: 18.8, images: ['https://img.example.com/red.jpg'] }],
        rawSourceProduct: { offerId: '744455566677' },
        rejectedAssets: [{ url: 'https://img.example.com/icon.svg', reason: 'svg' }],
        extractionDiagnostics: {
          titleFound: true,
          imageCount: 1,
          detailImageCount: 1,
          rejectedImageCount: 1,
          skuCount: 1,
          skuSource: 'skuMap',
          attributeCount: 2,
          packagingCount: 1,
          descriptionFound: true,
          videoCount: 1,
          priceSourceType: 'sku',
          priceConfidence: 'high',
          missing: [],
        },
        sourceImageTransfer: {
          enabled: true,
          backend: 'oss',
          attempted: 1,
          transferred: 1,
          skipped: 0,
          errors: [],
        },
        sourceDetailImageTransfer: {
          enabled: true,
          backend: 'oss',
          attempted: 1,
          transferred: 1,
          skipped: 0,
          errors: [],
        },
      });
      expect(createArgs.data.metadata).not.toHaveProperty('sourceDescriptionRu');
    } finally {
      await app.close();
    }
  });

  it('retransfers failed source videos without reuploading already transferred videos', async () => {
    mocks.shopFindFirst.mockResolvedValueOnce({
      id: 'shop-1',
      userId: 'user-1',
      platform: 'OZON',
    });
    mocks.supplyGoodsFindFirst.mockResolvedValueOnce({
      id: 'source-1',
      userId: 'user-1',
      title: '吊带短睡裙',
      sourceUrl: 'https://detail.1688.com/offer/1002159365821.html',
      sourcePlatform: '1688',
      sourceProductId: '1002159365821',
      sku: '1002159365821',
      images: [],
      purchasePrice: { toString: () => '25.00' },
      currency: 'CNY',
      originalPrice: null,
      originalCurrency: null,
      exchangeRateUsed: null,
      priceNeedsReview: false,
      notes: null,
      metadata: {
        sourcePlatform: '1688',
        sourceVideos: [
          {
            url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/failed.mp4',
            coverUrl: 'https://img.example.com/failed.jpg',
            transferStatus: 'failed',
            transferReason: 'download_timeout',
          },
          {
            url: 'https://ss-erp.com/api/cdn/users/user-1/video/done.mp4',
            originalUrl: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/done.mp4',
            transferStatus: 'uploaded',
            transferReason: 'direct_video',
          },
        ],
        sourceVideoTransfer: {
          enabled: true,
          attempted: 1,
          transferred: 0,
          skipped: 0,
          errors: [{ url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/failed.mp4', error: 'timeout' }],
        },
      },
      variants: [],
      modelId: null,
      status: 'collected',
      createdAt: new Date('2026-06-18T00:00:00.000Z'),
      updatedAt: new Date('2026-06-18T00:00:00.000Z'),
    } as any);
    mocks.transferSourceProductVideos.mockResolvedValueOnce({
      videos: [{
        url: 'https://ss-erp.com/api/cdn/users/user-1/video/failed.mp4',
        originalUrl: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/failed.mp4',
        coverUrl: 'https://img.example.com/failed.jpg',
        transferStatus: 'uploaded',
        transferReason: 'direct_video',
      }],
      diagnostic: {
        enabled: true,
        backend: 'oss',
        attempted: 1,
        transferred: 1,
        skipped: 0,
        errors: [],
        entries: [{
          originalUrl: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/failed.mp4',
          url: 'https://ss-erp.com/api/cdn/users/user-1/video/failed.mp4',
          status: 'uploaded',
          reason: 'direct_video',
          contentType: 'video/mp4',
          contentLength: '1712183',
        }],
      },
    });
    mocks.supplyGoodsUpdate.mockImplementationOnce(async ({ where, data }: any) => ({
      id: where.id,
      userId: 'user-1',
      title: '吊带短睡裙',
      sourcePlatform: '1688',
      metadata: data.metadata,
      updatedAt: new Date('2026-06-18T01:00:00.000Z'),
    }));
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/source-1/videos/retransfer',
        payload: { shopId: 'shop-1' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.shopFindFirst).toHaveBeenCalledWith({
        where: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
      });
      expect(mocks.transferSourceProductVideos).toHaveBeenCalledWith({
        sourceVideos: [{
          url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/failed.mp4',
          coverUrl: 'https://img.example.com/failed.jpg',
        }],
        sourcePlatform: '1688',
        userId: 'user-1',
        shopId: 'shop-1',
      });
      const updateArgs = mocks.supplyGoodsUpdate.mock.calls[0]?.[0];
      expect(updateArgs.where).toEqual({ id: 'source-1' });
      expect(updateArgs.data.metadata.sourceVideos).toEqual([
        {
          url: 'https://ss-erp.com/api/cdn/users/user-1/video/failed.mp4',
          originalUrl: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/failed.mp4',
          coverUrl: 'https://img.example.com/failed.jpg',
          transferStatus: 'uploaded',
          transferReason: 'direct_video',
        },
        {
          url: 'https://ss-erp.com/api/cdn/users/user-1/video/done.mp4',
          originalUrl: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/done.mp4',
          transferStatus: 'uploaded',
          transferReason: 'direct_video',
        },
      ]);
      expect(updateArgs.data.metadata.sourceVideoTransfer).toMatchObject({
        enabled: true,
        transferred: 1,
      });
      expect(response.json()).toMatchObject({
        code: 1,
        msg: '视频重新转存完成',
        data: {
          item: {
            id: 'source-1',
            metadata: {
              sourceVideoTransfer: {
                transferred: 1,
              },
            },
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('reports manual source video retransfer failure when every attempted video fails', async () => {
    mocks.shopFindFirst.mockResolvedValueOnce({
      id: 'shop-1',
      userId: 'user-1',
      platform: 'OZON',
    });
    mocks.supplyGoodsFindFirst.mockResolvedValueOnce({
      id: 'source-1',
      userId: 'user-1',
      title: '吊带短睡裙',
      sourceUrl: 'https://detail.1688.com/offer/1002159365821.html',
      sourcePlatform: '1688',
      sourceProductId: '1002159365821',
      sku: '1002159365821',
      images: [],
      purchasePrice: { toString: () => '25.00' },
      currency: 'CNY',
      originalPrice: null,
      originalCurrency: null,
      exchangeRateUsed: null,
      priceNeedsReview: false,
      notes: null,
      metadata: {
        sourcePlatform: '1688',
        sourceVideos: [
          {
            url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/failed.mp4',
            transferStatus: 'failed',
            transferReason: 'transfer_failed',
          },
        ],
      },
      variants: [],
      modelId: null,
      status: 'collected',
      createdAt: new Date('2026-06-18T00:00:00.000Z'),
      updatedAt: new Date('2026-06-18T00:00:00.000Z'),
    } as any);
    mocks.transferSourceProductVideos.mockResolvedValueOnce({
      videos: [{
        url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/failed.mp4',
        transferStatus: 'failed',
        transferReason: 'transfer_failed',
      }],
      diagnostic: {
        enabled: true,
        backend: undefined,
        attempted: 1,
        transferred: 0,
        skipped: 0,
        errors: [{ url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/failed.mp4', error: 'OZON 视频上传连接失败 — 底层错误: ERR_HTTP2_STREAM_ERROR' }],
        entries: [{
          originalUrl: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/failed.mp4',
          status: 'failed',
          reason: 'transfer_failed',
          message: 'OZON 视频上传连接失败 — 底层错误: ERR_HTTP2_STREAM_ERROR',
        }],
      },
    });
    mocks.supplyGoodsUpdate.mockImplementationOnce(async ({ where, data }: any) => ({
      id: where.id,
      userId: 'user-1',
      title: '吊带短睡裙',
      sourcePlatform: '1688',
      metadata: data.metadata,
      updatedAt: new Date('2026-06-18T01:00:00.000Z'),
    }));
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/source-1/videos/retransfer',
        payload: { shopId: 'shop-1' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 0,
        msg: expect.stringContaining('视频重新转存失败'),
        data: {
          item: {
            metadata: {
              sourceVideoTransfer: {
                attempted: 1,
                transferred: 0,
                errors: [
                  expect.objectContaining({
                    error: expect.stringContaining('ERR_HTTP2_STREAM_ERROR'),
                  }),
                ],
              },
            },
          },
        },
      });
    } finally {
      await app.close();
    }
  });

  it('filters the collect list between Ozon follow records and domestic source records', async () => {
    const app = await buildApp();

    try {
      mocks.prismaQueryRaw.mockClear();
      const ozonResponse = await app.inject({
        method: 'GET',
        url: '/api/collect?sourceGroup=ozon',
      });
      expect(ozonResponse.statusCode).toBe(200);
      const ozonSql = mocks.prismaQueryRaw.mock.calls.map((call) => call[0]?.text || call[0]?.sql || '').join('\n');
      const ozonValues = mocks.prismaQueryRaw.mock.calls.flatMap((call) => call[0]?.values || []);
      expect(ozonSql).toContain("coalesce((metadata->>'ephemeralListing')::boolean, false) is not true");
      expect(ozonSql).toContain('source_platform =');
      expect(ozonValues).toContain('user-1');
      expect(ozonValues).toContain('ozon');

      mocks.prismaQueryRaw.mockClear();
      const sourceResponse = await app.inject({
        method: 'GET',
        url: '/api/collect?sourceGroup=source',
      });
      expect(sourceResponse.statusCode).toBe(200);
      const sourceSql = mocks.prismaQueryRaw.mock.calls.map((call) => call[0]?.text || call[0]?.sql || '').join('\n');
      const sourceValues = mocks.prismaQueryRaw.mock.calls.flatMap((call) => call[0]?.values || []);
      expect(sourceSql).toContain('source_platform in');
      expect(sourceValues).toEqual(expect.arrayContaining(['user-1', '1688', 'pdd', 'taobao', 'tmall', 'xianyu', 'goofish']));
    } finally {
      await app.close();
    }
  });

  it('keeps manual collect records visible when ephemeralListing metadata is missing', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/collect?sourceGroup=ozon&limit=20&offset=0',
      });

      expect(response.statusCode).toBe(200);
      const sql = mocks.prismaQueryRaw.mock.calls.map((call) => call[0]?.text || call[0]?.sql || '').join('\n');
      expect(sql).toContain("coalesce((metadata->>'ephemeralListing')::boolean, false) is not true");
      expect(mocks.supplyGoodsFindMany).toHaveBeenCalledWith(expect.objectContaining({
        where: {
          userId: 'user-1',
          id: { in: ['collect-existing'] },
        },
      }));
    } finally {
      await app.close();
    }
  });

  it('rejects empty domestic source shell captures before they pollute the source list', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect',
        payload: {
          title: '拼多多批发 - 拼多多官方采购批发平台，多多批发',
          sourceTitleRaw: '拼多多批发 - 拼多多官方采购批发平台，多多批发',
          sourceUrl: 'https://pifa.pinduoduo.com/',
          sourcePlatform: 'pdd',
          sourceProductId: 'cmqwo1qoj00515o7oafa0lbj9',
          sku: 'cmqwo1qoj00515o7oafa0lbj9',
          images: [],
          priceText: '¥0',
          skuItems: [],
          variants: [],
          extractionDiagnostics: {
            titleFound: true,
            imageCount: 0,
            skuCount: 0,
            fieldConfidence: { price: 'missing', images: 'missing', sku: 'missing' },
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 0,
        msg: expect.stringContaining('采集结果不完整'),
      });
      expect(mocks.supplyGoodsCreate).not.toHaveBeenCalled();
      expect(mocks.transferSourceProductImages).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('creates a new Ozon collect record for repeated manual collection', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/batch',
        payload: {
          items: [collectedOzonItem()],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { saved: 1, errors: [] },
      });

      expect(mocks.supplyGoodsFindFirst).not.toHaveBeenCalled();
      expect(mocks.supplyGoodsUpdate).not.toHaveBeenCalled();
      expect(mocks.supplyGoodsCreate).toHaveBeenCalledTimes(1);

      const createArgs = mocks.supplyGoodsCreate.mock.calls[0]?.[0];
      expect(createArgs.data).toMatchObject({
        user: { connect: { id: 'user-1' } },
        title: 'New collected title',
        sourceUrl: 'https://www.ozon.ru/product/new-item-123/',
        sourcePlatform: 'ozon',
        sourceProductId: '123',
        sku: '123',
        images: ['new-a.jpg', 'new-b.jpg'],
        purchasePrice: 99,
        currency: 'CNY',
        originalPrice: 799,
        originalCurrency: 'RUB',
        exchangeRateUsed: 0.124,
        priceNeedsReview: false,
        notes: 'Новое описание карточки',
        variants: [{ sku: '123', attrs: { Цвет: 'синий' } }, { sku: '124', attrs: { Цвет: 'черный' } }],
        modelId: 'new-model',
      });
      expect(createArgs.data.metadata).toMatchObject({
        publishTitleRu: 'Новый исходный заголовок',
        sourceTitleRaw: 'Новый исходный заголовок',
        sourceLocale: 'ru',
        sourceDescriptionRu: 'Новое описание карточки',
        sourceRichDescriptionJson: '{"blocks":[]}',
        sourceVideos: [{ url: 'https://cdn.example.com/demo.mp4', coverUrl: 'https://cdn.example.com/demo.jpg' }],
        ozonAttributes: [{ id: 1, values: [{ value: 'значение' }] }],
        descriptionCategoryId: 17028706,
        typeId: 95913,
        weightG: 510,
        lengthMm: 220,
        widthMm: 180,
        heightMm: 70,
        manufacturerName: 'Factory',
        brandName: 'Brand',
        widgetStatesDump: { recursiveVariantDiscovery: { finalVariantCount: 2 } },
      });
      expect(createArgs.data.metadata).not.toHaveProperty('existingFlag');
      expect(createArgs.data.metadata).not.toHaveProperty('watermarkedImages');
    } finally {
      await app.close();
    }
  });

  it('updates an existing Ozon collect record during enrichment', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/batch',
        payload: {
          collectPhase: 'enrichment',
          items: [collectedOzonItem()],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { saved: 1, errors: [] },
      });

      expect(mocks.supplyGoodsCreate).not.toHaveBeenCalled();
      expect(mocks.supplyGoodsUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.supplyGoodsFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          sourcePlatform: 'ozon',
        }),
        orderBy: { updatedAt: 'desc' },
      }));

      const updateArgs = mocks.supplyGoodsUpdate.mock.calls[0]?.[0];
      expect(updateArgs.where).toEqual({ id: 'collect-existing' });
      expect(updateArgs.data.metadata).toMatchObject({
        existingFlag: true,
        publishTitleRu: 'Ручной заголовок',
        publishDescriptionRu: 'Ручное описание',
        watermarkedImages: ['custom-parent.jpg'],
        sourceTitleRaw: 'Новый исходный заголовок',
        sourceDescriptionRu: 'Новое описание карточки',
        sourceRichDescriptionJson: '{"blocks":[]}',
      });
    } finally {
      await app.close();
    }
  });

  it('orders the collect list by updatedAt so refreshed SKU records are visible first', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/collect?offset=0&limit=20',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { total: 1 },
      });
      const sql = mocks.prismaQueryRaw.mock.calls.map((call) => call[0]?.text || call[0]?.sql || '').join('\n');
      expect(sql).toContain('order by updated_at desc');
    } finally {
      await app.close();
    }
  });

  it('keeps source list available when lazy source product profile persistence fails', async () => {
    const app = await buildApp();
    const legacySourceRow = {
      id: 'legacy-source-write-fails',
      title: '女士无痕内衣',
      sourcePlatform: '1688',
      sourceProductId: '945335480485',
      sku: '945335480485',
      purchasePrice: { toString: () => '8.50' },
      originalPrice: null,
      exchangeRateUsed: null,
      metadata: {
        sourceTitleRaw: '女士无痕内衣',
        sourceStandardAttributes: {
          packageWeightG: 100,
          packageDimensionsMm: null,
          missingForOzon: ['包装尺寸'],
        },
        extractionDiagnostics: {
          packaging: {
            status: 'weight_only',
            reason: 'weight_only',
            message: '只采到重量，缺包装尺寸',
          },
        },
      },
      variants: [{ sku: '945335480485', attrs: { 颜色: '黑色', 尺码: 'M' } }],
      createdAt: new Date('2026-06-18T00:00:00.000Z'),
      updatedAt: new Date('2026-06-18T01:00:00.000Z'),
    };
    mocks.prismaQueryRaw.mockImplementation(async (query: any): Promise<any[]> => {
      const text = String(query?.text || query?.sql || '');
      if (/count\(\*\)/i.test(text)) return [{ count: 1 }];
      if (/select\s+id/i.test(text)) return [{ id: 'legacy-source-write-fails' }];
      return [];
    });
    mocks.supplyGoodsFindMany.mockResolvedValueOnce([legacySourceRow as any]);
    mocks.supplyGoodsUpdate.mockRejectedValueOnce(new Error('write conflict'));

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/collect?sourceGroup=source',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.rows[0].metadata.sourceProductProfile).toMatchObject({
        sourceProductId: '945335480485',
        packaging: expect.objectContaining({
          reasonCode: 'weight_only',
        }),
      });
      expect(mocks.supplyGoodsUpdate).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('lazily persists source product profiles for legacy domestic source list rows', async () => {
    const app = await buildApp();
    const legacySourceRow = {
      id: 'legacy-source-1',
      userId: 'user-1',
      title: '女士无痕内衣',
      sourceUrl: 'https://detail.1688.com/offer/945335480485.html',
      sourcePlatform: '1688',
      sourceProductId: '945335480485',
      sku: '945335480485',
      images: ['https://img.example.com/main.jpg'],
      purchasePrice: { toString: () => '8.50' },
      currency: 'CNY',
      originalPrice: null,
      originalCurrency: null,
      exchangeRateUsed: null,
      priceNeedsReview: false,
      notes: '',
      modelId: null,
      metadata: {
        sourceTitleRaw: '女士无痕内衣',
        categoryPath: ['服饰内衣', '女士内衣'],
        sourceStandardAttributes: {
          colors: ['黑色'],
          sizes: ['M'],
          materials: ['锦纶'],
          categoryHints: ['内衣'],
          packageWeightG: 100,
          packageDimensionsMm: null,
          missingForOzon: ['包装尺寸'],
        },
        extractionDiagnostics: {
          packagingCount: 0,
          packaging: {
            status: 'weight_only',
            reason: 'weight_only',
            sectionFound: true,
            tableLike: true,
            rowCount: 0,
            hasWeight: true,
            hasDimensions: false,
            message: '只采到重量，缺包装尺寸',
          },
        },
      },
      variants: [{ sku: '945335480485', attrs: { 颜色: '黑色', 尺码: 'M' } }],
      status: 'collected',
      createdAt: new Date('2026-06-18T00:00:00.000Z'),
      updatedAt: new Date('2026-06-18T01:00:00.000Z'),
    };
    mocks.prismaQueryRaw.mockImplementation(async (query: any): Promise<any[]> => {
      const text = String(query?.text || query?.sql || '');
      if (/count\(\*\)/i.test(text)) return [{ count: 1 }];
      if (/select\s+id/i.test(text)) return [{ id: 'legacy-source-1' }];
      return [];
    });
    mocks.supplyGoodsFindMany.mockResolvedValueOnce([legacySourceRow as any]);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/collect?sourceGroup=source',
      });

      expect(response.statusCode).toBe(200);
      const row = response.json().data.rows[0];
      expect(row.metadata.sourceProductProfile).toMatchObject({
        sourceProductId: '945335480485',
        packaging: {
          status: 'weight_only',
          reasonCode: 'weight_only',
          reasonLabel: '只采到重量，缺包装尺寸',
        },
      });
      expect(mocks.supplyGoodsUpdate).toHaveBeenCalledWith({
        where: { id: 'legacy-source-1' },
        data: {
          metadata: expect.objectContaining({
            sourceProductProfile: expect.objectContaining({
              sourceProductId: '945335480485',
              packaging: expect.objectContaining({
                reasonCode: 'weight_only',
              }),
            }),
          }),
        },
      });
    } finally {
      await app.close();
    }
  });
});

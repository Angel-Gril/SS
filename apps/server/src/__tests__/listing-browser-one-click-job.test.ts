import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildOzonMarkingCodeRepairItems,
  createBrowserOneClickListingJobForActor,
  listingRoutes,
  patchBrowserOneClickListingJobForActor,
  readBrowserOneClickListingJobForActor,
} from '../routes/listing.js';
import { OzonClient } from '../services/ozon-client.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'user-1' };
  }),
  shopFindFirst: vi.fn(),
  syncJobCreate: vi.fn(),
  syncJobFindFirst: vi.fn(),
  syncJobUpdate: vi.fn(),
  syncJobUpdateMany: vi.fn(),
  queryRaw: vi.fn(),
  transaction: vi.fn(),
  getConfig: vi.fn(async (_key: string): Promise<number | undefined> => undefined),
  addBrowserOneClickListingJob: vi.fn(),
  appendBrowserOneClickListingRows: vi.fn(),
  prepareSourceListingWorkflow: vi.fn(),
  featureEvaluate: vi.fn(),
  ensureLegacyProjection: vi.fn(),
  ingestLegacy: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    shop: {
      findFirst: mocks.shopFindFirst,
    },
    syncJob: {
      create: mocks.syncJobCreate,
      findFirst: mocks.syncJobFindFirst,
      update: mocks.syncJobUpdate,
      updateMany: mocks.syncJobUpdateMany,
    },
    $queryRaw: mocks.queryRaw,
    $transaction: mocks.transaction,
  },
}));

vi.mock('../lib/crypto.js', () => ({
  decrypt: vi.fn((value: string) => value),
}));

vi.mock('../config/system-config-schema.js', () => ({
  getConfig: mocks.getConfig,
}));

vi.mock('../services/ozon-client.js', () => ({
  OzonClient: vi.fn(),
}));

vi.mock('../services/post-publish-sync.js', () => ({
  enqueueProductSyncAfterPublish: vi.fn(),
}));

vi.mock('../workers/browser-one-click-listing.js', () => ({
  addBrowserOneClickListingJob: mocks.addBrowserOneClickListingJob,
  appendBrowserOneClickListingRows: mocks.appendBrowserOneClickListingRows,
}));

async function buildApp(
  featureEvaluate = mocks.featureEvaluate,
  routeOptions: Record<string, unknown> = {},
) {
  const app = Fastify();
  await app.register(listingRoutes, {
    prefix: '/api/listing',
    featureFlags: { evaluate: featureEvaluate },
    sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
    sourceCaptureService: {
      ensureLegacyProjection: mocks.ensureLegacyProjection,
      ingestLegacy: mocks.ingestLegacy,
    },
    ...routeOptions,
  });
  await app.ready();
  return app;
}

describe('browser one-click listing jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(OzonClient).mockReset();
    mocks.syncJobFindFirst.mockResolvedValue(null);
    mocks.getConfig.mockResolvedValue(undefined);
    mocks.featureEvaluate.mockImplementation(async (feature: string) => feature === 'SOURCE_CAPTURE_V2'
      ? {
        enabled: true,
        legacyAllowed: true,
        captureStage: 'shadow_write',
        reason: 'pilot_match',
        revision: 'capture-default',
      }
      : {
        enabled: true,
        legacyAllowed: true,
        listingStage: 'dual_read',
        reason: 'pilot_match',
        revision: 'listing-default',
      });
    mocks.prepareSourceListingWorkflow.mockResolvedValue({ drafts: [], failures: [] });
    mocks.syncJobUpdateMany.mockResolvedValue({ count: 1 });
    mocks.queryRaw.mockResolvedValue([{ locked: 1 }]);
    mocks.transaction.mockImplementation(async (callback: (client: any) => unknown) => callback({
      syncJob: {
        create: mocks.syncJobCreate,
        findFirst: mocks.syncJobFindFirst,
        update: mocks.syncJobUpdate,
        updateMany: mocks.syncJobUpdateMany,
      },
      $queryRaw: mocks.queryRaw,
    }));
    mocks.ensureLegacyProjection.mockImplementation(async ({ item }: any) => ({
      kind: 'created',
      subjectId: `subject-${item.sku}`,
      supplyGoodsId: `goods-${item.sku}`,
      createdAt: new Date('2026-08-13T00:00:00.000Z'),
    }));
    mocks.ingestLegacy.mockImplementation(async ({ item, supplyGoodsId }: any) => ({
      kind: 'created',
      subjectId: `subject-${item.sku}`,
      snapshotId: `snapshot-${item.sku}`,
      snapshotVersion: 1,
      supplyGoodsId,
      captureHash: 'a'.repeat(64),
      profile: {},
    }));
  });

  it('fails closed before persistence when capture or interactive listing policy is disabled', async () => {
    mocks.shopFindFirst.mockResolvedValue({ id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE' });
    mocks.featureEvaluate.mockImplementation(async (feature: string) => feature === 'SOURCE_CAPTURE_V2'
      ? { enabled: false, legacyAllowed: true, captureStage: null, reason: 'master_off', revision: 'capture-off' }
      : { enabled: true, legacyAllowed: true, listingStage: 'dual_read', reason: 'pilot_match', revision: 'listing-r1' });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/listing/browser-one-click-jobs',
        payload: { shopId: 'shop-1', sourceSkus: ['sku-a'] },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ errorCode: 'browser_one_click_review_workflow_required' });
      expect(mocks.syncJobCreate).not.toHaveBeenCalled();
      expect(mocks.prepareSourceListingWorkflow).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('creates only a visible collecting job when capture and listing review are enabled', async () => {
    mocks.shopFindFirst.mockResolvedValue({ id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE' });
    mocks.syncJobCreate.mockResolvedValue({ id: 'job-1' });
    mocks.featureEvaluate.mockImplementation(async (feature: string) => feature === 'SOURCE_CAPTURE_V2'
      ? { enabled: true, legacyAllowed: true, captureStage: 'shadow_write', reason: 'pilot_match', revision: 'capture-r1' }
      : { enabled: true, legacyAllowed: true, listingStage: 'dual_read', reason: 'pilot_match', revision: 'listing-r2' });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/listing/browser-one-click-jobs',
        payload: { shopId: 'shop-1', sourceSkus: ['sku-a'] },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ data: { jobId: 'job-1', queued: false, deferred: true } });
      expect(mocks.syncJobCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: 'RUNNING',
          payload: expect.objectContaining({
            stage: 'preparing_browser_data',
            browserPayloadReady: false,
            browserPayloadComplete: false,
            browserOneClickWorkflow: expect.objectContaining({
              captureStage: 'shadow_write',
              listingStage: 'dual_read',
            }),
          }),
        }),
      }));
      expect(mocks.prepareSourceListingWorkflow).not.toHaveBeenCalled();
      expect(mocks.ensureLegacyProjection).not.toHaveBeenCalled();
      expect(mocks.addBrowserOneClickListingJob).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('preserves product URL slots so later SKUs cannot inherit an earlier URL', async () => {
    mocks.shopFindFirst.mockResolvedValue({ id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE' });
    mocks.syncJobCreate.mockResolvedValue({ id: 'job-url-slots' });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/browser-one-click-jobs',
        payload: {
          shopId: 'shop-1',
          sourceSkus: ['sku-a', 'sku-b'],
          productUrls: ['', 'https://www.ozon.ru/product/sku-b/'],
          itemCount: 2,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.syncJobCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          payload: expect.objectContaining({
            sourceSkus: ['sku-a', 'sku-b'],
            productUrls: ['', 'https://www.ozon.ru/product/sku-b/'],
          }),
        }),
      }));
    } finally { await app.close(); }
  });

  it.each([
    ['an empty SKU slot', { sourceSkus: ['sku-a', ''], itemCount: 2 }, 'browser_one_click_expected_skus_invalid'],
    ['a partial URL list', {
      sourceSkus: ['sku-a', 'sku-b'],
      productUrls: ['https://www.ozon.ru/product/sku-a/'],
      itemCount: 2,
    }, 'browser_one_click_product_urls_mismatch'],
  ])('rejects %s before persisting a browser job', async (_label, payload, errorCode) => {
    mocks.shopFindFirst.mockResolvedValue({ id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE' });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/browser-one-click-jobs',
        payload: { shopId: 'shop-1', ...payload },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({ errorCode });
      expect(mocks.syncJobCreate).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('replays an exact browser create intent by client request id without creating a second job', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE',
    });
    mocks.syncJobCreate.mockResolvedValue({ id: 'job-idempotent', status: 'RUNNING' });
    const request = {
      shopId: 'shop-1',
      clientRequestId: 'request_20260813_0001',
      sourceSkus: ['sku-a'],
      productUrls: ['https://www.ozon.ru/product/sku-a/'],
      publish: { markupPct: 12, randomOfferId: true },
      watermark: { type: 'image', imageUrl: 'https://cdn.example/watermark.png' },
    };
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: 'POST', url: '/api/listing/browser-one-click-jobs', payload: request,
      });
      expect(created.statusCode).toBe(200);
      const persistedPayload = mocks.syncJobCreate.mock.calls[0]![0].data.payload;
      mocks.syncJobFindFirst.mockResolvedValue({
        id: 'job-idempotent', status: 'RUNNING', payload: persistedPayload,
      });
      mocks.syncJobCreate.mockClear();

      const replayed = await app.inject({
        method: 'POST', url: '/api/listing/browser-one-click-jobs', payload: request,
      });

      expect(replayed.statusCode).toBe(200);
      expect(replayed.json()).toMatchObject({
        code: 1,
        data: { jobId: 'job-idempotent', idempotent: true },
      });
      expect(mocks.syncJobCreate).not.toHaveBeenCalled();
      expect(mocks.transaction).toHaveBeenCalledTimes(2);
      expect(mocks.queryRaw).toHaveBeenCalledTimes(2);
    } finally {
      await app.close();
    }
  });

  it('fails closed when an idempotent create cannot acquire a transaction lock', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE',
    });
    mocks.transaction.mockImplementationOnce(async (callback: (client: any) => unknown) => callback({
      syncJob: {
        create: mocks.syncJobCreate,
        findFirst: mocks.syncJobFindFirst,
      },
    }));
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/browser-one-click-jobs',
        payload: {
          shopId: 'shop-1',
          clientRequestId: 'request_20260813_no_lock',
          sourceSkus: ['sku-a'],
        },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({
        errorCode: 'browser_one_click_idempotency_unavailable',
      });
      expect(mocks.syncJobCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it.each([
    ['SKU', { sourceSkus: ['sku-b'] }],
    ['product URL', { productUrls: ['https://www.ozon.ru/product/sku-b/'] }],
    ['initial rows', { rows: [{ sku: 'sku-a', title: 'changed title' }] }],
    ['publish parameters', { publish: { markupPct: 99, randomOfferId: true } }],
    ['watermark', { watermark: { type: 'image', imageUrl: 'https://cdn.example/other.png' } }],
  ])('rejects client request id reuse with altered %s', async (_field, altered) => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE',
    });
    mocks.syncJobCreate.mockResolvedValue({ id: 'job-idempotent', status: 'RUNNING' });
    const request = {
      shopId: 'shop-1',
      clientRequestId: 'request_20260813_0002',
      sourceSkus: ['sku-a'],
      productUrls: ['https://www.ozon.ru/product/sku-a/'],
      publish: { markupPct: 12, randomOfferId: true },
      watermark: { type: 'image', imageUrl: 'https://cdn.example/watermark.png' },
    };
    const app = await buildApp();
    try {
      const created = await app.inject({
        method: 'POST', url: '/api/listing/browser-one-click-jobs', payload: request,
      });
      expect(created.statusCode).toBe(200);
      const persistedPayload = mocks.syncJobCreate.mock.calls[0]![0].data.payload;
      mocks.syncJobFindFirst.mockResolvedValue({
        id: 'job-idempotent', status: 'RUNNING', payload: persistedPayload,
      });
      mocks.syncJobCreate.mockClear();

      const replayed = await app.inject({
        method: 'POST',
        url: '/api/listing/browser-one-click-jobs',
        payload: { ...request, ...altered },
      });

      expect(replayed.statusCode).toBe(409);
      expect(replayed.json()).toMatchObject({
        code: 0,
        errorCode: 'browser_one_click_idempotency_conflict',
        terminal: true,
      });
      expect(mocks.syncJobCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('requires a durable idempotency key for device-origin creates', async () => {
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await createBrowserOneClickListingJobForActor(
      { body: { shopId: 'shop-1', sourceSkus: ['sku-a'] }, user: {} } as any,
      reply,
      {
        ownerUserId: 'user-1',
        actorUserId: 'user-1',
        allowedShopIds: ['shop-1'],
        deviceSessionId: 'device-session-1',
      },
      {
        featureFlags: { evaluate: mocks.featureEvaluate },
        sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
        sourceCaptureService: {
          ensureLegacyProjection: mocks.ensureLegacyProjection,
          ingestLegacy: mocks.ingestLegacy,
        } as any,
      },
    );

    expect(reply.status).toHaveBeenCalledWith(400);
    expect(response).toMatchObject({
      errorCode: 'browser_one_click_idempotency_key_required',
      terminal: true,
    });
    expect(mocks.shopFindFirst).not.toHaveBeenCalled();
    expect(mocks.syncJobCreate).not.toHaveBeenCalled();
  });

  it.each([
    ['sourceSkus', { sourceSkus: Array.from({ length: 101 }, (_, index) => `sku-${index}`) }],
    ['productUrls', { sourceSkus: ['sku-a'], productUrls: Array.from({ length: 101 }, (_, index) => `https://example.com/${index}`) }],
    ['rows', { sourceSkus: ['sku-a'], rows: Array.from({ length: 101 }, (_, index) => ({ sku: `sku-${index}` })) }],
  ])('rejects oversized browser one-click create payloads before persistence (%s)', async (_field, payload) => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/browser-one-click-jobs',
        payload: { shopId: 'shop-1', ...payload },
      });
      expect(response.statusCode).toBe(400);
      expect(mocks.shopFindFirst).not.toHaveBeenCalled();
      expect(mocks.syncJobCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('does not use publisher policy to authorize the review workflow', async () => {
    mocks.shopFindFirst.mockResolvedValue({ id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE' });
    mocks.syncJobCreate.mockResolvedValue({ id: 'job-1' });
    mocks.featureEvaluate.mockImplementation(async (feature: string) => feature === 'SOURCE_CAPTURE_V2'
      ? { enabled: true, captureStage: 'dual_read', reason: 'pilot_match', revision: 'capture-r1' }
      : { enabled: true, listingStage: 'v2_only', reason: 'pilot_match', revision: 'listing-r3' });
    const publisherRollout = { evaluateWrite: vi.fn(async () => ({
      authority: 'LEGACY', effectiveStage: 'off', rolloutRevision: 'publisher-off',
      gateStateVersion: null, evidenceHash: null,
    })) };
    const app = await buildApp(mocks.featureEvaluate, { publisherRollout });
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/listing/browser-one-click-jobs',
        payload: { shopId: 'shop-1', sourceSkus: ['sku-a'] },
      });
      expect(response.statusCode).toBe(200);
      expect(mocks.syncJobCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({ payload: expect.objectContaining({
          browserOneClickWorkflow: expect.objectContaining({
            publisherObservation: expect.objectContaining({ rolloutRevision: 'publisher-off' }),
          }),
        }) }),
      }));
      expect(mocks.addBrowserOneClickListingJob).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('accepts publisher V2 observation when capture and listing review are enabled', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      userId: 'user-1',
      platform: 'OZON',
      status: 'ACTIVE',
    });
    mocks.syncJobCreate.mockResolvedValue({ id: 'job-1' });
    mocks.featureEvaluate.mockImplementation(async (feature: string) => feature === 'SOURCE_CAPTURE_V2'
      ? { enabled: true, captureStage: 'v2_only', reason: 'pilot_match', revision: 'capture-v2' }
      : { enabled: true, listingStage: 'v2_only', reason: 'pilot_match', revision: 'listing-v2' });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/browser-one-click-jobs',
        payload: { shopId: 'shop-1', sourceSkus: ['2143427743'] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: { queued: false, deferred: true } });
      expect(mocks.syncJobCreate).toHaveBeenCalledTimes(1);
      expect(mocks.addBrowserOneClickListingJob).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('blocks direct legacy Ozon imports for the same pilot shop', async () => {
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
        url: '/api/listing/ozon/import-by-sku',
        payload: {
          shopId: 'shop-1',
          items: [{ sku: 2143427743 }],
        },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        errorCode: 'source_ozon_publisher_v2_required',
      });
      expect(OzonClient).not.toHaveBeenCalled();
      expect(mocks.syncJobCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects import-by-sku without exact draft identity before constructing an Ozon client', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE',
      clientId: 'client-id', apiKeyEncrypted: 'encrypted-key',
    });
    mocks.featureEvaluate.mockImplementation(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
      ? { enabled: true, legacyAllowed: true, listingStage: 'shadow_write', captureStage: null, reason: 'pilot_match', revision: 'listing-r1' }
      : { enabled: false, legacyAllowed: true, captureStage: null, reason: 'policy_off', revision: 'listing-r1' });
    mocks.prepareSourceListingWorkflow.mockResolvedValue({
      drafts: [{ supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 2, revision: 7, selectedSkuKeys: ['offer-1'] }],
      failures: [],
    });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/listing/ozon/import-by-sku',
        payload: { shopId: 'shop-1', items: [{ sku: 2143427743, supplyGoodsId: 'goods-1' }] },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 0, errorCode: 'SOURCE_LISTING_DRAFT_IDENTITY_REQUIRED',
      });
      expect(OzonClient).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('rejects batch publish when a supplied draft revision is stale', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE',
      clientId: 'client-id', apiKeyEncrypted: 'encrypted-key',
    });
    mocks.featureEvaluate.mockImplementation(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
      ? { enabled: true, legacyAllowed: true, listingStage: 'shadow_write', captureStage: null, reason: 'pilot_match', revision: 'listing-r1' }
      : { enabled: false, legacyAllowed: true, captureStage: null, reason: 'policy_off', revision: 'listing-r1' });
    mocks.prepareSourceListingWorkflow.mockResolvedValue({
      drafts: [{ supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 2, revision: 7, selectedSkuKeys: ['2143427743'] }],
      failures: [],
    });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/listing/batch',
        payload: {
          shopId: 'shop-1',
          draftRefs: [{ supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 1, revision: 7, skuKey: 'offer-1' }],
          items: [{
            supplyGoodsId: 'goods-1', skuKey: 'offer-1', offerId: 'offer-1', title: 'Test',
            categoryId: 1, typeId: 1, price: 10, images: ['https://example.com/a.jpg'],
            weight: 100,
          }],
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 0, errorCode: 'SOURCE_LISTING_DRAFT_IDENTITY_MISMATCH',
      });
      expect(OzonClient).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('rejects a browser-supplied device session binding', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-device-1',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        extensionDeviceSessionId: 'device-session-1',
        browserPayloadReady: false,
        browserPayloadRevision: 0,
      },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    const reply: any = {
      send: vi.fn((value) => value),
    };
    reply.status = vi.fn(() => reply);

    const response = await patchBrowserOneClickListingJobForActor(
      {
        params: { id: 'job-device-1' },
        body: { payload: { extensionDeviceSessionId: 'forged-device-session', stage: 'collecting' } },
        user: {},
      } as any,
      reply,
      {
        ownerUserId: 'user-1',
        actorUserId: 'user-1',
        role: 'USER',
        allowedShopIds: ['shop-1'],
        deviceSessionId: 'device-session-1',
      },
      {
        featureFlags: { evaluate: mocks.featureEvaluate },
        sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
      },
    );

    expect(response).toMatchObject({
      code: 0,
      errorCode: 'device_publish_state_forbidden',
      terminal: true,
      data: { status: 'FAILED' },
    });
    expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        finishedAt: expect.any(Date),
        payload: expect.objectContaining({
          stage: 'collect_failed',
          browserOneClickTerminalFailure: expect.objectContaining({
            errorCode: 'device_publish_state_forbidden',
          }),
        }),
      }),
    }));
  });

  it('preserves the authenticated device session binding across evidence patches', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-device-1',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        extensionDeviceSessionId: 'device-session-1',
        browserPayloadReady: false,
        browserPayloadRevision: 0,
      },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await patchBrowserOneClickListingJobForActor(
      {
        params: { id: 'job-device-1' },
        body: { payload: { stage: 'collecting' } },
        user: {},
      } as any,
      reply,
      {
        ownerUserId: 'user-1',
        actorUserId: 'user-1',
        role: 'USER',
        allowedShopIds: ['shop-1'],
        deviceSessionId: 'device-session-1',
      },
      {
        featureFlags: { evaluate: mocks.featureEvaluate },
        sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
      },
    );

    expect(response).toMatchObject({
      code: 1,
      data: {
        jobId: 'job-device-1',
        status: 'RUNNING',
        stage: 'collecting',
        browserPayloadRevision: 1,
        acceptedSkus: [],
      },
    });
    expect((response as any).data.payload).toBeUndefined();
    expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        payload: expect.objectContaining({
          extensionDeviceSessionId: 'device-session-1',
          browserPayloadRevision: 1,
        }),
      }),
    }));
  });

  it('reads a compact authoritative receipt bound to the exact device owner, shop, and session', async () => {
    const handoff = {
      contractVersion: 'browser-one-click-v2-handoff/v1',
      state: 'REVIEW_REQUIRED',
      drafts: [{
        supplyGoodsId: 'goods-1',
        snapshotId: 'snapshot-1',
        draftId: 'draft-1',
        draftVersion: 0,
        revision: 0,
        skuKey: 'sku-1',
        sourceSku: 'sku-1',
      }],
      failures: [],
    };
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-device-read',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        extensionDeviceSessionId: 'device-session-1',
        stage: 'review_required',
        browserPayloadRevision: 4,
        rows: [
          { sku: 'sku-1', description: 'x'.repeat(50_000) },
          { sku: 'sku-1', title: 'duplicate receipt identity' },
          { productId: 'sku-2' },
        ],
        browserOneClickPublishHandoff: handoff,
      },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await readBrowserOneClickListingJobForActor(
      { params: { id: 'job-device-read' } } as any,
      reply,
      {
        ownerUserId: 'user-1',
        actorUserId: 'user-1',
        allowedShopIds: ['shop-1'],
        deviceSessionId: 'device-session-1',
      },
    );

    expect(response).toEqual({
      code: 1,
      msg: 'ok',
      data: {
        jobId: 'job-device-read',
        status: 'RUNNING',
        stage: 'review_required',
        browserPayloadRevision: 4,
        acceptedSkus: ['sku-1', 'sku-2'],
        acceptedRowHashes: {
          'sku-1': 'eb2588d98a12c719d30867045b91e7fba851f019130ee658a1259b7d6b20d058',
          'sku-2': '843692becf4e1da8f9b6100fcb39be9ac41448dfc464791483946465fa666dad',
        },
        handoff,
      },
    });
    expect(JSON.stringify(response).length).toBeLessThan(2_000);
    expect(mocks.syncJobFindFirst).toHaveBeenCalledWith({
      where: {
        id: 'job-device-read',
        type: 'PRODUCT_PUSH',
        shopId: { in: ['shop-1'] },
        shop: { userId: 'user-1' },
        AND: [
          { payload: { path: ['source'], equals: 'browser-one-click-listing' } },
          { payload: { path: ['extensionDeviceSessionId'], equals: 'device-session-1' } },
        ],
      },
      include: { shop: { select: { id: true, userId: true, platform: true } } },
    });
  });

  it.each([
    ['owner', { shop: { id: 'shop-1', userId: 'other-user', platform: 'OZON' } }],
    ['shop grant', { shop: { id: 'shop-2', userId: 'user-1', platform: 'OZON' } }],
    ['device session', { payload: { source: 'browser-one-click-listing', extensionDeviceSessionId: 'other-session' } }],
    ['job source', { payload: { source: 'listing-batch', extensionDeviceSessionId: 'device-session-1' } }],
  ])('returns 404 when a device job read mismatches the bound %s', async (_label, patch) => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-device-read-hidden',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        extensionDeviceSessionId: 'device-session-1',
        stage: 'collecting',
        browserPayloadRevision: 1,
        ...((patch as any).payload || {}),
      },
      shop: {
        id: 'shop-1', userId: 'user-1', platform: 'OZON',
        ...((patch as any).shop || {}),
      },
    });
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await readBrowserOneClickListingJobForActor(
      { params: { id: 'job-device-read-hidden' } } as any,
      reply,
      {
        ownerUserId: 'user-1',
        actorUserId: 'user-1',
        allowedShopIds: ['shop-1'],
        deviceSessionId: 'device-session-1',
      },
    );

    expect(reply.status).toHaveBeenCalledWith(404);
    expect(response).toMatchObject({ code: 0, msg: '任务不存在' });
  });

  it('rejects device patches that forge publish results or terminal state', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-device-forged',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        extensionDeviceSessionId: 'device-session-1',
        browserPayloadRevision: 0,
      },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await patchBrowserOneClickListingJobForActor(
      {
        params: { id: 'job-device-forged' },
        body: { status: 'SUCCESS', result: { taskId: 99 }, payload: { taskId: 99 } },
        user: {},
      } as any,
      reply,
      {
        ownerUserId: 'user-1',
        actorUserId: 'user-1',
        role: 'USER',
        allowedShopIds: ['shop-1'],
        deviceSessionId: 'device-session-1',
      },
      {
        featureFlags: { evaluate: mocks.featureEvaluate },
        sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
      },
    );

    expect(response).toMatchObject({
      code: 0,
      errorCode: 'device_publish_state_forbidden',
      terminal: true,
      data: { status: 'FAILED' },
    });
    expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        finishedAt: expect.any(Date),
        payload: expect.objectContaining({
          stage: 'collect_failed',
          browserOneClickTerminalFailure: expect.objectContaining({
            errorCode: 'device_publish_state_forbidden',
          }),
        }),
      }),
    }));
  });

  it.each([
    ['terminal success', { status: 'SUCCESS' }],
    ['publish result', { result: { taskId: 99 } }],
    ['review handoff', { payload: { browserOneClickPublishHandoff: { contractVersion: 'browser-one-click-v2-handoff/v1' } } }],
    ['server-derived draft identity', { payload: { sourceListingDraftRefs: [{ draftId: 'forged' }] } }],
  ])('rejects account patches that forge %s', async (_label, body) => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-account-boundary',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        browserPayloadRevision: 0,
      },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await patchBrowserOneClickListingJobForActor(
      { params: { id: 'job-account-boundary' }, body, user: { userId: 'user-1' } } as any,
      reply,
      {
        ownerUserId: 'user-1',
        actorUserId: 'user-1',
        role: 'USER',
      },
      {
        featureFlags: { evaluate: mocks.featureEvaluate },
        sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
      },
    );

    expect(response).toMatchObject({
      code: 0,
      errorCode: 'browser_one_click_patch_forbidden',
      terminal: false,
    });
    expect(mocks.syncJobUpdateMany).not.toHaveBeenCalled();
  });

  it('rejects oversized evidence patches before merge or persistence', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-account-oversized',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: { source: 'browser-one-click-listing', browserPayloadRevision: 0 },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await patchBrowserOneClickListingJobForActor(
      {
        params: { id: 'job-account-oversized' },
        body: {
          status: 'RUNNING',
          payload: {
            stage: 'collecting',
            rows: Array.from({ length: 101 }, (_, index) => ({ sku: `sku-${index}` })),
          },
        },
        user: { userId: 'user-1' },
      } as any,
      reply,
      { ownerUserId: 'user-1', actorUserId: 'user-1', role: 'USER' },
      {
        featureFlags: { evaluate: mocks.featureEvaluate },
        sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
      },
    );

    expect(response).toMatchObject({
      code: 0,
      errorCode: 'browser_one_click_item_limit_exceeded',
      terminal: false,
    });
    expect(mocks.syncJobUpdateMany).not.toHaveBeenCalled();
  });

  it('does not treat a forged stored handoff as completed review state', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-invalid-handoff',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        stage: 'review_required',
        browserPayloadRevision: 1,
        browserOneClickPublishHandoff: {
          contractVersion: 'browser-one-click-v2-handoff/v1',
          state: 'REVIEW_REQUIRED',
          drafts: [{ draftId: 'forged-draft' }],
          failures: [],
        },
      },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await patchBrowserOneClickListingJobForActor(
      {
        params: { id: 'job-invalid-handoff' },
        body: { status: 'RUNNING', payload: { stage: 'collecting' } },
        user: { userId: 'user-1' },
      } as any,
      reply,
      { ownerUserId: 'user-1', actorUserId: 'user-1', role: 'USER' },
      {
        featureFlags: { evaluate: mocks.featureEvaluate },
        sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
      },
    );

    expect(response).toMatchObject({
      code: 0,
      errorCode: 'browser_one_click_handoff_invalid',
      terminal: true,
      data: { status: 'FAILED' },
    });
    expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'job-invalid-handoff', status: 'RUNNING' }),
      data: expect.objectContaining({
        status: 'FAILED',
        finishedAt: expect.any(Date),
        errorMessage: expect.stringContaining('browser_one_click_handoff_invalid'),
        payload: expect.objectContaining({
          stage: 'review_handoff_failed',
          browserPayloadRevision: 2,
          browserOneClickTerminalFailure: expect.objectContaining({
            errorCode: 'browser_one_click_handoff_invalid',
          }),
        }),
      }),
    }));
  });

  it('rejects a non-browser product-push job before any evidence mutation', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-manual-push',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: { source: 'listing-batch', browserPayloadRevision: 0 },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await patchBrowserOneClickListingJobForActor(
      {
        params: { id: 'job-manual-push' },
        body: { status: 'RUNNING', payload: { stage: 'collecting' } },
        user: { userId: 'user-1' },
      } as any,
      reply,
      { ownerUserId: 'user-1', actorUserId: 'user-1', role: 'USER' },
      {
        featureFlags: { evaluate: mocks.featureEvaluate },
        sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
      },
    );

    expect(response).toMatchObject({ code: 0, msg: '任务不存在' });
    expect(reply.status).toHaveBeenCalledWith(404);
    expect(mocks.syncJobUpdateMany).not.toHaveBeenCalled();
  });

  it('persists a missing browser payload revision as a terminal job failure', async () => {
    const previousPayload = {
      source: 'browser-one-click-listing',
      stage: 'collecting',
      sourceSkus: ['2143427743'],
    };
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-missing-revision',
      shopId: 'shop-1',
      status: 'RUNNING',
      finishedAt: null,
      payload: previousPayload,
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await patchBrowserOneClickListingJobForActor(
      {
        params: { id: 'job-missing-revision' },
        body: { status: 'RUNNING', payload: { stage: 'collecting' } },
        user: { userId: 'user-1' },
      } as any,
      reply,
      { ownerUserId: 'user-1', actorUserId: 'user-1', role: 'USER' },
      {
        featureFlags: { evaluate: mocks.featureEvaluate },
        sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
      },
    );

    expect(response).toMatchObject({
      code: 0,
      errorCode: 'browser_payload_revision_required',
      terminal: true,
      data: { status: 'FAILED' },
    });
    expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: 'job-missing-revision',
        status: 'RUNNING',
        payload: { equals: previousPayload },
      }),
      data: expect.objectContaining({
        status: 'FAILED',
        finishedAt: expect.any(Date),
        payload: expect.objectContaining({
          stage: 'review_handoff_failed',
          browserPayloadRevision: 0,
          browserOneClickTerminalFailure: expect.objectContaining({
            errorCode: 'browser_payload_revision_required',
          }),
        }),
      }),
    }));
  });

  it.each([
    ['draft identity', { payload: { sourceListingDraftRefs: [{ draftId: 'forged' }] } }],
    ['server-derived goods', { payload: { supplyGoodsIds: ['unrelated-goods'] } }],
    ['watermark stage', { payload: { stage: 'watermarked' } }],
  ])('rejects device patches that forge %s', async (_label, body) => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-device-boundary',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        extensionDeviceSessionId: 'device-session-1',
        browserPayloadRevision: 0,
      },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await patchBrowserOneClickListingJobForActor(
      { params: { id: 'job-device-boundary' }, body, user: {} } as any,
      reply,
      {
        ownerUserId: 'user-1',
        actorUserId: 'user-1',
        role: 'USER',
        allowedShopIds: ['shop-1'],
        deviceSessionId: 'device-session-1',
      },
      {
        featureFlags: { evaluate: mocks.featureEvaluate },
        sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
      },
    );

    expect(response).toMatchObject({
      code: 0,
      errorCode: 'device_publish_state_forbidden',
      terminal: true,
      data: { status: 'FAILED' },
    });
    expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: 'FAILED',
        finishedAt: expect.any(Date),
        payload: expect.objectContaining({
          stage: 'collect_failed',
          browserOneClickTerminalFailure: expect.objectContaining({
            errorCode: 'device_publish_state_forbidden',
          }),
        }),
      }),
    }));
  });

  it('returns a terminal authority error after the job shop grant is revoked', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-device-revoked-shop',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        extensionDeviceSessionId: 'device-session-1',
        browserPayloadRevision: 0,
      },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await patchBrowserOneClickListingJobForActor(
      {
        params: { id: 'job-device-revoked-shop' },
        body: { status: 'RUNNING', payload: { stage: 'collecting' } },
        user: {},
      } as any,
      reply,
      {
        ownerUserId: 'user-1',
        actorUserId: 'user-1',
        role: 'USER',
        allowedShopIds: [],
        deviceSessionId: 'device-session-1',
      },
      {
        featureFlags: { evaluate: mocks.featureEvaluate },
        sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
      },
    );

    expect(response).toMatchObject({
      code: 0,
      errorCode: 'device_authority_changed',
      terminal: true,
      data: { status: 'FAILED' },
    });
    expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'job-device-revoked-shop', status: 'RUNNING' }),
      data: expect.objectContaining({
        status: 'FAILED',
        finishedAt: expect.any(Date),
        payload: expect.objectContaining({
          stage: 'collect_failed',
          browserPayloadRevision: 1,
          browserOneClickTerminalFailure: expect.objectContaining({
            errorCode: 'device_authority_changed',
          }),
        }),
      }),
    }));
  });

  it('treats a delayed device completion patch as read-only after the worker starts', async () => {
    const serverPayload = {
      source: 'browser-one-click-listing',
      stage: 'publish_outcome_unknown',
      extensionDeviceSessionId: 'device-session-1',
      browserQueueStartedAt: '2026-08-13T06:00:00.000Z',
      browserPayloadRevision: 0,
      publishOutcome: { state: 'UNKNOWN', doNotRetry: true },
    };
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-device-started',
      shopId: 'shop-1',
      status: 'RUNNING',
      finishedAt: null,
      payload: serverPayload,
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    const reply: any = { send: vi.fn((value) => value) };
    reply.status = vi.fn(() => reply);

    const response = await patchBrowserOneClickListingJobForActor(
      {
        params: { id: 'job-device-started' },
        body: {
          status: 'RUNNING',
          payload: { stage: 'submitted', browserPayloadReady: true },
        },
        user: {},
      } as any,
      reply,
      {
        ownerUserId: 'user-1',
        actorUserId: 'user-1',
        role: 'USER',
        allowedShopIds: ['shop-1'],
        deviceSessionId: 'device-session-1',
      },
      {
        featureFlags: { evaluate: mocks.featureEvaluate },
        sourceListingWorkflowAdapter: { prepare: mocks.prepareSourceListingWorkflow },
      },
    );

    expect(response).toMatchObject({
      code: 1,
      data: {
        jobId: 'job-device-started',
        status: 'RUNNING',
        stage: 'publish_outcome_unknown',
        browserPayloadRevision: 0,
        acceptedSkus: [],
      },
    });
    expect((response as any).data.payload).toBeUndefined();
    expect(mocks.syncJobUpdate).not.toHaveBeenCalled();
    expect(mocks.addBrowserOneClickListingJob).not.toHaveBeenCalled();
  });

  it('fails closed before constructing an Ozon client when the entrypoint is blocked', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE',
      clientId: 'client-id', apiKeyEncrypted: 'encrypted-key',
    });
    const evaluateWrite = vi.fn(async () => ({
      writerEntrypoint: 'LISTING_IMPORT_BY_SKU', originChannel: 'DIRECT',
      configuredStages: { writer: null, origin: null }, effectiveStage: null,
      authority: 'BLOCKED', observeParity: false, limitingBoundary: null,
      rolloutRevision: 'listing-r1', reason: 'stage_config_unavailable',
      gateStateVersion: null, evidenceHash: null,
    }));
    const app = await buildApp(mocks.featureEvaluate, { publisherRollout: { evaluateWrite } });
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/listing/ozon/import-by-sku',
        payload: { shopId: 'shop-1', items: [{ sku: 2143427743 }] },
      });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toMatchObject({ errorCode: 'ozon_publisher_entrypoint_blocked' });
      expect(OzonClient).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it.each([
    {
      label: 'batch',
      url: '/api/listing/batch',
      skuKey: 'offer-1',
      payload: {
        shopId: 'shop-1',
        draftRefs: [{
          supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 2,
          revision: 7, skuKey: 'offer-1',
        }],
        items: [{
          supplyGoodsId: 'goods-1', skuKey: 'offer-1', offerId: 'offer-1', title: 'Test',
          categoryId: 1, typeId: 1, price: 10, images: ['https://example.com/a.jpg'],
          weight: 100,
        }],
      },
    },
    {
      label: 'import-by-sku',
      url: '/api/listing/ozon/import-by-sku',
      skuKey: '2143427743',
      payload: {
        shopId: 'shop-1',
        draftRefs: [{
          supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 2,
          revision: 7, skuKey: '2143427743',
        }],
        items: [{ sku: 2143427743, supplyGoodsId: 'goods-1' }],
      },
    },
  ])('routes an exact reviewed draft away from the legacy $label publisher', async ({ url, skuKey, payload }) => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE',
      clientId: 'client-id', apiKeyEncrypted: 'encrypted-key',
    });
    mocks.prepareSourceListingWorkflow.mockResolvedValue({
      drafts: [{
        supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 2,
        revision: 7, selectedSkuKeys: [skuKey],
      }],
      failures: [],
    });
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'POST', url, payload });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'source_listing_v2_publisher_required',
        terminal: true,
      });
      expect(OzonClient).not.toHaveBeenCalled();
      expect(mocks.syncJobCreate).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('refuses an explicit draft identity even when source-listing rollout is off', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE',
      clientId: 'client-id', apiKeyEncrypted: 'encrypted-key',
    });
    mocks.featureEvaluate.mockResolvedValue({
      enabled: false,
      legacyAllowed: true,
      captureStage: null,
      listingStage: 'off',
      reason: 'policy_off',
      revision: 'listing-off',
    });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/ozon/import-by-sku',
        payload: {
          shopId: 'shop-1',
          draftRefs: [{
            supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 2,
            revision: 7, skuKey: '2143427743',
          }],
          items: [{ sku: 2143427743, supplyGoodsId: 'goods-1' }],
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        errorCode: 'source_listing_v2_publisher_required',
        terminal: true,
        rolloutRevision: 'listing-off',
      });
      expect(OzonClient).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('does not call Ozon when the rollout decision changes before the external write', async () => {
    const importBySku = vi.fn();
    vi.mocked(OzonClient).mockImplementationOnce(function OzonClientMock() {
      return { importBySku } as never;
    });
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE',
      clientId: 'client-id', apiKeyEncrypted: 'encrypted-key',
    });
    mocks.prepareSourceListingWorkflow.mockResolvedValue({
      drafts: [{ supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 2, revision: 7, selectedSkuKeys: ['2143427743'] }],
      failures: [],
    });
    mocks.featureEvaluate.mockImplementation(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
      ? { enabled: true, legacyAllowed: true, listingStage: 'shadow_write', captureStage: null, reason: 'pilot_match', revision: 'listing-r1' }
      : { enabled: false, legacyAllowed: true, captureStage: null, reason: 'policy_off', revision: 'listing-r1' });
    const baseDecision = {
      writerEntrypoint: 'LISTING_IMPORT_BY_SKU', originChannel: 'DIRECT',
      configuredStages: { writer: 'shadow', origin: null }, effectiveStage: 'shadow',
      authority: 'LEGACY', observeParity: true, limitingBoundary: 'LISTING_IMPORT_BY_SKU',
      rolloutRevision: 'listing-r1', reason: 'shadow', gateStateVersion: null, evidenceHash: null,
    } as const;
    const evaluateWrite = vi.fn()
      .mockResolvedValueOnce(baseDecision)
      .mockResolvedValueOnce({ ...baseDecision, effectiveStage: 'off', observeParity: false, reason: 'effective_stage_off' });
    const observe = vi.fn(async () => ({ status: 'MATCH' }));
    const app = await buildApp(mocks.featureEvaluate, {
      publisherRollout: { evaluateWrite },
      publisherParityObserver: { observe },
    });
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/listing/ozon/import-by-sku',
        payload: {
          shopId: 'shop-1',
          draftRefs: [{ supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 2, revision: 7, skuKey: '2143427743' }],
          items: [{ sku: 2143427743, supplyGoodsId: 'goods-1' }],
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ errorCode: 'ozon_publisher_rollout_decision_changed' });
      expect(observe).toHaveBeenCalledTimes(1);
      expect(importBySku).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('revalidates the reviewed draft immediately before the external write', async () => {
    const importBySku = vi.fn();
    vi.mocked(OzonClient).mockImplementationOnce(function OzonClientMock() {
      return { importBySku } as never;
    });
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1', userId: 'user-1', platform: 'OZON', status: 'ACTIVE',
      clientId: 'client-id', apiKeyEncrypted: 'encrypted-key',
    });
    mocks.prepareSourceListingWorkflow
      .mockResolvedValueOnce({
        drafts: [{ supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 2, revision: 7, selectedSkuKeys: ['2143427743'] }],
        failures: [],
      })
      .mockResolvedValueOnce({
        drafts: [{ supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 2, revision: 8, selectedSkuKeys: ['2143427743'] }],
        failures: [],
      });
    mocks.featureEvaluate.mockImplementation(async (feature: string) => feature === 'SOURCE_LISTING_WORKFLOW'
      ? { enabled: true, legacyAllowed: true, listingStage: 'shadow_write', captureStage: null, reason: 'pilot_match', revision: 'listing-r1' }
      : { enabled: false, legacyAllowed: true, captureStage: null, reason: 'policy_off', revision: 'listing-r1' });
    const decision = {
      writerEntrypoint: 'LISTING_IMPORT_BY_SKU', originChannel: 'DIRECT',
      configuredStages: { writer: 'shadow', origin: null }, effectiveStage: 'shadow',
      authority: 'LEGACY', observeParity: true, limitingBoundary: 'LISTING_IMPORT_BY_SKU',
      rolloutRevision: 'listing-r1', reason: 'shadow', gateStateVersion: null, evidenceHash: null,
    } as const;
    const evaluateWrite = vi.fn(async () => decision);
    const app = await buildApp(mocks.featureEvaluate, {
      publisherRollout: { evaluateWrite },
      publisherParityObserver: { observe: vi.fn(async () => ({ status: 'MATCH' })) },
    });
    try {
      const response = await app.inject({
        method: 'POST', url: '/api/listing/ozon/import-by-sku',
        payload: {
          shopId: 'shop-1',
          draftRefs: [{ supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 2, revision: 7, skuKey: '2143427743' }],
          items: [{ sku: 2143427743, supplyGoodsId: 'goods-1' }],
        },
      });
      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({ errorCode: 'SOURCE_LISTING_DRAFT_IDENTITY_MISMATCH' });
      expect(importBySku).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });

  it('rejects a root STAFF actor before legacy publish policy evaluation', async () => {
    mocks.authenticate.mockImplementationOnce(async (request: any) => {
      request.user = {
        userId: 'user-1',
        actorUserId: 'user-1',
        role: 'STAFF',
        parentId: null,
        isSubAccount: false,
      };
    });
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      userId: 'user-1',
      platform: 'OZON',
      status: 'ACTIVE',
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/browser-one-click-jobs',
        payload: { shopId: 'shop-1', sourceSkus: ['2143427743'] },
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ errorCode: 'source_publish_owner_required' });
      expect(mocks.featureEvaluate).not.toHaveBeenCalled();
      expect(mocks.syncJobCreate).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('persists a non-final batch without evaluating rollout or creating server records', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        browserPayloadReady: false,
        browserPayloadRevision: 0,
        sourceSkus: ['2143427743', '3186614714'],
      },
      shop: { userId: 'user-1', platform: 'OZON' },
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/listing/browser-one-click-jobs/job-1',
        payload: {
          payload: {
            browserPayloadBatch: true,
            browserPayloadReady: true,
            rows: [{ sku: '2143427743' }],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: 'RUNNING',
          payload: expect.objectContaining({
            stage: 'collecting',
            browserPayloadReady: false,
            browserPayloadComplete: false,
            rows: [{ sku: '2143427743' }],
          }),
        }),
      }));
      expect(mocks.featureEvaluate).not.toHaveBeenCalled();
      expect(mocks.ensureLegacyProjection).not.toHaveBeenCalled();
      expect(mocks.addBrowserOneClickListingJob).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('builds Ozon marking-code repair updates only for auto-corrected marking warnings', () => {
    expect(buildOzonMarkingCodeRepairItems([
      {
        offer_id: 'offer-1',
        status: 'imported',
        errors: [{ code: 'marking_auto_corrected', level: 'warning', attribute_id: 23536 }],
      },
      {
        offer_id: 'offer-2',
        status: 'imported',
        errors: [{ code: 'VALUE_MIN_LIMIT', level: 'warning', attribute_id: 4383 }],
      },
      {
        offer_id: 'offer-3',
        status: 'imported',
        errors: [{ code: 'marking_auto_corrected', level: 'warning', attribute_id: 12345 }],
      },
    ] as any)).toEqual([
      {
        offer_id: 'offer-1',
        attributes: [{ id: 23536, values: [{ value: 'false' }] }],
      },
    ]);
  });

  it('creates a visible listing-log job before extension collection and watermark work starts', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      name: 'BINI',
      platform: 'OZON',
      status: 'ACTIVE',
    });
    mocks.syncJobCreate.mockResolvedValue({ id: 'job-1' });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/browser-one-click-jobs',
        payload: {
          shopId: 'shop-1',
          entry: 'ozon-list-page-full',
          mode: 'clone',
          sourceSkus: ['2143427743'],
          productUrls: ['https://www.ozon.ru/product/2143427743/'],
          rows: [{
            sku: '2143427743',
            title: 'Ozon product',
            image: 'https://cdn.example/p.jpg',
            pagePrice: 1000,
            supplyGoodsId: 'forged-goods',
            browserOneClickSkuGoodsIds: { '2143427743': 'forged-goods' },
            sourceListingDraftRefs: [{ draftId: 'forged-draft' }],
            snapshotId: 'forged-snapshot',
            draftId: 'forged-draft',
            taskId: 99,
          }],
          itemCount: 1,
          watermark: { type: 'image', imageUrl: 'https://cdn.example/watermark.png' },
          markupPct: 15,
          randomOfferId: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { jobId: 'job-1' },
      });
      expect(mocks.shopFindFirst).toHaveBeenCalledWith({
        where: { id: 'shop-1', userId: 'user-1' },
      });
      expect(mocks.syncJobCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          shopId: 'shop-1',
          type: 'PRODUCT_PUSH',
          status: 'RUNNING',
          startedAt: expect.any(Date),
          payload: expect.objectContaining({
            source: 'browser-one-click-listing',
            stage: 'preparing_browser_data',
            entry: 'ozon-list-page-full',
            mode: 'clone',
            itemCount: 1,
            sourceSkus: ['2143427743'],
            productUrls: ['https://www.ozon.ru/product/2143427743/'],
            rows: [{ sku: '2143427743', title: 'Ozon product', image: 'https://cdn.example/p.jpg', pagePrice: 1000 }],
            watermark: { type: 'image', imageUrl: 'https://cdn.example/watermark.png' },
            publish: expect.objectContaining({
              markupPct: 15,
              randomOfferId: true,
            }),
          }),
        }),
        select: { id: true, payload: true, status: true },
      });
      expect(mocks.addBrowserOneClickListingJob).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('can create a visible deferred job before browser-side publish data is ready', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      name: 'BINI',
      platform: 'OZON',
      status: 'ACTIVE',
    });
    mocks.syncJobCreate.mockResolvedValue({ id: 'job-1' });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/browser-one-click-jobs',
        payload: {
          shopId: 'shop-1',
          entry: 'ozon-list-page-full',
          mode: 'clone',
          deferStart: true,
          sourceSkus: ['2143427743'],
          productUrls: ['https://www.ozon.ru/product/2143427743/'],
          rows: [{ sku: '2143427743', title: 'Ozon product', image: 'https://cdn.example/p.jpg', pagePrice: 1000 }],
          itemCount: 1,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { jobId: 'job-1', queued: false, deferred: true },
      });
      expect(mocks.syncJobCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          status: 'RUNNING',
          payload: expect.objectContaining({
            source: 'browser-one-click-listing',
            stage: 'preparing_browser_data',
            browserPayloadReady: false,
            sourceSkus: ['2143427743'],
          }),
        }),
        select: { id: true, payload: true, status: true },
      });
      expect(mocks.addBrowserOneClickListingJob).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('keeps a ready but incomplete patch in collecting state without queueing', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        stage: 'preparing_browser_data',
        browserPayloadReady: false,
        browserPayloadRevision: 0,
        sourceSkus: ['2143427743'],
      },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    mocks.syncJobUpdate.mockResolvedValue({
      id: 'job-1',
      status: 'RUNNING',
      finishedAt: null,
      payload: {
        source: 'browser-one-click-listing',
        stage: 'collecting',
        browserPayloadReady: false,
        browserPayloadRevision: 0,
        browserPayloadComplete: false,
        sourceSkus: ['2143427743'],
        rows: [{ sku: '2143427743', ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }] }],
      },
    });
    mocks.syncJobUpdateMany.mockResolvedValue({ count: 1 });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/listing/browser-one-click-jobs/job-1',
        payload: {
          status: 'RUNNING',
          payload: {
            stage: 'submitted',
            browserPayloadReady: true,
            rows: [{ sku: '2143427743', ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }] }],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: {
          jobId: 'job-1',
          status: 'RUNNING',
          stage: 'collecting',
          browserPayloadRevision: 1,
          acceptedSkus: ['2143427743'],
        },
      });
      expect(response.json().data.payload).toBeUndefined();
      expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          status: 'RUNNING',
          payload: expect.objectContaining({
            stage: 'collecting',
            browserPayloadReady: false,
            browserPayloadComplete: false,
          }),
        }),
      }));
      expect(mocks.ensureLegacyProjection).not.toHaveBeenCalled();
      expect(mocks.addBrowserOneClickListingJob).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('merges browser-enriched rows without trusting client goods identity', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        stage: 'preparing_browser_data',
        browserPayloadReady: false,
        browserPayloadRevision: 0,
        sourceSkus: ['2143427743', '3186614714'],
        rows: [],
        supplyGoodsIds: [],
        browserOneClickSkuGoodsIds: {},
      },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    mocks.syncJobUpdate.mockResolvedValue({
      id: 'job-1',
      status: 'RUNNING',
      finishedAt: null,
      payload: {
        source: 'browser-one-click-listing',
        stage: 'collecting',
        browserPayloadReady: false,
        browserPayloadRevision: 0,
        sourceSkus: ['2143427743', '3186614714'],
        rows: [{ sku: '2143427743', ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }] }],
        supplyGoodsIds: ['sg-1'],
        browserOneClickSkuGoodsIds: { '2143427743': 'sg-1' },
      },
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/listing/browser-one-click-jobs/job-1',
        payload: {
          status: 'RUNNING',
          payload: {
            stage: 'collecting',
            browserPayloadBatch: true,
            rows: [{
              sku: '2143427743',
              ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }],
              supplyGoodsId: 'forged-goods',
              browserOneClickSkuGoodsIds: { '2143427743': 'forged-goods' },
              sourceListingDraftRefs: [{ draftId: 'forged-draft' }],
              snapshotId: 'forged-snapshot',
              draftId: 'forged-draft',
              taskId: 99,
            }],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'job-1', status: 'RUNNING' }),
        data: expect.objectContaining({
          status: 'RUNNING',
          payload: expect.objectContaining({
            stage: 'collecting',
            browserPayloadReady: false,
            rows: [{ sku: '2143427743', ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }] }],
            browserPayloadComplete: false,
          }),
        }),
      }));
      expect(mocks.appendBrowserOneClickListingRows).not.toHaveBeenCalled();
      expect(mocks.ensureLegacyProjection).not.toHaveBeenCalled();
      expect(mocks.addBrowserOneClickListingJob).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('marks an explicit browser collection failure terminal without queueing', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        stage: 'collecting',
        browserPayloadReady: false,
        browserPayloadRevision: 0,
        sourceSkus: ['2143427743'],
        rows: [{
          sku: '2143427743',
          title: 'Ozon product',
          image: 'https://cdn.example/p.jpg',
          descriptionCategoryId: '17028627',
          typeId: '95777',
        }],
        publish: { publishMode: 'clone' },
      },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    mocks.syncJobUpdate.mockResolvedValue({
      id: 'job-1',
      status: 'FAILED',
      finishedAt: new Date('2026-08-13T00:00:00.000Z'),
      payload: {
        source: 'browser-one-click-listing',
        stage: 'collect_failed',
        browserPayloadReady: false,
        browserPayloadComplete: false,
        sourceSkus: ['2143427743'],
        rows: [{
          sku: '2143427743',
          title: 'Ozon product',
          image: 'https://cdn.example/p.jpg',
          descriptionCategoryId: '17028627',
          typeId: '95777',
        }],
      },
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/listing/browser-one-click-jobs/job-1',
        payload: {
          status: 'FAILED',
          errorMessage: '浏览器补全商品数据失败: Failed to fetch',
          payload: { stage: 'collect_failed', browserPayloadReady: false },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: {
          jobId: 'job-1',
          status: 'FAILED',
          stage: 'collect_failed',
          browserPayloadRevision: 1,
          acceptedSkus: ['2143427743'],
        },
      });
      expect(response.json().data.payload).toBeUndefined();
      expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'job-1', status: 'RUNNING' }),
        data: expect.objectContaining({
          status: 'FAILED',
          finishedAt: expect.any(Date),
          errorMessage: '浏览器补全商品数据失败: Failed to fetch',
          payload: expect.objectContaining({
            stage: 'collect_failed',
            browserPayloadReady: false,
            browserPayloadComplete: false,
          }),
        }),
      }));
      expect(mocks.addBrowserOneClickListingJob).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
  it('lets the extension background mark the pre-created job failed when collection or watermarking stops early', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        stage: 'submitted',
        browserPayloadRevision: 0,
        sourceSkus: ['2143427743'],
      },
      shop: { id: 'shop-1', userId: 'user-1', platform: 'OZON' },
    });
    mocks.syncJobUpdate.mockResolvedValue({
      id: 'job-1',
      status: 'FAILED',
      finishedAt: new Date('2026-07-07T10:00:00.000Z'),
      payload: {
        source: 'browser-one-click-listing',
        stage: 'collect_failed',
        sourceSkus: ['2143427743'],
      },
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'PATCH',
        url: '/api/listing/browser-one-click-jobs/job-1',
        payload: {
          status: 'FAILED',
          errorMessage: '采集到 ERP 失败',
          payload: { stage: 'collect_failed' },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: {
          jobId: 'job-1',
          status: 'FAILED',
          stage: 'collect_failed',
          browserPayloadRevision: 1,
          acceptedSkus: [],
        },
      });
      expect(response.json().data.payload).toBeUndefined();
      expect(mocks.syncJobFindFirst).toHaveBeenCalledWith({
        where: { id: 'job-1', type: 'PRODUCT_PUSH' },
        include: { shop: { select: { id: true, userId: true, platform: true } } },
      });
      expect(mocks.syncJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({ id: 'job-1', status: 'RUNNING' }),
        data: expect.objectContaining({
          status: 'FAILED',
          finishedAt: expect.any(Date),
          errorMessage: '采集到 ERP 失败',
          payload: expect.objectContaining({
            source: 'browser-one-click-listing',
            stage: 'collect_failed',
            sourceSkus: ['2143427743'],
            browserPayloadReady: false,
            browserPayloadComplete: false,
          }),
        }),
      }));
    } finally {
      await app.close();
    }
  });

  it('explains that a browser one-click job without taskId has not reached Ozon submission yet', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      type: 'PRODUCT_PUSH',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        stage: 'submitted',
        sourceSkus: ['2143427743'],
      },
      shop: {
        id: 'shop-1',
        userId: 'user-1',
        clientId: 'client-id',
        apiKeyEncrypted: 'api-key',
      },
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/tasks/job-1/refresh',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 0,
        msg: expect.stringContaining('还未进入 Ozon 提交阶段'),
      });
    } finally {
      await app.close();
    }
  });

  it('shows the current browser one-click stage when a listing job has not received an Ozon taskId yet', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      type: 'PRODUCT_PUSH',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        stage: 'watermarking',
        sourceSkus: ['2143427743'],
      },
      shop: {
        id: 'shop-1',
        userId: 'user-1',
        clientId: 'client-id',
        apiKeyEncrypted: 'api-key',
      },
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/tasks/job-1/refresh',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 0,
        msg: expect.stringContaining('正在打水印'),
      });
    } finally {
      await app.close();
    }
  });
  it('falls back to offer_id product lookup when Ozon import info is temporarily unavailable', async () => {
    const getImportInfo = vi.fn().mockRejectedValue(Object.assign(new Error('fetch failed'), {
      code: 'UND_ERR_CONNECT_TIMEOUT',
    }));
    const getProductInfoByOfferId = vi.fn().mockResolvedValue([
      { id: 1001, offer_id: 'offer-1' },
      { id: 1002, offer_id: 'offer-2' },
    ]);
    const getProductInfoList = vi.fn().mockResolvedValue([
      { id: 1001, offer_id: 'offer-1', images: ['https://cdn.example/1.jpg'], primary_image: 'https://cdn.example/1.jpg' },
      { id: 1002, offer_id: 'offer-2', images: ['https://cdn.example/2.jpg'], primary_image: 'https://cdn.example/2.jpg' },
    ]);
    const getProductInfoAttributes = vi.fn().mockResolvedValue([]);
    vi.mocked(OzonClient).mockImplementation(function () {
      return { getImportInfo, getProductInfoByOfferId, getProductInfoList, getProductInfoAttributes } as any;
    });
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      type: 'PRODUCT_PUSH',
      status: 'RUNNING',
      payload: {
        taskId: 123,
        source: 'browser-one-click-listing',
        stage: 'publishing',
        offerIds: ['offer-1', 'offer-2'],
      },
      shop: {
        id: 'shop-1',
        userId: 'user-1',
        clientId: 'client-id',
        apiKeyEncrypted: 'api-key',
      },
    });
    mocks.syncJobUpdate.mockResolvedValue({
      id: 'job-1',
      status: 'SUCCESS',
      finishedAt: new Date('2026-07-08T10:00:00.000Z'),
      payload: {},
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/tasks/job-1/refresh',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: { id: 'job-1', status: 'SUCCESS' } });
      expect(getImportInfo).toHaveBeenCalledWith(123);
      expect(getProductInfoByOfferId).toHaveBeenCalledWith(['offer-1', 'offer-2']);
      expect(mocks.syncJobUpdate).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'SUCCESS',
          finishedAt: expect.any(Date),
          errorMessage: null,
          payload: expect.objectContaining({
            ozonImportInfoSource: 'product-info-fallback',
            lastImportInfoError: expect.stringContaining('fetch failed'),
            items: [
              { offer_id: 'offer-1', product_id: 1001, status: 'imported', errors: [] },
              { offer_id: 'offer-2', product_id: 1002, status: 'imported', errors: [] },
            ],
          }),
        }),
      });
    } finally {
      await app.close();
    }
  });

  it('auto-confirms Ozon marking-code corrections while refreshing a completed import task', async () => {
    const getImportInfo = vi.fn().mockResolvedValue({
      total: 1,
      items: [
        {
          offer_id: 'offer-1',
          product_id: 1001,
          status: 'imported',
          errors: [{
            code: 'marking_auto_corrected',
            level: 'warning',
            state: 'offer_validated',
            attribute_id: 23536,
            attribute_name: 'Нужен код маркировки',
          }],
        },
      ],
    });
    const updateProductAttributes = vi.fn().mockResolvedValue({ result: { task_id: 456 } });
    const getProductInfoList = vi.fn().mockResolvedValue([
      { id: 1001, offer_id: 'offer-1', images: ['https://cdn.example/1.jpg'], primary_image: 'https://cdn.example/1.jpg' },
    ]);
    const getProductInfoAttributes = vi.fn().mockResolvedValue([]);
    vi.mocked(OzonClient).mockImplementation(function () {
      return { getImportInfo, updateProductAttributes, getProductInfoList, getProductInfoAttributes } as any;
    });
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      type: 'PRODUCT_PUSH',
      status: 'RUNNING',
      payload: {
        taskId: 123,
        source: 'browser-one-click-listing',
        stage: 'publishing',
        offerIds: ['offer-1'],
      },
      shop: {
        id: 'shop-1',
        userId: 'user-1',
        clientId: 'client-id',
        apiKeyEncrypted: 'api-key',
      },
    });
    mocks.syncJobUpdate.mockResolvedValue({
      id: 'job-1',
      status: 'SUCCESS',
      finishedAt: new Date('2026-07-08T10:00:00.000Z'),
      payload: {},
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/tasks/job-1/refresh',
      });

      expect(response.statusCode).toBe(200);
      expect(updateProductAttributes).toHaveBeenCalledWith([
        { offer_id: 'offer-1', attributes: [{ id: 23536, values: [{ value: 'false' }] }] },
      ]);
      expect(mocks.syncJobUpdate).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          payload: expect.objectContaining({
            ozonMarkingCodeRepair: expect.objectContaining({ status: 'submitted', offerIds: ['offer-1'], taskId: 456 }),
          }),
        }),
      });
    } finally {
      await app.close();
    }
  });

  it('marks partially imported jobs as failed when Ozon returns blocking review errors', async () => {
    const getImportInfo = vi.fn().mockResolvedValue({
      total: 2,
      items: [
        {
          offer_id: 'offer-ok',
          product_id: 1001,
          status: 'imported',
          errors: [],
        },
        {
          offer_id: 'offer-brand',
          product_id: 1002,
          status: 'imported',
          errors: [{
            code: 'brand_document_missing',
            level: 'error',
            state: 'declined',
            description: 'Отсутствует документ на бренд TOUCHMI. Некоторые бренды требуют обязательной сертификации',
          }],
        },
      ],
    });
    const getProductInfoList = vi.fn().mockResolvedValue([
      { id: 1001, offer_id: 'offer-ok', images: ['https://cdn.example/1.jpg'], primary_image: 'https://cdn.example/1.jpg' },
      { id: 1002, offer_id: 'offer-brand', images: ['https://cdn.example/2.jpg'], primary_image: 'https://cdn.example/2.jpg' },
    ]);
    const getProductInfoAttributes = vi.fn().mockResolvedValue([]);
    vi.mocked(OzonClient).mockImplementation(function () {
      return { getImportInfo, getProductInfoList, getProductInfoAttributes } as any;
    });
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      type: 'PRODUCT_PUSH',
      status: 'RUNNING',
      payload: {
        taskId: 123,
        source: 'browser-one-click-listing',
        stage: 'publishing',
        offerIds: ['offer-ok', 'offer-brand'],
      },
      shop: {
        id: 'shop-1',
        userId: 'user-1',
        clientId: 'client-id',
        apiKeyEncrypted: 'api-key',
      },
    });
    mocks.syncJobUpdate.mockResolvedValue({
      id: 'job-1',
      status: 'FAILED',
      finishedAt: new Date('2026-07-08T10:00:00.000Z'),
      payload: {},
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/tasks/job-1/refresh',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: { id: 'job-1', status: 'FAILED' } });
      expect(mocks.syncJobUpdate).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          finishedAt: expect.any(Date),
          errorMessage: expect.stringContaining('品牌资质文件缺失'),
          payload: expect.objectContaining({
            failedCount: 1,
            ozonReviewStatus: 'needs_correction',
            ozonReviewIssueCount: 1,
            ozonReviewIssues: [
              expect.objectContaining({
                offerId: 'offer-brand',
                productId: 1002,
                status: 'imported',
                messages: [expect.stringContaining('品牌资质文件缺失')],
              }),
            ],
          }),
        }),
      });
    } finally {
      await app.close();
    }
  });

  it('uses admin-configured Ozon API timeout when refreshing import status', async () => {
    mocks.getConfig.mockImplementation(async (key: string) => (
      key === 'listing_ozon_api_timeout_ms' ? 27000 : undefined
    ));
    const getImportInfo = vi.fn().mockResolvedValue({
      total: 1,
      items: [
        { offer_id: 'offer-1', product_id: 0, status: 'pending', errors: [] },
      ],
    });
    vi.mocked(OzonClient).mockImplementation(function () {
      return { getImportInfo } as any;
    });
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      type: 'PRODUCT_PUSH',
      status: 'RUNNING',
      payload: {
        taskId: 123,
        source: 'browser-one-click-listing',
        stage: 'publishing',
        offerIds: ['offer-1'],
      },
      shop: {
        id: 'shop-1',
        userId: 'user-1',
        clientId: 'client-id',
        apiKeyEncrypted: 'api-key',
      },
    });
    mocks.syncJobUpdate.mockResolvedValue({
      id: 'job-1',
      status: 'RUNNING',
      finishedAt: null,
      payload: {},
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/tasks/job-1/refresh',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: { id: 'job-1', status: 'RUNNING' } });
      expect(OzonClient).toHaveBeenCalledWith(expect.objectContaining({
        clientId: 'client-id',
        apiKey: 'api-key',
        maxRetries: 0,
        timeoutMs: 27000,
      }));
    } finally {
      await app.close();
    }
  });
  it('keeps a listing task running when Ozon import info is down and offer_id lookup has not generated products yet', async () => {
    const getImportInfo = vi.fn().mockRejectedValue(new Error('OZON API 连接超时: /v1/product/import/info'));
    const getProductInfoByOfferId = vi.fn().mockResolvedValue([]);
    vi.mocked(OzonClient).mockImplementation(function () {
      return { getImportInfo, getProductInfoByOfferId } as any;
    });
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      type: 'PRODUCT_PUSH',
      status: 'RUNNING',
      payload: {
        taskId: 123,
        source: 'browser-one-click-listing',
        stage: 'publishing',
        offerIds: ['offer-1', 'offer-2'],
      },
      shop: {
        id: 'shop-1',
        userId: 'user-1',
        clientId: 'client-id',
        apiKeyEncrypted: 'api-key',
      },
    });
    mocks.syncJobUpdate.mockResolvedValue({
      id: 'job-1',
      status: 'RUNNING',
      finishedAt: null,
      payload: {},
    });

    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/listing/tasks/job-1/refresh',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: { id: 'job-1', status: 'RUNNING' } });
      expect(mocks.syncJobUpdate).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'RUNNING',
          finishedAt: null,
          errorMessage: null,
          payload: expect.objectContaining({
            failedCount: 0,
            ozonImportInfoSource: 'product-info-fallback',
            lastImportInfoError: expect.stringContaining('OZON API 连接超时'),
            items: [
              { offer_id: 'offer-1', product_id: 0, status: 'pending', errors: [] },
              { offer_id: 'offer-2', product_id: 0, status: 'pending', errors: [] },
            ],
          }),
        }),
      });
    } finally {
      await app.close();
    }
  });
});

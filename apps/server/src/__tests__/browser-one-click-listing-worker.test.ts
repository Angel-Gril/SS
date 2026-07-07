import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  syncJobFindUnique: vi.fn(),
  syncJobUpdate: vi.fn(),
  supplyGoodsCreate: vi.fn(),
  supplyGoodsFindMany: vi.fn(),
  userFindUnique: vi.fn(),
  resolveCollectedPrice: vi.fn(),
  processWatermarkItemsWithConcurrency: vi.fn(),
  signToken: vi.fn(() => 'internal-token'),
  storeSession: vi.fn(),
  registerWorker: vi.fn(),
}));

vi.mock('../lib/redis.js', () => ({
  redisDisabled: true,
}));

vi.mock('../lib/bullmq-connection.js', () => ({
  connection: {},
}));

vi.mock('../lib/worker-registry.js', () => ({
  registerWorker: mocks.registerWorker,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    syncJob: {
      findUnique: mocks.syncJobFindUnique,
      update: mocks.syncJobUpdate,
    },
    supplyGoods: {
      create: mocks.supplyGoodsCreate,
      findMany: mocks.supplyGoodsFindMany,
    },
    user: {
      findUnique: mocks.userFindUnique,
    },
  },
}));

vi.mock('../lib/auth.js', () => ({
  signToken: mocks.signToken,
  storeSession: mocks.storeSession,
}));

vi.mock('../services/collect-pricing.js', () => ({
  resolveCollectedPrice: mocks.resolveCollectedPrice,
}));

vi.mock('../routes/collect.js', () => ({
  processWatermarkItemsWithConcurrency: mocks.processWatermarkItemsWithConcurrency,
}));

describe('browser one-click listing worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('creates temporary supply goods and delegates publish to the existing collect publish endpoint', async () => {
    const payload = {
      source: 'browser-one-click-listing',
      stage: 'submitted',
      entry: 'ozon-list-page-full',
      mode: 'clone',
      sourceSkus: ['2143427743'],
      productUrls: ['https://www.ozon.ru/product/2143427743/'],
      rows: [{
        sku: '2143427743',
        title: 'Ozon product',
        image: 'https://cdn.example/p.jpg',
        pagePrice: 1000,
        pagePriceCurrency: 'RUB',
      }],
      watermark: { type: 'image', imageUrl: 'https://cdn.example/watermark.png' },
      publish: { publishMode: 'clone', markupPct: 15, randomOfferId: true },
    };
    let currentPayload = payload;
    mocks.syncJobFindUnique.mockImplementation(async (args: any) => {
      if (args.include) {
        return {
          id: 'job-1',
          shopId: 'shop-1',
          status: 'RUNNING',
          payload: currentPayload,
          shop: { userId: 'user-1', user: { id: 'user-1', role: 'USER' } },
        };
      }
      return { payload: currentPayload };
    });
    mocks.syncJobUpdate.mockImplementation(async ({ data }: any) => {
      currentPayload = data.payload;
      return { id: 'job-1', payload: currentPayload };
    });
    mocks.supplyGoodsCreate.mockResolvedValue({ id: 'sg-1' });
    mocks.supplyGoodsFindMany.mockResolvedValue([{ id: 'sg-1', userId: 'user-1', images: ['https://cdn.example/p.jpg'], metadata: {} }]);
    mocks.userFindUnique.mockResolvedValue({ id: 'user-1', role: 'USER' });
    mocks.resolveCollectedPrice.mockResolvedValue({
      purchasePriceCny: 88,
      originalPrice: 1000,
      originalCurrency: 'RUB',
      exchangeRateUsed: 0.088,
      needsReview: false,
    });
    mocks.processWatermarkItemsWithConcurrency.mockResolvedValue({ processed: 1, failed: 0 });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 1, data: { taskId: 123, jobId: 'job-1', count: 1 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');
    await expect(runBrowserOneClickListingJob('job-1')).resolves.toMatchObject({
      ok: true,
      jobId: 'job-1',
      data: { taskId: 123 },
    });

    expect(mocks.supplyGoodsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user: { connect: { id: 'user-1' } },
        sku: '2143427743',
        sourcePlatform: 'ozon',
        sourceProductId: '2143427743',
        purchasePrice: 88,
        currency: 'CNY',
        metadata: expect.objectContaining({
          ephemeralListing: true,
          browserOneClickJobId: 'job-1',
        }),
      }),
    });
    expect(mocks.processWatermarkItemsWithConcurrency).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: 'sg-1' })]),
      expect.objectContaining({ type: 'image', imageUrl: 'https://cdn.example/watermark.png' }),
      expect.any(Function),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3001/api/collect/publish-ozon',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer internal-token' }),
        body: expect.stringContaining('"jobId":"job-1"'),
      }),
    );
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeTruthy();
    const publishBody = JSON.parse((firstCall![1] as RequestInit).body as string);
    expect(publishBody).toMatchObject({
      ids: ['sg-1'],
      shopId: 'shop-1',
      jobId: 'job-1',
      mode: 'clone',
      markupPct: 15,
      randomOfferId: true,
    });
  });

  it('resumes a publishing-stage fallback payload without recreating records or repeating watermark work', async () => {
    const payload = {
      source: 'browser-one-click-listing',
      browserOneClickJob: true,
      publishSource: 'collect-publish-fallback',
      stage: 'publishing',
      sourceSkus: ['2143427743'],
      sourceItemIds: ['sg-1'],
      watermark: { type: 'image', imageUrl: 'https://cdn.example/watermark.png' },
      publish: { publishMode: 'clone', markupPct: 22, randomOfferId: true },
    };
    let currentPayload = payload;
    mocks.syncJobFindUnique.mockImplementation(async (args: any) => {
      if (args.include) {
        return {
          id: 'job-1',
          shopId: 'shop-1',
          status: 'RUNNING',
          payload: currentPayload,
          shop: { userId: 'user-1', user: { id: 'user-1', role: 'USER' } },
        };
      }
      return { payload: currentPayload };
    });
    mocks.syncJobUpdate.mockImplementation(async ({ data }: any) => {
      currentPayload = data.payload;
      return { id: 'job-1', payload: currentPayload };
    });
    mocks.supplyGoodsFindMany.mockResolvedValue([{ id: 'sg-1' }]);
    mocks.userFindUnique.mockResolvedValue({ id: 'user-1', role: 'USER' });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 1, data: { taskId: 456, jobId: 'job-1', count: 1 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');
    await runBrowserOneClickListingJob('job-1');

    expect(mocks.supplyGoodsCreate).not.toHaveBeenCalled();
    expect(mocks.processWatermarkItemsWithConcurrency).not.toHaveBeenCalled();
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeTruthy();
    const publishBody = JSON.parse((firstCall![1] as RequestInit).body as string);
    expect(publishBody).toMatchObject({
      ids: ['sg-1'],
      markupPct: 22,
    });
  });
});

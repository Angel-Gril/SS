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
  featureEvaluate: vi.fn(),
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

vi.mock('../services/source-workflow-feature-flags.js', async () => {
  const actual = await vi.importActual<typeof import('../services/source-workflow-feature-flags.js')>(
    '../services/source-workflow-feature-flags.js',
  );
  return {
    ...actual,
    sourceWorkflowFeatureFlags: { evaluate: mocks.featureEvaluate },
  };
});

describe('browser one-click listing worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    mocks.featureEvaluate.mockResolvedValue({
      enabled: false,
      legacyAllowed: true,
      reason: 'master_off',
      revision: 'master-off',
    });
  });

  it('blocks a legacy job before creating temporary goods when publisher V2 is enabled', async () => {
    mocks.syncJobFindUnique.mockResolvedValue({
      id: 'job-blocked',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        stage: 'submitted',
        rows: [{ sku: '2143427743', title: 'Ozon product' }],
      },
      shop: {
        userId: 'user-1',
        platform: 'OZON',
        user: { id: 'user-1', role: 'USER' },
      },
    });
    mocks.featureEvaluate.mockResolvedValue({
      enabled: true,
      legacyAllowed: false,
      captureStage: null,
      listingStage: 'v2_only',
      reason: 'pilot_match',
      revision: 'pilot-1',
    });

    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');
    await expect(runBrowserOneClickListingJob('job-blocked', {
      featureFlags: { evaluate: mocks.featureEvaluate },
    })).resolves.toMatchObject({
      skipped: true,
      reason: 'source_ozon_publisher_v2_required',
      statusCode: 409,
    });

    expect(mocks.supplyGoodsCreate).not.toHaveBeenCalled();
    expect(mocks.processWatermarkItemsWithConcurrency).not.toHaveBeenCalled();
  });

  it('rechecks rollout immediately before the final publish request', async () => {
    const payload = {
      source: 'browser-one-click-listing',
      browserOneClickJob: true,
      stage: 'publishing',
      sourceItemIds: ['sg-1'],
      publish: { publishMode: 'clone' },
    };
    mocks.syncJobFindUnique.mockImplementation(async (args: any) => {
      if (args.include) {
        return {
          id: 'job-rollout-switch',
          shopId: 'shop-1',
          status: 'RUNNING',
          payload,
          shop: {
            userId: 'user-1',
            platform: 'OZON',
            user: { id: 'user-1', role: 'USER' },
          },
        };
      }
      return { payload };
    });
    mocks.supplyGoodsFindMany.mockResolvedValue([{ id: 'sg-1' }]);
    mocks.featureEvaluate
      .mockResolvedValueOnce({
        enabled: false,
        legacyAllowed: true,
        listingStage: 'off',
        reason: 'pilot_miss',
        revision: 'pilot-1',
      })
      .mockResolvedValueOnce({
        enabled: false,
        legacyAllowed: true,
        reason: 'pilot_miss',
        revision: 'pilot-1',
      })
      .mockResolvedValueOnce({
        enabled: true,
        legacyAllowed: false,
        listingStage: 'v2_only',
        reason: 'pilot_match',
        revision: 'pilot-2',
      })
      .mockResolvedValueOnce({
        enabled: true,
        legacyAllowed: false,
        reason: 'pilot_match',
        revision: 'pilot-2',
      });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');
    await expect(runBrowserOneClickListingJob('job-rollout-switch')).resolves.toMatchObject({
      skipped: true,
      reason: 'source_ozon_publisher_v2_required',
      rolloutRevision: 'pilot-2',
    });

    expect(mocks.featureEvaluate).toHaveBeenCalledTimes(4);
    expect(mocks.userFindUnique).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps reconciliation available for a job that already has an Ozon task id', async () => {
    mocks.syncJobFindUnique.mockResolvedValue({
      id: 'job-submitted',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        stage: 'published',
        taskId: 987,
      },
      shop: {
        userId: 'user-1',
        platform: 'OZON',
        user: { id: 'user-1', role: 'USER' },
      },
    });
    mocks.featureEvaluate.mockResolvedValue({
      enabled: true,
      legacyAllowed: false,
      reason: 'pilot_match',
      revision: 'pilot-2',
    });

    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');
    await expect(runBrowserOneClickListingJob('job-submitted')).resolves.toEqual({
      skipped: true,
      status: 'RUNNING',
      taskId: 987,
    });
    expect(mocks.featureEvaluate).not.toHaveBeenCalled();
    expect(mocks.syncJobUpdate).not.toHaveBeenCalled();
  });

  it('appends browser-enriched rows into temporary supply goods one SKU at a time', async () => {
    let currentPayload = {
      source: 'browser-one-click-listing',
      stage: 'preparing_browser_data',
      entry: 'ozon-list-page-full',
      sourceSkus: ['2143427743', '3186614714'],
      productUrls: ['https://www.ozon.ru/product/2143427743/', 'https://www.ozon.ru/product/3186614714/'],
      rows: [],
      supplyGoodsIds: [],
      browserOneClickSkuGoodsIds: {},
      publish: { publishMode: 'clone', markupPct: 15, randomOfferId: true },
    };
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
    mocks.resolveCollectedPrice.mockResolvedValue({
      purchasePriceCny: 88,
      originalPrice: 1000,
      originalCurrency: 'RUB',
      exchangeRateUsed: 0.088,
      needsReview: false,
    });

    const row = {
      sku: '2143427743',
      title: 'Ozon product',
      image: 'https://cdn.example/p.jpg',
      pagePrice: 1000,
      pagePriceCurrency: 'RUB',
      ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }],
    };
    const { appendBrowserOneClickListingRows } = await import('../workers/browser-one-click-listing.js');
    const result = await appendBrowserOneClickListingRows('job-1', [row]);

    expect(result).toMatchObject({
      accepted: 1,
      failed: 0,
      supplyGoodsIds: ['sg-1'],
      skuGoodsIds: { '2143427743': 'sg-1' },
    });
    expect(mocks.supplyGoodsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user: { connect: { id: 'user-1' } },
        sku: '2143427743',
        sourcePlatform: 'ozon',
        images: ['https://cdn.example/p.jpg'],
        metadata: expect.objectContaining({
          ephemeralListing: true,
          browserOneClickJobId: 'job-1',
          ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }],
        }),
      }),
    });
    expect(currentPayload).toMatchObject({
      stage: 'collecting',
      rows: [row],
      supplyGoodsIds: ['sg-1'],
      browserOneClickSkuGoodsIds: { '2143427743': 'sg-1' },
      browserPayloadIngest: { accepted: 1, failed: 0 },
    });
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
      sourceListingDraftRefs: [{
        supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 2,
        revision: 7, skuKey: '2143427743',
      }],
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
      sourceListingDraftRefs: payload.sourceListingDraftRefs,
    });
  });

  it('fills missing temporary goods when a browser one-click job was only partially collected', async () => {
    const payload = {
      source: 'browser-one-click-listing',
      stage: 'submitted',
      entry: 'ozon-list-page-full',
      mode: 'clone',
      sourceSkus: ['2143427743', '3186614714'],
      productUrls: ['https://www.ozon.ru/product/2143427743/', 'https://www.ozon.ru/product/3186614714/'],
      rows: [
        { sku: '2143427743', title: 'Existing product', image: 'https://cdn.example/a.jpg', pagePrice: 1000 },
        { sku: '3186614714', title: 'Recovered product', image: 'https://cdn.example/b.jpg', pagePrice: 1200 },
      ],
      supplyGoodsIds: ['sg-existing'],
      browserOneClickSkuGoodsIds: { '2143427743': 'sg-existing' },
      watermark: { type: 'text', text: 'SS ERP' },
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
    mocks.supplyGoodsFindMany.mockImplementation(async (args: any) => {
      if (args?.select) return [{ id: 'sg-existing' }];
      return [
        { id: 'sg-existing', userId: 'user-1', images: ['https://cdn.example/a.jpg'], metadata: {} },
        { id: 'sg-new', userId: 'user-1', images: ['https://cdn.example/b.jpg'], metadata: {} },
      ];
    });
    mocks.supplyGoodsCreate.mockResolvedValue({ id: 'sg-new' });
    mocks.userFindUnique.mockResolvedValue({ id: 'user-1', role: 'USER' });
    mocks.resolveCollectedPrice.mockResolvedValue({
      purchasePriceCny: 88,
      originalPrice: 1000,
      originalCurrency: 'RUB',
      exchangeRateUsed: 0.088,
      needsReview: false,
    });
    mocks.processWatermarkItemsWithConcurrency.mockResolvedValue({ processed: 2, failed: 0 });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 1, data: { taskId: 123, jobId: 'job-1', count: 2 } }),
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
        sku: '3186614714',
        sourceProductId: '3186614714',
      }),
    });
    const publishBody = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(publishBody.ids).toEqual(['sg-existing', 'sg-new']);
    expect(currentPayload).toMatchObject({
      supplyGoodsIds: ['sg-existing', 'sg-new'],
      browserOneClickSkuGoodsIds: {
        '2143427743': 'sg-existing',
        '3186614714': 'sg-new',
      },
      collected: 2,
    });
  });
  it('preserves collected Ozon attributes and variants so one-click listings use product import instead of import-by-sku fallback', async () => {
    const ozonAttributes = [
      { id: 85, values: [{ value: 'Brand X', dictionary_value_id: 123 }] },
      { id: 10096, values: [{ value: 'Россия', dictionary_value_id: 643 }] },
    ];
    const variants = [{
      sku: '3253911757',
      attrs: { Цвет: 'черный' },
      images: ['https://cdn.example/variant.jpg'],
      ozonAttributes: [{ id: 10097, values: [{ value: 'черный', dictionary_value_id: 77 }] }],
    }];
    const payload = {
      source: 'browser-one-click-listing',
      stage: 'submitted',
      entry: 'ozon-product-detail',
      mode: 'clone',
      sourceSkus: ['3186614714'],
      productUrls: ['https://www.ozon.ru/product/3186614714/'],
      rows: [{
        sku: '3186614714',
        title: 'Ozon product with attributes',
        images: ['https://cdn.example/base-1.jpg', 'https://cdn.example/base-2.jpg'],
        pagePrice: 1200,
        pagePriceCurrency: 'RUB',
        description: 'Collected Ozon description',
        ozonAttributes,
        descriptionCategoryId: 17028922,
        typeId: 971589,
        weightG: 420,
        lengthMm: 210,
        widthMm: 110,
        heightMm: 45,
        manufacturerName: 'Factory X',
        brandName: 'Brand X',
        variants,
        modelId: 'model-1',
        richDescriptionJson: '{"content":[]}',
        sourceVideos: [{ url: 'https://cdn.example/video.mp4' }],
      }],
      watermark: null,
      publish: { publishMode: 'clone', markupPct: 15, randomOfferId: true },
    };
    let currentPayload = payload;
    mocks.syncJobFindUnique.mockImplementation(async (args: any) => {
      if (args.include) {
        return {
          id: 'job-attrs',
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
      return { id: 'job-attrs', payload: currentPayload };
    });
    mocks.supplyGoodsCreate.mockResolvedValue({ id: 'sg-attrs' });
    mocks.userFindUnique.mockResolvedValue({ id: 'user-1', role: 'USER' });
    mocks.resolveCollectedPrice.mockResolvedValue({
      purchasePriceCny: 105.6,
      originalPrice: 1200,
      originalCurrency: 'RUB',
      exchangeRateUsed: 0.088,
      needsReview: false,
    });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 1, data: { taskId: 789, jobId: 'job-attrs', count: 1 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');
    await runBrowserOneClickListingJob('job-attrs');

    expect(mocks.supplyGoodsCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sku: '3186614714',
        images: ['https://cdn.example/base-1.jpg', 'https://cdn.example/base-2.jpg'],
        variants,
        modelId: 'model-1',
        metadata: expect.objectContaining({
          ozonAttributes,
          descriptionCategoryId: 17028922,
          typeId: 971589,
          weightG: 420,
          lengthMm: 210,
          widthMm: 110,
          heightMm: 45,
          manufacturerName: 'Factory X',
          brandName: 'Brand X',
          sourceRichDescriptionJson: '{"content":[]}',
          sourceVideos: [{ url: 'https://cdn.example/video.mp4' }],
        }),
      }),
    });
  });

  it('continues publishing with original images when watermark processing fails', async () => {
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
      watermark: { type: 'text', text: '@BINI' },
      publish: { publishMode: 'clone', markupPct: 15, randomOfferId: true },
    };
    let currentPayload = payload;
    mocks.syncJobFindUnique.mockImplementation(async (args: any) => {
      if (args.include) {
        return {
          id: 'job-watermark-partial',
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
      return { id: 'job-watermark-partial', payload: currentPayload };
    });
    mocks.supplyGoodsCreate.mockResolvedValue({ id: 'sg-partial' });
    mocks.supplyGoodsFindMany.mockResolvedValue([{ id: 'sg-partial', userId: 'user-1', images: ['https://cdn.example/p.jpg'], metadata: {} }]);
    mocks.userFindUnique.mockResolvedValue({ id: 'user-1', role: 'USER' });
    mocks.resolveCollectedPrice.mockResolvedValue({
      purchasePriceCny: 88,
      originalPrice: 1000,
      originalCurrency: 'RUB',
      exchangeRateUsed: 0.088,
      needsReview: false,
    });
    mocks.processWatermarkItemsWithConcurrency.mockResolvedValue({ processed: 0, failed: 1 });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 1, data: { taskId: 321, jobId: 'job-watermark-partial', count: 1 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');
    await expect(runBrowserOneClickListingJob('job-watermark-partial')).resolves.toMatchObject({
      ok: true,
      jobId: 'job-watermark-partial',
      data: { taskId: 321 },
    });

    expect(mocks.processWatermarkItemsWithConcurrency).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalled();
    expect(currentPayload).toMatchObject({
      stage: 'published',
      watermark: { processed: 0, failed: 1 },
      watermarkWarning: '水印处理失败（1 张已回退原图，继续上架）',
      taskId: 321,
    });
  });
  it('normalizes configured internal API base URL when publishing from a VPS worker', async () => {
    vi.stubEnv('INTERNAL_API_BASE_URL', 'https://erp.example.com/api');
    const payload = {
      source: 'browser-one-click-listing',
      browserOneClickJob: true,
      stage: 'publishing',
      sourceSkus: ['2143427743'],
      sourceItemIds: ['sg-vps'],
      watermark: null,
      publish: { publishMode: 'clone', markupPct: 15, randomOfferId: true },
    };
    let currentPayload = payload;
    mocks.syncJobFindUnique.mockImplementation(async (args: any) => {
      if (args.include) {
        return {
          id: 'job-vps',
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
      return { id: 'job-vps', payload: currentPayload };
    });
    mocks.supplyGoodsFindMany.mockResolvedValue([{ id: 'sg-vps' }]);
    mocks.userFindUnique.mockResolvedValue({ id: 'user-1', role: 'USER' });
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ code: 1, data: { taskId: 654, jobId: 'job-vps', count: 1 } }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { runBrowserOneClickListingJob } = await import('../workers/browser-one-click-listing.js');
    await runBrowserOneClickListingJob('job-vps');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://erp.example.com/api/collect/publish-ozon',
      expect.objectContaining({ method: 'POST' }),
    );
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

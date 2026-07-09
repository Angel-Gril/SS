import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOzonMarkingCodeRepairItems, listingRoutes } from '../routes/listing.js';
import { OzonClient } from '../services/ozon-client.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'user-1' };
  }),
  shopFindFirst: vi.fn(),
  syncJobCreate: vi.fn(),
  syncJobFindFirst: vi.fn(),
  syncJobUpdate: vi.fn(),
  getConfig: vi.fn(async (_key: string): Promise<number | undefined> => undefined),
  addBrowserOneClickListingJob: vi.fn(),
  appendBrowserOneClickListingRows: vi.fn(),
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
    },
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

async function buildApp() {
  const app = Fastify();
  await app.register(listingRoutes, { prefix: '/api/listing' });
  await app.ready();
  return app;
}

describe('browser one-click listing jobs', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.mocked(OzonClient).mockReset();
    mocks.getConfig.mockResolvedValue(undefined);
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
          rows: [{ sku: '2143427743', title: 'Ozon product', image: 'https://cdn.example/p.jpg', pagePrice: 1000 }],
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
            stage: 'submitted',
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
        select: { id: true },
      });
      expect(mocks.addBrowserOneClickListingJob).toHaveBeenCalledWith('job-1');
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
        select: { id: true },
      });
      expect(mocks.addBrowserOneClickListingJob).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('starts a deferred browser one-click job when the extension patches enriched rows', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        stage: 'preparing_browser_data',
        browserPayloadReady: false,
        sourceSkus: ['2143427743'],
      },
      shop: { userId: 'user-1' },
    });
    mocks.syncJobUpdate.mockResolvedValue({
      id: 'job-1',
      status: 'RUNNING',
      finishedAt: null,
      payload: {
        source: 'browser-one-click-listing',
        stage: 'submitted',
        browserPayloadReady: true,
        sourceSkus: ['2143427743'],
        rows: [{ sku: '2143427743', ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }] }],
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
            stage: 'submitted',
            browserPayloadReady: true,
            rows: [{ sku: '2143427743', ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }] }],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { id: 'job-1', status: 'RUNNING' },
      });
      expect(mocks.addBrowserOneClickListingJob).toHaveBeenCalledWith('job-1');
    } finally {
      await app.close();
    }
  });

  it('ingests browser-enriched rows as temporary goods before the deferred job starts', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        stage: 'preparing_browser_data',
        browserPayloadReady: false,
        sourceSkus: ['2143427743', '3186614714'],
        rows: [],
        supplyGoodsIds: [],
        browserOneClickSkuGoodsIds: {},
      },
      shop: { userId: 'user-1' },
    });
    mocks.appendBrowserOneClickListingRows.mockResolvedValue({
      accepted: 1,
      failed: 0,
      rows: [{ sku: '2143427743', ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }] }],
      supplyGoodsIds: ['sg-1'],
      skuGoodsIds: { '2143427743': 'sg-1' },
      errors: [],
    });
    mocks.syncJobUpdate.mockResolvedValue({
      id: 'job-1',
      status: 'RUNNING',
      finishedAt: null,
      payload: {
        source: 'browser-one-click-listing',
        stage: 'collecting',
        browserPayloadReady: false,
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
            rows: [{ sku: '2143427743', ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }] }],
          },
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.appendBrowserOneClickListingRows).toHaveBeenCalledWith(
        'job-1',
        [{ sku: '2143427743', ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }] }],
      );
      expect(mocks.syncJobUpdate).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'RUNNING',
          payload: expect.objectContaining({
            stage: 'collecting',
            browserPayloadReady: false,
            rows: [{ sku: '2143427743', ozonAttributes: [{ id: 85, values: [{ value: 'Brand' }] }] }],
            supplyGoodsIds: ['sg-1'],
            browserOneClickSkuGoodsIds: { '2143427743': 'sg-1' },
            browserPayloadIngest: expect.objectContaining({ accepted: 1, failed: 0 }),
          }),
        }),
        select: expect.any(Object),
      });
      expect(mocks.addBrowserOneClickListingJob).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('keeps a recoverable browser payload failure running and queues backend publish', async () => {
    mocks.syncJobFindFirst.mockResolvedValue({
      id: 'job-1',
      shopId: 'shop-1',
      status: 'RUNNING',
      payload: {
        source: 'browser-one-click-listing',
        stage: 'collecting',
        browserPayloadReady: false,
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
      shop: { userId: 'user-1' },
    });
    mocks.syncJobUpdate.mockResolvedValue({
      id: 'job-1',
      status: 'RUNNING',
      finishedAt: null,
      payload: {
        source: 'browser-one-click-listing',
        stage: 'submitted',
        browserPayloadReady: true,
        browserPayloadRecoveredFromFailure: true,
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
        data: { id: 'job-1', status: 'RUNNING' },
      });
      expect(mocks.syncJobUpdate).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'RUNNING',
          errorMessage: expect.stringContaining('浏览器补全商品数据暂时中断'),
          payload: expect.objectContaining({
            stage: 'submitted',
            browserPayloadReady: true,
            browserPayloadRecoveredFromFailure: true,
            browserPayloadLastError: '浏览器补全商品数据失败: Failed to fetch',
          }),
        }),
        select: expect.any(Object),
      });
      expect(mocks.syncJobUpdate.mock.calls[0]![0].data).not.toHaveProperty('finishedAt');
      expect(mocks.addBrowserOneClickListingJob).toHaveBeenCalledWith('job-1');
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
        sourceSkus: ['2143427743'],
      },
      shop: { userId: 'user-1' },
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
        data: { id: 'job-1', status: 'FAILED' },
      });
      expect(mocks.syncJobFindFirst).toHaveBeenCalledWith({
        where: { id: 'job-1', type: 'PRODUCT_PUSH' },
        include: { shop: { select: { userId: true } } },
      });
      expect(mocks.syncJobUpdate).toHaveBeenCalledWith({
        where: { id: 'job-1' },
        data: expect.objectContaining({
          status: 'FAILED',
          finishedAt: expect.any(Date),
          errorMessage: '采集到 ERP 失败',
          payload: {
            source: 'browser-one-click-listing',
            stage: 'collect_failed',
            sourceSkus: ['2143427743'],
          },
        }),
        select: expect.any(Object),
      });
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

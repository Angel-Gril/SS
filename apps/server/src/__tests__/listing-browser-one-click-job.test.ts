import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { listingRoutes } from '../routes/listing.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'user-1' };
  }),
  shopFindFirst: vi.fn(),
  syncJobCreate: vi.fn(),
  syncJobFindFirst: vi.fn(),
  syncJobUpdate: vi.fn(),
  addBrowserOneClickListingJob: vi.fn(),
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

vi.mock('../services/ozon-client.js', () => ({
  OzonClient: vi.fn(),
}));

vi.mock('../services/post-publish-sync.js', () => ({
  enqueueProductSyncAfterPublish: vi.fn(),
}));

vi.mock('../workers/browser-one-click-listing.js', () => ({
  addBrowserOneClickListingJob: mocks.addBrowserOneClickListingJob,
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
});

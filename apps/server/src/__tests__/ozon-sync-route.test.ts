import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ozonSyncRoutes } from '../routes/ozon-sync.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'user-1', role: 'USER' };
  }),
  shopFindMany: vi.fn(),
  shopFindFirst: vi.fn(),
  shopFindUnique: vi.fn(),
  shopUpdate: vi.fn(),
  syncJobFindMany: vi.fn(),
  syncJobCount: vi.fn(),
  addProductSyncJob: vi.fn(),
  addOrderSyncJob: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    shop: {
      findMany: mocks.shopFindMany,
      findFirst: mocks.shopFindFirst,
      findUnique: mocks.shopFindUnique,
      update: mocks.shopUpdate,
    },
    syncJob: {
      findMany: mocks.syncJobFindMany,
      count: mocks.syncJobCount,
    },
  },
}));

vi.mock('../workers/product-sync.js', () => ({
  addProductSyncJob: mocks.addProductSyncJob,
}));

vi.mock('../workers/order-sync.js', () => ({
  addOrderSyncJob: mocks.addOrderSyncJob,
}));

async function buildApp() {
  const app = Fastify();
  await app.register(ozonSyncRoutes, { prefix: '/api/ozon-sync' });
  await app.ready();
  return app;
}

describe('ozon sync routes', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists sync jobs for the current user shops only', async () => {
    mocks.shopFindMany.mockResolvedValue([{ id: 'shop-1' }, { id: 'shop-2' }]);
    mocks.syncJobCount.mockResolvedValue(1);
    mocks.syncJobFindMany.mockResolvedValue([
      {
        id: 'sync-1',
        shopId: 'shop-1',
        type: 'PRODUCT_PULL',
        status: 'SUCCESS',
        payload: { trigger: 'manual' },
        result: { totalSynced: 12 },
        errorMessage: null,
        startedAt: new Date('2026-07-03T08:00:00.000Z'),
        finishedAt: new Date('2026-07-03T08:01:00.000Z'),
        createdAt: new Date('2026-07-03T07:59:59.000Z'),
        shop: { name: 'BINI', platform: 'OZON' },
      },
    ]);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/ozon-sync/runs?type=PRODUCT_PULL&limit=20',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.syncJobFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        shopId: { in: ['shop-1', 'shop-2'] },
        type: 'PRODUCT_PULL',
      },
      include: { shop: { select: { name: true, platform: true } } },
      orderBy: { createdAt: 'desc' },
    }));
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        total: 1,
        rows: [
          {
            id: 'sync-1',
            shopName: 'BINI',
            trigger: 'manual',
            resultSummary: '同步 12 件',
          },
        ],
      },
    });

    await app.close();
  });

  it('rotates an Ozon notification token for an owned shop', async () => {
    mocks.shopFindFirst.mockResolvedValue({
      id: 'shop-1',
      userId: 'user-1',
      platform: 'OZON',
      status: 'ACTIVE',
      config: { autoSync: { products: true } },
    });
    mocks.shopUpdate.mockImplementation(async ({ data }) => ({
      id: 'shop-1',
      config: data.config,
    }));

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-sync/shops/shop-1/notification-token',
    });

    expect(response.statusCode).toBe(200);
    const json = response.json();
    expect(json.code).toBe(1);
    expect(json.data.token).toMatch(/^[a-f0-9]{48}$/);
    expect(json.data.notifyPath).toContain('/api/ozon-sync/notify/shop-1/');
    expect(mocks.shopUpdate).toHaveBeenCalledWith({
      where: { id: 'shop-1' },
      data: {
        config: expect.objectContaining({
          autoSync: { products: true },
          ozonNotificationToken: json.data.token,
        }),
      },
    });

    await app.close();
  });

  it('accepts Ozon posting notifications and queues order sync without login', async () => {
    mocks.shopFindUnique.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      status: 'ACTIVE',
      config: { ozonNotificationToken: 'secret-token' },
    });
    mocks.addOrderSyncJob.mockResolvedValue({ id: 'order-job-1', syncJobId: 'sync-order-1' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-sync/notify/shop-1/secret-token',
      payload: {
        event_type: 'posting_status_changed',
        posting_number: '12345-0001-1',
        cookie: 'should-not-be-logged',
      },
    });

    expect(response.statusCode).toBe(202);
    expect(mocks.authenticate).not.toHaveBeenCalled();
    expect(mocks.addOrderSyncJob).toHaveBeenCalledWith('shop-1', undefined, expect.objectContaining({
      trigger: 'ozon_notification',
      eventType: 'posting_status_changed',
      eventKey: '12345-0001-1',
      payload: expect.not.objectContaining({ cookie: 'should-not-be-logged' }),
    }));
    expect(mocks.addProductSyncJob).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        queued: [{ type: 'ORDER_PULL', jobId: 'order-job-1', syncJobId: 'sync-order-1' }],
      },
    });

    await app.close();
  });

  it('rejects notification requests with a bad token', async () => {
    mocks.shopFindUnique.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      status: 'ACTIVE',
      config: { ozonNotificationToken: 'secret-token' },
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/ozon-sync/notify/shop-1/wrong-token',
      payload: { event_type: 'posting_status_changed' },
    });

    expect(response.statusCode).toBe(401);
    expect(mocks.addOrderSyncJob).not.toHaveBeenCalled();
    expect(mocks.addProductSyncJob).not.toHaveBeenCalled();

    await app.close();
  });

  it('validates notification URLs with GET without creating sync jobs', async () => {
    mocks.shopFindUnique.mockResolvedValue({
      id: 'shop-1',
      platform: 'OZON',
      status: 'ACTIVE',
      config: { ozonNotificationToken: 'secret-token' },
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/ozon-sync/notify/shop-1/secret-token',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: { shopId: 'shop-1', notificationReady: true },
    });
    expect(mocks.addOrderSyncJob).not.toHaveBeenCalled();
    expect(mocks.addProductSyncJob).not.toHaveBeenCalled();

    await app.close();
  });
});

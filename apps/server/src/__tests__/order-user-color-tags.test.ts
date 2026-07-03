import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { orderRoutes } from '../routes/order.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'user-1', role: 'USER' };
  }),
  shopFindMany: vi.fn(),
  orderCount: vi.fn(),
  orderFindMany: vi.fn(),
  orderFindUnique: vi.fn(),
  orderUpdate: vi.fn(),
  orderUpdateMany: vi.fn(),
  userServiceTagCount: vi.fn(),
  warehouseLogFindMany: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    shop: {
      findMany: mocks.shopFindMany,
    },
    order: {
      count: mocks.orderCount,
      findMany: mocks.orderFindMany,
      findUnique: mocks.orderFindUnique,
      update: mocks.orderUpdate,
      updateMany: mocks.orderUpdateMany,
    },
    userServiceTag: {
      count: mocks.userServiceTagCount,
    },
    warehouseLog: {
      findMany: mocks.warehouseLogFindMany,
    },
    serviceTagConfig: {
      findMany: vi.fn(),
    },
  },
}));

async function buildApp() {
  const app = Fastify();
  await app.register(orderRoutes, { prefix: '/api/orders' });
  await app.ready();
  return app;
}

describe('order user color tags', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns user color tags and filters orders by a user color tag', async () => {
    mocks.shopFindMany.mockResolvedValue([{ id: 'shop-1' }]);
    mocks.orderCount.mockResolvedValue(1);
    mocks.orderFindMany.mockResolvedValue([
      {
        id: 'order-1',
        shopId: 'shop-1',
        platformOrderId: 'ozon-order-1',
        postingNumber: 'posting-1',
        status: 'awaiting_packaging',
        subStatus: null,
        totalAmount: { toString: () => '120.50' },
        currency: 'RUB',
        items: [],
        trackingNumber: null,
        shippingMethod: null,
        inProcessAt: null,
        shipmentDate: null,
        deliveringDate: null,
        deliveredAt: null,
        createdAt: new Date('2026-07-03T08:00:00.000Z'),
        domesticTrackingNumber: null,
        domesticCarrier: null,
        domesticStatus: null,
        internationalTrackingNumber: null,
        internationalCarrier: null,
        internationalStatus: null,
        purchaseOrderId: null,
        purchasePlatform: null,
        serviceTags: [],
        userColorTags: ['urgent-tag'],
        serviceFee: null,
        inspectionStatus: null,
        shop: { name: 'BINI', platform: 'OZON' },
      },
    ]);
    mocks.warehouseLogFindMany.mockResolvedValue([]);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/orders?userColorTagId=urgent-tag',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.orderCount).toHaveBeenCalledWith({
      where: expect.objectContaining({
        shopId: { in: ['shop-1'] },
        userColorTags: { array_contains: ['urgent-tag'] },
      }),
    });
    expect(mocks.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({ userColorTags: true }),
    }));
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        rows: [
          {
            id: 'order-1',
            userColorTags: ['urgent-tag'],
          },
        ],
      },
    });

    await app.close();
  });

  it('updates user color tags only when the order and tags belong to the current user', async () => {
    mocks.orderFindUnique.mockResolvedValue({
      id: 'order-1',
      shop: { userId: 'user-1' },
    });
    mocks.userServiceTagCount.mockResolvedValue(2);
    mocks.orderUpdate.mockResolvedValue({
      id: 'order-1',
      userColorTags: ['urgent-tag', 'watch-tag'],
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'PUT',
      url: '/api/orders/order-1/user-color-tags',
      payload: { tagIds: ['urgent-tag', 'watch-tag'] },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.userServiceTagCount).toHaveBeenCalledWith({
      where: { id: { in: ['urgent-tag', 'watch-tag'] }, userId: 'user-1' },
    });
    expect(mocks.orderUpdate).toHaveBeenCalledWith({
      where: { id: 'order-1' },
      data: { userColorTags: ['urgent-tag', 'watch-tag'] },
      select: { id: true, userColorTags: true },
    });
    expect(response.json()).toMatchObject({
      code: 1,
      data: { userColorTags: ['urgent-tag', 'watch-tag'] },
    });

    await app.close();
  });

  it('batch updates user color tags only for current user orders', async () => {
    mocks.shopFindMany.mockResolvedValue([{ id: 'shop-1' }, { id: 'shop-2' }]);
    mocks.userServiceTagCount.mockResolvedValue(1);
    mocks.orderFindMany.mockResolvedValue([{ id: 'order-1' }, { id: 'order-2' }]);
    mocks.orderUpdateMany.mockResolvedValue({ count: 2 });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/orders/batch-user-color-tags',
      payload: {
        orderIds: ['order-1', 'order-2', 'other-user-order'],
        tagIds: ['urgent-tag'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.orderFindMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['order-1', 'order-2', 'other-user-order'] },
        shopId: { in: ['shop-1', 'shop-2'] },
      },
      select: { id: true },
    });
    expect(mocks.orderUpdateMany).toHaveBeenCalledWith({
      where: { id: { in: ['order-1', 'order-2'] } },
      data: { userColorTags: ['urgent-tag'] },
    });
    expect(response.json()).toMatchObject({
      code: 1,
      data: { updated: 2 },
    });

    await app.close();
  });
});

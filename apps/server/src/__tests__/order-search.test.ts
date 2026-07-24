import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { orderRoutes } from '../routes/order.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'user-1', role: 'USER' };
  }),
  shopFindMany: vi.fn(),
  queryRaw: vi.fn(),
  orderCount: vi.fn(),
  orderFindMany: vi.fn(),
  warehouseLogFindMany: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    $queryRaw: mocks.queryRaw,
    shop: { findMany: mocks.shopFindMany },
    order: {
      count: mocks.orderCount,
      findMany: mocks.orderFindMany,
    },
    warehouseLog: { findMany: mocks.warehouseLogFindMany },
    serviceTagConfig: { findMany: vi.fn() },
  },
}));

function orderRow(id: string) {
  return {
    id,
    shopId: 'shop-1',
    platformOrderId: `platform-${id}`,
    postingNumber: `posting-${id}`,
    status: 'awaiting_packaging',
    subStatus: null,
    totalAmount: { toString: () => '1200.92' },
    currency: 'RUB',
    items: [{ sku: 4147083134, offer_id: '3357060761-oz4w', name: 'White ceramic mug' }],
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
    userColorTags: [],
    serviceFee: null,
    inspectionStatus: null,
    shop: { name: 'BINI', platform: 'OZON' },
  };
}

async function buildApp() {
  const app = Fastify();
  await app.register(orderRoutes, { prefix: '/api/orders' });
  await app.ready();
  return app;
}

function setup(rows = [orderRow('order-1')]) {
  mocks.shopFindMany.mockResolvedValue([{ id: 'shop-1' }]);
  mocks.queryRaw.mockResolvedValue([{ id: 'order-1' }]);
  mocks.orderCount.mockResolvedValue(rows.length);
  mocks.orderFindMany.mockResolvedValue(rows);
  mocks.warehouseLogFindMany.mockResolvedValue([]);
}

describe('order item search', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('finds SKU and seller offer ids inside the JSON item array', async () => {
    setup();
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders?search=4147083134&searchField=sku',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, data: { total: 1 } });
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const sql = JSON.stringify(mocks.queryRaw.mock.calls[0]?.[0]);
    expect(sql).toContain('jsonb_array_elements');
    expect(sql).toContain("item ->> 'sku'");
    expect(sql).toContain("item ->> 'offer_id'");
    expect(mocks.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { in: ['order-1'] } }),
    }));
    expect(mocks.orderFindMany.mock.calls[0]?.[0]?.where).not.toHaveProperty('items');

    await app.close();
  });

  it('finds product names inside the JSON item array', async () => {
    setup();
    mocks.queryRaw.mockResolvedValue([{ id: 'order-1' }]);
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders?search=ceramic%20mug&searchField=product',
    });

    expect(response.statusCode).toBe(200);
    const sql = JSON.stringify(mocks.queryRaw.mock.calls[0]?.[0]);
    expect(sql).toContain("item ->> 'name'");
    expect(sql).not.toContain("item ->> 'sku'");

    await app.close();
  });

  it('keeps scalar order matches and item matches in the all-fields search', async () => {
    const rows = [orderRow('scalar-match'), orderRow('item-match')];
    setup(rows);
    mocks.queryRaw.mockResolvedValue([{ id: 'item-match' }]);
    const app = await buildApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/orders?search=mug',
    });

    expect(response.statusCode).toBe(200);
    const call = mocks.orderCount.mock.calls[0]?.[0];
    const or = call?.where?.OR as Array<Record<string, unknown>>;
    expect(or).toEqual(expect.arrayContaining([
      expect.objectContaining({ postingNumber: expect.any(Object) }),
      { id: { in: ['item-match'] } },
    ]));

    await app.close();
  });
});

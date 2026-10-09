import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { orderRoutes } from '../routes/order.js';
import { orderAnalyticsRoutes } from '../routes/order/analytics.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any, reply: any) => {
    if (request.headers['x-unauthenticated']) return reply.code(401).send({ code: 0 });
    request.user = { userId: 'owner-1', actorUserId: 'actor-1', role: 'USER' };
  }),
  shopFindMany: vi.fn(), orderFindMany: vi.fn(), orderCount: vi.fn(), orderFindUnique: vi.fn(),
  warehouseLogFindMany: vi.fn(), warehouseLogCreate: vi.fn(), queryRaw: vi.fn(), transaction: vi.fn(),
}));
vi.mock('../lib/auth.js', () => ({ authenticate: mocks.authenticate }));
vi.mock('../lib/prisma.js', () => ({ prisma: {
  shop: { findMany: mocks.shopFindMany },
  order: { findMany: mocks.orderFindMany, count: mocks.orderCount, findUnique: mocks.orderFindUnique },
  warehouseLog: { findMany: mocks.warehouseLogFindMany, create: mocks.warehouseLogCreate },
  $queryRaw: mocks.queryRaw, $transaction: mocks.transaction,
} }));

const rows = [
  { id: 'pack', status: 'awaiting_packaging', domesticStatus: 'received' },
  { id: 'ship', status: 'awaiting_deliver', domesticStatus: 'received' },
  { id: 'pending', status: 'awaiting_deliver', shipmentDate: new Date(), internationalTrackingNumber: 'generated' },
  { id: 'prepared', status: 'awaiting_packaging' },
  { id: 'international', status: 'awaiting_deliver', internationalStatus: 'shipped' },
  { id: 'delivered', status: 'delivered' },
  { id: 'cancel', status: 'cancelled' },
  { id: 'failed', status: 'delivering', inspectionStatus: 'failed' },
];
const preparedAt = new Date('2026-10-09T01:00:00Z');
async function appFor() {
  const app = Fastify();
  await app.register(orderRoutes, { prefix: '/api/orders' });
  await app.register(orderAnalyticsRoutes, { prefix: '/api/orders' });
  await app.ready();
  return app;
}
beforeEach(() => {
  mocks.shopFindMany.mockResolvedValue([{ id: 'shop-1' }]);
  mocks.orderFindMany.mockResolvedValue(rows);
  mocks.orderCount.mockResolvedValue(rows.length);
  mocks.warehouseLogFindMany.mockImplementation(async (args: any) => {
    const ids = args?.where?.orderId?.in || [args?.where?.orderId];
    return ids?.includes('prepared') ? [{ orderId: 'prepared', operationType: 'stock_ready', createdAt: preparedAt }] : [];
  });
  mocks.queryRaw.mockResolvedValue([{ id: 'pending' }]);
  mocks.orderFindUnique.mockResolvedValue({ id: 'pending', status: 'awaiting_packaging' });
  mocks.warehouseLogCreate.mockResolvedValue({ createdAt: preparedAt });
  mocks.transaction.mockImplementation(async callback => callback({
    $queryRaw: mocks.queryRaw, order: { findUnique: mocks.orderFindUnique },
    warehouseLog: { findMany: mocks.warehouseLogFindMany, create: mocks.warehouseLogCreate },
  }));
});
afterEach(() => vi.clearAllMocks());

describe('order fulfillment owner consumers', () => {
  it('publishes five exhaustive stage counts and normalized children from active owned shops', async () => {
    const app = await appFor();
    const response = await app.inject('/api/orders/pipeline?shopId=shop-1&startDate=2026-10-01&endDate=2026-10-09');
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.total).toBe(8);
    expect(data.stages.map((stage: any) => [stage.key, stage.count])).toEqual([
      ['purchased', 1], ['domestic_transit', 1], ['warehouse_processing', 2], ['delivering', 2], ['abnormal', 2],
    ]);
    expect(data.stages[2].children).toEqual([
      { key: 'awaiting_packaging', label: '待打包', count: 1 },
      { key: 'awaiting_deliver', label: '待发货', count: 1 },
    ]);
    expect(data.stages[3].children.map((child: any) => child.count)).toEqual([1, 1]);
    expect(data.stages[4].children.map((child: any) => child.count)).toEqual([1, 1]);
    expect(mocks.shopFindMany).toHaveBeenCalledWith({ where: { userId: 'owner-1', status: { not: 'DISABLED' } }, select: { id: true } });
    expect(mocks.orderFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
      shopId: { in: ['shop-1'] }, createdAt: { gte: new Date('2026-10-01T00:00:00Z'), lt: new Date('2026-10-10T00:00:00Z') },
    } }));
    await app.close();
  });

  it('applies the same search and operational scope to pipeline counts', async () => {
    const app = await appFor();
    await app.inject('/api/orders/pipeline?search=box&searchField=product&serviceTagId=inspect&purchaseState=unlinked');
    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    const scope = mocks.orderFindMany.mock.calls[0]?.[0]?.where;
    expect(scope).toEqual(expect.objectContaining({ serviceTags: { array_contains: ['inspect'] }, purchaseOrderId: null }));
    expect(scope.OR).toEqual(expect.arrayContaining([{ id: { in: ['pending'] } }]));
    await app.close();
  });

  it('restricts canonical secondary statuses before pagination and projects the stock marker', async () => {
    const app = await appFor();
    const response = await app.inject('/api/orders?fulfillmentStage=warehouse_processing&fulfillmentStatus=awaiting_deliver');
    expect(response.statusCode).toBe(200);
    expect(mocks.orderCount).toHaveBeenCalledWith({ where: { shopId: { in: ['shop-1'] }, id: { in: ['ship'] } } });
    expect(response.json().data.rows.find((row: any) => row.id === 'prepared')).toMatchObject({
      stockPreparedAt: preparedAt.toISOString(), fulfillmentStage: 'domestic_transit', fulfillmentStatus: null,
    });
    await app.close();
  });

  it.each([
    'fulfillmentStatus=unknown',
    'fulfillmentStage=warehouse_processing&fulfillmentStatus=delivered',
    'fulfillmentStage=purchased&fulfillmentStatus=cancelled',
    'fulfillmentStage=delivered&fulfillmentStatus=delivering',
  ])('rejects invalid secondary filters without reading orders: %s', async query => {
    const app = await appFor();
    const response = await app.inject(`/api/orders?${query}`);
    expect(response.statusCode).toBe(400);
    expect(mocks.orderFindMany).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not broaden an explicit foreign or disabled shop to all owned shops', async () => {
    const app = await appFor();
    const response = await app.inject('/api/orders/pipeline?shopId=foreign-shop');
    expect(response.json().data.total).toBe(0);
    expect(response.json().data.stages).toHaveLength(5);
    expect(mocks.orderFindMany).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('mark order stock ready', () => {
  it('records the authenticated actor and returns the canonical next stage', async () => {
    const app = await appFor();
    const response = await app.inject({ method: 'PUT', url: '/api/orders/pending/stock-ready', payload: { prepared: true } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ id: 'pending', stockPreparedAt: preparedAt.toISOString(), fulfillmentStage: 'domestic_transit' });
    expect(mocks.warehouseLogCreate).toHaveBeenCalledWith({ data: {
      orderId: 'pending', operationType: 'stock_ready', operatorId: 'actor-1', note: '用户确认已备货',
    }, select: { createdAt: true } });
    const sql = JSON.stringify(mocks.queryRaw.mock.calls[0]);
    expect(sql).toContain('owner-1'); expect(sql).toContain('DISABLED'); expect(sql).toContain('FOR UPDATE');
    await app.close();
  });

  it('replays the persisted marker even if the order has since moved to warehouse', async () => {
    mocks.orderFindUnique.mockResolvedValue({ id: 'pending', status: 'awaiting_packaging', domesticStatus: 'received' });
    mocks.warehouseLogFindMany.mockResolvedValue([{ orderId: 'pending', operationType: 'stock_ready', createdAt: preparedAt }]);
    const app = await appFor();
    const response = await app.inject({ method: 'PUT', url: '/api/orders/pending/stock-ready', payload: { prepared: true } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.stockPreparedAt).toBe(preparedAt.toISOString());
    expect(mocks.warehouseLogCreate).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([{ prepared: false }, { prepared: true, operatorId: 'foreign' }, { prepared: 'true' }, {}])('rejects malformed input and client actor overrides', async payload => {
    const app = await appFor();
    const response = await app.inject({ method: 'PUT', url: '/api/orders/pending/stock-ready', payload });
    expect(response.statusCode).toBe(400); expect(mocks.transaction).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects unauthenticated access before stock mutation', async () => {
    const app = await appFor();
    const response = await app.inject({ method: 'PUT', url: '/api/orders/pending/stock-ready', headers: { 'x-unauthenticated': '1' }, payload: { prepared: true } });
    expect(response.statusCode).toBe(401); expect(mocks.transaction).not.toHaveBeenCalled();
    await app.close();
  });

  it('refuses an order outside the active owned shop set', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const app = await appFor();
    const response = await app.inject({ method: 'PUT', url: '/api/orders/pending/stock-ready', payload: { prepared: true } });
    expect(response.statusCode).toBe(404); expect(mocks.warehouseLogCreate).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([{ status: 'cancelled' }, { status: 'delivered' }, { status: 'awaiting_packaging', domesticStatus: 'received' }, { internationalStatus: 'shipped' }])('does not newly mark warehouse, dispatched, cancelled or delivered orders', async order => {
    mocks.queryRaw.mockResolvedValue([{ id: 'pending', status: order.status ?? null, sub_status: null, domestic_status: order.domesticStatus ?? null, international_status: order.internationalStatus ?? null }]);
    mocks.orderFindUnique.mockResolvedValue({ id: 'pending', ...order });
    const app = await appFor();
    const response = await app.inject({ method: 'PUT', url: '/api/orders/pending/stock-ready', payload: { prepared: true } });
    expect(response.statusCode).toBe(409); expect(mocks.warehouseLogCreate).not.toHaveBeenCalled();
    await app.close();
  });
});

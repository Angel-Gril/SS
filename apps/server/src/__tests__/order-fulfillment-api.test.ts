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
  postingGet: vi.fn(), postingShip: vi.fn(), orderUpdate: vi.fn(), orderUpdateMany: vi.fn(),
}));
vi.mock('../lib/crypto.js', () => ({ decrypt: () => 'fixture-key' }));
vi.mock('../services/ozon-client.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../services/ozon-client.js')>();
  return { ...actual, OzonClient: class { getPostingByNumber = mocks.postingGet; shipPackage = mocks.postingShip; request = mocks.postingShip; } };
});
vi.mock('../lib/auth.js', () => ({ authenticate: mocks.authenticate }));
vi.mock('../lib/prisma.js', () => ({ prisma: {
  shop: { findMany: mocks.shopFindMany },
  order: { findMany: mocks.orderFindMany, count: mocks.orderCount, findUnique: mocks.orderFindUnique, update: mocks.orderUpdate, updateMany: mocks.orderUpdateMany },
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
  mocks.orderUpdate.mockResolvedValue({});
  mocks.orderUpdateMany.mockResolvedValue({ count: 1 });
  mocks.postingShip.mockResolvedValue({ result: ['posting-1'] });
  mocks.postingGet.mockResolvedValue({ posting_number: 'posting-1', status: 'awaiting_deliver' });
  mocks.transaction.mockImplementation(async callback => callback({
    $queryRaw: mocks.queryRaw, order: { findUnique: mocks.orderFindUnique, updateMany: mocks.orderUpdateMany },
    warehouseLog: { findMany: mocks.warehouseLogFindMany, create: mocks.warehouseLogCreate },
  }));
});
afterEach(() => vi.clearAllMocks());

describe('order fulfillment owner consumers', () => {
  it('rejects Yandex legacy ship/cancel paths instead of mutating ERP only', async () => {
    const app = await appFor();
    mocks.orderFindUnique.mockResolvedValue({ id: 'pending', status: 'awaiting_packaging', shop: { id: 'shop-1', userId: 'owner-1', status: 'ACTIVE', platform: 'YANDEX' } });
    expect((await app.inject({ method: 'POST', url: '/api/orders/pending/ship', payload: {} })).statusCode).toBe(409);
    mocks.orderFindUnique.mockResolvedValue({ id: 'pending', status: 'awaiting_packaging', shop: { id: 'shop-1', userId: 'owner-1', status: 'ACTIVE', platform: 'YANDEX' } });
    expect((await app.inject({ method: 'POST', url: '/api/orders/pending/cancel', payload: { reasonId: 1 } })).statusCode).toBe(409);
    expect(mocks.orderUpdate).not.toHaveBeenCalled(); await app.close();
  });
  it('publishes five exhaustive stage counts and normalized children from active owned shops', async () => {
    const app = await appFor();
    const response = await app.inject('/api/orders/pipeline?shopId=shop-1&startDate=2026-10-01&endDate=2026-10-09');
    expect(response.statusCode).toBe(200);
    const data = response.json().data;
    expect(data.total).toBe(8);
    expect(data.stages.map((stage: any) => [stage.key, stage.count])).toEqual([
      ['purchased', 0], ['domestic_transit', 2], ['warehouse_processing', 2], ['delivering', 2], ['abnormal', 2],
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
    expect(scope.id).toEqual({ in: ['pending'] });
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

  it('filters order lists and pipeline scopes by platform before reading orders', async () => {
    mocks.shopFindMany
      .mockResolvedValueOnce([{ id: 'shop-1' }, { id: 'shop-2' }])
      .mockResolvedValueOnce([{ id: 'shop-2' }]);
    const app = await appFor();
    const response = await app.inject('/api/orders?platform=YANDEX');
    expect(response.statusCode).toBe(200);
    expect(mocks.shopFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: { in: ['shop-1', 'shop-2'] }, platform: 'YANDEX' },
      select: { id: true },
    }));
    expect(mocks.orderCount).toHaveBeenCalledWith({ where: { shopId: { in: ['shop-2'] } } });
    await app.close();
  });

  it.each(['startDate=not-a-date', 'startDate=2026-02-30', 'startDate=2026-10-11&endDate=2026-10-09', 'limit=0', 'limit=201', 'offset=-1'])('rejects invalid list and pipeline query before database reads: %s', async query => {
    const app = await appFor();
    for (const path of ['/api/orders', '/api/orders/pipeline']) {
      const response = await app.inject(`${path}?${query}`);
      expect(response.statusCode).toBe(400);
    }
    expect(mocks.orderFindMany).not.toHaveBeenCalled();
    expect(mocks.shopFindMany).not.toHaveBeenCalled();
    await app.close();
  });

  it.each(['posting', 'tracking', 'purchase', 'sku', 'product', 'all'])('uses one scope for list and pipeline searchField=%s', async field => {
    const app = await appFor();
    const query = `search=box&searchField=${field}&startDate=2026-10-01&endDate=2026-10-09&hasTracking=yes&serviceTagId=inspect&purchaseState=unlinked`;
    await app.inject(`/api/orders?${query}`);
    const listWhere = mocks.orderCount.mock.calls[0]?.[0]?.where;
    mocks.orderFindMany.mockClear();
    await app.inject(`/api/orders/pipeline?${query}`);
    expect(mocks.orderFindMany.mock.calls[0]?.[0]?.where).toEqual(listWhere);
    if (field === 'sku' || field === 'product') expect(listWhere).not.toHaveProperty('OR');
    if (field === 'tracking') expect(listWhere.OR).toEqual([
      { trackingNumber: { contains: 'box', mode: 'insensitive' } },
      { domesticTrackingNumber: { contains: 'box', mode: 'insensitive' } },
      { internationalTrackingNumber: { contains: 'box', mode: 'insensitive' } },
    ]);
    await app.close();
  });
});

describe('mark order stock ready', () => {
  const ozonOrder = { id: 'pending', shopId: 'shop-1', platform: 'OZON', shopStatus: 'ACTIVE', clientId: 'fixture-client', apiKeyEncrypted: 'fixture-key',
    postingNumber: 'posting-1', status: 'awaiting_packaging', items: [{ sku: 123, quantity: 1 }] };

  it('the legacy ship route consumes the same assembly owner without inventing delivery', async () => {
    mocks.queryRaw.mockResolvedValue([ozonOrder]);
    mocks.orderFindUnique.mockResolvedValue({ ...ozonOrder, shop: { id: 'shop-1', userId: 'owner-1', status: 'ACTIVE', platform: 'OZON' } });
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/api/orders/pending/ship', payload: {} });
    expect(response.json()).toMatchObject({ code: 1, data: { fulfillmentStage: 'domestic_transit' } });
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    expect(mocks.orderUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { status: 'awaiting_deliver', subStatus: null } }));
    await app.close();
  });

  it('the legacy batch route uses assembly readback rather than a delivery override', async () => {
    mocks.queryRaw.mockResolvedValue([ozonOrder]);
    mocks.orderFindMany.mockResolvedValue([ozonOrder]);
    mocks.shopFindMany.mockResolvedValue([{ id: 'shop-1', userId: 'owner-1', status: 'ACTIVE', platform: 'OZON' }]);
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/api/orders/batch-ship', payload: { orderIds: ['pending'] } });
    expect(response.json().data.results[0]).toMatchObject({ success: true, fulfillmentStage: 'domestic_transit' });
    expect(mocks.orderUpdate).not.toHaveBeenCalled();
    await app.close();
  });
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
    mocks.queryRaw.mockResolvedValue([{ id: 'pending', status: 'awaiting_packaging', domesticStatus: 'received' }]);
    mocks.warehouseLogFindMany.mockResolvedValue([{ orderId: 'pending', operationType: 'stock_ready', createdAt: preparedAt }]);
    const app = await appFor();
    const response = await app.inject({ method: 'PUT', url: '/api/orders/pending/stock-ready', payload: { prepared: true } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.stockPreparedAt).toBe(preparedAt.toISOString());
    expect(response.json().data.fulfillmentStage).toBe('warehouse_processing');
    expect(mocks.warehouseLogCreate).not.toHaveBeenCalled();
    await app.close();
  });

  it.each(['scan_in', 'scan_out'])('refuses fresh stock readiness after a durable %s log', async operationType => {
    mocks.warehouseLogFindMany.mockImplementation(async args => typeof args.where.operationType === 'object' ? [{ operationType, createdAt: preparedAt }] : []);
    const app = await appFor();
    const response = await app.inject({ method: 'PUT', url: '/api/orders/pending/stock-ready', payload: { prepared: true } });
    expect(response.statusCode).toBe(409);
    expect(mocks.warehouseLogCreate).not.toHaveBeenCalled();
    await app.close();
  });

  it('replays the existing stock marker with current physical warehouse stage', async () => {
    mocks.warehouseLogFindMany.mockImplementation(async args => args.where.operationType === 'stock_ready'
      ? [{ operationType: 'stock_ready', createdAt: preparedAt }]
      : [{ operationType: 'scan_in', createdAt: preparedAt }]);
    const app = await appFor();
    const response = await app.inject({ method: 'PUT', url: '/api/orders/pending/stock-ready', payload: { prepared: true } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.fulfillmentStage).toBe('warehouse_processing');
    expect(mocks.warehouseLogCreate).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([{ deliveredAt: preparedAt }, { deliveringDate: preparedAt }, { inspectionStatus: 'failed' }])('refuses fresh readiness after factual dispatch, delivery, or failed inspection', async facts => {
    mocks.queryRaw.mockResolvedValue([{ id: 'pending', status: 'awaiting_packaging', ...facts }]);
    const app = await appFor();
    const response = await app.inject({ method: 'PUT', url: '/api/orders/pending/stock-ready', payload: { prepared: true } });
    expect(response.statusCode).toBe(409); expect(mocks.warehouseLogCreate).not.toHaveBeenCalled();
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
    mocks.queryRaw.mockResolvedValue([{ id: 'pending', status: order.status ?? null, subStatus: null, domesticStatus: order.domesticStatus ?? null, internationalStatus: order.internationalStatus ?? null }]);
    mocks.orderFindUnique.mockResolvedValue({ id: 'pending', ...order });
    const app = await appFor();
    const response = await app.inject({ method: 'PUT', url: '/api/orders/pending/stock-ready', payload: { prepared: true } });
    expect(response.statusCode).toBe(409); expect(mocks.warehouseLogCreate).not.toHaveBeenCalled();
    await app.close();
  });
});

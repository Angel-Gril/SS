import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../lib/prisma.js';
import { encrypt } from '../lib/crypto.js';
import { syncYandexOrders } from '../services/yandex-order-sync.js';

const enabled = process.env.RUN_YANDEX_POSTGRES_TESTS === '1';
const suite = enabled ? describe : describe.skip;
const prefix = 'yandex_orders_' + randomUUID().replaceAll('-', '');
const owner = prefix + '_owner', shopId = prefix + '_shop';
const nativeOrder = { orderId: 12, campaignId: 123, status: 'PROCESSING', substatus: 'READY_TO_SHIP', creationDate: '2026-10-01T10:00:00+03:00', updateDate: '2026-10-02T10:00:00+03:00', fake: false, sourcePlatform: 'MARKET',
  items: [{ id: 1, offerId: '000-A', offerName: 'Товар', count: 1 }], prices: { payment: { value: 100, currencyId: 'RUR' } },
  delivery: { type: 'PICKUP', serviceName: 'Yandex carrier', deliveryServiceId: 9, deliveryPartnerType: 'YANDEX_MARKET', dates: { fromDate: '2026-10-05' }, tracks: [{ trackCode: 'T1', deliveryServiceId: 9 }] } };
let binding: Parameters<typeof syncYandexOrders>[0];
function transport(raw = nativeOrder, failSecond = false) {
  vi.stubGlobal('fetch', vi.fn(async (input: URL) => {
    if (input.pathname === '/v2/campaigns/123') return new Response(JSON.stringify({ campaign: { id: 123, business: { id: 77 }, apiAvailability: 'AVAILABLE' } }));
    if (input.pathname === '/v2/businesses/77/settings') return new Response(JSON.stringify({ status: 'OK', result: { settings: { warehouseModel: 'CAMPAIGN', onlyDefaultPrice: false, currency: 'RUR' } } }));
    if (input.pathname === '/v1/businesses/77/orders') {
      if (input.searchParams.has('pageToken')) throw Error('synthetic read failure');
      return new Response(JSON.stringify({ orders: [raw], ...(failSecond ? { paging: { nextPageToken: 'n' } } : {}) }));
    }
    throw Error('Unexpected provider writer or read path');
  }));
}
suite('Yandex order snapshot on isolated PostgreSQL', () => {
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL || '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^yandex_test_[a-z0-9_]+$/u.test(url.searchParams.get('schema') || '')) throw Error('isolated local schema required');
    await prisma.user.create({ data: { id: owner, phone: prefix, passwordHash: 'synthetic-hash' } });
    binding = await prisma.shop.create({ data: { id: shopId, userId: owner, platform: 'YANDEX', name: 'order test shop', apiKeyEncrypted: encrypt('synthetic-key'), clientId: '123', status: 'ACTIVE', config: { yandexMarket: { campaignId: '123', businessId: '77' } } } });
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await prisma.orderTrackingEvent.deleteMany({ where: { order: { shopId } } });
    await prisma.order.deleteMany({ where: { shopId } }); await prisma.shop.delete({ where: { id: shopId } }); await prisma.user.delete({ where: { id: owner } }); await prisma.$disconnect();
  });
  it('persists and replays one native order with its carrier and timeline, leaving platform actions untouched', async () => {
    transport(); const since = new Date(Date.now() - 29 * 86400000).toISOString();
    expect(await syncYandexOrders(binding, since)).toMatchObject({ created: 1, orders: 1 });
    expect(await syncYandexOrders(binding, since)).toMatchObject({ created: 0, updated: 1 });
    const saved = await prisma.order.findUniqueOrThrow({ where: { shopId_platformOrderId: { shopId, platformOrderId: '12' } } });
    expect(saved).toMatchObject({ status: 'awaiting_deliver', shippingMethod: 'Yandex carrier', trackingNumber: 'T1', subStatus: 'yandex:PROCESSING:READY_TO_SHIP', totalAmount: expect.anything() });
    expect(saved.shippingInfo).toMatchObject({ yandexMarket: { sourcePlatform: 'MARKET', deliveryServiceId: 9 } });
    expect(await prisma.orderTrackingEvent.count({ where: { orderId: saved.id, source: 'yandex' } })).toBe(1);
  });
  it('keeps a later platform state and internal warehouse/purchase fields intact', async () => {
    const saved = await prisma.order.findUniqueOrThrow({ where: { shopId_platformOrderId: { shopId, platformOrderId: '12' } } });
    await prisma.order.update({ where: { id: saved.id }, data: { purchaseOrderId: 'synthetic-purchase', domesticTrackingNumber: 'DOMESTIC1' } });
    transport({ ...nativeOrder, status: 'DELIVERED', updateDate: '2026-10-03T00:00:00Z' });
    await syncYandexOrders(binding, new Date(Date.now() - 29 * 86400000).toISOString());
    transport(); await syncYandexOrders(binding, new Date(Date.now() - 29 * 86400000).toISOString());
    expect(await prisma.order.findUnique({ where: { id: saved.id } })).toMatchObject({ status: 'delivered', purchaseOrderId: 'synthetic-purchase', domesticTrackingNumber: 'DOMESTIC1' });
  });
  it('does not persist a partial page or bypass changed tenant credentials', async () => {
    transport({ ...nativeOrder, orderId: 13 }, true);
    await expect(syncYandexOrders(binding, new Date(Date.now() - 29 * 86400000).toISOString())).rejects.toThrow();
    expect(await prisma.order.count({ where: { shopId } })).toBe(1);
    transport({ ...nativeOrder, orderId: 13 }); await prisma.shop.update({ where: { id: shopId }, data: { status: 'DISABLED' } });
    await expect(syncYandexOrders(binding, new Date(Date.now() - 29 * 86400000).toISOString())).rejects.toThrow('已变化');
    expect(await prisma.order.count({ where: { shopId } })).toBe(1);
  });
});

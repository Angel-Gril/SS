import { describe, expect, it, vi, beforeEach } from 'vitest';
const m = vi.hoisted(() => ({ orders: vi.fn(), settings: vi.fn(), update: vi.fn(), find: vi.fn(), upsert: vi.fn(), event: vi.fn(), shop: vi.fn(), shopFind: vi.fn(), lock: vi.fn(), tx: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { order: { findUnique: m.find, upsert: m.upsert }, orderTrackingEvent: { upsert: m.event }, shop: { update: m.shop }, $transaction: m.tx } }));
vi.mock('../lib/crypto.js', () => ({ decrypt: vi.fn(() => 'key') }));
vi.mock('../services/yandex-market-client.js', () => ({ YandexMarketClient: class { getBusinessOrders = m.orders; getBusinessSettings = m.settings; } }));
vi.mock('../services/yandex-market-catalog.js', () => ({ readYandexBusiness: vi.fn().mockResolvedValue('77') }));
import { syncYandexOrders } from '../services/yandex-order-sync.js';
const order = { orderId: 12, campaignId: 123, status: 'DELIVERY', substatus: 'SHIPPED', creationDate: '2026-10-01T10:00:00+03:00', updateDate: '2026-10-02T10:00:00+03:00', fake: false, items: [{ id: 1, offerId: '000-A', offerName: 'T', count: 1 }], prices: { payment: { value: 100, currencyId: 'RUR' }, delivery: { payment: { value: 5, currencyId: 'RUR' }, subsidy: { value: 2, currencyId: 'RUR' } } }, delivery: { type: 'PICKUP', serviceName: 'Ozon delivery', deliveryServiceId: 9, deliveryPartnerType: 'YANDEX_MARKET', dates: { fromDate: '2026-10-05' }, tracks: [{ trackCode: 'T1', deliveryServiceId: 9 }] } };
describe('Yandex order sync owner', () => {
  beforeEach(() => { vi.clearAllMocks(); m.orders.mockResolvedValue({ orders: [order], nextPageToken: null }); m.settings.mockResolvedValue({ currency: 'RUR' }); m.find.mockResolvedValue(null); m.upsert.mockResolvedValue({ id: 'local-order' }); m.event.mockResolvedValue({}); m.shop.mockResolvedValue({}); m.shopFind.mockResolvedValue({ config: {} }); m.tx.mockImplementation(async (callback: any) => callback({ $executeRaw: m.lock, order: { findUnique: m.find, upsert: m.upsert }, orderTrackingEvent: { upsert: m.event }, shop: { update: m.shop, findFirst: m.shopFind } })); });
  it('reads one campaign, stores native carrier/track/status and never invokes Ozon', async () => {
    const result = await syncYandexOrders({ id: 'shop', userId: 'owner', clientId: '123', apiKeyEncrypted: 'e', status: 'ACTIVE', config: { yandexMarket: { businessId: '77' } } });
    expect(result).toMatchObject({ created: 1, updated: 0, orders: 1 });
    expect(m.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ status: 'delivering', totalAmount: 107, trackingNumber: 'T1', shippingMethod: 'Ozon delivery', currency: 'RUB', items: [expect.objectContaining({ platform: 'YANDEX' })] }) }));
    expect(m.event).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ source: 'yandex', substatus: 'yandex:DELIVERY:SHIPPED' }) }));
  });
  it('does not write partial results when a later page fails', async () => {
    m.orders.mockResolvedValueOnce({ orders: [order], nextPageToken: 'n' }).mockRejectedValueOnce(new Error('read failed'));
    await expect(syncYandexOrders({ id: 'shop', userId: 'owner', clientId: '123', apiKeyEncrypted: 'e', status: 'ACTIVE', config: { yandexMarket: { businessId: '77' } } })).rejects.toThrow('read failed');
    expect(m.upsert).not.toHaveBeenCalled(); expect(m.shop).not.toHaveBeenCalled();
  });
  it('refuses to save after the bound shop is disabled or its credentials change', async () => {
    m.shopFind.mockResolvedValue(null);
    await expect(syncYandexOrders({ id: 'shop', userId: 'owner', clientId: '123', apiKeyEncrypted: 'e', status: 'ACTIVE', config: {} })).rejects.toThrow('已变化');
    expect(m.upsert).not.toHaveBeenCalled();
  });
  it('does not regress a newer persisted platform snapshot', async () => {
    m.find.mockResolvedValue({ id: 'local-order', shippingInfo: { yandexMarket: { updateDate: '2026-10-03T10:00:00Z' } } });
    await syncYandexOrders({ id: 'shop', userId: 'owner', clientId: '123', apiKeyEncrypted: 'e', status: 'ACTIVE', config: {} });
    expect(m.upsert).not.toHaveBeenCalled(); expect(m.event).not.toHaveBeenCalled();
  });
});

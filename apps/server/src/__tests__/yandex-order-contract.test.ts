import { describe, expect, it } from 'vitest';
import { normalizeYandexOrder, yandexOrder, yandexOrderDateWindows } from '../services/yandex-order-contract.js';
const raw = { orderId: 12, campaignId: 123, status: 'PROCESSING', substatus: 'STARTED', creationDate: '2026-10-01T10:00:00+03:00', updateDate: '2026-10-02T10:00:00+03:00', fake: false,
  items: [{ id: 1, offerId: '000-A', offerName: 'Товар', count: 2, prices: { payment: { value: 80, currencyId: 'RUR' }, cashback: { value: 20, currencyId: 'RUR' } } }], prices: { payment: { value: 80, currencyId: 'RUR' }, cashback: { value: 20, currencyId: 'RUR' }, subsidy: { value: 10, currencyId: 'RUR' }, delivery: { payment: { value: 5, currencyId: 'RUR' }, subsidy: { value: 2, currencyId: 'RUR' } } },
  delivery: { type: 'PICKUP', serviceName: 'Ozon test carrier', deliveryServiceId: 9, deliveryPartnerType: 'YANDEX_MARKET', dates: { fromDate: '2026-10-05' }, tracks: [{ trackCode: 'track1', deliveryServiceId: 9 }] } };
describe('Yandex native order contract', () => {
  it('retains carrier, source semantics and separates item/delivery price', () => {
    const n = normalizeYandexOrder(yandexOrder.parse(raw), 'RUR');
    expect(n).toMatchObject({ status: 'awaiting_packaging', totalAmount: 107, trackingNumber: 'track1', currency: 'RUB', shippingMethod: 'Ozon test carrier' });
    expect(n.shippingInfo).toMatchObject({ yandexMarket: { itemPrice: 100, deliveryPrice: 7, deliveryPartnerType: 'YANDEX_MARKET' } });
  });
  it('maps native status transitions without Ozon status aliases', () => {
    expect(normalizeYandexOrder(yandexOrder.parse({ ...raw, status: 'PROCESSING', substatus: 'READY_TO_SHIP' }), 'RUR').status).toBe('awaiting_deliver');
    expect(normalizeYandexOrder(yandexOrder.parse({ ...raw, status: 'DELIVERY', substatus: 'SHIPPED' }), 'RUR').status).toBe('delivering');
    expect(normalizeYandexOrder(yandexOrder.parse({ ...raw, status: 'DELIVERED', substatus: 'STARTED' }), 'RUR').status).toBe('delivered');
  });
  it('splits order history into consecutive maximum 30-day windows', () => {
    const windows = yandexOrderDateWindows('2026-07-01T12:00:00Z', new Date('2026-10-28T12:00:00Z'));
    expect(windows[0]).toEqual({ from: '2026-07-01', to: '2026-07-31' }); for (let i = 1; i < windows.length; i += 1) expect(windows[i]!.from).toBe(windows[i - 1]!.to);
  });
});

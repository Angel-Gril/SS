import { describe, expect, it } from 'vitest';
import { normalizeYandexOrder, yandexOrder, yandexOrderDateWindows, yandexOrderActions, yandexOrderTarget, validateYandexBoxes } from '../services/yandex-order-contract.js';
const raw = { orderId: 12, campaignId: 123, status: 'PROCESSING', substatus: 'STARTED', creationDate: '2026-10-01T10:00:00+03:00', updateDate: '2026-10-02T10:00:00+03:00', fake: false,
  items: [{ id: 1, offerId: '000-A', offerName: 'Товар', count: 2, prices: { payment: { value: 80, currencyId: 'RUR' }, cashback: { value: 20, currencyId: 'RUR' } } }], prices: { payment: { value: 80, currencyId: 'RUR' }, cashback: { value: 20, currencyId: 'RUR' }, subsidy: { value: 10, currencyId: 'RUR' }, delivery: { payment: { value: 5, currencyId: 'RUR' }, subsidy: { value: 2, currencyId: 'RUR' } } },
  delivery: { type: 'PICKUP', serviceName: 'Ozon test carrier', deliveryServiceId: 9, deliveryPartnerType: 'YANDEX_MARKET', dates: { fromDate: '2026-10-05' }, tracks: [{ trackCode: 'track1', deliveryServiceId: 9 }] } };
describe('Yandex native order contract', () => {
  it('provides mode-specific actions and prevents label generation for unsupported orders', () => {
    expect(yandexOrderActions(yandexOrder.parse({ ...raw, programType: 'FBS' }))).toMatchObject({ PACK: true, READY: true, DELIVER: false, COMPLETE: false });
    expect(yandexOrderActions(yandexOrder.parse({ ...raw, programType: 'FBY' }))).toMatchObject({ PACK: false, READY: false, CANCEL: false, label: false });
    expect(yandexOrderActions(yandexOrder.parse({ ...raw, programType: 'DBS' }))).toMatchObject({ DELIVER: true, READY: false, TRACK: true });
  });
  it('separates DBS delivery from FBS handoff and permits only supported LaaS actions', () => {
    const order = yandexOrder.parse(raw);
    expect(yandexOrderActions({ ...order, programType: 'FBS', substatus: 'READY_TO_SHIP' })).toMatchObject({ READY: false, DELIVER: false });
    expect(yandexOrderTarget('DELIVER')).toEqual({ status: 'DELIVERY', substatus: 'DELIVERY_SERVICE_RECEIVED' });
    expect(yandexOrderTarget('PICKUP')).toEqual({ status: 'PICKUP', substatus: 'PICKUP_SERVICE_RECEIVED' });
    expect(yandexOrderTarget('COMPLETE')).toEqual({ status: 'DELIVERED', substatus: 'DELIVERY_SERVICE_DELIVERED' });
    expect(yandexOrderActions({ ...order, programType: 'LAAS', status: 'RESERVED' })).toMatchObject({ CONFIRM: true, PACK: false, label: false, CANCEL: true });
    expect(yandexOrderActions({ ...order, programType: 'DBS', status: 'PICKUP', substatus: 'PICKUP_SERVICE_RECEIVED' }).cancelReasons).toEqual(['SHOP_FAILED', 'USER_CHANGED_MIND', 'PICKUP_EXPIRED']);
  });
  it('requires exact order-item totals and marking codes, never silently removes products', () => {
    const o = yandexOrder.parse(raw);
    expect(validateYandexBoxes(o, [{ items: [{ id: 1, fullCount: 2 }] }])).toEqual([]);
    expect(validateYandexBoxes(o, [{ items: [{ id: 1, fullCount: 1 }] }])).toContain('商品1装箱数量必须等于订单数量');
    expect(validateYandexBoxes(o, [{ items: [{ id: 999, fullCount: 2 }] }])).toContain('箱内商品999不属于当前订单');
    expect(validateYandexBoxes({ ...o, items: [{ ...o.items[0]!, requiredInstanceTypes: ['CIS'] }] }, [{ items: [{ id: 1, fullCount: 2 }] }])).toContain('商品1需要2份CIS标记');
  });
  it('allows multiple units from the same customs batch but never duplicate unit CIS', () => {
    const o = yandexOrder.parse(raw);
    expect(validateYandexBoxes(o, [{ items: [{ id: 1, fullCount: 2, instances: [{ rnpt: 'batch-1' }, { rnpt: 'batch-1' }] }] }])).toEqual([]);
    expect(validateYandexBoxes(o, [{ items: [{ id: 1, fullCount: 2, instances: [{ cis: 'unit-1' }, { cis: 'unit-1' }] }] }])).toContain('商品标记不能重复');
  });
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
  it('rejects mixed delivery currency and invalid calendar dates', () => {
    const bad = { ...raw, prices: { ...raw.prices, delivery: { payment: { value: 5, currencyId: 'USD' } } } };
    expect(() => normalizeYandexOrder(yandexOrder.parse(bad), 'RUR')).toThrow('币种');
    expect(yandexOrder.safeParse({ ...raw, delivery: { ...raw.delivery, shipment: { shipmentDate: '2026-02-30' } } }).success).toBe(false);
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
const m = vi.hoisted(() => ({ product: vi.fn(), order: vi.fn(), shop: vi.fn(), find: vi.fn(), unresolved: vi.fn(), create: vi.fn(), update: vi.fn(), tx: vi.fn(), lock: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { order: { findFirst: m.order }, yandexOfferPublishOperation: { findUnique: m.find, update: m.update }, $transaction: m.tx } }));
import { executeYandexOrderOperation } from '../services/yandex-order-operations.js';

const raw = { orderId: 456, campaignId: 123, status: 'PROCESSING', substatus: 'STARTED', programType: 'FBS', fake: false, creationDate: '2026-10-01T00:00:00Z', items: [{ id: 1, offerId: '000-A', offerName: 'Товар', count: 2 }], delivery: { type: 'PICKUP', serviceName: 'carrier', deliveryServiceId: 9, deliveryPartnerType: 'YANDEX_MARKET', dates: { fromDate: '2026-10-10' } } };
function fixture(action = 'PACK') {
  return { shop: { id: 'shop', userId: 'owner', clientId: '123', apiKeyEncrypted: 'encrypted', status: 'ACTIVE', config: { yandexMarket: { businessId: '77' } } }, ownerUserId: 'owner', actorUserId: 'actor', orderId: 'local-order',
    client: { getCampaign: vi.fn().mockResolvedValue({ id: '123', business: { id: '77' }, apiAvailability: 'AVAILABLE', placementType: 'FBS' }), getOrder: vi.fn().mockResolvedValue(raw), setOrderBoxes: vi.fn().mockResolvedValue({ boxes: [{ boxId: 1, items: [{ id: 1, fullCount: 2 }] }] }), updateOrderStatus: vi.fn().mockResolvedValue({ operation: { id: 'operation-1', type: 'ORDER_STATUS_UPDATE' } }), getOrderOperation: vi.fn().mockResolvedValue({ id: 'operation-1', status: 'IN_PROGRESS' }), getOrderIdentifiersStatus: vi.fn().mockResolvedValue({ items: [] }), setOrderTrack: vi.fn().mockResolvedValue({ status: 'OK' }), getDeliveryServices: vi.fn().mockResolvedValue([{ id: 9, name: 'carrier' }]) },
    body: { action, confirm: true, idempotencyKey: 'synthetic-order-command-key', ...(action === 'PACK' ? { boxes: [{ items: [{ id: 1, fullCount: 2 }] }] } : {}) } };
}
describe('Yandex order commands', () => {
  beforeEach(() => { vi.clearAllMocks(); m.find.mockResolvedValue(null); m.unresolved.mockResolvedValue(null); m.order.mockResolvedValue({ id: 'local-order', platformOrderId: '456', shopId: 'shop' }); m.shop.mockResolvedValue({ id: 'shop' }); m.create.mockImplementation(async ({ data }) => ({ id: 'op', ...data })); m.update.mockResolvedValue({}); m.tx.mockImplementation(async fn => fn({ $executeRaw: m.lock, shop: { findFirst: m.shop }, yandexOfferPublishOperation: { findUnique: m.find, findFirst: m.unresolved, create: m.create } })); });
  it('validates exact item counts before reserving and sends only the owned native order', async () => {
    const f = fixture(); f.body.boxes = [{ items: [{ id: 1, fullCount: 1 }] }];
    await expect(executeYandexOrderOperation(f)).rejects.toThrow('数量'); expect(m.create).not.toHaveBeenCalled();
    f.body.boxes = [{ items: [{ id: 1, fullCount: 2 }] }]; expect(await executeYandexOrderOperation(f)).toMatchObject({ state: 'SUCCEEDED', replayed: false });
    expect(f.client.setOrderBoxes).toHaveBeenCalledWith('123', '456', f.body.boxes);
  });
  it('rejects foreign or changed platform orders without an external write', async () => {
    const f = fixture(); m.order.mockResolvedValue(null); await expect(executeYandexOrderOperation(f)).rejects.toThrow('订单');
    expect(f.client.getOrder).not.toHaveBeenCalled(); expect(f.client.setOrderBoxes).not.toHaveBeenCalled();
  });
  it('keeps timeouts unknown and reconciles the original layout without sending twice', async () => {
    const f = fixture(); f.client.setOrderBoxes.mockRejectedValue(new Error('timeout')); expect(await executeYandexOrderOperation(f)).toMatchObject({ state: 'UNKNOWN' });
    const saved = { ...m.create.mock.calls[0]![0].data, id: 'op', state: 'UNKNOWN', response: null }; m.find.mockResolvedValue(saved);
    f.client.getOrder.mockResolvedValue({ ...raw, delivery: { ...raw.delivery, boxesLayout: [{ boxId: 8, items: [{ id: 1, fullCount: 2 }] }] } });
    expect(await executeYandexOrderOperation(f)).toMatchObject({ state: 'SUCCEEDED', replayed: true }); expect(f.client.setOrderBoxes).toHaveBeenCalledTimes(1);
  });
  it('does not treat an asynchronous operation acknowledgement as completed cancellation', async () => {
    const f = fixture('CANCEL'); (f.body as any).cancelReason = 'SHOP_FAILED';
    expect(await executeYandexOrderOperation(f)).toMatchObject({ state: 'SUBMITTING' });
    const saved = { ...m.create.mock.calls[0]![0].data, id: 'op', state: 'SUBMITTING', response: { operation: { id: 'operation-1' } } }; m.find.mockResolvedValue(saved);
    expect(await executeYandexOrderOperation(f)).toMatchObject({ state: 'SUBMITTING', replayed: true });
    f.client.getOrderOperation.mockResolvedValue({ id: 'operation-1', status: 'FAILED' });
    expect(await executeYandexOrderOperation(f)).toMatchObject({ state: 'REJECTED', replayed: true }); expect(f.client.updateOrderStatus).toHaveBeenCalledTimes(1);
  });
  it('blocks a new idempotency key while a command for the same order is unresolved', async () => {
    const f = fixture(); m.unresolved.mockResolvedValue({ id: 'older' });
    await expect(executeYandexOrderOperation(f)).rejects.toThrow('未确认'); expect(f.client.setOrderBoxes).not.toHaveBeenCalled();
  });
  it('does not report a returned box layout with missing goods as success', async () => {
    const f = fixture(); f.client.setOrderBoxes.mockResolvedValue({ boxes: [{ boxId: 1, items: [{ id: 1, fullCount: 1 }] }] });
    expect(await executeYandexOrderOperation(f)).toMatchObject({ state: 'UNKNOWN' });
  });
  it('requires successful validation of the exact mandatory marking codes before READY', async () => {
    const f = fixture('READY');
    f.client.getOrder.mockResolvedValue({ ...raw, items: [{ ...raw.items[0]!, requiredInstanceTypes: ['CIS'] }], delivery: { ...raw.delivery, boxesLayout: [{ boxId: 1, items: [{ id: 1, fullCount: 2, instances: [{ cis: 'a' }, { cis: 'b' }] }] }] } } as any);
    await expect(executeYandexOrderOperation(f)).rejects.toThrow('标记'); expect(f.client.updateOrderStatus).not.toHaveBeenCalled();
    f.client.getOrderIdentifiersStatus.mockResolvedValue({ items: [{ id: 1, cis: [{ value: 'a', status: 'OK' }, { value: 'b', status: 'OK' }] }] } as any);
    expect(await executeYandexOrderOperation(f)).toMatchObject({ state: 'SUBMITTING' });
  });
  it('keeps the durable unknown if readback outcome cannot be persisted', async () => {
    const f = fixture(); f.client.setOrderBoxes.mockRejectedValue(Error('timeout')); await executeYandexOrderOperation(f);
    m.find.mockResolvedValue({ ...m.create.mock.calls[0]![0].data, id: 'op', state: 'UNKNOWN', response: null });
    f.client.getOrder.mockResolvedValue({ ...raw, delivery: { ...raw.delivery, boxesLayout: [{ boxId: 8, items: [{ id: 1, fullCount: 2 }] }] } }); m.update.mockRejectedValue(Error('DB unavailable'));
    expect(await executeYandexOrderOperation(f)).toMatchObject({ state: 'UNKNOWN', replayed: true });
  });
  it('matches official cisFull/cis readback with the original full code', async () => {
    const f = fixture(); (f.body.boxes![0]!.items[0] as any).instances = [{ cis: 'full-a' }, { cis: 'full-b' }];
    f.client.setOrderBoxes.mockRejectedValue(Error('timeout')); await executeYandexOrderOperation(f);
    m.find.mockResolvedValue({ ...m.create.mock.calls[0]![0].data, id: 'op', state: 'UNKNOWN', response: null });
    f.client.getOrder.mockResolvedValue({ ...raw, delivery: { ...raw.delivery, boxesLayout: [{ boxId: 8, items: [{ id: 1, fullCount: 2, instances: [{ cis: 'a', cisFull: 'full-a' }, { cis: 'b', cisFull: 'full-b' }] }] }] } } as any);
    expect(await executeYandexOrderOperation(f)).toMatchObject({ state: 'SUCCEEDED', replayed: true });
    expect(f.client.setOrderBoxes).toHaveBeenCalledOnce();
  });
});

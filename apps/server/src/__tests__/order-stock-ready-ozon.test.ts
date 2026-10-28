import { describe, expect, it, vi } from 'vitest';
import { createOrderStockReadyService } from '../services/order-stock-ready.js';
import { OzonApiError } from '../services/ozon-client.js';

function fixture() {
  const order: any = { id: 'order-1', shopId: 'shop-1', platform: 'OZON', shopStatus: 'ACTIVE', clientId: 'fixture', apiKeyEncrypted: 'fixture',
    postingNumber: 'posting-1', status: 'awaiting_packaging', subStatus: 'posting_awaiting_packaging', items: [{ sku: 123, quantity: 2 }] };
  const logs: any[] = [];
  const tx: any = {
    $queryRaw: vi.fn(async () => [{ ...order }]),
    order: { updateMany: vi.fn(async ({ where, data }: any) => { if (where.id !== order.id) return { count: 0 }; Object.assign(order, data); return { count: 1 }; }) },
    warehouseLog: {
      findMany: vi.fn(async ({ where }: any) => logs.filter(log => typeof where.operationType === 'string'
        ? log.operationType === where.operationType : where.operationType.in.includes(log.operationType)).slice().reverse()),
      create: vi.fn(async ({ data }: any) => { const log = { ...data, id: `log-${logs.length}`, createdAt: new Date() }; logs.push(log); return log; }),
    },
  };
  let gate = Promise.resolve();
  const db: any = { $transaction: vi.fn((callback: any) => {
    const result = gate.then(() => callback(tx)); gate = result.then(() => undefined, () => undefined); return result;
  }) };
  const client = {
    getPostingByNumber: vi.fn().mockResolvedValue({ posting_number: 'posting-1', status: 'awaiting_deliver', substatus: 'posting_awaiting_deliver' }),
    shipPackage: vi.fn().mockResolvedValue({ result: ['posting-1'] }),
  };
  const createClient = vi.fn(() => client);
  const service = createOrderStockReadyService(db, { createClient } as never);
  const input = { orderId: order.id, ownerUserId: 'owner-1', actorUserId: 'actor-1' };
  return { service, input, order, logs, tx, client, createClient };
}

describe('Ozon stock readiness owner', () => {
  it('does not create an internal success marker for a Yandex order', async () => {
    const f = fixture(); f.order.platform = 'YANDEX';
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'rejected' });
    expect(f.tx.warehouseLog.create).not.toHaveBeenCalled(); expect(f.createClient).not.toHaveBeenCalled();
  });
  it('assembles once, persists platform readback and replays without another write', async () => {
    const f = fixture();
    f.client.getPostingByNumber.mockResolvedValueOnce({ posting_number: 'posting-1', status: 'awaiting_packaging' });
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'marked', stage: 'domestic_transit' });
    expect(f.client.shipPackage).toHaveBeenCalledWith({ posting_number: 'posting-1', packages: [{ products: [{ product_id: 123, quantity: 2 }] }] });
    expect(f.order.status).toBe('awaiting_deliver');
    expect(f.order).not.toHaveProperty('deliveringDate');
    expect(f.logs.filter(log => log.operationType === 'stock_ready')).toHaveLength(1);
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'marked', replayed: true });
    expect(f.client.shipPackage).toHaveBeenCalledTimes(1);
  });

  it('recognizes readiness performed in the seller portal without resubmitting', async () => {
    const f = fixture();
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'marked', stage: 'domestic_transit' });
    expect(f.client.shipPackage).not.toHaveBeenCalled();
    expect(f.order.status).toBe('awaiting_deliver');
  });

  it('does not trust an old local stock marker over the platform', async () => {
    const f = fixture();
    f.logs.push({ id: 'legacy', orderId: 'order-1', operationType: 'stock_ready', createdAt: new Date() });
    f.client.getPostingByNumber.mockResolvedValueOnce({ posting_number: 'posting-1', status: 'awaiting_packaging' });
    await f.service.mark(f.input);
    expect(f.client.shipPackage).toHaveBeenCalledTimes(1);
  });

  it('keeps an unknown submission pending and reconciles without another assembly', async () => {
    const f = fixture();
    f.client.getPostingByNumber.mockResolvedValue({ posting_number: 'posting-1', status: 'awaiting_packaging' });
    f.client.shipPackage.mockRejectedValue(new Error('timeout'));
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'pending' });
    expect(f.logs.some(log => log.operationType === 'stock_ready')).toBe(false);
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'pending' });
    expect(f.client.shipPackage).toHaveBeenCalledTimes(1);
    f.client.getPostingByNumber.mockResolvedValue({ posting_number: 'posting-1', status: 'awaiting_deliver' });
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'marked', stage: 'domestic_transit' });
    expect(f.client.shipPackage).toHaveBeenCalledTimes(1);
  });

  it('HTTP 200 with ship_failed never creates a success marker', async () => {
    const f = fixture();
    f.client.getPostingByNumber.mockResolvedValueOnce({ posting_number: 'posting-1', status: 'awaiting_packaging' })
      .mockResolvedValueOnce({ posting_number: 'posting-1', status: 'awaiting_packaging', substatus: 'ship_failed' });
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'rejected' });
    expect(f.logs.some(log => log.operationType === 'stock_ready')).toBe(false);
    expect(f.order.status).toBe('awaiting_packaging');
  });
  it('a later request can retry after an explicit ship_failed readback', async () => {
    const f = fixture();
    f.client.getPostingByNumber.mockResolvedValueOnce({ posting_number: 'posting-1', status: 'awaiting_packaging' });
    f.client.shipPackage.mockRejectedValueOnce(new Error('timeout'));
    f.client.getPostingByNumber.mockResolvedValueOnce({ posting_number: 'posting-1', status: 'awaiting_packaging' });
    await f.service.mark(f.input);
    f.client.getPostingByNumber.mockResolvedValueOnce({ posting_number: 'posting-1', status: 'awaiting_packaging', substatus: 'ship_failed' });
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'rejected' });
    expect(f.client.shipPackage).toHaveBeenCalledTimes(1);
  });

  it('never replaces a newer dispatched state with a stale assembly readback', async () => {
    const f = fixture();
    f.client.getPostingByNumber.mockImplementationOnce(async () => {
      f.order.status = 'delivering';
      return { posting_number: 'posting-1', status: 'awaiting_deliver' };
    });
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'immutable', stage: 'delivering' });
    expect(f.order.status).toBe('delivering');
    expect(f.client.shipPackage).not.toHaveBeenCalled();
  });
  it('accepts a later platform cancellation even after readiness was confirmed', async () => {
    const f = fixture(); f.order.status = 'awaiting_deliver';
    f.client.getPostingByNumber.mockResolvedValue({ posting_number: 'posting-1', status: 'cancelled' });
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'immutable', stage: 'abnormal' });
    expect(f.order.status).toBe('cancelled');
  });
  it('does not assemble changed provider quantities under an old frozen request', async () => {
    const f = fixture();
    f.client.getPostingByNumber.mockResolvedValue({ posting_number: 'posting-1', status: 'awaiting_packaging', products: [{ sku: 123, quantity: 3 }] });
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'rejected' });
    expect(f.client.shipPackage).not.toHaveBeenCalled();
  });
  it('rechecks ownership and physical facts immediately before dispatch', async () => {
    const f = fixture();
    f.client.getPostingByNumber.mockImplementationOnce(async () => {
      f.logs.push({ id: 'received', operationType: 'scan_in', createdAt: new Date() });
      return { posting_number: 'posting-1', status: 'awaiting_packaging' };
    });
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'immutable', stage: 'warehouse_processing' });
    expect(f.client.shipPackage).not.toHaveBeenCalled();
  });
  it('does not submit after the shop ownership is revoked during readback', async () => {
    const f = fixture();
    f.client.getPostingByNumber.mockImplementationOnce(async () => {
      f.tx.$queryRaw.mockResolvedValue([]);
      return { posting_number: 'posting-1', status: 'awaiting_packaging' };
    });
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'not_found' });
    expect(f.client.shipPackage).not.toHaveBeenCalled();
  });

  it('allows retry only after a definitive provider rejection', async () => {
    const f = fixture();
    f.client.getPostingByNumber.mockResolvedValue({ posting_number: 'posting-1', status: 'awaiting_packaging' });
    f.client.shipPackage.mockRejectedValueOnce(new OzonApiError(400, '{}', '/v4/posting/fbs/ship'));
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'rejected' });
    f.client.getPostingByNumber.mockResolvedValueOnce({ posting_number: 'posting-1', status: 'awaiting_packaging' })
      .mockResolvedValue({ posting_number: 'posting-1', status: 'awaiting_deliver' });
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'marked' });
    expect(f.client.shipPackage).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent clicks at the durable dispatch boundary', async () => {
    const f = fixture();
    f.client.getPostingByNumber.mockResolvedValueOnce({ posting_number: 'posting-1', status: 'awaiting_packaging' });
    await Promise.all([f.service.mark(f.input), f.service.mark(f.input)]);
    expect(f.client.shipPackage.mock.calls.length).toBeLessThanOrEqual(1);
    expect(f.logs.filter(log => log.operationType === 'stock_ready')).toHaveLength(1);
  });

  it.each(['cancelled', 'delivering', 'delivered'])('does not assemble an order read back as %s', async status => {
    const f = fixture();
    f.client.getPostingByNumber.mockResolvedValue({ posting_number: 'posting-1', status });
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'immutable' });
    expect(f.client.shipPackage).not.toHaveBeenCalled();
    expect(f.logs.some(log => log.operationType === 'stock_ready')).toBe(false);
  });

  it('refuses a foreign order before credentials or external calls', async () => {
    const f = fixture(); f.tx.$queryRaw.mockResolvedValue([]);
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'not_found' });
    expect(f.createClient).not.toHaveBeenCalled();
  });

  it('does not submit malformed or incomplete product quantities', async () => {
    const f = fixture(); f.order.items = [{ sku: 123, quantity: 0 }];
    f.client.getPostingByNumber.mockResolvedValue({ posting_number: 'posting-1', status: 'awaiting_packaging' });
    expect(await f.service.mark(f.input)).toMatchObject({ kind: 'rejected' });
    expect(f.client.shipPackage).not.toHaveBeenCalled();
  });
});

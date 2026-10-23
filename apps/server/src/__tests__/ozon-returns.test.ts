import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { returnRoutes } from '../routes/return.js';
import { mapOzonReturn } from '../services/ozon-returns.js';

const mocks = vi.hoisted(() => ({
  getReturnsList: vi.fn(), findShop: vi.fn(), upsert: vi.fn(), createJob: vi.fn(), updateJob: vi.fn(),
}));
vi.mock('../lib/auth.js', () => ({ authenticate: async (request: any) => { request.user = { userId: 'owner' }; } }));
vi.mock('../lib/crypto.js', () => ({ decrypt: () => 'synthetic-key' }));
vi.mock('../lib/prisma.js', () => ({ prisma: {
  shop: { findFirst: mocks.findShop }, return: { upsert: mocks.upsert },
  syncJob: { create: mocks.createJob, update: mocks.updateJob },
} }));
vi.mock('../services/ozon-client.js', () => ({ OzonClient: class { getReturnsList = mocks.getReturnsList; } }));

function row(id: string | number = '9007199254740993') {
  return {
    id, posting_number: 'fixture-0001-1', return_reason_name: 'buyer return',
    visual: { status: { id: 10, display_name: 'Returned to warehouse', sys_name: 'ReturnedToOzon' }, change_moment: '2026-10-22T10:00:00Z' },
    product: { offer_id: 'offer-1', sku: '1001', quantity: 2, price: { price: '0.00', currency_code: 'CNY' } },
    storage: { arrived_moment: '2026-10-22T10:01:00Z' },
    logistic: { return_date: '2026-10-20T11:00:00Z', final_moment: '2026-10-22T10:02:00Z' },
  };
}
async function appFor() {
  const app = Fastify();
  await app.register(returnRoutes, { prefix: '/api/returns' });
  await app.ready();
  return app;
}
beforeEach(() => {
  mocks.findShop.mockResolvedValue({ id: 'shop', platform: 'OZON', status: 'ACTIVE', clientId: 'synthetic', apiKeyEncrypted: 'synthetic' });
  mocks.createJob.mockResolvedValue({ id: 'job' });
  mocks.updateJob.mockResolvedValue({});
  mocks.upsert.mockResolvedValue({});
});
afterEach(() => vi.resetAllMocks());

describe('Ozon returns current official schema consumers', () => {
  it('normalizes the official numeric money value to decimal text without losing zero or currency', () => {
    const input = row();
    const numericPrice = { ...input, product: { ...input.product, price: { price: 12.34, currency_code: 'CNY' } } };
    expect(mapOzonReturn(numericPrice as any)).toMatchObject({ amount: '12.34', currency: 'CNY' });
    expect(mapOzonReturn({ ...numericPrice, product: { ...numericPrice.product, price: { price: 0, currency_code: 'RUB' } } } as any))
      .toMatchObject({ amount: '0', currency: 'RUB' });
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0.001, 10_000_000_000])('rejects malformed or unrepresentable numeric return money: %s', price => {
    const input = row();
    expect(() => mapOzonReturn({ ...input, product: { ...input.product, price: { price, currency_code: 'CNY' } } } as any)).toThrow('金额');
  });

  it('uses one official date filter, advances from the final record ID, and maps nested values', async () => {
    mocks.getReturnsList
      .mockResolvedValueOnce({ returns: [row()], has_next: true })
      .mockResolvedValueOnce({ returns: [row('9007199254740994')], has_next: false });
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/api/returns/sync', payload: { shopId: 'shop', since: '2026-10-01T00:00:00Z' } });
    expect(response.json()).toMatchObject({ code: 1, data: { count: 2 } });
    expect(mocks.getReturnsList.mock.calls[0]?.[0]).toMatchObject({
      filter: { visual_status_change_moment: { time_from: '2026-10-01T00:00:00.000Z', time_to: expect.any(String) } },
      last_id: 0, limit: 500,
    });
    expect(mocks.getReturnsList.mock.calls[0]?.[0].filter).not.toHaveProperty('since');
    expect(mocks.getReturnsList.mock.calls[1]?.[0].last_id).toBe('9007199254740993');
    expect(mocks.upsert.mock.calls[0]?.[0]).toMatchObject({
      where: { shopId_platformReturnId: { shopId: 'shop', platformReturnId: '9007199254740993' } },
      create: {
        postingNumber: 'fixture-0001-1', status: 'ReturnedToOzon', amount: '0.00', currency: 'CNY', quantity: 2,
        returnedToWarehouse: true, acceptedAt: new Date('2026-10-22T10:01:00Z'), returnedAt: new Date('2026-10-20T11:00:00Z'),
      },
      update: { postingNumber: 'fixture-0001-1', status: 'ReturnedToOzon' },
    });
    await app.close();
  });

  it('does not mark a capped incomplete scan successful', async () => {
    let nextId = 0;
    mocks.getReturnsList.mockImplementation(async () => ({ returns: [row(++nextId)], has_next: true }));
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/api/returns/sync', payload: { shopId: 'shop' } });
    expect(response.json()).toMatchObject({ code: 0 });
    expect(mocks.updateJob).toHaveBeenLastCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }));
    expect(mocks.getReturnsList).toHaveBeenCalledTimes(20);
    await app.close();
  });

  it('fails a non-advancing page instead of repeatedly writing the same return', async () => {
    mocks.getReturnsList.mockResolvedValue({ returns: [row(12)], has_next: true });
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/api/returns/sync', payload: { shopId: 'shop' } });
    expect(response.json()).toMatchObject({ code: 0 });
    expect(mocks.upsert).toHaveBeenCalledTimes(1);
    expect(mocks.getReturnsList).toHaveBeenCalledTimes(2);
    await app.close();
  });

  it('rejects invalid dates before creating a job or calling Ozon', async () => {
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/api/returns/sync', payload: { shopId: 'shop', since: 'not-a-date' } });
    expect(response.statusCode).toBe(400);
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.getReturnsList).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects imprecise numeric IDs without writing corrupted identifiers', async () => {
    mocks.getReturnsList.mockResolvedValue({ returns: [row(Number.MAX_SAFE_INTEGER + 1)], has_next: false });
    const app = await appFor();
    const response = await app.inject({ method: 'POST', url: '/api/returns/sync', payload: { shopId: 'shop' } });
    expect(response.json()).toMatchObject({ code: 0 });
    expect(mocks.upsert).not.toHaveBeenCalled();
    await app.close();
  });
});

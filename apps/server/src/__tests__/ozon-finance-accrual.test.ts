import { describe, expect, it, vi } from 'vitest';
import {
  financeAccrualDates,
  readEffectiveFinanceTransactions,
  syncFinanceAccrualDay,
} from '../services/ozon-finance-accrual.js';

const date = '2026-10-22';
const money = (amount: string, currency = 'RUB') => ({ amount, currency });
const types = { accrual_types: [{ id: 7, name: 'MarketplaceServiceItemDelivToCustomer', description: 'Delivery' }] };
const posting = (id: number, amount = '90.00') => ({
  accrual_id: id, date, accrued_category: 'POSTING', unit_number: 'posting-1',
  total_amount: money(amount), posting: { products: [{ sku: 100,
    commission: { commission: money('-5.00'), sale_amount: money('100.00'), sale_commission: money('-8.00') },
    delivery: { services: [{ type_id: 7, accrued: money('-5.00') }], total_accrued: money('-5.00') },
  }] },
});

function fixture(pages: unknown[] = [{ accruals: [posting(12)], last_id: '' }]) {
  const rows: any[] = [];
  const upsert = vi.fn(async ({ create, update, where }: any) => {
    const existing = rows.find(row => row.operationId === where.shopId_operationId.operationId);
    if (existing) Object.assign(existing, update);
    else rows.push({ ...create });
  });
  const db: any = { ozonFinanceTransaction: { upsert, findMany: vi.fn(async () => rows) },
    $transaction: vi.fn(async (fn: any) => fn(db)) };
  const client = { getFinanceAccrualByDay: vi.fn(), getFinanceAccrualTypes: vi.fn().mockResolvedValue(types) };
  for (const page of pages) client.getFinanceAccrualByDay.mockResolvedValueOnce(page);
  const convert = vi.fn(async (amount: number, currency: string) => ({ amountCny: amount * (currency === 'USD' ? 7 : 0.1), rate: currency === 'USD' ? 7 : 0.1, source: 'fixture' }));
  return { rows, db, client, convert, upsert,
    run: () => syncFinanceAccrualDay({ db, client, shopId: 'shop-1', date, convert }) };
}

describe('official Ozon accrual day owner', () => {
  it('uses UTC inclusive days and rejects invalid/unbounded ranges', () => {
    expect(financeAccrualDates('2026-10-21T23:00:00-02:00', '2026-10-23T01:00:00Z')).toEqual(['2026-10-22', '2026-10-23']);
    expect(() => financeAccrualDates('2021-12-31', date)).toThrow();
    expect(() => financeAccrualDates('2026-02-30', date)).toThrow();
    expect(() => financeAccrualDates('2022-01-01', date)).toThrow();
  });

  it('keeps date fixed across cursor pages and writes one atomic complete snapshot', async () => {
    const f = fixture([{ accruals: [posting(12)], last_id: 'page-2' }, { accruals: [posting(13)], last_id: '' }]);
    await expect(f.run()).resolves.toMatchObject({ accrualsStored: 2 });
    expect(f.client.getFinanceAccrualByDay.mock.calls).toEqual([[{ date, last_id: '' }], [{ date, last_id: 'page-2' }]]);
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(f.rows).toHaveLength(3);
    expect(f.rows[0]).toMatchObject({ operationId: 'accrual:v1:12', amount: 90, postingNumber: 'posting-1', currency: 'RUB' });
    expect(f.rows[0].raw.accrual).toEqual(posting(12));
    expect(f.rows[2]).toMatchObject({ operationType: 'OZON_ACCRUAL_DAY_SNAPSHOT', amount: 0, raw: { kind: 'SNAPSHOT', date } });
    const effective = await readEffectiveFinanceTransactions(f.db, { shopId: 'shop-1' });
    expect(effective).toHaveLength(4);
    expect(effective.map(row => row.category)).toEqual(['commission', 'shipping_last', 'commission', 'shipping_last']);
    expect(effective.reduce((sum, row) => sum + Number(row.costAmountCny), 0)).toBe(2);
  });

  it('preserves currency and treats a fee credit as a cost reversal', async () => {
    const f = fixture([{ accruals: [{ accrual_id: 14, date, accrued_category: 'NON_ITEM', unit_number: 'service-1',
      total_amount: money('2.00', 'USD'), non_item_fee: { type_id: 7, accrued: money('2.00', 'USD') } }], last_id: '' }]);
    await f.run();
    expect(f.rows[0]).toMatchObject({ currency: 'USD', amount: 2, amountCny: 14 });
    const effective = await readEffectiveFinanceTransactions(f.db, { shopId: 'shop-1' });
    expect(effective[0]).toMatchObject({ amountCny: 14, costAmountCny: -14 });
  });

  it('uses the official delivery structure for an unfamiliar localized fee name, without guessing its numeric ID', async () => {
    const f = fixture();
    f.client.getFinanceAccrualTypes.mockResolvedValue({ accrual_types: [
      { id: 7, name: 'Доставка покупателю', description: 'Услуга доставки' },
    ] });
    await f.run();
    const effective = await readEffectiveFinanceTransactions(f.db, { shopId: 'shop-1' });
    expect(effective.map(row => row.category)).toEqual(['commission', 'shipping_last']);
  });

  it('does not repeat-count legacy rows, snapshot totals, stale generations or markers', async () => {
    const f = fixture();
    f.rows.push({ operationId: 'old-1', operationDate: new Date(date), category: 'commission', amountCny: -10 });
    await f.run();
    let effective = await readEffectiveFinanceTransactions(f.db, { shopId: 'shop-1' });
    expect(effective).toHaveLength(2);
    f.client.getFinanceAccrualByDay.mockResolvedValueOnce({ accruals: [posting(18)], last_id: '' });
    await f.run();
    effective = await readEffectiveFinanceTransactions(f.db, { shopId: 'shop-1' });
    expect(effective).toHaveLength(2);
    expect(f.rows.some(row => row.operationId === 'old-1')).toBe(true);
    expect(f.rows.some(row => row.operationId === 'accrual:v1:12')).toBe(true);
    expect(effective.every(row => row.operationId.startsWith('accrual:v1:18'))).toBe(true);
  });

  it('keeps old data for incomplete days and other days; complete empty day suppresses old overlap', async () => {
    const f = fixture([{ accruals: [], last_id: '' }]);
    const old = { operationId: 'old', operationDate: new Date(date), category: 'ad_click', amountCny: -10 };
    const previous = { ...old, operationId: 'previous', operationDate: new Date('2026-10-21') };
    f.rows.push(old, previous, { ...old, operationId: 'accrual:v1:partial', raw: { source: 'OZON_ACCRUAL_V1', kind: 'ACCRUAL', generation: 'incomplete' } });
    expect(await readEffectiveFinanceTransactions(f.db, { shopId: 'shop-1' })).toEqual([old, previous]);
    await f.run();
    expect(await readEffectiveFinanceTransactions(f.db, { shopId: 'shop-1' })).toEqual([previous]);
  });

  it.each([
    ['same cursor', [{ accruals: [posting(1)], last_id: 'same' }, { accruals: [posting(2)], last_id: 'same' }]],
    ['duplicate official ID', [{ accruals: [posting(1)], last_id: 'next' }, { accruals: [posting(1)], last_id: '' }]],
    ['wrong day', [{ accruals: [{ ...posting(1), date: '2026-10-21' }], last_id: '' }]],
    ['malformed amount', [{ accruals: [{ ...posting(1), total_amount: money('12oops') }], last_id: '' }]],
    ['missing cursor', [{ accruals: [posting(1)] }]],
    ['unsafe numeric ID', [{ accruals: [posting(Number.MAX_SAFE_INTEGER + 1)], last_id: '' }]],
  ])('fails %s before any database write', async (_name, pages) => {
    const f = fixture(pages);
    await expect(f.run()).rejects.toThrow();
    expect(f.upsert).not.toHaveBeenCalled();
    expect(f.db.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an unknown currency conversion instead of inventing a 1:1 rate', async () => {
    const f = fixture();
    f.convert.mockResolvedValue({ amountCny: 90, rate: 1, source: 'unknown_currency' });
    await expect(f.run()).rejects.toThrow(/currency|conversion/i);
    expect(f.upsert).not.toHaveBeenCalled();
  });

  it('accepts an empty terminal page without mistaking its echoed last_id for another data page', async () => {
    const f = fixture([{ accruals: [posting(12)], last_id: 'tail' }, { accruals: [], last_id: 'tail' }]);
    await expect(f.run()).resolves.toEqual({ accrualsStored: 1 });
    expect(f.client.getFinanceAccrualByDay).toHaveBeenCalledTimes(2);
  });

  it('expands item/container fees once and reuses a caller-fetched official type dictionary', async () => {
    const f = fixture([{ accruals: [
      { accrual_id: 30, date, accrued_category: 'ITEM', total_amount: money('-5'), item_fees: { fees: [{ sku: 1, fees: [{ type_id: 7, accrued: money('-5') }] }] } },
      { accrual_id: 31, date, accrued_category: 'CONTAINER_FEES', total_amount: money('-8'), container_fees: { fees: [{ type_id: 999, accrued: money('-8') }] } },
    ], last_id: '' }]);
    await syncFinanceAccrualDay({ db: f.db, client: f.client, shopId: 'shop-1', date, convert: f.convert, accrualTypes: types });
    expect(f.client.getFinanceAccrualTypes).not.toHaveBeenCalled();
    const effective = await readEffectiveFinanceTransactions(f.db, { shopId: 'shop-1' });
    expect(effective).toMatchObject([{ category: 'shipping_last', costAmountCny: 0.5 }, { category: 'service_other', costAmountCny: 0.8 }]);
  });

  it('reads target rows and same-shop markers in a single SQL snapshot and supports posting links', async () => {
    const f = fixture();
    await readEffectiveFinanceTransactions(f.db, { shopId: 'shop-1', orderId: '123', postingNumber: 'posting-1' });
    expect(f.db.ozonFinanceTransaction.findMany).toHaveBeenCalledTimes(1);
    expect(f.db.ozonFinanceTransaction.findMany.mock.calls[0][0]).toMatchObject({ where: { shopId: 'shop-1', OR: [
      { OR: [{ orderId: '123' }, { postingNumber: 'posting-1' }] },
      { operationType: 'OZON_ACCRUAL_DAY_SNAPSHOT' },
    ] } });
  });

  it('does not use an empty Prisma OR branch when reading the whole month', async () => {
    const f = fixture();
    const operationDate = { gte: new Date('2026-10-01'), lt: new Date('2026-11-01') };
    await readEffectiveFinanceTransactions(f.db, { shopId: 'shop-1', operationDate });
    expect(f.db.ozonFinanceTransaction.findMany.mock.calls[0][0]).toEqual({ where: { shopId: 'shop-1', operationDate } });
  });
});

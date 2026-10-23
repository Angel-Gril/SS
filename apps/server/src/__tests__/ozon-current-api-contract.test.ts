import { describe, expect, it, vi } from 'vitest';
import { OzonClient } from '../services/ozon-client.js';
import { normalizePromotionProducts, summarizePromotionDeactivateResult } from '../services/product-promotions.js';
import { iterateOzonPostingPages, calculateOzonOrderTotalRub } from '../services/ozon-order-sync-contract.js';

function clientWith(response: unknown) {
  const requestFetch = vi.fn(async () => new Response(JSON.stringify(response), {
    headers: { 'content-type': 'application/json' },
  }));
  return { client: new OzonClient({ clientId: 'fixture-client', apiKey: 'fixture-key', requestFetch }), requestFetch };
}

describe('official Ozon contracts verified 2026-10-23', () => {
  it('sends rFBS delivery changes at the official root with an explicit delivery-method ID', async () => {
    const { client, requestFetch } = clientWith({ operation_id: 'op-1' });
    await client.updateAggregatorDeliveryMethod({ warehouse_id: 10, delivery_method_id: 20,
      delivery_method: { name: 'Fixture', delivery_costs: { min_weight: 0, max_weight: 5, seller_payment: 100 } } } as any);
    const body = JSON.parse(((requestFetch.mock.calls as any[])[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ warehouse_id: 10, delivery_method_id: 20, name: 'Fixture', delivery_costs: { seller_payment: 100 } });
    expect(body).not.toHaveProperty('delivery_method');
  });
  it('follows V4 cursors to the last page and rejects a repeated cursor', async () => {
    const getPostingsList = vi.fn().mockResolvedValueOnce({ cursor: 'page2', has_next: true, postings: [{ posting_number: '1' }] })
      .mockResolvedValueOnce({ cursor: '', has_next: false, postings: [{ posting_number: '2' }] });
    const pages = []; for await (const page of iterateOzonPostingPages({ getPostingsList } as any, '2026-10-01', '2026-10-02')) pages.push(page);
    expect(pages.flat().map(p => p.posting_number)).toEqual(['1', '2']);
    expect(getPostingsList.mock.calls[1]?.[0].cursor).toBe('page2');
    getPostingsList.mockReset().mockResolvedValue({ cursor: 'stuck', has_next: true, postings: [{ posting_number: '1' }] });
    await expect((async () => { for await (const _page of iterateOzonPostingPages({ getPostingsList } as any, '2026-10-01', '2026-10-02')) { /* consume */ } })()).rejects.toThrow(/cursor/);
  });
  it('converts non-RUB amounts with known rates and refuses unknown currency rates', async () => {
    const products = [{ price: '12.50', currency_code: 'CNY', quantity: 2 }];
    expect(await calculateOzonOrderTotalRub(products, new Date(), new Map([['CNY', 1], ['RUB', 0.1]]))).toBe(250);
    await expect(calculateOzonOrderTotalRub([{ ...products[0]!, currency_code: 'ZZZ' }], new Date(), new Map(),
      async () => ({ rate: 1, source: 'unknown_currency' }))).rejects.toThrow(/unavailable/);
  });
  it('never treats an empty import readback or a failed item without errors as completed', async () => {
    const empty = clientWith({ result: { items: [], total: 0 } });
    await expect(empty.client.waitForImportTask(42, { maxAttempts: 1 })).rejects.toThrow(/超时|完成/);
    const failed = clientWith({ result: { items: [{ offer_id: 'fixture', status: 'failed', errors: [] }] } });
    await expect(failed.client.waitForImportTask(42, { maxAttempts: 1 })).rejects.toThrow(/失败/);
  });

  it('counts only explicit successful V2 removal IDs and parses promotion money objects', () => {
    expect(summarizePromotionDeactivateResult({ product_ids: ['1'] }, [1, 2])).toEqual({
      successCount: 1, failureCount: 1, failures: [{ productId: 2, message: expect.any(String) }],
    });
    expect(normalizePromotionProducts({ total: 2, last_id: 'next', products: [{ id: 1,
      price: { amount: '12.50', currency: 'CNY' }, action_price: { amount: '10.00', currency: 'CNY' } }] })).toMatchObject({
      total: 2, lastId: 'next', products: [{ price: '12.50', actionPrice: '10.00', currency: 'CNY' }],
    });
  });
  it('reads the V4 cursor response and preserves exact product amount and currency for order consumers', async () => {
    const { client, requestFetch } = clientWith({
      cursor: 'next-page', has_next: true,
      postings: [{ posting_number: 'test-1', order_id: 123, status: 'awaiting_deliver', substatus: 'posting_awaiting_registration',
        products: [{ sku: 234, offer_id: 'fixture-offer', name: 'Fixture', quantity: 2, price: { amount: '12.50', currency: 'CNY' } }] }],
    });
    const page = await client.getPostingsList({
      filter: { since: '2026-10-01T00:00:00Z', to: '2026-10-02T00:00:00Z' }, limit: 50,
    });
    expect(String((requestFetch.mock.calls as any[])[0]?.[0])).toBe('https://api-seller.ozon.ru/v4/posting/fbs/list');
    const body = JSON.parse(((requestFetch.mock.calls as any[])[0][1] as RequestInit).body as string);
    expect(body).toMatchObject({ cursor: '', sort_dir: 'DESC', limit: 50 });
    expect(body).not.toHaveProperty('offset');
    expect(page).toMatchObject({ cursor: 'next-page', has_next: true, postings: [{
      status: 'awaiting_deliver', substatus: 'posting_awaiting_registration',
      products: [{ price: '12.50', currency_code: 'CNY', quantity: 2 }],
    }] });
  });

  it('rejects invalid provider money instead of persisting NaN or silently substituting zero', async () => {
    const { client } = clientWith({ cursor: '', has_next: false, postings: [{
      posting_number: 'test-1', products: [{ quantity: 1, price: { amount: 'bad', currency: 'RUB' } }],
    }] });
    await expect(client.getPostingsList({})).rejects.toThrow(/amount|price|金额/i);
  });

  it('uses V2 promotion cursor pages and string IDs for removals', async () => {
    const { client, requestFetch } = clientWith({ products: [], last_id: '', total: 0 });
    await client.getPromotionProducts(10, { limit: 50 });
    expect(String((requestFetch.mock.calls as any[])[0]?.[0])).toContain('/v2/actions/products');
    const body = JSON.parse(((requestFetch.mock.calls as any[])[0][1] as RequestInit).body as string);
    expect(body).toEqual({ action_id: 10, last_id: '', limit: 50 });
    await client.deactivatePromotionProducts(10, [123]);
    expect(String((requestFetch.mock.calls as any[])[1]?.[0])).toContain('/v2/actions/products/deactivate');
    expect(JSON.parse(((requestFetch.mock.calls as any[])[1][1] as RequestInit).body as string).product_ids).toEqual(['123']);
  });

  it('reads top-level SKU product info consistently with the official response', async () => {
    const { client } = clientWith({ items: [{ id: 10, sku: 123, offer_id: 'fixture' }] });
    await expect(client.getProductInfoBySku([123])).resolves.toEqual([{ id: 10, sku: 123, offer_id: 'fixture' }]);
  });
});

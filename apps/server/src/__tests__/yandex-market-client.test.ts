import { describe, expect, it, vi } from 'vitest';
import { YandexMarketApiError, YandexMarketClient } from '../services/yandex-market-client.js';
vi.mock('../services/yandex-api-budget.js', () => ({ acquireYandexApiPermit: vi.fn().mockResolvedValue(undefined), recordYandexApiCooldown: vi.fn().mockResolvedValue(undefined) }));

const campaign = { id: 123, domain: 'market.example', business: { id: 77, name: '测试商家' }, placementType: 'FBS', apiAvailability: 'AVAILABLE' };

function clientFor(body: unknown, status = 200) {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));
  return { client: new YandexMarketClient({ apiKey: 'synthetic-yandex-key', fetchImpl }), fetchImpl };
}

describe('Yandex Market Partner API client', () => {
  it('reads the current delivery directory envelope and marking validation result', async () => {
    const c = clientFor({ result: { deliveryService: [{ id: 9, name: 'carrier' }] } });
    expect(await c.client.getDeliveryServices()).toEqual([{ id: 9, name: 'carrier' }]);
    const ids = clientFor({ status: 'OK', result: { items: [{ id: 1, cis: [{ value: 'code', status: 'OK' }] }] } });
    expect(await ids.client.getOrderIdentifiersStatus('123', '456')).toMatchObject({ items: [{ id: 1 }] });
  });
  it('rejects a request exceeding the official 512KB body limit before dispatch', async () => {
    const c = clientFor({ status: 'OK' });
    await expect(c.client.updateOfferMappings('77', [{ offer: { offerId: 'x', name: 'x', description: 'x'.repeat(524289), marketCategoryId: 10, pictures: [], vendor: 'x', barcodes: [] } }])).rejects.toMatchObject({ dispatched: false });
    expect(c.fetchImpl).not.toHaveBeenCalled();
  });
  it('reads a single current order by official orderIds without creation-date filters', async () => {
    const c = clientFor({ orders: [] }); await c.client.getOrder('77', '123', '456');
    const [url, init] = c.fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/v1/businesses/77/orders');
    expect(JSON.parse(String(init.body))).toEqual({ campaignIds: [123], orderIds: [456], fake: false });
    expect(url.searchParams.has('pageToken')).toBe(false);
  });
  it('queries shipment members in bounded exact batches and rejects incomplete pagination', async () => {
    const c = clientFor({ orders: [] }); expect(await c.client.getOrdersByIds('77', '123', ['456', '457'])).toEqual([]);
    expect(JSON.parse(c.fetchImpl.mock.calls[0]![1].body)).toEqual({ campaignIds: [123], orderIds: [456, 457], fake: false });
    await expect(c.client.getOrdersByIds('77', '123', ['456', '456'])).rejects.toThrow();
    const truncated = clientFor({ orders: [], paging: { nextPageToken: 'more' } }); await expect(truncated.client.getOrder('77', '123', '456')).rejects.toThrow('分页');
  });
  it('uses the official first-mile methods, date format, confirmation and fixed PDF path', async () => {
    const c = clientFor({ status: 'OK', result: { shipments: [] } });
    expect(await c.client.getShipments('123', { dateFrom: '2026-10-01', dateTo: '2026-10-10' })).toEqual({ shipments: [], nextPageToken: null });
    expect(c.fetchImpl.mock.calls[0]![0].pathname).toBe('/v2/campaigns/123/first-mile/shipments');
    expect(c.fetchImpl.mock.calls[0]![1].method).toBe('PUT');
    expect(JSON.parse(c.fetchImpl.mock.calls[0]![1].body)).toEqual({ dateFrom: '01-10-2026', dateTo: '10-10-2026', cancelledOrders: false });
    const ack = clientFor({ status: 'OK' }); expect(await ack.client.confirmShipment('123', '88')).toEqual({ status: 'OK' });
    expect(ack.fetchImpl.mock.calls[0]![0].pathname).toBe('/v2/campaigns/123/first-mile/shipments/88/confirm');
  });
  it('validates Excel shipment documents instead of misreading them as PDFs', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response(Buffer.from([0x50,0x4b,0x03,0x04,0,0]), { headers: { 'content-type': 'application/vnd.ms-excel' } }));
    const c = new YandexMarketClient({ apiKey: 'fixture', fetchImpl });
    expect((await c.getShipmentDocument('123', '88', 'DISCREPANCY_ACT')).byteLength).toBe(6);
    fetchImpl.mockResolvedValue(new Response('<html>error</html>', { headers: { 'content-type': 'application/vnd.ms-excel' } }));
    await expect(c.getShipmentDocument('123', '88', 'TRANSPORTATION_WAYBILL')).rejects.toThrow('Excel');
  });
  it('uses official status, complete box layout and operation endpoints with no write retries', async () => {
    const c = clientFor({ operation: { id: 'op-1', type: 'ORDER_STATUS_UPDATE' } });
    expect(await c.client.updateOrderStatus('123', '456', { status: 'CANCELLED', substatus: 'SHOP_FAILED' })).toEqual({ operation: { id: 'op-1', type: 'ORDER_STATUS_UPDATE' } });
    expect(c.fetchImpl.mock.calls[0]![1].method).toBe('PUT');
    const b = clientFor({ status: 'OK', result: { boxes: [{ boxId: 9, items: [{ id: 1, fullCount: 2 }] }] } });
    await b.client.setOrderBoxes('123', '456', [{ items: [{ id: 1, fullCount: 2 }] }]);
    expect(JSON.parse(b.fetchImpl.mock.calls[0]![1].body)).toEqual({ boxes: [{ items: [{ id: 1, fullCount: 2 }] }], allowRemove: false });
    const o = clientFor({ status: 'OK', result: { operations: [{ id: 'op-1', type: 'ORDER_STATUS_UPDATE', status: 'DONE' }] } });
    expect(await o.client.getOrderOperation('77', 'op-1')).toMatchObject({ status: 'DONE' });
    expect(String(o.fetchImpl.mock.calls[0]![0])).toContain('/v1/businesses/77/operations');
  });
  it('downloads bounded official PDF bytes and rejects HTML masquerading as a label', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('%PDF-1.4\nfixture', { headers: { 'content-type': 'application/pdf' } }));
    const c = new YandexMarketClient({ apiKey: 'fixture', fetchImpl });
    expect(Buffer.from(await c.getOrderLabel('123', '456', 'A7')).subarray(0, 5).toString()).toBe('%PDF-');
    fetchImpl.mockResolvedValue(new Response('<html>error</html>', { headers: { 'content-type': 'application/pdf' } }));
    await expect(c.getOrderLabel('123', '456', 'A7')).rejects.toThrow('PDF');
  });
  it('uses the new business order API with exact campaign and real-order filtering', async () => {
    const { client, fetchImpl } = clientFor({ orders: [], paging: { nextPageToken: 'n' } });
    expect(await client.getBusinessOrders('77', '123', { from: '2026-10-01', to: '2026-10-28' }, 'p')).toEqual({ orders: [], nextPageToken: 'n' });
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/v1/businesses/77/orders'); expect(url.searchParams.get('limit')).toBe('50');
    expect(JSON.parse(String(init.body))).toEqual({ campaignIds: [123], fake: false, dates: { creationDateFrom: '2026-10-01', creationDateTo: '2026-10-28' } });
  });
  it('rejects order windows exceeding 30 days before credential use', async () => {
    const { client, fetchImpl } = clientFor({ orders: [] });
    await expect(client.getBusinessOrders('77', '123', { from: '2026-01-01', to: '2026-10-28' })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('reads shop offers and business settings without changing platform data', async () => {
    const c = clientFor({ status: 'OK', result: { offers: [{ offerId: '000-A', status: 'PUBLISHED', basicPrice: { value: 25, currencyId: 'RUR' } }], paging: { nextPageToken: 'n' } } });
    expect(await c.client.getCampaignOffers('123', { limit: 5 })).toMatchObject({ offers: [{ offerId: '000-A' }], nextPageToken: 'n' });
    expect(String(c.fetchImpl.mock.calls[0]![0])).toContain('/v2/campaigns/123/offers?limit=5');
    const settings = clientFor({ status: 'OK', result: { settings: { warehouseModel: 'WAREHOUSE', onlyDefaultPrice: true, currency: 'RUR' } } });
    expect(await settings.client.getBusinessSettings('77')).toMatchObject({ warehouseModel: 'WAREHOUSE', onlyDefaultPrice: true });
  });

  it('reads exact stocks using the official warehouse model and preserves stock types', async () => {
    const c = clientFor({ status: 'OK', result: { partnerWarehouseId: 9, offers: [{ offerId: '000-A', stocks: [{ type: 'AVAILABLE', count: 3 }, { type: 'FREEZE', count: 2 }] }] } });
    const result = await c.client.getStocks('77', '123', 'WAREHOUSE', ['000-A'], 9);
    expect(result[0]).toMatchObject({ warehouseId: 9, offers: [{ offerId: '000-A', stocks: [{ type: 'AVAILABLE', count: 3 }, { type: 'FREEZE', count: 2 }] }] });
    expect(String(c.fetchImpl.mock.calls[0]![0])).toBe('https://api.partner.market.yandex.ru/v3/businesses/77/offers/stocks');
    expect(JSON.parse(c.fetchImpl.mock.calls[0]![1].body)).toEqual({ partnerWarehouseId: 9, offerIds: ['000-A'] });
  });

  it('uses distinct official price and inventory writers without converting leading-zero SKU IDs', async () => {
    const c = clientFor({ status: 'OK' });
    await c.client.updateProductPrices('77', '123', 'CAMPAIGN', [{ offerId: '000-A', price: { value: 12, currencyId: 'RUR' } }]);
    expect(String(c.fetchImpl.mock.calls[0]![0])).toContain('/v2/campaigns/123/offer-prices/updates');
    await c.client.updateProductStocks('77', '123', 'WAREHOUSE', [{ offerId: '000-A', count: 7 }], 9);
    expect(JSON.parse(c.fetchImpl.mock.calls[1]![1].body)).toEqual({ skuItems: [{ sku: '000-A', partnerWarehouseId: 9, count: 7 }] });
    await c.client.updateProductStocks('77', '123', 'CAMPAIGN', [{ offerId: '000-A', count: 7 }], 9);
    expect(c.fetchImpl.mock.calls[2]![1].method).toBe('PUT');
    expect(JSON.parse(c.fetchImpl.mock.calls[2]![1].body)).toEqual({ skus: [{ sku: '000-A', items: [{ count: 7 }] }] });
  });
  it('accepts a large official category dictionary within the bounded response byte limit', async () => {
    const values = Array.from({ length: 20001 }, (_, index) => ({ id: index + 1, value: `value-${index}` }));
    const { client } = clientFor({ status: 'OK', result: { categoryId: 10, parameters: [{ id: 1, type: 'ENUM', required: false, multivalue: false, allowCustomValues: false, values }] } });
    expect((await client.getCategoryParameters(10, '77')).parameters[0]!.values).toHaveLength(20001);
  });
  it('reads nested catalogue pages with limit/pageToken in the query, not the request body', async () => {
    const { client, fetchImpl } = clientFor({ status: 'OK', result: { offerMappings: [{ offer: { offerId: 'erp-1', name: 'Товар' } }], paging: { nextPageToken: 'page-2' } } });
    await expect(client.getOfferMappings('77', { limit: 5, pageToken: 'page-1' })).resolves.toMatchObject({ offerMappings: [{ offer: { offerId: 'erp-1' } }], nextPageToken: 'page-2' });
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get('limit')).toBe('5'); expect(url.searchParams.get('pageToken')).toBe('page-1');
    expect(JSON.parse(String(init.body))).toEqual({});
    expect(init).toMatchObject({ method: 'POST', credentials: 'omit', redirect: 'error' });
  });

  it('reads exact offer IDs without combining the pagination parameters prohibited by Yandex', async () => {
    const { client, fetchImpl } = clientFor({ status: 'OK', result: { offerMappings: [] } });
    await client.getOfferMappings('77', { offerIds: ['erp-1'] });
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.has('limit')).toBe(false); expect(url.searchParams.has('pageToken')).toBe(false);
    expect(JSON.parse(String(init.body))).toEqual({ offerIds: ['erp-1'] });
  });

  it('rejects ERROR envelopes and missing result arrays even when HTTP status is 200', async () => {
    await expect(clientFor({ status: 'ERROR', errors: [{ message: 'synthetic-yandex-key' }] }).client.getOfferMappings('77')).rejects.toThrow('Yandex');
    await expect(clientFor({ status: 'OK', result: {} }).client.getOfferMappings('77')).rejects.toThrow();
  });

  it('rejects an unapproved port or embedded credential in the official origin', () => {
    for (const baseUrl of ['https://api.partner.market.yandex.ru:8443', 'https://user:pass@api.partner.market.yandex.ru', 'https://api.partner.market.yandex.ru/other']) {
      expect(() => new YandexMarketClient({ apiKey: 'fixture', baseUrl })).toThrow();
    }
  });

  it('reads the category contract with its business binding and reads card status separately', async () => {
    const { client, fetchImpl } = clientFor({ status: 'OK', result: { categoryId: 10, parameters: [] } });
    await expect(client.getCategoryParameters(10, '77')).resolves.toEqual({ categoryId: 10, parameters: [] });
    expect(String(fetchImpl.mock.calls[0]![0])).toBe('https://api.partner.market.yandex.ru/v2/category/10/parameters?businessId=77');
    const cards = clientFor({ status: 'OK', result: { offerCards: [{ offerId: 'erp-1', cardStatus: 'HAS_CARD_CAN_NOT_UPDATE' }] } });
    await expect(cards.client.getOfferCards('77')).resolves.toMatchObject({ offerCards: [{ offerId: 'erp-1', cardStatus: 'HAS_CARD_CAN_NOT_UPDATE' }], nextPageToken: null });
  });
  it('uses Api-Key and the v2 campaigns contract for read-only connection checks', async () => {
    const { client, fetchImpl } = clientFor({ campaigns: [campaign], paging: { nextPageToken: 'next' } });
    await expect(client.test('123')).resolves.toMatchObject({ id: '123', placementType: 'FBS', apiAvailability: 'AVAILABLE' });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('https://api.partner.market.yandex.ru/v2/campaigns?limit=100');
    expect(init).toMatchObject({ method: 'GET', headers: { 'Api-Key': 'synthetic-yandex-key' } });
  });

  it('builds the official offer-mappings update request without retrying or leaking credentials', async () => {
    const { client, fetchImpl } = clientFor({ status: 'OK', results: [{ offerId: 'ss-ozon-1' }] });
    await client.updateOfferMappings('77', [{ offer: { offerId: 'ss-ozon-1', name: 'Товар', description: 'Описание', marketCategoryId: 10, pictures: ['https://cdn.example/a.jpg'], vendor: 'SS', barcodes: ['4601234567890'] } }]);
    const [url, init] = fetchImpl.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('https://api.partner.market.yandex.ru/v2/businesses/77/offer-mappings/update?language=RU');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Api-Key': 'synthetic-yandex-key', 'Content-Type': 'application/json' } });
    expect(String(init.body)).toContain('ss-ozon-1'); expect(String(init.body)).not.toContain('synthetic-yandex-key');
  });

  it('unwraps the campaign detail response', async () => {
    const { client } = clientFor({ campaign });
    await expect(client.getCampaign('123')).resolves.toMatchObject({ id: '123', business: { id: '77' } });
  });

  it('rejects a configured campaign that is not returned by the token', async () => {
    const { client } = clientFor({ campaigns: [] });
    await expect(client.test('123')).rejects.toMatchObject({ status: 404 });
  });

  it('surfaces API availability as a controlled 409 without leaking raw bodies', async () => {
    const { client } = clientFor({ campaigns: [{ ...campaign, apiAvailability: 'MANUALLY_DISABLED' }] });
    await expect(client.test('123')).rejects.toThrow('MANUALLY_DISABLED');
  });

  it('sanitizes provider errors and rejects untrusted API origins', async () => {
    const { client } = clientFor({ errors: [{ message: 'secret-token-from-provider' }] }, 401);
    await expect(client.getCampaigns()).rejects.toMatchObject({ status: 401 });
    await expect(client.getCampaigns()).rejects.not.toThrow('secret-token-from-provider');
    expect(() => new YandexMarketClient({ apiKey: 'fixture', baseUrl: 'https://evil.example' })).toThrow('地址不受信任');
  });

  it('normalizes timeout and transport failures to a bounded API error', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network secret')); const client = new YandexMarketClient({ apiKey: 'fixture', fetchImpl });
    await expect(client.getCampaigns()).rejects.toBeInstanceOf(YandexMarketApiError);
    await expect(client.getCampaigns()).rejects.not.toThrow('network secret');
  });
});

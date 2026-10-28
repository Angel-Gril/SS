import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeYandexProductOperation, prepareYandexProductPricePreview } from '../services/yandex-product-operations.js';
import { YandexMarketApiError } from '../services/yandex-market-client.js';

const m = vi.hoisted(() => ({ product: vi.fn(), find: vi.fn(), unresolved: vi.fn(), create: vi.fn(), update: vi.fn(), lock: vi.fn(), tx: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: { product: { findMany: m.product }, yandexOfferPublishOperation: { findUnique: m.find, update: m.update }, $transaction: m.tx } }));

const shop = { id: 'shop', userId: 'owner', status: 'ACTIVE', clientId: '123', config: { yandexMarket: { campaignId: '123', businessId: '77' } } };
function fixture(action = 'PRICE') {
  const client = { getCampaign: vi.fn().mockResolvedValue({ id: '123', business: { id: '77' }, apiAvailability: 'AVAILABLE' }), getBusinessSettings: vi.fn().mockResolvedValue({ warehouseModel: 'WAREHOUSE', onlyDefaultPrice: false, currency: 'RUR' }), getShopWarehouses: vi.fn().mockResolvedValue([{ id: 9, campaignId: 123 }]), getCampaignOffers: vi.fn().mockResolvedValue({ offers: [{ offerId: '000-A' }], nextPageToken: null }), updateProductPrices: vi.fn().mockResolvedValue({ status: 'OK' }), updateProductStocks: vi.fn().mockResolvedValue({ status: 'OK' }), setProductHidden: vi.fn().mockResolvedValue({ status: 'OK' }) };
  return { shop, client: { ...client, getStocks: vi.fn() }, ownerUserId: 'owner', actorUserId: 'actor', body: { action, productIds: ['p1'], confirm: true, idempotencyKey: 'synthetic-idempotency-1234', price: '15.50', stock: 7, warehouseId: 9, allowBusinessPrice: false } };
}
describe('Yandex basic product writes', () => {
  beforeEach(() => {
    vi.clearAllMocks(); m.product.mockResolvedValue([{ id: 'p1', offerId: '000-A', currency: 'RUB' }]); m.find.mockResolvedValue(null); m.unresolved.mockResolvedValue(null);
    m.create.mockImplementation(async ({ data }) => ({ ...data, id: 'op1' })); m.update.mockImplementation(async ({ data }) => ({ id: 'op1', ...data }));
    m.tx.mockImplementation(async fn => fn({ $executeRaw: m.lock, yandexOfferPublishOperation: { findUnique: m.find, findFirst: m.unresolved, create: m.create } }));
  });
  afterEach(() => vi.restoreAllMocks());
  it('updates the exact campaign SKU and records acceptance without pretending local readback is current', async () => {
    const f = fixture(); const r = await executeYandexProductOperation(f);
    expect(r.state).toBe('SUCCEEDED'); expect(f.client.updateProductPrices).toHaveBeenCalledWith('77', '123', 'CAMPAIGN', [{ offerId: '000-A', price: { value: 15.5, currencyId: 'RUR' } }]);
    expect(m.product).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['p1'] }, shopId: 'shop', shop: { userId: 'owner', platform: 'YANDEX', status: 'ACTIVE' } } }));
    expect(m.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorUserId: 'actor', sourceShopId: 'shop', state: 'SUBMITTING' }) }));
  });
  it('requires explicit consent when a price is shared by the whole business', async () => {
    const f = fixture(); f.client.getBusinessSettings.mockResolvedValue({ warehouseModel: 'WAREHOUSE', onlyDefaultPrice: true, currency: 'RUR' });
    await expect(executeYandexProductOperation(f)).rejects.toThrow('所有店铺'); expect(f.client.updateProductPrices).not.toHaveBeenCalled();
    f.body.allowBusinessPrice = true; await executeYandexProductOperation(f);
    expect(f.client.updateProductPrices.mock.calls[0]![2]).toBe('BUSINESS');
  });
  it('rejects a foreign product or warehouse before any writer or journal reservation', async () => {
    const f = fixture('STOCK'); f.body.warehouseId = 99;
    await expect(executeYandexProductOperation(f)).rejects.toThrow('仓库'); expect(m.create).not.toHaveBeenCalled();
    m.product.mockResolvedValue([]); await expect(executeYandexProductOperation(f)).rejects.toThrow('商品'); expect(f.client.updateProductStocks).not.toHaveBeenCalled();
  });
  it('requires explicit consent for a stock write that affects a shared warehouse group', async () => {
    const f = fixture('STOCK'); f.client.getShopWarehouses.mockResolvedValue([{ id: 9, campaignId: 123, groupInfo: { id: 8, name: 'shared' } }]);
    await expect(executeYandexProductOperation(f)).rejects.toThrow('共享仓库组'); expect(f.client.updateProductStocks).not.toHaveBeenCalled();
  });
  it('keeps a timeout UNKNOWN and replays exactly once even after source products change', async () => {
    const f = fixture(); f.client.updateProductPrices.mockRejectedValue(new YandexMarketApiError(504, 'timeout'));
    const r = await executeYandexProductOperation(f); expect(r.state).toBe('UNKNOWN');
    const stored = { ...m.create.mock.calls[0]![0].data, state: 'UNKNOWN', id: 'op1' }; m.find.mockResolvedValue(stored); m.product.mockResolvedValue([]);
    expect(await executeYandexProductOperation(f)).toMatchObject({ state: 'UNKNOWN', replayed: true });
    expect(f.client.updateProductPrices).toHaveBeenCalledTimes(1);
  });
  it('closes UNKNOWN only after fresh platform values match the stored command, without sending again', async () => {
    const f = fixture(); f.client.updateProductPrices.mockRejectedValue(new YandexMarketApiError(504, 'timeout'));
    await executeYandexProductOperation(f);
    const stored = { ...m.create.mock.calls[0]![0].data, state: 'UNKNOWN', id: 'op1' }; m.find.mockResolvedValue(stored);
    f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: { value: 15.5, currencyId: 'RUR' } }] });
    expect(await executeYandexProductOperation(f)).toMatchObject({ state: 'SUCCEEDED', replayed: true, reconciled: true });
    expect(f.client.updateProductPrices).toHaveBeenCalledTimes(1);
  });
  it('blocks a new key while a previous operation on the same product is unresolved', async () => {
    const f = fixture(); m.unresolved.mockResolvedValue({ id: 'other-op' });
    await expect(executeYandexProductOperation(f)).rejects.toThrow('未确认'); expect(f.client.updateProductPrices).not.toHaveBeenCalled();
  });
  it('never claims not-dispatched when the accepted response cannot be persisted', async () => {
    const f = fixture(); m.update.mockRejectedValue(new Error('database temporarily unavailable'));
    expect(await executeYandexProductOperation(f)).toMatchObject({ state: 'UNKNOWN', replayed: false });
    expect(f.client.updateProductPrices).toHaveBeenCalledTimes(1);
  });
  it.each([['multiply', '1.5', 18], ['discount', '25', 9], ['increase', '10', 13.2], ['add', '-2.25', 9.75]])('previews %s from fresh platform prices and writes the confirmed per-offer target', async (mode, value, expected) => {
    const f = fixture(); f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: { value: 12, currencyId: 'RUR' } }] });
    const priceChange = { mode, value };
    const preview = await prepareYandexProductPricePreview({ ...f, body: { productIds: ['p1'], priceChange } });
    expect(preview.targets).toEqual([{ productId: 'p1', offerId: '000-A', previousPrice: 12, price: { value: expected, currencyId: 'RUR' } }]);
    await executeYandexProductOperation({ ...f, body: { action: 'PRICE', productIds: ['p1'], confirm: true, idempotencyKey: 'synthetic-batch-price-key', priceChange, pricePreviewHash: preview.previewHash } });
    expect(f.client.updateProductPrices).toHaveBeenCalledWith('77', '123', 'CAMPAIGN', [{ offerId: '000-A', price: { value: expected, currencyId: 'RUR' } }]);
    expect(m.create.mock.calls[0]![0].data.requestPayload.priceTargets).toEqual(preview.targets);
  });
  it('rejects a changed platform price rather than silently recalculating after preview', async () => {
    const f = fixture(); f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: { value: 12, currencyId: 'RUR' } }] });
    const priceChange = { mode: 'multiply', value: '2' };
    const preview = await prepareYandexProductPricePreview({ ...f, body: { productIds: ['p1'], priceChange } });
    f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: { value: 13, currencyId: 'RUR' } }] });
    await expect(executeYandexProductOperation({ ...f, body: { action: 'PRICE', productIds: ['p1'], confirm: true, idempotencyKey: 'synthetic-stale-price-key', priceChange, pricePreviewHash: preview.previewHash } })).rejects.toThrow('预览');
    expect(m.create).not.toHaveBeenCalled(); expect(f.client.updateProductPrices).not.toHaveBeenCalled();
  });
  it('requires a preview and rejects ambiguous mixed legacy/relative price input', async () => {
    const f = fixture();
    for (const body of [
      { ...f.body, price: undefined, priceChange: { mode: 'multiply', value: '2' } },
      { ...f.body, priceChange: { mode: 'multiply', value: '2' }, pricePreviewHash: 'a'.repeat(64) },
    ]) await expect(executeYandexProductOperation({ ...f, body })).rejects.toThrow();
    expect(f.client.updateProductPrices).not.toHaveBeenCalled();
  });
  it('validates every target, currency, unknown base, positive result and strike price before reserving', async () => {
    const f = fixture();
    for (const [base, change, oldPrice] of [
      [undefined, { mode: 'multiply', value: '2' }, undefined],
      [{ value: 12, currencyId: 'USD' }, { mode: 'multiply', value: '2' }, undefined],
      [{ value: 12, currencyId: 'RUR' }, { mode: 'add', value: '-12' }, undefined],
      [{ value: 12, currencyId: 'RUR' }, { mode: 'discount', value: '100' }, undefined],
      [{ value: 12, currencyId: 'RUR' }, { mode: 'multiply', value: '2' }, '20.00'],
      [{ value: 90000000, currencyId: 'RUR' }, { mode: 'multiply', value: '2' }, undefined],
    ] as const) {
      f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: base }] });
      await expect(prepareYandexProductPricePreview({ ...f, body: { productIds: ['p1'], priceChange: change, ...(oldPrice ? { oldPrice } : {}) } })).rejects.toThrow();
    }
    expect(m.create).not.toHaveBeenCalled(); expect(f.client.updateProductPrices).not.toHaveBeenCalled();
  });
  it('reconciles a relative command from journal targets, never multiplying the already updated price again', async () => {
    const f = fixture(); f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: { value: 12, currencyId: 'RUR' } }] });
    const priceChange = { mode: 'multiply', value: '2' };
    const preview = await prepareYandexProductPricePreview({ ...f, body: { productIds: ['p1'], priceChange } });
    f.client.updateProductPrices.mockRejectedValue(new YandexMarketApiError(504, 'timeout'));
    const body = { action: 'PRICE', productIds: ['p1'], confirm: true, idempotencyKey: 'synthetic-relative-replay', priceChange, pricePreviewHash: preview.previewHash };
    expect(await executeYandexProductOperation({ ...f, body })).toMatchObject({ state: 'UNKNOWN' });
    m.find.mockResolvedValue({ ...m.create.mock.calls[0]![0].data, id: 'op1', state: 'SUBMITTING' });
    f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: { value: 24, currencyId: 'RUR' } }] });
    expect(await executeYandexProductOperation({ ...f, body })).toMatchObject({ state: 'SUCCEEDED', replayed: true, reconciled: true });
    expect(f.client.updateProductPrices).toHaveBeenCalledTimes(1);
  });
  it('never unlocks a relative operation when target reconciliation persistence fails', async () => {
    const f = fixture(); f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: { value: 12, currencyId: 'RUR' } }] });
    const priceChange = { mode: 'multiply', value: '2' };
    const preview = await prepareYandexProductPricePreview({ ...f, body: { productIds: ['p1'], priceChange } });
    f.client.updateProductPrices.mockRejectedValue(new YandexMarketApiError(504, 'timeout'));
    const body = { action: 'PRICE', productIds: ['p1'], confirm: true, idempotencyKey: 'synthetic-relative-db-failure', priceChange, pricePreviewHash: preview.previewHash };
    await executeYandexProductOperation({ ...f, body }); m.find.mockResolvedValue({ ...m.create.mock.calls[0]![0].data, id: 'op1', state: 'UNKNOWN' });
    f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: { value: 24, currencyId: 'RUR' } }] }); m.update.mockRejectedValue(new Error('synthetic persistence failure'));
    expect(await executeYandexProductOperation({ ...f, body })).toMatchObject({ state: 'UNKNOWN', replayed: true });
  });
  it('uses the business default when no campaign override exists, just as the product list does', async () => {
    const f = fixture(); f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', basicPrice: { value: 10, currencyId: 'RUR' } }] });
    const r = await prepareYandexProductPricePreview({ ...f, body: { productIds: ['p1'], priceChange: { mode: 'multiply', value: '2' } } });
    expect(r.targets[0]).toMatchObject({ previousPrice: 10, price: { value: 20 } });
  });
  it('rechecks relative snapshot after obtaining the business lock so a finished concurrent writer cannot invalidate consent', async () => {
    const f = fixture(); f.client.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: { value: 12, currencyId: 'RUR' } }] });
    const priceChange = { mode: 'multiply', value: '2' };
    const preview = await prepareYandexProductPricePreview({ ...f, body: { productIds: ['p1'], priceChange } });
    f.client.getCampaignOffers.mockResolvedValueOnce({ offers: [{ offerId: '000-A', campaignPrice: { value: 12, currencyId: 'RUR' } }] }).mockResolvedValue({ offers: [{ offerId: '000-A', campaignPrice: { value: 13, currencyId: 'RUR' } }] });
    await expect(executeYandexProductOperation({ ...f, body: { action: 'PRICE', productIds: ['p1'], confirm: true, idempotencyKey: 'synthetic-lock-price-stale', priceChange, pricePreviewHash: preview.previewHash } })).rejects.toThrow('预览');
    expect(m.create).not.toHaveBeenCalled(); expect(f.client.updateProductPrices).not.toHaveBeenCalled();
  });
  it.each([408, 409, 420, 429])('keeps HTTP %s outcome unresolved instead of permitting a duplicate key', async status => {
    const f = fixture(); f.client.updateProductPrices.mockRejectedValue(new YandexMarketApiError(status, 'synthetic upstream failure'));
    expect(await executeYandexProductOperation(f)).toMatchObject({ state: 'UNKNOWN' });
  });
});

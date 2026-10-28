import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeYandexProductOperation } from '../services/yandex-product-operations.js';
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
    expect(m.product).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ['p1'] }, shopId: 'shop' } }));
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
});

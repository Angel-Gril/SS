import { describe, it, expect, vi } from 'vitest';
import { collectYandexProducts, projectYandexProduct } from '../services/yandex-product-sync.js';

function fixture() {
  return {
    getBusinessSettings: vi.fn().mockResolvedValue({ warehouseModel: 'WAREHOUSE', currency: 'RUR', onlyDefaultPrice: true }),
    getShopWarehouses: vi.fn().mockResolvedValue([{ id: 9, name: 'warehouse', campaignId: 123 }]),
    getCampaignOffers: vi.fn().mockResolvedValue({ offers: [{ offerId: '000-A', status: 'PUBLISHED', basicPrice: { value: 25, currencyId: 'RUR' } }], nextPageToken: null }),
    getOfferMappings: vi.fn().mockResolvedValue({ offerMappings: [{ offer: { offerId: '000-A', name: 'Товар', pictures: ['https://cdn.example/a.jpg'], description: 'Описание', marketCategoryId: 10 } }], nextPageToken: null }),
    getStocks: vi.fn().mockResolvedValue([{ warehouseId: 9, offers: [{ offerId: '000-A', stocks: [{ type: 'AVAILABLE', count: 3 }, { type: 'FIT', count: 5 }, { type: 'FREEZE', count: 2 }] }] }]),
  };
}

describe('Yandex campaign product snapshot', () => {
  it('projects Yandex state and timestamp without borrowing Ozon price or buyer-cost fields', () => {
    const row = projectYandexProduct({ sku: '000-A', status: 'NO_STOCKS', price: { toString: () => '20' }, stock: 0, variants: { yandexMarket: { stockKnown: false, syncedAt: '2026-10-28T00:00:00Z' } } });
    expect(row).toMatchObject({ sku: '000-A', price: '20', platformStockKnown: false, platformStatusName: '无可售库存', platformSyncedAt: '2026-10-28T00:00:00Z' });
    expect(row).not.toHaveProperty('variants'); expect(row).not.toHaveProperty('ozonStatusName');
  });
  it('keeps the exact SKU, campaign price and AVAILABLE stock separate from reservations', async () => {
    const c = fixture(); const result = await collectYandexProducts(c as any, '77', '123');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ platformProductId: '000-A', sku: '000-A', title: 'Товар', price: 25, currency: 'RUB', stock: 3, syncStatus: 'SYNCED', variants: { yandexMarket: { stockKnown: true } } });
    expect(result[0]).not.toHaveProperty('lastOzonSyncAt');
    expect(c.getOfferMappings).toHaveBeenCalledWith('77', { offerIds: ['000-A'] });
  });
  it('keeps a missing stock unknown and never counts FIT plus FREEZE as available', async () => {
    const c = fixture(); c.getStocks.mockResolvedValue([{ warehouseId: 9, offers: [] }]);
    expect((await collectYandexProducts(c as any, '77', '123'))[0]).toMatchObject({ stock: undefined, variants: { yandexMarket: { stockKnown: false } } });
  });
  it('recognizes an explicit zero FIT as zero stock without inventing a positive available count', async () => {
    const c = fixture(); c.getStocks.mockResolvedValue([{ warehouseId: 9, offers: [{ offerId: '000-A', stocks: [{ type: 'FIT', count: 0 }] }] }]);
    expect((await collectYandexProducts(c as any, '77', '123'))[0]).toMatchObject({ stock: 0, variants: { yandexMarket: { stockKnown: true } } });
  });
  it('fails a stuck page or stock read instead of producing a successful partial sync', async () => {
    const c = fixture(); c.getCampaignOffers.mockResolvedValue({ offers: [{ offerId: '000-A', status: 'PUBLISHED' }], nextPageToken: 'same' });
    await expect(collectYandexProducts(c as any, '77', '123')).rejects.toThrow();
    const d = fixture(); d.getStocks.mockRejectedValue(new Error('stock unavailable'));
    await expect(collectYandexProducts(d as any, '77', '123')).rejects.toThrow('stock unavailable');
  });
  it('does not import business offers which are not listed in this campaign', async () => {
    const c = fixture(); c.getOfferMappings.mockResolvedValue({ offerMappings: [{ offer: { offerId: 'foreign', name: 'Другой товар' } }], nextPageToken: null });
    await expect(collectYandexProducts(c as any, '77', '123')).rejects.toThrow();
  });
});

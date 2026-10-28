import { describe, expect, it } from 'vitest';
import { buildYandexOfferDraft } from '../services/yandex-market-offer-draft.js';

describe('Yandex offer draft mapping', () => {
  it('uses the Ozon brand attribute ID even when the API does not include a display name', () => {
    const draft = buildYandexOfferDraft({ id: 'source', attributes: [{ id: 85, values: [{ dictionary_value_id: 4321, value: 'SS' }] }] });
    expect(draft.offer.vendor).toBe('SS');
  });
  it('consumes Ozon native attribute arrays and stored source barcodes without inventing facts', () => {
    const product = { id: 'source', title: 'Товар', images: ['https://cdn.example/a.jpg'], attributes: [{ id: 4191, values: [{ value: 'Описание товара' }] }, { id: 85, name: 'Бренд', values: [{ value: 'SS' }] }], variants: { ozonBarcodes: ['4601234567890'] } };
    const draft = buildYandexOfferDraft(product, { marketCategoryId: 123 });
    expect(draft).toMatchObject({ ready: true, offer: { description: 'Описание товара', vendor: 'SS', barcodes: ['4601234567890'] } });
  });
  it('never treats an Ozon category or numeric Ozon SKU as a Yandex category or barcode', () => {
    const draft = buildYandexOfferDraft({ id: 'source', title: 'Товар', description: 'Описание', categoryId: '876543', sku: '1234567890123', images: ['https://cdn.example/a.jpg'], attributes: { vendor: 'SS' } });
    expect(draft.offer.marketCategoryId).toBeNull();
    expect(draft.offer.barcodes).toEqual([]);
    expect(draft.missingFields).toEqual(expect.arrayContaining(['marketCategoryId', 'barcodes']));
    expect(draft.ready).toBe(false);
  });

  it('uses the explicitly selected Yandex category and actual scalar source barcode', () => {
    const draft = buildYandexOfferDraft({ id: 'source', title: 'Товар', description: 'Описание', categoryId: '876543', images: ['https://cdn.example/a.jpg'], attributes: { vendor: 'SS', barcode: '4601234567890' } }, { marketCategoryId: 123 });
    expect(draft.offer.marketCategoryId).toBe(123);
    expect(draft.offer.barcodes).toEqual(['4601234567890']);
    expect(draft.ready).toBe(true);
  });
  it('maps ERP/Ozon product fields to a reviewable draft without platform writes', () => {
    const draft = buildYandexOfferDraft({ id: 'product-1', title: 'Кружка', description: 'Керамическая кружка', categoryId: '987', price: '199.9', currency: 'RUB', stock: 3, images: ['https://cdn.example/image.jpg'], attributes: { brand: 'SS', barcodes: ['4601234567890'] } }, { marketCategoryId: 123 });
    expect(draft).toMatchObject({ ready: true, offer: { offerId: 'ss-ozon-product-1', marketCategoryId: 123, vendor: 'SS', barcodes: ['4601234567890'], price: '199.90', stock: 3 } });
  });

  it('blocks incomplete products and never invents required values', () => {
    const draft = buildYandexOfferDraft({ id: 'product-2', title: 'Cup', images: ['not-a-url'] });
    expect(draft.ready).toBe(false);
    expect(draft.missingFields).toEqual(expect.arrayContaining(['description', 'marketCategoryId', 'pictures', 'vendor', 'barcodes']));
    expect(draft.offer.vendor).toBeNull(); expect(draft.offer.marketCategoryId).toBeNull(); expect(draft.offer.pictures).toEqual([]);
  });

  it('marks source CDN images for controlled ERP transfer instead of exposing trust', () => {
    const draft = buildYandexOfferDraft({ id: 'product-3', title: 'Товар', description: 'Описание', categoryId: '9', images: ['https://img.alicdn.com/a.jpg'], attributes: { vendor: '品牌', barcode: '1234567890123' } });
    expect(draft.warnings).toContain('picture_origin_may_require_erp_public_transfer');
  });
});

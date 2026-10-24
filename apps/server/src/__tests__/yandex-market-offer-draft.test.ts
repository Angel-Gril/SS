import { describe, expect, it } from 'vitest';
import { buildYandexOfferDraft } from '../services/yandex-market-offer-draft.js';

describe('Yandex offer draft mapping', () => {
  it('maps ERP/Ozon product fields to a reviewable draft without platform writes', () => {
    const draft = buildYandexOfferDraft({ id: 'product-1', title: 'Кружка', description: 'Керамическая кружка', categoryId: '123', price: '199.9', currency: 'RUB', stock: 3, images: ['https://cdn.example/image.jpg'], attributes: { brand: 'SS', barcodes: ['4601234567890'] } });
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

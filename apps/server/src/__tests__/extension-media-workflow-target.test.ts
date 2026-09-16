import { describe, expect, it } from 'vitest';
import * as draftContract from 'shared/ozon-listing-draft';

describe('existing listing draft media targets', () => {
  const draft = {
    selectedSkuKeys: ['sku-a'],
    media: { assignments: [{ scope: 'SKU', skuKey: 'sku-a', slotKey: 'legacy-detail', assetId: 'asset-a', source: 'SOURCE' }] },
  };
  it.each([
    [{ skuKey: null, slotKey: 'product-main' }, true],
    [{ skuKey: null, slotKey: 'product-gallery-7' }, true],
    [{ skuKey: 'sku-a', slotKey: 'sku:sku-a:hero' }, true],
    [{ skuKey: 'sku-a', slotKey: 'legacy-detail' }, true],
    [{ skuKey: null, slotKey: 'legacy-detail' }, false],
    [{ skuKey: 'sku-b', slotKey: 'sku:sku-b:hero' }, false],
    [{ skuKey: null, slotKey: 'invented-empty-slot' }, false],
    [{ skuKey: null, slotKey: 'product-gallery-8' }, false],
    [{ skuKey: 'sku-a', slotKey: 'product-main' }, false],
    [{ skuKey: null, slotKey: '' }, false],
  ])('validates %j against the current draft', (target, expected) => {
    const validate = Reflect.get(draftContract, 'isSourceListingAiMediaTarget');
    expect(typeof validate).toBe('function');
    expect(validate(draft, target)).toBe(expected);
  });
  it('treats PRODUCT_ONLY as product scope and refuses ambiguous or overlong slots', () => {
    const validate = Reflect.get(draftContract, 'isSourceListingAiMediaTarget');
    expect(typeof validate).toBe('function');
    const productOnly = { selectedSkuKeys: [draftContract.SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY], media: { assignments: [] } };
    expect(validate(productOnly, { skuKey: null, slotKey: 'product-main' })).toBe(true);
    expect(validate(productOnly, { skuKey: draftContract.SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
      slotKey: `sku:${draftContract.SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY}:hero` })).toBe(false);
    expect(validate({ ...draft, media: { assignments: [...draft.media.assignments, ...draft.media.assignments] } },
      { skuKey: 'sku-a', slotKey: 'legacy-detail' })).toBe(false);
    expect(validate(draft, { skuKey: null, slotKey: 'a'.repeat(201) })).toBe(false);
  });
});

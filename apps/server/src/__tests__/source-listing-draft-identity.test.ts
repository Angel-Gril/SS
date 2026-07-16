import { describe, expect, it } from 'vitest';

import {
  assertSourceListingDraftIdentity,
  normalizeSourceListingDraftIdentityRefs,
} from '../services/source-listing-draft-identity.js';

const prepared = [{
  supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 3, revision: 8,
  selectedSkuKeys: ['sku-1', 'sku-2'],
}];

const ref = {
  supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 3, revision: 8, skuKey: 'sku-1',
};

describe('source listing draft identity', () => {
  it('normalizes and accepts an exact server-owned draft/SKU reference', () => {
    const refs = normalizeSourceListingDraftIdentityRefs([ref]);
    expect(refs).toEqual([ref]);
    expect(() => assertSourceListingDraftIdentity({ refs, prepared })).not.toThrow();
  });

  it.each([
    ['missing refs', undefined, 'SOURCE_LISTING_DRAFT_IDENTITY_REQUIRED'],
    ['stale draft version', [{ ...ref, draftVersion: 2 }], 'SOURCE_LISTING_DRAFT_IDENTITY_MISMATCH'],
    ['wrong SKU', [{ ...ref, skuKey: 'sku-9' }], 'SOURCE_LISTING_DRAFT_IDENTITY_SKU_MISMATCH'],
    ['unknown goods', [{ ...ref, supplyGoodsId: 'goods-9' }], 'SOURCE_LISTING_DRAFT_IDENTITY_UNKNOWN_GOODS'],
  ])('rejects %s', (_label, refs, _code) => {
    if (refs === undefined) {
      expect(() => normalizeSourceListingDraftIdentityRefs(refs)).toThrow();
      return;
    }
    expect(() => assertSourceListingDraftIdentity({
      refs: normalizeSourceListingDraftIdentityRefs(refs), prepared,
    })).toThrow();
  });

  it('rejects duplicate or incomplete coverage', () => {
    const refs = normalizeSourceListingDraftIdentityRefs([ref, { ...ref, skuKey: 'sku-2' }]);
    expect(() => assertSourceListingDraftIdentity({ refs, prepared })).toThrow();
    expect(() => assertSourceListingDraftIdentity({
      refs: normalizeSourceListingDraftIdentityRefs([ref, { ...ref, supplyGoodsId: 'goods-2', revision: 1 }]),
      prepared: [...prepared, { ...prepared[0]!, supplyGoodsId: 'goods-2' }],
    })).toThrow();
  });
});

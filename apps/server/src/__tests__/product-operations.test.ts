import { describe, expect, it } from 'vitest';
import { getProductMutationBlockReason, resolveOzonBatchUpdateResults } from '../services/product-operations.js';

describe('product operation helpers', () => {
  it('blocks price and stock mutations for archived or missing Ozon products', () => {
    expect(getProductMutationBlockReason({ visibility: 'ARCHIVED', syncStatus: 'SYNCED', platformProductId: '1', offerId: 'offer-1' }))
      .toContain('已归档');
    expect(getProductMutationBlockReason({ visibility: 'VISIBLE', syncStatus: 'MISSING', platformProductId: '2', offerId: 'offer-2' }))
      .toContain('当前商品列表未返回');
    expect(getProductMutationBlockReason({ visibility: 'VISIBLE', syncStatus: 'SYNCED', platformProductId: null, offerId: 'offer-3' }))
      .toContain('平台商品 ID');
    expect(getProductMutationBlockReason({ visibility: 'VISIBLE', syncStatus: 'SYNCED', platformProductId: '3', offerId: 'offer-3' }))
      .toBeNull();
  });

  it('keeps only Ozon-accepted batch update rows for local persistence', () => {
    const result = resolveOzonBatchUpdateResults({
      result: [
        { updated: true },
        { updated: false, errors: [{ code: 'PRODUCT_NOT_FOUND', message: 'missing' }] },
        { updated: true },
      ],
    }, 3);

    expect(result.successfulIndexes).toEqual([0, 2]);
    expect(result.errors).toEqual([
      { index: 1, message: '[{"code":"PRODUCT_NOT_FOUND","message":"missing"}]' },
    ]);
  });
});

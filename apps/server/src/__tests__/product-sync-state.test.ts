import { describe, expect, it } from 'vitest';
import { getMissingPlatformProductIds } from '../services/product-sync-state.js';

describe('product sync state helpers', () => {
  it('marks local products missing when a full Ozon sync no longer returns them', () => {
    expect(getMissingPlatformProductIds(['1001', '1002', '1003'], ['1001', '1003'])).toEqual(['1002']);
  });

  it('treats an empty full sync result as every local platform product being missing', () => {
    expect(getMissingPlatformProductIds(['1001', null, '1002'], [])).toEqual(['1001', '1002']);
  });
});

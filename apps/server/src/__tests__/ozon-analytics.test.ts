import { describe, expect, it } from 'vitest';
import { dedupeCacheItems, normalizeSkus } from '../routes/ozon-analytics.js';

describe('ozon analytics helpers', () => {
  it('normalizes and deduplicates sku lists', () => {
    expect(normalizeSkus([' 123 ', '123', '', null, '456', '456'])).toEqual(['123', '456']);
  });

  it('limits batch cache items to the latest sku entry', () => {
    expect(dedupeCacheItems([
      { sku: '123', metrics: { a: 1 }, source: 'public-api' },
      { sku: '123', metrics: { a: 2 }, source: 'seller-analytics' },
      { sku: '456', metrics: { b: 1 }, source: 'seller-search' },
    ])).toEqual([
      { sku: '123', metrics: { a: 2 }, source: 'seller-analytics' },
      { sku: '456', metrics: { b: 1 }, source: 'seller-search' },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import { buildCollectSnapshot, buildCollectSnapshotWhere, getSupplyGoodsLookupId } from '../routes/collect.js';

describe('collect snapshot helpers', () => {
  it('prefers sourceProductId and falls back to legacy sku', () => {
    expect(getSupplyGoodsLookupId({ sourceProductId: ' 123 ', sku: 'old' })).toBe('123');
    expect(getSupplyGoodsLookupId({ sourceProductId: null, sku: '456' })).toBe('456');
    expect(getSupplyGoodsLookupId({ sourceProductId: '', sku: '' })).toBeNull();
  });

  it('limits Ozon list-page snapshot lookups to Ozon source records by default', () => {
    expect(buildCollectSnapshotWhere('user-1', ['123', '456'])).toEqual({
      userId: 'user-1',
      sourcePlatform: 'ozon',
      OR: [
        { sourceProductId: { in: ['123', '456'] } },
        { sku: { in: ['123', '456'] } },
      ],
    });
  });

  it('allows explicit source platform snapshot lookups for non-Ozon source records', () => {
    expect(buildCollectSnapshotWhere('user-1', ['tb-123'], 'taobao')).toEqual({
      userId: 'user-1',
      sourcePlatform: 'taobao',
      OR: [
        { sourceProductId: { in: ['tb-123'] } },
        { sku: { in: ['tb-123'] } },
      ],
    });
  });

  it('serializes ERP collect status for list-page overlays', () => {
    const createdAt = new Date('2026-05-31T12:00:00.000Z');

    expect(buildCollectSnapshot({
      id: 'collect-1',
      title: 'Ozon item',
      sourceProductId: '123',
      sku: '123',
      sourceUrl: 'https://www.ozon.ru/product/item-123/',
      status: 'listed',
      createdAt,
      purchasePrice: { toString: () => '99.90' },
      images: ['a.jpg', 'b.jpg'],
      metadata: { lastError: 'old error' },
    })).toEqual({
      collected: true,
      collectId: 'collect-1',
      title: 'Ozon item',
      sourceProductId: '123',
      sku: '123',
      sourceUrl: 'https://www.ozon.ru/product/item-123/',
      status: 'listed',
      lastCollectedAt: '2026-05-31T12:00:00.000Z',
      price: '99.90',
      imageCount: 2,
      listed: true,
      lastError: 'old error',
    });
  });
});

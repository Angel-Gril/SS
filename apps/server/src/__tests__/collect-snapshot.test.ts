import { describe, expect, it } from 'vitest';
import { buildCollectSnapshot, buildCollectSnapshotWhere, getSupplyGoodsLookupId, normalizeCollectSourcePlatform } from '../routes/collect.js';

describe('collect snapshot helpers', () => {
  it('prefers sourceProductId and falls back to legacy sku for Ozon records', () => {
    expect(getSupplyGoodsLookupId({ sourceProductId: ' 123 ', sku: 'old' })).toBe('123');
    expect(getSupplyGoodsLookupId({ sourceProductId: null, sku: '456' })).toBe('456');
    expect(getSupplyGoodsLookupId({ sourceProductId: '', sku: '' })).toBeNull();
  });

  it('does not use source platform SKU as a domestic supply product lookup id', () => {
    expect(getSupplyGoodsLookupId({ sourcePlatform: 'taobao', sourceProductId: ' 998877 ', sku: 'tb-red' })).toBe('998877');
    expect(getSupplyGoodsLookupId({ sourcePlatform: '1688', sourceProductId: null, sku: 'sku-red-42' })).toBeNull();
    expect(getSupplyGoodsLookupId({ sourcePlatform: 'jd', sourceProductId: '', sku: 'jd-sku-red' })).toBeNull();
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
      sourceProductId: { in: ['tb-123'] },
    });
  });

  it('allows domestic supply snapshot lookups across all source platforms', () => {
    expect(buildCollectSnapshotWhere('user-1', ['supply-123'], 'domestic-supply')).toEqual({
      userId: 'user-1',
      sourcePlatform: { in: ['1688', 'taobao', 'tmall', 'jd', 'pinduoduo', 'pdd'] },
      sourceProductId: { in: ['supply-123'] },
    });
  });

  it('normalizes explicit source platform snapshot lookups', () => {
    expect(buildCollectSnapshotWhere('user-1', ['tb-123'], 'Taobao')).toEqual({
      userId: 'user-1',
      sourcePlatform: 'taobao',
      sourceProductId: { in: ['tb-123'] },
    });
  });

  it('normalizes source platforms before storing collect records', () => {
    expect(normalizeCollectSourcePlatform('OZON')).toBe('ozon');
    expect(normalizeCollectSourcePlatform('Taobao')).toBe('taobao');
    expect(normalizeCollectSourcePlatform(undefined)).toBe('ozon');
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

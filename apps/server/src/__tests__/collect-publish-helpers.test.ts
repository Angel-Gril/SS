import { describe, expect, it } from 'vitest';
import {
  calcPublishPrice,
  containsCjkText,
  getItemOverridePrice,
  getOzonListingSourceProductId,
  getVariantOverridePrice,
  resolvePublishName,
} from '../routes/collect.js';

describe('collect publish helpers', () => {
  it('calculates publish price with percentage markup and fixed amount', () => {
    expect(calcPublishPrice(50.16, 200, 10)).toBe(161);
    expect(calcPublishPrice(100, 0, 9.5)).toBe(110);
  });

  it('detects Chinese text in publish names', () => {
    expect(containsCjkText('Чехол для iPad')).toBe(false);
    expect(containsCjkText('保护套 для iPad')).toBe(true);
  });

  it('uses Russian publish title from metadata before display title', () => {
    const name = resolvePublishName({
      title: '中文商品名',
      metadata: { publishTitleRu: 'Чехол для iPad' },
    }, { Цвет: 'серый' });
    expect(name).toBe('Чехол для iPad серый');
  });

  it('prefers sku-based variant price overrides while keeping index fallback', () => {
    expect(getVariantOverridePrice({ '3378860669': '188.2', 0: 123 }, { sku: '3378860669' }, 0)).toBe(189);
    expect(getVariantOverridePrice({ 1: '77.1' }, { sku: 'missing' }, 1)).toBe(78);
    expect(getVariantOverridePrice({ missing: '0' }, { sku: 'missing' }, 0)).toBeNull();
  });

  it('uses item-level price override for listing prefilled 1688 prices', () => {
    expect(getItemOverridePrice({ _base: '73.2' })).toBe(74);
    expect(getItemOverridePrice({ base: 81 })).toBe(81);
    expect(getItemOverridePrice({ _base: 0, base: 55 })).toBeNull();
  });

  it('prefers Ozon source product id before legacy sku for listing source lookup', () => {
    expect(getOzonListingSourceProductId({
      sku: '1688-offer-id',
      sourcePlatform: '1688',
      metadata: { sourceOzonProductId: ' 987654321 ' },
    })).toBe('987654321');
    expect(getOzonListingSourceProductId({
      sku: '1688-offer-id',
      sourcePlatform: '1688',
      metadata: { ozonSourceContext: { productId: '777' } },
    })).toBe('777');
    expect(getOzonListingSourceProductId({ sku: '123456789', metadata: {} })).toBe('123456789');
    expect(getOzonListingSourceProductId({ sourcePlatform: '1688', sku: '123456789', metadata: {} })).toBeNull();
  });
});

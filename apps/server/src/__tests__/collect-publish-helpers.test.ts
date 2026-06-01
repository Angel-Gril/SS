import { describe, expect, it } from 'vitest';
import { calcPublishPrice, containsCjkText, getVariantOverridePrice, resolvePublishName } from '../routes/collect.js';

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
});

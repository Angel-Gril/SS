import { describe, expect, it } from 'vitest';
import { calculateBatchPrice } from '../services/product-pricing.js';

describe('product pricing helpers', () => {
  it('calculates batch price updates from the current product price', () => {
    expect(calculateBatchPrice('100', { mode: 'multiply', value: 2 })).toBe('200.00');
    expect(calculateBatchPrice('100', { mode: 'discount', value: 30 })).toBe('70.00');
    expect(calculateBatchPrice('100', { mode: 'increase', value: 20 })).toBe('120.00');
  });

  it('rejects invalid calculated prices so batch updates can skip unsafe rows', () => {
    expect(calculateBatchPrice(null, { mode: 'multiply', value: 2 })).toBeNull();
    expect(calculateBatchPrice('100', { mode: 'discount', value: 100 })).toBeNull();
    expect(calculateBatchPrice('100', { mode: 'multiply', value: 0 })).toBeNull();
  });
});

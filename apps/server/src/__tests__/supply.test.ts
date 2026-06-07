import { describe, expect, it } from 'vitest';
import {
  normalizeSupplySourcePlatform,
  parseSupplyCreateInput,
  parseSupplyUpdateInput,
} from '../routes/supply.js';

describe('supply helpers', () => {
  it('normalizes source platform casing for create payloads', () => {
    expect(parseSupplyCreateInput({
      title: '淘宝手动货源',
      sourcePlatform: 'Taobao',
    })).toMatchObject({
      title: '淘宝手动货源',
      sourcePlatform: 'taobao',
    });
  });

  it('normalizes source platform casing for update payloads', () => {
    expect(parseSupplyUpdateInput({
      sourcePlatform: 'PDD',
    })).toMatchObject({
      sourcePlatform: 'pdd',
    });
  });

  it('preserves editable supply status updates', () => {
    expect(parseSupplyUpdateInput({
      status: 'inactive',
    })).toMatchObject({
      status: 'inactive',
    });
  });

  it('rejects unsupported source platforms instead of storing raw keys', () => {
    expect(normalizeSupplySourcePlatform('Taobao')).toBe('taobao');
    expect(normalizeSupplySourcePlatform(' PDD ')).toBe('pdd');
    expect(() => parseSupplyCreateInput({
      title: '未知货源',
      sourcePlatform: 'etsy',
    })).toThrow();
  });
});

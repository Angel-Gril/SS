import { describe, expect, it } from 'vitest';
import {
  aiImageSandboxDecimalsEqual,
  aiImageSandboxPowerOfTen,
  assertAiImageSandboxMoneyPair,
  compareAiImageSandboxDecimals,
  parseAiImageSandboxDecimal,
  parseAiImageSandboxLegacyCents,
  parseAiImageSandboxMoney,
} from '../services/ai-image-sandbox-money.js';

describe('AI image sandbox exact-money contract', () => {
  it('allows an explicitly authorized zero actual cost without using a float', () => {
    expect(parseAiImageSandboxMoney(
      { currency: 'CNY', amount: 0, scale: 0 },
      'Actual cost',
      { allowZero: true },
    )).toEqual({ currency: 'CNY', amount: 0, scale: 0 });
  });

  it('parses a closed canonical zero decimal for a billing meter delta', () => {
    expect(parseAiImageSandboxDecimal(
      { amount: 0, scale: 0 },
      'Meter delta',
    )).toEqual({ amount: 0, scale: 0 });
    expect(() => parseAiImageSandboxDecimal(
      { amount: 0, scale: 0, decimal: '0' },
      'Meter delta',
    )).toThrow(/missing or unsupported fields/u);
  });

  it('compares different scales exactly with integer arithmetic', () => {
    expect(aiImageSandboxPowerOfTen(4)).toBe(10_000n);
    expect(compareAiImageSandboxDecimals(
      { amount: 119, scale: 4 },
      { amount: 12, scale: 3 },
    )).toBe(-1);
    expect(aiImageSandboxDecimalsEqual(
      { amount: 119, scale: 4 },
      { amount: 1_190, scale: 5 },
    )).toBe(true);
  });

  it('rejects alternate decimal encodings with removable trailing scale', () => {
    expect(() => parseAiImageSandboxDecimal(
      { amount: 1_190, scale: 5 },
      'Meter delta',
    )).toThrow(/canonical/u);
    expect(() => parseAiImageSandboxDecimal(
      { amount: 0, scale: 4 },
      'Meter delta',
    )).toThrow(/canonical/u);
  });

  it('requires a quote and maximum pair to use its minimum shared scale', () => {
    expect(() => assertAiImageSandboxMoneyPair(
      { currency: 'CNY', amount: 1_190, scale: 5 },
      { currency: 'CNY', amount: 2_000, scale: 5 },
    )).toThrow(/minimum shared scale/u);
    expect(() => assertAiImageSandboxMoneyPair(
      { currency: 'CNY', amount: 119, scale: 4 },
      { currency: 'CNY', amount: 200, scale: 4 },
    )).not.toThrow();
  });

  it('parses legacy cents canonically and enforces the shared ceiling', () => {
    expect(parseAiImageSandboxLegacyCents('10', 'Legacy cost')).toBe(10);
    expect(parseAiImageSandboxLegacyCents(10, 'Legacy cost')).toBe(10);
    for (const value of ['01', '1e2', '10.0', '0x10', '10000001']) {
      expect(() => parseAiImageSandboxLegacyCents(value, 'Legacy cost')).toThrow();
    }
  });
});

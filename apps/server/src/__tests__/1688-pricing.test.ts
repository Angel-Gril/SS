import { describe, expect, it } from 'vitest';
import { calculate1688Pricing } from '../lib/1688-pricing.js';

describe('1688 pricing helper', () => {
  it('calculates a suggested sale price with a cost breakdown', () => {
    const result = calculate1688Pricing({
      purchasePriceCny: 20,
      domesticShippingCny: 5,
      weightG: 500,
      packageFeeCny: 2,
      commissionPct: 12,
      logisticsFeeCny: 18,
      exchangeRateRubToCny: 0.08,
      targetMarginPct: 30,
    });

    expect(result.ok).toBe(true);
    expect(result.totalBaseCostCny).toBe(45);
    expect(result.suggestedSalePriceCny).toBe(73);
    expect(result.suggestedSalePriceRub).toBe(913);
    expect(result.estimatedCommissionCny).toBeCloseTo(8.76, 2);
    expect(result.estimatedProfitCny).toBeCloseTo(19.24, 2);
    expect(result.estimatedMarginPct).toBeCloseTo(26.36, 2);
    expect(result.warnings).toEqual([]);
  });

  it('keeps preview usable when weight is missing and reports a warning', () => {
    const result = calculate1688Pricing({
      purchasePriceCny: 10,
      domesticShippingCny: 0,
      weightG: 0,
      packageFeeCny: 1,
      commissionPct: 10,
      logisticsFeeCny: 0,
      exchangeRateRubToCny: 0.08,
      targetMarginPct: 25,
    });

    expect(result.ok).toBe(true);
    expect(result.normalizedWeightG).toBe(500);
    expect(result.warnings).toContain('未填写重量，已按 500g 估算');
  });

  it('rejects invalid costs, exchange rate, and target margin', () => {
    expect(calculate1688Pricing({
      purchasePriceCny: -1,
      exchangeRateRubToCny: 0.08,
      targetMarginPct: 30,
    }).ok).toBe(false);

    expect(calculate1688Pricing({
      purchasePriceCny: 10,
      exchangeRateRubToCny: 0,
      targetMarginPct: 30,
    }).errors).toContain('汇率必须大于 0');

    expect(calculate1688Pricing({
      purchasePriceCny: 10,
      exchangeRateRubToCny: 0.08,
      targetMarginPct: 95,
    }).errors).toContain('目标利润率不能高于 90%');
  });
});

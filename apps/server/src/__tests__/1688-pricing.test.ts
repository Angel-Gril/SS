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

  it('calculates per-sku pricing when 1688 variants have different prices and weights', () => {
    const result = calculate1688Pricing({
      purchasePriceCny: 20,
      domesticShippingCny: 5,
      weightG: 500,
      packageFeeCny: 2,
      commissionPct: 12,
      logisticsFeeCny: 18,
      exchangeRateRubToCny: 0.08,
      targetMarginPct: 30,
      skuItems: [
        { skuId: 'red', specText: '红色', price: 18, grossWeightGrams: 420 },
        { skuId: 'blue', specText: '蓝色', price: 25, grossWeightGrams: 650 },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.skuPricing).toHaveLength(2);
    expect(result.skuPricing?.[0]).toMatchObject({
      skuId: 'red',
      specText: '红色',
      purchasePriceCny: 18,
      normalizedWeightG: 420,
      suggestedSalePriceCny: 69,
      suggestedSalePriceRub: 863,
    });
    expect(result.skuPricing?.[1]).toMatchObject({
      skuId: 'blue',
      specText: '蓝色',
      purchasePriceCny: 25,
      normalizedWeightG: 650,
      suggestedSalePriceCny: 81,
      suggestedSalePriceRub: 1013,
    });
    expect(result.skuSummary).toMatchObject({
      count: 2,
      minSuggestedSalePriceCny: 69,
      maxSuggestedSalePriceCny: 81,
      minSuggestedSalePriceRub: 863,
      maxSuggestedSalePriceRub: 1013,
    });
  });

  it('uses per-sku logistics fee when supplied for 1688 variant pricing', () => {
    const result = calculate1688Pricing({
      purchasePriceCny: 20,
      domesticShippingCny: 5,
      weightG: 500,
      packageFeeCny: 2,
      commissionPct: 12,
      logisticsFeeCny: 18,
      exchangeRateRubToCny: 0.08,
      targetMarginPct: 30,
      skuItems: [
        { skuId: 'light', specText: '轻款', price: 18, grossWeightGrams: 300, logisticsFeeCny: 12 },
        { skuId: 'heavy', specText: '重款', price: 25, grossWeightGrams: 900, logisticsFeeCny: 30 },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.skuPricing?.[0]).toMatchObject({
      skuId: 'light',
      logisticsFeeCny: 12,
      totalBaseCostCny: 37,
      suggestedSalePriceCny: 60,
      suggestedSalePriceRub: 750,
    });
    expect(result.skuPricing?.[1]).toMatchObject({
      skuId: 'heavy',
      logisticsFeeCny: 30,
      totalBaseCostCny: 62,
      suggestedSalePriceCny: 100,
      suggestedSalePriceRub: 1250,
    });
    expect(result.skuSummary).toMatchObject({
      count: 2,
      minSuggestedSalePriceCny: 60,
      maxSuggestedSalePriceCny: 100,
      minSuggestedSalePriceRub: 750,
      maxSuggestedSalePriceRub: 1250,
    });
  });
});

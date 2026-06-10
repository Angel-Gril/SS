export interface Calculate1688PricingInput {
  purchasePriceCny: number;
  domesticShippingCny?: number;
  weightG?: number;
  packageFeeCny?: number;
  commissionPct?: number;
  logisticsFeeCny?: number;
  exchangeRateRubToCny: number;
  targetMarginPct?: number;
  skuItems?: Array<{
    skuId?: string | null;
    name?: string | null;
    specText?: string | null;
    price?: string | number | null;
    logisticsFeeCny?: string | number | null;
    grossWeightGrams?: string | number | null;
  }>;
}

export interface PricingCostLine {
  key: string;
  label: string;
  amountCny: number;
}

export interface Calculate1688PricingResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  normalizedWeightG: number;
  totalBaseCostCny: number;
  suggestedSalePriceCny: number;
  suggestedSalePriceRub: number;
  estimatedCommissionCny: number;
  estimatedProfitCny: number;
  estimatedMarginPct: number;
  costLines: PricingCostLine[];
  skuPricing?: SkuPricingResult[];
  skuSummary?: SkuPricingSummary;
}

export interface SkuPricingResult {
  skuId: string;
  name: string;
  specText: string;
  purchasePriceCny: number;
  logisticsFeeCny: number;
  normalizedWeightG: number;
  totalBaseCostCny: number;
  suggestedSalePriceCny: number;
  suggestedSalePriceRub: number;
  estimatedProfitCny: number;
  estimatedMarginPct: number;
}

export interface SkuPricingSummary {
  count: number;
  minSuggestedSalePriceCny: number;
  maxSuggestedSalePriceCny: number;
  minSuggestedSalePriceRub: number;
  maxSuggestedSalePriceRub: number;
}

const DEFAULT_WEIGHT_G = 500;

function toNumber(value: unknown, fallback = 0): number {
  if (value == null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function ceilCny(value: number): number {
  return Math.ceil(value + 0.01);
}

function calculateValidPricing(input: Required<Pick<Calculate1688PricingInput,
  'purchasePriceCny' | 'domesticShippingCny' | 'weightG' | 'packageFeeCny' | 'commissionPct' | 'logisticsFeeCny' | 'exchangeRateRubToCny' | 'targetMarginPct'
>> & { normalizedWeightG: number }) {
  const costLines: PricingCostLine[] = [
    { key: 'purchase', label: '1688采购价', amountCny: roundMoney(Math.max(0, input.purchasePriceCny)) },
    { key: 'domestic_shipping', label: '国内运费', amountCny: roundMoney(Math.max(0, input.domesticShippingCny)) },
    { key: 'package', label: '包装费', amountCny: roundMoney(Math.max(0, input.packageFeeCny)) },
    { key: 'logistics', label: '跨境物流费', amountCny: roundMoney(Math.max(0, input.logisticsFeeCny)) },
  ];
  const totalBaseCostCny = roundMoney(costLines.reduce((sum, line) => sum + line.amountCny, 0));
  const targetMarginRate = input.targetMarginPct / 100;
  const commissionRate = input.commissionPct / 100;
  const preCommissionTargetPrice = totalBaseCostCny / (1 - targetMarginRate);
  const suggestedSalePriceCny = ceilCny(preCommissionTargetPrice * (1 + commissionRate));
  const suggestedSalePriceRub = Math.ceil(suggestedSalePriceCny / input.exchangeRateRubToCny);
  const estimatedCommissionCny = roundMoney(suggestedSalePriceCny * commissionRate);
  const estimatedProfitCny = roundMoney(suggestedSalePriceCny - totalBaseCostCny - estimatedCommissionCny);
  const estimatedMarginPct = suggestedSalePriceCny > 0
    ? roundMoney((estimatedProfitCny / suggestedSalePriceCny) * 100)
    : 0;

  return {
    costLines,
    totalBaseCostCny,
    suggestedSalePriceCny,
    suggestedSalePriceRub,
    estimatedCommissionCny,
    estimatedProfitCny,
    estimatedMarginPct,
  };
}

function buildSkuPricing(input: Calculate1688PricingInput, shared: {
  domesticShippingCny: number;
  packageFeeCny: number;
  commissionPct: number;
  logisticsFeeCny: number;
  exchangeRateRubToCny: number;
  targetMarginPct: number;
  normalizedWeightG: number;
}): { skuPricing?: SkuPricingResult[]; skuSummary?: SkuPricingSummary } {
  const skuPricing = (input.skuItems || [])
    .map((item) => {
      const purchasePriceCny = toNumber(item.price, 0);
      if (purchasePriceCny <= 0) return null;
      const normalizedWeightG = Math.round(toNumber(item.grossWeightGrams, shared.normalizedWeightG)) || shared.normalizedWeightG;
      const logisticsFeeCny = toNumber(item.logisticsFeeCny, shared.logisticsFeeCny);
      const pricing = calculateValidPricing({
        purchasePriceCny,
        domesticShippingCny: shared.domesticShippingCny,
        weightG: normalizedWeightG,
        normalizedWeightG,
        packageFeeCny: shared.packageFeeCny,
        commissionPct: shared.commissionPct,
        logisticsFeeCny,
        exchangeRateRubToCny: shared.exchangeRateRubToCny,
        targetMarginPct: shared.targetMarginPct,
      });
      return {
        skuId: String(item.skuId || ''),
        name: String(item.name || ''),
        specText: String(item.specText || ''),
        purchasePriceCny: roundMoney(purchasePriceCny),
        logisticsFeeCny: roundMoney(Math.max(0, logisticsFeeCny)),
        normalizedWeightG,
        totalBaseCostCny: pricing.totalBaseCostCny,
        suggestedSalePriceCny: pricing.suggestedSalePriceCny,
        suggestedSalePriceRub: pricing.suggestedSalePriceRub,
        estimatedProfitCny: pricing.estimatedProfitCny,
        estimatedMarginPct: pricing.estimatedMarginPct,
      };
    })
    .filter((item): item is SkuPricingResult => !!item);

  if (!skuPricing.length) return {};
  const cnyPrices = skuPricing.map((item) => item.suggestedSalePriceCny);
  const rubPrices = skuPricing.map((item) => item.suggestedSalePriceRub);
  return {
    skuPricing,
    skuSummary: {
      count: skuPricing.length,
      minSuggestedSalePriceCny: Math.min(...cnyPrices),
      maxSuggestedSalePriceCny: Math.max(...cnyPrices),
      minSuggestedSalePriceRub: Math.min(...rubPrices),
      maxSuggestedSalePriceRub: Math.max(...rubPrices),
    },
  };
}

export function calculate1688Pricing(input: Calculate1688PricingInput): Calculate1688PricingResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const purchasePriceCny = toNumber(input.purchasePriceCny);
  const domesticShippingCny = toNumber(input.domesticShippingCny);
  const packageFeeCny = toNumber(input.packageFeeCny);
  const logisticsFeeCny = toNumber(input.logisticsFeeCny);
  const commissionPct = toNumber(input.commissionPct);
  const exchangeRateRubToCny = toNumber(input.exchangeRateRubToCny);
  const targetMarginPct = toNumber(input.targetMarginPct, 30);
  let normalizedWeightG = Math.round(toNumber(input.weightG));

  if (purchasePriceCny <= 0) errors.push('采购价必须大于 0');
  if (domesticShippingCny < 0) errors.push('国内运费不能小于 0');
  if (packageFeeCny < 0) errors.push('包装费不能小于 0');
  if (logisticsFeeCny < 0) errors.push('跨境物流费不能小于 0');
  if (commissionPct < 0 || commissionPct >= 80) errors.push('佣金率必须在 0% 到 80% 之间');
  if (exchangeRateRubToCny <= 0) errors.push('汇率必须大于 0');
  if (targetMarginPct < 0) errors.push('目标利润率不能小于 0');
  if (targetMarginPct > 90) errors.push('目标利润率不能高于 90%');

  if (normalizedWeightG <= 0) {
    normalizedWeightG = DEFAULT_WEIGHT_G;
    warnings.push('未填写重量，已按 500g 估算');
  }

  const basePricing = calculateValidPricing({
    purchasePriceCny,
    domesticShippingCny,
    weightG: normalizedWeightG,
    normalizedWeightG,
    packageFeeCny,
    commissionPct,
    logisticsFeeCny,
    exchangeRateRubToCny: exchangeRateRubToCny || 1,
    targetMarginPct,
  });

  if (errors.length > 0) {
    return {
      ok: false,
      errors,
      warnings,
      normalizedWeightG,
      totalBaseCostCny: basePricing.totalBaseCostCny,
      suggestedSalePriceCny: 0,
      suggestedSalePriceRub: 0,
      estimatedCommissionCny: 0,
      estimatedProfitCny: 0,
      estimatedMarginPct: 0,
      costLines: basePricing.costLines,
    };
  }

  const sku = buildSkuPricing(input, {
    domesticShippingCny,
    packageFeeCny,
    commissionPct,
    logisticsFeeCny,
    exchangeRateRubToCny,
    targetMarginPct,
    normalizedWeightG,
  });

  return {
    ok: true,
    errors,
    warnings,
    normalizedWeightG,
    totalBaseCostCny: basePricing.totalBaseCostCny,
    suggestedSalePriceCny: basePricing.suggestedSalePriceCny,
    suggestedSalePriceRub: basePricing.suggestedSalePriceRub,
    estimatedCommissionCny: basePricing.estimatedCommissionCny,
    estimatedProfitCny: basePricing.estimatedProfitCny,
    estimatedMarginPct: basePricing.estimatedMarginPct,
    costLines: basePricing.costLines,
    ...sku,
  };
}

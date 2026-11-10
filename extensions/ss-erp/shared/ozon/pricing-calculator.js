// 定价计算器 —— 整份移植自精铺快照
//   _extract/jp20260803/ui/modules/pricing-calculator.mjs
//
// 为什么整份搬：它带真实的 GUOO FBS 运费档（按重量区间 × 申报价值区间），
// 自己写近似值只会把价格算错。唯一改动是去掉 i18n 依赖（t() 直接用 fallback）。
//
// 入口：calculatePricing(input) → { ok, salePriceCny, salePriceRub, ... }
// 默认参数见 DEFAULT_PRICING_INPUT（佣金 17%、目标毛利 20%、折扣 30%、汇率 11.1359）。
const t = (key, fallback) => (fallback == null ? String(key) : String(fallback));

const LAST_MILE_RATE = 0.02;
const LAST_MILE_MIN_RUB = 15;
const LAST_MILE_MAX_RUB = 200;
const VOLUMETRIC_DIVISOR = 12000;
const COMMISSION_RATE_MIN = 0;
const COMMISSION_RATE_MAX = 50;
const VALUE_BANDS_CNY = Object.freeze({
  budgetMax: 136,
  smallMax: 635,
  premiumMax: 22679
});

export const DEFAULT_PRICING_INPUT = Object.freeze({
  commissionRate: 17,
  procurementCostCny: 50,
  packageWeightG: 1900,
  lengthCm: 59,
  widthCm: 40,
  heightCm: 15,
  targetMarginRate: 20,
  frontDiscountRate: 30,
  domesticFeeCny: 2,
  adRate: 0,
  otherRate: 3,
  cnyToRubRate: 11.1359,
  cnyToUsdRate: 0.1464,
  preferredMode: "auto"
});

export const DEFAULT_AUTO_PRICING_TEMPLATE = Object.freeze({
  enabled: false,
  commissionRate: DEFAULT_PRICING_INPUT.commissionRate,
  targetMarginRate: DEFAULT_PRICING_INPUT.targetMarginRate,
  frontDiscountRate: DEFAULT_PRICING_INPUT.frontDiscountRate,
  domesticFeeCny: DEFAULT_PRICING_INPUT.domesticFeeCny,
  adRate: DEFAULT_PRICING_INPUT.adRate,
  otherRate: DEFAULT_PRICING_INPUT.otherRate,
  preferredMode: DEFAULT_PRICING_INPUT.preferredMode
});

export const COMMISSION_OPTIONS = Object.freeze(
  Array.from({ length: 12 }, (_, index) => 10 + index)
);

export const TRANSPORT_MODE_LABELS = Object.freeze({
  express: "Express",
  standard: "Standard",
  economy: "Economy"
});

export const MODE_ETA_LABELS = Object.freeze({
  express: "5-14天",
  standard: "7-19天",
  economy: "12-24天"
});

export const GUOO_REAL_FBS_TARIFFS = Object.freeze([
  {
    id: "express-extra-small",
    tierKey: "extra-small",
    tierLabel: "Extra Small",
    tierDesc: "超级轻小件",
    mode: "express",
    channelName: "GUOO Express Extra Small",
    transportLabel: "空运",
    ratePerKg: 46.8,
    ticketFee: 3.12,
    weightMinKg: 0.001,
    weightMaxKg: 0.5,
    valueMinCny: 0,
    valueMaxCny: VALUE_BANDS_CNY.budgetMax,
    sizeSumMaxCm: 90,
    longestMaxCm: 60,
    middleMaxCm: 60,
    shortestMaxCm: 60,
    useVolumetricWeight: false,
    batteryNote: "限内置小容量电池，配套电池禁运。"
  },
  {
    id: "standard-extra-small",
    tierKey: "extra-small",
    tierLabel: "Extra Small",
    tierDesc: "超级轻小件",
    mode: "standard",
    channelName: "GUOO Standard Extra Small",
    transportLabel: "陆空联运",
    ratePerKg: 36.4,
    ticketFee: 3.12,
    weightMinKg: 0.001,
    weightMaxKg: 0.5,
    valueMinCny: 0,
    valueMaxCny: VALUE_BANDS_CNY.budgetMax,
    sizeSumMaxCm: 90,
    longestMaxCm: 60,
    middleMaxCm: 60,
    shortestMaxCm: 60,
    useVolumetricWeight: false,
    batteryNote: "默认普货，敏感货请单独确认。"
  },
  {
    id: "economy-extra-small",
    tierKey: "extra-small",
    tierLabel: "Extra Small",
    tierDesc: "超级轻小件",
    mode: "economy",
    channelName: "GUOO Economy Extra Small",
    transportLabel: "陆运",
    ratePerKg: 26,
    ticketFee: 3,
    weightMinKg: 0.001,
    weightMaxKg: 0.5,
    valueMinCny: 0,
    valueMaxCny: VALUE_BANDS_CNY.budgetMax,
    sizeSumMaxCm: 90,
    longestMaxCm: 60,
    middleMaxCm: 60,
    shortestMaxCm: 60,
    useVolumetricWeight: false,
    batteryNote: "默认普货，敏感货请单独确认。"
  },
  {
    id: "standard-budget",
    tierKey: "budget",
    tierLabel: "Budget",
    tierDesc: "低客单轻小件",
    mode: "standard",
    channelName: "GUOO Standard Budget",
    transportLabel: "陆空联运",
    ratePerKg: 26,
    ticketFee: 23.92,
    weightMinKg: 0.501,
    weightMaxKg: 30,
    valueMinCny: 0,
    valueMaxCny: VALUE_BANDS_CNY.budgetMax,
    sizeSumMaxCm: 150,
    longestMaxCm: 60,
    middleMaxCm: 60,
    shortestMaxCm: 60,
    useVolumetricWeight: false,
    batteryNote: "默认普货，敏感货请单独确认。"
  },
  {
    id: "economy-budget",
    tierKey: "budget",
    tierLabel: "Budget",
    tierDesc: "低客单轻小件",
    mode: "economy",
    channelName: "GUOO Economy Budget",
    transportLabel: "陆运",
    ratePerKg: 17.68,
    ticketFee: 23.92,
    weightMinKg: 0.501,
    weightMaxKg: 30,
    valueMinCny: 0,
    valueMaxCny: VALUE_BANDS_CNY.budgetMax,
    sizeSumMaxCm: 150,
    longestMaxCm: 60,
    middleMaxCm: 60,
    shortestMaxCm: 60,
    useVolumetricWeight: false,
    batteryNote: "默认普货，敏感货请单独确认。"
  },
  {
    id: "express-small",
    tierKey: "small",
    tierLabel: "Small",
    tierDesc: "高客单轻小件",
    mode: "express",
    channelName: "GUOO Express Small",
    transportLabel: "空运",
    ratePerKg: 46.8,
    ticketFee: 16.64,
    weightMinKg: 0.001,
    weightMaxKg: 2,
    valueMinCny: VALUE_BANDS_CNY.budgetMax + 0.01,
    valueMaxCny: VALUE_BANDS_CNY.smallMax,
    sizeSumMaxCm: 150,
    longestMaxCm: 60,
    middleMaxCm: 60,
    shortestMaxCm: 60,
    useVolumetricWeight: false,
    batteryNote: "默认普货，敏感货请单独确认。"
  },
  {
    id: "standard-small",
    tierKey: "small",
    tierLabel: "Small",
    tierDesc: "高客单轻小件",
    mode: "standard",
    channelName: "GUOO Standard Small",
    transportLabel: "陆空联运",
    ratePerKg: 36.4,
    ticketFee: 16.64,
    weightMinKg: 0.001,
    weightMaxKg: 2,
    valueMinCny: VALUE_BANDS_CNY.budgetMax + 0.01,
    valueMaxCny: VALUE_BANDS_CNY.smallMax,
    sizeSumMaxCm: 150,
    longestMaxCm: 60,
    middleMaxCm: 60,
    shortestMaxCm: 60,
    useVolumetricWeight: false,
    batteryNote: "默认普货，敏感货请单独确认。"
  },
  {
    id: "economy-small",
    tierKey: "small",
    tierLabel: "Small",
    tierDesc: "高客单轻小件",
    mode: "economy",
    channelName: "GUOO Economy Small",
    transportLabel: "陆运",
    ratePerKg: 26,
    ticketFee: 16.64,
    weightMinKg: 0.001,
    weightMaxKg: 2,
    valueMinCny: VALUE_BANDS_CNY.budgetMax + 0.01,
    valueMaxCny: VALUE_BANDS_CNY.smallMax,
    sizeSumMaxCm: 150,
    longestMaxCm: 60,
    middleMaxCm: 60,
    shortestMaxCm: 60,
    useVolumetricWeight: false,
    batteryNote: "可以运输内置电池产品。"
  },
  {
    id: "standard-big",
    tierKey: "big",
    tierLabel: "Big",
    tierDesc: "大件",
    mode: "standard",
    channelName: "GUOO Standard Big",
    transportLabel: "陆空联运",
    ratePerKg: 26,
    ticketFee: 37.44,
    weightMinKg: 2.001,
    weightMaxKg: 30,
    valueMinCny: VALUE_BANDS_CNY.budgetMax + 0.01,
    valueMaxCny: VALUE_BANDS_CNY.smallMax,
    sizeSumMaxCm: 250,
    longestMaxCm: 150,
    middleMaxCm: 80,
    shortestMaxCm: 80,
    useVolumetricWeight: true,
    batteryNote: "不支持纯电池，可运输内置电池产品。"
  },
  {
    id: "economy-big",
    tierKey: "big",
    tierLabel: "Big",
    tierDesc: "大件",
    mode: "economy",
    channelName: "GUOO Economy Big",
    transportLabel: "陆运",
    ratePerKg: 17.68,
    ticketFee: 37.44,
    weightMinKg: 2.001,
    weightMaxKg: 30,
    valueMinCny: VALUE_BANDS_CNY.budgetMax + 0.01,
    valueMaxCny: VALUE_BANDS_CNY.smallMax,
    sizeSumMaxCm: 250,
    longestMaxCm: 150,
    middleMaxCm: 80,
    shortestMaxCm: 80,
    useVolumetricWeight: true,
    batteryNote: "可以运输内置电池产品。"
  },
  {
    id: "express-premium-small",
    tierKey: "premium-small",
    tierLabel: "Premium Small",
    tierDesc: "高客单轻小件",
    mode: "express",
    channelName: "GUOO Express Premium Small",
    transportLabel: "空运",
    ratePerKg: 46.8,
    ticketFee: 22.88,
    weightMinKg: 0.001,
    weightMaxKg: 5,
    valueMinCny: VALUE_BANDS_CNY.smallMax + 0.01,
    valueMaxCny: VALUE_BANDS_CNY.premiumMax,
    sizeSumMaxCm: 250,
    longestMaxCm: 150,
    middleMaxCm: 80,
    shortestMaxCm: 80,
    useVolumetricWeight: false,
    batteryNote: "只接普货，不支持带电、带磁、液体等。"
  },
  {
    id: "standard-premium-small",
    tierKey: "premium-small",
    tierLabel: "Premium Small",
    tierDesc: "高客单轻小件",
    mode: "standard",
    channelName: "GUOO Standard Premium Small",
    transportLabel: "陆空联运",
    ratePerKg: 36.4,
    ticketFee: 22.88,
    weightMinKg: 0.001,
    weightMaxKg: 5,
    valueMinCny: VALUE_BANDS_CNY.smallMax + 0.01,
    valueMaxCny: VALUE_BANDS_CNY.premiumMax,
    sizeSumMaxCm: 250,
    longestMaxCm: 150,
    middleMaxCm: 80,
    shortestMaxCm: 80,
    useVolumetricWeight: false,
    batteryNote: "不支持纯电池，可运输内置电池产品。"
  },
  {
    id: "economy-premium-small",
    tierKey: "premium-small",
    tierLabel: "Premium Small",
    tierDesc: "高客单轻小件",
    mode: "economy",
    channelName: "GUOO Economy Premium Small",
    transportLabel: "陆运",
    ratePerKg: 26,
    ticketFee: 22.88,
    weightMinKg: 0.001,
    weightMaxKg: 5,
    valueMinCny: VALUE_BANDS_CNY.smallMax + 0.01,
    valueMaxCny: VALUE_BANDS_CNY.premiumMax,
    sizeSumMaxCm: 250,
    longestMaxCm: 150,
    middleMaxCm: 80,
    shortestMaxCm: 80,
    useVolumetricWeight: false,
    batteryNote: "可以运输内置电池产品。"
  },
  {
    id: "standard-premium-big",
    tierKey: "premium-big",
    tierLabel: "Premium Big",
    tierDesc: "高客单大件",
    mode: "standard",
    channelName: "GUOO Standard Premium Big",
    transportLabel: "陆空联运",
    ratePerKg: 29.12,
    ticketFee: 64.48,
    weightMinKg: 5.001,
    weightMaxKg: 30,
    valueMinCny: VALUE_BANDS_CNY.smallMax + 0.01,
    valueMaxCny: VALUE_BANDS_CNY.premiumMax,
    sizeSumMaxCm: 310,
    longestMaxCm: 150,
    middleMaxCm: 80,
    shortestMaxCm: 80,
    useVolumetricWeight: true,
    batteryNote: "不支持纯电池，可运输内置电池产品。"
  },
  {
    id: "economy-premium-big",
    tierKey: "premium-big",
    tierLabel: "Premium Big",
    tierDesc: "高客单大件",
    mode: "economy",
    channelName: "GUOO Economy Premium Big",
    transportLabel: "陆运",
    ratePerKg: 23.92,
    ticketFee: 64.48,
    weightMinKg: 5.001,
    weightMaxKg: 30,
    valueMinCny: VALUE_BANDS_CNY.smallMax + 0.01,
    valueMaxCny: VALUE_BANDS_CNY.premiumMax,
    sizeSumMaxCm: 310,
    longestMaxCm: 150,
    middleMaxCm: 80,
    shortestMaxCm: 80,
    useVolumetricWeight: true,
    batteryNote: "可以运输内置电池产品。"
  }
]);

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function roundTo(value, decimals = 2) {
  const factor = 10 ** decimals;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function text(key, fallback, substitutions) {
  return t(key, substitutions, fallback);
}

function buildInvalidPriceBandReason(targetSalePriceCny, tariff) {
  return [
    text("pricing_invalidPriceBandPrefix", "按当前参数反推售价约 ¥"),
    targetSalePriceCny,
    text("pricing_invalidPriceBandMiddle", "，不在 "),
    `${tariff.valueMinCny}-${tariff.valueMaxCny}`,
    text("pricing_invalidPriceBandSuffix", " 元区间内。")
  ].join("");
}

function toNumber(value, fallback = 0) {
  const cleaned = String(value ?? "").replace(/[^\d.-]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeAutoPricingTemplate(template = {}) {
  const commissionCategoryPath = Array.isArray(template?.commissionCategoryPath)
    ? template.commissionCategoryPath.map((value) => String(value)).filter(Boolean)
    : [];
  const commissionCategoryLabels = Array.isArray(template?.commissionCategoryLabels)
    ? template.commissionCategoryLabels.map((value) => String(value)).filter(Boolean)
    : [];
  return {
    enabled: typeof template?.enabled === "boolean"
      ? template.enabled
      : DEFAULT_AUTO_PRICING_TEMPLATE.enabled,
    commissionRate: clamp(
      toNumber(template?.commissionRate, DEFAULT_AUTO_PRICING_TEMPLATE.commissionRate),
      COMMISSION_RATE_MIN,
      COMMISSION_RATE_MAX
    ),
    commissionCategoryPath,
    commissionCategoryLabels,
    commissionTierLabel: String(template?.commissionTierLabel || ""),
    targetMarginRate: clamp(toNumber(template?.targetMarginRate, DEFAULT_AUTO_PRICING_TEMPLATE.targetMarginRate), 0, 95),
    frontDiscountRate: clamp(toNumber(template?.frontDiscountRate, DEFAULT_AUTO_PRICING_TEMPLATE.frontDiscountRate), 0, 95),
    domesticFeeCny: Math.max(0, toNumber(template?.domesticFeeCny, DEFAULT_AUTO_PRICING_TEMPLATE.domesticFeeCny)),
    adRate: clamp(toNumber(template?.adRate, DEFAULT_AUTO_PRICING_TEMPLATE.adRate), 0, 95),
    otherRate: clamp(toNumber(template?.otherRate, DEFAULT_AUTO_PRICING_TEMPLATE.otherRate), 0, 95),
    preferredMode: String(template?.preferredMode || DEFAULT_AUTO_PRICING_TEMPLATE.preferredMode).toLowerCase() === "express"
      ? "express"
      : String(template?.preferredMode || DEFAULT_AUTO_PRICING_TEMPLATE.preferredMode).toLowerCase() === "standard"
      ? "standard"
      : String(template?.preferredMode || DEFAULT_AUTO_PRICING_TEMPLATE.preferredMode).toLowerCase() === "economy"
      ? "economy"
      : "auto"
  };
}

function normalizeDimensions(input) {
  const values = [toNumber(input.lengthCm), toNumber(input.widthCm), toNumber(input.heightCm)]
    .filter((value) => value > 0)
    .sort((a, b) => b - a);
  return {
    longestCm: values[0] || 0,
    middleCm: values[1] || 0,
    shortestCm: values[2] || 0,
    sizeSumCm: values.reduce((sum, value) => sum + value, 0),
    raw: values
  };
}

function buildNormalizedInput(input = {}) {
  return {
    commissionRate: clamp(
      toNumber(input.commissionRate, DEFAULT_PRICING_INPUT.commissionRate),
      COMMISSION_RATE_MIN,
      COMMISSION_RATE_MAX
    ) / 100,
    procurementCostCny: Math.max(0, toNumber(input.procurementCostCny, DEFAULT_PRICING_INPUT.procurementCostCny)),
    packageWeightKg: Math.max(0, toNumber(input.packageWeightG, DEFAULT_PRICING_INPUT.packageWeightG) / 1000),
    dimensions: normalizeDimensions(input),
    targetMarginRate: clamp(toNumber(input.targetMarginRate, DEFAULT_PRICING_INPUT.targetMarginRate), 0, 95) / 100,
    frontDiscountRate: clamp(toNumber(input.frontDiscountRate, DEFAULT_PRICING_INPUT.frontDiscountRate), 0, 95) / 100,
    domesticFeeCny: Math.max(0, toNumber(input.domesticFeeCny, DEFAULT_PRICING_INPUT.domesticFeeCny)),
    adRate: clamp(toNumber(input.adRate, DEFAULT_PRICING_INPUT.adRate), 0, 95) / 100,
    otherRate: clamp(toNumber(input.otherRate, DEFAULT_PRICING_INPUT.otherRate), 0, 95) / 100,
    cnyToRubRate: Math.max(0.0001, toNumber(input.cnyToRubRate, DEFAULT_PRICING_INPUT.cnyToRubRate)),
    cnyToUsdRate: Math.max(0, toNumber(input.cnyToUsdRate, DEFAULT_PRICING_INPUT.cnyToUsdRate)),
    preferredMode: String(input.preferredMode || DEFAULT_PRICING_INPUT.preferredMode).toLowerCase()
  };
}

function qualifiesForDimensions(tariff, dims) {
  return (
    dims.sizeSumCm <= tariff.sizeSumMaxCm &&
    dims.longestCm <= tariff.longestMaxCm &&
    dims.middleCm <= tariff.middleMaxCm &&
    dims.shortestCm <= tariff.shortestMaxCm
  );
}

function qualifiesForWeight(tariff, actualWeightKg) {
  return actualWeightKg >= tariff.weightMinKg && actualWeightKg <= tariff.weightMaxKg;
}

function resolveEffectiveWeightKg(tariff, actualWeightKg, dims) {
  if (!tariff.useVolumetricWeight) {
    return {
      effectiveWeightKg: actualWeightKg,
      autoRaised: false,
      originalWeightKg: actualWeightKg
    };
  }

  const dimensionsFit = qualifiesForDimensions(tariff, dims);
  const needsAutoRaise = dimensionsFit && actualWeightKg > 0 && actualWeightKg < tariff.weightMinKg;
  if (!needsAutoRaise) {
    return {
      effectiveWeightKg: actualWeightKg,
      autoRaised: false,
      originalWeightKg: actualWeightKg
    };
  }

  return {
    effectiveWeightKg: roundTo(Math.ceil(tariff.weightMinKg * 10) / 10, 3),
    autoRaised: true,
    originalWeightKg: actualWeightKg
  };
}

function computeBillableWeightKg(tariff, actualWeightKg, dims) {
  if (!tariff.useVolumetricWeight) {
    return roundTo(actualWeightKg, 3);
  }
  const volumetricWeight = dims.raw.length === 3
    ? dims.longestCm * dims.middleCm * dims.shortestCm / VOLUMETRIC_DIVISOR
    : 0;
  return roundTo(Math.max(actualWeightKg, volumetricWeight), 3);
}

function computeCrossBorderFeeCny(tariff, billableWeightKg) {
  return roundTo(billableWeightKg * tariff.ratePerKg + tariff.ticketFee);
}

function computeLastMileFeeCny(priceCny, cnyToRubRate) {
  const feeRub = clamp(priceCny * cnyToRubRate * LAST_MILE_RATE, LAST_MILE_MIN_RUB, LAST_MILE_MAX_RUB);
  return roundTo(feeRub / cnyToRubRate);
}

function solveSalePriceCny({ fixedCostsCny, commissionRate, marginRate, adRate, otherRate, cnyToRubRate }) {
  const variableRate = commissionRate + marginRate + adRate + otherRate;
  if (variableRate >= 0.96) {
    return null;
  }

  let low = fixedCostsCny;
  let high = Math.max(fixedCostsCny * 6, 100);

  const evaluate = (price) => {
    const lastMileFee = computeLastMileFeeCny(price, cnyToRubRate);
    return fixedCostsCny + lastMileFee + price * variableRate;
  };

  while (evaluate(high) > high && high < 1000000) {
    high *= 1.5;
  }

  if (evaluate(high) > high) {
    return null;
  }

  for (let index = 0; index < 60; index += 1) {
    const mid = (low + high) / 2;
    if (evaluate(mid) > mid) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return roundTo(high);
}

function computeCandidate(tariff, normalizedInput) {
  const { packageWeightKg, dimensions } = normalizedInput;
  const weightResolution = resolveEffectiveWeightKg(tariff, packageWeightKg, dimensions);
  const effectiveWeightKg = weightResolution.effectiveWeightKg;
  const baseValid = qualifiesForWeight(tariff, effectiveWeightKg) && qualifiesForDimensions(tariff, dimensions);
  if (!baseValid) {
    return {
      tariff,
      mode: tariff.mode,
      valid: false,
      reason: text("pricing_invalidWeightDimension", "重量或尺寸超出该渠道限制。")
    };
  }

  const billableWeightKg = computeBillableWeightKg(tariff, effectiveWeightKg, dimensions);
  const crossBorderFeeCny = computeCrossBorderFeeCny(tariff, billableWeightKg);
  const fixedCostsCny = roundTo(
    normalizedInput.procurementCostCny +
      normalizedInput.domesticFeeCny +
      crossBorderFeeCny
  );

  const targetSalePriceCny = solveSalePriceCny({
    fixedCostsCny,
    commissionRate: normalizedInput.commissionRate,
    marginRate: normalizedInput.targetMarginRate,
    adRate: normalizedInput.adRate,
    otherRate: normalizedInput.otherRate,
    cnyToRubRate: normalizedInput.cnyToRubRate
  });

  if (!targetSalePriceCny) {
    return {
      tariff,
      mode: tariff.mode,
      valid: false,
      reason: text("pricing_invalidMarginRate", "当前毛利和费率过高，无法求得有效售价。")
    };
  }

  if (targetSalePriceCny > tariff.valueMaxCny) {
    return {
      tariff,
      mode: tariff.mode,
      valid: false,
      reason: buildInvalidPriceBandReason(targetSalePriceCny, tariff)
    };
  }

  const salePriceCny = roundTo(Math.max(targetSalePriceCny, tariff.valueMinCny));
  const salePriceRub = roundTo(salePriceCny * normalizedInput.cnyToRubRate);
  const lastMileFeeCny = computeLastMileFeeCny(salePriceCny, normalizedInput.cnyToRubRate);
  const commissionFeeCny = roundTo(salePriceCny * normalizedInput.commissionRate);
  const adFeeCny = roundTo(salePriceCny * normalizedInput.adRate);
  const otherFeeCny = roundTo(salePriceCny * normalizedInput.otherRate);
  const grossProfitCny = roundTo(
    salePriceCny -
      fixedCostsCny -
      lastMileFeeCny -
      commissionFeeCny -
      adFeeCny -
      otherFeeCny
  );
  const grossMarginRate = salePriceCny > 0
    ? roundTo(grossProfitCny / salePriceCny * 100, 2)
    : 0;
  const strikethroughPriceCny = normalizedInput.frontDiscountRate < 1
    ? roundTo(salePriceCny / (1 - normalizedInput.frontDiscountRate))
    : salePriceCny;

  return {
    tariff,
    mode: tariff.mode,
    valid: true,
    effectiveWeightKg,
    autoRaisedWeight: weightResolution.autoRaised,
    originalWeightKg: weightResolution.originalWeightKg,
    billableWeightKg,
    crossBorderFeeCny,
    salePriceCny,
    targetSalePriceCny,
    priceRaisedToValueBand: salePriceCny > targetSalePriceCny,
    salePriceRub,
    salePriceUsd: roundTo(salePriceCny * normalizedInput.cnyToUsdRate),
    strikethroughPriceCny,
    strikethroughPriceRub: roundTo(strikethroughPriceCny * normalizedInput.cnyToRubRate),
    strikethroughPriceUsd: roundTo(strikethroughPriceCny * normalizedInput.cnyToUsdRate),
    lastMileFeeCny,
    commissionFeeCny,
    otherFeeCny,
    adFeeCny,
    grossProfitCny,
    grossMarginRate,
    batteryNote: tariff.batteryNote
  };
}

export function calculatePricing(input = {}) {
  const normalizedInput = buildNormalizedInput(input);
  const candidates = GUOO_REAL_FBS_TARIFFS.map((tariff) => computeCandidate(tariff, normalizedInput));
  const validCandidates = candidates.filter((candidate) => candidate.valid);

  const bestByMode = ["express", "standard", "economy"].map((mode) => {
    const validInMode = validCandidates
      .filter((candidate) => candidate.mode === mode)
      .sort((left, right) => left.salePriceCny - right.salePriceCny);
    const invalidInMode = candidates.filter((candidate) => candidate.mode === mode && !candidate.valid);
    return {
      mode,
      best: validInMode[0] || null,
      invalidReasons: invalidInMode.map((item) => item.reason).filter(Boolean)
    };
  });

  const preferredMode = normalizedInput.preferredMode;
  const selected =
    preferredMode && preferredMode !== "auto"
      ? bestByMode.find((item) => item.mode === preferredMode)?.best || null
      : [...validCandidates].sort((left, right) => left.salePriceCny - right.salePriceCny)[0] || null;

  return {
    bestByMode,
    selected
  };
}

export function formatMoney(value, currency = "CNY", digits = 2) {
  const symbol = currency === "RUB" ? "₽" : currency === "USD" ? "$" : "¥";
  return `${symbol}${roundTo(value, digits).toFixed(digits)}`;
}

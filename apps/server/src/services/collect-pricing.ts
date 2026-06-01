import { convertAmountToCny } from './exchange-rate.js';
import { detectCurrencyFromPriceText, normalizePriceText } from './price-currency.js';

export interface ResolvedPrice {
  purchasePriceCny: number | null;
  originalPrice: number | null;
  originalCurrency: string | null;
  exchangeRateUsed: number | null;
  needsReview: boolean;
}

/**
 * 采集来的价格按汇率转换 CNY，并保留原始数据。
 *
 * 币种判断规则（保守原则，不靠 URL 猜）：
 * - 扩展显式传 currency='RUB' / 'USD' 等非 CNY → 按汇率换算成 CNY 存
 * - 扩展未传 currency 或传 'CNY' → 视为 CNY，原值入库（不换算）
 */
export async function resolveCollectedPrice(
  rawPrice: string | undefined,
  declaredCurrency: string | undefined,
  _sourceUrl: string | undefined,
): Promise<ResolvedPrice> {
  if (!rawPrice) {
    return { purchasePriceCny: null, originalPrice: null, originalCurrency: null, exchangeRateUsed: null, needsReview: false };
  }
  const normalizedPrice = normalizePriceText(rawPrice);
  const raw = normalizedPrice ? parseFloat(normalizedPrice) : parseFloat(rawPrice);
  if (!Number.isFinite(raw) || raw <= 0) {
    return { purchasePriceCny: null, originalPrice: null, originalCurrency: null, exchangeRateUsed: null, needsReview: false };
  }

  const currency = detectCurrencyFromPriceText(rawPrice, declaredCurrency);

  if (currency === 'CNY') {
    return { purchasePriceCny: raw, originalPrice: null, originalCurrency: null, exchangeRateUsed: null, needsReview: false };
  }

  const { amountCny, rate, source } = await convertAmountToCny(raw, currency, new Date());
  return {
    purchasePriceCny: amountCny,
    originalPrice: raw,
    originalCurrency: currency,
    exchangeRateUsed: rate,
    needsReview: source === 'fallback' || source === 'unknown_currency',
  };
}

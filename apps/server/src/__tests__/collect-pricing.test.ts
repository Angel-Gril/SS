import { describe, expect, it } from 'vitest';
import { resolveCollectedPrice } from '../services/collect-pricing.js';
import { detectCurrencyFromPriceText, normalizePriceText } from '../services/price-currency.js';

describe('collect pricing', () => {
  it('detects CNY from Ozon price text before trusting declared RUB', async () => {
    await expect(resolveCollectedPrice('50,16 ¥', 'RUB', undefined)).resolves.toMatchObject({
      purchasePriceCny: 50.16,
      originalPrice: null,
      originalCurrency: null,
      exchangeRateUsed: null,
    });
  });

  it('keeps numeric CNY values when declared currency is CNY', async () => {
    await expect(resolveCollectedPrice('50.16', 'CNY', undefined)).resolves.toMatchObject({
      purchasePriceCny: 50.16,
      originalCurrency: null,
    });
  });

  it('supports CNY text aliases from Ozon disclaimers and translated pages', () => {
    expect(detectCurrencyFromPriceText('50.16 CNY', 'RUB')).toBe('CNY');
    expect(detectCurrencyFromPriceText('￥50.16', 'RUB')).toBe('CNY');
    expect(detectCurrencyFromPriceText('50.16 RMB', 'RUB')).toBe('CNY');
    expect(detectCurrencyFromPriceText('Итого в CNY', 'RUB')).toBe('CNY');
  });

  it('normalizes decimal comma and keeps decimal fractions', () => {
    expect(normalizePriceText('50,16 ¥')).toBe('50.16');
    expect(normalizePriceText('1 234,56 BYN')).toBe('1234.56');
    expect(normalizePriceText('12 345 ₸')).toBe('12345');
  });
});

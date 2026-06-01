export function detectCurrencyFromPriceText(text: string | undefined, fallbackCurrency?: string): string {
  const raw = String(text || '');
  if (/[¥￥]/.test(raw) || /\b(?:CNY|RMB)\b/i.test(raw) || raw.includes('人民币')) return 'CNY';
  if (raw.includes('₽') || /\bRUB\b/i.test(raw) || /(?:^|[\s\d])руб\.?/i.test(raw)) return 'RUB';
  if (raw.includes('₸') || /\bKZT\b/i.test(raw) || /тенге/i.test(raw)) return 'KZT';
  if (/\bBYN\b/i.test(raw)) return 'BYN';
  if (raw.includes('$') || /\bUSD\b/i.test(raw)) return 'USD';
  if (raw.includes('€') || /\bEUR\b/i.test(raw)) return 'EUR';
  return (fallbackCurrency || 'CNY').toUpperCase() === 'RMB' ? 'CNY' : (fallbackCurrency || 'CNY').toUpperCase();
}

export function normalizePriceText(text: string | number | undefined): string | null {
  if (text == null) return null;
  const match = String(text)
    .replace(/[\u00a0\u202f]/g, ' ')
    .match(/[-+]?\d[\d\s.,']*/);
  if (!match) return null;

  let value = match[0].replace(/[\s']/g, '');
  if (!value || !/\d/.test(value)) return null;

  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    value = comma > dot ? value.replace(/\./g, '').replace(',', '.') : value.replace(/,/g, '');
  } else if (comma >= 0) {
    const decimals = value.length - comma - 1;
    value = decimals > 0 && decimals <= 2 ? value.replace(',', '.') : value.replace(/,/g, '');
  } else if (dot >= 0) {
    const decimals = value.length - dot - 1;
    if (!(decimals > 0 && decimals <= 2)) value = value.replace(/\./g, '');
  }

  return Number.isFinite(Number(value)) ? value : null;
}

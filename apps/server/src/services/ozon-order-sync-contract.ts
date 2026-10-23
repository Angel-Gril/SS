import type { OzonClient, OzonPosting } from './ozon-client.js';

export function normalizeV4Posting(posting: any): OzonPosting {
  if (!posting || !Array.isArray(posting.products)) throw new Error('Ozon posting products response is invalid');
  const products = posting.products.map((product: any) => {
    const money = product.price;
    if (!money || typeof money.amount !== 'string' || !/^\d+(?:\.\d+)?$/.test(money.amount)
      || !Number.isFinite(Number(money.amount)) || !/^[A-Z]{3}$/.test(money.currency)) {
      throw new Error('Ozon posting price amount/currency is invalid');
    }
    if (!Number.isSafeInteger(product.quantity) || product.quantity <= 0) throw new Error('Ozon posting quantity is invalid');
    return { ...product, price: money.amount, currency_code: money.currency };
  });
  return { ...posting, products };
}

export async function* iterateOzonPostingPages(
  client: Pick<OzonClient, 'getPostingsList'>,
  since: string,
  to: string,
): AsyncGenerator<OzonPosting[]> {
  const start = Date.parse(since);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) throw new Error('订单同步日期范围无效');
  const chunkMs = 30 * 24 * 3600 * 1000;
  for (let from = start; from < end; from += chunkMs) {
    let cursor = '';
    const seen = new Set<string>();
    for (let pages = 0; ; pages++) {
      if (pages >= 10_000) throw new Error('Ozon order pagination exceeded page limit');
      const result = await client.getPostingsList({
        sort_dir: 'DESC', filter: { since: new Date(from).toISOString(), to: new Date(Math.min(from + chunkMs, end)).toISOString() },
        cursor, limit: 50, with: { analytics_data: false, financial_data: false },
      });
      if (result.has_next && (!result.cursor || seen.has(result.cursor) || !result.postings.length)) {
        throw new Error('Ozon order pagination cursor did not advance');
      }
      if (result.postings.length) yield result.postings;
      if (!result.has_next) break;
      cursor = result.cursor;
      seen.add(cursor);
    }
  }
}

export async function calculateOzonOrderTotalRub(
  products: Array<{ price: string; quantity: number; currency_code?: string }>, date: Date,
  rates = new Map<string, number>(),
  resolveRate: (currency: string, date: Date) => Promise<{ rate: number; source: string }>
    = async (currency, date) => (await import('./exchange-rate.js')).getRate(currency, date),
): Promise<number> {
  const rateFor = async (currency: string) => {
    if (rates.has(currency)) return rates.get(currency)!;
    const value = await resolveRate(currency, date);
    if (value.source === 'unknown_currency' || !Number.isFinite(value.rate) || value.rate <= 0) {
      throw new Error(`Ozon order exchange rate is unavailable: ${currency}`);
    }
    rates.set(currency, value.rate);
    return value.rate;
  };
  let total = 0;
  for (const product of products) {
    const price = Number(product.price);
    if (!Number.isFinite(price) || price < 0 || !Number.isSafeInteger(product.quantity) || product.quantity <= 0) {
      throw new Error('Ozon order price/quantity is invalid');
    }
    const currency = product.currency_code || 'RUB';
    const rate = currency === 'RUB' ? 1 : await rateFor(currency) / await rateFor('RUB');
    total += price * product.quantity * rate;
  }
  if (!Number.isFinite(total)) throw new Error('Ozon order total amount is invalid');
  return Math.round(total * 100) / 100;
}

import { prisma } from '../lib/prisma.js';

const PROXY_URL =
  process.env.HTTPS_PROXY || process.env.https_proxy ||
  process.env.HTTP_PROXY || process.env.http_proxy ||
  process.env.ALL_PROXY || process.env.all_proxy || '';

let proxyDispatcher: any;
async function getHttpFetch(): Promise<typeof globalThis.fetch> {
  if (!PROXY_URL) return globalThis.fetch;
  if (!proxyDispatcher) {
    const { ProxyAgent, fetch: undiciFetch } = await import('undici');
    proxyDispatcher = new ProxyAgent(PROXY_URL);
    return ((url: any, init: any) => undiciFetch(url, { ...init, dispatcher: proxyDispatcher })) as any;
  }
  const { fetch: undiciFetch } = await import('undici');
  return ((url: any, init: any) => undiciFetch(url, { ...init, dispatcher: proxyDispatcher })) as any;
}

// 兜底汇率（更接近 2026 年实时市场汇率，仅在汇率服务全部失败时使用）
const FALLBACK_RATES: Record<string, number> = {
  RUB: 0.095,
  USD: 7.1,
  EUR: 7.7,
  KZT: 0.014,
  BYN: 2.2,
};

// 进程级 lazy fetch 节流：避免循环里每条记录都触发外部 API
// - 5 分钟窗口内不重复拉
// - 同一时刻并发请求共享同一个 in-flight Promise
let lastLazyFetchAt = 0;
let inflightLazyFetch: Promise<number> | null = null;
const LAZY_FETCH_MIN_INTERVAL_MS = 5 * 60 * 1000;

async function lazyFetchOnce(): Promise<number | null> {
  const now = Date.now();
  if (now - lastLazyFetchAt < LAZY_FETCH_MIN_INTERVAL_MS && !inflightLazyFetch) {
    return null;
  }
  if (!inflightLazyFetch) {
    inflightLazyFetch = fetchAndStoreRates('CNY')
      .then((n) => { lastLazyFetchAt = Date.now(); return n; })
      .catch((e) => { lastLazyFetchAt = Date.now(); throw e; })
      .finally(() => { inflightLazyFetch = null; });
  }
  try { return await inflightLazyFetch; } catch { return null; }
}

/**
 * 从免费 API 拉取当日汇率并入库
 * 数据源：open.er-api.com（无需 API key，每日更新）
 */
export async function fetchAndStoreRates(baseCurrency = 'CNY'): Promise<number> {
  const httpFetch = await getHttpFetch();
  const url = `https://open.er-api.com/v6/latest/${baseCurrency}`;
  const res = await httpFetch(url, { method: 'GET' });
  if (!res.ok) throw new Error(`Exchange rate API returned ${res.status}`);

  const data = await res.json() as {
    result: string;
    rates: Record<string, number>;
    time_last_update_utc: string;
  };
  if (data.result !== 'success') throw new Error(`Exchange rate API error: ${data.result}`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const targetCurrencies = ['RUB', 'USD', 'EUR', 'KZT', 'BYN', 'TRY', 'UZS'];
  let stored = 0;

  for (const cur of targetCurrencies) {
    const rateFromBase = data.rates[cur];
    if (!rateFromBase || rateFromBase === 0) continue;
    // API 返回 1 CNY = X RUB，我们要存 1 RUB = ? CNY
    const rateToCny = 1 / rateFromBase;

    await prisma.exchangeRate.upsert({
      where: {
        date_fromCurrency_toCurrency: {
          date: today,
          fromCurrency: cur,
          toCurrency: 'CNY',
        },
      },
      update: { rate: rateToCny, source: 'open.er-api.com', fetchedAt: new Date() },
      create: {
        date: today,
        fromCurrency: cur,
        toCurrency: 'CNY',
        rate: rateToCny,
        source: 'open.er-api.com',
        fetchedAt: new Date(),
      },
    });
    stored++;
  }

  console.log(`[ExchangeRate] Stored ${stored} rates for ${today.toISOString().slice(0, 10)}`);
  return stored;
}

/**
 * 获取指定日期的汇率（fromCurrency -> CNY）
 * 优先级：当日记录 → 7 天内记录 → lazy 拉取实时汇率 → 兜底常量
 */
export async function getRate(fromCurrency: string, date: Date): Promise<{ rate: number; source: string }> {
  if (fromCurrency === 'CNY') return { rate: 1, source: 'identity' };

  const d = new Date(date);
  d.setHours(0, 0, 0, 0);

  // 向前查 7 天
  const sevenDaysAgo = new Date(d);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let record = await prisma.exchangeRate.findFirst({
    where: {
      fromCurrency: fromCurrency.toUpperCase(),
      toCurrency: 'CNY',
      date: { gte: sevenDaysAgo, lte: d },
    },
    orderBy: { date: 'desc' },
  });

  if (record) return { rate: Number(record.rate), source: record.source };

  // lazy fetch（节流：5 分钟内不重复拉外部 API）
  // 拉到今天的汇率后，查最近一条记录兜底（哪怕日期不在原 7 天窗口内）
  const fetched = await lazyFetchOnce();
  if (fetched !== null && fetched > 0) {
    record = await prisma.exchangeRate.findFirst({
      where: {
        fromCurrency: fromCurrency.toUpperCase(),
        toCurrency: 'CNY',
      },
      orderBy: { date: 'desc' },
    });
    if (record) return { rate: Number(record.rate), source: record.source };
  }

  const fallback = FALLBACK_RATES[fromCurrency.toUpperCase()];
  if (fallback) return { rate: fallback, source: 'fallback' };

  return { rate: 1, source: 'unknown_currency' };
}

/**
 * 将金额按指定日期汇率转换为 CNY
 */
export async function convertAmountToCny(
  amount: number | string,
  fromCurrency: string,
  date: Date,
): Promise<{ amountCny: number; rate: number; source: string }> {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  if (!Number.isFinite(num)) return { amountCny: 0, rate: 1, source: 'invalid' };
  if (fromCurrency === 'CNY') return { amountCny: num, rate: 1, source: 'identity' };

  const { rate, source } = await getRate(fromCurrency, date);
  return { amountCny: Math.round(num * rate * 100) / 100, rate, source };
}

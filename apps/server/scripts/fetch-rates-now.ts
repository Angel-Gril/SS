/**
 * 手动触发拉取今日汇率（首次使用 / 测试用）
 *
 * 用法：cd apps/server && npx tsx scripts/fetch-rates-now.ts
 */
import { fetchAndStoreRates, getRate } from '../src/services/exchange-rate.js';
import { prisma } from '../src/lib/prisma.js';

async function main() {
  try {
    console.log('Fetching latest rates from open.er-api.com...');
    const stored = await fetchAndStoreRates('CNY');
    console.log(`Stored ${stored} rates`);

    const rub = await getRate('RUB', new Date());
    const usd = await getRate('USD', new Date());
    console.log(`Today RUB → CNY: ${rub.rate} (source: ${rub.source})`);
    console.log(`Today USD → CNY: ${usd.rate} (source: ${usd.source})`);
  } catch (e) {
    console.error('Failed:', (e as Error).message);
    console.log('\n如果是网络/代理问题，将使用兜底汇率 RUB=0.095');
  }
  await prisma.$disconnect();
}

main();

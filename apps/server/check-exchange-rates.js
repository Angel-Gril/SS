import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('📊 检查汇率数据...\n');

  // 查看最近的汇率记录
  const rates = await prisma.exchangeRate.findMany({
    orderBy: { date: 'desc' },
    take: 10
  });

  if (rates.length === 0) {
    console.log('❌ 数据库中没有汇率记录！');
    console.log('需要先运行汇率同步：');
    console.log('  import { fetchAndStoreRates } from "./src/services/exchange-rate.js";');
    console.log('  await fetchAndStoreRates("CNY");');
  } else {
    console.log('✅ 汇率记录：');
    console.table(rates.map(r => ({
      日期: r.date.toISOString().slice(0, 10),
      货币: `${r.fromCurrency} → ${r.toCurrency}`,
      汇率: r.rate.toString(),
      来源: r.source
    })));
  }

  // 测试汇率换算
  console.log('\n🧪 测试换算 38 USD → RUB：');
  const { getRate } = await import('./src/services/exchange-rate.js');
  
  const usdToCny = await getRate('USD', new Date());
  console.log(`  USD → CNY: ${usdToCny.rate} (${usdToCny.source})`);
  
  const rubToCny = await getRate('RUB', new Date());
  console.log(`  RUB → CNY: ${rubToCny.rate} (${rubToCny.source})`);
  
  const priceInCny = 38 * usdToCny.rate;
  const priceInRub = priceInCny / rubToCny.rate;
  
  console.log(`\n  38 USD × ${usdToCny.rate} = ${priceInCny.toFixed(2)} CNY`);
  console.log(`  ${priceInCny.toFixed(2)} CNY ÷ ${rubToCny.rate} = ${priceInRub.toFixed(2)} RUB`);
  console.log(`  显示：¥${(priceInRub * rubToCny.rate).toFixed(2)}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

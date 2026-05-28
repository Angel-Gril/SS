import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🔧 直接修复订单金额...\n');

  // 获取所有需要修复的订单
  const orders = await prisma.order.findMany({
    where: {
      currency: 'RUB',
      totalAmount: { lt: 1000 } // 金额小于 1000 的可能是错误的
    },
    select: {
      id: true,
      postingNumber: true,
      totalAmount: true,
      items: true
    },
    take: 10
  });

  console.log(`找到 ${orders.length} 个可能需要修复的订单\n`);

  // 获取汇率
  const usdRate = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'USD', toCurrency: 'CNY' },
    orderBy: { date: 'desc' }
  });

  const cnyRate = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'CNY', toCurrency: 'CNY' },
    orderBy: { date: 'desc' }
  });

  const rubRate = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'RUB', toCurrency: 'CNY' },
    orderBy: { date: 'desc' }
  });

  let fixed = 0;

  for (const order of orders) {
    const items = Array.isArray(order.items) ? order.items : [];
    if (items.length === 0) continue;

    let newTotal = 0;
    for (const item of items) {
      const price = parseFloat(item.price);
      const currencyCode = item.currency_code?.toUpperCase() || 'RUB';
      const quantity = item.quantity || 1;

      let priceInRub = price;
      if (currencyCode === 'USD' && usdRate && rubRate) {
        const priceInCny = price * parseFloat(usdRate.rate.toString());
        priceInRub = priceInCny / parseFloat(rubRate.rate.toString());
      } else if (currencyCode === 'CNY' && cnyRate && rubRate) {
        priceInRub = price / parseFloat(rubRate.rate.toString());
      }

      newTotal += priceInRub * quantity;
    }

    newTotal = Math.round(newTotal * 100) / 100;

    if (Math.abs(newTotal - parseFloat(order.totalAmount.toString())) > 1) {
      console.log(`订单 ${order.postingNumber}:`);
      console.log(`  旧金额: ${order.totalAmount} RUB`);
      console.log(`  新金额: ${newTotal} RUB`);

      await prisma.order.update({
        where: { id: order.id },
        data: { totalAmount: newTotal }
      });

      fixed++;
    }
  }

  console.log(`\n✅ 修复了 ${fixed} 个订单`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

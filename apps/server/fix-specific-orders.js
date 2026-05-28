import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🔧 修复指定订单...\n');

  const targetOrders = ['0189126155-0078-1', '12973744-0214-1'];

  // 获取汇率
  const usdRate = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'USD', toCurrency: 'CNY' },
    orderBy: { date: 'desc' }
  });

  const rubRate = await prisma.exchangeRate.findFirst({
    where: { fromCurrency: 'RUB', toCurrency: 'CNY' },
    orderBy: { date: 'desc' }
  });

  console.log('汇率:');
  console.log(`  USD → CNY: ${usdRate.rate}`);
  console.log(`  RUB → CNY: ${rubRate.rate}\n`);

  for (const postingNumber of targetOrders) {
    const order = await prisma.order.findFirst({
      where: { postingNumber },
      select: {
        id: true,
        postingNumber: true,
        totalAmount: true,
        items: true
      }
    });

    if (!order) {
      console.log(`❌ 订单 ${postingNumber} 不存在`);
      continue;
    }

    const items = Array.isArray(order.items) ? order.items : [];
    if (items.length === 0) continue;

    let newTotal = 0;
    for (const item of items) {
      const price = parseFloat(item.price);
      const currencyCode = item.currency_code?.toUpperCase() || 'RUB';
      const quantity = item.quantity || 1;

      console.log(`  商品: ${item.name?.substring(0, 30)}...`);
      console.log(`    原价格: ${price} ${currencyCode}`);

      let priceInRub = price;
      if (currencyCode === 'USD' && usdRate && rubRate) {
        const priceInCny = price * parseFloat(usdRate.rate.toString());
        priceInRub = priceInCny / parseFloat(rubRate.rate.toString());
        console.log(`    换算: ${price} USD × ${usdRate.rate} ÷ ${rubRate.rate} = ${priceInRub.toFixed(2)} RUB`);
      }

      newTotal += priceInRub * quantity;
    }

    newTotal = Math.round(newTotal * 100) / 100;

    console.log(`\n订单 ${postingNumber}:`);
    console.log(`  旧金额: ${order.totalAmount} RUB`);
    console.log(`  新金额: ${newTotal} RUB`);

    await prisma.order.update({
      where: { id: order.id },
      data: { totalAmount: newTotal }
    });

    console.log(`  ✅ 已更新\n`);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

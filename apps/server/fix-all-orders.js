import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🔧 批量修复所有订单金额...\n');

  // 获取汇率
  const rates = await prisma.exchangeRate.findMany({
    where: {
      toCurrency: 'CNY',
      fromCurrency: { in: ['USD', 'CNY', 'RUB', 'EUR', 'KZT', 'BYN'] }
    },
    orderBy: { date: 'desc' }
  });

  const rateMap = new Map();
  for (const r of rates) {
    if (!rateMap.has(r.fromCurrency)) {
      rateMap.set(r.fromCurrency, parseFloat(r.rate.toString()));
    }
  }

  console.log('汇率表:');
  rateMap.forEach((rate, currency) => {
    console.log(`  ${currency} → CNY: ${rate}`);
  });

  const rubToCny = rateMap.get('RUB') || 0.0945;

  // 获取所有 RUB 订单
  const orders = await prisma.order.findMany({
    where: { currency: 'RUB' },
    select: {
      id: true,
      postingNumber: true,
      totalAmount: true,
      items: true
    }
  });

  console.log(`\n找到 ${orders.length} 个订单\n`);

  let fixed = 0;
  let skipped = 0;

  for (const order of orders) {
    const items = Array.isArray(order.items) ? order.items : [];
    if (items.length === 0) {
      skipped++;
      continue;
    }

    let newTotal = 0;
    for (const item of items) {
      const price = parseFloat(item.price);
      const currencyCode = item.currency_code?.toUpperCase() || 'RUB';
      const quantity = item.quantity || 1;

      let priceInRub = price;
      if (currencyCode !== 'RUB') {
        const rateToCny = rateMap.get(currencyCode);
        if (rateToCny) {
          const priceInCny = price * rateToCny;
          priceInRub = priceInCny / rubToCny;
        }
      }

      newTotal += priceInRub * quantity;
    }

    newTotal = Math.round(newTotal * 100) / 100;

    // 只更新差异大于 10 RUB 的订单（避免误更新）
    if (Math.abs(newTotal - parseFloat(order.totalAmount.toString())) > 10) {
      await prisma.order.update({
        where: { id: order.id },
        data: { totalAmount: newTotal }
      });
      fixed++;

      if (fixed <= 5) {
        console.log(`${order.postingNumber}: ${order.totalAmount} → ${newTotal} RUB`);
      }
    } else {
      skipped++;
    }
  }

  console.log(`\n✅ 修复了 ${fixed} 个订单`);
  console.log(`⏭️  跳过了 ${skipped} 个订单（金额正确或无商品）`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

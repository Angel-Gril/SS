import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🔧 正确修复所有订单金额...\n');

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

  const rubToCny = rateMap.get('RUB') || 0.0945;

  console.log('汇率表:');
  console.log(`  USD → CNY: ${rateMap.get('USD')}`);
  console.log(`  CNY → CNY: 1`);
  console.log(`  RUB → CNY: ${rubToCny}`);
  console.log('');

  console.log('换算逻辑:');
  console.log(`  USD: price × ${rateMap.get('USD')} ÷ ${rubToCny} = RUB`);
  console.log(`  CNY: price × 1 ÷ ${rubToCny} = RUB`);
  console.log(`  RUB: price (不变)`);
  console.log('');

  // 测试几个例子
  console.log('测试:');
  console.log(`  38 USD = 38 × ${rateMap.get('USD')} ÷ ${rubToCny} = ${(38 * rateMap.get('USD') / rubToCny).toFixed(2)} RUB`);
  console.log(`  200 CNY = 200 × 1 ÷ ${rubToCny} = ${(200 / rubToCny).toFixed(2)} RUB`);
  console.log('');

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

  console.log(`找到 ${orders.length} 个订单，开始修复...\n`);

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
      if (currencyCode === 'RUB') {
        priceInRub = price;
      } else if (currencyCode === 'CNY') {
        // CNY → RUB: CNY ÷ rubToCny
        priceInRub = price / rubToCny;
      } else {
        // 其他货币 → CNY → RUB
        const rateToCny = rateMap.get(currencyCode);
        if (rateToCny) {
          const priceInCny = price * rateToCny;
          priceInRub = priceInCny / rubToCny;
        }
      }

      newTotal += priceInRub * quantity;
    }

    newTotal = Math.round(newTotal * 100) / 100;

    await prisma.order.update({
      where: { id: order.id },
      data: { totalAmount: newTotal }
    });
    
    fixed++;

    if (fixed <= 5) {
      console.log(`${order.postingNumber}: ${order.totalAmount} → ${newTotal} RUB`);
    }
  }

  console.log(`\n✅ 修复了 ${fixed} 个订单`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

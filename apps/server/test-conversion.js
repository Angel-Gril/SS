import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🧪 测试汇率换算逻辑...\n');

  // 模拟 OZON API 返回的商品数据
  const product = {
    price: '38.0000',
    currency_code: 'USD',
    quantity: 1
  };

  console.log('输入数据:');
  console.log(`  价格: ${product.price} ${product.currency_code}`);
  console.log(`  数量: ${product.quantity}`);

  // 查询汇率
  const usdRate = await prisma.exchangeRate.findFirst({
    where: {
      fromCurrency: 'USD',
      toCurrency: 'CNY'
    },
    orderBy: { date: 'desc' }
  });

  const rubRate = await prisma.exchangeRate.findFirst({
    where: {
      fromCurrency: 'RUB',
      toCurrency: 'CNY'
    },
    orderBy: { date: 'desc' }
  });

  if (!usdRate || !rubRate) {
    console.log('❌ 汇率数据不存在');
    return;
  }

  console.log('\n汇率数据:');
  console.log(`  USD → CNY: ${usdRate.rate}`);
  console.log(`  RUB → CNY: ${rubRate.rate}`);

  // 计算换算
  const price = parseFloat(product.price);
  const priceInCny = price * parseFloat(usdRate.rate.toString());
  const priceInRub = priceInCny / parseFloat(rubRate.rate.toString());

  console.log('\n换算过程:');
  console.log(`  ${price} USD × ${usdRate.rate} = ${priceInCny.toFixed(2)} CNY`);
  console.log(`  ${priceInCny.toFixed(2)} CNY ÷ ${rubRate.rate} = ${priceInRub.toFixed(2)} RUB`);

  console.log('\n最终结果:');
  console.log(`  订单金额: ${priceInRub.toFixed(2)} RUB`);
  console.log(`  显示为: ¥${priceInCny.toFixed(2)} (≈ RUB ${priceInRub.toFixed(2)})`);

  console.log('\n✅ 如果显示 ¥258 (≈ RUB 2732)，说明逻辑正确');
  console.log('❌ 如果显示 ¥3.61 (≈ RUB 38)，说明没有使用汇率换算');
}

main().catch(console.error).finally(() => prisma.$disconnect());

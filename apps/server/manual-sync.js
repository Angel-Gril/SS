import { PrismaClient } from '@prisma/client';
import { OzonClient } from './dist/ozon-client-2BPHZWWC.js';
import { getRate } from './dist/chunk-HW622KYW.js';

const prisma = new PrismaClient();

async function syncOneOrder() {
  console.log('🔄 手动同步订单 0189126155-0078-1...\n');

  // 获取店铺信息
  const shop = await prisma.shop.findFirst({
    where: { platform: 'OZON', status: 'ACTIVE' }
  });

  if (!shop) {
    console.log('❌ 没有找到活跃的 OZON 店铺');
    return;
  }

  console.log(`✅ 使用店铺: ${shop.name}`);

  // 模拟 OZON API 返回的数据
  const posting = {
    order_id: 189126155,
    posting_number: '0189126155-0078-1',
    status: 'awaiting_packaging',
    substatus: 'posting_created',
    in_process_at: '2026-05-28T05:39:00Z',
    products: [{
      sku: 3246406056,
      name: 'Кроссовки GEL-NYC',
      price: '38.0000',
      quantity: 1,
      offer_id: 'ZZ321-42',
      currency_code: 'USD'
    }]
  };

  console.log('\n商品信息:');
  console.log(`  价格: ${posting.products[0].price} ${posting.products[0].currency_code}`);

  // 计算换算后的金额
  const orderDate = new Date(posting.in_process_at);
  const price = parseFloat(posting.products[0].price);
  const currencyCode = posting.products[0].currency_code;

  console.log('\n汇率换算:');
  const { rate: usdToCny } = await getRate(currencyCode, orderDate);
  console.log(`  ${currencyCode} → CNY: ${usdToCny}`);

  const priceInCny = price * usdToCny;
  console.log(`  ${price} ${currencyCode} × ${usdToCny} = ${priceInCny.toFixed(2)} CNY`);

  const { rate: rubToCny } = await getRate('RUB', orderDate);
  console.log(`  RUB → CNY: ${rubToCny}`);

  const priceInRub = priceInCny / rubToCny;
  console.log(`  ${priceInCny.toFixed(2)} CNY ÷ ${rubToCny} = ${priceInRub.toFixed(2)} RUB`);

  // 更新订单
  await prisma.order.update({
    where: {
      shopId_platformOrderId: {
        shopId: shop.id,
        platformOrderId: String(posting.order_id)
      }
    },
    data: {
      totalAmount: Math.round(priceInRub * 100) / 100,
      currency: 'RUB'
    }
  });

  console.log(`\n✅ 订单已更新: ${priceInRub.toFixed(2)} RUB`);
  console.log(`   显示为: ¥${(priceInRub * rubToCny).toFixed(2)}`);
}

syncOneOrder().catch(console.error).finally(() => prisma.$disconnect());

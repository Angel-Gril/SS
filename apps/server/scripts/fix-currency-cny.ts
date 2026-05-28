/**
 * 一次性脚本：把所有 OZON 订单/退货/产品的 currency 字段从 RUB 改成 CNY
 *
 * 背景：之前 order-sync worker 错误地把 currency 写成 'RUB'，但 OZON API
 * 对中国卖家返回的 price 字段已经是 CNY 单位（合同货币）。
 *
 * 用法：cd apps/server && npx tsx scripts/fix-currency-cny.ts
 */
import { prisma } from '../src/lib/prisma.js';

async function main() {
  // 只修复 OZON 平台的订单（其他平台保持原样）
  const ozonShops = await prisma.shop.findMany({
    where: { platform: 'OZON' },
    select: { id: true, name: true },
  });

  console.log(`Found ${ozonShops.length} OZON shops`);

  let totalOrders = 0;
  let totalReturns = 0;
  let totalProducts = 0;

  for (const shop of ozonShops) {
    const orderRes = await prisma.order.updateMany({
      where: { shopId: shop.id, currency: 'RUB' },
      data: { currency: 'CNY' },
    });
    const returnRes = await prisma.return.updateMany({
      where: { shopId: shop.id, currency: 'RUB' },
      data: { currency: 'CNY' },
    });
    const productRes = await prisma.product.updateMany({
      where: { shopId: shop.id, currency: 'RUB' },
      data: { currency: 'CNY' },
    });

    console.log(
      `  ${shop.name}: orders=${orderRes.count} returns=${returnRes.count} products=${productRes.count}`,
    );
    totalOrders += orderRes.count;
    totalReturns += returnRes.count;
    totalProducts += productRes.count;
  }

  console.log(`\nTotal: orders=${totalOrders} returns=${totalReturns} products=${totalProducts}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

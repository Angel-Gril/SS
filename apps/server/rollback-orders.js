import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('⚠️  检查修复结果...\n');

  // 检查几个订单
  const samples = await prisma.order.findMany({
    where: {
      postingNumber: { in: ['0189126155-0078-1', '0144872105-0130-1', '77597255-0449-1'] }
    },
    select: {
      postingNumber: true,
      totalAmount: true,
      items: true
    }
  });

  for (const order of samples) {
    console.log(`订单 ${order.postingNumber}:`);
    console.log(`  当前金额: ${order.totalAmount} RUB`);
    
    const items = Array.isArray(order.items) ? order.items : [];
    if (items.length > 0) {
      const item = items[0];
      console.log(`  商品价格: ${item.price} ${item.currency_code}`);
    }
    console.log('');
  }

  console.log('❌ 如果金额变小了（如 2105 → 200），说明换算方向错了');
  console.log('✅ 如果金额变大了（如 38 → 2732），说明换算正确');
}

main().catch(console.error).finally(() => prisma.$disconnect());

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('📦 检查订单同步状态...\n');

  // 查看最近更新的订单
  const recentOrders = await prisma.order.findMany({
    where: { postingNumber: { in: ['0189126155-0078-1', '12973744-0214-1'] } },
    select: {
      postingNumber: true,
      totalAmount: true,
      currency: true,
      updatedAt: true,
      items: true
    }
  });

  console.log('订单详情：');
  recentOrders.forEach(o => {
    console.log(`\n订单号: ${o.postingNumber}`);
    console.log(`金额: ${o.totalAmount} ${o.currency}`);
    console.log(`更新时间: ${o.updatedAt.toISOString()}`);
    
    const items = Array.isArray(o.items) ? o.items : [];
    if (items.length > 0) {
      const item = items[0];
      console.log(`商品价格: ${item.price} (currency_code: ${item.currency_code})`);
    }
  });

  console.log('\n\n💡 如果更新时间是几分钟前，说明同步成功了');
  console.log('   如果金额还是 38，说明代码逻辑有问题');
}

main().catch(console.error).finally(() => prisma.$disconnect());

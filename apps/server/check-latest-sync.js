import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // 查看最近更新的订单
  const order = await prisma.order.findFirst({
    where: { postingNumber: '0189126155-0078-1' },
    select: {
      postingNumber: true,
      totalAmount: true,
      currency: true,
      updatedAt: true,
      items: true
    }
  });

  console.log('订单 0189126155-0078-1:');
  console.log(`金额: ${order.totalAmount} ${order.currency}`);
  console.log(`更新时间: ${order.updatedAt.toISOString()}`);
  
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length > 0) {
    const item = items[0];
    console.log(`\n商品信息:`);
    console.log(`  价格: ${item.price}`);
    console.log(`  货币: ${item.currency_code}`);
  }

  const now = new Date();
  const diff = (now - order.updatedAt) / 1000 / 60;
  console.log(`\n距离上次更新: ${diff.toFixed(1)} 分钟`);
  
  if (diff < 5) {
    console.log('✅ 刚刚同步过');
  } else {
    console.log('❌ 没有重新同步，还是旧数据');
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());

import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  console.log('🔍 查找店铺信息...\n');

  const shop = await prisma.shop.findFirst({
    where: { platform: 'OZON', status: 'ACTIVE' },
    select: { id: true, name: true, userId: true }
  });

  if (!shop) {
    console.log('❌ 没有找到活跃的 OZON 店铺');
    return;
  }

  console.log(`✅ 店铺: ${shop.name}`);
  console.log(`   ID: ${shop.id}`);
  console.log(`   用户ID: ${shop.userId}`);

  // 获取用户信息
  const user = await prisma.user.findUnique({
    where: { id: shop.userId },
    select: { email: true }
  });

  console.log(`   用户: ${user?.email}`);
  console.log('\n📝 使用以下信息调用同步接口:');
  console.log(`   POST http://localhost:3001/api/orders/sync`);
  console.log(`   Body: { "shopId": "${shop.id}", "since": "2026-05-01T00:00:00Z" }`);
  console.log(`   需要登录后的 token`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

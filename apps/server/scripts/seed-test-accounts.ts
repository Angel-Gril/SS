/**
 * 创建测试账号脚本
 * 运行: npx tsx scripts/seed-test-accounts.ts
 */
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const TEST_PASSWORD = 'Qwert123456';

const accounts = [
  { phone: '13200000000', role: 'ADMIN' as const, nickname: '测试管理员' },
  { phone: '13500000000', role: 'STAFF' as const, nickname: '测试仓库员' },
  { phone: '13600000000', role: 'USER' as const, nickname: '测试用户' },
];

async function main() {
  const hash = await bcrypt.hash(TEST_PASSWORD, 12);

  for (const acc of accounts) {
    const user = await prisma.user.upsert({
      where: { phone: acc.phone },
      update: { role: acc.role, nickname: acc.nickname, passwordHash: hash },
      create: {
        phone: acc.phone,
        passwordHash: hash,
        role: acc.role,
        nickname: acc.nickname,
      },
    });
    console.log(`[OK] ${acc.nickname} (${acc.phone}) role=${acc.role} id=${user.id}`);
  }

  console.log('\n所有测试账号已就绪，密码统一为:', TEST_PASSWORD);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

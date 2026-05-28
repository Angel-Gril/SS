import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const adminPhone = '13800000000';
  const existing = await prisma.user.findUnique({ where: { phone: adminPhone } });

  if (!existing) {
    const passwordHash = await bcrypt.hash('admin123456', 12);
    await prisma.user.create({
      data: {
        phone: adminPhone,
        passwordHash,
        nickname: '系统管理员',
        role: 'ADMIN',
        balance: 10000,
      },
    });
    console.log('Created admin user: 13800000000 / admin123456');
  }

  const noticeCount = await prisma.notice.count();
  if (noticeCount === 0) {
    await prisma.notice.createMany({
      data: [
        {
          title: '欢迎使用松鼠跨境 ERP',
          content: '松鼠跨境 ERP 已开放使用，支持 OZON、Yandex、Kaspi、Wildberries 多平台管理。',
          level: 'INFO',
          pinned: true,
        },
        {
          title: '系统初始化完成',
          content: '请前往「店铺管理」绑定您的第一个店铺。',
          level: 'INFO',
        },
      ],
    });
    console.log('Created sample notices');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

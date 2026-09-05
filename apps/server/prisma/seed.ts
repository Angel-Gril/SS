import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
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

import { Worker } from 'bullmq';
import { connection } from '../lib/bullmq-connection.js';
import { registerWorker } from '../lib/worker-registry.js';
import { prisma } from '../lib/prisma.js';
import { createNotification } from '../routes/notification.js';

export function startScheduledDispatchWorker() {
  const worker = new Worker(
    'scheduled-warehouse-dispatch',
    async (job) => {
      const { shopIds, templateId, createdBy } = job.data as {
        shopIds: string[];
        templateId: string;
        createdBy: string;
      };

      const tpl = await prisma.warehouseTemplate.findUnique({ where: { id: templateId } });
      if (!tpl) throw new Error(`Template ${templateId} not found`);

      const shops = await prisma.shop.findMany({
        where: { id: { in: shopIds } },
        select: { id: true, userId: true, name: true },
      });

      let created = 0;
      for (const shop of shops) {
        await prisma.warehouseUpdateCommand.create({
          data: {
            shopId: shop.id,
            templateId: tpl.id,
            status: 'pending',
            createdBy,
          },
        });
        await createNotification(shop.userId, {
          type: 'warehouse_update',
          title: '收到仓库更新指令（定时下发）',
          content: `店铺「${shop.name}」收到仓库切换指令：${tpl.name}，请前往确认`,
          link: '/warehouse-commands',
        });
        created++;
      }

      console.log(`[ScheduledDispatch] Dispatched ${created} commands for template ${tpl.name}`);
      return { created };
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[ScheduledDispatch] Job ${job?.id} failed:`, err.message);
  });

  registerWorker(worker);
  return worker;
}

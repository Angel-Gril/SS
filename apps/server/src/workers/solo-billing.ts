import { Queue, Worker } from 'bullmq';
import { prisma } from '../lib/prisma.js';

const QUEUE_NAME = 'solo-billing-snapshot';
const connection = { host: '127.0.0.1', port: 6379 };

export const soloBillingQueue = new Queue(QUEUE_NAME, { connection });

export function startSoloBillingWorker() {
  soloBillingQueue.add(
    'monthly-snapshot',
    {},
    {
      repeat: { pattern: '0 0 1 * *' },
      removeOnComplete: 12,
      removeOnFail: 6,
    },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const now = new Date();
      const prevMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const month = `${prevMonth.getFullYear()}-${String(prevMonth.getMonth() + 1).padStart(2, '0')}`;
      const startOfMonth = prevMonth;
      const endOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

      const soloUsers = await prisma.user.findMany({
        where: { tenantType: 'solo' },
        select: { id: true },
      });

      let generated = 0;
      for (const user of soloUsers) {
        const existing = await prisma.soloBillingSnapshot.findUnique({
          where: { userId_month: { userId: user.id, month } },
        });
        if (existing) continue;

        const agg = await prisma.order.aggregate({
          where: {
            shop: { userId: user.id },
            soloFeeBilledAt: { gte: startOfMonth, lt: endOfMonth },
            soloFee: { not: null },
          },
          _count: true,
          _sum: { soloFee: true },
        });

        if (agg._count === 0) continue;

        await prisma.soloBillingSnapshot.create({
          data: {
            userId: user.id,
            month,
            orderCount: agg._count,
            totalFee: agg._sum.soloFee || 0,
          },
        });
        generated++;
      }

      console.log(`[SoloBilling] Generated ${generated} snapshots for ${month}`);
      return { month, generated };
    },
    { connection, concurrency: 1 },
  );

  worker.on('completed', (job, result) => {
    console.log(`[SoloBilling] Job ${job.id} completed:`, result);
  });

  worker.on('failed', (job, err) => {
    console.error(`[SoloBilling] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}

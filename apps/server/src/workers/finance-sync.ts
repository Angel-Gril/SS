import { Queue, Worker } from 'bullmq';
import { redisDisabled } from '../lib/redis.js';
import { connection } from '../lib/bullmq-connection.js';
import { registerWorker } from '../lib/worker-registry.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient } from '../services/ozon-client.js';
import { convertAmountToCny } from '../services/exchange-rate.js';
import { financeAccrualDates, syncFinanceAccrualDay } from '../services/ozon-finance-accrual.js';

const QUEUE_NAME = 'finance-sync';

export const financeSyncQueue: Queue | null = redisDisabled ? null : new Queue(QUEUE_NAME, { connection });

export async function addFinanceSyncJob(shopId: string, days = 30) {
  const from = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const to = new Date().toISOString();
  if (redisDisabled) {
    syncFinanceCore(shopId, from, to).catch((e) =>
      console.error(`[FinanceSync inline] shop ${shopId} failed:`, e.message),
    );
    return { id: 'inline-' + Date.now() };
  }
  return financeSyncQueue!.add('sync', { shopId, from, to }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 20,
  });
}

async function syncFinanceCore(shopId: string, from: string, to: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.status !== 'ACTIVE') throw new Error(`Shop ${shopId} not found or inactive`);

  const client = new OzonClient({
    clientId: shop.clientId!,
    apiKey: decrypt(shop.apiKeyEncrypted),
  });

  let totalStored = 0;
  const dates = financeAccrualDates(from, to);
  for (const date of dates) {
    const result = await syncFinanceAccrualDay({
      db: prisma, client, shopId, date, convert: convertAmountToCny,
    });
    totalStored += result.accrualsStored;
    await sleep(500);
  }

  console.log(`[FinanceSync] Shop ${shop.name}: stored ${totalStored} transactions`);
  return { totalStored };
}

export function startFinanceSyncWorker() {
  if (redisDisabled) return null;

  // 每天 01:00 UTC 自动同步所有活跃店铺最近 30 天
  financeSyncQueue!.upsertJobScheduler(
    'daily-finance-sync-all',
    { pattern: '0 1 * * *' },
    { name: 'sync-all-shops' },
  ).catch((err) => console.error('[FinanceSync] Failed to register scheduler:', err.message));

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'sync-all-shops') {
        const shops = await prisma.shop.findMany({
          where: { status: 'ACTIVE', platform: 'OZON' },
          select: { id: true },
        });
        let total = 0;
        for (const shop of shops) {
          const from = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
          const to = new Date().toISOString();
          const r = await syncFinanceCore(shop.id, from, to);
          total += r.totalStored;
          await sleep(2000);
        }
        return { shopsProcessed: shops.length, totalStored: total };
      }
      const { shopId, from, to } = job.data;
      return syncFinanceCore(shopId, from, to);
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[FinanceSync] Job ${job?.id} failed:`, err.message);
  });

  registerWorker(worker);
  return worker;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

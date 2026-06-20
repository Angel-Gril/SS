import { prisma } from '../lib/prisma.js';
import { registerTimer } from '../lib/worker-registry.js';
import { shouldAutoRefreshProductPushJob } from '../services/listing-task-refresh.js';
import { refreshListingProductPushJob } from '../routes/listing.js';

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_LOOKBACK_HOURS = 48;
const DEFAULT_BATCH_SIZE = 10;

function positiveInt(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

export function startListingTaskRefreshWorker() {
  const intervalMs = positiveInt(process.env.LISTING_TASK_REFRESH_INTERVAL_MS, DEFAULT_INTERVAL_MS);
  const lookbackHours = positiveInt(process.env.LISTING_TASK_REFRESH_LOOKBACK_HOURS, DEFAULT_LOOKBACK_HOURS);
  const batchSize = positiveInt(process.env.LISTING_TASK_REFRESH_BATCH_SIZE, DEFAULT_BATCH_SIZE);
  let running = false;

  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const cutoff = new Date(Date.now() - lookbackHours * 60 * 60 * 1000);
      const candidates = await prisma.syncJob.findMany({
        where: {
          type: 'PRODUCT_PUSH',
          createdAt: { gte: cutoff },
          status: { in: ['PENDING', 'RUNNING', 'SUCCESS'] },
        },
        orderBy: { createdAt: 'desc' },
        take: 100,
        select: {
          id: true,
          type: true,
          status: true,
          payload: true,
        },
      });
      const targets = candidates.filter(shouldAutoRefreshProductPushJob).slice(0, batchSize);
      for (const job of targets) {
        const result = await refreshListingProductPushJob(job.id);
        if (result.code !== 1) {
          console.warn(`[listing-task-refresh] ${job.id} refresh skipped/failed: ${result.msg}`);
        } else {
          console.log(`[listing-task-refresh] ${job.id} -> ${result.data?.status || 'unknown'}`);
        }
      }
    } catch (e: any) {
      console.error('[listing-task-refresh] tick failed:', e?.message || e);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => {
    void tick();
  }, intervalMs);
  timer.unref();
  void tick();

  registerTimer(() => clearInterval(timer));
  console.log(`[listing-task-refresh] worker started interval=${intervalMs}ms lookback=${lookbackHours}h batch=${batchSize}`);
}

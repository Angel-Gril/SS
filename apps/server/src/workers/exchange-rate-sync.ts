import { Worker, Queue } from 'bullmq';
import { fetchAndStoreRates } from '../services/exchange-rate.js';

const connection = { host: '127.0.0.1', port: 6379 };
const QUEUE_NAME = 'exchange-rate-sync';

const queue = new Queue(QUEUE_NAME, { connection });

export function startExchangeRateSyncWorker() {
  // 每天 08:00 UTC+8 = 00:00 UTC 拉一次
  queue.upsertJobScheduler(
    'daily-rate-fetch',
    { pattern: '0 0 * * *' },
    { name: 'fetch-rates' },
  ).catch((err) => console.error('[ExchangeRateSync] Failed to register scheduler:', err.message));

  // 启动时也立即拉一次（如果今天还没拉过）
  queue.add('fetch-rates-startup', {}, { jobId: `startup-${new Date().toISOString().slice(0, 10)}` })
    .catch(() => { /* 重复 jobId 会静默失败 */ });

  const worker = new Worker(
    QUEUE_NAME,
    async () => {
      const count = await fetchAndStoreRates('CNY');
      return { stored: count };
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[ExchangeRateSync] Job ${job?.id} failed:`, err.message);
  });

  worker.on('completed', (job) => {
    console.log(`[ExchangeRateSync] Job ${job.id} completed:`, job.returnvalue);
  });

  return worker;
}

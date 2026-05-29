import type { Worker } from 'bullmq';

const workers: Worker[] = [];
const timers: (() => void)[] = [];

export function registerWorker(worker: Worker) {
  workers.push(worker);
}

export function registerTimer(stop: () => void) {
  timers.push(stop);
}

export async function shutdownAllWorkers(timeoutMs = 30000): Promise<void> {
  console.log(`[shutdown] closing ${workers.length} BullMQ workers + ${timers.length} timers...`);

  timers.forEach((stop) => stop());

  const results = await Promise.allSettled(
    workers.map((w) => w.close().catch((e) => console.error('[shutdown] worker close error:', e))),
  );

  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    console.warn(`[shutdown] ${failed} workers failed to close cleanly`);
  }

  console.log('[shutdown] all workers stopped');
}

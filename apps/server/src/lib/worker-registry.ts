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

  for (const stop of timers.splice(0)) {
    try {
      stop();
    } catch (e) {
      console.error('[shutdown] timer stop error:', e);
    }
  }

  const closeAll = Promise.allSettled(workers.splice(0).map((w) => w.close()));
  const timeout = new Promise<PromiseSettledResult<void>[]>((_, reject) => {
    setTimeout(() => reject(new Error(`worker shutdown timed out after ${timeoutMs}ms`)), timeoutMs).unref();
  });

  const results = await Promise.race([closeAll, timeout]);

  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) {
    console.warn(`[shutdown] ${failed} workers failed to close cleanly`);
  }

  console.log('[shutdown] all workers stopped');
}

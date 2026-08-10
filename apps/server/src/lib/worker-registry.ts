import type { Worker } from 'bullmq';

const workers: Worker[] = [];
const timers: Array<() => void | Promise<void>> = [];

export function registerWorker(worker: Worker) {
  workers.push(worker);
}

export function registerTimer(stop: () => void | Promise<void>) {
  timers.push(stop);
}

export async function shutdownAllWorkers(timeoutMs = 30000): Promise<void> {
  console.log(`[shutdown] closing ${workers.length} BullMQ workers + ${timers.length} timers...`);

  const closeAll = Promise.allSettled([
    ...timers.splice(0).map(async (stop) => stop()),
    ...workers.splice(0).map((worker) => worker.close()),
  ]);
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

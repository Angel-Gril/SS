import { prisma } from '../lib/prisma.js';
import { registerTimer } from '../lib/worker-registry.js';
import {
  getListingTaskRefreshEnvDefaults,
  getListingTaskRefreshSettings,
  shouldAutoRefreshProductPushJob,
  type ListingTaskRefreshSettings,
} from '../services/listing-task-refresh.js';
import { refreshListingProductPushJob } from '../routes/listing.js';

function settingsSummary(settings: ListingTaskRefreshSettings): string {
  return `interval=${settings.intervalMs}ms lookback=${settings.lookbackHours}h batch=${settings.batchSize} concurrency=${settings.concurrency} ozonTimeout=${settings.ozonApiTimeoutMs}ms`;
}

export function startListingTaskRefreshWorker() {
  const fallbackSettings = getListingTaskRefreshEnvDefaults();
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastLoggedSettings = '';

  const scheduleNext = (delayMs: number) => {
    if (stopped) return;
    timer = setTimeout(() => {
      void runOnce();
    }, delayMs);
    timer.unref();
  };

  const logSettingsIfChanged = (settings: ListingTaskRefreshSettings) => {
    const summary = settingsSummary(settings);
    if (summary === lastLoggedSettings) return;
    lastLoggedSettings = summary;
    console.log(`[listing-task-refresh] settings ${summary}`);
  };

  const runOnce = async () => {
    if (running) return;
    running = true;
    let settings = fallbackSettings;
    try {
      settings = await getListingTaskRefreshSettings();
      logSettingsIfChanged(settings);

      const cutoff = new Date(Date.now() - settings.lookbackHours * 60 * 60 * 1000);
      const candidates = await prisma.syncJob.findMany({
        where: {
          type: 'PRODUCT_PUSH',
          createdAt: { gte: cutoff },
          status: { in: ['PENDING', 'RUNNING', 'SUCCESS'] },
        },
        orderBy: { createdAt: 'desc' },
        take: Math.max(100, settings.batchSize * 2),
        select: {
          id: true,
          type: true,
          status: true,
          payload: true,
        },
      });
      const targets = candidates.filter(shouldAutoRefreshProductPushJob).slice(0, settings.batchSize);
      const concurrency = Math.max(1, Math.min(settings.concurrency, Math.max(1, targets.length)));
      for (let i = 0; i < targets.length; i += concurrency) {
        const chunk = targets.slice(i, i + concurrency);
        await Promise.allSettled(chunk.map(async (job) => {
          try {
            const result = await refreshListingProductPushJob(job.id, undefined, {
              ozonApiTimeoutMs: settings.ozonApiTimeoutMs,
            });
            if (result.code !== 1) {
              console.warn(`[listing-task-refresh] ${job.id} refresh skipped/failed: ${result.msg}`);
            } else {
              console.log(`[listing-task-refresh] ${job.id} -> ${result.data?.status || 'unknown'}`);
            }
          } catch (e: any) {
            console.warn(`[listing-task-refresh] ${job.id} refresh crashed: ${e?.message || e}`);
          }
        }));
      }
    } catch (e: any) {
      console.error('[listing-task-refresh] tick failed:', e?.message || e);
    } finally {
      running = false;
      scheduleNext(settings.intervalMs);
    }
  };

  void runOnce();

  registerTimer(() => {
    stopped = true;
    if (timer) clearTimeout(timer);
  });
  console.log('[listing-task-refresh] worker started configSource=admin-settings envFallback=true');
}

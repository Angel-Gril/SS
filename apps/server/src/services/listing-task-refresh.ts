export function shouldAutoRefreshProductPushJob(job: {
  type?: unknown;
  status?: unknown;
  payload?: unknown;
}): boolean {
  if (job.type !== 'PRODUCT_PUSH') return false;
  const payload = job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload)
    ? job.payload as Record<string, unknown>
    : {};
  if (!payload.taskId) return false;
  if (job.status === 'RUNNING' || job.status === 'PENDING') return true;
  const pictureUploadStatus = String(payload.pictureUploadStatus || '').toLowerCase();
  if (pictureUploadStatus === 'pending' || pictureUploadStatus === 'partial_pending') return true;
  return Number(payload.pictureActivationPendingCount || 0) > 0;
}
function positiveInt(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

const PRODUCTION_DEFAULTS = process.env.NODE_ENV === 'production';

export interface ListingTaskRefreshSettings {
  intervalMs: number;
  batchSize: number;
  concurrency: number;
  lookbackHours: number;
  ozonApiTimeoutMs: number;
}

export function getListingTaskRefreshEnvDefaults(): ListingTaskRefreshSettings {
  return {
    intervalMs: positiveInt(process.env.LISTING_TASK_REFRESH_INTERVAL_MS, 30_000),
    batchSize: positiveInt(process.env.LISTING_TASK_REFRESH_BATCH_SIZE, PRODUCTION_DEFAULTS ? 30 : 10),
    concurrency: positiveInt(process.env.LISTING_TASK_REFRESH_CONCURRENCY, PRODUCTION_DEFAULTS ? 6 : 3),
    lookbackHours: positiveInt(process.env.LISTING_TASK_REFRESH_LOOKBACK_HOURS, PRODUCTION_DEFAULTS ? 72 : 48),
    ozonApiTimeoutMs: positiveInt(process.env.OZON_API_TIMEOUT_MS, 20_000),
  };
}

export async function getListingTaskRefreshSettings(): Promise<ListingTaskRefreshSettings> {
  const fallback = getListingTaskRefreshEnvDefaults();
  try {
    const { getConfig } = await import('../config/system-config-schema.js');
    const [intervalMs, batchSize, concurrency, lookbackHours, ozonApiTimeoutMs] = await Promise.all([
      getConfig('listing_task_refresh_interval_ms'),
      getConfig('listing_task_refresh_batch_size'),
      getConfig('listing_task_refresh_concurrency'),
      getConfig('listing_task_refresh_lookback_hours'),
      getConfig('listing_ozon_api_timeout_ms'),
    ]);
    return {
      intervalMs: positiveInt(intervalMs, fallback.intervalMs),
      batchSize: positiveInt(batchSize, fallback.batchSize),
      concurrency: positiveInt(concurrency, fallback.concurrency),
      lookbackHours: positiveInt(lookbackHours, fallback.lookbackHours),
      ozonApiTimeoutMs: positiveInt(ozonApiTimeoutMs, fallback.ozonApiTimeoutMs),
    };
  } catch (error: any) {
    console.warn(`[listing-task-refresh] failed to load SystemConfig, using env/defaults: ${error?.message || error}`);
    return fallback;
  }
}

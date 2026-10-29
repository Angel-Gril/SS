type ProductSyncJob = { id?: unknown };
export interface ProductSyncJobOptions {
  delayMs?: number;
  automaticIntervalMs?: number;
  jobId?: string;
  syncJobId?: string;
  trigger?: string;
  eventType?: string;
  eventKey?: string;
  payload?: Record<string, unknown>;
}
type ProductSyncJobAdder = (shopId: string, options?: ProductSyncJobOptions) => Promise<ProductSyncJob>;
const POST_PUBLISH_FOLLOW_UP_DELAY_MS = 5 * 60 * 1000;

async function defaultAddProductSyncJob(shopId: string, options?: ProductSyncJobOptions): Promise<ProductSyncJob> {
  const { addProductSyncJob } = await import('../workers/product-sync.js');
  return addProductSyncJob(shopId, options);
}

export async function enqueueProductSyncAfterPublish(
  shopId: string,
  source: string,
  addJob: ProductSyncJobAdder = defaultAddProductSyncJob,
): Promise<{ queued: true; jobId: string; followUpJobId?: string; followUpError?: string } | { queued: false; error: string }> {
  try {
    const job = await addJob(shopId);
    const jobId = String(job.id || '');
    let followUpJobId: string | undefined;
    let followUpError: string | undefined;
    try {
      const windowId = Math.floor(Date.now() / POST_PUBLISH_FOLLOW_UP_DELAY_MS);
      const followUp = await addJob(shopId, {
        delayMs: POST_PUBLISH_FOLLOW_UP_DELAY_MS,
        jobId: `post-publish-follow-up:${shopId}:${windowId}`,
      });
      followUpJobId = String(followUp.id || '');
    } catch (e: any) {
      followUpError = e?.message ? String(e.message) : 'unknown error';
      console.warn(`[post-publish-sync] failed to queue follow-up product sync shop=${shopId} source=${source}: ${followUpError.slice(0, 200)}`);
    }
    console.log(`[post-publish-sync] queued product sync shop=${shopId} source=${source} job=${jobId || 'unknown'}`);
    return followUpError
      ? { queued: true, jobId, followUpError }
      : { queued: true, jobId, followUpJobId };
  } catch (e: any) {
    const error = e?.message ? String(e.message) : 'unknown error';
    console.warn(`[post-publish-sync] failed to queue product sync shop=${shopId} source=${source}: ${error.slice(0, 200)}`);
    return { queued: false, error };
  }
}

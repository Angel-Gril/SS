type ProductSyncJob = { id?: unknown };
type ProductSyncJobAdder = (shopId: string) => Promise<ProductSyncJob>;

async function defaultAddProductSyncJob(shopId: string): Promise<ProductSyncJob> {
  const { addProductSyncJob } = await import('../workers/product-sync.js');
  return addProductSyncJob(shopId);
}

export async function enqueueProductSyncAfterPublish(
  shopId: string,
  source: string,
  addJob: ProductSyncJobAdder = defaultAddProductSyncJob,
): Promise<{ queued: true; jobId: string } | { queued: false; error: string }> {
  try {
    const job = await addJob(shopId);
    const jobId = String(job.id || '');
    console.log(`[post-publish-sync] queued product sync shop=${shopId} source=${source} job=${jobId || 'unknown'}`);
    return { queued: true, jobId };
  } catch (e: any) {
    const error = e?.message ? String(e.message) : 'unknown error';
    console.warn(`[post-publish-sync] failed to queue product sync shop=${shopId} source=${source}: ${error.slice(0, 200)}`);
    return { queued: false, error };
  }
}

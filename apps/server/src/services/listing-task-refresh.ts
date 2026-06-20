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

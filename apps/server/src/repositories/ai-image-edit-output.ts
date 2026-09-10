import type { AiImageAssetInput } from '../services/ai-image-jobs.js';

export function assertAiImageEditRawAsset(jobId: string, asset: AiImageAssetInput): void {
  if (asset.jobId !== jobId || asset.kind !== 'AI_PROVIDER_OUTPUT' || !asset.sha256
    || asset.storageBackend === 'ozon-cdn' || !asset.storageKey) {
    throw Object.assign(new Error('Provider output asset does not satisfy the edit persistence contract'), {
      code: 'INVALID_PROVIDER_OUTPUT',
    });
  }
}

export function matchesAiImageEditRaw(existing: any, jobId: string, asset: AiImageAssetInput): boolean {
  return Boolean(existing && existing.aiImageJobId === jobId && existing.ownerUserId === asset.ownerUserId
    && existing.kind === 'AI_PROVIDER_OUTPUT' && existing.sha256 === asset.sha256 && existing.url === asset.url
    && existing.storageBackend === asset.storageBackend && existing.storageKey === asset.storageKey
    && existing.mimeType === asset.mimeType && Number(existing.sizeBytes) === asset.sizeBytes
    && (existing.width ?? null) === (asset.width ?? null) && (existing.height ?? null) === (asset.height ?? null));
}

/** Caller owns the job/claim fence and transaction; raw identity and lineage are shared. */
export async function persistAiImageEditRawOutput(tx: any, job: any, asset: AiImageAssetInput) {
  assertAiImageEditRawAsset(job.id, asset);
  if (job.ownerUserId !== asset.ownerUserId) {
    throw Object.assign(new Error('Provider output owner does not match its job'), { code: 'INVALID_PROVIDER_OUTPUT' });
  }
  const existing = await tx.mediaAsset.findFirst({
    where: { aiImageJobId: job.id, ownerUserId: asset.ownerUserId, kind: 'AI_PROVIDER_OUTPUT' },
  });
  if (existing) {
    if (!matchesAiImageEditRaw(existing, job.id, asset)) {
      throw Object.assign(new Error('Provider output identity conflicts with the persisted attempt'), {
        code: 'PROVIDER_OUTPUT_CONFLICT',
      });
    }
    return { output: { ...asset, ...existing }, created: false };
  }
  const created = await tx.mediaAsset.create({ data: {
    ownerUserId: asset.ownerUserId, aiImageJobId: asset.jobId, kind: 'AI_PROVIDER_OUTPUT',
    url: asset.url, storageBackend: asset.storageBackend, storageKey: asset.storageKey,
    mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, width: asset.width ?? null,
    height: asset.height ?? null, sha256: asset.sha256, metadata: asset.metadata || undefined,
  } });
  if (job.workflowId) {
    const inputs = await tx.aiMediaWorkflowInput.findMany({
      where: { workflowId: job.workflowId }, orderBy: [{ role: 'asc' }, { ordinal: 'asc' }],
    });
    for (const input of inputs) {
      await tx.mediaAssetLineage.create({ data: {
        ownerUserId: job.ownerUserId, workflowId: job.workflowId, jobId: job.id,
        inputAssetId: input.assetId, outputAssetId: created.id, inputRole: input.role,
        ordinal: input.ordinal, operation: job.operation,
      } });
    }
  }
  return { output: { ...asset, ...created }, created: true };
}

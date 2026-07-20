export const AI_MEDIA_EDIT_SOURCE_MAX_BYTES = 20 * 1024 * 1024;
export const AI_MEDIA_EDIT_SOURCE_MAX_PIXELS = 12_000_000;
export const AI_MEDIA_EDIT_SOURCE_MAX_EDGE = 16_384;
export const AI_MEDIA_EDIT_SOURCE_MAX_ASPECT_RATIO = 20;
export const AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION = 'ai-media-edit-source/v1';

function metadataRecord(asset: { metadata?: unknown } | null | undefined): Record<string, unknown> {
  return asset?.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
    ? asset.metadata as Record<string, unknown>
    : {};
}

export interface AiMediaEditContextAuthority {
  ownerUserId: string;
  contextId: string;
  contextSkuKey?: string | null;
  contextSlotKey?: string | null;
  sourceCaptureSnapshotId: string;
}

function isAiMediaEditReadyAssetBase(asset: any): boolean {
  const metadata = metadataRecord(asset);
  return Boolean(
    asset
    && ['local', 'oss'].includes(String(asset.storageBackend || ''))
    && String(asset.storageKey || '').trim()
    && String(asset.url || '').trim()
    && ['image/jpeg', 'image/png'].includes(String(asset.mimeType || ''))
    && /^[a-f0-9]{64}$/u.test(String(asset.sha256 || ''))
    && Number.isSafeInteger(asset.sizeBytes)
    && asset.sizeBytes > 0
    && asset.sizeBytes <= AI_MEDIA_EDIT_SOURCE_MAX_BYTES
    && Number.isSafeInteger(asset.width)
    && Number.isSafeInteger(asset.height)
    && asset.width > 0
    && asset.height > 0
    && asset.width <= AI_MEDIA_EDIT_SOURCE_MAX_EDGE
    && asset.height <= AI_MEDIA_EDIT_SOURCE_MAX_EDGE
    && asset.width * asset.height <= AI_MEDIA_EDIT_SOURCE_MAX_PIXELS
    && Math.max(asset.width, asset.height) / Math.min(asset.width, asset.height)
      <= AI_MEDIA_EDIT_SOURCE_MAX_ASPECT_RATIO
    && metadata.pixelOrientationNormalized === true,
  );
}

export function isAiMediaEditReadySourceAsset(asset: any): boolean {
  return Boolean(asset?.kind === 'SOURCE_ORIGINAL' && isAiMediaEditReadyAssetBase(asset));
}

export function isAiMediaEditReadyCandidateAsset(asset: any): boolean {
  const metadata = metadataRecord(asset);
  return Boolean(
    asset?.kind === 'AI_GENERATED'
    && String(asset.sourceCaptureSnapshotId || '').trim()
    && String(asset.aiImageJobId || '').trim()
    && metadata.editSourceContractVersion === AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION
    && ['FINAL_CANDIDATE', 'FINAL_COMPOSITE'].includes(String(metadata.outputRole || ''))
    && isAiMediaEditReadyAssetBase(asset),
  );
}

export function isAiMediaEditCandidateFromContext(
  asset: any,
  authority: AiMediaEditContextAuthority,
): boolean {
  const job = asset?.aiImageJob;
  const workflow = job?.workflow;
  return Boolean(
    isAiMediaEditReadyCandidateAsset(asset)
    && asset.ownerUserId === authority.ownerUserId
    && asset.sourceCaptureSnapshotId === authority.sourceCaptureSnapshotId
    && job
    && asset.aiImageJobId === job.id
    && job.ownerUserId === authority.ownerUserId
    && job.status === 'SUCCEEDED'
    && ['FULL_EDIT', 'INPAINT'].includes(String(job.operation || ''))
    && workflow
    && job.workflowId === workflow.id
    && job.workflowAttempt === workflow.currentAttempt
    && workflow.ownerUserId === authority.ownerUserId
    && workflow.status === 'SUCCEEDED'
    && workflow.completedAt != null
    && workflow.operation === job.operation
    && workflow.contextType === 'collect'
    && workflow.contextId === authority.contextId
    && (workflow.contextSkuKey ?? null) === (authority.contextSkuKey ?? null)
    && (workflow.contextSlotKey ?? null) === (authority.contextSlotKey ?? null)
    && workflow.suiteSlot == null,
  );
}

export function isAiMediaEditInputFromContext(
  asset: any,
  authority: AiMediaEditContextAuthority,
): boolean {
  if (isAiMediaEditReadySourceAsset(asset)) {
    return asset.ownerUserId === authority.ownerUserId
      && asset.sourceCaptureSnapshotId === authority.sourceCaptureSnapshotId;
  }
  return isAiMediaEditCandidateFromContext(asset, authority);
}

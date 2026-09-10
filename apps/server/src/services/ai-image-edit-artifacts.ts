import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { AiImageJobError } from './ai-image-job-error.js';
import { assertWanxHostedEditPrompt } from './ai-image-edit-provider-contract.js';
import {
  AiMediaCapabilityError,
  assertAiMediaCapability,
} from './ai-image-provider-capabilities.js';
import {
  AI_IMAGE_EDIT_MASK_SEMANTICS,
  composeAiImageInpaint,
  validateAiImageEditCandidate,
  validateAiImageEditMask,
} from './ai-image-compositor.js';
import type {
  AiImageAssetInput,
  AiImageJobRecord,
  AiImageProviderRuntimeInput,
} from './ai-image-jobs.js';
import {
  AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
  AI_MEDIA_EDIT_SOURCE_MAX_BYTES,
  AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
} from './ai-image-edit-source.js';

export const AI_IMAGE_EDIT_MAX_INPUT_BYTES = AI_MEDIA_EDIT_SOURCE_MAX_BYTES;
export const AI_IMAGE_EDIT_POLICY_VERSION = 'ai-image-edit-policy/1.0';

type FrozenInputAsset = NonNullable<AiImageJobRecord['inputAssets']>[number];

export interface AiImageEditInputs {
  source: FrozenInputAsset;
  mask: FrozenInputAsset | null;
  sourceBuffer: Buffer;
  sourceMimeType: AiImageProviderRuntimeInput['mimeType'];
  maskBuffer: Buffer | null;
}

export type AiImageEditUploadBuffer = (
  buffer: Buffer,
  filename: string,
  mimeType?: string,
  options?: { category?: 'ai-generated'; ownerId?: string; idempotencyKey?: string },
) => Promise<{ url: string; backend: string; filename?: string; key?: string }>;

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function editInputs(job: AiImageJobRecord) {
  const inputs = job.inputAssets || [];
  const references = inputs.filter((asset) => asset.role === 'REFERENCE');
  const masks = inputs.filter((asset) => asset.role === 'MASK');
  const maskCount = job.operation === 'INPAINT' ? 1 : 0;
  if (
    references.length !== 1
    || masks.length !== maskCount
    || inputs.length !== 1 + maskCount
    || references[0]?.ordinal !== 0
    || (masks[0] && masks[0].ordinal !== 0)
  ) {
    throw new AiImageJobError(
      'INVALID_MEDIA_INPUT',
      `${job.operation} requires exactly one source and ${maskCount} mask input`,
    );
  }
  return { source: references[0]!, mask: masks[0] || null };
}

function assertFrozenAsset(asset: FrozenInputAsset, job: AiImageJobRecord, expectedKinds: string[]) {
  if (
    !expectedKinds.includes(String(asset.kind || ''))
    || !/^[a-f0-9]{64}$/u.test(String(asset.sha256 || ''))
    || !Number.isSafeInteger(asset.sizeBytes)
    || Number(asset.sizeBytes) < 1
    || Number(asset.sizeBytes) > AI_IMAGE_EDIT_MAX_INPUT_BYTES
    || asset.width !== job.width
    || asset.height !== job.height
    || !['local', 'oss'].includes(String(asset.storageBackend || ''))
    || !String(asset.storageKey || '').trim()
  ) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen edit input is incomplete or not trusted storage');
  }
}

function assertOperationConfig(job: AiImageJobRecord) {
  const config = job.operationConfig && typeof job.operationConfig === 'object'
    ? job.operationConfig
    : {};
  if (config.policyVersion !== AI_IMAGE_EDIT_POLICY_VERSION) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'AI image edit policy version is not supported');
  }
  if (job.operation === 'INPAINT' && config.maskSemantics !== AI_IMAGE_EDIT_MASK_SEMANTICS) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'AI image edit mask semantics are not supported');
  }
  if (job.operation === 'FULL_EDIT' && config.maskSemantics != null) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Full-image edit cannot include mask semantics');
  }
  if (config.contextType == null) return;
  if (
    !['collect', 'listing-draft'].includes(String(config.contextType || ''))
    || !String(config.contextId || '').trim()
    || (config.contextType === 'listing-draft' && (
      !Number.isSafeInteger(config.contextDraftRevision)
      || Number(config.contextDraftRevision) < 1
      || !Number.isSafeInteger(config.contextDraftVersion)
      || Number(config.contextDraftVersion) < 1
    ))
    || (config.contextType === 'collect' && (
      config.contextDraftRevision != null || config.contextDraftVersion != null
    ))
  ) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'AI image edit context authority is not frozen');
  }
}

export function assertAiImageEditInputPolicy(
  job: AiImageJobRecord,
): asserts job is AiImageJobRecord & { operation: 'FULL_EDIT' | 'INPAINT' } {
  if (job.operation !== 'FULL_EDIT' && job.operation !== 'INPAINT') {
    throw new AiImageJobError('UNSUPPORTED_OPERATION', 'Job is not a manual image edit operation');
  }
  assertOperationConfig(job);
  assertWanxHostedEditPrompt(job);
}

export async function loadAiImageEditInputs(
  job: AiImageJobRecord,
  loadInputBuffer: (asset: FrozenInputAsset) => Promise<Buffer>,
): Promise<AiImageEditInputs> {
  assertAiImageEditInputPolicy(job);
  const { source, mask } = editInputs(job);
  assertFrozenAsset(source, job, ['SOURCE_ORIGINAL', 'AI_GENERATED']);
  if (mask) assertFrozenAsset(mask, job, ['EDIT_MASK']);
  try {
    assertAiMediaCapability({
      provider: job.provider,
      model: job.model,
      operation: job.operation,
      inputCount: 1,
      maskCount: mask ? 1 : 0,
    });
  } catch (error) {
    if (error instanceof AiMediaCapabilityError) throw new AiImageJobError(error.code, error.message);
    throw error;
  }

  const sourceBuffer = await loadInputBuffer(source);
  if (sourceBuffer.length !== source.sizeBytes || sha256(sourceBuffer) !== source.sha256) {
    throw new AiImageJobError('FROZEN_INPUT_MISMATCH', 'Source bytes do not match the frozen asset identity');
  }
  const sourceDiagnostics = await validateAiImageEditCandidate({
    buffer: sourceBuffer,
    expectedWidth: job.width,
    expectedHeight: job.height,
  });
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(sourceDiagnostics.mimeType)) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Source image MIME type is not supported');
  }
  const sourceMimeType = sourceDiagnostics.mimeType as AiImageProviderRuntimeInput['mimeType'];

  let maskBuffer: Buffer | null = null;
  if (mask) {
    maskBuffer = await loadInputBuffer(mask);
    if (maskBuffer.length !== mask.sizeBytes || sha256(maskBuffer) !== mask.sha256) {
      throw new AiImageJobError('FROZEN_INPUT_MISMATCH', 'Mask bytes do not match the frozen asset identity');
    }
    await validateAiImageEditMask({
      maskBuffer,
      expectedWidth: job.width,
      expectedHeight: job.height,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    });
  }
  return { source, mask, sourceBuffer, sourceMimeType, maskBuffer };
}

function storedAsset(input: {
  stored: { url: string; backend: string; filename?: string; key?: string };
  job: AiImageJobRecord;
  kind: 'AI_PROVIDER_OUTPUT' | 'AI_GENERATED';
  buffer: Buffer;
  mimeType: string;
  metadata: Record<string, unknown>;
}): AiImageAssetInput {
  const storageKey = input.stored.key || input.stored.filename || null;
  if (!['local', 'oss'].includes(input.stored.backend) || !storageKey || !input.stored.url) {
    throw new AiImageJobError(
      'EDIT_STORAGE_NOT_READY',
      'AI image edit output requires durable local or OSS storage',
    );
  }
  return {
    ownerUserId: input.job.ownerUserId,
    jobId: input.job.id,
    kind: input.kind,
    url: input.stored.url,
    storageBackend: input.stored.backend,
    storageKey,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    width: input.job.width,
    height: input.job.height,
    sha256: sha256(input.buffer),
    metadata: input.metadata,
  };
}

async function normalizeReviewableEditCandidate(input: {
  buffer: Buffer;
  expectedWidth: number;
  expectedHeight: number;
}) {
  const metadata = await sharp(input.buffer, {
    animated: false,
    limitInputPixels: AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
  }).metadata();
  const pipeline = sharp(input.buffer, {
    animated: false,
    limitInputPixels: AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
  }).autoOrient();
  const jpeg = metadata.format === 'jpeg';
  const buffer = jpeg
    ? await pipeline.jpeg({ quality: 95, mozjpeg: true }).toBuffer()
    : await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer();
  if (buffer.length > AI_IMAGE_EDIT_MAX_INPUT_BYTES) {
    throw new AiImageJobError('INVALID_PROVIDER_RESULT', 'Normalized edit candidate exceeds the byte limit');
  }
  await validateAiImageEditCandidate({
    buffer,
    expectedWidth: input.expectedWidth,
    expectedHeight: input.expectedHeight,
  });
  return {
    buffer,
    mimeType: jpeg ? 'image/jpeg' : 'image/png',
    extension: jpeg ? 'jpg' : 'png',
  };
}

export async function storeAiImageEditRaw(
  job: AiImageJobRecord,
  rawBuffer: Buffer,
  uploadBuffer: AiImageEditUploadBuffer,
  diagnostics?: Awaited<ReturnType<typeof validateAiImageEditCandidate>>,
): Promise<AiImageAssetInput> {
  // The foreground runner validates before its cancellation fence and reuses that result.
  const rawDiagnostics = diagnostics ?? await validateAiImageEditCandidate({
    buffer: rawBuffer,
    expectedWidth: job.width,
    expectedHeight: job.height,
  });
  const rawSha256 = sha256(rawBuffer);
  const rawStored = await uploadBuffer(
    rawBuffer,
    `edit-${job.id}-provider-raw.${rawDiagnostics.extension}`,
    rawDiagnostics.mimeType,
    {
      category: 'ai-generated',
      ownerId: job.ownerUserId,
      idempotencyKey: `${job.id}:provider-raw:${rawSha256}`,
    },
  );
  return storedAsset({
    stored: rawStored,
    job,
    kind: 'AI_PROVIDER_OUTPUT',
    buffer: rawBuffer,
    mimeType: rawDiagnostics.mimeType,
    metadata: {
      outputRole: 'PROVIDER_RAW',
      policyVersion: AI_IMAGE_EDIT_POLICY_VERSION,
      operation: job.operation,
      providerOutputFormat: rawDiagnostics.format,
    },
  });
}

export async function storeAiImageEditFinal(
  job: AiImageJobRecord,
  inputs: AiImageEditInputs,
  rawBuffer: Buffer,
  providerOutputAssetId: string,
  uploadBuffer: AiImageEditUploadBuffer,
): Promise<AiImageAssetInput> {
  let finalBuffer = rawBuffer;
  let finalMetadata: Record<string, unknown> = {
    outputRole: 'FINAL_CANDIDATE',
    policyVersion: AI_IMAGE_EDIT_POLICY_VERSION,
    operation: job.operation,
    providerOutputAssetId,
  };
  if (job.operation === 'INPAINT') {
    const composite = await composeAiImageInpaint({
      sourceBuffer: inputs.sourceBuffer,
      rawCandidateBuffer: rawBuffer,
      maskBuffer: inputs.maskBuffer!,
      maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
    });
    finalBuffer = composite.buffer;
    finalMetadata = {
      outputRole: 'FINAL_COMPOSITE',
      policyVersion: AI_IMAGE_EDIT_POLICY_VERSION,
      operation: job.operation,
      providerOutputAssetId,
      ...composite.diagnostics,
    };
  }
  const normalizedFinal = await normalizeReviewableEditCandidate({
    buffer: finalBuffer,
    expectedWidth: job.width,
    expectedHeight: job.height,
  });
  finalBuffer = normalizedFinal.buffer;
  finalMetadata = {
    ...finalMetadata,
    pixelOrientationNormalized: true,
    editSourceContractVersion: AI_MEDIA_EDIT_SOURCE_CONTRACT_VERSION,
  };
  const finalSha256 = sha256(finalBuffer);
  const finalStored = await uploadBuffer(
    finalBuffer,
    `edit-${job.id}-final.${normalizedFinal.extension}`,
    normalizedFinal.mimeType,
    {
      category: 'ai-generated',
      ownerId: job.ownerUserId,
      idempotencyKey: `${job.id}:final:${finalSha256}`,
    },
  );
  return storedAsset({
    stored: finalStored,
    job,
    kind: 'AI_GENERATED',
    buffer: finalBuffer,
    mimeType: normalizedFinal.mimeType,
    metadata: finalMetadata,
  });
}

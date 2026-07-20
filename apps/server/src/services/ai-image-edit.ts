import { createHash } from 'node:crypto';
import {
  AiMediaCapabilityError,
  AI_IMAGE_EDIT_MODEL,
  AI_IMAGE_EDIT_PROVIDER,
  assertAiMediaCapability,
} from './ai-image-provider-capabilities.js';
import {
  AI_IMAGE_EDIT_MASK_SEMANTICS,
  AiImageCompositorError,
  composeAiImageInpaint,
  validateAiImageEditCandidate,
  validateAiImageEditMask,
} from './ai-image-compositor.js';
import {
  AiImageJobError,
  type AiImageAssetInput,
  type AiImageJobRecord,
  type AiImageJobRepository,
  type AiImageProvider,
} from './ai-image-jobs.js';

export const AI_IMAGE_EDIT_MAX_INPUT_BYTES = 20 * 1024 * 1024;

export const AI_IMAGE_EDIT_POLICY_VERSION = 'ai-image-edit-policy/1.0';

type FrozenInputAsset = NonNullable<AiImageJobRecord['inputAssets']>[number];

export interface CreateAiImageEditMaskInput {
  ownerUserId: string;
  actorUserId: string;
  contextId: string;
  sourceAssetId: string;
  maskBuffer: Buffer;
  maskSemantics: typeof AI_IMAGE_EDIT_MASK_SEMANTICS;
}

export interface AiImageEditMaskDatabase {
  supplyGoods: { findFirst(args: unknown): Promise<any> };
  mediaAsset: {
    findFirst(args: unknown): Promise<any>;
    create(args: unknown): Promise<any>;
  };
}

export interface AiImageEditMaskStorage {
  uploadBuffer(
    buffer: Buffer,
    filename: string,
    mimeType: string,
    options: { category: 'raw'; ownerId: string; idempotencyKey: string },
  ): Promise<{ url: string; backend: string; filename?: string; key?: string }>;
}

function sha256(buffer: Buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function createAiImageEditMask(
  input: CreateAiImageEditMaskInput,
  deps: {
    database: AiImageEditMaskDatabase;
    getStorage: () => Promise<AiImageEditMaskStorage>;
    checkUploadQuota?: (
      ownerUserId: string,
      bytes: number,
    ) => Promise<{ allowed: true } | { allowed: false; reason: string }>;
  },
) {
  if (
    !input.ownerUserId
    || !input.actorUserId
    || !input.contextId
    || !input.sourceAssetId
    || input.maskSemantics !== AI_IMAGE_EDIT_MASK_SEMANTICS
  ) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Edit mask authority input is invalid');
  }
  const authority = await deps.database.supplyGoods.findFirst({
    where: { id: input.contextId, userId: input.ownerUserId },
    select: {
      id: true,
      sourceCaptureSubject: {
        select: {
          snapshots: {
            orderBy: [{ version: 'desc' }, { createdAt: 'desc' }],
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });
  const snapshotId = authority?.sourceCaptureSubject?.snapshots?.[0]?.id || null;
  const source = await deps.database.mediaAsset.findFirst({
    where: {
      id: input.sourceAssetId,
      ownerUserId: input.ownerUserId,
      kind: 'SOURCE_ORIGINAL',
      sourceCaptureSnapshotId: snapshotId || '__missing__',
    },
  });
  if (
    !authority
    || !snapshotId
    || !source
    || !/^[a-f0-9]{64}$/u.test(String(source.sha256 || ''))
    || !['local', 'oss'].includes(String(source.storageBackend || ''))
    || !String(source.storageKey || '').trim()
    || !Number.isSafeInteger(source.sizeBytes)
    || source.sizeBytes < 1
    || !Number.isSafeInteger(source.width)
    || !Number.isSafeInteger(source.height)
    || source.width < 1
    || source.height < 1
    || source.width * source.height > 12_000_000
  ) {
    throw new AiImageJobError('SOURCE_ASSET_NOT_FOUND', 'Owned current source asset was not found');
  }
  const diagnostics = await validateAiImageEditMask({
    maskBuffer: input.maskBuffer,
    expectedWidth: source.width,
    expectedHeight: source.height,
    maskSemantics: input.maskSemantics,
  }).catch((error) => {
    if (error instanceof AiImageCompositorError) {
      throw new AiImageJobError('INVALID_MEDIA_INPUT', error.message);
    }
    throw error;
  });
  const maskSha256 = diagnostics.maskSha256;
  const sourceMediaKey = `edit-mask:${source.id}:${maskSha256}`;
  const matchesStoredMask = (candidate: any) => {
    const metadata = candidate?.metadata && typeof candidate.metadata === 'object'
      ? candidate.metadata as Record<string, unknown>
      : {};
    return Boolean(
      candidate
      && candidate.ownerUserId === input.ownerUserId
      && candidate.kind === 'EDIT_MASK'
      && candidate.sourceCaptureSnapshotId === snapshotId
      && candidate.sourceMediaKey === sourceMediaKey
      && ['local', 'oss'].includes(String(candidate.storageBackend || ''))
      && String(candidate.storageKey || '').trim()
      && candidate.mimeType === 'image/png'
      && candidate.sizeBytes === input.maskBuffer.length
      && candidate.width === diagnostics.width
      && candidate.height === diagnostics.height
      && candidate.sha256 === maskSha256
      && metadata.maskSemantics === input.maskSemantics
      && metadata.sourceAssetId === source.id
      && metadata.sourceSha256 === source.sha256,
    );
  };
  const existing = await deps.database.mediaAsset.findFirst({
    where: {
      ownerUserId: input.ownerUserId,
      sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey,
      kind: 'EDIT_MASK',
      storageBackend: { in: ['local', 'oss'] },
    },
  });
  if (existing) {
    if (!matchesStoredMask(existing)) {
      throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Persisted edit mask conflicts with its source contract');
    }
    return { asset: existing, replayed: true, diagnostics };
  }

  const uploadLimit = await deps.checkUploadQuota?.(
    input.ownerUserId,
    input.maskBuffer.length,
  );
  if (uploadLimit && !uploadLimit.allowed) {
    throw new AiImageJobError('EDIT_RESOURCE_QUOTA_EXCEEDED', uploadLimit.reason);
  }

  const storage = await deps.getStorage();
  const uploadIdempotencyKey = sha256(Buffer.from([
    AI_IMAGE_EDIT_POLICY_VERSION,
    input.ownerUserId,
    source.id,
    source.sha256,
    maskSha256,
  ].join('\0')));
  const stored = await storage.uploadBuffer(
    input.maskBuffer,
    `edit-mask-${maskSha256.slice(0, 24)}.png`,
    'image/png',
    { category: 'raw', ownerId: input.ownerUserId, idempotencyKey: uploadIdempotencyKey },
  );
  const storageKey = stored.key || stored.filename || null;
  if (!['local', 'oss'].includes(stored.backend) || !storageKey || !stored.url) {
    throw new AiImageJobError('EDIT_STORAGE_NOT_READY', 'Edit mask requires durable local or OSS storage');
  }
  const data = {
    ownerUserId: input.ownerUserId,
    kind: 'EDIT_MASK' as const,
    sourceCaptureSnapshotId: snapshotId,
    sourceMediaKey,
    sourceUrl: null,
    url: stored.url,
    storageBackend: stored.backend,
    storageKey,
    mimeType: 'image/png',
    sizeBytes: input.maskBuffer.length,
    width: diagnostics.width,
    height: diagnostics.height,
    sha256: maskSha256,
    metadata: {
      contractVersion: AI_IMAGE_EDIT_POLICY_VERSION,
      maskSemantics: input.maskSemantics,
      sourceAssetId: source.id,
      sourceSha256: source.sha256,
      createdByActorUserId: input.actorUserId,
      editPixelCount: diagnostics.editPixelCount,
      preservedPixelCount: diagnostics.preservedPixelCount,
      featheredPixelCount: diagnostics.featheredPixelCount,
    },
  };
  try {
    const created = await deps.database.mediaAsset.create({ data });
    return { asset: created, replayed: false, diagnostics };
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;
    const winner = await deps.database.mediaAsset.findFirst({ where: {
      ownerUserId: input.ownerUserId,
      sourceCaptureSnapshotId: snapshotId,
      sourceMediaKey,
      storageBackend: stored.backend,
      kind: 'EDIT_MASK',
    } });
    if (!matchesStoredMask(winner)) throw error;
    return { asset: winner, replayed: true, diagnostics };
  }
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

function assertFrozenAsset(asset: FrozenInputAsset, job: AiImageJobRecord, expectedKind: string) {
  if (
    asset.kind !== expectedKind
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
}

function failure(error: unknown, attemptCount: number) {
  const compositorError = error instanceof AiImageCompositorError
    ? new AiImageJobError('INVALID_MEDIA_INPUT', error.message)
    : error;
  const known = compositorError instanceof AiImageJobError;
  return {
    error: compositorError,
    details: {
      attemptCount,
      errorCode: known ? compositorError.code : 'EDIT_PROCESSING_FAILED',
      errorMessage: known ? compositorError.message : 'AI image edit processing failed',
    },
  };
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

export async function runAiImageEditJob(
  jobId: string,
  attemptNumber: number,
  deps: {
    repository: AiImageJobRepository;
    provider: AiImageProvider;
    loadInputBuffer: (asset: FrozenInputAsset) => Promise<Buffer>;
    uploadBuffer: (
      buffer: Buffer,
      filename: string,
      mimeType?: string,
      options?: { category?: 'ai-generated'; ownerId?: string; idempotencyKey?: string },
    ) => Promise<{ url: string; backend: string; filename?: string; key?: string }>;
    assertExecutionLease?: () => void;
  },
): Promise<'completed' | 'ignored'> {
  let job = await deps.repository.getById(jobId);
  if (!job) throw new AiImageJobError('NOT_FOUND', 'AI image edit job not found');
  if (job.operation !== 'FULL_EDIT' && job.operation !== 'INPAINT') {
    throw new AiImageJobError('UNSUPPORTED_OPERATION', 'Job is not a manual image edit operation');
  }
  if (job.status === 'CANCEL_REQUESTED' || job.status === 'CANCELLED') {
    await deps.repository.markCancelled(job.id);
    return 'ignored';
  }
  if (job.status === 'SUCCEEDED' || job.status === 'FAILED') return 'ignored';
  if (job.status === 'RUNNING') return 'ignored';

  const claimed = await deps.repository.markRunning(job.id, attemptNumber);
  if (!claimed) return 'ignored';
  job = await deps.repository.getById(job.id);
  if (!job || job.status !== 'RUNNING') return 'ignored';
  if (job.operation !== 'FULL_EDIT' && job.operation !== 'INPAINT') {
    throw new AiImageJobError('UNSUPPORTED_OPERATION', 'Claimed job changed its edit operation');
  }
  const operation = job.operation;

  try {
    deps.assertExecutionLease?.();
    if (
      job.provider !== AI_IMAGE_EDIT_PROVIDER
      || job.model !== AI_IMAGE_EDIT_MODEL
      || deps.provider.name !== AI_IMAGE_EDIT_PROVIDER
    ) {
      throw new AiImageJobError('PROVIDER_CONFIG_CHANGED', 'AI image edit Provider does not match the frozen job');
    }
    assertOperationConfig(job);
    if (!deps.repository.recordProviderOutput) {
      throw new AiImageJobError('EDIT_PERSISTENCE_NOT_READY', 'Raw edit output persistence is not installed');
    }
    const { source, mask } = editInputs(job);
    assertFrozenAsset(source, job, 'SOURCE_ORIGINAL');
    if (mask) assertFrozenAsset(mask, job, 'EDIT_MASK');
    try {
      assertAiMediaCapability({
        provider: job.provider,
        model: job.model,
        operation,
        inputCount: 1,
        maskCount: mask ? 1 : 0,
      });
    } catch (error) {
      if (error instanceof AiMediaCapabilityError) throw new AiImageJobError(error.code, error.message);
      throw error;
    }

    const sourceBuffer = await deps.loadInputBuffer(source);
    if (sourceBuffer.length !== source.sizeBytes || sha256(sourceBuffer) !== source.sha256) {
      throw new AiImageJobError('FROZEN_INPUT_MISMATCH', 'Source bytes do not match the frozen asset identity');
    }
    await validateAiImageEditCandidate({
      buffer: sourceBuffer,
      expectedWidth: job.width,
      expectedHeight: job.height,
    });

    let maskBuffer: Buffer | null = null;
    if (mask) {
      maskBuffer = await deps.loadInputBuffer(mask);
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

    deps.assertExecutionLease?.();
    const generated = await deps.provider.generate({
      operation,
      operationConfig: job.operationConfig,
      prompt: job.resolvedPrompt ?? job.prompt,
      negativePrompt: job.resolvedNegativePrompt ?? job.negativePrompt,
      count: 1,
      width: job.width,
      height: job.height,
      model: job.model,
      inputAssets: job.inputAssets || undefined,
    });
    if (
      generated.images.length !== 1
      || generated.providerJobId
      || Number(generated.actualCostCents || 0) !== 0
    ) {
      throw new AiImageJobError('INVALID_PROVIDER_RESULT', 'Fake edit Provider must return one zero-cost synchronous image');
    }
    const raw = generated.images[0]!;
    const rawDiagnostics = await validateAiImageEditCandidate({
      buffer: raw.buffer,
      expectedWidth: job.width,
      expectedHeight: job.height,
    });
    const latestBeforeStorage = await deps.repository.getById(job.id);
    deps.assertExecutionLease?.();
    if (!latestBeforeStorage || ['CANCEL_REQUESTED', 'CANCELLED'].includes(latestBeforeStorage.status)) {
      await deps.repository.markCancelled(job.id);
      return 'ignored';
    }
    if (latestBeforeStorage.status !== 'RUNNING') return 'ignored';

    const rawSha256 = sha256(raw.buffer);
    const rawStored = await deps.uploadBuffer(
      raw.buffer,
      `edit-${job.id}-provider-raw.${rawDiagnostics.extension}`,
      rawDiagnostics.mimeType,
      {
        category: 'ai-generated',
        ownerId: job.ownerUserId,
        idempotencyKey: `${job.id}:provider-raw:${rawSha256}`,
      },
    );
    const rawAsset = storedAsset({
      stored: rawStored,
      job,
      kind: 'AI_PROVIDER_OUTPUT',
      buffer: raw.buffer,
      mimeType: rawDiagnostics.mimeType,
      metadata: {
        outputRole: 'PROVIDER_RAW',
        policyVersion: AI_IMAGE_EDIT_POLICY_VERSION,
        operation,
        providerOutputFormat: rawDiagnostics.format,
      },
    });
    deps.assertExecutionLease?.();
    const persistedRaw = await deps.repository.recordProviderOutput(job.id, rawAsset);

    const latestAfterRaw = await deps.repository.getById(job.id);
    deps.assertExecutionLease?.();
    if (!latestAfterRaw || ['CANCEL_REQUESTED', 'CANCELLED'].includes(latestAfterRaw.status)) {
      await deps.repository.markCancelled(job.id);
      return 'ignored';
    }
    if (latestAfterRaw.status !== 'RUNNING') return 'ignored';

    let finalBuffer = raw.buffer;
    let finalMimeType = rawDiagnostics.mimeType;
    let finalStored = rawStored;
    let finalMetadata: Record<string, unknown> = {
      outputRole: 'FINAL_CANDIDATE',
      policyVersion: AI_IMAGE_EDIT_POLICY_VERSION,
      operation,
      providerOutputAssetId: persistedRaw.id,
    };
    if (operation === 'INPAINT') {
      const composite = await composeAiImageInpaint({
        sourceBuffer,
        rawCandidateBuffer: raw.buffer,
        maskBuffer: maskBuffer!,
        maskSemantics: AI_IMAGE_EDIT_MASK_SEMANTICS,
      });
      finalBuffer = composite.buffer;
      finalMimeType = composite.mimeType;
      finalMetadata = {
        outputRole: 'FINAL_COMPOSITE',
        policyVersion: AI_IMAGE_EDIT_POLICY_VERSION,
        operation,
        providerOutputAssetId: persistedRaw.id,
        ...composite.diagnostics,
      };
      const finalSha256 = sha256(finalBuffer);
      finalStored = await deps.uploadBuffer(
        finalBuffer,
        `edit-${job.id}-composite.png`,
        finalMimeType,
        {
          category: 'ai-generated',
          ownerId: job.ownerUserId,
          idempotencyKey: `${job.id}:final:${finalSha256}`,
        },
      );
    }
    const finalAsset = storedAsset({
      stored: finalStored,
      job,
      kind: 'AI_GENERATED',
      buffer: finalBuffer,
      mimeType: finalMimeType,
      metadata: finalMetadata,
    });
    deps.assertExecutionLease?.();
    await deps.repository.complete(job.id, {
      providerJobId: null,
      actualCostCents: 0,
      billedUnits: 1,
      assets: [finalAsset],
    });
    return 'completed';
  } catch (error) {
    const normalized = failure(error, attemptNumber);
    const latest = await deps.repository.getById(job.id);
    if (latest?.status === 'CANCEL_REQUESTED') {
      await deps.repository.markCancelled(job.id);
      return 'ignored';
    }
    if (latest?.status === 'RUNNING') await deps.repository.markFailed(job.id, normalized.details);
    throw normalized.error;
  }
}

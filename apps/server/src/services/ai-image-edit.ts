import { createHash } from 'node:crypto';
import sharp from 'sharp';
import {
  AI_IMAGE_EDIT_MAX_INPUT_BYTES,
  AI_IMAGE_EDIT_POLICY_VERSION,
  assertAiImageEditInputPolicy,
  loadAiImageEditInputs,
  storeAiImageEditRaw,
  storeAiImageEditFinal,
  type AiImageEditUploadBuffer,
} from './ai-image-edit-artifacts.js';
import {
  AI_IMAGE_EDIT_MASK_SEMANTICS,
  AI_IMAGE_COMPOSITOR_YIELD_INTERVAL,
  AiImageCompositorError,
  validateAiImageEditCandidate,
  validateAiImageEditMask,
} from './ai-image-compositor.js';
import {
  AiImageJobError,
  type AiImageJobRecord,
  type AiImageJobRepository,
  type AiImageProvider,
  type AiImageProviderRuntimeInput,
} from './ai-image-jobs.js';
import {
  AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
  isAiMediaEditInputFromContext,
  isAiMediaEditReadySourceAsset,
} from './ai-image-edit-source.js';

export { AI_IMAGE_EDIT_MAX_INPUT_BYTES, AI_IMAGE_EDIT_POLICY_VERSION } from './ai-image-edit-artifacts.js';

type FrozenInputAsset = NonNullable<AiImageJobRecord['inputAssets']>[number];

export interface CreateAiImageEditMaskInput {
  ownerUserId: string;
  actorUserId: string;
  contextType?: 'collect' | 'listing-draft';
  contextId: string;
  contextSkuKey?: string | null;
  contextSlotKey?: string | null;
  contextDraftRevision?: number | null;
  contextDraftVersion?: number | null;
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

interface ListingDraftMaskContext {
  snapshot: { id: string };
  target: { assignedAssetId?: string | null };
  inputs: Array<{ assetId?: string | null; compatibleAssetIds?: string[] }>;
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
    loadListingDraftContext?: (
      ownerUserId: string,
      draftId: string,
      scope: {
        expectedRevision: number;
        expectedDraftVersion: number;
        skuKey?: string | null;
        slotKey?: string | null;
      },
    ) => Promise<ListingDraftMaskContext>;
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
  const contextType = input.contextType || 'collect';
  let snapshotId: string | null = null;
  let listingContext: ListingDraftMaskContext | null = null;
  if (contextType === 'listing-draft') {
    if (!Number.isSafeInteger(input.contextDraftRevision) || Number(input.contextDraftRevision) < 1
      || !Number.isSafeInteger(input.contextDraftVersion) || Number(input.contextDraftVersion) < 1
      || !deps.loadListingDraftContext) {
      throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Listing draft mask authority is incomplete');
    }
    try {
      listingContext = await deps.loadListingDraftContext(input.ownerUserId, input.contextId, {
        expectedRevision: Number(input.contextDraftRevision),
        expectedDraftVersion: Number(input.contextDraftVersion),
        skuKey: input.contextSkuKey,
        slotKey: input.contextSlotKey,
      });
    } catch (error: any) {
      if (error?.name === 'AiMediaContextError'
        || String(error?.code || '').startsWith('AI_MEDIA_CONTEXT_')
        || error?.code === 'STALE_MEDIA_CONTEXT') {
        throw new AiImageJobError('STALE_MEDIA_WORKFLOW', 'Listing draft context changed; refresh before drawing a mask');
      }
      throw error;
    }
    snapshotId = listingContext.snapshot.id;
  } else {
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
    snapshotId = authority?.sourceCaptureSubject?.snapshots?.[0]?.id || null;
  }
  const source = await deps.database.mediaAsset.findFirst({
    where: {
      id: input.sourceAssetId,
      ownerUserId: input.ownerUserId,
    },
    include: {
      aiImageJob: {
        include: { workflow: { include: { suiteSlot: true } } },
      },
    },
  });
  const listingAllowedAssetIds = new Set((listingContext?.inputs || []).flatMap((item) => [
    item.assetId,
    ...(item.compatibleAssetIds || []),
  ]).filter((id): id is string => Boolean(id)));
  const sourceAuthorized = contextType === 'listing-draft'
    ? Boolean(
      listingContext
      && snapshotId
      && ((source?.kind === 'SOURCE_ORIGINAL'
        && listingAllowedAssetIds.has(source.id)
        && isAiMediaEditReadySourceAsset(source))
        || (source?.sourceCaptureSnapshotId === snapshotId && isAiMediaEditInputFromContext(source, {
          ownerUserId: input.ownerUserId,
          contextType: 'listing-draft',
          contextId: input.contextId,
          contextSkuKey: input.contextSkuKey,
          contextSlotKey: input.contextSlotKey,
          contextDraftRevision: input.contextDraftRevision,
          contextDraftVersion: input.contextDraftVersion,
          sourceCaptureSnapshotId: snapshotId!,
        }))),
    )
    : Boolean(snapshotId && isAiMediaEditInputFromContext(source, {
      ownerUserId: input.ownerUserId,
      contextType: 'collect',
      contextId: input.contextId,
      contextSkuKey: input.contextSkuKey,
      contextSlotKey: input.contextSlotKey,
      sourceCaptureSnapshotId: snapshotId!,
    }));
  if (!sourceAuthorized) {
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
  const sourceMediaKey = contextType === 'listing-draft'
    ? `edit-mask:v2:${sha256(Buffer.from(JSON.stringify({
      contextType,
      contextId: input.contextId,
      contextDraftRevision: input.contextDraftRevision,
      contextDraftVersion: input.contextDraftVersion,
      contextSkuKey: input.contextSkuKey || null,
      contextSlotKey: input.contextSlotKey || null,
      sourceAssetId: source.id,
      maskSha256,
    })))}:${maskSha256}`
    : `edit-mask:${source.id}:${maskSha256}`;
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
      && metadata.sourceSha256 === source.sha256
      && (metadata.contextType == null ? contextType === 'collect' : (
        metadata.contextType === contextType
        && metadata.contextId === input.contextId
        && (metadata.contextSkuKey ?? null) === (input.contextSkuKey ?? null)
        && (metadata.contextSlotKey ?? null) === (input.contextSlotKey ?? null)
      ))
      && (contextType !== 'listing-draft' || (
        metadata.contextDraftRevision === input.contextDraftRevision
        && metadata.contextDraftVersion === input.contextDraftVersion
      )),
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
    ...(contextType === 'listing-draft' ? [
      contextType,
      input.contextId,
      String(input.contextDraftRevision),
      String(input.contextDraftVersion),
      input.contextSkuKey || '',
      input.contextSlotKey || '',
    ] : []),
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
      contextType,
      contextId: input.contextId,
      contextSkuKey: input.contextSkuKey || null,
      contextSlotKey: input.contextSlotKey || null,
      ...(contextType === 'listing-draft' ? {
        contextDraftRevision: input.contextDraftRevision,
        contextDraftVersion: input.contextDraftVersion,
      } : {}),
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

function failure(error: unknown, attemptCount: number) {
  const compositorError = error instanceof AiImageCompositorError
    ? new AiImageJobError('INVALID_MEDIA_INPUT', error.message)
    : error;
  const known = compositorError instanceof AiImageJobError;
  const evidence = compositorError && typeof compositorError === 'object'
    ? compositorError as {
      providerJobId?: unknown;
      providerAcceptedAt?: unknown;
      providerSubmissionUncertain?: unknown;
      providerSubmissionRejected?: unknown;
    }
    : {};
  const providerJobId = typeof evidence.providerJobId === 'string'
    && evidence.providerJobId.trim()
    ? evidence.providerJobId.trim()
    : undefined;
  const providerAcceptedAt = evidence.providerAcceptedAt instanceof Date
    && !Number.isNaN(evidence.providerAcceptedAt.getTime())
    ? evidence.providerAcceptedAt
    : undefined;
  return {
    error: compositorError,
    details: {
      attemptCount,
      errorCode: known ? compositorError.code : 'EDIT_PROCESSING_FAILED',
      errorMessage: known ? compositorError.message : 'AI image edit processing failed',
      ...(providerJobId ? { providerJobId } : {}),
      ...(providerAcceptedAt ? { providerAcceptedAt } : {}),
      ...(evidence.providerSubmissionUncertain === true
        ? { providerSubmissionUncertain: true }
        : {}),
      ...(evidence.providerSubmissionRejected === true
        ? { providerSubmissionRejected: true }
        : {}),
    },
  };
}

async function yieldToEventLoop() {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function createOpenAiAlphaMask(
  maskBuffer: Buffer,
  expectedWidth: number,
  expectedHeight: number,
): Promise<AiImageProviderRuntimeInput> {
  const decoded = await sharp(maskBuffer, {
    animated: false,
    limitInputPixels: AI_MEDIA_EDIT_SOURCE_MAX_PIXELS,
  }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (
    decoded.info.width !== expectedWidth
    || decoded.info.height !== expectedHeight
    || decoded.info.channels !== 4
  ) {
    throw new AiImageJobError(
      'INVALID_MEDIA_INPUT',
      'OpenAI edit mask dimensions do not match the frozen source',
    );
  }
  const openAiRgba = Buffer.alloc(decoded.data.length);
  const pixelCount = expectedWidth * expectedHeight;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const offset = pixel * 4;
    const internalWeight = decoded.data[offset]!;
    openAiRgba[offset] = 255;
    openAiRgba[offset + 1] = 255;
    openAiRgba[offset + 2] = 255;
    openAiRgba[offset + 3] = 255 - internalWeight;
    if ((pixel + 1) % AI_IMAGE_COMPOSITOR_YIELD_INTERVAL === 0) {
      await yieldToEventLoop();
    }
  }
  const buffer = await sharp(openAiRgba, {
    raw: { width: expectedWidth, height: expectedHeight, channels: 4 },
  }).png({ compressionLevel: 9, adaptiveFiltering: true, palette: false }).toBuffer();
  if (buffer.length > AI_IMAGE_EDIT_MAX_INPUT_BYTES) {
    throw new AiImageJobError(
      'INVALID_MEDIA_INPUT',
      'OpenAI edit mask exceeds the encoded byte limit',
    );
  }
  return { buffer, mimeType: 'image/png' };
}

export async function runAiImageEditJob(
  jobId: string,
  attemptNumber: number,
  deps: {
    repository: AiImageJobRepository;
    provider: AiImageProvider;
    loadInputBuffer: (asset: FrozenInputAsset) => Promise<Buffer>;
    uploadBuffer: AiImageEditUploadBuffer;
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
  let acceptedProviderEvidence: {
    providerJobId?: string;
    providerAcceptedAt?: Date;
  } = {};
  let paidProviderResultReceived = false;
  let providerDispatchStarted = false;

  try {
    deps.assertExecutionLease?.();
    if (
      !job.provider.trim()
      || !job.model.trim()
      || deps.provider.name !== job.provider
    ) {
      throw new AiImageJobError('PROVIDER_CONFIG_CHANGED', 'AI image edit Provider does not match the frozen job');
    }
    const paidProviderInvocation = job.provider !== 'fake';
    if (paidProviderInvocation && (
      !deps.repository.recordProviderDispatchStarted
      || !deps.repository.recordProviderJobId
      || !deps.repository.markSubmissionUncertain
    )) {
      throw new AiImageJobError(
        'EDIT_PERSISTENCE_NOT_READY',
        'Paid AI image edit dispatch evidence persistence is not installed',
      );
    }
    assertAiImageEditInputPolicy(job);
    if (!deps.repository.recordProviderOutput) {
      throw new AiImageJobError('EDIT_PERSISTENCE_NOT_READY', 'Raw edit output persistence is not installed');
    }
    const inputs = await loadAiImageEditInputs(job, deps.loadInputBuffer);
    const { sourceBuffer, sourceMimeType, maskBuffer } = inputs;
    const providerMask = maskBuffer
      ? await createOpenAiAlphaMask(maskBuffer, job.width, job.height)
      : null;

    deps.assertExecutionLease?.();
    if (paidProviderInvocation) {
      const dispatchFenced = await deps.repository.recordProviderDispatchStarted!(job.id, new Date());
      if (!dispatchFenced) {
        const latest = await deps.repository.getById(job.id);
        if (latest?.status === 'CANCEL_REQUESTED' || latest?.status === 'CANCELLED') {
          await deps.repository.markCancelled(job.id);
        }
        return 'ignored';
      }
      providerDispatchStarted = true;
    }
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
      inputImages: [{ buffer: sourceBuffer, mimeType: sourceMimeType }],
      mask: providerMask,
    });
    paidProviderResultReceived = paidProviderInvocation;
    if (generated.providerJobId) {
      const providerAcceptedAt = new Date();
      acceptedProviderEvidence = {
        providerJobId: generated.providerJobId,
        providerAcceptedAt,
      };
      try {
        await deps.repository.recordProviderJobId!(
          job.id,
          generated.providerJobId,
          providerAcceptedAt,
        );
      } catch (error) {
        const acceptedError = error instanceof Error ? error : new Error(String(error));
        throw Object.assign(acceptedError, acceptedProviderEvidence);
      }
    }
    const actualCostCents = generated.actualCostCents ?? job.estimatedCostCents;
    if (job.provider === 'fake') {
      if (
        generated.images.length !== 1
        || generated.providerJobId
        || Number(actualCostCents) !== 0
      ) {
        throw new AiImageJobError(
          'INVALID_PROVIDER_RESULT',
          'Fake edit Provider must return one zero-cost synchronous image',
        );
      }
    } else if (
      generated.images.length !== 1
      || !Number.isSafeInteger(actualCostCents)
      || actualCostCents < 0
    ) {
      throw new AiImageJobError(
        'INVALID_PROVIDER_RESULT',
        'Paid edit Provider must return one image with a valid actual cost',
      );
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
      if (paidProviderResultReceived && !acceptedProviderEvidence.providerJobId) {
        await deps.repository.markCancelled(job.id, { providerSubmissionUncertain: true });
      } else {
        await deps.repository.markCancelled(job.id);
      }
      return 'ignored';
    }
    if (latestBeforeStorage.status !== 'RUNNING') return 'ignored';

    const rawAsset = await storeAiImageEditRaw(job, raw.buffer, deps.uploadBuffer, rawDiagnostics);
    deps.assertExecutionLease?.();
    const persistedRaw = await deps.repository.recordProviderOutput(job.id, rawAsset);

    const latestAfterRaw = await deps.repository.getById(job.id);
    deps.assertExecutionLease?.();
    if (!latestAfterRaw || ['CANCEL_REQUESTED', 'CANCELLED'].includes(latestAfterRaw.status)) {
      if (paidProviderResultReceived && !acceptedProviderEvidence.providerJobId) {
        await deps.repository.markCancelled(job.id, { providerSubmissionUncertain: true });
      } else {
        await deps.repository.markCancelled(job.id);
      }
      return 'ignored';
    }
    if (latestAfterRaw.status !== 'RUNNING') return 'ignored';

    const finalAsset = await storeAiImageEditFinal(job, inputs, raw.buffer, persistedRaw.id, deps.uploadBuffer);
    deps.assertExecutionLease?.();
    await deps.repository.complete(job.id, {
      providerJobId: generated.providerJobId || null,
      providerResultReceivedWithoutIdentity:
        paidProviderResultReceived && !generated.providerJobId,
      actualCostCents,
      billedUnits: 1,
      assets: [finalAsset],
    });
    return 'completed';
  } catch (error) {
    const normalized = failure(error, attemptNumber);
    const details = {
      ...acceptedProviderEvidence,
      ...normalized.details,
    };
    const latest = await deps.repository.getById(job.id);
    if (latest?.status === 'CANCEL_REQUESTED' || latest?.status === 'CANCELLED') {
      const uncertainCancellation = (
        details.providerSubmissionUncertain
        || paidProviderResultReceived
        || (providerDispatchStarted && details.providerSubmissionRejected !== true)
      ) && !details.providerJobId;
      if (uncertainCancellation) {
        await deps.repository.markCancelled(job.id, { providerSubmissionUncertain: true });
      } else if (details.providerJobId || details.providerSubmissionRejected === true) {
        // Preserve accepted identity or definite rejection through the repository's cancellation settlement.
        await deps.repository.markFailed(job.id, details);
      } else {
        await deps.repository.markCancelled(job.id);
      }
      return 'ignored';
    }
    // A concurrent terminal failure must not discard late acceptance. The
    // repository binds its identity without reopening the job or its budget.
    if (latest?.status === 'RUNNING' || (latest?.status === 'FAILED' && details.providerJobId)) {
      const submissionUncertain = (
        details.providerSubmissionUncertain
        || paidProviderResultReceived
        || (providerDispatchStarted && details.providerSubmissionRejected !== true)
      ) && !details.providerJobId;
      if (submissionUncertain && deps.repository.markSubmissionUncertain) {
        await deps.repository.markSubmissionUncertain(job.id, {
          ...details,
          providerSubmissionUncertain: true,
        });
      } else {
        await deps.repository.markFailed(job.id, details);
      }
    }
    throw normalized.error;
  }
}

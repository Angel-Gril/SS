import { createHash, randomUUID } from 'node:crypto';
import {
  AiMediaCapabilityError,
  assertAiMediaCapability,
  type AiMediaOperation,
} from './ai-image-provider-capabilities.js';
import { AiImageJobError } from './ai-image-job-error.js';

export { AiImageJobError } from './ai-image-job-error.js';

export type AiImageJobStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'RUNNING'
  | 'RETRYING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED';

export interface AiImageJobCostReservation {
  id: string;
  status: 'RESERVED' | 'SUBMISSION_UNCERTAIN' | 'RECONCILIATION_REQUIRED' | 'SETTLED' | 'RELEASED';
  estimatedCostMinor: number;
  maximumCostMinor: number;
  provider: string;
  model: string;
  requestFingerprint: string;
}

export interface AiImageJobRecord {
  id: string;
  ownerUserId: string;
  actorUserId: string;
  status: AiImageJobStatus;
  operation?: AiMediaOperation;
  operationConfig?: Record<string, unknown> | null;
  workflowId?: string | null;
  workflowAttempt?: number | null;
  provider: string;
  model: string;
  prompt: string;
  negativePrompt: string | null;
  resolvedPrompt?: string | null;
  resolvedNegativePrompt?: string | null;
  templateKey?: string | null;
  templateReleaseId?: string | null;
  templateChecksum?: string | null;
  templateSnapshot?: Record<string, unknown> | null;
  requestFingerprint?: string | null;
  requestedImageCount: number;
  width: number;
  height: number;
  attemptCount: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  estimatedCostCents: number;
  actualCostCents: number | null;
  billedUnits: number;
  costReservation?: AiImageJobCostReservation | null;
  providerJobId: string | null;
  providerDispatchedAt?: Date | null;
  providerReconciliationStatus?:
    | 'NOT_REQUIRED'
    | 'PENDING'
    | 'RUNNING'
    | 'RETRY_WAIT'
    | 'MANUAL_REVIEW'
    | 'RECOVERED'
    | 'NO_OUTPUT'
    | 'NOT_SUBMITTED'
    | 'CANCELLED_OUTPUT_RETAINED';
  providerReconciliationRevision?: number;
  providerReconciliationAttemptCount?: number;
  providerReconciliationNextAt?: Date | null;
  providerReconciliationDeadlineAt?: Date | null;
  providerReconciliationLastProviderStatus?: string | null;
  providerReconciliationLastErrorCode?: string | null;
  providerReconciliationLastErrorMessage?: string | null;
  providerReconciledAt?: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  appliedMode?: 'append' | 'replace' | null;
  appliedAt?: Date | null;
  inputAssets?: Array<{
    assetId: string;
    role: 'REFERENCE' | 'MASK';
    ordinal?: number;
    url?: string;
    mimeType?: string;
    sha256?: string | null;
    sizeBytes?: number | null;
    width?: number | null;
    height?: number | null;
    storageBackend?: string | null;
    storageKey?: string | null;
    kind?: 'SOURCE_ORIGINAL' | 'EDIT_MASK' | 'AI_GENERATED' | 'AI_PROVIDER_OUTPUT';
  }> | null;
}

export interface AiImageProviderRequest {
  operation?: AiMediaOperation;
  operationConfig?: Record<string, unknown> | null;
  prompt: string;
  negativePrompt: string | null;
  count: number;
  width: number;
  height: number;
  model: string;
  inputAssets?: NonNullable<AiImageJobRecord['inputAssets']>;
  inputImages?: AiImageProviderRuntimeInput[];
  mask?: AiImageProviderRuntimeInput | null;
}

export interface AiImageProviderRuntimeInput {
  buffer: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export interface AiImageProviderResult {
  images: Array<{ buffer: Buffer; mimeType: string; filename?: string }>;
  providerJobId?: string | null;
  actualCostCents?: number | null;
}

export interface AiImageProvider {
  name: string;
  assertReady?(request: AiImageProviderRequest): void | Promise<void>;
  generate(request: AiImageProviderRequest): Promise<AiImageProviderResult>;
}

export type AiImageJobProvider = AiImageProvider;

export interface AiImageAssetInput {
  ownerUserId: string;
  jobId: string;
  kind?: 'AI_GENERATED' | 'AI_PROVIDER_OUTPUT';
  url: string;
  storageBackend: string;
  storageKey: string | null;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  width?: number | null;
  height?: number | null;
  metadata?: Record<string, unknown> | null;
}

export interface AiImageJobRepository {
  getById(id: string): Promise<AiImageJobRecord | null>;
  markRunning(id: string, attemptCount: number): Promise<boolean>;
  markRetrying(id: string, data: FailureUpdate): Promise<void>;
  markFailed(id: string, data: FailureUpdate): Promise<void>;
  markEnqueueFailed?(id: string, data: FailureUpdate): Promise<boolean>;
  markCancelled(id: string, data?: { providerSubmissionUncertain?: boolean }): Promise<void>;
  markSubmissionUncertain?(id: string, data: FailureUpdate): Promise<void>;
  recoverInterruptedJob?(id: string, data: FailureUpdate): Promise<'FAILED_PRE_DISPATCH' | 'SUBMISSION_UNCERTAIN' | null>;
  recordProviderDispatchStarted?(id: string, providerDispatchedAt: Date): Promise<boolean>;
  recordProviderJobId?(id: string, providerJobId: string, providerAcceptedAt?: Date): Promise<void>;
  recordProviderOutput?(id: string, asset: AiImageAssetInput): Promise<{ id: string } & AiImageAssetInput>;
  complete(id: string, data: {
    providerJobId: string | null;
    providerResultReceivedWithoutIdentity?: boolean;
    actualCostCents: number;
    billedUnits: number;
    assets: AiImageAssetInput[];
  }): Promise<void>;
  createWithQuota(
    input: CreateAiImageJobInput,
    dailyLimit: number,
    globalDailyBudgetCents?: number,
  ): Promise<CreateWithQuotaResult>;
  requestCancellation(id: string, ownerUserId: string): Promise<AiImageJobRecord | null>;
  recordApplication(id: string, data: ApplyAiImageJobInput): Promise<AiImageJobRecord>;
}

interface FailureUpdate {
  attemptCount: number;
  errorCode: string;
  errorMessage: string;
  providerJobId?: string;
  providerAcceptedAt?: Date;
  providerSubmissionUncertain?: boolean;
  providerSubmissionRejected?: boolean;
}

export interface CreateAiImageJobInput {
  ownerUserId: string;
  actorUserId: string;
  idempotencyKey: string | null;
  prompt: string;
  negativePrompt?: string | null;
  resolvedPrompt?: string | null;
  resolvedNegativePrompt?: string | null;
  templateKey?: string | null;
  templateReleaseId?: string | null;
  templateChecksum?: string | null;
  templateSnapshot?: Record<string, unknown> | null;
  requestFingerprint?: string | null;
  operationConfig?: Record<string, unknown> | null;
  provider: string;
  model: string;
  count: number;
  width: number;
  height: number;
  estimatedCostCents: number;
}

export type CreateWithQuotaResult =
  | { kind: 'created'; job: AiImageJobRecord }
  | { kind: 'existing'; job: AiImageJobRecord }
  | { kind: 'quota-exceeded'; used: number; limit: number }
  | {
    kind: 'budget-exceeded';
    settledCostCents: number;
    pendingMaximumCostCents: number;
    requestedMaximumCostCents: number;
    limit: number;
  }
  | { kind: 'invalid-cost'; reason: string };

export interface ApplyAiImageJobInput {
  mode: 'append' | 'replace';
  targetType: string;
  targetId: string;
}

function capabilityJobError(error: unknown) {
  if (error instanceof AiMediaCapabilityError) return new AiImageJobError(error.code, error.message);
  return new AiImageJobError('UNSUPPORTED_OPERATION', error instanceof Error ? error.message : 'Unsupported AI media operation');
}

export function createDisabledAiImageProvider(): AiImageProvider {
  return {
    name: 'disabled',
    async generate() {
      throw new AiImageJobError('PROVIDER_DISABLED', 'AI image generation provider is disabled');
    },
  };
}

export function createFakeAiImageProvider(result: AiImageProviderResult): AiImageProvider {
  return {
    name: 'fake',
    async generate() {
      return result;
    },
  };
}

function extensionForMime(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function errorDetails(error: unknown): Omit<FailureUpdate, 'attemptCount'> {
  const candidate = error && typeof error === 'object'
    ? error as {
      providerJobId?: unknown;
      providerAcceptedAt?: unknown;
      providerSubmissionUncertain?: unknown;
      providerSubmissionRejected?: unknown;
    }
    : {};
  const providerJobId = typeof candidate.providerJobId === 'string' && candidate.providerJobId.trim()
    ? candidate.providerJobId.trim()
    : undefined;
  const providerAcceptedAt = candidate.providerAcceptedAt instanceof Date
    && !Number.isNaN(candidate.providerAcceptedAt.getTime())
    ? candidate.providerAcceptedAt
    : undefined;
  const details = error instanceof AiImageJobError
    ? { errorCode: error.code, errorMessage: error.message }
    : error instanceof Error
      ? { errorCode: 'PROVIDER_ERROR', errorMessage: error.message }
      : { errorCode: 'PROVIDER_ERROR', errorMessage: String(error) };
  return {
    ...details,
    ...(providerJobId ? { providerJobId } : {}),
    ...(providerAcceptedAt ? { providerAcceptedAt } : {}),
    ...(candidate.providerSubmissionUncertain === true ? { providerSubmissionUncertain: true } : {}),
    ...(candidate.providerSubmissionRejected === true ? { providerSubmissionRejected: true } : {}),
  };
}

type FrozenInputAsset = NonNullable<AiImageJobRecord['inputAssets']>[number];
type RuntimeImageMime = AiImageProviderRuntimeInput['mimeType'];

const AI_IMAGE_MAX_RUNTIME_INPUT_BYTES = 20 * 1024 * 1024;

function normalizedRuntimeImageMime(value: unknown): RuntimeImageMime | null {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'image/jpg') return 'image/jpeg';
  if (normalized === 'image/png' || normalized === 'image/jpeg' || normalized === 'image/webp') {
    return normalized;
  }
  return null;
}

function detectedRuntimeImageMime(buffer: Buffer): RuntimeImageMime | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png';
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg';
  }
  if (buffer.length >= 12
    && buffer.subarray(0, 4).toString('ascii') === 'RIFF'
    && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
    return 'image/webp';
  }
  return null;
}

function frozenImageToImageReferences(job: AiImageJobRecord): Array<{
  asset: FrozenInputAsset;
  mimeType: RuntimeImageMime;
}> {
  const inputs = job.inputAssets || [];
  if (!inputs.length || inputs.some((asset) => asset.role !== 'REFERENCE')) {
    throw new AiImageJobError(
      'INVALID_MEDIA_INPUT',
      'IMAGE_TO_IMAGE requires only frozen reference image inputs',
    );
  }

  const assetIds = new Set<string>();
  const ordinals = new Set<number>();
  const references = inputs.map((asset) => {
    const assetId = String(asset.assetId || '').trim();
    const ordinal = Number(asset.ordinal);
    const mimeType = normalizedRuntimeImageMime(asset.mimeType);
    const sha = String(asset.sha256 || '').trim().toLowerCase();
    const sizeBytes = Number(asset.sizeBytes);
    const storageBackend = String(asset.storageBackend || '').trim();
    const storageKey = String(asset.storageKey || '').trim();
    if (
      !assetId
      || assetIds.has(assetId)
      || !Number.isSafeInteger(ordinal)
      || ordinal < 0
      || ordinals.has(ordinal)
      || !mimeType
      || !/^[a-f0-9]{64}$/u.test(sha)
      || !Number.isSafeInteger(sizeBytes)
      || sizeBytes < 1
      || sizeBytes > AI_IMAGE_MAX_RUNTIME_INPUT_BYTES
      || !['local', 'oss'].includes(storageBackend)
      || !storageKey
    ) {
      throw new AiImageJobError(
        'INVALID_MEDIA_INPUT',
        'Frozen IMAGE_TO_IMAGE reference is incomplete, duplicated, or not in trusted storage',
      );
    }
    assetIds.add(assetId);
    ordinals.add(ordinal);
    return { asset, mimeType };
  }).sort((left, right) => Number(left.asset.ordinal) - Number(right.asset.ordinal));

  if (references.some((reference, index) => reference.asset.ordinal !== index)) {
    throw new AiImageJobError(
      'INVALID_MEDIA_INPUT',
      'Frozen IMAGE_TO_IMAGE reference ordinals must be contiguous from zero',
    );
  }
  return references;
}

async function loadFrozenImageToImageInputs(
  job: AiImageJobRecord,
  loadInputBuffer: ((asset: FrozenInputAsset) => Promise<Buffer>) | undefined,
): Promise<{
  inputAssets: FrozenInputAsset[];
  inputImages: AiImageProviderRuntimeInput[];
}> {
  const references = frozenImageToImageReferences(job);
  if (!loadInputBuffer) {
    throw new AiImageJobError(
      'INVALID_MEDIA_INPUT',
      'IMAGE_TO_IMAGE requires a trusted local or OSS input reader',
    );
  }

  const inputImages: AiImageProviderRuntimeInput[] = [];
  for (const { asset, mimeType } of references) {
    const buffer = await loadInputBuffer(asset);
    if (!Buffer.isBuffer(buffer)) {
      throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Frozen input reader returned invalid image bytes');
    }
    if (buffer.length !== asset.sizeBytes
      || createHash('sha256').update(buffer).digest('hex') !== String(asset.sha256).toLowerCase()) {
      throw new AiImageJobError(
        'FROZEN_INPUT_MISMATCH',
        'Stored image input does not match the frozen asset identity',
      );
    }
    if (detectedRuntimeImageMime(buffer) !== mimeType) {
      throw new AiImageJobError(
        'FROZEN_INPUT_MISMATCH',
        'Stored image input MIME does not match the frozen asset identity',
      );
    }
    inputImages.push({ buffer, mimeType });
  }
  return {
    inputAssets: references.map(({ asset }) => asset),
    inputImages,
  };
}

export async function runAiImageJob(
  jobId: string,
  attemptNumber: number,
  deps: {
    repository: AiImageJobRepository;
    provider: AiImageProvider;
    uploadBuffer: (
      buffer: Buffer,
      filename: string,
      mimeType?: string,
      options?: { category?: 'ai-generated'; ownerId?: string },
    ) => Promise<{ url: string; backend: string; filename?: string; key?: string }>;
    loadInputBuffer?: (asset: FrozenInputAsset) => Promise<Buffer>;
    maxAttempts?: number;
  },
) {
  const job = await deps.repository.getById(jobId);
  if (!job) throw new AiImageJobError('NOT_FOUND', 'AI image job not found');
  if (job.status === 'CANCEL_REQUESTED' || job.status === 'CANCELLED') {
    await deps.repository.markCancelled(job.id);
    return;
  }
  if (job.status === 'SUCCEEDED') return;

  const claimed = await deps.repository.markRunning(job.id, attemptNumber);
  if (!claimed) return;
  let acceptedProviderEvidence: Pick<FailureUpdate, 'providerJobId' | 'providerAcceptedAt'> = {};
  let paidProviderResultReceived = false;
  let providerDispatchStarted = false;
  try {
    const operation = job.operation || 'TEXT_TO_IMAGE';
    if (operation !== 'TEXT_TO_IMAGE' && operation !== 'IMAGE_TO_IMAGE') {
      throw new AiImageJobError(
        'UNSUPPORTED_OPERATION',
        `${operation} must run through its operation-specific worker`,
      );
    }
    try {
      assertAiMediaCapability({
        provider: job.provider,
        model: job.model,
        operation,
        inputCount: job.inputAssets?.filter((asset) => asset.role === 'REFERENCE').length || 0,
        hasMask: Boolean(job.inputAssets?.some((asset) => asset.role === 'MASK')),
      });
    } catch (error) { throw capabilityJobError(error); }
    const runtimeInputs = operation === 'IMAGE_TO_IMAGE'
      ? await loadFrozenImageToImageInputs(job, deps.loadInputBuffer)
      : null;
    const paidProviderInvocation = job.provider !== 'fake' && deps.provider.name !== 'disabled';
    const providerRequest: AiImageProviderRequest = {
      operation,
      prompt: job.resolvedPrompt ?? job.prompt,
      negativePrompt: job.resolvedNegativePrompt ?? job.negativePrompt,
      count: job.requestedImageCount,
      width: job.width,
      height: job.height,
      model: job.model,
      inputAssets: runtimeInputs?.inputAssets,
      inputImages: runtimeInputs?.inputImages,
    };
    await deps.provider.assertReady?.(providerRequest);
    if (paidProviderInvocation && deps.repository.recordProviderDispatchStarted) {
      const dispatchFenced = await deps.repository.recordProviderDispatchStarted(job.id, new Date());
      if (!dispatchFenced) {
        const latest = await deps.repository.getById(job.id);
        if (latest?.status === 'CANCEL_REQUESTED' || latest?.status === 'CANCELLED') {
          await deps.repository.markCancelled(job.id);
        }
        return;
      }
    }
    providerDispatchStarted = paidProviderInvocation;
    const generated = await deps.provider.generate(providerRequest);
    paidProviderResultReceived = job.provider !== 'fake' && deps.provider.name !== 'disabled';
    if (generated.providerJobId) {
      const providerAcceptedAt = new Date();
      acceptedProviderEvidence = { providerJobId: generated.providerJobId, providerAcceptedAt };
      if (deps.repository.recordProviderJobId) {
        try {
          await deps.repository.recordProviderJobId(job.id, generated.providerJobId, providerAcceptedAt);
        } catch (error) {
          const acceptedError = error instanceof Error ? error : new Error(String(error));
          throw Object.assign(acceptedError, {
            providerJobId: generated.providerJobId,
            providerAcceptedAt,
          });
        }
      }
    }
    const latest = await deps.repository.getById(job.id);
    if (latest?.status === 'CANCEL_REQUESTED' || latest?.status === 'CANCELLED') {
      const cancellationEvidence = paidProviderResultReceived && !acceptedProviderEvidence.providerJobId
        ? { providerSubmissionUncertain: true }
        : undefined;
      if (cancellationEvidence) await deps.repository.markCancelled(job.id, cancellationEvidence);
      else await deps.repository.markCancelled(job.id);
      return;
    }
    if (!latest || latest.status !== 'RUNNING') return;

    const assets: AiImageAssetInput[] = [];
    for (const image of generated.images) {
      const filename = image.filename || `ai-${job.id}-${randomUUID()}.${extensionForMime(image.mimeType)}`;
      const stored = await deps.uploadBuffer(image.buffer, filename, image.mimeType, {
        category: 'ai-generated',
        ownerId: job.ownerUserId,
      });
      assets.push({
        ownerUserId: job.ownerUserId,
        jobId: job.id,
        url: stored.url,
        storageBackend: stored.backend,
        storageKey: stored.key || stored.filename || null,
        mimeType: image.mimeType,
        sizeBytes: image.buffer.length,
        sha256: createHash('sha256').update(image.buffer).digest('hex'),
      });
    }
    if (assets.length === 0) throw new AiImageJobError('EMPTY_RESULT', 'Provider returned no images');
    await deps.repository.complete(job.id, {
      providerJobId: generated.providerJobId || null,
      providerResultReceivedWithoutIdentity: paidProviderResultReceived && !generated.providerJobId,
      actualCostCents: generated.actualCostCents ?? job.estimatedCostCents,
      billedUnits: assets.length,
      assets,
    });
  } catch (error) {
    const details = {
      attemptCount: attemptNumber,
      ...acceptedProviderEvidence,
      ...errorDetails(error),
    };
    if ((details.providerSubmissionUncertain
      || paidProviderResultReceived
      || (providerDispatchStarted && details.providerSubmissionRejected !== true))
      && !details.providerJobId) {
      const uncertainDetails = { ...details, providerSubmissionUncertain: true };
      if (deps.repository.markSubmissionUncertain) {
        await deps.repository.markSubmissionUncertain(job.id, uncertainDetails);
      } else {
        await deps.repository.markFailed(job.id, uncertainDetails);
      }
      throw error;
    }
    const permanent = Boolean(details.providerJobId)
      || details.providerSubmissionRejected === true
      || (error instanceof AiImageJobError
        && [
          'UNSUPPORTED_PROVIDER_MODEL',
          'UNSUPPORTED_OPERATION',
          'PROVIDER_NOT_READY',
          'INVALID_MEDIA_INPUT',
          'FROZEN_INPUT_MISMATCH',
        ].includes(error.code));
    if (!permanent && attemptNumber < (deps.maxAttempts ?? job.maxAttempts)) await deps.repository.markRetrying(job.id, details);
    else await deps.repository.markFailed(job.id, details);
    throw error;
  }
}

export async function createAiImageJob(
  input: CreateAiImageJobInput,
  repository: Pick<AiImageJobRepository, 'createWithQuota'>,
  dailyLimit: number,
  globalDailyBudgetCents?: number,
) {
  if (!input.prompt.trim()) throw new AiImageJobError('INVALID_REQUEST', 'Prompt is required');
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 4) {
    throw new AiImageJobError('INVALID_REQUEST', 'Image count must be between 1 and 4');
  }
  try {
    assertAiMediaCapability({ provider: input.provider, model: input.model, operation: 'TEXT_TO_IMAGE' });
  } catch (error) { throw capabilityJobError(error); }
  if (input.provider !== 'fake'
    && (!Number.isSafeInteger(input.estimatedCostCents) || input.estimatedCostCents <= 0)) {
    throw new AiImageJobError(
      'PROVIDER_NOT_READY',
      'A verified positive task cost is required before paid AI image generation',
    );
  }
  const result = input.provider === 'fake' && globalDailyBudgetCents === undefined
    ? await repository.createWithQuota(input, dailyLimit)
    : await repository.createWithQuota(input, dailyLimit, globalDailyBudgetCents ?? 0);
  if (result.kind === 'quota-exceeded') {
    throw new AiImageJobError('QUOTA_EXCEEDED', `Daily image quota exceeded (${result.used}/${result.limit})`);
  }
  if (result.kind === 'budget-exceeded') {
    const exposure = result.settledCostCents
      + result.pendingMaximumCostCents
      + result.requestedMaximumCostCents;
    throw new AiImageJobError(
      'BUDGET_EXCEEDED',
      `Global daily AI budget exceeded (${exposure}/${result.limit} cents)`,
    );
  }
  if (result.kind === 'invalid-cost') {
    throw new AiImageJobError('PROVIDER_NOT_READY', result.reason);
  }
  if (
    result.kind === 'existing'
    && input.requestFingerprint
    && result.job.requestFingerprint
    && input.requestFingerprint !== result.job.requestFingerprint
  ) {
    throw new AiImageJobError(
      'IDEMPOTENCY_KEY_CONFLICT',
      'Idempotency key was already used for a different AI image request',
    );
  }
  return { job: result.job, replayed: result.kind === 'existing' };
}

export async function applyAiImageJob(
  jobId: string,
  ownerUserId: string,
  input: ApplyAiImageJobInput,
  repository: Pick<AiImageJobRepository, 'getById' | 'recordApplication'>,
) {
  const job = await repository.getById(jobId);
  if (!job || job.ownerUserId !== ownerUserId) throw new AiImageJobError('NOT_FOUND', 'AI image job not found');
  if (job.status !== 'SUCCEEDED') throw new AiImageJobError('INVALID_STATE', 'Only succeeded jobs can be applied');
  if (input.mode !== 'append' && input.mode !== 'replace') {
    throw new AiImageJobError('INVALID_REQUEST', 'Apply mode must be append or replace');
  }
  if (!input.targetType || !input.targetId) throw new AiImageJobError('INVALID_REQUEST', 'Apply target is required');
  return repository.recordApplication(job.id, input);
}

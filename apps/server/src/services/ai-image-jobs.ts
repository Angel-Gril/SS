import { randomUUID } from 'node:crypto';

export type AiImageJobStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'RUNNING'
  | 'RETRYING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED';

export interface AiImageJobRecord {
  id: string;
  ownerUserId: string;
  actorUserId: string;
  status: AiImageJobStatus;
  provider: string;
  model: string;
  prompt: string;
  negativePrompt: string | null;
  requestedImageCount: number;
  width: number;
  height: number;
  attemptCount: number;
  maxAttempts: number;
  idempotencyKey: string | null;
  estimatedCostCents: number;
  actualCostCents: number | null;
  billedUnits: number;
  providerJobId: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  appliedMode?: 'append' | 'replace' | null;
}

export interface AiImageProviderRequest {
  prompt: string;
  negativePrompt: string | null;
  count: number;
  width: number;
  height: number;
  model: string;
}

export interface AiImageProviderResult {
  images: Array<{ buffer: Buffer; mimeType: string; filename?: string }>;
  providerJobId?: string | null;
  actualCostCents?: number | null;
}

export interface AiImageProvider {
  name: string;
  generate(request: AiImageProviderRequest): Promise<AiImageProviderResult>;
}

export type AiImageJobProvider = AiImageProvider;

export interface AiImageAssetInput {
  ownerUserId: string;
  jobId: string;
  url: string;
  storageBackend: string;
  storageKey: string | null;
  mimeType: string;
  sizeBytes: number;
}

export interface AiImageJobRepository {
  getById(id: string): Promise<AiImageJobRecord | null>;
  markRunning(id: string, attemptCount: number): Promise<void>;
  markRetrying(id: string, data: FailureUpdate): Promise<void>;
  markFailed(id: string, data: FailureUpdate): Promise<void>;
  markCancelled(id: string): Promise<void>;
  complete(id: string, data: {
    providerJobId: string | null;
    actualCostCents: number;
    billedUnits: number;
    assets: AiImageAssetInput[];
  }): Promise<void>;
  createWithQuota(input: CreateAiImageJobInput, dailyLimit: number): Promise<CreateWithQuotaResult>;
  requestCancellation(id: string, ownerUserId: string): Promise<AiImageJobRecord | null>;
  recordApplication(id: string, data: ApplyAiImageJobInput): Promise<AiImageJobRecord>;
}

interface FailureUpdate {
  attemptCount: number;
  errorCode: string;
  errorMessage: string;
}

export interface CreateAiImageJobInput {
  ownerUserId: string;
  actorUserId: string;
  idempotencyKey: string | null;
  prompt: string;
  negativePrompt?: string | null;
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
  | { kind: 'quota-exceeded'; used: number; limit: number };

export interface ApplyAiImageJobInput {
  mode: 'append' | 'replace';
  targetType: string;
  targetId: string;
}

export class AiImageJobError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiImageJobError';
  }
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

function errorDetails(error: unknown): Pick<FailureUpdate, 'errorCode' | 'errorMessage'> {
  if (error instanceof AiImageJobError) return { errorCode: error.code, errorMessage: error.message };
  if (error instanceof Error) return { errorCode: 'PROVIDER_ERROR', errorMessage: error.message };
  return { errorCode: 'PROVIDER_ERROR', errorMessage: String(error) };
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
  },
) {
  const job = await deps.repository.getById(jobId);
  if (!job) throw new AiImageJobError('NOT_FOUND', 'AI image job not found');
  if (job.status === 'CANCEL_REQUESTED' || job.status === 'CANCELLED') {
    await deps.repository.markCancelled(job.id);
    return;
  }
  if (job.status === 'SUCCEEDED') return;

  await deps.repository.markRunning(job.id, attemptNumber);
  try {
    const generated = await deps.provider.generate({
      prompt: job.prompt,
      negativePrompt: job.negativePrompt,
      count: job.requestedImageCount,
      width: job.width,
      height: job.height,
      model: job.model,
    });
    const latest = await deps.repository.getById(job.id);
    if (latest?.status === 'CANCEL_REQUESTED' || latest?.status === 'CANCELLED') {
      await deps.repository.markCancelled(job.id);
      return;
    }

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
      });
    }
    if (assets.length === 0) throw new AiImageJobError('EMPTY_RESULT', 'Provider returned no images');
    await deps.repository.complete(job.id, {
      providerJobId: generated.providerJobId || null,
      actualCostCents: generated.actualCostCents ?? job.estimatedCostCents,
      billedUnits: assets.length,
      assets,
    });
  } catch (error) {
    const details = { attemptCount: attemptNumber, ...errorDetails(error) };
    if (attemptNumber < job.maxAttempts) await deps.repository.markRetrying(job.id, details);
    else await deps.repository.markFailed(job.id, details);
    throw error;
  }
}

export async function createAiImageJob(
  input: CreateAiImageJobInput,
  repository: Pick<AiImageJobRepository, 'createWithQuota'>,
  dailyLimit: number,
) {
  if (!input.prompt.trim()) throw new AiImageJobError('INVALID_REQUEST', 'Prompt is required');
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > 4) {
    throw new AiImageJobError('INVALID_REQUEST', 'Image count must be between 1 and 4');
  }
  const result = await repository.createWithQuota(input, dailyLimit);
  if (result.kind === 'quota-exceeded') {
    throw new AiImageJobError('QUOTA_EXCEEDED', `Daily image quota exceeded (${result.used}/${result.limit})`);
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

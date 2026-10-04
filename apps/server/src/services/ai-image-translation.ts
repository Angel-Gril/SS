import { createHash, randomUUID } from 'node:crypto';
import {
  AiMediaCapabilityError,
  assertAiMediaCapability,
  resolveAiImageProviderCapability,
} from './ai-image-provider-capabilities.js';
import {
  AiImageJobError,
  type AiImageAssetInput,
  type AiImageJobRecord,
  type AiImageJobRepository,
} from './ai-image-jobs.js';
import { AiCostLedgerError } from './ai-cost-ledger.js';

export interface AiImageTranslationTerminology {
  src: string;
  tgt: string;
}

export interface AiImageTranslationOptions {
  sourceLanguage: string;
  targetLanguage: string;
  domainHint: string;
  terminologies: AiImageTranslationTerminology[];
  imageSegment: false;
  policyVersion?: string;
}

export interface AiImageTranslationSubmitRequest extends AiImageTranslationOptions {
  model: string;
  imageUrl: string;
}

export type AiImageTranslationPollResult =
  | { status: 'PENDING'; providerStatus: string }
  | {
    status: 'SUCCEEDED';
    providerStatus: 'SUCCEEDED';
    image: { buffer: Buffer; mimeType: string; filename?: string };
    actualCostCents?: number | null;
  };

export interface AiImageTranslationProvider {
  name: string;
  submit(
    request: AiImageTranslationSubmitRequest,
    onAccepted: (providerJobId: string, providerAcceptedAt: Date) => Promise<void>,
  ): Promise<{ providerJobId: string; providerAcceptedAt: Date }>;
  poll(providerJobId: string): Promise<AiImageTranslationPollResult>;
}

export const AI_IMAGE_TRANSLATION_MAX_ACCEPTED_TASK_AGE_MS = 15 * 60 * 1000;

export function createDisabledAiImageTranslationProvider(): AiImageTranslationProvider {
  return {
    name: 'disabled',
    async submit() {
      throw new AiImageJobError('PROVIDER_DISABLED', 'AI image translation provider is disabled');
    },
    async poll() {
      throw new AiImageJobError('PROVIDER_DISABLED', 'AI image translation provider is disabled');
    },
  };
}

export function createFakeAiImageTranslationProvider(input: {
  image: { buffer: Buffer; mimeType: string; filename?: string };
  providerJobId?: string;
  pendingPolls?: number;
  actualCostCents?: number;
}): AiImageTranslationProvider {
  const providerJobId = input.providerJobId || `fake-translation-${randomUUID()}`;
  let remainingPendingPolls = Math.max(0, Math.trunc(input.pendingPolls || 0));
  return {
    name: 'fake',
    async submit(_request, onAccepted) {
      const providerAcceptedAt = new Date();
      await onAccepted(providerJobId, providerAcceptedAt);
      return { providerJobId, providerAcceptedAt };
    },
    async poll(requestedProviderJobId) {
      if (requestedProviderJobId !== providerJobId) {
        throw new AiImageJobError('PROVIDER_TASK_NOT_FOUND', 'Fake translation task was not found');
      }
      if (remainingPendingPolls > 0) {
        remainingPendingPolls -= 1;
        return { status: 'PENDING', providerStatus: 'RUNNING' };
      }
      return {
        status: 'SUCCEEDED',
        providerStatus: 'SUCCEEDED',
        image: input.image,
        actualCostCents: input.actualCostCents ?? 0,
      };
    },
  };
}

function normalizeTerminologies(value: unknown): AiImageTranslationTerminology[] {
  const rawTerms = Array.isArray(value) ? value : [];
  const bySource = new Map<string, AiImageTranslationTerminology>();
  for (const entry of rawTerms) {
    const term = entry && typeof entry === 'object' ? entry as Record<string, unknown> : {};
    const normalized = { src: String(term.src || '').trim(), tgt: String(term.tgt || '').trim() };
    const key = normalized.src.toLocaleLowerCase();
    const previous = bySource.get(key);
    if (previous && previous.tgt.toLocaleLowerCase() !== normalized.tgt.toLocaleLowerCase()) {
      throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Image translation terminology contains conflicting source terms');
    }
    if (!previous) bySource.set(key, normalized);
  }
  return [...bySource.values()];
}

function asTranslationOptions(value: unknown): AiImageTranslationOptions {
  const input = value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
  const sourceLanguage = String(input.sourceLanguage || input.sourceLang || '').trim().toLowerCase();
  const targetLanguage = String(input.targetLanguage || input.targetLang || '').trim().toLowerCase();
  const domainHint = String(input.domainHint || '').trim();
  const terminologies = normalizeTerminologies(input.terminologies);
  if (
    !/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/u.test(sourceLanguage)
    || !/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/u.test(targetLanguage)
    || sourceLanguage === targetLanguage
  ) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Image translation languages are invalid');
  }
  if (!domainHint || Buffer.byteLength(domainHint, 'utf8') > 16_000) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Image translation domain policy is invalid');
  }
  if (
    terminologies.length > 50
    || terminologies.some((term) => !term.src || !term.tgt || term.src.length > 120 || term.tgt.length > 120)
    || new Set(terminologies.map((term) => term.src.toLocaleLowerCase())).size !== terminologies.length
  ) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Image translation terminology is invalid');
  }
  if (input.imageSegment !== false) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Image translation segmentation must remain disabled');
  }
  if (input.policyVersion !== 'ai-image-translation-policy/1.0') {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Image translation policy version is not supported');
  }
  return {
    sourceLanguage,
    targetLanguage,
    domainHint,
    terminologies,
    imageSegment: false,
    ...(typeof input.policyVersion === 'string' && input.policyVersion.trim()
      ? { policyVersion: input.policyVersion.trim() }
      : {}),
  };
}

function referenceAsset(job: AiImageJobRecord) {
  const inputs = job.inputAssets || [];
  if (inputs.length !== 1 || inputs[0]?.role !== 'REFERENCE' || !inputs[0]?.url) {
    throw new AiImageJobError('INVALID_MEDIA_INPUT', 'Image translation requires exactly one reference asset and no mask');
  }
  return inputs[0];
}

function capabilityError(error: unknown) {
  if (error instanceof AiMediaCapabilityError) {
    return new AiImageJobError(error.code, error.message);
  }
  return error;
}

function failureDetails(error: unknown, attemptCount: number, providerJobId?: string) {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; providerJobId?: unknown; providerSubmissionRejected?: unknown; providerSubmissionUncertain?: unknown }
    : {};
  const acceptedProviderJobId = providerJobId || (typeof candidate.providerJobId === 'string' ? candidate.providerJobId : '');
  return {
    attemptCount,
    errorCode: error instanceof AiImageJobError
      ? error.code
      : typeof candidate.code === 'string'
        ? candidate.code
        : 'PROVIDER_ERROR',
    errorMessage: error instanceof Error ? error.message : String(error),
    ...(acceptedProviderJobId ? { providerJobId: acceptedProviderJobId } : {}),
    ...(candidate.providerSubmissionRejected === true ? { providerSubmissionRejected: true } : {}),
    ...(candidate.providerSubmissionUncertain === true ? { providerSubmissionUncertain: true } : {}),
  };
}

function isTransientAcceptedTaskError(error: unknown) {
  if (error instanceof AiCostLedgerError) return false;
  if (error && typeof error === 'object' && [
    'COST_OVERRUN_REQUIRES_RECONCILIATION',
    'INVALID_STATE',
    'CONFLICT',
  ].includes(String((error as { code?: unknown }).code || ''))) return false;
  if (!(error instanceof AiImageJobError)) return true;
  if (['PROVIDER_AUTH_FAILED', 'PROVIDER_RESPONSE_TOO_LARGE', 'PROVIDER_TASK_FAILED', 'INVALID_PROVIDER_RESULT', 'INVALID_MEDIA_INPUT'].includes(error.code)) {
    return false;
  }
  if (error.code === 'PROVIDER_REQUEST_FAILED') {
    const status = Number((error as AiImageJobError & { providerHttpStatus?: number }).providerHttpStatus);
    return [408, 409, 425, 429].includes(status) || status >= 500;
  }
  return error.code === 'PROVIDER_TIMEOUT';
}

export function isAiImageTranslationTransientError(error: unknown) {
  return isTransientAcceptedTaskError(error);
}

function acceptedTaskExpired(job: AiImageJobRecord, now = Date.now()) {
  const dispatchedAt = job.providerDispatchedAt instanceof Date
    ? job.providerDispatchedAt.getTime()
    : Number.NaN;
  return Number.isFinite(dispatchedAt)
    && now - dispatchedAt >= AI_IMAGE_TRANSLATION_MAX_ACCEPTED_TASK_AGE_MS;
}

export async function runAiImageTranslationJob(
  jobId: string,
  attemptNumber: number,
  deps: {
    repository: AiImageJobRepository;
    provider: AiImageTranslationProvider;
    resolveCapability?: typeof resolveAiImageProviderCapability;
    uploadBuffer: (
      buffer: Buffer,
      filename: string,
      mimeType?: string,
      options?: { category?: 'ai-generated'; ownerId?: string; idempotencyKey?: string },
    ) => Promise<{ url: string; backend: string; filename?: string; key?: string }>;
  },
): Promise<'completed' | 'pending' | 'ignored'> {
  let job = await deps.repository.getById(jobId);
  if (!job) throw new AiImageJobError('NOT_FOUND', 'AI image translation job not found');
  if (job.operation !== 'IMAGE_TRANSLATE') {
    throw new AiImageJobError('UNSUPPORTED_OPERATION', 'Job is not an image translation operation');
  }
  if (job.status === 'CANCEL_REQUESTED' || job.status === 'CANCELLED') {
    await deps.repository.markCancelled(job.id, {
      providerSubmissionUncertain: Boolean(job.providerJobId),
    });
    return 'ignored';
  }
  if (job.status === 'SUCCEEDED' || job.status === 'FAILED') return 'ignored';

  const recoveringAcceptedTask = job.status === 'RUNNING' && Boolean(job.providerJobId);
  if (job.status === 'RUNNING' && !job.providerJobId) {
    const details = failureDetails(
      new AiImageJobError(
        'PROVIDER_SUBMISSION_UNCERTAIN',
        'Translation worker restarted without a persisted provider task identity',
      ),
      Math.max(job.attemptCount, attemptNumber),
    );
    if (deps.repository.markSubmissionUncertain) {
      await deps.repository.markSubmissionUncertain(job.id, { ...details, providerSubmissionUncertain: true });
    } else {
      await deps.repository.markFailed(job.id, { ...details, providerSubmissionUncertain: true });
    }
    throw new AiImageJobError('PROVIDER_SUBMISSION_UNCERTAIN', details.errorMessage);
  }
  if (!recoveringAcceptedTask) {
    const claimed = await deps.repository.markRunning(job.id, attemptNumber);
    if (!claimed) return 'ignored';
    job = await deps.repository.getById(job.id);
    if (!job || job.status !== 'RUNNING') return 'ignored';
  }

  let source: NonNullable<ReturnType<typeof referenceAsset>>;
  let options: AiImageTranslationOptions;
  try {
    source = referenceAsset(job);
    options = asTranslationOptions(job.operationConfig);
  } catch (error) {
    const details = failureDetails(error, attemptNumber);
    await deps.repository.markFailed(job.id, details);
    throw error;
  }
  try {
    if (!job.providerJobId) {
      let capability;
      try {
        capability = assertAiMediaCapability({
          provider: job.provider,
          model: job.model,
          operation: 'IMAGE_TRANSLATE',
          inputCount: 1,
          hasMask: (job.inputAssets || []).some((asset) => asset.role === 'MASK'),
        }, deps.resolveCapability);
      } catch (error) {
        throw capabilityError(error);
      }
      if (job.provider !== 'fake' && capability.evidenceLevel !== 'sandbox-verified') {
        throw new AiImageJobError(
          'PROVIDER_NOT_READY',
          'Image translation provider has not passed its sandbox capability gate',
        );
      }
    }
    if (deps.provider.name !== job.provider) {
      throw new AiImageJobError('PROVIDER_CONFIG_CHANGED', 'Image translation provider does not match the frozen job');
    }

    let providerJobId = job.providerJobId || '';
    if (providerJobId && acceptedTaskExpired(job)) {
      const timeoutError = new AiImageJobError(
        'PROVIDER_POLL_TIMEOUT',
        'Image translation provider task exceeded the recovery deadline',
      );
      await deps.repository.markFailed(job.id, failureDetails(timeoutError, attemptNumber, providerJobId));
      throw timeoutError;
    }
    if (!providerJobId) {
      const paidProvider = job.provider !== 'fake';
      if (deps.repository.recordProviderDispatchStarted) {
        const fenced = await deps.repository.recordProviderDispatchStarted(job.id, new Date());
        if (!fenced) return 'ignored';
      } else if (paidProvider) {
        throw new AiImageJobError(
          'PROVIDER_DISPATCH_FENCE_UNAVAILABLE',
          'Translation provider dispatch cannot start without a durable fence',
        );
      }
      const submitted = await deps.provider.submit({
        model: job.model,
        imageUrl: source.url!,
        ...options,
      }, async (taskId, acceptedAt) => {
        if (!deps.repository.recordProviderJobId) {
          throw new AiImageJobError(
            'PROVIDER_ACCEPTED_PERSISTENCE_FAILED',
            'Translation provider task identity cannot be persisted',
          );
        }
        await deps.repository.recordProviderJobId(job!.id, taskId, acceptedAt);
      });
      providerJobId = submitted.providerJobId;
      if (!providerJobId) {
        throw Object.assign(
          new AiImageJobError('INVALID_PROVIDER_RESULT', 'Image translation provider returned no task identity'),
          { providerSubmissionUncertain: paidProvider },
        );
      }
      let acceptedRow = await deps.repository.getById(job.id);
      if ((!acceptedRow?.providerJobId || acceptedRow.providerJobId !== providerJobId) && deps.repository.recordProviderJobId) {
        await deps.repository.recordProviderJobId(job.id, providerJobId, submitted.providerAcceptedAt);
        acceptedRow = await deps.repository.getById(job.id);
      }
      if (!acceptedRow?.providerJobId || acceptedRow.providerJobId !== providerJobId) {
        throw Object.assign(
          new AiImageJobError(
            'PROVIDER_ACCEPTED_PERSISTENCE_FAILED',
            'Translation provider task identity was not durably persisted before polling',
          ),
          { providerSubmissionUncertain: paidProvider, providerJobId },
        );
      }
    }

    const latest = await deps.repository.getById(job.id);
    if (!latest || latest.status === 'CANCEL_REQUESTED' || latest.status === 'CANCELLED') {
      await deps.repository.markCancelled(job.id, {
        providerSubmissionUncertain: Boolean(providerJobId),
      });
      return 'ignored';
    }
    if (latest.status !== 'RUNNING') return 'ignored';
    if (!latest.providerDispatchedAt) {
      const deadlineError = new AiImageJobError(
        'PROVIDER_POLL_TIMEOUT',
        'Image translation provider task has no durable recovery deadline',
      );
      await deps.repository.markFailed(job.id, failureDetails(deadlineError, attemptNumber, providerJobId));
      throw deadlineError;
    }

    let polled: AiImageTranslationPollResult;
    try {
      polled = await deps.provider.poll(providerJobId);
    } catch (error) {
      if (isTransientAcceptedTaskError(error)) throw error;
      await deps.repository.markFailed(job.id, failureDetails(error, attemptNumber, providerJobId));
      throw error;
    }
    if (polled.status === 'PENDING') return 'pending';

    const image = polled.image;
    const outputSha256 = createHash('sha256').update(image.buffer).digest('hex');
    const filename = image.filename || `translation-${job.id}-${randomUUID()}.png`;
    const stored = await deps.uploadBuffer(image.buffer, filename, image.mimeType, {
      category: 'ai-generated',
      ownerId: job.ownerUserId,
      idempotencyKey: `${job.id}:${outputSha256}`,
    });
    const asset: AiImageAssetInput = {
      ownerUserId: job.ownerUserId,
      jobId: job.id,
      url: stored.url,
      storageBackend: stored.backend,
      storageKey: stored.key || stored.filename || null,
      mimeType: image.mimeType,
      sizeBytes: image.buffer.length,
      sha256: outputSha256,
    };
    await deps.repository.complete(job.id, {
      providerJobId,
      actualCostCents: polled.actualCostCents ?? job.estimatedCostCents,
      billedUnits: 1,
      assets: [asset],
    });
    return 'completed';
  } catch (error) {
    const latest = await deps.repository.getById(job.id);
    if (latest?.providerJobId && isTransientAcceptedTaskError(error)) {
      throw error;
    }
    if (latest?.status === 'RUNNING') {
      const details = failureDetails(error, attemptNumber, latest.providerJobId || undefined);
      if (!latest.providerJobId && latest.providerDispatchedAt && details.providerSubmissionRejected !== true) {
        if (deps.repository.markSubmissionUncertain) {
          await deps.repository.markSubmissionUncertain(job.id, {
            ...details,
            providerSubmissionUncertain: true,
          });
        } else {
          await deps.repository.markFailed(job.id, {
            ...details,
            providerSubmissionUncertain: true,
          });
        }
      } else {
        await deps.repository.markFailed(job.id, details);
      }
    }
    throw error;
  }
}

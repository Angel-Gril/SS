import { createHash } from 'node:crypto';
import type { AiImageAssetInput, AiImageJobRecord, AiImageJobStatus } from './ai-image-jobs.js';
import type { AiMediaOperation } from './ai-image-provider-capabilities.js';
import {
  parseAiImageProviderRuntimeContract,
  requiresAiImageProviderCredentialRevision,
} from './ai-image-provider-runtime-contract.js';

export function isWanxEditReconciliationOperation(input: {
  provider: string; model: string; operation?: string;
}): boolean {
  return requiresAiImageProviderCredentialRevision(input.provider, input.model)
    && (input.operation === 'FULL_EDIT' || input.operation === 'INPAINT');
}

export function hasWanxEditReconciliationContract(job: Pick<AiImageJobRecord,
  'provider' | 'model' | 'operation' | 'operationConfig' | 'width' | 'height' | 'requestedImageCount' | 'estimatedCostCents'
>): boolean {
  if (!isWanxEditReconciliationOperation(job)) return false;
  try {
    const runtime = parseAiImageProviderRuntimeContract(job.operationConfig?.providerRuntime);
    return runtime.provider === job.provider && runtime.model === job.model
      && runtime.width === job.width && runtime.height === job.height
      && runtime.imageCount === 1 && job.requestedImageCount === 1
      && runtime.maximumCostCents === job.estimatedCostCents;
  } catch {
    return false;
  }
}

export type AiProviderReconciliationStatus =
  | 'NOT_REQUIRED'
  | 'PENDING'
  | 'RUNNING'
  | 'RETRY_WAIT'
  | 'MANUAL_REVIEW'
  | 'RECOVERED'
  | 'NO_OUTPUT'
  | 'NOT_SUBMITTED'
  | 'CANCELLED_OUTPUT_RETAINED';

export interface AiProviderReconciliationClaim {
  jobId: string;
  workflowId: string | null;
  workflowAttempt?: number | null;
  attemptCount?: number;
  requestFingerprint?: string | null;
  ownerUserId: string;
  actorUserId: string;
  operation: AiMediaOperation;
  provider: string;
  model: string;
  estimatedCostCents: number;
  providerJobId: string;
  jobStatus: AiImageJobStatus;
  reconciliationStatus: 'RUNNING';
  reconciliationRevision: number;
  reconciliationAttemptCount: number;
  deadlineAt: Date;
  leaseToken: string;
}

export type AiProviderTaskLookupResult =
  | {
    status: 'PENDING';
    providerJobId: string;
    providerStatus: string;
  }
  | {
    status: 'SUCCEEDED';
    providerJobId: string;
    providerStatus: string;
    image: { buffer: Buffer; mimeType: string; filename?: string };
    actualCostCents: number;
  }
  | {
    status: 'NO_OUTPUT';
    providerJobId: string;
    providerStatus: string;
    errorCode: string;
    errorMessage: string;
    billingDisposition: 'UNKNOWN' | 'NO_CHARGE';
  };

interface ClaimMutationInput {
  claim: AiProviderReconciliationClaim;
}

export interface AiProviderReconciliationRepository {
  claimDue(input: {
    workerId: string;
    now: Date;
    limit: number;
    leaseMs: number;
  }): Promise<AiProviderReconciliationClaim[]>;
  defer(input: ClaimMutationInput & {
    nextAttemptAt: Date;
    providerStatus?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
  }): Promise<void>;
  markManualReview(input: ClaimMutationInput & {
    providerStatus?: string | null;
    errorCode: string;
    errorMessage: string;
  }): Promise<void>;
  completeRecovered(input: ClaimMutationInput & {
    providerStatus: string;
    actualCostCents: number;
    asset: AiImageAssetInput;
  }): Promise<void>;
  completeNoOutput(input: ClaimMutationInput & {
    providerStatus: string;
    errorCode: string;
    errorMessage: string;
    billingDisposition: 'UNKNOWN' | 'NO_CHARGE';
  }): Promise<void>;
  getClaimedEditJob?(claim: AiProviderReconciliationClaim): Promise<AiImageJobRecord>;
  recordRecoveredEditRaw?(input: ClaimMutationInput & {
    asset: AiImageAssetInput;
  }): Promise<{ id: string }>;
  completeRecoveredEdit?(input: ClaimMutationInput & {
    providerStatus: string;
    actualCostCents: number;
    rawAssetId: string;
    finalAsset: AiImageAssetInput | null;
  }): Promise<void>;
}

export interface AiProviderReconciliationServiceOptions {
  repository: AiProviderReconciliationRepository;
  lookupProviderTask(claim: AiProviderReconciliationClaim): Promise<AiProviderTaskLookupResult>;
  recoverEditOutput?(
    claim: AiProviderReconciliationClaim,
    result: Extract<AiProviderTaskLookupResult, { status: 'SUCCEEDED' }>,
  ): Promise<void>;
  uploadBuffer(
    buffer: Buffer,
    filename: string,
    mimeType?: string,
    options?: { category?: 'ai-generated'; ownerId?: string; idempotencyKey?: string },
  ): Promise<{ url: string; backend: string; filename?: string; key?: string }>;
  now?: () => Date;
  leaseMs?: number;
}

// One lookup can include both Provider polling and a temporary-result download.
// Keep the default worker single-flight and fence that complete I/O window.
const DEFAULT_LEASE_MS = 20 * 60 * 1000;
const MAX_LIMIT = 100;
const MAX_ERROR_LENGTH = 500;
const MAX_PROVIDER_STATUS_LENGTH = 100;
const TRANSIENT_CODES = new Set([
  'PROVIDER_TIMEOUT',
  'PROVIDER_REQUEST_FAILED',
  'QUEUE_UNAVAILABLE',
  'STORAGE_UNAVAILABLE',
  'OUTPUT_PERSISTENCE_FAILED',
]);

function bounded(value: unknown, maxLength: number, fallback: string) {
  const text = String(value || '').replace(/[\r\n\t]+/gu, ' ').trim();
  return (text || fallback).slice(0, maxLength);
}

function errorEvidence(error: unknown) {
  const candidate = error && typeof error === 'object'
    ? error as { code?: unknown; transient?: unknown }
    : {};
  return {
    errorCode: bounded(candidate.code, 100, 'PROVIDER_RECONCILIATION_FAILED'),
    errorMessage: bounded(
      error instanceof Error ? error.message : error,
      MAX_ERROR_LENGTH,
      'Provider reconciliation failed',
    ),
    transient: candidate.transient === true || TRANSIENT_CODES.has(String(candidate.code || '')),
  };
}

function nextAttemptAt(claim: AiProviderReconciliationClaim, now: Date) {
  const exponent = Math.min(5, Math.max(0, claim.reconciliationAttemptCount - 1));
  return new Date(now.getTime() + Math.min(15 * 60 * 1000, 30_000 * (2 ** exponent)));
}

function extensionForMime(mimeType: string) {
  if (mimeType === 'image/jpeg') return 'jpg';
  if (mimeType === 'image/webp') return 'webp';
  return 'png';
}

function normalizedResultImage(image: { buffer: Buffer; mimeType: string; filename?: string }) {
  if (!Buffer.isBuffer(image.buffer) || image.buffer.length === 0) {
    throw Object.assign(new Error('Provider reconciliation returned an empty image'), {
      code: 'INVALID_PROVIDER_RESULT',
    });
  }
  const mimeType = String(image.mimeType || '').trim().toLowerCase();
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mimeType)) {
    throw Object.assign(new Error('Provider reconciliation returned an unsupported image type'), {
      code: 'INVALID_PROVIDER_RESULT',
    });
  }
  return { buffer: image.buffer, mimeType, filename: image.filename };
}

function outputPersistenceError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  return Object.assign(new Error(message || 'Provider output persistence failed'), {
    code: 'OUTPUT_PERSISTENCE_FAILED',
    transient: true,
    cause: error,
  });
}

function initialCounts() {
  return { claimed: 0, recovered: 0, pending: 0, noOutput: 0, manualReview: 0 };
}

function isLeaseLost(error: unknown) {
  return String((error as { code?: unknown } | null)?.code || '')
    === 'PROVIDER_RECONCILIATION_LEASE_LOST';
}

async function persistClaimMutation(callback: () => Promise<void>) {
  try {
    await callback();
    return true;
  } catch (error) {
    if (isLeaseLost(error)) return false;
    throw error;
  }
}

export function createAiProviderReconciliationService(options: AiProviderReconciliationServiceOptions) {
  const now = options.now || (() => new Date());
  return {
    async runTick(input: { workerId: string; limit?: number }) {
      const current = now();
      const limit = Math.min(MAX_LIMIT, Math.max(1, Math.trunc(input.limit || 1)));
      const claims = await options.repository.claimDue({
        workerId: bounded(input.workerId, 100, 'ai-provider-reconciliation'),
        now: current,
        limit,
        leaseMs: Math.max(1_000, Math.trunc(options.leaseMs || DEFAULT_LEASE_MS)),
      });
      const counts = initialCounts();
      counts.claimed = claims.length;

      for (const claim of claims) {
        if (!(claim.deadlineAt instanceof Date)
          || Number.isNaN(claim.deadlineAt.getTime())
          || claim.deadlineAt.getTime() <= current.getTime()) {
          const persisted = await persistClaimMutation(() => options.repository.markManualReview({
            claim,
            errorCode: 'PROVIDER_RECONCILIATION_DEADLINE_EXCEEDED',
            errorMessage: 'Provider task result was not recovered before its persisted deadline',
          }));
          if (persisted) counts.manualReview += 1;
          continue;
        }
        const editRecovery = isWanxEditReconciliationOperation(claim);
        if ((claim.operation !== 'IMAGE_TRANSLATE' && (!editRecovery || !options.recoverEditOutput))
          || !claim.providerJobId.trim()) {
          const persisted = await persistClaimMutation(() => options.repository.markManualReview({
            claim,
            errorCode: 'PROVIDER_LOOKUP_UNSUPPORTED',
            errorMessage: 'The accepted Provider task does not have an installed lookup contract',
          }));
          if (persisted) counts.manualReview += 1;
          continue;
        }

        try {
          const result = await options.lookupProviderTask(claim);
          if (result.providerJobId !== claim.providerJobId) {
            const persisted = await persistClaimMutation(() => options.repository.markManualReview({
              claim,
              providerStatus: bounded(result.providerStatus, MAX_PROVIDER_STATUS_LENGTH, 'UNKNOWN'),
              errorCode: 'PROVIDER_JOB_ID_MISMATCH',
              errorMessage: 'Provider lookup returned a different task identity',
            }));
            if (persisted) counts.manualReview += 1;
            continue;
          }
          const providerStatus = bounded(result.providerStatus, MAX_PROVIDER_STATUS_LENGTH, 'UNKNOWN');
          if (result.status === 'PENDING') {
            const persisted = await persistClaimMutation(() => options.repository.defer({
              claim,
              providerStatus,
              nextAttemptAt: nextAttemptAt(claim, current),
            }));
            if (persisted) counts.pending += 1;
            continue;
          }
          if (result.status === 'NO_OUTPUT') {
            const persisted = await persistClaimMutation(() => options.repository.completeNoOutput({
              claim,
              providerStatus,
              errorCode: bounded(result.errorCode, 100, 'PROVIDER_TASK_FAILED'),
              errorMessage: bounded(result.errorMessage, MAX_ERROR_LENGTH, 'Provider task produced no output'),
              billingDisposition: result.billingDisposition,
            }));
            if (persisted) counts.noOutput += 1;
            continue;
          }

          if (editRecovery) {
            await options.recoverEditOutput!(claim, result);
            counts.recovered += 1;
            continue;
          }
          const image = normalizedResultImage(result.image);
          const sha256 = createHash('sha256').update(image.buffer).digest('hex');
          const filename = image.filename
            || `provider-reconciled-${claim.jobId}-${sha256.slice(0, 16)}.${extensionForMime(image.mimeType)}`;
          const stored = await options.uploadBuffer(image.buffer, filename, image.mimeType, {
            category: 'ai-generated',
            ownerId: claim.ownerUserId,
            idempotencyKey: `${claim.jobId}:provider-reconciliation:${sha256}`,
          }).catch((error) => {
            throw outputPersistenceError(error);
          });
          const persisted = await persistClaimMutation(() => options.repository.completeRecovered({
            claim,
            providerStatus,
            actualCostCents: Math.max(0, Math.trunc(result.actualCostCents || 0)),
            asset: {
              ownerUserId: claim.ownerUserId,
              jobId: claim.jobId,
              url: stored.url,
              storageBackend: stored.backend,
              storageKey: stored.key || stored.filename || null,
              mimeType: image.mimeType,
              sizeBytes: image.buffer.length,
              sha256,
            },
          }));
          if (persisted) counts.recovered += 1;
        } catch (error) {
          if (isLeaseLost(error)) continue;
          const evidence = errorEvidence(error);
          if (evidence.transient) {
            const persisted = await persistClaimMutation(() => options.repository.defer({
              claim,
              nextAttemptAt: nextAttemptAt(claim, current),
              errorCode: evidence.errorCode,
              errorMessage: evidence.errorMessage,
            }));
            if (persisted) counts.pending += 1;
          } else {
            const persisted = await persistClaimMutation(() => (
              options.repository.markManualReview({ claim, ...evidence })
            ));
            if (persisted) counts.manualReview += 1;
          }
        }
      }
      return counts;
    },
  };
}

export type AiProviderReconciliationService = ReturnType<typeof createAiProviderReconciliationService>;

import type { OzonListingDraft } from 'shared';
import { OzonApiError } from './ozon-client.js';
import {
  OzonPublishAttemptError,
  cloneOzonPublishObject,
  extractOzonPublishTaskId,
  normalizeOzonPublishHash,
  type OzonPublishAttemptListPage,
  type OzonPublishAttemptRecord,
  type OzonPublishAttemptRepository,
  type OzonPublishAttemptSummary,
  type OzonPublishJson,
  type OzonPublishOfferTraceEntry,
  type OzonUnknownResolution,
  type OzonSubmissionOutcome,
} from './ozon-publish-attempts.js';
import {
  hashOzonListingPublishState,
  type SourceListingWorkflowService,
} from './source-listing-workflow.js';

export interface CompiledOzonListingPublishRequest {
  publisherContractVersion: string;
  endpoint: '/v3/product/import';
  draftStateHash: string;
  catalogSnapshotId: string;
  catalogRevision: string;
  catalogSnapshot: Record<string, OzonPublishJson>;
  catalogSnapshotHash: string;
  attributeSchemaSnapshot: Record<string, OzonPublishJson>;
  attributeSchemaHash: string;
  requestPayload: Record<string, OzonPublishJson>;
  requestPayloadHash: string;
  offerTrace: OzonPublishOfferTraceEntry[];
}

export interface OzonListingPublisherWorkflow {
  getDraft: SourceListingWorkflowService['getDraft'];
  recordPublishIntent: SourceListingWorkflowService['recordPublishIntent'];
}

export class OzonListingPublisherError extends Error {
  constructor(
    public readonly code:
      | 'OZON_PUBLISH_OWNER_REQUIRED'
      | 'OZON_PUBLISH_DRAFT_NOT_FOUND'
      | 'OZON_PUBLISH_DRAFT_CONFLICT'
      | 'OZON_PUBLISH_COMPILE_STALE'
      | 'OZON_PUBLISH_ATTEMPT_UNAVAILABLE',
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'OzonListingPublisherError';
  }
}

function requiredText(value: unknown, label: string, maxLength = 200): string {
  const text = typeof value === 'string' ? value.normalize('NFKC').trim() : '';
  if (!text || text.length > maxLength) {
    throw new OzonListingPublisherError(
      'OZON_PUBLISH_ATTEMPT_UNAVAILABLE', `${label} is invalid`, 500,
    );
  }
  return text;
}

function errorText(error: unknown): { code: string; message: string; response?: unknown } {
  if (error instanceof OzonApiError) {
    return {
      code: String(error.code || `HTTP_${error.status}`).slice(0, 100),
      message: error.publicMessage.slice(0, 2000),
      response: {
        status: error.status,
        path: error.path,
        code: error.code == null ? null : String(error.code),
        details: error.details,
      },
    };
  }
  const candidate = error as Error & { code?: unknown };
  return {
    code: String(candidate?.code || candidate?.name || 'OZON_SUBMISSION_UNCERTAIN').slice(0, 100),
    message: String(candidate?.message || 'Ozon submission outcome is uncertain').slice(0, 2000),
  };
}

export function classifyOzonSubmissionError(error: unknown): OzonSubmissionOutcome {
  const normalized = errorText(error);
  if (error instanceof OzonApiError
    && error.status >= 400
    && error.status < 500
    && ![408, 425, 429].includes(error.status)) {
    return { kind: 'REJECTED', errorCode: normalized.code, errorMessage: normalized.message, ...(normalized.response ? { response: normalized.response } : {}) };
  }
  return { kind: 'UNKNOWN', errorCode: normalized.code, errorMessage: normalized.message, ...(normalized.response ? { response: normalized.response } : {}) };
}

function startSubmissionHeartbeat(input: {
  attempts: OzonPublishAttemptRepository;
  attemptId: string;
  workerId: string;
  leaseToken: string;
  leaseEpoch: number;
  leaseMs: number;
  warn?: (message: string, error?: unknown) => void;
}): () => void {
  const intervalMs = Math.max(1_000, Math.floor(input.leaseMs / 3));
  let stopped = false;
  let heartbeatRunning = false;
  const timer = setInterval(() => {
    if (stopped || heartbeatRunning) return;
    heartbeatRunning = true;
    void input.attempts.heartbeat({
      attemptId: input.attemptId,
      workerId: input.workerId,
      leaseToken: input.leaseToken,
      leaseEpoch: input.leaseEpoch,
      leaseMs: input.leaseMs,
    }).then((retained) => {
      if (!retained && !stopped) {
        stopped = true;
        clearInterval(timer);
        input.warn?.('Ozon submission lease was lost while the request was in flight');
      }
    }).catch((error) => {
      input.warn?.('Ozon submission lease heartbeat failed', error);
    }).finally(() => {
      heartbeatRunning = false;
    });
  }, intervalMs);
  timer.unref?.();

  return () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
}

export function createOzonListingPublisher(options: {
  workflow: OzonListingPublisherWorkflow;
  attempts: OzonPublishAttemptRepository;
  compile(input: { ownerUserId: string; draft: OzonListingDraft }): Promise<CompiledOzonListingPublishRequest>;
  submitImportOnce(input: {
    ownerUserId: string;
    shopId: string;
    requestPayload: Record<string, OzonPublishJson>;
    attempt: OzonPublishAttemptRecord;
  }): Promise<unknown>;
  workerId: string;
  leaseMs?: number;
  acknowledgementRecoveryAttempts?: number;
  sleep?: (delayMs: number) => Promise<void>;
  warn?: (message: string, error?: unknown) => void;
}) {
  const workerId = requiredText(options.workerId, 'workerId');
  const leaseMs = options.leaseMs ?? 90_000;
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 60_000 || leaseMs > 15 * 60_000) {
    throw new OzonListingPublisherError(
      'OZON_PUBLISH_ATTEMPT_UNAVAILABLE', 'submission lease must be between 60000 and 900000 milliseconds', 500,
    );
  }
  const acknowledgementRecoveryAttempts = options.acknowledgementRecoveryAttempts ?? 3;
  if (!Number.isSafeInteger(acknowledgementRecoveryAttempts)
    || acknowledgementRecoveryAttempts < 1
    || acknowledgementRecoveryAttempts > 5) {
    throw new OzonListingPublisherError(
      'OZON_PUBLISH_ATTEMPT_UNAVAILABLE',
      'acknowledgement recovery attempts must be between 1 and 5',
      500,
    );
  }
  const sleep = options.sleep || ((delayMs: number) => (
    new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  ));

  async function recoverAcknowledgement(input: {
    attemptId: string;
    leaseToken: string;
    leaseEpoch: number;
    taskId: string;
    response: unknown;
  }): Promise<OzonPublishAttemptRecord> {
    let lastError: unknown;
    for (let recoveryAttempt = 0;
      recoveryAttempt < acknowledgementRecoveryAttempts;
      recoveryAttempt += 1) {
      try {
        return await options.attempts.recoverSubmissionAcknowledgement({
          ...input,
          workerId,
        });
      } catch (error) {
        lastError = error;
        if (error instanceof OzonPublishAttemptError
          || recoveryAttempt + 1 >= acknowledgementRecoveryAttempts) break;
        await sleep(50 * (2 ** recoveryAttempt));
      }
    }
    throw lastError;
  }

  return {
    async listAttempts(input: {
      workflowId: string;
      ownerUserId: string;
      limit?: unknown;
      cursor?: string | null;
    }): Promise<OzonPublishAttemptListPage> {
      return options.attempts.listOwnedByWorkflow(input);
    },

    async getLatestAttempt(input: {
      workflowId: string;
      ownerUserId: string;
    }): Promise<OzonPublishAttemptSummary | null> {
      return options.attempts.getLatestOwnedByWorkflow(input);
    },

    async getAttempt(input: { attemptId: string; ownerUserId: string }): Promise<OzonPublishAttemptRecord | null> {
      return options.attempts.getOwned(input);
    },

    async resolveAttempt(input: {
      attemptId: string;
      ownerUserId: string;
      actorUserId: string;
      expectedStateVersion: number;
      resolution: OzonUnknownResolution;
    }): Promise<OzonPublishAttemptRecord> {
      if (!input.ownerUserId || input.actorUserId !== input.ownerUserId) {
        throw new OzonListingPublisherError(
          'OZON_PUBLISH_OWNER_REQUIRED', 'Only the listing owner can resolve an Ozon attempt', 403,
        );
      }
      return options.attempts.resolveUnknown(input);
    },

    async publish(input: {
      draftId: string;
      ownerUserId: string;
      actorUserId: string;
      expectedRevision: number;
      idempotencyKey: string;
    }): Promise<OzonPublishAttemptRecord> {
      if (!input.ownerUserId || input.actorUserId !== input.ownerUserId) {
        throw new OzonListingPublisherError(
          'OZON_PUBLISH_OWNER_REQUIRED', 'Only the listing owner can publish to Ozon', 403,
        );
      }
      const current = await options.workflow.getDraft({
        draftId: input.draftId,
        ownerUserId: input.ownerUserId,
      });
      if (!current) {
        throw new OzonListingPublisherError(
          'OZON_PUBLISH_DRAFT_NOT_FOUND', 'Listing draft was not found', 404,
        );
      }
      const draftStateHash = hashOzonListingPublishState(current);
      const frozen = await options.workflow.recordPublishIntent(input);
      if (frozen.intent.payloadHash !== draftStateHash) {
        throw new OzonListingPublisherError(
          'OZON_PUBLISH_COMPILE_STALE', 'Publish intent does not match the compiled draft state', 409,
        );
      }
      const persisted = await options.attempts.getByPublishIntent({
        publishIntentId: frozen.intent.id,
        ownerUserId: input.ownerUserId,
      });
      if (persisted && persisted.state !== 'PREPARED') return persisted;

      const compiled = await options.compile({ ownerUserId: input.ownerUserId, draft: frozen.draft });
      if (normalizeOzonPublishHash(compiled.draftStateHash, 'compiled draft state hash') !== draftStateHash) {
        throw new OzonListingPublisherError(
          'OZON_PUBLISH_COMPILE_STALE', 'Compiled Ozon payload is not bound to the frozen draft state', 409,
        );
      }

      const prepared = await options.attempts.prepare({
        publishIntentId: frozen.intent.id,
        ownerUserId: input.ownerUserId,
        catalogSnapshotId: compiled.catalogSnapshotId,
        catalogRevision: compiled.catalogRevision,
        catalogSnapshot: compiled.catalogSnapshot,
        catalogSnapshotHash: compiled.catalogSnapshotHash,
        attributeSchemaSnapshot: compiled.attributeSchemaSnapshot,
        attributeSchemaHash: compiled.attributeSchemaHash,
        publisherContractVersion: compiled.publisherContractVersion,
        endpoint: compiled.endpoint,
        requestPayload: compiled.requestPayload,
        requestPayloadHash: compiled.requestPayloadHash,
        offerTrace: compiled.offerTrace,
      });
      if (prepared.attempt.state !== 'PREPARED') return prepared.attempt;
      const preparedAttempt: OzonPublishAttemptRecord = prepared.attempt;

      const claim = await options.attempts.claimSubmission({
        attemptId: preparedAttempt.id,
        workerId,
        leaseMs,
      });
      if (!claim) {
        const latest = await options.attempts.getOwned({
          attemptId: preparedAttempt.id,
          ownerUserId: input.ownerUserId,
        });
        if (latest) return latest;
        throw new OzonListingPublisherError(
          'OZON_PUBLISH_ATTEMPT_UNAVAILABLE', 'Ozon publish attempt disappeared after preparation', 503,
        );
      }

      let outcome: OzonSubmissionOutcome;
      let acceptedTaskId: string | null = null;
      let stopHeartbeat = () => {};
      try {
        const persistedRequest = cloneOzonPublishObject(
          claim.attempt.requestPayload,
          'persisted Ozon request payload',
          8 * 1024 * 1024,
        );
        stopHeartbeat = startSubmissionHeartbeat({
          attempts: options.attempts,
          attemptId: claim.attempt.id,
          workerId,
          leaseToken: claim.leaseToken,
          leaseEpoch: claim.leaseEpoch,
          leaseMs,
          warn: options.warn,
        });
        const response = await options.submitImportOnce({
          ownerUserId: claim.attempt.ownerUserId,
          shopId: claim.attempt.shopId,
          requestPayload: persistedRequest,
          attempt: claim.attempt,
        });
        const taskId = extractOzonPublishTaskId(response);
        if (!taskId) {
          outcome = {
            kind: 'UNKNOWN',
            errorCode: 'OZON_TASK_ID_INVALID',
            errorMessage: 'Ozon returned no trustworthy task ID',
            response,
          };
        } else {
          acceptedTaskId = taskId;
          outcome = { kind: 'SUBMITTED', taskId, response, acceptanceSource: 'OZON_TASK_RESPONSE' };
        }
      } catch (error) {
        outcome = classifyOzonSubmissionError(error);
      } finally {
        stopHeartbeat();
      }

      try {
        return await options.attempts.completeSubmission({
          attemptId: claim.attempt.id,
          workerId,
          leaseToken: claim.leaseToken,
          leaseEpoch: claim.leaseEpoch,
          outcome,
        });
      } catch (error) {
        if (acceptedTaskId && outcome.kind === 'SUBMITTED') {
          options.warn?.(
            `Ozon task ${acceptedTaskId} could not be recorded normally; recovering its acknowledgement`,
            error,
          );
          try {
            return await recoverAcknowledgement({
              attemptId: claim.attempt.id,
              leaseToken: claim.leaseToken,
              leaseEpoch: claim.leaseEpoch,
              taskId: acceptedTaskId,
              response: outcome.response,
            });
          } catch (recoveryError) {
            options.warn?.(
              `CRITICAL: Ozon task ${acceptedTaskId} acknowledgement recovery failed for attempt ${claim.attempt.id}`,
              recoveryError,
            );
            throw recoveryError;
          }
        }
        throw error;
      }
    },
  };
}

export type OzonListingPublisher = ReturnType<typeof createOzonListingPublisher>;

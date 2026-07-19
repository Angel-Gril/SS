import { hashAiMediaPlanningJson } from './ai-media-planning.js';

export const AI_IMAGE_SUITE_DISPATCH_REQUEST_VERSION = 'ai-image-suite-dispatch-request/v1';
export const AI_IMAGE_SUITE_CANCEL_REQUEST_VERSION = 'ai-image-suite-cancel-request/v1';
export const AI_IMAGE_SUITE_RETRY_REQUEST_VERSION = 'ai-image-suite-slot-retry-request/v1';
export const AI_IMAGE_SUITE_EXECUTION_EVENT_KEY_VERSION = 'ai-image-suite-execution-key/v1';

const MAX_IDENTIFIER_LENGTH = 200;
const MAX_OPERATION_KEY_LENGTH = 128;
const MATERIALIZED_SUITE_REVISION = 4;
const MATERIALIZED_SLOT_REVISION = 2;

export type AiImageSuiteExecutionStatus =
  | 'PLANNED'
  | 'QUEUED'
  | 'RUNNING'
  | 'PARTIAL_FAILURE'
  | 'FAILED'
  | 'SUCCEEDED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED';

export type AiImageSuiteExecutionSlotStatus =
  | 'PLANNED'
  | 'QUEUED'
  | 'RUNNING'
  | 'SUCCEEDED'
  | 'FAILED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED';

export interface AiImageSuiteExecutionCounts {
  planned: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  cancelRequested: number;
  cancelled: number;
}

export interface AiImageSuiteExecutionSlot {
  slotId: string;
  ordinal: number;
  slotKey: string;
  status: AiImageSuiteExecutionSlotStatus;
  attempt: number;
  revision: number;
  childWorkflowId: string;
  error: { code: string; message: string } | null;
}

/** Public execution state. Provider request details and mutable asset internals stay server-side. */
export interface AiImageSuiteExecutionSummary {
  suiteId: string;
  revision: number;
  status: AiImageSuiteExecutionStatus;
  itemCount: number;
  concurrencyLimit: number;
  counts: AiImageSuiteExecutionCounts;
  slots: AiImageSuiteExecutionSlot[];
}

interface AiImageSuiteExecutionOperationInput {
  suiteId: string;
  ownerUserId: string;
  actorUserId: string;
  operationKey: string;
}

export interface DispatchAiImageSuiteInput extends AiImageSuiteExecutionOperationInput {
  expectedRevision: number;
}

export interface CancelAiImageSuiteInput extends AiImageSuiteExecutionOperationInput {
  expectedRevision: number;
}

export interface RetryAiImageSuiteSlotInput extends AiImageSuiteExecutionOperationInput {
  slotId: string;
  expectedSlotRevision: number;
}

export type AiImageSuiteExecutionReplayResult =
  | ({ kind: 'existing' } & AiImageSuiteExecutionSummary)
  | { kind: 'conflict' }
  | null;

export type AiImageSuiteDispatchResult =
  | ({ kind: 'committed' | 'existing' } & AiImageSuiteExecutionSummary)
  | {
    kind:
      | 'not-found'
      | 'not-materialized'
      | 'provider-not-ready'
      | 'already-dispatched'
      | 'revision-conflict'
      | 'conflict';
  };

export type AiImageSuiteCancelResult =
  | ({ kind: 'committed' | 'existing' } & AiImageSuiteExecutionSummary)
  | {
    kind:
      | 'not-found'
      | 'not-materialized'
      | 'not-cancellable'
      | 'revision-conflict'
      | 'conflict';
  };

export type AiImageSuiteSlotRetryResult =
  | ({ kind: 'committed' | 'existing' } & AiImageSuiteExecutionSummary)
  | {
    kind:
      | 'not-found'
      | 'not-materialized'
      | 'slot-not-found'
      | 'slot-not-failed'
      | 'retry-not-allowed'
      | 'slot-revision-conflict'
      | 'conflict';
  };

export interface AiImageSuiteExecutionRepository {
  findDispatchReplay(input: DispatchAiImageSuiteInput): Promise<AiImageSuiteExecutionReplayResult>;
  dispatch(input: DispatchAiImageSuiteInput): Promise<AiImageSuiteDispatchResult>;
  findCancelReplay(input: CancelAiImageSuiteInput): Promise<AiImageSuiteExecutionReplayResult>;
  cancel(input: CancelAiImageSuiteInput): Promise<AiImageSuiteCancelResult>;
  findRetryReplay(input: RetryAiImageSuiteSlotInput): Promise<AiImageSuiteExecutionReplayResult>;
  retryFailedSlot(input: RetryAiImageSuiteSlotInput): Promise<AiImageSuiteSlotRetryResult>;
}

export type AiImageSuiteExecutionErrorCode =
  | 'AI_MEDIA_SUITE_EXECUTION_INVALID_INPUT'
  | 'AI_MEDIA_SUITE_EXECUTION_IDEMPOTENCY_CONFLICT'
  | 'AI_MEDIA_SUITE_EXECUTION_NOT_FOUND'
  | 'AI_MEDIA_SUITE_EXECUTION_NOT_MATERIALIZED'
  | 'AI_MEDIA_SUITE_EXECUTION_PROVIDER_NOT_READY'
  | 'AI_MEDIA_SUITE_ALREADY_DISPATCHED'
  | 'AI_MEDIA_SUITE_DISPATCH_CONFLICT'
  | 'AI_MEDIA_SUITE_NOT_CANCELLABLE'
  | 'AI_MEDIA_SUITE_CANCEL_CONFLICT'
  | 'AI_MEDIA_SUITE_SLOT_NOT_FOUND'
  | 'AI_MEDIA_SUITE_SLOT_NOT_FAILED'
  | 'AI_MEDIA_SUITE_SLOT_RETRY_NOT_ALLOWED'
  | 'AI_MEDIA_SUITE_SLOT_RETRY_CONFLICT';

export class AiImageSuiteExecutionError extends Error {
  constructor(
    public readonly code: AiImageSuiteExecutionErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AiImageSuiteExecutionError';
  }
}

function fail(
  code: AiImageSuiteExecutionErrorCode,
  statusCode: number,
  message: string,
): never {
  throw new AiImageSuiteExecutionError(code, statusCode, message);
}

function exactString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > maxLength) {
    return fail('AI_MEDIA_SUITE_EXECUTION_INVALID_INPUT', 400, `${label} is invalid`);
  }
  return value;
}

function validateOperationInput(input: AiImageSuiteExecutionOperationInput): void {
  exactString(input.suiteId, 'suiteId', MAX_IDENTIFIER_LENGTH);
  exactString(input.ownerUserId, 'ownerUserId', MAX_IDENTIFIER_LENGTH);
  exactString(input.actorUserId, 'actorUserId', MAX_IDENTIFIER_LENGTH);
  const operationKey = exactString(input.operationKey, 'operationKey', MAX_OPERATION_KEY_LENGTH);
  if (operationKey.length < 8) {
    fail('AI_MEDIA_SUITE_EXECUTION_INVALID_INPUT', 400, 'operationKey is invalid');
  }
}

function validateDispatchInput(input: DispatchAiImageSuiteInput): void {
  validateOperationInput(input);
  if (!Number.isSafeInteger(input.expectedRevision)
    || input.expectedRevision !== MATERIALIZED_SUITE_REVISION) {
    fail(
      'AI_MEDIA_SUITE_EXECUTION_INVALID_INPUT',
      400,
      'Initial suite dispatch requires materialized suite revision 4',
    );
  }
}

function validateCancelInput(input: CancelAiImageSuiteInput): void {
  validateOperationInput(input);
  if (!Number.isSafeInteger(input.expectedRevision)
    || input.expectedRevision < MATERIALIZED_SUITE_REVISION) {
    fail('AI_MEDIA_SUITE_EXECUTION_INVALID_INPUT', 400, 'expectedRevision is invalid');
  }
}

function validateRetryInput(input: RetryAiImageSuiteSlotInput): void {
  validateOperationInput(input);
  exactString(input.slotId, 'slotId', MAX_IDENTIFIER_LENGTH);
  if (!Number.isSafeInteger(input.expectedSlotRevision)
    || input.expectedSlotRevision < MATERIALIZED_SLOT_REVISION) {
    fail('AI_MEDIA_SUITE_EXECUTION_INVALID_INPUT', 400, 'expectedSlotRevision is invalid');
  }
}

export function createAiImageSuiteDispatchRequestFingerprint(
  input: DispatchAiImageSuiteInput,
): string {
  return hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_DISPATCH_REQUEST_VERSION,
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    expectedRevision: input.expectedRevision,
    operationKey: input.operationKey,
  });
}

export function createAiImageSuiteCancelRequestFingerprint(
  input: CancelAiImageSuiteInput,
): string {
  return hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_CANCEL_REQUEST_VERSION,
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    expectedRevision: input.expectedRevision,
    operationKey: input.operationKey,
  });
}

export function createAiImageSuiteRetryRequestFingerprint(
  input: RetryAiImageSuiteSlotInput,
): string {
  return hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_RETRY_REQUEST_VERSION,
    suiteId: input.suiteId,
    slotId: input.slotId,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    expectedSlotRevision: input.expectedSlotRevision,
    operationKey: input.operationKey,
  });
}

export function createAiImageSuiteExecutionEventKey(
  input: Pick<AiImageSuiteExecutionOperationInput, 'ownerUserId' | 'operationKey'>,
): string {
  const digest = hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_EXECUTION_EVENT_KEY_VERSION,
    ownerUserId: input.ownerUserId,
    operationKey: input.operationKey,
  });
  return `suite-execution:${digest}`;
}

function replayOrConflict(
  replay: AiImageSuiteExecutionReplayResult,
): (AiImageSuiteExecutionSummary & { replayed: true }) | null {
  if (!replay) return null;
  if (replay.kind === 'conflict') {
    return fail(
      'AI_MEDIA_SUITE_EXECUTION_IDEMPOTENCY_CONFLICT',
      409,
      'AI media suite execution operation key conflicts',
    );
  }
  const { kind: _kind, ...summary } = replay;
  return { ...toPublicSummary(summary), replayed: true };
}

function toPublicSummary(summary: AiImageSuiteExecutionSummary): AiImageSuiteExecutionSummary {
  return {
    suiteId: summary.suiteId,
    revision: summary.revision,
    status: summary.status,
    itemCount: summary.itemCount,
    concurrencyLimit: summary.concurrencyLimit,
    counts: {
      planned: summary.counts.planned,
      queued: summary.counts.queued,
      running: summary.counts.running,
      succeeded: summary.counts.succeeded,
      failed: summary.counts.failed,
      cancelRequested: summary.counts.cancelRequested,
      cancelled: summary.counts.cancelled,
    },
    slots: summary.slots.map((slot) => ({
      slotId: slot.slotId,
      ordinal: slot.ordinal,
      slotKey: slot.slotKey,
      status: slot.status,
      attempt: slot.attempt,
      revision: slot.revision,
      childWorkflowId: slot.childWorkflowId,
      error: slot.error ? { code: slot.error.code, message: slot.error.message } : null,
    })),
  };
}

function committedSummary(
  result:
    | Extract<AiImageSuiteDispatchResult, { kind: 'committed' | 'existing' }>
    | Extract<AiImageSuiteCancelResult, { kind: 'committed' | 'existing' }>
    | Extract<AiImageSuiteSlotRetryResult, { kind: 'committed' | 'existing' }>,
) {
  const { kind, ...summary } = result;
  return { ...toPublicSummary(summary), replayed: kind === 'existing' };
}

function mapDispatchFailure(result: AiImageSuiteDispatchResult): never {
  if (result.kind === 'not-found') {
    return fail('AI_MEDIA_SUITE_EXECUTION_NOT_FOUND', 404, 'AI media suite was not found');
  }
  if (result.kind === 'not-materialized') {
    return fail(
      'AI_MEDIA_SUITE_EXECUTION_NOT_MATERIALIZED',
      409,
      'AI media suite child graph is not materialized',
    );
  }
  if (result.kind === 'provider-not-ready') {
    return fail(
      'AI_MEDIA_SUITE_EXECUTION_PROVIDER_NOT_READY',
      503,
      'AI media suite Provider is not ready for dispatch',
    );
  }
  if (result.kind === 'already-dispatched') {
    return fail(
      'AI_MEDIA_SUITE_ALREADY_DISPATCHED',
      409,
      'AI media suite was already dispatched by another operation',
    );
  }
  return fail(
    'AI_MEDIA_SUITE_DISPATCH_CONFLICT',
    409,
    'AI media suite changed during dispatch',
  );
}

function mapCancelFailure(result: AiImageSuiteCancelResult): never {
  if (result.kind === 'not-found') {
    return fail('AI_MEDIA_SUITE_EXECUTION_NOT_FOUND', 404, 'AI media suite was not found');
  }
  if (result.kind === 'not-materialized') {
    return fail(
      'AI_MEDIA_SUITE_EXECUTION_NOT_MATERIALIZED',
      409,
      'AI media suite child graph is not materialized',
    );
  }
  if (result.kind === 'not-cancellable') {
    return fail(
      'AI_MEDIA_SUITE_NOT_CANCELLABLE',
      409,
      'AI media suite is terminal or cannot be cancelled',
    );
  }
  return fail(
    'AI_MEDIA_SUITE_CANCEL_CONFLICT',
    409,
    'AI media suite changed during cancellation',
  );
}

function mapRetryFailure(result: AiImageSuiteSlotRetryResult): never {
  if (result.kind === 'not-found') {
    return fail('AI_MEDIA_SUITE_EXECUTION_NOT_FOUND', 404, 'AI media suite was not found');
  }
  if (result.kind === 'not-materialized') {
    return fail(
      'AI_MEDIA_SUITE_EXECUTION_NOT_MATERIALIZED',
      409,
      'AI media suite child graph is not materialized',
    );
  }
  if (result.kind === 'slot-not-found') {
    return fail('AI_MEDIA_SUITE_SLOT_NOT_FOUND', 404, 'AI media suite slot was not found');
  }
  if (result.kind === 'slot-not-failed') {
    return fail(
      'AI_MEDIA_SUITE_SLOT_NOT_FAILED',
      409,
      'Only one failed AI media suite slot can be retried',
    );
  }
  if (result.kind === 'retry-not-allowed') {
    return fail(
      'AI_MEDIA_SUITE_SLOT_RETRY_NOT_ALLOWED',
      409,
      'AI media suite does not allow slot retry in its current state',
    );
  }
  return fail(
    'AI_MEDIA_SUITE_SLOT_RETRY_CONFLICT',
    409,
    'AI media suite slot changed during retry',
  );
}

export function createAiImageSuiteExecutionService(
  repository: AiImageSuiteExecutionRepository,
) {
  return {
    async dispatch(input: DispatchAiImageSuiteInput) {
      validateDispatchInput(input);
      const replay = replayOrConflict(await repository.findDispatchReplay(input));
      if (replay) return replay;
      const result = await repository.dispatch(input);
      if (result.kind === 'committed' || result.kind === 'existing') {
        return committedSummary(result);
      }
      return mapDispatchFailure(result);
    },

    async cancel(input: CancelAiImageSuiteInput) {
      validateCancelInput(input);
      const replay = replayOrConflict(await repository.findCancelReplay(input));
      if (replay) return replay;
      const result = await repository.cancel(input);
      if (result.kind === 'committed' || result.kind === 'existing') {
        return committedSummary(result);
      }
      return mapCancelFailure(result);
    },

    async retryFailedSlot(input: RetryAiImageSuiteSlotInput) {
      validateRetryInput(input);
      const replay = replayOrConflict(await repository.findRetryReplay(input));
      if (replay) return replay;
      const result = await repository.retryFailedSlot(input);
      if (result.kind === 'committed' || result.kind === 'existing') {
        return committedSummary(result);
      }
      return mapRetryFailure(result);
    },
  };
}

export type AiImageSuiteExecutionService = ReturnType<
  typeof createAiImageSuiteExecutionService
>;

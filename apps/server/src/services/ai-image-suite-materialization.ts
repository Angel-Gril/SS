import { hashAiMediaPlanningJson } from './ai-media-planning.js';
import type { AiImageSuiteCostControlFailure } from './ai-image-suite-cost-controls.js';

export const AI_IMAGE_SUITE_MATERIALIZATION_REQUEST_VERSION = 'ai-image-suite-materialization-request/v1';
export const AI_IMAGE_SUITE_MATERIALIZATION_EVENT_VERSION = 'ai-image-suite-children-materialized/v1';
export const AI_IMAGE_SUITE_CHILD_FINGERPRINT_VERSION = 'ai-image-suite-child-workflow/v1';
export const AI_IMAGE_SUITE_CHILD_BINDING_VERSION = 'ai-image-suite-child-binding/v1';
export const AI_IMAGE_SUITE_CHILD_OPERATION_CONFIG_VERSION = 'ai-image-suite-child-operation/v1';
export const AI_IMAGE_SUITE_PAID_CHILD_OPERATION_CONFIG_VERSION = 'ai-image-suite-child-operation/v2';
export const AI_IMAGE_SUITE_OUTPUT_PROFILE_VERSION = 'ozon-suite-3x4-900x1200/v1';
export const AI_IMAGE_SUITE_OUTPUT_WIDTH = 900;
export const AI_IMAGE_SUITE_OUTPUT_HEIGHT = 1200;

const MAX_OPERATION_KEY_LENGTH = 128;

export interface MaterializeAiImageSuiteInput {
  suiteId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedRevision: number;
  operationKey: string;
}

export interface AiImageSuiteMaterializedChild {
  ordinal: number;
  slotKey: string;
  childWorkflowId: string;
}

export interface AiImageSuiteMaterializationSummary {
  suiteId: string;
  revision: 4;
  status: 'PLANNED';
  childCount: number;
  estimatedCostCents: number;
  maximumCostCents: number;
  materializationHash: string;
  children: AiImageSuiteMaterializedChild[];
}

export type AiImageSuiteMaterializationReplayResult =
  | ({ kind: 'existing' } & AiImageSuiteMaterializationSummary)
  | { kind: 'already-materialized' | 'conflict' }
  | null;

export type AiImageSuiteMaterializationCommitResult =
  | ({ kind: 'committed' | 'existing' } & AiImageSuiteMaterializationSummary)
  | AiImageSuiteCostControlFailure
  | {
    kind:
      | 'already-materialized'
      | 'active-suite-conflict'
      | 'conflict'
      | 'not-found'
      | 'stale'
      | 'prompts-not-ready'
      | 'provider-runtime-unavailable'
      | 'revision-conflict';
  };

export interface AiImageSuiteMaterializationRepository {
  findReplay(input: MaterializeAiImageSuiteInput): Promise<AiImageSuiteMaterializationReplayResult>;
  materialize(input: MaterializeAiImageSuiteInput): Promise<AiImageSuiteMaterializationCommitResult>;
}

export type AiImageSuiteMaterializationErrorCode =
  | 'AI_MEDIA_SUITE_MATERIALIZATION_INVALID_INPUT'
  | 'AI_MEDIA_SUITE_MATERIALIZATION_NOT_FOUND'
  | 'AI_MEDIA_SUITE_MATERIALIZATION_STALE'
  | 'AI_MEDIA_SUITE_PROMPTS_NOT_READY'
  | 'AI_MEDIA_SUITE_PROVIDER_RUNTIME_NOT_READY'
  | 'AI_MEDIA_SUITE_CHILDREN_ALREADY_MATERIALIZED'
  | 'AI_MEDIA_SUITE_PLAN_ACTIVE_CONFLICT'
  | 'AI_MEDIA_SUITE_DAILY_QUOTA_EXCEEDED'
  | 'AI_MEDIA_SUITE_GLOBAL_BUDGET_EXCEEDED'
  | 'AI_MEDIA_SUITE_COST_CONTROLS_UNAVAILABLE'
  | 'AI_MEDIA_SUITE_MATERIALIZATION_CONFLICT';

export class AiImageSuiteMaterializationError extends Error {
  constructor(
    public readonly code: AiImageSuiteMaterializationErrorCode,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'AiImageSuiteMaterializationError';
  }
}

function fail(
  code: AiImageSuiteMaterializationErrorCode,
  statusCode: number,
  message: string,
): never {
  throw new AiImageSuiteMaterializationError(code, statusCode, message);
}

function exactString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value.length > maxLength) {
    return fail('AI_MEDIA_SUITE_MATERIALIZATION_INVALID_INPUT', 400, `${label} is invalid`);
  }
  return value;
}

export function createAiImageSuiteMaterializationRequestFingerprint(
  input: MaterializeAiImageSuiteInput,
): string {
  return hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_MATERIALIZATION_REQUEST_VERSION,
    suiteId: input.suiteId,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    expectedRevision: input.expectedRevision,
    operationKey: input.operationKey,
  });
}

export function createAiImageSuiteMaterializationEventKey(
  input: Pick<MaterializeAiImageSuiteInput, 'ownerUserId' | 'operationKey'>,
): string {
  const digest = hashAiMediaPlanningJson({
    version: AI_IMAGE_SUITE_MATERIALIZATION_REQUEST_VERSION,
    ownerUserId: input.ownerUserId,
    operationKey: input.operationKey,
  });
  return `suite-materialize:${digest}`;
}

function validateInput(input: MaterializeAiImageSuiteInput): void {
  exactString(input.suiteId, 'suiteId', 200);
  exactString(input.ownerUserId, 'ownerUserId', 200);
  exactString(input.actorUserId, 'actorUserId', 200);
  const operationKey = exactString(input.operationKey, 'operationKey', MAX_OPERATION_KEY_LENGTH);
  if (operationKey.length < 8 || input.expectedRevision !== 3) {
    fail(
      'AI_MEDIA_SUITE_MATERIALIZATION_INVALID_INPUT',
      400,
      'Child materialization requires suite revision 3 and a valid operation key',
    );
  }
}

function mapReplayFailure(
  result: Exclude<AiImageSuiteMaterializationReplayResult, null | { kind: 'existing' }>,
): never {
  if (result.kind === 'already-materialized') {
    return fail(
      'AI_MEDIA_SUITE_CHILDREN_ALREADY_MATERIALIZED',
      409,
      'AI media suite children are already materialized',
    );
  }
  return fail(
    'AI_MEDIA_SUITE_MATERIALIZATION_CONFLICT',
    409,
    'AI media suite materialization operation conflicts',
  );
}

function mapCommitFailure(result: AiImageSuiteMaterializationCommitResult): never {
  if (result.kind === 'quota-exceeded') {
    return fail(
      'AI_MEDIA_SUITE_DAILY_QUOTA_EXCEEDED',
      429,
      `AI image suite daily quota exceeded (${result.used} + ${result.requested}/${result.limit})`,
    );
  }
  if (result.kind === 'budget-exceeded') {
    return fail(
      'AI_MEDIA_SUITE_GLOBAL_BUDGET_EXCEEDED',
      429,
      `Global daily AI budget exceeded (${result.settledCostCents + result.pendingMaximumCostCents + result.requestedMaximumCostCents}/${result.limit})`,
    );
  }
  if (result.kind === 'cost-controls-unavailable') {
    return fail('AI_MEDIA_SUITE_COST_CONTROLS_UNAVAILABLE', 503, result.reason);
  }
  if (result.kind === 'not-found') {
    return fail(
      'AI_MEDIA_SUITE_MATERIALIZATION_NOT_FOUND',
      404,
      'AI media suite was not found',
    );
  }
  if (result.kind === 'stale') {
    return fail(
      'AI_MEDIA_SUITE_MATERIALIZATION_STALE',
      409,
      'AI media suite source authority is stale',
    );
  }
  if (result.kind === 'prompts-not-ready') {
    return fail(
      'AI_MEDIA_SUITE_PROMPTS_NOT_READY',
      409,
      'AI media suite frozen Prompts are incomplete',
    );
  }
  if (result.kind === 'provider-runtime-unavailable') {
    return fail(
      'AI_MEDIA_SUITE_PROVIDER_RUNTIME_NOT_READY',
      503,
      'AI media suite Provider runtime is unavailable or changed',
    );
  }
  if (result.kind === 'already-materialized') {
    return fail(
      'AI_MEDIA_SUITE_CHILDREN_ALREADY_MATERIALIZED',
      409,
      'AI media suite children are already materialized',
    );
  }
  if (result.kind === 'active-suite-conflict') {
    return fail(
      'AI_MEDIA_SUITE_PLAN_ACTIVE_CONFLICT',
      409,
      'Another plan version already has an actionable AI media suite',
    );
  }
  return fail(
    'AI_MEDIA_SUITE_MATERIALIZATION_CONFLICT',
    409,
    'AI media suite changed during child materialization',
  );
}

export function createAiImageSuiteMaterializationService(
  repository: AiImageSuiteMaterializationRepository,
) {
  return {
    async materialize(input: MaterializeAiImageSuiteInput) {
      validateInput(input);
      const replay = await repository.findReplay(input);
      if (replay?.kind === 'existing') {
        const { kind: _kind, ...summary } = replay;
        return { ...summary, replayed: true };
      }
      if (replay) return mapReplayFailure(replay);

      const result = await repository.materialize(input);
      if (result.kind === 'committed' || result.kind === 'existing') {
        const { kind, ...summary } = result;
        return { ...summary, replayed: kind === 'existing' };
      }
      return mapCommitFailure(result);
    },
  };
}

export type AiImageSuiteMaterializationService = ReturnType<
  typeof createAiImageSuiteMaterializationService
>;

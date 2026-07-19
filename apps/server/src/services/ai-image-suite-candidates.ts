export type AiImageSuiteCandidateDecision = 'APPROVE' | 'REJECT';

export interface ReviewAiImageSuiteCandidateInput {
  suiteId: string;
  slotId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedWorkflowRevision: number;
  operationKey: string;
  outputAssetId: string;
  decision: AiImageSuiteCandidateDecision;
  note: string | null;
  production: boolean;
}

export interface ApplyAiImageSuiteCandidateInput {
  suiteId: string;
  slotId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedWorkflowRevision: number;
  operationKey: string;
  expectedTargetUpdatedAt: string;
  production: boolean;
}

export interface AiImageSuiteCandidateApplication {
  suiteId: string;
  slotId: string;
  workflowId: string;
  jobId: string;
  outputAssetId: string;
  mode: 'append';
  targetType: 'collect';
  targetId: string;
  images: unknown[];
  mainImage: string | null;
  editedImages: unknown[];
  targetUpdatedAt: Date;
  appliedAt: Date;
}

export interface AiImageSuiteCandidateReview {
  suiteId: string;
  slotId: string;
  workflowId: string;
  outputAssetId: string;
  reviewStatus: 'APPROVED' | 'REJECTED';
  workflowRevision: number;
  reviewedAt: Date;
}

export type AiImageSuiteCandidateRepositoryResult<T> =
  | { kind: 'updated'; value: T }
  | { kind: 'replayed'; value: T }
  | { kind: 'not-found' }
  | { kind: 'provider-not-ready' }
  | { kind: 'stale' }
  | { kind: 'revision-conflict' }
  | { kind: 'state-conflict' }
  | { kind: 'output-conflict' }
  | { kind: 'operation-conflict' }
  | { kind: 'target-conflict'; targetUpdatedAt?: Date };

export interface AiImageSuiteCandidateRepository {
  review(
    input: ReviewAiImageSuiteCandidateInput,
  ): Promise<AiImageSuiteCandidateRepositoryResult<AiImageSuiteCandidateReview>>;
  apply(
    input: ApplyAiImageSuiteCandidateInput,
  ): Promise<AiImageSuiteCandidateRepositoryResult<AiImageSuiteCandidateApplication>>;
}

export type AiImageSuiteCandidateErrorCode =
  | 'AI_MEDIA_SUITE_CANDIDATE_INVALID_INPUT'
  | 'AI_MEDIA_SUITE_CANDIDATE_NOT_FOUND'
  | 'AI_MEDIA_SUITE_CANDIDATE_PROVIDER_NOT_READY'
  | 'AI_MEDIA_SUITE_CANDIDATE_STALE'
  | 'AI_MEDIA_SUITE_CANDIDATE_REVISION_CONFLICT'
  | 'AI_MEDIA_SUITE_CANDIDATE_STATE_CONFLICT'
  | 'AI_MEDIA_SUITE_CANDIDATE_OUTPUT_CONFLICT'
  | 'AI_MEDIA_SUITE_CANDIDATE_OPERATION_CONFLICT'
  | 'AI_MEDIA_SUITE_CANDIDATE_TARGET_CONFLICT';

export class AiImageSuiteCandidateError extends Error {
  constructor(
    public readonly code: AiImageSuiteCandidateErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly data?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AiImageSuiteCandidateError';
  }
}

function exactText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max) {
    throw new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_INVALID_INPUT',
      `${label} is invalid`,
      400,
    );
  }
  return value;
}

function validateCommon(input: {
  suiteId: string;
  slotId: string;
  ownerUserId: string;
  actorUserId: string;
  expectedWorkflowRevision: number;
  operationKey: string;
}) {
  exactText(input.suiteId, 'suiteId', 200);
  exactText(input.slotId, 'slotId', 200);
  exactText(input.ownerUserId, 'ownerUserId', 200);
  exactText(input.actorUserId, 'actorUserId', 200);
  exactText(input.operationKey, 'operationKey', 128);
  if (input.operationKey.length < 8) {
    throw new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_INVALID_INPUT',
      'operationKey is invalid',
      400,
    );
  }
  if (!Number.isSafeInteger(input.expectedWorkflowRevision) || input.expectedWorkflowRevision < 1) {
    throw new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_INVALID_INPUT',
      'expectedWorkflowRevision is invalid',
      400,
    );
  }
}

function resultError<T>(result: AiImageSuiteCandidateRepositoryResult<T>): never {
  if (result.kind === 'not-found') {
    throw new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_NOT_FOUND',
      'AI media suite candidate was not found',
      404,
    );
  }
  if (result.kind === 'provider-not-ready') {
    throw new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_PROVIDER_NOT_READY',
      'Test-only AI media suite candidates cannot cross the production boundary',
      503,
    );
  }
  if (result.kind === 'stale') {
    throw new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_STALE',
      'AI media suite candidate is stale against the current plan or source capture',
      409,
    );
  }
  if (result.kind === 'revision-conflict') {
    throw new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_REVISION_CONFLICT',
      'AI media suite candidate revision changed',
      409,
    );
  }
  if (result.kind === 'state-conflict') {
    throw new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_STATE_CONFLICT',
      'AI media suite candidate cannot be changed in its current state',
      409,
    );
  }
  if (result.kind === 'output-conflict') {
    throw new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_OUTPUT_CONFLICT',
      'AI media suite candidate output is not the current successful output',
      409,
    );
  }
  if (result.kind === 'operation-conflict') {
    throw new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_OPERATION_CONFLICT',
      'AI media suite candidate operation was already completed with different input',
      409,
    );
  }
  if (result.kind === 'target-conflict') {
    throw new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_TARGET_CONFLICT',
      'Product images were updated by another operation',
      409,
      result.targetUpdatedAt ? { targetUpdatedAt: result.targetUpdatedAt } : undefined,
    );
  }
  throw new AiImageSuiteCandidateError(
    'AI_MEDIA_SUITE_CANDIDATE_STATE_CONFLICT',
    'AI media suite candidate result is invalid',
    409,
  );
}

export function createAiImageSuiteCandidateService(
  repository: AiImageSuiteCandidateRepository,
) {
  return {
    async review(input: ReviewAiImageSuiteCandidateInput) {
      validateCommon(input);
      exactText(input.outputAssetId, 'outputAssetId', 200);
      if (input.decision !== 'APPROVE' && input.decision !== 'REJECT') {
        throw new AiImageSuiteCandidateError(
          'AI_MEDIA_SUITE_CANDIDATE_INVALID_INPUT',
          'review decision is invalid',
          400,
        );
      }
      if (input.note !== null && (
        typeof input.note !== 'string'
        || input.note !== input.note.trim()
        || input.note.length > 2_000
      )) {
        throw new AiImageSuiteCandidateError(
          'AI_MEDIA_SUITE_CANDIDATE_INVALID_INPUT',
          'review note is invalid',
          400,
        );
      }
      const result = await repository.review(input);
      if (result.kind !== 'updated' && result.kind !== 'replayed') resultError(result);
      return { review: result.value, replayed: result.kind === 'replayed' };
    },

    async apply(input: ApplyAiImageSuiteCandidateInput) {
      validateCommon(input);
      const targetVersion = new Date(input.expectedTargetUpdatedAt);
      if (!input.expectedTargetUpdatedAt || Number.isNaN(targetVersion.getTime())) {
        throw new AiImageSuiteCandidateError(
          'AI_MEDIA_SUITE_CANDIDATE_INVALID_INPUT',
          'expectedTargetUpdatedAt is invalid',
          400,
        );
      }
      const result = await repository.apply(input);
      if (result.kind !== 'updated' && result.kind !== 'replayed') resultError(result);
      return { application: result.value, replayed: result.kind === 'replayed' };
    },
  };
}

export type AiImageSuiteCandidateService = ReturnType<typeof createAiImageSuiteCandidateService>;

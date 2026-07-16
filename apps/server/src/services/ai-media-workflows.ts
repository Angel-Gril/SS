import { createHash } from 'node:crypto';

export type AiMediaWorkflowStatus =
  | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';
export type AiMediaReviewStatus = 'NOT_READY' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AiMediaWorkflowRecord {
  id: string;
  ownerUserId: string;
  actorUserId: string | null;
  operation: 'IMAGE_TO_IMAGE';
  status: AiMediaWorkflowStatus;
  reviewStatus: AiMediaReviewStatus;
  revision: number;
  currentAttempt: number;
  contextType: string | null;
  contextId: string | null;
  contextSkuKey: string | null;
  contextSlotKey: string | null;
  idempotencyKey: string | null;
  requestFingerprint: string;
  selectedOutputAssetId: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  inputs?: Array<Record<string, unknown>>;
  jobs?: Array<Record<string, unknown>>;
  events?: Array<Record<string, unknown>>;
}

export interface CreateAiMediaWorkflowInput {
  ownerUserId: string;
  actorUserId: string;
  sourceAssetId: string;
  prompt: string;
  negativePrompt: string | null;
  count: number;
  width: number;
  height: number;
  idempotencyKey: string;
  context: { type: 'collect'; id: string; skuKey?: string | null; slotKey?: string | null };
}

export interface AiMediaWorkflowRepository {
  createImageToImage(input: CreateAiMediaWorkflowInput): Promise<{
    kind: 'created' | 'existing' | 'conflict';
    workflow: AiMediaWorkflowRecord;
    jobId: string;
  }>;
  listOwned(input: {
    ownerUserId: string;
    contextType?: string;
    contextId?: string;
    limit: number;
  }): Promise<AiMediaWorkflowRecord[]>;
  getOwned(id: string, ownerUserId: string): Promise<AiMediaWorkflowRecord | null>;
  cancelOwned(id: string, ownerUserId: string, actorUserId: string, expectedRevision: number): Promise<AiMediaWorkflowRecord | null>;
  retryOwned(input: {
    id: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<{ workflow: AiMediaWorkflowRecord; jobId: string; replayed: boolean } | null>;
  reviewOwned(input: {
    id: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
    outputAssetId: string;
    decision: 'APPROVE' | 'REJECT';
    note: string | null;
  }): Promise<AiMediaWorkflowRecord | null>;
}

export class AiMediaWorkflowError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'AiMediaWorkflowError';
  }
}

export function aiMediaPayloadHash(payload: unknown) {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function createAiMediaWorkflowFingerprint(input: Omit<CreateAiMediaWorkflowInput, 'actorUserId' | 'idempotencyKey'>) {
  return aiMediaPayloadHash({
    operation: 'IMAGE_TO_IMAGE',
    ownerUserId: input.ownerUserId,
    sourceAssetId: input.sourceAssetId,
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    count: input.count,
    width: input.width,
    height: input.height,
    context: input.context,
  });
}

export function createAiMediaWorkflowService(repository: AiMediaWorkflowRepository) {
  return {
    async createImageToImage(input: CreateAiMediaWorkflowInput) {
      if (!input.prompt.trim()) throw new AiMediaWorkflowError('INVALID_REQUEST', 'Prompt is required');
      if (input.count !== 1) throw new AiMediaWorkflowError('INVALID_REQUEST', 'The first image-to-image slice supports one output');
      const result = await repository.createImageToImage(input);
      if (result.kind === 'conflict') {
        throw new AiMediaWorkflowError('IDEMPOTENCY_KEY_CONFLICT', 'Idempotency key was used for another media workflow');
      }
      return { workflow: result.workflow, jobId: result.jobId, replayed: result.kind === 'existing' };
    },

    list(input: { ownerUserId: string; contextType?: string; contextId?: string; limit?: number }) {
      return repository.listOwned({ ...input, limit: Math.min(100, Math.max(1, input.limit || 20)) });
    },

    async get(id: string, ownerUserId: string) {
      const workflow = await repository.getOwned(id, ownerUserId);
      if (!workflow) throw new AiMediaWorkflowError('NOT_FOUND', 'AI media workflow not found');
      return workflow;
    },

    async cancel(id: string, ownerUserId: string, actorUserId: string, expectedRevision: number) {
      const workflow = await repository.cancelOwned(id, ownerUserId, actorUserId, expectedRevision);
      if (!workflow) throw new AiMediaWorkflowError('WORKFLOW_CONFLICT', 'Workflow changed or cannot be cancelled');
      return workflow;
    },

    async retry(input: Parameters<AiMediaWorkflowRepository['retryOwned']>[0]) {
      const result = await repository.retryOwned(input);
      if (!result) {
        throw new AiMediaWorkflowError(
          'RECOVERY_REQUIRED',
          'Workflow changed, is not retryable, or has a submitted provider task that must be reconciled',
        );
      }
      return result;
    },

    async review(input: Parameters<AiMediaWorkflowRepository['reviewOwned']>[0]) {
      const workflow = await repository.reviewOwned(input);
      if (!workflow) throw new AiMediaWorkflowError('WORKFLOW_CONFLICT', 'Workflow changed or output cannot be reviewed');
      return workflow;
    },
  };
}

export type AiMediaWorkflowService = ReturnType<typeof createAiMediaWorkflowService>;

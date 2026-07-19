import { createHash } from 'node:crypto';
import {
  AiMediaCapabilityError,
  assertAiMediaCapability,
  type AiMediaOperation,
} from './ai-image-provider-capabilities.js';

export const AI_MEDIA_WORKFLOW_PROVIDER = 'fake';
export const AI_MEDIA_WORKFLOW_MODEL = 'fake-image-to-image-v1';
export const AI_MEDIA_TRANSLATION_POLICY_VERSION = 'ai-image-translation-policy/1.0';

export type AiMediaWorkflowStatus =
  | 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCEL_REQUESTED' | 'CANCELLED';
export type AiMediaReviewStatus = 'NOT_READY' | 'PENDING' | 'APPROVED' | 'REJECTED';

export interface AiMediaWorkflowRecord {
  id: string;
  ownerUserId: string;
  actorUserId: string | null;
  operation: AiMediaOperation;
  status: AiMediaWorkflowStatus;
  reviewStatus: AiMediaReviewStatus;
  revision: number;
  currentAttempt: number;
  contextType: string | null;
  contextId: string | null;
  contextSkuKey: string | null;
  contextSlotKey: string | null;
  /** Present only for internal routing; suite children are parent-owned. */
  suiteId?: string | null;
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
  sourceAssetId?: string;
  references?: Array<{ assetId: string }>;
  prompt: string;
  negativePrompt: string | null;
  count: number;
  width: number;
  height: number;
  idempotencyKey: string;
  context: { type: 'collect'; id: string; skuKey?: string | null; slotKey?: string | null };
}

export interface CreateAiImageTranslationWorkflowInput {
  ownerUserId: string;
  actorUserId: string;
  sourceAssetId: string;
  sourceLanguage: string;
  targetLanguage: string;
  domainHint: string;
  terminologies: Array<{ src: string; tgt: string }>;
  imageSegment?: false;
  provider: string;
  model: string;
  dailyLimit: number;
  estimatedCostCents: number;
  prompt?: string | null;
  resolvedPrompt?: string | null;
  resolvedNegativePrompt?: string | null;
  templateKey?: string | null;
  templateReleaseId?: string | null;
  templateChecksum?: string | null;
  templateSnapshot?: Record<string, unknown> | null;
  idempotencyKey: string;
  context: { type: 'collect'; id: string; skuKey?: string | null; slotKey?: string | null };
}

export function normalizeAiImageTranslationOptions(input: Pick<
  CreateAiImageTranslationWorkflowInput,
  'sourceLanguage' | 'targetLanguage' | 'domainHint' | 'terminologies' | 'imageSegment'
>) {
  const sourceLanguage = String(input.sourceLanguage || '').trim().toLowerCase();
  const targetLanguage = String(input.targetLanguage || '').trim().toLowerCase();
  if (
    !/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/u.test(sourceLanguage)
    || !/^[a-z]{2,12}(?:[-_][a-z0-9]{2,12})?$/u.test(targetLanguage)
    || sourceLanguage === targetLanguage
  ) {
    throw new AiMediaWorkflowError('INVALID_REQUEST', 'Image translation languages are invalid');
  }
  const userDomainHint = String(input.domainHint || '').trim();
  const terms = Array.isArray(input.terminologies)
    ? input.terminologies.map((term) => ({ src: String(term?.src || '').trim(), tgt: String(term?.tgt || '').trim() }))
    : [];
  if (
    terms.length > 50
    || terms.some((term) => !term.src || !term.tgt || term.src.length > 120 || term.tgt.length > 120)
    || new Set(terms.map((term) => term.src.toLocaleLowerCase())).size !== terms.length
  ) {
    throw new AiMediaWorkflowError('INVALID_REQUEST', 'Image translation terminology is invalid');
  }
  if (input.imageSegment != null && input.imageSegment !== false) {
    throw new AiMediaWorkflowError('INVALID_REQUEST', 'Image translation segmentation must remain disabled');
  }
  const policy = [
    'Translate only visible product marketing copy.',
    'Preserve product identity, layout, numbers, model codes, and standalone brand names.',
    userDomainHint,
  ].filter(Boolean).join('\n');
  if (Buffer.byteLength(policy, 'utf8') > 16_000) {
    throw new AiMediaWorkflowError('INVALID_REQUEST', 'Compiled image translation provider policy is too long');
  }
  return {
    sourceLanguage,
    targetLanguage,
    domainHint: policy,
    terminologies: terms,
    imageSegment: false as const,
    policyVersion: AI_MEDIA_TRANSLATION_POLICY_VERSION,
  };
}

export function normalizeAiMediaWorkflowReferences(
  input: Pick<CreateAiMediaWorkflowInput, 'sourceAssetId' | 'references'>,
) {
  if (input.sourceAssetId && input.references) {
    throw new AiMediaWorkflowError(
      'INVALID_REQUEST',
      'Use either sourceAssetId or references, not both',
    );
  }
  const references = input.references
    ? input.references.map((reference) => ({ assetId: String(reference?.assetId || '').trim() }))
    : input.sourceAssetId
      ? [{ assetId: input.sourceAssetId.trim() }]
      : [];
  if (!references.length || references.some((reference) => !reference.assetId)) {
    throw new AiMediaWorkflowError('INVALID_REQUEST', 'At least one source reference is required');
  }
  if (new Set(references.map((reference) => reference.assetId)).size !== references.length) {
    throw new AiMediaWorkflowError('INVALID_REQUEST', 'Source references must be unique');
  }
  return references;
}

export interface AiMediaWorkflowRepository {
  createImageToImage(input: CreateAiMediaWorkflowInput): Promise<{
    kind: 'created' | 'existing' | 'conflict';
    workflow: AiMediaWorkflowRecord;
    jobId: string;
  }>;
  createImageTranslation?(input: CreateAiImageTranslationWorkflowInput & {
    options: ReturnType<typeof normalizeAiImageTranslationOptions>;
  }): Promise<{
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
    dailyLimit?: number;
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
  const references = normalizeAiMediaWorkflowReferences(input);
  return aiMediaPayloadHash({
    operation: 'IMAGE_TO_IMAGE',
    ownerUserId: input.ownerUserId,
    ...(input.references
      ? { references }
      : { sourceAssetId: references[0]!.assetId }),
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    count: input.count,
    width: input.width,
    height: input.height,
    context: input.context,
  });
}

export function createAiImageTranslationWorkflowFingerprint(input: Omit<
  CreateAiImageTranslationWorkflowInput,
  'actorUserId' | 'idempotencyKey' | 'dailyLimit'
> & { options: ReturnType<typeof normalizeAiImageTranslationOptions> }) {
  return aiMediaPayloadHash({
    operation: 'IMAGE_TRANSLATE',
    ownerUserId: input.ownerUserId,
    sourceAssetId: input.sourceAssetId,
    sourceLanguage: input.options.sourceLanguage,
    targetLanguage: input.options.targetLanguage,
    domainHint: input.options.domainHint,
    terminologies: input.options.terminologies,
    imageSegment: false,
    provider: input.provider,
    model: input.model,
    prompt: input.prompt || '',
    resolvedPrompt: input.resolvedPrompt || '',
    resolvedNegativePrompt: input.resolvedNegativePrompt || '',
    templateKey: input.templateKey || null,
    templateReleaseId: input.templateReleaseId || null,
    templateChecksum: input.templateChecksum || null,
    templateSnapshot: input.templateSnapshot || null,
    context: input.context,
  });
}

export function createAiMediaWorkflowService(repository: AiMediaWorkflowRepository) {
  return {
    async createImageToImage(input: CreateAiMediaWorkflowInput) {
      if (!input.prompt.trim()) throw new AiMediaWorkflowError('INVALID_REQUEST', 'Prompt is required');
      if (input.count !== 1) throw new AiMediaWorkflowError('INVALID_REQUEST', 'The first image-to-image slice supports one output');
      const references = normalizeAiMediaWorkflowReferences(input);
      try {
        assertAiMediaCapability({
          provider: AI_MEDIA_WORKFLOW_PROVIDER,
          model: AI_MEDIA_WORKFLOW_MODEL,
          operation: 'IMAGE_TO_IMAGE',
          inputCount: references.length,
        });
      } catch (error) {
        if (error instanceof AiMediaCapabilityError) {
          throw new AiMediaWorkflowError(error.code, error.message);
        }
        throw error;
      }
      const result = await repository.createImageToImage(input);
      if (result.kind === 'conflict') {
        throw new AiMediaWorkflowError('IDEMPOTENCY_KEY_CONFLICT', 'Idempotency key was used for another media workflow');
      }
      return { workflow: result.workflow, jobId: result.jobId, replayed: result.kind === 'existing' };
    },

    async createImageTranslation(input: CreateAiImageTranslationWorkflowInput) {
      if (!input.sourceAssetId?.trim()) {
        throw new AiMediaWorkflowError('INVALID_REQUEST', 'A source asset is required for image translation');
      }
      if (!input.provider?.trim() || !input.model?.trim()) {
        throw new AiMediaWorkflowError('PROVIDER_NOT_READY', 'Image translation provider configuration is incomplete');
      }
      if (!Number.isSafeInteger(input.dailyLimit) || input.dailyLimit < 0) {
        throw new AiMediaWorkflowError('INVALID_REQUEST', 'Image translation daily limit is invalid');
      }
      if (!Number.isSafeInteger(input.estimatedCostCents) || input.estimatedCostCents < 0) {
        throw new AiMediaWorkflowError('INVALID_REQUEST', 'Image translation cost estimate is invalid');
      }
      if (input.provider !== 'fake' && input.estimatedCostCents <= 0) {
        throw new AiMediaWorkflowError(
          'PROVIDER_NOT_READY',
          'A verified positive image translation cost is required before paid dispatch',
        );
      }
      const options = normalizeAiImageTranslationOptions(input);
      try {
        const capability = assertAiMediaCapability({
          provider: input.provider,
          model: input.model,
          operation: 'IMAGE_TRANSLATE',
          inputCount: 1,
        });
        if (input.provider !== 'fake' && capability.evidenceLevel !== 'sandbox-verified') {
          throw new AiMediaWorkflowError(
            'PROVIDER_NOT_READY',
            'Image translation provider has not passed its sandbox capability gate',
          );
        }
      } catch (error) {
        if (error instanceof AiMediaCapabilityError) {
          throw new AiMediaWorkflowError(error.code, error.message);
        }
        throw error;
      }
      if (!repository.createImageTranslation) {
        throw new AiMediaWorkflowError('PROVIDER_NOT_READY', 'Image translation workflow is not installed');
      }
      let result;
      try {
        result = await repository.createImageTranslation({ ...input, options });
      } catch (error: any) {
        if (error?.code === 'IMAGE_TRANSLATION_QUOTA_EXCEEDED') {
          throw new AiMediaWorkflowError('IMAGE_TRANSLATION_QUOTA_EXCEEDED', error.message);
        }
        if (error?.code === 'IMAGE_TRANSLATION_QUOTA_UNAVAILABLE') {
          throw new AiMediaWorkflowError('PROVIDER_NOT_READY', error.message);
        }
        if (error?.code === 'STALE_MEDIA_WORKFLOW') {
          throw new AiMediaWorkflowError('STALE_MEDIA_WORKFLOW', error.message);
        }
        throw error;
      }
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
      let result;
      try {
        result = await repository.retryOwned(input);
      } catch (error: any) {
        if (error?.code === 'IMAGE_TRANSLATION_QUOTA_EXCEEDED') {
          throw new AiMediaWorkflowError('IMAGE_TRANSLATION_QUOTA_EXCEEDED', error.message);
        }
        if (error?.code === 'IMAGE_TRANSLATION_QUOTA_UNAVAILABLE') {
          throw new AiMediaWorkflowError('PROVIDER_NOT_READY', error.message);
        }
        throw error;
      }
      if (!result) {
        throw new AiMediaWorkflowError(
          'RECOVERY_REQUIRED',
          'Workflow changed, is not retryable, or has a submitted provider task that must be reconciled',
        );
      }
      return result;
    },

    async review(input: Parameters<AiMediaWorkflowRepository['reviewOwned']>[0]) {
      let workflow;
      try {
        workflow = await repository.reviewOwned(input);
      } catch (error: any) {
        if (error?.code === 'STALE_MEDIA_WORKFLOW') {
          throw new AiMediaWorkflowError('STALE_MEDIA_WORKFLOW', error.message);
        }
        throw error;
      }
      if (!workflow) throw new AiMediaWorkflowError('WORKFLOW_CONFLICT', 'Workflow changed or output cannot be reviewed');
      return workflow;
    },
  };
}

export type AiMediaWorkflowService = ReturnType<typeof createAiMediaWorkflowService>;

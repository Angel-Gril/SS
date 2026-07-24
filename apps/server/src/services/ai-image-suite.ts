import { z } from 'zod';
import {
  AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH,
  AI_MEDIA_PLANNING_SLOT_KEY_MAX_LENGTH,
  compareAiMediaPlanningStrings,
} from './ai-media-planning-contract.js';
import { hashAiMediaPlanningJson } from './ai-media-planning.js';
import {
  AiMediaCapabilityError,
  assertAiMediaCapability,
} from './ai-image-provider-capabilities.js';

export const AI_IMAGE_SUITE_PREVIEW_VERSION = 'ai-image-suite-preview/v1';
export const AI_IMAGE_SUITE_MAX_SLOTS = 500;
export const AI_IMAGE_SUITE_MAX_CONCURRENCY = 16;
export const AI_IMAGE_SUITE_MAX_COST_CENTS = 2_147_483_647;

const referenceSchema = z.object({
  candidateId: z.string().trim().min(1).max(AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH),
  evidenceIds: z.array(z.string().trim().min(1).max(AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH)).min(1).max(20),
}).strict();

const slotSchema = z.object({
  slotKey: z.string().trim().min(1).max(AI_MEDIA_PLANNING_SLOT_KEY_MAX_LENGTH),
  goal: z.string().trim().min(1).max(100),
  status: z.literal('READY'),
  aspectRatio: z.literal('3:4'),
  ownership: z.object({
    level: z.enum(['sku', 'compatibility_group']),
    key: z.string().trim().min(1).max(AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH),
  }).strict(),
  references: z.array(referenceSchema).min(1).max(20),
  factEvidenceIds: z.array(z.string().trim().min(1).max(AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH)).max(500),
  safetyConstraints: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
  acceptanceChecks: z.array(z.string().trim().min(1).max(200)).min(1).max(50),
}).strict();

const planPayloadSchema = z.object({
  compatibilityGroups: z.array(z.object({
    groupKey: z.string().trim().min(1).max(AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH),
    identitySignature: z.string().max(10_000),
    skuKeys: z.array(z.string().trim().min(1).max(AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH)).min(1).max(50),
  }).strict()).max(50),
  slots: z.array(slotSchema).min(1).max(AI_IMAGE_SUITE_MAX_SLOTS),
}).passthrough();

const inputSnapshotSchema = z.object({
  candidates: z.array(z.object({
    id: z.string().trim().min(1).max(AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH),
    url: z.string().url().max(8_000),
    width: z.number().int().positive().nullable(),
    height: z.number().int().positive().nullable(),
    mimeType: z.string().trim().min(1).max(200).nullable(),
    role: z.string().trim().min(1).max(100),
    skuKeys: z.array(z.string().trim().min(1).max(AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH)).max(50),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u).nullable(),
  }).strict()).min(1).max(25),
}).passthrough();

export interface AiImageSuitePlanAuthority {
  planId: string;
  planVersionId: string;
  planRevision: number;
  planHash: string;
  sourceSubjectId: string;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  sourceProfileHash: string;
  sourceSchemaVersion: string;
  contextType: string;
  contextId: string;
  inputSnapshot: unknown;
  planPayload: unknown;
}

export interface AiImageSuiteProviderConfig {
  provider: string;
  model: string;
  providerConfigHash: string;
  pricingVersion: string;
  estimatedCostPerImageCents: number;
  maximumCostPerImageCents: number;
  concurrencyLimit: number;
}

export interface AiImageSuitePreviewSlot {
  ordinal: number;
  slotKey: string;
  goal: string;
  ownership: { level: 'sku' | 'compatibility_group'; key: string };
  compatibilityGroupKey: string | null;
  references: Array<{
    candidateId: string;
    evidenceIds: string[];
    source: {
      url: string;
      width: number | null;
      height: number | null;
      mimeType: string | null;
      role: string;
      skuKeys: string[];
      contentHash: string | null;
    };
  }>;
  slotSnapshot: Record<string, unknown>;
  slotHash: string;
  referencesHash: string;
  estimatedCostCents: number;
  maximumCostCents: number;
}

export interface AiImageSuitePreview {
  version: typeof AI_IMAGE_SUITE_PREVIEW_VERSION;
  planId: string;
  planVersionId: string;
  planRevision: number;
  planHash: string;
  provider: string;
  model: string;
  providerConfigHash: string;
  pricingVersion: string;
  concurrencyLimit: number;
  itemCount: number;
  estimatedCostCents: number;
  maximumCostCents: number;
  slots: AiImageSuitePreviewSlot[];
  previewHash: string;
}

export interface ClaimAiImageSuiteInput {
  ownerUserId: string;
  actorUserId: string;
  planId: string;
  expectedPlanRevision: number;
  idempotencyKey: string;
  expectedPreviewHash: string;
  providerConfig: AiImageSuiteProviderConfig;
}

export interface AiImageSuiteRecord {
  id: string;
  ownerUserId: string;
  actorUserId: string;
  planId: string;
  planVersionId: string;
  status: string;
  revision: number;
  previewHash: string;
  provider: string;
  model: string;
  providerConfigHash: string;
  pricingVersion: string;
  itemCount: number;
  estimatedCostCents: number;
  maximumCostCents: number;
  concurrencyLimit: number;
  cancelRequestedAt?: Date | null;
  completedAt?: Date | null;
  slots: Array<Record<string, unknown>>;
  referenceAssets?: Array<Record<string, unknown>>;
  createdAt: Date;
  updatedAt: Date;
}

export interface AiImageSuiteRepository {
  loadApprovedAuthority(input: {
    ownerUserId: string;
    actorUserId: string;
    planId: string;
  }): Promise<AiImageSuitePlanAuthority | null>;
  claimApproved(input: ClaimAiImageSuiteInput): Promise<{
    kind:
      | 'created'
      | 'existing'
      | 'conflict'
      | 'claimed'
      | 'active-suite-conflict'
      | 'not-found'
      | 'not-approved'
      | 'stale'
      | 'preview-changed';
    suite: AiImageSuiteRecord | null;
  }>;
  getOwned(id: string, ownerUserId: string): Promise<AiImageSuiteRecord | null>;
  getCurrentOwnedByPlan(planId: string, ownerUserId: string): Promise<AiImageSuiteRecord | null>;
  getActiveOwnedByPlan(planId: string, ownerUserId: string): Promise<AiImageSuiteRecord | null>;
}

export type AiImageSuiteErrorCode =
  | 'AI_MEDIA_SUITE_INVALID_INPUT'
  | 'AI_MEDIA_SUITE_DISABLED'
  | 'AI_MEDIA_SUITE_NOT_FOUND'
  | 'AI_MEDIA_SUITE_NOT_APPROVED'
  | 'AI_MEDIA_SUITE_STALE'
  | 'AI_MEDIA_SUITE_NOT_READY'
  | 'AI_MEDIA_SUITE_PROVIDER_NOT_READY'
  | 'AI_MEDIA_SUITE_PREVIEW_CHANGED'
  | 'AI_MEDIA_SUITE_IDEMPOTENCY_CONFLICT'
  | 'AI_MEDIA_SUITE_PLAN_ACTIVE_CONFLICT'
  | 'AI_MEDIA_SUITE_ALREADY_CLAIMED';

export class AiImageSuiteError extends Error {
  constructor(
    public readonly code: AiImageSuiteErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'AiImageSuiteError';
  }
}

function exactString(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value || value !== value.trim() || value.length > max) {
    throw new AiImageSuiteError('AI_MEDIA_SUITE_INVALID_INPUT', `${label} is invalid`, 400);
  }
  return value;
}

function sha256(value: unknown, label: string): string {
  const normalized = exactString(value, label, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(normalized)) {
    throw new AiImageSuiteError('AI_MEDIA_SUITE_INVALID_INPUT', `${label} is invalid`, 400);
  }
  return normalized;
}

function safeMoney(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)
    || Number(value) < 0
    || Number(value) > AI_IMAGE_SUITE_MAX_COST_CENTS) {
    throw new AiImageSuiteError('AI_MEDIA_SUITE_INVALID_INPUT', `${label} is invalid`, 400);
  }
  return Number(value);
}

function safeTotal(unit: number, count: number): number {
  const total = unit * count;
  if (!Number.isSafeInteger(total) || total > AI_IMAGE_SUITE_MAX_COST_CENTS) {
    throw new AiImageSuiteError('AI_MEDIA_SUITE_INVALID_INPUT', 'AI media suite cost exceeds integer limits', 400);
  }
  return total;
}

export function normalizeAiImageSuiteProviderConfig(
  config: AiImageSuiteProviderConfig,
): AiImageSuiteProviderConfig {
  const provider = exactString(config.provider, 'provider', 100);
  const model = exactString(config.model, 'model', 200);
  const providerConfigHash = sha256(config.providerConfigHash, 'providerConfigHash');
  const pricingVersion = exactString(config.pricingVersion, 'pricingVersion', 100);
  const estimatedCostPerImageCents = safeMoney(config.estimatedCostPerImageCents, 'estimatedCostPerImageCents');
  const maximumCostPerImageCents = safeMoney(config.maximumCostPerImageCents, 'maximumCostPerImageCents');
  if (maximumCostPerImageCents < estimatedCostPerImageCents) {
    throw new AiImageSuiteError('AI_MEDIA_SUITE_INVALID_INPUT', 'maximum cost must cover estimated cost', 400);
  }
  if (provider !== 'fake' && maximumCostPerImageCents <= 0) {
    throw new AiImageSuiteError(
      'AI_MEDIA_SUITE_PROVIDER_NOT_READY',
      'Paid suite providers require a verified positive maximum price',
      503,
    );
  }
  if (!Number.isSafeInteger(config.concurrencyLimit)
    || config.concurrencyLimit < 1
    || config.concurrencyLimit > AI_IMAGE_SUITE_MAX_CONCURRENCY) {
    throw new AiImageSuiteError('AI_MEDIA_SUITE_INVALID_INPUT', 'concurrencyLimit is invalid', 400);
  }
  return {
    provider,
    model,
    providerConfigHash,
    pricingVersion,
    estimatedCostPerImageCents,
    maximumCostPerImageCents,
    concurrencyLimit: config.concurrencyLimit,
  };
}

export function createAiImageSuitePreview(
  authority: AiImageSuitePlanAuthority,
  rawProviderConfig: AiImageSuiteProviderConfig,
): AiImageSuitePreview {
  const providerConfig = normalizeAiImageSuiteProviderConfig(rawProviderConfig);
  const payload = planPayloadSchema.safeParse(authority.planPayload);
  const input = inputSnapshotSchema.safeParse(authority.inputSnapshot);
  if (!payload.success || !input.success) {
    throw new AiImageSuiteError(
      'AI_MEDIA_SUITE_NOT_READY',
      'Approved AI media plan cannot be expanded into a suite',
      409,
    );
  }
  const groups = new Map(payload.data.compatibilityGroups.map((group) => [group.groupKey, group]));
  const candidates = new Map(input.data.candidates.map((candidate) => [candidate.id, candidate]));
  const seenSlots = new Set<string>();
  const slots: AiImageSuitePreviewSlot[] = payload.data.slots.map((slot, ordinal) => {
    if (seenSlots.has(slot.slotKey)) {
      throw new AiImageSuiteError('AI_MEDIA_SUITE_NOT_READY', 'Approved plan contains duplicate slot keys', 409);
    }
    seenSlots.add(slot.slotKey);
    const seenReferences = new Set<string>();
    const references = slot.references.map((reference) => {
      if (seenReferences.has(reference.candidateId)) {
        throw new AiImageSuiteError('AI_MEDIA_SUITE_NOT_READY', 'Approved plan contains duplicate references', 409);
      }
      seenReferences.add(reference.candidateId);
      const candidate = candidates.get(reference.candidateId);
      if (!candidate) {
        throw new AiImageSuiteError('AI_MEDIA_SUITE_NOT_READY', 'Approved plan reference is outside its frozen input', 409);
      }
      return {
        candidateId: reference.candidateId,
        evidenceIds: [...reference.evidenceIds].sort(compareAiMediaPlanningStrings),
        source: {
          url: candidate.url,
          width: candidate.width,
          height: candidate.height,
          mimeType: candidate.mimeType,
          role: candidate.role,
          skuKeys: [...candidate.skuKeys].sort(compareAiMediaPlanningStrings),
          contentHash: candidate.contentHash,
        },
      };
    });
    try {
      assertAiMediaCapability({
        provider: providerConfig.provider,
        model: providerConfig.model,
        operation: 'IMAGE_TO_IMAGE',
        inputCount: references.length,
      });
    } catch (error) {
      if (error instanceof AiMediaCapabilityError) {
        throw new AiImageSuiteError('AI_MEDIA_SUITE_PROVIDER_NOT_READY', error.message, 503);
      }
      throw error;
    }
    const compatibilityGroupKey = slot.ownership.level === 'compatibility_group'
      ? slot.ownership.key
      : null;
    if (compatibilityGroupKey && !groups.has(compatibilityGroupKey)) {
      throw new AiImageSuiteError('AI_MEDIA_SUITE_NOT_READY', 'Suite slot references an unknown compatibility group', 409);
    }
    const slotSnapshot = {
      slotKey: slot.slotKey,
      goal: slot.goal,
      aspectRatio: slot.aspectRatio,
      ownership: { ...slot.ownership },
      references: slot.references.map((reference) => ({
        candidateId: reference.candidateId,
        evidenceIds: [...reference.evidenceIds].sort(compareAiMediaPlanningStrings),
      })),
      factEvidenceIds: [...slot.factEvidenceIds].sort(compareAiMediaPlanningStrings),
      safetyConstraints: [...slot.safetyConstraints],
      acceptanceChecks: [...slot.acceptanceChecks],
    };
    return {
      ordinal,
      slotKey: slot.slotKey,
      goal: slot.goal,
      ownership: { ...slot.ownership },
      compatibilityGroupKey,
      references,
      slotSnapshot,
      slotHash: hashAiMediaPlanningJson(slotSnapshot),
      referencesHash: hashAiMediaPlanningJson(references),
      estimatedCostCents: providerConfig.estimatedCostPerImageCents,
      maximumCostCents: providerConfig.maximumCostPerImageCents,
    };
  });
  const itemCount = slots.length;
  const core: Omit<AiImageSuitePreview, 'previewHash'> = {
    version: AI_IMAGE_SUITE_PREVIEW_VERSION,
    planId: exactString(authority.planId, 'planId', 200),
    planVersionId: exactString(authority.planVersionId, 'planVersionId', 200),
    planRevision: authority.planRevision,
    planHash: sha256(authority.planHash, 'planHash'),
    provider: providerConfig.provider,
    model: providerConfig.model,
    providerConfigHash: providerConfig.providerConfigHash,
    pricingVersion: providerConfig.pricingVersion,
    concurrencyLimit: providerConfig.concurrencyLimit,
    itemCount,
    estimatedCostCents: safeTotal(providerConfig.estimatedCostPerImageCents, itemCount),
    maximumCostCents: safeTotal(providerConfig.maximumCostPerImageCents, itemCount),
    slots,
  };
  return { ...core, previewHash: hashAiMediaPlanningJson(core) };
}

export function createAiImageSuiteService(repository: AiImageSuiteRepository) {
  return {
    async preview(input: {
      ownerUserId: string;
      actorUserId: string;
      planId: string;
      providerConfig: AiImageSuiteProviderConfig;
    }) {
      const authority = await repository.loadApprovedAuthority(input);
      if (!authority) {
        throw new AiImageSuiteError('AI_MEDIA_SUITE_NOT_APPROVED', 'AI media plan is not approved for suite generation', 409);
      }
      return createAiImageSuitePreview(authority, input.providerConfig);
    },

    async claim(input: ClaimAiImageSuiteInput) {
      exactString(input.ownerUserId, 'ownerUserId', 200);
      exactString(input.actorUserId, 'actorUserId', 200);
      exactString(input.planId, 'planId', 200);
      exactString(input.idempotencyKey, 'idempotencyKey', 128);
      sha256(input.expectedPreviewHash, 'expectedPreviewHash');
      if (!Number.isSafeInteger(input.expectedPlanRevision) || input.expectedPlanRevision < 1) {
        throw new AiImageSuiteError('AI_MEDIA_SUITE_INVALID_INPUT', 'expectedPlanRevision is invalid', 400);
      }
      const result = await repository.claimApproved({
        ...input,
        providerConfig: normalizeAiImageSuiteProviderConfig(input.providerConfig),
      });
      if (result.kind === 'not-found') {
        throw new AiImageSuiteError('AI_MEDIA_SUITE_NOT_FOUND', 'AI media plan was not found', 404);
      }
      if (result.kind === 'not-approved') {
        throw new AiImageSuiteError('AI_MEDIA_SUITE_NOT_APPROVED', 'AI media plan is not approved for suite generation', 409);
      }
      if (result.kind === 'stale') {
        throw new AiImageSuiteError('AI_MEDIA_SUITE_STALE', 'AI media plan is stale against the current source capture', 409);
      }
      if (result.kind === 'conflict') {
        throw new AiImageSuiteError('AI_MEDIA_SUITE_IDEMPOTENCY_CONFLICT', 'Idempotency key was used for another suite', 409);
      }
      if (result.kind === 'preview-changed') {
        throw new AiImageSuiteError('AI_MEDIA_SUITE_PREVIEW_CHANGED', 'AI media suite preview changed before claim', 409);
      }
      if (result.kind === 'claimed') {
        throw new AiImageSuiteError('AI_MEDIA_SUITE_ALREADY_CLAIMED', 'Approved plan version already has a suite claim', 409);
      }
      if (result.kind === 'active-suite-conflict') {
        throw new AiImageSuiteError(
          'AI_MEDIA_SUITE_PLAN_ACTIVE_CONFLICT',
          'Another plan version already has an actionable AI media suite',
          409,
        );
      }
      if (!result.suite) throw new AiImageSuiteError('AI_MEDIA_SUITE_PREVIEW_CHANGED', 'AI media suite preview changed before claim', 409);
      return { suite: result.suite, replayed: result.kind === 'existing' };
    },

    async get(id: string, ownerUserId: string) {
      exactString(id, 'suiteId', 200);
      exactString(ownerUserId, 'ownerUserId', 200);
      const suite = await repository.getOwned(id, ownerUserId);
      if (!suite) throw new AiImageSuiteError('AI_MEDIA_SUITE_NOT_FOUND', 'AI media suite was not found', 404);
      return suite;
    },

    async getCurrentByPlan(planId: string, ownerUserId: string) {
      exactString(planId, 'planId', 200);
      exactString(ownerUserId, 'ownerUserId', 200);
      return repository.getCurrentOwnedByPlan(planId, ownerUserId);
    },

    async getActiveByPlan(planId: string, ownerUserId: string) {
      exactString(planId, 'planId', 200);
      exactString(ownerUserId, 'ownerUserId', 200);
      return repository.getActiveOwnedByPlan(planId, ownerUserId);
    },
  };
}

export type AiImageSuiteService = ReturnType<typeof createAiImageSuiteService>;

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  OZON_LISTING_CURRENCY_CODE_LENGTH,
  OZON_LISTING_DECIMAL_MAX_LENGTH,
  OZON_LISTING_IMPORT_MAX_ITEMS,
  OZON_LISTING_OFFER_ID_MAX_LENGTH,
  OZON_LISTING_PRICING_CONTRACT_VERSION,
  OZON_LISTING_SUPPORTED_CURRENCY_CODES,
  OZON_LISTING_SUPPORTED_VAT_RATES,
  SOURCE_LISTING_IDEMPOTENCY_KEY_MAX_LENGTH,
  SOURCE_LISTING_IDEMPOTENCY_KEY_MIN_LENGTH,
  SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS,
  SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
} from 'shared';
import type {
  OzonListingDraft,
  OzonListingDraftAttributeValue,
  OzonListingDraftCategory,
  OzonListingDraftMediaAssignment,
  OzonListingWorkflowIssue,
} from 'shared';
import { authenticate } from '../lib/auth.js';
import { getAiListingCopyCapability } from '../services/ai-listing-copy-capability.js';
import {
  evaluateSourceListingPublisherCapability,
  sourceWorkflowFeatureFlags,
  type SourceWorkflowFeatureFlagEvaluator,
} from '../services/source-workflow-feature-flags.js';
import type {
  ExtensionByokPublishAuthorizationInput,
} from '../services/extension-byok-publish-authorization.js';
import { findSourceWorkflowOzonCredentialsUnavailableError } from '../services/source-workflow-ozon-client.js';
import type {
  SourceListingWorkflowTargetContext,
  SourceListingWorkflowTargetInput,
} from '../services/source-listing-workflow-context.js';
import type { SourceListingAiCopyService } from '../services/source-listing-ai-copy.js';
import {
  SOURCE_LISTING_EVIDENCE_ITEM_MAX_LENGTH,
  type SourceListingWorkflowService,
} from '../services/source-listing-workflow.js';
import type {
  OzonPublishAttemptRecord,
  OzonUnknownResolution,
} from '../services/ozon-publish-attempts.js';
import {
  SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES,
  SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_NODES,
  inspectSourceListingJsonValue,
  sourceListingJsonLimitMessage,
} from '../services/source-listing-json-limits.js';
import {
  mergeSourceListingWorkflowReadiness,
  validateSourceListingPricing,
} from '../services/source-listing-workflow-readiness.js';

export type SourceListingWorkflowServiceLike = Pick<SourceListingWorkflowService,
  | 'createDraft'
  | 'getDraft'
  | 'getDraftVersion'
  | 'setCategory'
  | 'replaceSourceSnapshot'
  | 'changeShop'
  | 'changeSkuSelection'
  | 'setAttributeValues'
  | 'setMediaAssignments'
  | 'setPricing'
  | 'confirmManualFact'
  | 'addAiCopyCandidate'
  | 'applyAiCopyCandidate'
  | 'recordPublishIntent'
  | 'recordValidationResult'
  | 'setRunState'
>;

export interface SourceListingWorkflowMediaService {
  internalize(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    selections: Array<{
      sourceMediaKey: string;
      slotKey: string;
      scope: 'PRODUCT' | 'SKU';
      skuKey?: string;
    }>;
  }): Promise<{
    assets: unknown[];
    assignments: OzonListingDraftMediaAssignment[];
  }>;
  validateSourceAssignments(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    assignments: OzonListingDraftMediaAssignment[];
  }): Promise<void>;
}

export interface SourceListingWorkflowOwnership {
  assertOwnedTarget(input: SourceListingWorkflowTargetInput): Promise<SourceListingWorkflowTargetContext>;
}

export interface SourceListingWorkflowCategoryValidator {
  validate(input: {
    ownerUserId: string;
    shopId: string;
    category: OzonListingDraftCategory;
  }): Promise<OzonListingDraftCategory>;
}

export interface SourceListingAttributeManualChange {
  attributeId: number;
  skuKey?: string;
  action?: 'SET' | 'CLEAR';
  value?: unknown;
  dictionaryValueId?: number;
  dictionaryValueIds?: number[];
  evidence: string[];
}

export interface SourceListingAttributeSuggestionReference {
  attributeId: number;
  candidateId: string;
  candidateHash: string;
  schemaRevision: string;
}

export interface SourceListingWorkflowAttributeService {
  getWorkspace(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
  }): Promise<unknown>;
  searchDictionary(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    attributeId: number;
    query?: string;
    limit?: number;
  }): Promise<unknown>;
  prepareManualValues(input: {
    ownerUserId: string;
    actorUserId: string;
    draft: OzonListingDraft;
    changes: SourceListingAttributeManualChange[];
  }): Promise<Record<string, OzonListingDraftAttributeValue>>;
  prepareSuggestedValues(input: {
    ownerUserId: string;
    actorUserId: string;
    draft: OzonListingDraft;
    candidates: SourceListingAttributeSuggestionReference[];
  }): Promise<Record<string, OzonListingDraftAttributeValue>>;
  validate(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
  }): Promise<{
    status: 'VALID' | 'INVALID';
    report: Record<string, unknown>;
    blockers: OzonListingWorkflowIssue[];
    warnings: OzonListingWorkflowIssue[];
  }>;
  retainCompatibleReviewedValues?(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    category: OzonListingDraftCategory;
  }): Promise<Record<string, OzonListingDraftAttributeValue>>;
}

export interface SourceListingPublisherLike {
  publish(input: {
    draftId: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
    idempotencyKey: string;
  }): Promise<OzonPublishAttemptRecord>;
  getAttempt(input: {
    attemptId: string;
    ownerUserId: string;
  }): Promise<OzonPublishAttemptRecord | null>;
  resolveAttempt?(input: {
    attemptId: string;
    ownerUserId: string;
    actorUserId: string;
    expectedStateVersion: number;
    resolution: OzonUnknownResolution;
  }): Promise<OzonPublishAttemptRecord>;
}

export interface SourceListingWorkflowRouteOptions {
  service: SourceListingWorkflowServiceLike;
  featureFlags?: SourceWorkflowFeatureFlagEvaluator;
  authenticate?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  ownership: SourceListingWorkflowOwnership;
  categoryValidator: SourceListingWorkflowCategoryValidator;
  attributeWorkflow?: SourceListingWorkflowAttributeService;
  mediaWorkflow?: SourceListingWorkflowMediaService;
  aiCopyWorkflow?: Pick<SourceListingAiCopyService, 'generate'>;
  evaluateAiCopyCapability?: typeof getAiListingCopyCapability;
  authorizeByokPublish(
    input: ExtensionByokPublishAuthorizationInput,
  ): Promise<unknown>;
  publisher?: SourceListingPublisherLike;
}

const id = z.string().trim().min(1).max(200);
const skuKey = z.string().trim().min(1).max(SOURCE_LISTING_SKU_KEY_MAX_LENGTH);
const createSchema = z.object({
  supplyGoodsId: id,
  shopId: id,
  sourceCaptureSnapshotId: id.optional(),
  selectedSkuKeys: z.array(skuKey).min(1).max(SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS),
}).strict();
const categorySchema = z.object({
  categoryId: z.number().int().positive(),
  typeId: z.number().int().positive(),
  catalogRevision: id,
  categoryName: z.string().trim().min(1).max(500).optional(),
  typeName: z.string().trim().min(1).max(500).optional(),
}).strict();
const patchSchema = z.object({
  expectedRevision: z.number().int().positive(),
  shopId: id.optional(),
  sourceCaptureSnapshotId: id.optional(),
  selectedSkuKeys: z.array(skuKey).min(1).max(SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS).optional(),
  category: categorySchema.optional(),
}).strict();
const candidateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  titleRu: z.string().trim().max(1000).nullable().optional(),
  descriptionRu: z.string().trim().max(10000).nullable().optional(),
  sourcePromptVersion: id,
}).strict().refine(
  (value) => value.titleRu !== undefined || value.descriptionRu !== undefined,
  { message: 'AI copy candidate must contain a title or description' },
);
const generateCandidateSchema = z.object({
  expectedRevision: z.number().int().positive(),
  operationKey: id,
  fields: z.array(z.enum(['title', 'description'])).min(1).max(2)
    .refine((fields) => new Set(fields).size === fields.length, 'AI copy generation fields must be unique'),
  userInstructions: z.string().trim().max(2000).optional(),
}).strict();
const applyCandidateSchema = z.object({ expectedRevision: z.number().int().positive(), candidateId: id, operationKey: id }).strict();
const actionSchema = z.object({ expectedRevision: z.number().int().positive(), reason: z.string().trim().max(1000).optional() }).strict();
const publishIntentSchema = z.object({
  expectedRevision: z.number().int().positive(),
  idempotencyKey: z.string().trim()
    .min(SOURCE_LISTING_IDEMPOTENCY_KEY_MIN_LENGTH)
    .max(SOURCE_LISTING_IDEMPOTENCY_KEY_MAX_LENGTH),
}).strict();
const publishAttemptParamsSchema = z.object({ draftId: id, attemptId: id }).strict();
const publishAttemptResolutionSchema = z.object({
  expectedStateVersion: z.number().int().positive(),
  decision: z.enum(['SUBMITTED', 'NOT_SUBMITTED']),
  taskId: z.string().trim().regex(/^[0-9]{1,40}$/)
    .refine((value) => BigInt(value) > 0n, 'taskId must be positive')
    .optional(),
  note: z.string().trim().min(1).max(2000),
  evidence: z.record(z.string().trim().min(1).max(200), z.unknown())
    .refine((value) => Object.keys(value).length > 0, 'resolution evidence is required'),
}).strict().superRefine((value, context) => {
  if (value.decision === 'SUBMITTED' && !value.taskId) {
    context.addIssue({ code: 'custom', path: ['taskId'], message: 'taskId is required' });
  }
  if (value.decision === 'NOT_SUBMITTED' && value.taskId) {
    context.addIssue({ code: 'custom', path: ['taskId'], message: 'taskId is not allowed' });
  }
});
const pricingDecimal = z.string()
  .min(1)
  .max(OZON_LISTING_DECIMAL_MAX_LENGTH)
  .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
  .refine((value) => /[1-9]/.test(value.replace('.', '')), 'must be positive');
const pricingItemSchema = z.object({
  skuKey: z.string().min(1).max(SOURCE_LISTING_SKU_KEY_MAX_LENGTH * 2),
  price: pricingDecimal,
  oldPrice: pricingDecimal,
  currencyCode: z.enum(OZON_LISTING_SUPPORTED_CURRENCY_CODES).refine(
    (value) => value.length === OZON_LISTING_CURRENCY_CODE_LENGTH,
  ),
  vat: z.enum(OZON_LISTING_SUPPORTED_VAT_RATES),
  offerId: z.string().min(1).max(OZON_LISTING_OFFER_ID_MAX_LENGTH * 2).optional(),
}).strict();

const PUBLISH_DIAGNOSTIC_MAX_ITEMS = OZON_LISTING_IMPORT_MAX_ITEMS;
const PUBLISH_DIAGNOSTIC_MAX_BYTES = 8 * 1024;

function boundedPublishDiagnostic(value: unknown): { value: unknown; truncated: boolean } {
  try {
    const serialized = JSON.stringify(value);
    const bytes = Buffer.byteLength(serialized, 'utf8');
    if (bytes > PUBLISH_DIAGNOSTIC_MAX_BYTES) {
      return { value: { _truncated: true, bytes }, truncated: true };
    }
    return { value: JSON.parse(serialized) as unknown, truncated: false };
  } catch {
    return { value: { _truncated: true, reason: 'invalid_json' }, truncated: true };
  }
}

function boundedPublishDiagnostics(value: unknown, nullable: boolean) {
  if (!Array.isArray(value)) {
    return { values: nullable ? null : [], count: 0, truncated: false };
  }
  let truncated = value.length > PUBLISH_DIAGNOSTIC_MAX_ITEMS;
  const values = value.slice(0, PUBLISH_DIAGNOSTIC_MAX_ITEMS).map((entry) => {
    const bounded = boundedPublishDiagnostic(entry);
    truncated ||= bounded.truncated;
    return bounded.value;
  });
  return { values, count: value.length, truncated };
}

function publicPublishAttempt(attempt: OzonPublishAttemptRecord) {
  const itemResults = boundedPublishDiagnostics(attempt.itemResults, true);
  const itemErrors = boundedPublishDiagnostics(attempt.itemErrors, false);
  const offerTrace = Array.isArray(attempt.offerTrace)
    ? attempt.offerTrace.slice(0, OZON_LISTING_IMPORT_MAX_ITEMS).map((entry) => ({
      ordinal: entry.ordinal,
      offerId: entry.offerId,
      skuKey: entry.skuKey,
    }))
    : [];
  return {
    id: attempt.id,
    workflowId: attempt.workflowId,
    shopId: attempt.shopId,
    draftVersion: attempt.draftVersion,
    revision: attempt.revision,
    catalogSnapshotHash: attempt.catalogSnapshotHash,
    attributeSchemaHash: attempt.attributeSchemaHash,
    publisherContractVersion: attempt.publisherContractVersion,
    endpoint: attempt.endpoint,
    draftPayloadHash: attempt.draftPayloadHash,
    draftStateHash: attempt.draftStateHash,
    requestPayloadHash: attempt.requestPayloadHash,
    offerTrace,
    itemCount: attempt.itemCount,
    state: attempt.state,
    reconciliationState: attempt.reconciliationState,
    stateVersion: attempt.stateVersion,
    ozonTaskId: attempt.ozonTaskId,
    acceptanceSource: attempt.acceptanceSource,
    responseHash: attempt.responseHash,
    itemResults: itemResults.values,
    itemResultCount: itemResults.count,
    itemResultsTruncated: itemResults.truncated,
    itemErrors: itemErrors.values,
    itemErrorCount: itemErrors.count,
    itemErrorsTruncated: itemErrors.truncated,
    lastErrorCode: attempt.lastErrorCode,
    lastErrorMessage: attempt.lastErrorMessage,
    submitStartedAt: attempt.submitStartedAt,
    submittedAt: attempt.submittedAt,
    unknownAt: attempt.unknownAt,
    rejectedAt: attempt.rejectedAt,
    nextReconcileAt: attempt.nextReconcileAt,
    reconcileAttemptCount: attempt.reconcileAttemptCount,
    lastReconciledAt: attempt.lastReconciledAt,
    completedAt: attempt.completedAt,
    resolutionEvidenceHash: attempt.resolutionEvidenceHash,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  };
}
const pricingSchema = z.object({
  expectedRevision: z.number().int().positive(),
  value: z.object({
    contractVersion: z.literal(OZON_LISTING_PRICING_CONTRACT_VERSION),
    items: z.array(pricingItemSchema).min(1).max(OZON_LISTING_IMPORT_MAX_ITEMS),
  }).strict(),
}).strict();
const sourceMediaSelectionSchema = z.discriminatedUnion('scope', [
  z.object({
    sourceMediaKey: id,
    slotKey: id,
    scope: z.literal('PRODUCT'),
  }).strict(),
  z.object({
    sourceMediaKey: id,
    slotKey: id,
    scope: z.literal('SKU'),
    skuKey,
  }).strict(),
]);
const sourceMediaInternalizeSchema = z.object({
  expectedRevision: z.number().int().positive(),
  selections: z.array(sourceMediaSelectionSchema).min(1).max(50),
}).strict().superRefine((value, context) => {
  const mediaKeys = value.selections.map((item) => item.sourceMediaKey);
  const slots = value.selections.map((item) => item.slotKey);
  if (new Set(mediaKeys).size !== mediaKeys.length) {
    context.addIssue({ code: 'custom', path: ['selections'], message: 'sourceMediaKey values must be unique' });
  }
  if (new Set(slots).size !== slots.length) {
    context.addIssue({ code: 'custom', path: ['selections'], message: 'slotKey values must be unique' });
  }
});
const sourceMediaAssignmentSchema = z.discriminatedUnion('scope', [
  z.object({
    assetId: id,
    slotKey: id,
    source: z.literal('SOURCE'),
    scope: z.literal('PRODUCT'),
  }).strict(),
  z.object({
    assetId: id,
    slotKey: id,
    source: z.literal('SOURCE'),
    scope: z.literal('SKU'),
    skuKey,
  }).strict(),
]);
const sourceMediaAssignmentsSchema = z.object({
  expectedRevision: z.number().int().positive(),
  assignments: z.array(sourceMediaAssignmentSchema).min(1).max(50),
}).strict().superRefine((value, context) => {
  const assetIds = value.assignments.map((item) => item.assetId);
  const slots = value.assignments.map((item) => item.slotKey);
  if (new Set(assetIds).size !== assetIds.length) {
    context.addIssue({ code: 'custom', path: ['assignments'], message: 'assetId values must be unique' });
  }
  if (new Set(slots).size !== slots.length) {
    context.addIssue({ code: 'custom', path: ['assignments'], message: 'slotKey values must be unique' });
  }
});
const manualFactSchema = z.object({
  expectedRevision: z.number().int().positive(),
  attributeKey: id,
  value: z.unknown(),
  evidence: z.array(z.string().trim().min(1).max(
    SOURCE_LISTING_EVIDENCE_ITEM_MAX_LENGTH,
  )).min(1).max(20),
}).strict().superRefine((value, context) => {
  const hasValue = Object.prototype.hasOwnProperty.call(value, 'value') && value.value !== undefined;
  if (!hasValue) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'manual fact value is required' });
    return;
  }
  const complexity = inspectSourceListingJsonValue(value.value);
  if (!complexity.valid) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: sourceListingJsonLimitMessage(complexity, 'manual fact value'),
    });
  }
});
const manualAttributeChangeSchema = z.object({
  attributeId: z.number().int().positive(),
  skuKey: skuKey.optional(),
  action: z.enum(['SET', 'CLEAR']).optional(),
  value: z.unknown(),
  dictionaryValueId: z.number().int().positive().optional(),
  dictionaryValueIds: z.array(z.number().int().positive()).min(1).max(100).optional(),
  evidence: z.array(z.string().trim().min(1).max(
    SOURCE_LISTING_EVIDENCE_ITEM_MAX_LENGTH,
  )).min(1).max(20),
}).strict().superRefine((value, context) => {
  const hasValue = Object.prototype.hasOwnProperty.call(value, 'value') && value.value !== undefined;
  if (value.action === 'CLEAR') {
    if (hasValue || value.dictionaryValueId !== undefined || value.dictionaryValueIds !== undefined) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'attribute clear cannot include a value' });
    }
    return;
  }
  if (!hasValue) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'attribute value is required' });
    return;
  }
  const complexity = inspectSourceListingJsonValue(value.value);
  if (!complexity.valid) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: sourceListingJsonLimitMessage(complexity, 'attribute value'),
    });
  }
});
const manualAttributesSchema = z.object({
  expectedRevision: z.number().int().positive(),
  changes: z.array(manualAttributeChangeSchema).min(1).max(500),
}).strict().superRefine((value, context) => {
  let bytes = 0;
  let nodes = 0;
  for (const change of value.changes) {
    if (change.action === 'CLEAR'
      || !Object.prototype.hasOwnProperty.call(change, 'value')
      || change.value === undefined) continue;
    const complexity = inspectSourceListingJsonValue(change.value);
    if (!complexity.valid) continue;
    bytes += complexity.bytes;
    nodes += complexity.nodes;
    if (bytes > SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['changes'],
        message: `attribute SET values exceed ${SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES} aggregate UTF-8 bytes`,
      });
      return;
    }
    if (nodes > SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_NODES) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['changes'],
        message: `attribute SET values exceed ${SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_NODES} aggregate JSON nodes`,
      });
      return;
    }
  }
});
const attributeSuggestionReferenceSchema = z.object({
  attributeId: z.number().int().positive(),
  candidateId: id,
  candidateHash: z.string().regex(/^[a-f0-9]{64}$/),
  schemaRevision: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const applyAttributeSuggestionsSchema = z.object({
  expectedRevision: z.number().int().positive(),
  candidates: z.array(attributeSuggestionReferenceSchema).min(1).max(500),
}).strict().refine(
  (value) => new Set(value.candidates.map((candidate) => candidate.attributeId)).size === value.candidates.length,
  { path: ['candidates'], message: 'attribute suggestion candidates must be unique' },
);
const validateDraftSchema = z.object({
  expectedRevision: z.number().int().positive(),
}).strict();
const attributeDictionaryParamsSchema = z.object({
  draftId: id,
  attributeId: z.coerce.number().int().positive(),
}).strict();
const attributeDictionaryQuerySchema = z.object({
  query: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict();

function authIds(request: FastifyRequest) {
  const user = (request as any).user || {};
  const ownerUserId = String(user.userId || '').trim();
  return {
    ownerUserId,
    actorUserId: String(user.actorUserId || ownerUserId).trim(),
    isSubAccount: user.isSubAccount === true,
    role: String(user.role || ''),
  };
}

function assertExpectedRevision(draft: OzonListingDraft, expectedRevision: number): void {
  if (draft.revision !== expectedRevision) {
    throw Object.assign(new Error('Listing draft revision changed'), {
      code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT',
      statusCode: 409,
      current: draft,
      currentVersion: draft.revision,
      currentDraftVersion: draft.draftVersion,
    });
  }
}

async function routeError(
  reply: FastifyReply,
  error: unknown,
  context?: {
    service: SourceListingWorkflowServiceLike;
    draftId: string;
    ownerUserId: string;
  },
) {
  const credentialError = findSourceWorkflowOzonCredentialsUnavailableError(error);
  const e = (credentialError || error) as Error & {
    code?: string;
    statusCode?: number;
    current?: unknown;
    currentVersion?: number;
    currentDraftVersion?: number;
  };
  const code = String(e?.code || 'source_listing_workflow_failed');
  const loweredCode = code.toLowerCase();
  const repositoryStatus = new Map<string, number>([
    ['NOT_FOUND', 404],
    ['INVALID_INPUT', 400],
    ['VERSION_CONFLICT', 409],
    ['IDEMPOTENCY_CONFLICT', 409],
    ['INVALID_TRANSITION', 409],
    ['LEASE_LOST', 409],
  ]).get(code);
  const status = Number(e?.statusCode)
    || repositoryStatus
    || (loweredCode.includes('conflict') || loweredCode.includes('stale') ? 409 : 500);
  const safeServiceError = credentialError !== null
    || code === 'ai_media_workflow_disabled'
    || code === 'OZON_ATTRIBUTE_DICTIONARY_UNAVAILABLE'
    || code === 'source_listing_ai_copy_unavailable';
  const body: Record<string, unknown> = {
    code: 0,
    errorCode: status >= 500 && !safeServiceError ? 'source_listing_workflow_failed' : code,
    msg: status >= 500 && !safeServiceError
      ? '来源商品工作流请求失败'
      : e?.message || '来源商品工作流请求失败',
  };
  if (e?.current !== undefined) body.current = e.current;
  if (e?.currentVersion !== undefined) body.currentVersion = e.currentVersion;
  if (e?.currentDraftVersion !== undefined) body.currentDraftVersion = e.currentDraftVersion;
  if (status === 409 && context && body.current === undefined) {
    try {
      const current = await context.service.getDraft({
        draftId: context.draftId,
        ownerUserId: context.ownerUserId,
      });
      if (current) {
        body.current = current;
        body.currentVersion = current.revision;
        body.currentDraftVersion = current.draftVersion;
      }
    } catch {
      // Preserve the original conflict when the owner-scoped reload is unavailable.
    }
  }
  return reply.status(status).send(body);
}

async function requireV2PublisherFeature(
  flags: SourceWorkflowFeatureFlagEvaluator,
  ownerUserId: string,
  shopId: string,
): Promise<void> {
  let capability;
  try {
    capability = await evaluateSourceListingPublisherCapability(flags, {
      ownerUserId, shopId, platform: 'OZON',
    });
  } catch {
    throw Object.assign(new Error('来源商品发布策略暂不可用'), {
      code: 'source_workflow_rollout_unavailable', statusCode: 503,
    });
  }
  const unavailableReasons = new Set([
    'policy_invalid', 'context_invalid', 'config_unavailable', 'policy_revision_mismatch',
  ]);
  if (unavailableReasons.has(capability.reason)) {
    throw Object.assign(new Error('来源商品发布策略暂不可用'), {
      code: 'source_workflow_rollout_unavailable', statusCode: 503,
    });
  }
  if (!capability.enabled || capability.legacyAllowed) {
    throw Object.assign(new Error('该店铺尚未启用来源商品发布 V2'), {
      code: 'source_ozon_publisher_v2_not_enabled', statusCode: 409,
    });
  }
}

function rolloutError(decision: Awaited<ReturnType<SourceWorkflowFeatureFlagEvaluator['evaluate']>>) {
  return Object.assign(new Error(
    decision.legacyAllowed
      ? '来源商品工作流尚未对当前店铺启用'
      : '来源商品工作流发布策略暂不可用，请稍后重试',
  ), {
    code: decision.legacyAllowed
      ? 'source_listing_workflow_disabled'
      : 'source_workflow_rollout_unavailable',
    statusCode: decision.legacyAllowed ? 409 : 503,
  });
}

async function requireInteractiveWriteFeature(
  flags: SourceWorkflowFeatureFlagEvaluator,
  ownerUserId: string,
  shopId: string,
) {
  const decision = await flags.evaluate('SOURCE_LISTING_WORKFLOW', { ownerUserId, shopId, platform: 'OZON' });
  if (decision.enabled && ['dual_read', 'v2_only'].includes(String(decision.listingStage || ''))) {
    return decision;
  }
  throw rolloutError(decision);
}

async function requireAiCopyFeature(
  evaluate: typeof getAiListingCopyCapability,
  ownerUserId: string,
) {
  const decision = await evaluate(ownerUserId);
  if (decision.enabled) return decision;
  throw Object.assign(new Error('AI 文案生成工作流尚未启用'), {
    code: 'ai_media_workflow_disabled', statusCode: 503,
  });
}

async function requireReadFeature(flags: SourceWorkflowFeatureFlagEvaluator, ownerUserId: string, shopId: string) {
  const decision = await flags.evaluate('SOURCE_LISTING_WORKFLOW', { ownerUserId, shopId, platform: 'OZON' });
  if (decision.enabled && ['dual_read', 'v2_only'].includes(String(decision.listingStage || ''))) {
    return decision;
  }
  throw rolloutError(decision);
}

function redactAiCopyPrivatePayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAiCopyPrivatePayload);
  if (!value || typeof value !== 'object') return value;
  const record = value as Record<string, unknown>;
  if (record.schemaVersion === 'listing-copy-generation/v1') {
    const redactField = (field: unknown) => {
      if (!field || typeof field !== 'object' || Array.isArray(field)) return field;
      const { frozenRequest: _frozenRequest, ...publicField } = field as Record<string, unknown>;
      return Object.fromEntries(Object.entries(publicField).map(([key, item]) => [
        key, redactAiCopyPrivatePayload(item),
      ]));
    };
    return {
      ...Object.fromEntries(Object.entries(record)
        .filter(([key]) => key !== 'title' && key !== 'description')
        .map(([key, item]) => [key, redactAiCopyPrivatePayload(item)])),
      ...(record.title ? { title: redactField(record.title) } : {}),
      ...(record.description ? { description: redactField(record.description) } : {}),
    };
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return value;
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [
    key, redactAiCopyPrivatePayload(item),
  ]));
}

export async function sourceListingWorkflowRoutes(app: FastifyInstance, options: SourceListingWorkflowRouteOptions) {
  const authHook = options.authenticate || authenticate;
  const flags = options.featureFlags || sourceWorkflowFeatureFlags;
  const evaluateAiCopyCapability = options.evaluateAiCopyCapability || getAiListingCopyCapability;
  app.addHook('preHandler', authHook);
  app.addHook('preSerialization', async (_request, _reply, payload) => (
    redactAiCopyPrivatePayload(payload)
  ));

  app.post('/', async (request, reply) => {
    const { ownerUserId, actorUserId } = authIds(request);
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: parsed.error.issues[0]?.message || '参数错误' });
    try {
      await requireInteractiveWriteFeature(flags, ownerUserId, parsed.data.shopId);
      const owned = await options.ownership.assertOwnedTarget({ ownerUserId, ...parsed.data });
      const draft = await options.service.createDraft({
        ownerUserId,
        actorUserId,
        shopId: owned.shopId,
        supplyGoodsId: owned.supplyGoodsId,
        sourceCaptureSnapshotId: owned.sourceCaptureSnapshotId,
        sourceCaptureHash: owned.sourceCaptureHash,
        selectedSkuKeys: owned.selectedSkuKeys,
      });
      return reply.status(201).send({ code: 1, data: draft });
    } catch (error) { return routeError(reply, error); }
  });

  app.get('/:draftId/versions/:draftVersion', async (request, reply) => {
    const { ownerUserId } = authIds(request);
    const params = z.object({ draftId: id, draftVersion: z.coerce.number().int().positive() })
      .safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '版本参数无效' });
    }
    try {
      const current = await options.service.getDraft({
        draftId: params.data.draftId,
        ownerUserId,
      });
      if (!current) {
        return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
      }
      await requireReadFeature(flags, ownerUserId, current.shopId);
      const version = await options.service.getDraftVersion({
        draftId: params.data.draftId,
        ownerUserId,
        draftVersion: params.data.draftVersion,
      });
      if (!version) {
        return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_version_not_found', msg: '工作流版本不存在' });
      }
      return reply.send({ code: 1, data: version });
    } catch (error) { return routeError(reply, error); }
  });

  app.get('/:draftId', async (request, reply) => {
    const { ownerUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    if (!draftId) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '缺少 draftId' });
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      if (!draft) return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
      await requireReadFeature(flags, ownerUserId, draft.shopId);
      return reply.send({ code: 1, data: draft });
    } catch (error) { return routeError(reply, error); }
  });

  app.get('/:draftId/attributes', async (request, reply) => {
    const { ownerUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      if (!draft) return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
      await requireReadFeature(flags, ownerUserId, draft.shopId);
      if (!options.attributeWorkflow) {
        return reply.status(503).send({ code: 0, errorCode: 'source_listing_attributes_unavailable', msg: 'Ozon 属性服务不可用' });
      }
      const workspace = await options.attributeWorkflow.getWorkspace({ ownerUserId, draft });
      return reply.send({ code: 1, data: workspace });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.get('/:draftId/attributes/:attributeId/dictionary', async (request, reply) => {
    const { ownerUserId } = authIds(request);
    const params = attributeDictionaryParamsSchema.safeParse(request.params);
    const query = attributeDictionaryQuerySchema.safeParse(request.query);
    if (!params.success || !query.success) {
      return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '字典查询参数无效' });
    }
    const { draftId, attributeId } = params.data;
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      if (!draft) return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
      await requireReadFeature(flags, ownerUserId, draft.shopId);
      if (!options.attributeWorkflow) {
        return reply.status(503).send({ code: 0, errorCode: 'source_listing_attributes_unavailable', msg: 'Ozon 属性服务不可用' });
      }
      const result = await options.attributeWorkflow.searchDictionary({
        ownerUserId,
        draft,
        attributeId,
        ...(query.data.query ? { query: query.data.query } : {}),
        ...(query.data.limit ? { limit: query.data.limit } : {}),
      });
      return reply.send({ code: 1, data: result });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.put('/:draftId/attributes', async (request, reply) => {
    const { ownerUserId, actorUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = manualAttributesSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: parsed.error.issues[0]?.message || '参数错误' });
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      if (!draft) return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
      await requireInteractiveWriteFeature(flags, ownerUserId, draft.shopId);
      assertExpectedRevision(draft, parsed.data.expectedRevision);
      if (!options.attributeWorkflow) throw Object.assign(new Error('Ozon attribute workflow is unavailable'), { code: 'source_listing_attributes_unavailable', statusCode: 503 });
      const values = await options.attributeWorkflow.prepareManualValues({
        ownerUserId,
        actorUserId,
        draft,
        changes: parsed.data.changes,
      });
      const result = await options.service.setAttributeValues({
        draftId,
        ownerUserId,
        actorUserId,
        expectedRevision: parsed.data.expectedRevision,
        values,
        operation: 'MANUAL_EDIT',
        changeAudit: parsed.data.changes.map((change) => ({
          attributeId: change.attributeId,
          ...(change.skuKey ? { skuKey: change.skuKey } : {}),
          action: change.action || 'SET',
          evidence: change.evidence,
        })),
      });
      return reply.send({ code: 1, data: result });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.post('/:draftId/attributes/suggestions/apply', async (request, reply) => {
    const { ownerUserId, actorUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = applyAttributeSuggestionsSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: parsed.error.issues[0]?.message || '参数错误' });
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      if (!draft) return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
      await requireInteractiveWriteFeature(flags, ownerUserId, draft.shopId);
      assertExpectedRevision(draft, parsed.data.expectedRevision);
      if (!options.attributeWorkflow) throw Object.assign(new Error('Ozon attribute workflow is unavailable'), { code: 'source_listing_attributes_unavailable', statusCode: 503 });
      const values = await options.attributeWorkflow.prepareSuggestedValues({
        ownerUserId,
        actorUserId,
        draft,
        candidates: parsed.data.candidates,
      });
      const result = await options.service.setAttributeValues({
        draftId,
        ownerUserId,
        actorUserId,
        expectedRevision: parsed.data.expectedRevision,
        values,
        operation: 'SUGGESTION_APPLIED',
      });
      return reply.send({ code: 1, data: result });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.post('/:draftId/validate', async (request, reply) => {
    const { ownerUserId, actorUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = validateDraftSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: parsed.error.issues[0]?.message || '参数错误' });
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      if (!draft) return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
      await requireInteractiveWriteFeature(flags, ownerUserId, draft.shopId);
      assertExpectedRevision(draft, parsed.data.expectedRevision);
      if (!options.attributeWorkflow) throw Object.assign(new Error('Ozon attribute workflow is unavailable'), { code: 'source_listing_attributes_unavailable', statusCode: 503 });
      const attributeValidation = await options.attributeWorkflow.validate({ ownerUserId, draft });
      const validation = mergeSourceListingWorkflowReadiness({
        draft,
        validation: attributeValidation,
      });
      const result = await options.service.recordValidationResult({
        draftId,
        ownerUserId,
        actorUserId,
        expectedRevision: parsed.data.expectedRevision,
        ...validation,
      });
      return reply.send({ code: 1, data: result, validation });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.patch('/:draftId', async (request, reply) => {
    const { ownerUserId, actorUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: parsed.error.issues[0]?.message || '参数错误' });
    try {
      const current = await options.service.getDraft({ draftId, ownerUserId });
      if (!current) return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
      await requireInteractiveWriteFeature(flags, ownerUserId, current.shopId);
      if (parsed.data.shopId && parsed.data.shopId !== current.shopId) {
        await requireInteractiveWriteFeature(flags, ownerUserId, parsed.data.shopId);
      }
      assertExpectedRevision(current, parsed.data.expectedRevision);
      const body = parsed.data;
      const mutationCount = [
        body.category,
        body.sourceCaptureSnapshotId,
        body.shopId,
        body.selectedSkuKeys !== undefined && body.sourceCaptureSnapshotId === undefined
          ? body.selectedSkuKeys
          : undefined,
      ].filter((value) => value !== undefined).length;
      if (mutationCount !== 1) throw Object.assign(new Error('每次只能更新一种工作流字段'), { code: 'source_listing_workflow_patch_ambiguous', statusCode: 400 });
      const owned = await options.ownership.assertOwnedTarget({
        ownerUserId,
        shopId: body.shopId || current.shopId,
        sourceCaptureSnapshotId: body.sourceCaptureSnapshotId || current.sourceCaptureSnapshotId,
        currentSourceCaptureSnapshotId: current.sourceCaptureSnapshotId,
        selectedSkuKeys: body.selectedSkuKeys || current.selectedSkuKeys,
      });
      let result: unknown;
      if (body.category && options.service.setCategory) {
        const category = await options.categoryValidator.validate({
          ownerUserId,
          shopId: owned.shopId,
          category: body.category,
        });
        const retainedAttributeValues = options.attributeWorkflow?.retainCompatibleReviewedValues
          ? await options.attributeWorkflow.retainCompatibleReviewedValues({
            ownerUserId,
            draft: current,
            category,
          })
          : undefined;
        result = await options.service.setCategory({
          draftId,
          ownerUserId,
          actorUserId,
          expectedRevision: body.expectedRevision,
          category,
          ...(retainedAttributeValues ? { retainedAttributeValues } : {}),
        });
      } else if (body.sourceCaptureSnapshotId && options.service.replaceSourceSnapshot) {
        result = await options.service.replaceSourceSnapshot({
          draftId, ownerUserId, actorUserId, expectedRevision: body.expectedRevision,
          sourceCaptureSnapshotId: owned.sourceCaptureSnapshotId,
          sourceCaptureHash: owned.sourceCaptureHash,
          ...(body.selectedSkuKeys ? { selectedSkuKeys: owned.selectedSkuKeys } : {}),
        });
      } else if (body.shopId && options.service.changeShop) {
        result = await options.service.changeShop({
          draftId, ownerUserId, actorUserId, expectedRevision: body.expectedRevision,
          shopId: owned.shopId,
        });
      } else if (body.selectedSkuKeys && options.service.changeSkuSelection) {
        result = await options.service.changeSkuSelection({
          draftId, ownerUserId, actorUserId, expectedRevision: body.expectedRevision,
          selectedSkuKeys: owned.selectedSkuKeys,
        });
      }
      else throw Object.assign(new Error('没有可更新的工作流字段'), { code: 'source_listing_workflow_patch_empty', statusCode: 400 });
      return reply.send({ code: 1, data: result });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.post('/:draftId/ai-candidates', async (request, reply) => {
    const { ownerUserId, actorUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = candidateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: parsed.error.issues[0]?.message || '参数错误' });
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      if (!draft) return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
      await requireInteractiveWriteFeature(flags, ownerUserId, draft.shopId);
      if (!options.service.addAiCopyCandidate) throw Object.assign(new Error('AI 候选服务不可用'), { code: 'source_listing_workflow_unavailable', statusCode: 503 });
      const created = await options.service.addAiCopyCandidate({
        draftId,
        ownerUserId,
        actorUserId,
        expectedRevision: parsed.data.expectedRevision,
        ...(parsed.data.titleRu !== undefined ? { titleRu: parsed.data.titleRu } : {}),
        ...(parsed.data.descriptionRu !== undefined ? { descriptionRu: parsed.data.descriptionRu } : {}),
        sourcePromptVersion: parsed.data.sourcePromptVersion,
      });
      return reply.status(201).send({ code: 1, data: created.candidate });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.get('/:draftId/ai-copy-capability', async (request, reply) => {
    const { ownerUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      await requireReadFeature(flags, ownerUserId, draft.shopId);
      const decision = await evaluateAiCopyCapability(ownerUserId);
      return reply.send({ code: 1, data: decision });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.post('/:draftId/ai-candidates/generate', async (request, reply) => {
    const { ownerUserId, actorUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = generateCandidateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 0,
        errorCode: 'invalid_request',
        msg: parsed.error.issues[0]?.message || '参数错误',
      });
    }
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      await requireInteractiveWriteFeature(flags, ownerUserId, draft.shopId);
      await requireAiCopyFeature(evaluateAiCopyCapability, ownerUserId);
      if (!options.aiCopyWorkflow) {
        throw Object.assign(new Error('AI 文案生成服务不可用'), {
          code: 'source_listing_ai_copy_unavailable', statusCode: 503,
        });
      }
      const generated = await options.aiCopyWorkflow.generate({
        draftId,
        ownerUserId,
        actorUserId,
        expectedRevision: parsed.data.expectedRevision,
        operationKey: parsed.data.operationKey,
        fields: parsed.data.fields,
        userInstructions: parsed.data.userInstructions || '',
      });
      return reply.status(201).send({
        code: 1,
        data: { candidate: generated.candidate, limit: generated.limit },
      });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.post('/:draftId/ai-candidates/apply', async (request, reply) => {
    const { ownerUserId, actorUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = applyCandidateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: parsed.error.issues[0]?.message || '参数错误' });
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      if (!draft) return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
      await requireInteractiveWriteFeature(flags, ownerUserId, draft.shopId);
      if (!options.service.applyAiCopyCandidate) throw Object.assign(new Error('AI 候选应用服务不可用'), { code: 'source_listing_workflow_unavailable', statusCode: 503 });
      const result = await options.service.applyAiCopyCandidate({ draftId, ownerUserId, actorUserId, ...parsed.data });
      return reply.send({ code: 1, data: result, audit: { action: 'ai_candidate_apply', actorUserId } });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.put('/:draftId/pricing', async (request, reply) => {
    const { ownerUserId, actorUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = pricingSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: parsed.error.issues[0]?.message || '参数错误' });
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      await requireInteractiveWriteFeature(flags, ownerUserId, draft.shopId);
      const value = validateSourceListingPricing(parsed.data.value, draft.selectedSkuKeys);
      const result = await options.service.setPricing({
        draftId,
        ownerUserId,
        actorUserId,
        expectedRevision: parsed.data.expectedRevision,
        value,
      });
      return reply.send({ code: 1, data: result });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.post('/:draftId/media/internalize', async (request, reply) => {
    const { ownerUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = sourceMediaInternalizeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 0,
        errorCode: 'invalid_request',
        msg: parsed.error.issues[0]?.message || '参数错误',
      });
    }
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      await requireInteractiveWriteFeature(flags, ownerUserId, draft.shopId);
      assertExpectedRevision(draft, parsed.data.expectedRevision);
      if (!options.mediaWorkflow) {
        throw Object.assign(new Error('来源图片转存服务不可用'), {
          code: 'source_listing_media_unavailable', statusCode: 503,
        });
      }
      const result = await options.mediaWorkflow.internalize({
        ownerUserId,
        draft,
        selections: parsed.data.selections,
      });
      return reply.send({ code: 1, data: result });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.put('/:draftId/media', async (request, reply) => {
    const { ownerUserId, actorUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = sourceMediaAssignmentsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        code: 0,
        errorCode: 'invalid_request',
        msg: parsed.error.issues[0]?.message || '参数错误',
      });
    }
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      await requireInteractiveWriteFeature(flags, ownerUserId, draft.shopId);
      assertExpectedRevision(draft, parsed.data.expectedRevision);
      if (!options.mediaWorkflow) {
        throw Object.assign(new Error('来源图片工作流服务不可用'), {
          code: 'source_listing_media_unavailable', statusCode: 503,
        });
      }
      await options.mediaWorkflow.validateSourceAssignments({
        ownerUserId,
        draft,
        assignments: parsed.data.assignments,
      });
      const result = await options.service.setMediaAssignments({
        draftId,
        ownerUserId,
        actorUserId,
        expectedRevision: parsed.data.expectedRevision,
        assignments: parsed.data.assignments,
      });
      return reply.send({ code: 1, data: result });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.post('/:draftId/manual-facts', async (request, reply) => {
    const { ownerUserId, actorUserId } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = manualFactSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: parsed.error.issues[0]?.message || '参数错误' });
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      await requireInteractiveWriteFeature(flags, ownerUserId, draft.shopId);
      const result = await options.service.confirmManualFact({
        draftId,
        ownerUserId,
        actorUserId,
        expectedRevision: parsed.data.expectedRevision,
        attributeKey: parsed.data.attributeKey,
        value: parsed.data.value,
        evidence: parsed.data.evidence,
      });
      return reply.send({ code: 1, data: result });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  for (const action of ['pause', 'resume', 'cancel', 'manual-review'] as const) {
    app.post(`/:draftId/${action}`, async (request, reply) => {
      const { ownerUserId, actorUserId } = authIds(request);
      const draftId = String((request.params as any).draftId || '').trim();
      const parsed = actionSchema.safeParse(request.body);
      if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: parsed.error.issues[0]?.message || '参数错误' });
      try {
        const draft = await options.service.getDraft({ draftId, ownerUserId });
        if (!draft) return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
        await requireInteractiveWriteFeature(flags, ownerUserId, draft.shopId);
        if (!options.service.setRunState) throw Object.assign(new Error('工作流状态服务不可用'), { code: 'source_listing_workflow_unavailable', statusCode: 503 });
        const runState = action === 'pause'
          ? 'PAUSED'
          : action === 'resume'
            ? 'ACTIVE'
            : action === 'cancel'
              ? 'CANCELLED'
              : 'MANUAL_REVIEW';
        const result = await options.service.setRunState({ draftId, ownerUserId, actorUserId, expectedRevision: parsed.data.expectedRevision, runState, reason: parsed.data.reason || null });
        return reply.send({ code: 1, data: result });
      } catch (error) {
        return routeError(reply, error, { service: options.service, draftId, ownerUserId });
      }
    });
  }

  app.post('/:draftId/publish-intent', async (request, reply) => {
    const { ownerUserId, actorUserId, isSubAccount, role } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = publishIntentSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: parsed.error.issues[0]?.message || '参数错误' });
    if (!ownerUserId || actorUserId !== ownerUserId || isSubAccount || role === 'STAFF') {
      return reply.status(403).send({
        code: 0,
        errorCode: 'source_publish_owner_required',
        msg: '仅店铺所有者可记录 Ozon 发布意图',
      });
    }
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      if (!draft) return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
      await requireInteractiveWriteFeature(flags, ownerUserId, draft.shopId);
      await options.authorizeByokPublish({
        ownerUserId,
        shopId: draft.shopId,
        workflowId: draft.id,
        assignments: draft.media?.assignments || [],
      });
      if (!options.service.recordPublishIntent) throw Object.assign(new Error('发布意图服务不可用'), { code: 'source_listing_workflow_unavailable', statusCode: 503 });
      const result = await options.service.recordPublishIntent({ draftId, ownerUserId, actorUserId, ...parsed.data });
      return reply.send({ code: 1, data: result, publishSubmitted: false });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.post('/:draftId/publish-attempts', async (request, reply) => {
    const { ownerUserId, actorUserId, isSubAccount, role } = authIds(request);
    const draftId = String((request.params as any).draftId || '').trim();
    const parsed = publishIntentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: parsed.error.issues[0]?.message || '参数错误' });
    }
    if (!ownerUserId || actorUserId !== ownerUserId || isSubAccount || role === 'STAFF') {
      return reply.status(403).send({
        code: 0,
        errorCode: 'source_publish_owner_required',
        msg: '仅店铺所有者可提交 Ozon 发布任务',
      });
    }
    try {
      const draft = await options.service.getDraft({ draftId, ownerUserId });
      if (!draft) {
        return reply.status(404).send({ code: 0, errorCode: 'source_listing_workflow_not_found', msg: '工作流不存在' });
      }
      await requireV2PublisherFeature(flags, ownerUserId, draft.shopId);
      await options.authorizeByokPublish({
        ownerUserId,
        shopId: draft.shopId,
        workflowId: draft.id,
        assignments: draft.media?.assignments || [],
      });
      if (!options.publisher) {
        throw Object.assign(new Error('Ozon V2 发布服务不可用'), {
          code: 'source_ozon_publisher_unavailable', statusCode: 503,
        });
      }
      const attempt = await options.publisher.publish({
        draftId,
        ownerUserId,
        actorUserId,
        expectedRevision: parsed.data.expectedRevision,
        idempotencyKey: parsed.data.idempotencyKey,
      });
      return reply.status(202).send({
        code: 1,
        data: publicPublishAttempt(attempt),
        publishSubmitted: attempt.state === 'SUBMITTED',
      });
    } catch (error) {
      return routeError(reply, error, { service: options.service, draftId, ownerUserId });
    }
  });

  app.get('/:draftId/publish-attempts/:attemptId', async (request, reply) => {
    const { ownerUserId, actorUserId, isSubAccount, role } = authIds(request);
    const parsed = publishAttemptParamsSchema.safeParse(request.params);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, errorCode: 'invalid_request', msg: '发布任务参数无效' });
    }
    if (!ownerUserId || actorUserId !== ownerUserId || isSubAccount || role === 'STAFF') {
      return reply.status(403).send({
        code: 0,
        errorCode: 'source_publish_owner_required',
        msg: '仅店铺所有者可查看 Ozon 发布任务',
      });
    }
    if (!options.publisher) {
      return reply.status(503).send({ code: 0, errorCode: 'source_ozon_publisher_unavailable', msg: 'Ozon V2 发布服务不可用' });
    }
    try {
      const attempt = await options.publisher.getAttempt({
        attemptId: parsed.data.attemptId,
        ownerUserId,
      });
      if (!attempt || attempt.workflowId !== parsed.data.draftId) {
        return reply.status(404).send({ code: 0, errorCode: 'source_ozon_publish_attempt_not_found', msg: '发布任务不存在' });
      }
      return reply.send({ code: 1, data: publicPublishAttempt(attempt) });
    } catch (error) {
      return routeError(reply, error);
    }
  });

  app.post('/:draftId/publish-attempts/:attemptId/resolve', async (request, reply) => {
    const { ownerUserId, actorUserId, isSubAccount, role } = authIds(request);
    const params = publishAttemptParamsSchema.safeParse(request.params);
    const body = publishAttemptResolutionSchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.status(400).send({
        code: 0,
        errorCode: 'invalid_request',
        msg: body.success ? '发布任务参数无效' : body.error.issues[0]?.message || '参数错误',
      });
    }
    if (!ownerUserId || actorUserId !== ownerUserId || isSubAccount || role === 'STAFF') {
      return reply.status(403).send({
        code: 0,
        errorCode: 'source_publish_owner_required',
        msg: '仅店铺所有者可处理未知 Ozon 发布任务',
      });
    }
    if (!options.publisher?.resolveAttempt) {
      return reply.status(503).send({
        code: 0,
        errorCode: 'source_ozon_publisher_unavailable',
        msg: 'Ozon V2 发布恢复服务不可用',
      });
    }
    try {
      const current = await options.publisher.getAttempt({
        attemptId: params.data.attemptId,
        ownerUserId,
      });
      if (!current || current.workflowId !== params.data.draftId) {
        return reply.status(404).send({
          code: 0,
          errorCode: 'source_ozon_publish_attempt_not_found',
          msg: '发布任务不存在',
        });
      }
      const resolution: OzonUnknownResolution = body.data.decision === 'SUBMITTED'
        ? {
            decision: 'SUBMITTED',
            taskId: body.data.taskId,
            note: body.data.note,
            evidence: body.data.evidence,
          }
        : {
            decision: 'NOT_SUBMITTED',
            note: body.data.note,
            evidence: body.data.evidence,
          };
      const attempt = await options.publisher.resolveAttempt({
        attemptId: params.data.attemptId,
        ownerUserId,
        actorUserId,
        expectedStateVersion: body.data.expectedStateVersion,
        resolution,
      });
      return reply.send({ code: 1, data: publicPublishAttempt(attempt) });
    } catch (error) {
      return routeError(reply, error);
    }
  });
}

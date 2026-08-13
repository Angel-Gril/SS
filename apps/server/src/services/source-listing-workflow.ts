import { createHash, randomUUID } from 'node:crypto';
import {
  SOURCE_LISTING_IDEMPOTENCY_KEY_MAX_LENGTH,
  SOURCE_LISTING_IDEMPOTENCY_KEY_MIN_LENGTH,
  SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS,
  SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
} from 'shared';
import type {
  OzonListingAiCopyCandidate,
  OzonListingAiCopyGenerationProvenance,
  OzonListingDraft,
  OzonListingDraftAttributeValue,
  OzonListingDraftAuditEventType,
  OzonListingDraftCategory,
  OzonListingDraftFreshnessReason,
  OzonListingDraftMediaAssignment,
  OzonListingPublishIntent,
  OzonListingWorkflowIssue,
  SourceListingWorkflowRunState,
} from 'shared';
import {
  OzonListingDraftRepositoryError,
  type OzonListingDraftRepository,
} from './ozon-listing-draft.js';
import {
  mergeSourceListingWorkflowReadiness,
  sourceListingWorkflowReadinessIssues,
  validateSourceListingPricing,
} from './source-listing-workflow-readiness.js';

type IdFactory = (prefix: string) => string;

export const SOURCE_LISTING_EVIDENCE_ITEM_MAX_LENGTH = 500;
export const SOURCE_LISTING_AI_COPY_CANDIDATE_MAX_ITEMS = 20;
export const SOURCE_LISTING_AI_COPY_CANDIDATE_MAX_BYTES = 256_000;
export const SOURCE_LISTING_AI_COPY_CANDIDATES_MAX_BYTES = 2_000_000;

export class SourceListingWorkflowError extends Error {
  constructor(
    public readonly code:
      | 'OZON_LISTING_DRAFT_NOT_FOUND'
      | 'OZON_LISTING_DRAFT_VERSION_CONFLICT'
      | 'OZON_LISTING_DRAFT_INPUT_INVALID'
      | 'OZON_LISTING_AI_CANDIDATE_NOT_FOUND'
      | 'OZON_LISTING_AI_CANDIDATE_STALE'
      | 'OZON_LISTING_AI_APPLY_OPERATION_CONFLICT'
      | 'OZON_LISTING_AI_GENERATION_OPERATION_CONFLICT'
      | 'OZON_LISTING_AI_GENERATION_FAILED'
      | 'OZON_LISTING_WORKFLOW_TERMINAL'
      | 'OZON_LISTING_PUBLISH_NOT_READY'
      | 'OZON_LISTING_PUBLISH_INTENT_CONFLICT',
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'SourceListingWorkflowError';
  }
}

function currentFreshness() {
  return { state: 'CURRENT' as const, reason: null };
}

function stale(reason: OzonListingDraftFreshnessReason) {
  return { state: 'STALE' as const, reason };
}

function normalizedSkuKeys(values: string[]): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID',
      `selectedSkuKeys must contain 1 to ${SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS} entries`,
      400,
    );
  }
  const normalized = values.map((value) => {
    if (typeof value !== 'string') {
      throw new SourceListingWorkflowError(
        'OZON_LISTING_DRAFT_INPUT_INVALID', 'selected SKU key is required', 400,
      );
    }
    const key = value.normalize('NFKC').trim();
    if (!key || key.length > SOURCE_LISTING_SKU_KEY_MAX_LENGTH) {
      throw new SourceListingWorkflowError(
        'OZON_LISTING_DRAFT_INPUT_INVALID', 'selected SKU key is invalid', 400,
      );
    }
    return key;
  });
  return [...new Set(normalized)].sort();
}

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID', `${label} is required`, 400,
    );
  }
  return normalized;
}

function boundedText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID', `${label} is required`, 400,
    );
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID', `${label} is invalid`, 400,
    );
  }
  return normalized;
}

function normalizedStepHashes(value: Record<string, string>): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID', 'completedStepHashes must be an object', 400,
    );
  }
  const entries = Object.entries(value);
  if (entries.length > 100) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID', 'completedStepHashes exceeds 100 entries', 400,
    );
  }
  const result: Record<string, string> = {};
  for (const [rawKey, rawHash] of entries) {
    const key = boundedText(rawKey, 'completed step key', 80);
    const hash = boundedText(rawHash, 'completed step hash', 64).toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(hash) || result[key]) {
      throw new SourceListingWorkflowError(
        'OZON_LISTING_DRAFT_INPUT_INVALID', 'completedStepHashes is invalid', 400,
      );
    }
    result[key] = hash;
  }
  return Object.fromEntries(Object.entries(result).sort(([left], [right]) => left.localeCompare(right)));
}

function normalizedIssues(value: OzonListingWorkflowIssue[], label: string): OzonListingWorkflowIssue[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID', `${label} exceeds 100 entries`, 400,
    );
  }
  return value.map((issue, index) => ({
    code: boundedText(issue?.code, `${label}[${index}].code`, 100),
    message: boundedText(issue?.message, `${label}[${index}].message`, 1000),
    ...(issue?.fieldPath == null
      ? {}
      : { fieldPath: boundedText(issue.fieldPath, `${label}[${index}].fieldPath`, 1000) }),
  }));
}

function normalizedTaskIds(value: string[]): string[] {
  if (!Array.isArray(value) || value.length > 100) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID', 'publishTaskIds exceeds 100 entries', 400,
    );
  }
  return [...new Set(value.map((taskId) => boundedText(taskId, 'publish task id', 200)))];
}

function normalizedMediaAssignments(
  value: OzonListingDraftMediaAssignment[],
  selectedSkuKeys: string[],
): OzonListingDraftMediaAssignment[] {
  if (!Array.isArray(value) || value.length > 500) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID', 'media assignments must contain at most 500 entries', 400,
    );
  }
  const selected = new Set(selectedSkuKeys);
  const assetIds = new Set<string>();
  return value.map((raw, index) => {
    const assignment = raw as OzonListingDraftMediaAssignment & Record<string, unknown>;
    const slotKey = boundedText(assignment?.slotKey, `media assignment ${index} slotKey`, 200)
      .normalize('NFKC');
    const assetId = boundedText(assignment?.assetId, `media assignment ${index} assetId`, 500)
      .normalize('NFKC');
    if (assetIds.has(assetId)
      || !['SOURCE', 'REVIEWED', 'GENERATED', 'TRANSLATED', 'EDITED'].includes(String(assignment?.source))) {
      throw new SourceListingWorkflowError(
        'OZON_LISTING_DRAFT_INPUT_INVALID', `media assignment ${index} is invalid`, 400,
      );
    }
    assetIds.add(assetId);
    if (assignment.scope === 'PRODUCT') {
      if (assignment.skuKey !== undefined) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID', 'product media assignment cannot include skuKey', 400,
        );
      }
      return { scope: 'PRODUCT', slotKey, assetId, source: assignment.source };
    }
    if (assignment.scope !== 'SKU') {
      throw new SourceListingWorkflowError(
        'OZON_LISTING_DRAFT_INPUT_INVALID', 'media assignment scope must be PRODUCT or SKU', 400,
      );
    }
    const skuKey = boundedText(
      assignment.skuKey,
      `media assignment ${index} skuKey`,
      SOURCE_LISTING_SKU_KEY_MAX_LENGTH,
    ).normalize('NFKC');
    if (!selected.has(skuKey)) {
      throw new SourceListingWorkflowError(
        'OZON_LISTING_DRAFT_INPUT_INVALID', 'SKU media assignment must target a selected canonical SKU', 400,
      );
    }
    return { scope: 'SKU', skuKey, slotKey, assetId, source: assignment.source };
  });
}

function normalizedEvidence(value: string[]): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 20) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID', 'manual fact evidence must contain 1 to 20 entries', 400,
    );
  }
  return [...new Set(value.map((item) => boundedText(
    item,
    'manual fact evidence',
    SOURCE_LISTING_EVIDENCE_ITEM_MAX_LENGTH,
  )))];
}

function normalizedAttributeChangeAudit(value: Array<{
  attributeId: number;
  skuKey?: string;
  action: 'SET' | 'CLEAR';
  evidence: string[];
}> | undefined) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_DRAFT_INPUT_INVALID', 'attribute change audit must contain 1 to 500 entries', 400,
    );
  }
  return value.map((change, index) => {
    const attributeId = Number(change?.attributeId);
    if (!Number.isSafeInteger(attributeId) || attributeId <= 0 || !['SET', 'CLEAR'].includes(change?.action)) {
      throw new SourceListingWorkflowError(
        'OZON_LISTING_DRAFT_INPUT_INVALID', `attribute change audit ${index} is invalid`, 400,
      );
    }
    return {
      attributeId,
      ...(change.skuKey == null
        ? {}
        : { skuKey: boundedText(change.skuKey, `attribute change audit ${index} SKU key`, SOURCE_LISTING_SKU_KEY_MAX_LENGTH) }),
      action: change.action,
      evidence: normalizedEvidence(change.evidence),
    };
  });
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

export function sourceListingAiCopyContextHash(draft: OzonListingDraft): string {
  const reviewedAttributes = Object.fromEntries(Object.entries(draft.attributes.values)
    .filter(([, value]) => value.reviewed)
    .sort(([left], [right]) => left.localeCompare(right, 'en')));
  return createHash('sha256').update(canonicalJson({
    shopId: draft.shopId,
    sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
    sourceCaptureHash: draft.sourceCaptureHash,
    selectedSkuKeys: [...draft.selectedSkuKeys].sort(),
    category: draft.category,
    reviewedAttributes,
  })).digest('hex');
}

export function hashOzonListingPublishState(draft: OzonListingDraft): string {
  const frozenState = {
    schema: 'ozon-listing-publish-state/v1',
    draftId: draft.id,
    ownerUserId: draft.ownerUserId,
    shopId: draft.shopId,
    supplyGoodsId: draft.supplyGoodsId,
    sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
    sourceCaptureHash: draft.sourceCaptureHash,
    selectedSkuKeys: draft.selectedSkuKeys,
    draftVersion: draft.draftVersion,
    category: draft.category,
    attributes: draft.attributes,
    publishCopy: {
      titleRu: draft.copy.publishTitleRu,
      descriptionRu: draft.copy.publishDescriptionRu,
    },
    media: draft.media,
    pricing: draft.pricing,
    validation: draft.validation,
    completedStepHashes: draft.completedStepHashes,
    blockers: draft.blockers,
    warnings: draft.warnings,
  };
  return createHash('sha256').update(canonicalJson(frozenState)).digest('hex');
}

function mapRepositoryError(error: unknown): never {
  if (!(error instanceof OzonListingDraftRepositoryError)) throw error;
  if (error.code === 'NOT_FOUND') {
    throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_NOT_FOUND', error.message, 404);
  }
  if (error.code === 'IDEMPOTENCY_CONFLICT') {
    throw new SourceListingWorkflowError('OZON_LISTING_PUBLISH_INTENT_CONFLICT', error.message, 409);
  }
  throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_VERSION_CONFLICT', error.message, 409);
}

/**
 * Re-check the complete authoritative draft state immediately before any
 * compatibility publisher is allowed to construct an Ozon client.
 *
 * This is intentionally independent of a publish-intent CAS so the legacy
 * compatibility route can enforce the same manual-review boundary without
 * creating a second publish intent.
 */
export function assertSourceListingDraftPublishReady(current: OzonListingDraft): void {
  const notReady: string[] = [];
  if (current.runState !== 'ACTIVE') notReady.push(`runState=${current.runState}`);
  if (current.stage !== 'READY_TO_PUBLISH') notReady.push(`stage=${current.stage}`);
  if (current.validation.status !== 'VALID') {
    notReady.push(`validation=${current.validation.status}`);
  }
  if (current.blockers.length) notReady.push(`blockers=${current.blockers.length}`);
  if (current.validation.status === 'VALID') {
    const report = current.validation.report;
    if (!report || typeof report !== 'object' || Array.isArray(report)) {
      notReady.push('readiness=VALIDATION_REPORT_INVALID');
    } else {
      try {
        const rechecked = mergeSourceListingWorkflowReadiness({
          draft: current,
          validation: {
            status: 'VALID',
            report,
            blockers: current.blockers,
            warnings: current.warnings,
          },
        });
        if (rechecked.status !== 'VALID') {
          const codes = [...new Set(rechecked.blockers.map((blocker) => blocker.code))];
          notReady.push(`readiness=${codes.join(',') || 'BLOCKED'}`);
        }
      } catch {
        notReady.push('readiness=VALIDATION_REPORT_INVALID');
      }
    }
  } else if (sourceListingWorkflowReadinessIssues(current).length) {
    notReady.push('readiness=BLOCKED');
  }
  const staleSections = (Object.entries(current.freshness) as Array<[
    keyof OzonListingDraft['freshness'],
    OzonListingDraft['freshness'][keyof OzonListingDraft['freshness']],
  ]>)
    .filter(([, freshness]) => freshness.state !== 'CURRENT')
    .map(([section]) => section);
  if (staleSections.length) notReady.push(`stale=${staleSections.join(',')}`);
  if (notReady.length) {
    throw new SourceListingWorkflowError(
      'OZON_LISTING_PUBLISH_NOT_READY',
      `Listing draft is not ready to publish: ${notReady.join('; ')}`,
      409,
    );
  }
}

export function createSourceListingWorkflowService(options: {
  repository: OzonListingDraftRepository;
  now?: () => Date;
  idFactory?: IdFactory;
}) {
  const now = options.now || (() => new Date());
  const idFactory = options.idFactory || ((prefix: string) => `${prefix}-${randomUUID()}`);

  function timestamp(): string {
    return now().toISOString();
  }

  function event(
    draftVersion: number,
    type: OzonListingDraftAuditEventType,
    actorUserId: string,
    details: Record<string, unknown> = {},
  ) {
    return {
      id: idFactory('audit'), type, actorUserId, draftVersion,
      occurredAt: timestamp(), details,
    };
  }

  async function getDraft(input: { draftId: string; ownerUserId: string }): Promise<OzonListingDraft> {
    const draft = await options.repository.getCurrent(input.draftId, input.ownerUserId);
    if (!draft) {
      throw new SourceListingWorkflowError(
        'OZON_LISTING_DRAFT_NOT_FOUND', 'Listing draft was not found', 404,
      );
    }
    return draft;
  }

  async function getDraftVersion(input: {
    draftId: string;
    ownerUserId: string;
    draftVersion: number;
  }): Promise<OzonListingDraft> {
    const draft = await options.repository.getVersion(input);
    if (!draft) {
      throw new SourceListingWorkflowError(
        'OZON_LISTING_DRAFT_NOT_FOUND', 'Listing draft version was not found', 404,
      );
    }
    return draft;
  }

  async function mutate(input: {
    draftId: string;
    ownerUserId: string;
    actorUserId: string;
    expectedRevision: number;
  }, update: (draft: OzonListingDraft) => OzonListingDraft): Promise<OzonListingDraft> {
    const draft = await getDraft(input);
    if (draft.revision !== input.expectedRevision) {
      throw new SourceListingWorkflowError(
        'OZON_LISTING_DRAFT_VERSION_CONFLICT', 'Listing draft revision changed', 409,
      );
    }
    if (draft.stage === 'PUBLISHED'
      || draft.runState === 'CANCELLED'
      || draft.runState === 'PERMANENT_FAILURE') {
      throw new SourceListingWorkflowError(
        'OZON_LISTING_WORKFLOW_TERMINAL', 'Terminal listing workflow cannot be changed', 409,
      );
    }
    const working = structuredClone(draft);
    working.grantRevocation = { required: false, reason: null, previousShopId: null };
    const next = update(working);
    next.revision = draft.revision + 1;
    next.updatedAt = timestamp();
    try {
      return await options.repository.compareAndSwap({ ...input, next });
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  return {
    async createDraft(input: {
      ownerUserId: string;
      actorUserId: string;
      shopId: string;
      supplyGoodsId: string;
      sourceCaptureSnapshotId: string;
      sourceCaptureHash: string;
      selectedSkuKeys: string[];
    }): Promise<OzonListingDraft> {
      const selectedSkuKeys = normalizedSkuKeys(input.selectedSkuKeys);
      if (!selectedSkuKeys.length) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID', 'At least one SKU must be selected', 400,
        );
      }
      const createdAt = timestamp();
      const identity = {
        ownerUserId: required(input.ownerUserId, 'ownerUserId'),
        shopId: required(input.shopId, 'shopId'),
        supplyGoodsId: required(input.supplyGoodsId, 'supplyGoodsId'),
        sourceCaptureSnapshotId: required(input.sourceCaptureSnapshotId, 'sourceCaptureSnapshotId'),
        selectedSkuKeys,
      };
      const existing = await options.repository.findCurrentByIdentity(identity);
      if (existing) return existing;
      const draft: OzonListingDraft = {
        id: idFactory('draft'),
        ...identity,
        sourceCaptureHash: required(input.sourceCaptureHash, 'sourceCaptureHash'),
        draftVersion: 1,
        revision: 1,
        stage: 'CATEGORY_REVIEW',
        runState: 'ACTIVE',
        runStateReason: null,
        category: null,
        attributes: { values: {} },
        copy: { publishTitleRu: null, publishDescriptionRu: null, candidates: [], applyAudit: [] },
        media: { assignments: [] },
        pricing: { value: null },
        validation: { status: 'NOT_RUN', report: null },
        completedStepHashes: {},
        blockers: [],
        warnings: [],
        publishTaskIds: [],
        freshness: {
          category: currentFreshness(), attributes: currentFreshness(), content: currentFreshness(),
          media: currentFreshness(), pricing: currentFreshness(), validation: currentFreshness(),
        },
        grantRevocation: { required: false, reason: null, previousShopId: null },
        auditEvents: [],
        createdAt,
        updatedAt: createdAt,
      };
      draft.auditEvents.push(event(1, 'DRAFT_CREATED', input.actorUserId, {
        shopId: draft.shopId,
        sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
        selectedSkuKeys,
      }));
      try {
        return await options.repository.create(draft);
      } catch (error) {
        return mapRepositoryError(error);
      }
    },

    getDraft,
    getDraftVersion,

    setCategory(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      category: OzonListingDraftCategory;
      retainedAttributeValues?: Record<string, OzonListingDraftAttributeValue>;
    }) {
      return mutate(input, (draft) => {
        const next = structuredClone(draft);
        next.draftVersion += 1;
        next.category = structuredClone(input.category);
        next.stage = 'ATTRIBUTE_REVIEW';
        next.attributes.values = structuredClone(
          input.retainedAttributeValues ?? draft.attributes.values,
        );
        next.validation = { status: 'STALE', report: draft.validation.report };
        next.freshness.attributes = stale('CATEGORY_CHANGED');
        next.freshness.category = currentFreshness();
        next.freshness.content = stale('CATEGORY_CHANGED');
        next.freshness.pricing = stale('CATEGORY_CHANGED');
        next.freshness.validation = stale('CATEGORY_CHANGED');
        next.grantRevocation = { required: true, reason: 'CATEGORY_CHANGED', previousShopId: null };
        next.auditEvents.push(event(next.draftVersion, 'CATEGORY_CHANGED', input.actorUserId, {
          ...input.category,
        }));
        return next;
      });
    },

    setAttributeValues(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      values: Record<string, OzonListingDraftAttributeValue>;
      operation?: 'MANUAL_EDIT' | 'SUGGESTION_APPLIED' | 'SYSTEM_SYNC';
      changeAudit?: Array<{
        attributeId: number;
        skuKey?: string;
        action: 'SET' | 'CLEAR';
        evidence: string[];
      }>;
    }) {
      const changeAudit = normalizedAttributeChangeAudit(input.changeAudit);
      return mutate(input, (draft) => {
        const next = structuredClone(draft);
        next.draftVersion += 1;
        next.attributes.values = structuredClone(input.values);
        next.freshness.attributes = currentFreshness();
        next.freshness.content = stale('ATTRIBUTE_VALUES_CHANGED');
        next.freshness.validation = stale('ATTRIBUTE_VALUES_CHANGED');
        next.validation.status = 'STALE';
        next.grantRevocation = {
          required: true,
          reason: 'ATTRIBUTE_VALUES_CHANGED',
          previousShopId: null,
        };
        next.auditEvents.push(event(
          next.draftVersion,
          'ATTRIBUTE_VALUES_CHANGED',
          input.actorUserId,
          {
            operation: input.operation || 'SYSTEM_SYNC',
            attributeKeys: Object.keys(input.values).sort(),
            ...(changeAudit ? { changes: changeAudit } : {}),
          },
        ));
        return next;
      });
    },

    async confirmManualFact(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      attributeKey: string; value: unknown; evidence: string[];
    }) {
      if (input.value === undefined) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID', 'manual fact value is required', 400,
        );
      }
      const attributeKey = boundedText(input.attributeKey, 'attributeKey', 200);
      const evidence = normalizedEvidence(input.evidence);
      return mutate(input, (draft) => {
        const next = structuredClone(draft);
        next.draftVersion += 1;
        next.attributes.values[attributeKey] = {
          value: structuredClone(input.value),
          source: 'MANUAL',
          reviewed: true,
          evidence,
          confidence: 1,
          dictionaryMatch: { status: 'NOT_APPLICABLE', dictionaryValueId: null },
          manualReview: 'CONFIRMED',
        };
        next.freshness.attributes = currentFreshness();
        next.freshness.content = stale('MANUAL_FACT_CONFIRMED');
        next.freshness.validation = stale('MANUAL_FACT_CONFIRMED');
        next.validation.status = 'STALE';
        next.grantRevocation = {
          required: true,
          reason: 'MANUAL_FACT_CONFIRMED',
          previousShopId: null,
        };
        next.auditEvents.push(event(
          next.draftVersion,
          'MANUAL_FACT_CONFIRMED',
          input.actorUserId,
          { attributeKey, evidence },
        ));
        return next;
      });
    },

    setMediaAssignments(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      assignments: OzonListingDraftMediaAssignment[];
    }) {
      return mutate(input, (draft) => {
        const next = structuredClone(draft);
        next.draftVersion += 1;
        next.media.assignments = normalizedMediaAssignments(
          input.assignments,
          draft.selectedSkuKeys,
        );
        next.freshness.media = currentFreshness();
        next.freshness.validation = stale('MEDIA_ASSIGNMENT_CHANGED');
        next.validation.status = 'STALE';
        next.grantRevocation = {
          required: true,
          reason: 'MEDIA_ASSIGNMENT_CHANGED',
          previousShopId: null,
        };
        return next;
      });
    },

    async setPricing(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      value: Record<string, unknown> | null;
    }) {
      return mutate(input, (draft) => {
        const value = validateSourceListingPricing(input.value, draft.selectedSkuKeys);
        const next = structuredClone(draft);
        next.draftVersion += 1;
        next.pricing.value = structuredClone(value);
        next.freshness.pricing = currentFreshness();
        next.freshness.validation = stale('PRICING_CHANGED');
        next.validation.status = 'STALE';
        next.grantRevocation = { required: true, reason: 'PRICING_CHANGED', previousShopId: null };
        next.auditEvents.push(event(next.draftVersion, 'PRICING_CHANGED', input.actorUserId));
        return next;
      });
    },

    async setWorkflowProgress(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      completedStepHashes: Record<string, string>;
      blockers: OzonListingWorkflowIssue[];
      warnings: OzonListingWorkflowIssue[];
      publishTaskIds: string[];
    }) {
      const completedStepHashes = normalizedStepHashes(input.completedStepHashes);
      const blockers = normalizedIssues(input.blockers, 'blockers');
      const warnings = normalizedIssues(input.warnings, 'warnings');
      const publishTaskIds = normalizedTaskIds(input.publishTaskIds);
      return mutate(input, (draft) => {
        const next = structuredClone(draft);
        next.completedStepHashes = completedStepHashes;
        next.blockers = blockers;
        next.warnings = warnings;
        next.publishTaskIds = publishTaskIds;
        next.auditEvents.push(event(next.draftVersion, 'WORKFLOW_PROGRESS_UPDATED', input.actorUserId, {
          completedStepCount: Object.keys(completedStepHashes).length,
          blockerCount: blockers.length,
          warningCount: warnings.length,
          publishTaskCount: publishTaskIds.length,
        }));
        return next;
      });
    },

    replaceSourceSnapshot(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      sourceCaptureSnapshotId: string; sourceCaptureHash: string; selectedSkuKeys?: string[];
    }) {
      return mutate(input, (draft) => {
        const next = structuredClone(draft);
        const selectedSkuKeys = input.selectedSkuKeys === undefined
          ? draft.selectedSkuKeys
          : normalizedSkuKeys(input.selectedSkuKeys);
        next.draftVersion += 1;
        next.sourceCaptureSnapshotId = required(input.sourceCaptureSnapshotId, 'sourceCaptureSnapshotId');
        next.sourceCaptureHash = required(input.sourceCaptureHash, 'sourceCaptureHash');
        next.selectedSkuKeys = selectedSkuKeys;
        next.stage = 'CATEGORY_REVIEW';
        for (const key of ['category', 'attributes', 'content', 'media', 'pricing', 'validation'] as const) {
          next.freshness[key] = stale('SOURCE_SNAPSHOT_CHANGED');
        }
        next.validation.status = 'STALE';
        next.grantRevocation = { required: true, reason: 'SOURCE_SNAPSHOT_CHANGED', previousShopId: null };
        next.auditEvents.push(event(next.draftVersion, 'SOURCE_SNAPSHOT_CHANGED', input.actorUserId, {
          previousSnapshotId: draft.sourceCaptureSnapshotId,
          sourceCaptureSnapshotId: next.sourceCaptureSnapshotId,
          previousSelectedSkuKeys: draft.selectedSkuKeys,
          selectedSkuKeys: next.selectedSkuKeys,
        }));
        return next;
      });
    },

    changeShop(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number; shopId: string;
    }) {
      return mutate(input, (draft) => {
        const next = structuredClone(draft);
        next.draftVersion += 1;
        next.shopId = required(input.shopId, 'shopId');
        next.stage = 'CATEGORY_REVIEW';
        for (const key of ['category', 'attributes', 'content', 'pricing', 'validation'] as const) {
          next.freshness[key] = stale('SHOP_CHANGED');
        }
        next.validation.status = 'STALE';
        next.grantRevocation = { required: true, reason: 'SHOP_CHANGED', previousShopId: draft.shopId };
        next.auditEvents.push(event(next.draftVersion, 'SHOP_CHANGED', input.actorUserId, {
          previousShopId: draft.shopId, shopId: next.shopId,
        }));
        return next;
      });
    },

    changeSkuSelection(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      selectedSkuKeys: string[];
    }) {
      return mutate(input, (draft) => {
        const selectedSkuKeys = normalizedSkuKeys(input.selectedSkuKeys);
        if (!selectedSkuKeys.length) {
          throw new SourceListingWorkflowError(
            'OZON_LISTING_DRAFT_INPUT_INVALID', 'At least one SKU must be selected', 400,
          );
        }
        const next = structuredClone(draft);
        next.draftVersion += 1;
        next.selectedSkuKeys = selectedSkuKeys;
        for (const key of ['attributes', 'content', 'media', 'pricing', 'validation'] as const) {
          next.freshness[key] = stale('SKU_SELECTION_CHANGED');
        }
        next.validation.status = 'STALE';
        next.grantRevocation = { required: true, reason: 'SKU_SELECTION_CHANGED', previousShopId: null };
        next.auditEvents.push(event(next.draftVersion, 'SKU_SELECTION_CHANGED', input.actorUserId, { selectedSkuKeys }));
        return next;
      });
    },

    async addAiCopyCandidate(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      titleRu?: string | null; descriptionRu?: string | null; sourcePromptVersion: string;
      kind?: 'MANUAL' | 'AI_GENERATED';
      generation?: OzonListingAiCopyGenerationProvenance;
    }): Promise<{ draft: OzonListingDraft; candidate: OzonListingAiCopyCandidate }> {
      if ((input.kind === 'AI_GENERATED') !== Boolean(input.generation)) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID',
          'AI-generated candidates require frozen generation provenance',
          400,
        );
      }
      const fields = input.generation?.fields || [
        ...(Object.prototype.hasOwnProperty.call(input, 'titleRu') ? ['title' as const] : []),
        ...(Object.prototype.hasOwnProperty.call(input, 'descriptionRu') ? ['description' as const] : []),
      ];
      if (!fields.length) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID', 'AI copy candidate must contain a title or description field', 400,
        );
      }
      if (input.generation) {
        const current = await getDraft(input);
        const existing = current.copy.candidates.find((candidate) => (
          candidate.generation?.operationKey === input.generation?.operationKey
        ));
        if (existing) {
          if (existing.generation?.clientRequestHash !== input.generation.clientRequestHash) {
            throw new SourceListingWorkflowError(
              'OZON_LISTING_AI_GENERATION_OPERATION_CONFLICT',
              'AI copy generation operation key was reused with different inputs',
              409,
            );
          }
          return { draft: current, candidate: existing };
        }
      }
      const candidateId = idFactory('copy-candidate');
      const persist = () => mutate(input, (draft) => {
        const next = structuredClone(draft);
        if (next.copy.candidates.length >= SOURCE_LISTING_AI_COPY_CANDIDATE_MAX_ITEMS) {
          throw new SourceListingWorkflowError(
            'OZON_LISTING_DRAFT_INPUT_INVALID',
            `AI copy candidates cannot exceed ${SOURCE_LISTING_AI_COPY_CANDIDATE_MAX_ITEMS} items`,
            400,
          );
        }
        const candidate: OzonListingAiCopyCandidate = {
          id: candidateId,
          kind: input.kind || (input.generation ? 'AI_GENERATED' : 'MANUAL'),
          fields: [...fields],
          titleRu: input.titleRu ?? null,
          descriptionRu: input.descriptionRu ?? null,
          sourcePromptVersion: required(input.sourcePromptVersion, 'sourcePromptVersion'),
          sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
          sourceCaptureHash: draft.sourceCaptureHash,
          ...(input.generation ? { generation: structuredClone(input.generation) } : {}),
          createdByUserId: input.actorUserId,
          createdAt: timestamp(),
        };
        if (Buffer.byteLength(JSON.stringify(candidate), 'utf8') > SOURCE_LISTING_AI_COPY_CANDIDATE_MAX_BYTES) {
          throw new SourceListingWorkflowError(
            'OZON_LISTING_DRAFT_INPUT_INVALID',
            `AI copy candidate exceeds ${SOURCE_LISTING_AI_COPY_CANDIDATE_MAX_BYTES} bytes`,
            400,
          );
        }
        if (Buffer.byteLength(JSON.stringify([...next.copy.candidates, candidate]), 'utf8')
          > SOURCE_LISTING_AI_COPY_CANDIDATES_MAX_BYTES) {
          throw new SourceListingWorkflowError(
            'OZON_LISTING_DRAFT_INPUT_INVALID',
            `AI copy candidate history exceeds ${SOURCE_LISTING_AI_COPY_CANDIDATES_MAX_BYTES} bytes`,
            400,
          );
        }
        next.copy.candidates.push(candidate);
        next.auditEvents.push(event(next.draftVersion, 'AI_COPY_CANDIDATE_CREATED', input.actorUserId, {
          candidateId,
        }));
        return next;
      });
      let updated: OzonListingDraft;
      try {
        updated = await persist();
      } catch (error) {
        if (!(error instanceof SourceListingWorkflowError)
          || error.code !== 'OZON_LISTING_DRAFT_VERSION_CONFLICT'
          || !input.generation) throw error;
        const latest = await getDraft(input);
        const existing = latest.copy.candidates.find((candidate) => (
          candidate.generation?.operationKey === input.generation?.operationKey
        ));
        if (!existing
          || existing.generation?.clientRequestHash !== input.generation.clientRequestHash) throw error;
        return { draft: latest, candidate: existing };
      }
      return { draft: updated, candidate: updated.copy.candidates.find((value) => value.id === candidateId)! };
    },

    async applyAiCopyCandidate(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      candidateId: string; operationKey: string;
    }) {
      const operationKey = required(input.operationKey, 'operationKey');
      const resolveReplay = (draft: OzonListingDraft): OzonListingDraft | null => {
        const applied = draft.copy.applyAudit.find((audit) => audit.operationKey === operationKey);
        if (!applied) return null;
        if (applied.candidateId !== input.candidateId) {
          throw new SourceListingWorkflowError(
            'OZON_LISTING_AI_APPLY_OPERATION_CONFLICT',
            'AI copy apply operation key was reused for another candidate',
            409,
          );
        }
        return draft;
      };
      const current = await getDraft(input);
      const replay = resolveReplay(current);
      if (replay) return replay;
      try {
        return await mutate(input, (draft) => {
          const candidate = draft.copy.candidates.find((value) => value.id === input.candidateId);
          if (!candidate) {
            throw new SourceListingWorkflowError(
              'OZON_LISTING_AI_CANDIDATE_NOT_FOUND', 'AI copy candidate was not found', 404,
            );
          }
          if (candidate.sourceCaptureSnapshotId !== draft.sourceCaptureSnapshotId
            || candidate.sourceCaptureHash !== draft.sourceCaptureHash) {
            throw new SourceListingWorkflowError(
              'OZON_LISTING_AI_CANDIDATE_STALE', 'AI copy candidate belongs to an older source snapshot', 409,
            );
          }
          const candidateFields = candidate.fields || candidate.generation?.fields || ['title', 'description'];
          if (candidate.generation && (
            draft.freshness.category.state !== 'CURRENT'
            || draft.freshness.attributes.state !== 'CURRENT'
          )) {
            throw new SourceListingWorkflowError(
              'OZON_LISTING_AI_CANDIDATE_STALE',
              'AI copy candidate prerequisites are stale',
              409,
            );
          }
          if (candidate.generation
            && candidate.generation.draftContextHash !== sourceListingAiCopyContextHash(draft)) {
            throw new SourceListingWorkflowError(
              'OZON_LISTING_AI_CANDIDATE_STALE',
              'AI copy candidate belongs to an older listing fact context',
              409,
            );
          }
          const retainsStaleTitle = !candidateFields.includes('title') && draft.copy.publishTitleRu !== null;
          const retainsStaleDescription = !candidateFields.includes('description')
            && draft.copy.publishDescriptionRu !== null;
          if (draft.freshness.content.state !== 'CURRENT'
            && (retainsStaleTitle || retainsStaleDescription)) {
            throw new SourceListingWorkflowError(
              'OZON_LISTING_AI_CANDIDATE_STALE',
              'A partial copy candidate cannot re-authorize retained stale content',
              409,
            );
          }
          const next = structuredClone(draft);
          next.draftVersion += 1;
          if (candidateFields.includes('title')) {
            next.copy.publishTitleRu = candidate.titleRu;
          }
          if (candidateFields.includes('description')) {
            next.copy.publishDescriptionRu = candidate.descriptionRu;
          }
          next.copy.applyAudit.push({
            id: idFactory('copy-apply'), candidateId: candidate.id,
            actorUserId: input.actorUserId, operationKey, draftVersion: next.draftVersion,
            previousTitleRu: draft.copy.publishTitleRu,
            previousDescriptionRu: draft.copy.publishDescriptionRu,
            appliedAt: timestamp(),
          });
          next.freshness.content = currentFreshness();
          next.freshness.validation = stale('CONTENT_APPLIED');
          next.validation.status = 'STALE';
          next.grantRevocation = {
            required: true,
            reason: 'CONTENT_APPLIED',
            previousShopId: null,
          };
          next.auditEvents.push(event(next.draftVersion, 'AI_COPY_CANDIDATE_APPLIED', input.actorUserId, {
            candidateId: candidate.id, operationKey,
          }));
          return next;
        });
      } catch (error) {
        if (!(error instanceof SourceListingWorkflowError)
          || error.code !== 'OZON_LISTING_DRAFT_VERSION_CONFLICT') throw error;
        const latest = await getDraft(input);
        return resolveReplay(latest) || Promise.reject(error);
      }
    },

    setRunState(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      runState: SourceListingWorkflowRunState; reason: string | null;
    }) {
      return mutate(input, (draft) => {
        const next = structuredClone(draft);
        next.runState = input.runState;
        next.runStateReason = input.reason;
        next.auditEvents.push(event(next.draftVersion, 'WORKFLOW_RUN_STATE_CHANGED', input.actorUserId, {
          previousRunState: draft.runState, runState: input.runState, reason: input.reason,
        }));
        return next;
      });
    },

    recordValidationResult(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      status: 'VALID' | 'INVALID'; report: Record<string, unknown>;
      blockers: OzonListingWorkflowIssue[]; warnings: OzonListingWorkflowIssue[];
    }) {
      if (!input.report || typeof input.report !== 'object' || Array.isArray(input.report)) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID', 'validation report must be an object', 400,
        );
      }
      const blockers = normalizedIssues(input.blockers, 'blockers');
      const warnings = normalizedIssues(input.warnings, 'warnings');
      if (input.status === 'VALID' && blockers.length) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID', 'a valid result cannot contain blockers', 400,
        );
      }
      return mutate(input, (draft) => {
        const validation = mergeSourceListingWorkflowReadiness({
          draft,
          validation: {
            status: input.status,
            report: input.report,
            blockers,
            warnings,
          },
        });
        const next = structuredClone(draft);
        next.validation = { status: validation.status, report: validation.report };
        next.blockers = validation.blockers;
        next.warnings = validation.warnings;
        next.freshness.attributes = currentFreshness();
        next.freshness.validation = currentFreshness();
        next.stage = validation.status === 'VALID' ? 'READY_TO_PUBLISH' : 'VALIDATION';
        next.auditEvents.push(event(next.draftVersion, 'VALIDATION_RECORDED', input.actorUserId, {
          status: validation.status,
          blockerCount: validation.blockers.length,
          warningCount: validation.warnings.length,
        }));
        return next;
      });
    },

    async recordPublishIntent(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      idempotencyKey: string;
    }): Promise<{ draft: OzonListingDraft; intent: OzonListingPublishIntent; idempotent: boolean }> {
      const idempotencyKey = boundedText(
        input.idempotencyKey,
        'idempotencyKey',
        SOURCE_LISTING_IDEMPOTENCY_KEY_MAX_LENGTH,
      );
      if (idempotencyKey.length < SOURCE_LISTING_IDEMPOTENCY_KEY_MIN_LENGTH) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID',
          `idempotencyKey must contain at least ${SOURCE_LISTING_IDEMPOTENCY_KEY_MIN_LENGTH} characters`,
          400,
        );
      }
      const current = await getDraft(input);
      const payloadHash = hashOzonListingPublishState(current);
      const existing = await options.repository.getPublishIntent({
        ownerUserId: input.ownerUserId,
        idempotencyKey,
      });
      if (existing) {
        if (existing.draftId !== input.draftId || existing.payloadHash !== payloadHash) {
          throw new SourceListingWorkflowError(
            'OZON_LISTING_PUBLISH_INTENT_CONFLICT',
            'Publish intent key was reused with another frozen draft state',
            409,
          );
        }
        return { draft: current, intent: existing, idempotent: true };
      }

      assertSourceListingDraftPublishReady(current);

      const draft = structuredClone(current);
      draft.grantRevocation = { required: false, reason: null, previousShopId: null };
      draft.revision = current.revision + 1;
      draft.updatedAt = timestamp();
      draft.stage = 'PUBLISH_INTENT_RECORDED';
      draft.auditEvents.push(event(draft.draftVersion, 'PUBLISH_INTENT_RECORDED', input.actorUserId, {
        idempotencyKey, payloadHash,
      }));
      const intent: OzonListingPublishIntent = {
        id: idFactory('publish-intent'),
        draftId: draft.id,
        ownerUserId: draft.ownerUserId,
        shopId: draft.shopId,
        draftVersion: draft.draftVersion,
        revision: draft.revision,
        idempotencyKey,
        payloadHash,
        actorUserId: input.actorUserId,
        createdAt: timestamp(),
      };
      draft.publishTaskIds = normalizedTaskIds([...draft.publishTaskIds, intent.id]);
      try {
        return await options.repository.recordPublishIntent({
          ...input,
          idempotencyKey,
          payloadHash,
          next: draft,
          intent,
        });
      } catch (error) {
        return mapRepositoryError(error);
      }
    },
  };
}

export type SourceListingWorkflowService = ReturnType<typeof createSourceListingWorkflowService>;

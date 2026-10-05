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
  OzonListingSkuPackagingItem,
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
  type SourceListingAttributeValidationInput,
} from './source-listing-workflow-readiness.js';
import {
  assertSourceListingSkuPackagingCoverage,
  normalizeSourceListingSkuPackagingItems,
  projectSourceListingSkuPackaging,
} from './source-listing-sku-packaging.js';
import {
  SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES,
  SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_NODES,
  SOURCE_LISTING_JSON_VALUE_MAX_DEPTH,
  inspectSourceListingJsonValue,
  sourceListingJsonLimitMessage,
} from './source-listing-json-limits.js';
import { normalizeSourceListingManualAttributeChanges } from './source-listing-manual-attribute-changes.js';
import { normalizeSourceListingAttributeSuggestionChanges } from './source-listing-attribute-suggestion-changes.js';
import type { SourceListingAttributeManualChange } from './source-listing-workflow-attributes.js';
import type { SourceListingAttributeSuggestionReference } from './source-listing-workflow-attributes.js';
import { SOURCE_LISTING_MANUAL_COPY_PROMPT_VERSION, normalizeSourceListingManualCopy } from './source-listing-manual-copy.js';
import { deriveSourceListingSkuCopyKey, sourceListingEditorSkuKeysForDraft, sourceListingOfferRowsForDraft } from './source-listing-sku-copies.js';

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
      | 'OZON_LISTING_AI_GENERATION_IN_PROGRESS'
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
    ...(draft.offerRows?.rows.length ? { offerRows: draft.offerRows } : {}),
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
    ...(draft.offerRows?.rows.length ? { offerRows: draft.offerRows } : {}),
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
  const editorMutations = new Map<string, { requestHash: string; operation: Promise<OzonListingDraft> }>();

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
  }, update: (draft: OzonListingDraft) => OzonListingDraft | Promise<OzonListingDraft>): Promise<OzonListingDraft> {
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
    const next = await update(working);
    next.revision = draft.revision + 1;
    next.updatedAt = timestamp();
    try {
      return await options.repository.compareAndSwap({ ...input, next });
    } catch (error) {
      return mapRepositoryError(error);
    }
  }

  async function idempotentEditorMutation(
    input: { draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number; expectedDraftVersion?: number; operationKey?: string },
    kind: 'CATEGORY_CHANGED' | 'PRICING_CHANGED' | 'SKU_SELECTION_CHANGED' | 'SKU_DUPLICATED' | 'MANUAL_FACT_CONFIRMED' | 'ATTRIBUTE_VALUES_CHANGED' | 'AI_COPY_CANDIDATE_CREATED' | 'VALIDATION_RECORDED',
    value: unknown,
    update: (draft: OzonListingDraft) => OzonListingDraft | Promise<OzonListingDraft>,
  ): Promise<OzonListingDraft> {
    if (input.operationKey === undefined) return mutate(input, update);
    const operationKey = boundedText(input.operationKey, 'editor operation key', 128);
    if (operationKey.length < 8 || operationKey !== input.operationKey) {
      throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'Invalid editor operation key', 400);
    }
    const requestHash = createHash('sha256').update(canonicalJson({
      kind, draftId: input.draftId, ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId, expectedRevision: input.expectedRevision, expectedDraftVersion: input.expectedDraftVersion, value,
    })).digest('hex');
    async function replay() {
      const current = await getDraft(input);
      const receipt = current.auditEvents.find((entry) => entry.details?.editorOperationKey === operationKey);
      if (!receipt) return null;
      if (receipt.type !== kind || receipt.details?.editorRequestHash !== requestHash) {
        throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_VERSION_CONFLICT', 'Editor operation key conflicts with another request', 409);
      }
      return getDraftVersion({ ...input, draftVersion: receipt.draftVersion });
    }
    const flightKey = canonicalJson({ draftId: input.draftId, ownerUserId: input.ownerUserId, actorUserId: input.actorUserId, operationKey });
    const running = editorMutations.get(flightKey);
    if (running) {
      if (running.requestHash !== requestHash) {
        throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_VERSION_CONFLICT', 'Editor operation key conflicts with an active request', 409);
      }
      return running.operation;
    }
    const operation = (async () => {
      const previous = await replay();
      if (previous) return previous;
      if (input.expectedDraftVersion !== undefined) {
        const current = await getDraft(input);
        if (current.draftVersion !== input.expectedDraftVersion) {
          const completed = await replay();
          if (completed) return completed;
          throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_VERSION_CONFLICT', 'Editor draft version changed', 409);
        }
      }
      try {
        return await mutate(input, async (draft) => {
          const next = await update(draft);
          const receipt = next.auditEvents.at(-1);
          if (!receipt || receipt.type !== kind) {
            throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'Editor receipt was not recorded', 400);
          }
          receipt.details = { ...receipt.details, editorOperationKey: operationKey, editorRequestHash: requestHash };
          return next;
        });
      } catch (error) {
        if (error instanceof SourceListingWorkflowError && error.code === 'OZON_LISTING_DRAFT_VERSION_CONFLICT') {
          const completed = await replay();
          if (completed) return completed;
        }
        throw error;
      }
    })();
    editorMutations.set(flightKey, { requestHash, operation });
    try { return await operation; }
    finally { editorMutations.delete(flightKey); }
  }

  function changedAttributeValues(draft: OzonListingDraft, values: Record<string, OzonListingDraftAttributeValue>,
    actorUserId: string, operation: 'MANUAL_EDIT' | 'SUGGESTION_APPLIED' | 'SYSTEM_SYNC',
    changeAudit?: ReturnType<typeof normalizedAttributeChangeAudit>): OzonListingDraft {
    const next = structuredClone(draft);
    next.draftVersion += 1;
    next.attributes.values = structuredClone(values);
    if (next.offerRows?.rows.length) next.offerRows.rows = next.offerRows.rows.map((row) => ({ ...row,
      attributes: Object.fromEntries(Object.entries(values).flatMap(([key, value]) => value.skuValues?.[row.rowKey]
        ? [[key, structuredClone(value.skuValues[row.rowKey])]] : [])) as Record<string, OzonListingDraftAttributeValue> }));
    next.freshness.attributes = currentFreshness();
    next.freshness.content = stale('ATTRIBUTE_VALUES_CHANGED');
    next.freshness.validation = stale('ATTRIBUTE_VALUES_CHANGED');
    next.validation.status = 'STALE';
    next.grantRevocation = { required: true, reason: 'ATTRIBUTE_VALUES_CHANGED', previousShopId: null };
    next.auditEvents.push(event(next.draftVersion, 'ATTRIBUTE_VALUES_CHANGED', actorUserId, {
      operation, attributeKeys: Object.keys(values).sort(), ...(changeAudit ? { changes: changeAudit } : {}),
    }));
    return next;
  }

  function assertAttributeValuesBudget(values: Record<string, OzonListingDraftAttributeValue>): void {
    const complexity = inspectSourceListingJsonValue(values, {
      maxBytes: SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES, maxNodes: SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_NODES,
      maxDepth: SOURCE_LISTING_JSON_VALUE_MAX_DEPTH,
    });
    if (!complexity.valid) {
      throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID',
        sourceListingJsonLimitMessage(complexity, 'Stored attribute values'), 400);
    }
  }

  function normalizedValidation(input: SourceListingAttributeValidationInput): SourceListingAttributeValidationInput {
    if (!input.report || typeof input.report !== 'object' || Array.isArray(input.report)) {
      throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'validation report must be an object', 400);
    }
    const blockers = normalizedIssues(input.blockers, 'blockers');
    const warnings = normalizedIssues(input.warnings, 'warnings');
    if (input.status === 'VALID' && blockers.length) {
      throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'a valid result cannot contain blockers', 400);
    }
    return { status: input.status, report: input.report, blockers, warnings };
  }

  function recordedValidation(draft: OzonListingDraft, input: SourceListingAttributeValidationInput, actorUserId: string): OzonListingDraft {
    const validation = mergeSourceListingWorkflowReadiness({ draft, validation: input });
    const next = structuredClone(draft);
    next.validation = { status: validation.status, report: validation.report };
    next.blockers = validation.blockers;
    next.warnings = validation.warnings;
    next.freshness.attributes = currentFreshness();
    next.freshness.validation = currentFreshness();
    next.stage = validation.status === 'VALID' ? 'READY_TO_PUBLISH' : 'VALIDATION';
    next.auditEvents.push(event(next.draftVersion, 'VALIDATION_RECORDED', actorUserId, {
      status: validation.status, blockerCount: validation.blockers.length, warningCount: validation.warnings.length,
    }));
    return next;
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
      operationKey?: string;
      expectedDraftVersion?: number;
      category: OzonListingDraftCategory;
      retainedAttributeValues?: Record<string, OzonListingDraftAttributeValue>;
    }) {
      return idempotentEditorMutation(input, 'CATEGORY_CHANGED', input.category, (draft) => {
        const next = structuredClone(draft);
        next.draftVersion += 1;
        next.category = structuredClone(input.category);
        if (next.media.videoBindings !== undefined) next.media.videoBindings = [];
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
      return mutate(input, (draft) => changedAttributeValues(draft, input.values, input.actorUserId,
        input.operation || 'SYSTEM_SYNC', changeAudit));
    },

    async setManualAttributeChanges(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      expectedDraftVersion: number; operationKey: string; schemaRevision: string; changes: SourceListingAttributeManualChange[];
    }, prepareValues: (draft: OzonListingDraft, changes: SourceListingAttributeManualChange[]) => Promise<Record<string, OzonListingDraftAttributeValue>>) {
      if (!Number.isSafeInteger(input.expectedDraftVersion) || input.expectedDraftVersion < 1
        || typeof input.operationKey !== 'string' || typeof input.schemaRevision !== 'string'
        || !/^[a-f0-9]{64}$/u.test(input.schemaRevision) || typeof prepareValues !== 'function') {
        throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'Attribute edits require a current schema, operation key and draft version', 400);
      }
      const changes = normalizeSourceListingManualAttributeChanges(input.changes);
      const changeAudit = normalizedAttributeChangeAudit(changes.map((change) => ({
        attributeId: change.attributeId, ...(change.skuKey ? { skuKey: change.skuKey } : {}),
        action: change.action || 'SET', evidence: change.evidence,
      })));
      return idempotentEditorMutation(input, 'ATTRIBUTE_VALUES_CHANGED', { schemaRevision: input.schemaRevision, changes }, async (draft) => {
        const values = await prepareValues(draft, structuredClone(changes));
        assertAttributeValuesBudget(values);
        return changedAttributeValues(draft, values, input.actorUserId, 'MANUAL_EDIT', changeAudit);
      });
    },

    async setSuggestedAttributeChanges(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      expectedDraftVersion: number; operationKey: string; schemaRevision: string; candidates: unknown;
    }, prepareValues: (draft: OzonListingDraft, candidates: SourceListingAttributeSuggestionReference[]) => Promise<Record<string, OzonListingDraftAttributeValue>>) {
      if (!Number.isSafeInteger(input.expectedDraftVersion) || input.expectedDraftVersion < 1
        || typeof input.operationKey !== 'string' || typeof prepareValues !== 'function') {
        throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'Suggested attribute edits require an operation key and exact draft version', 400);
      }
      const candidates = normalizeSourceListingAttributeSuggestionChanges(input.candidates, input.schemaRevision);
      return idempotentEditorMutation(input, 'ATTRIBUTE_VALUES_CHANGED', { action: 'SUGGESTIONS', schemaRevision: input.schemaRevision, candidates }, async (draft) => {
        const values = await prepareValues(draft, structuredClone(candidates));
        assertAttributeValuesBudget(values);
        return changedAttributeValues(draft, values, input.actorUserId, 'SUGGESTION_APPLIED');
      });
    },

    async setSkuPackaging(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      expectedDraftVersion: number; operationKey: string; items: OzonListingSkuPackagingItem[]; evidence: string[];
    }): Promise<OzonListingDraft> {
      if (!Number.isSafeInteger(input.expectedDraftVersion) || input.expectedDraftVersion < 1
        || typeof input.operationKey !== 'string') {
        throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'SKU packaging requires an operation key and draft version', 400);
      }
      const items = normalizeSourceListingSkuPackagingItems(input.items);
      const evidence = normalizedEvidence(input.evidence);
      return idempotentEditorMutation(input, 'MANUAL_FACT_CONFIRMED', { action: 'PACKAGING', items, evidence }, (draft) => {
        assertSourceListingSkuPackagingCoverage(items, sourceListingEditorSkuKeysForDraft(draft));
        const next = structuredClone(draft);
        next.draftVersion += 1;
        next.attributes.values.packaging = {
          value: null, source: 'MANUAL', reviewed: true, evidence, manualReview: 'CONFIRMED',
          skuValues: Object.fromEntries(items.map(({ skuKey, ...value }) => [skuKey, {
            value, source: 'MANUAL', reviewed: true, evidence: [...evidence], confidence: 1,
            dictionaryMatch: { status: 'NOT_APPLICABLE', dictionaryValueId: null }, manualReview: 'CONFIRMED',
          } satisfies OzonListingDraftAttributeValue])),
        };
        if (next.offerRows?.rows.length) next.offerRows.rows = next.offerRows.rows.map((row) => {
          const item = items.find((item) => item.skuKey === row.rowKey)!;
          const { skuKey: _key, ...packaging } = item;
          return { ...row, packaging, attributes: { ...row.attributes,
            packaging: structuredClone((next.attributes.values.packaging as OzonListingDraftAttributeValue).skuValues![row.rowKey]!) } };
        });
        for (const key of ['packageWeightG', 'packageLengthMm', 'packageWidthMm', 'packageHeightMm']) delete next.attributes.values[key];
        const complexity = inspectSourceListingJsonValue(next.attributes.values, {
          maxBytes: SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_BYTES,
          maxNodes: SOURCE_LISTING_ATTRIBUTE_VALUES_MAX_NODES,
          maxDepth: SOURCE_LISTING_JSON_VALUE_MAX_DEPTH,
        });
        if (!complexity.valid) {
          throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID',
            sourceListingJsonLimitMessage(complexity, 'SKU packaging attribute values'), 400);
        }
        next.freshness.attributes = currentFreshness();
        next.freshness.content = stale('MANUAL_FACT_CONFIRMED');
        next.freshness.validation = stale('MANUAL_FACT_CONFIRMED');
        next.validation.status = 'STALE';
        next.grantRevocation = { required: true, reason: 'MANUAL_FACT_CONFIRMED', previousShopId: null };
        next.auditEvents.push(event(next.draftVersion, 'MANUAL_FACT_CONFIRMED', input.actorUserId, {
          attributeKey: 'packaging', action: 'PACKAGING', skuKeys: sourceListingEditorSkuKeysForDraft(draft), evidence,
        }));
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
          sourceListingEditorSkuKeysForDraft(draft),
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
      operationKey?: string;
      expectedDraftVersion?: number;
      value: Record<string, unknown> | null;
    }) {
      return idempotentEditorMutation(input, 'PRICING_CHANGED', input.value, (draft) => {
        const value = validateSourceListingPricing(input.value, sourceListingEditorSkuKeysForDraft(draft));
        const next = structuredClone(draft);
        next.draftVersion += 1;
        next.pricing.value = structuredClone(value);
        if (next.offerRows?.rows.length) {
          const offers = value.items.map((item) => item.offerId).filter((offerId) => offerId !== undefined);
          if (new Set(offers).size !== offers.length) throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'Offer IDs must be unique', 400);
          next.offerRows.rows = next.offerRows.rows.map((row) => {
            const pricing = value.items.find((item) => item.skuKey === row.rowKey)!;
            const offerId = pricing.offerId || row.offerId;
            pricing.offerId = offerId;
            return { ...row, offerId, pricing: { ...pricing, offerId } };
          });
          next.pricing.value = structuredClone(value);
        }
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
        if (next.media.videoBindings !== undefined) next.media.videoBindings = [];
        next.selectedSkuKeys = selectedSkuKeys;
        delete next.offerRows;
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
        if (next.media.videoBindings !== undefined) next.media.videoBindings = [];
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
      operationKey?: string;
      expectedDraftVersion?: number;
      selectedSkuKeys: string[];
    }) {
      const selectedSkuKeys = normalizedSkuKeys(input.selectedSkuKeys);
      return idempotentEditorMutation(input, 'SKU_SELECTION_CHANGED', { selectedSkuKeys }, (draft) => {
        const next = structuredClone(draft);
        next.draftVersion += 1;
        next.selectedSkuKeys = selectedSkuKeys;
        const offerRows = sourceListingOfferRowsForDraft(draft).filter((row) => selectedSkuKeys.includes(row.sourceSkuKey));
        if (offerRows.length) next.offerRows = { contractVersion: 'source-listing-offer-rows/v1', rows: offerRows };
        else delete next.offerRows;
        if (next.media.videoBindings !== undefined) next.media.videoBindings = [];
        for (const key of ['attributes', 'content', 'media', 'pricing', 'validation'] as const) {
          next.freshness[key] = stale('SKU_SELECTION_CHANGED');
        }
        next.validation.status = 'STALE';
        next.grantRevocation = { required: true, reason: 'SKU_SELECTION_CHANGED', previousShopId: null };
        next.auditEvents.push(event(next.draftVersion, 'SKU_SELECTION_CHANGED', input.actorUserId, { selectedSkuKeys }));
        return next;
      });
    },

    async duplicateSku(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      expectedDraftVersion: number; operationKey: string; sourceSkuKey: string;
    }): Promise<OzonListingDraft> {
      const sourceSkuKey = required(input.sourceSkuKey, 'sourceSkuKey');
      if (!Number.isSafeInteger(input.expectedDraftVersion) || input.expectedDraftVersion < 1
        || typeof input.operationKey !== 'string' || input.operationKey.length < 8) {
        throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'SKU duplication requires an operation key and draft version', 400);
      }
      return idempotentEditorMutation(input, 'SKU_DUPLICATED', { sourceSkuKey }, (draft) => {
        if (!draft.selectedSkuKeys.includes(sourceSkuKey)) {
          throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'Only an existing source SKU can be duplicated', 422);
        }
        const existing = sourceListingOfferRowsForDraft(draft);
        if (existing.length + draft.selectedSkuKeys.length >= 100) throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'Too many total listing rows', 400);
        const rowKey = deriveSourceListingSkuCopyKey(draft.id, input.operationKey);
        const offerId = `copy-${rowKey.slice('listing-copy:'.length, 'listing-copy:'.length + 40)}`;
        if (existing.some((row) => row.rowKey === rowKey || row.offerId === offerId)) {
          throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_VERSION_CONFLICT', 'SKU duplication identity already exists', 409);
        }
        const originalPricing = draft.pricing.value ? validateSourceListingPricing(draft.pricing.value, sourceListingEditorSkuKeysForDraft(draft)) : null;
        const sourcePrice = originalPricing?.items.find((item) => item.skuKey === sourceSkuKey);
        const pricing = sourcePrice ? { ...structuredClone(sourcePrice), skuKey: rowKey, offerId } : null;
        const measured = projectSourceListingSkuPackaging(draft)?.find((item) => item.skuKey === sourceSkuKey);
        const packaging = measured ? { weightG: measured.weightG, lengthMm: measured.lengthMm, widthMm: measured.widthMm, heightMm: measured.heightMm } : null;
        const attributes = Object.fromEntries(Object.entries(draft.attributes.values).flatMap(([key, value]) => {
          const leaf = value?.skuValues?.[sourceSkuKey];
          return leaf ? [[key, structuredClone(leaf)]] : [];
        }));
        const next = structuredClone(draft);
        next.draftVersion += 1;
        next.offerRows = { contractVersion: 'source-listing-offer-rows/v1', rows: [...existing, {
          rowKey, sourceSkuKey, offerId, sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
          sourceCaptureHash: draft.sourceCaptureHash, sourceDraftVersion: draft.draftVersion,
          sourceDraftRevision: draft.revision, pricing: structuredClone(pricing),
          packaging, attributes,
        }] };
        if (originalPricing && pricing) next.pricing.value = { ...originalPricing, items: [...originalPricing.items, pricing] };
        for (const value of Object.values(next.attributes.values)) {
          if (value.skuValues?.[sourceSkuKey]) value.skuValues[rowKey] = structuredClone(value.skuValues[sourceSkuKey]);
        }
        for (const key of ['media', 'pricing', 'validation', 'content'] as const) next.freshness[key] = stale('SKU_SELECTION_CHANGED');
        next.validation.status = 'STALE';
        next.grantRevocation = { required: true, reason: 'SKU_SELECTION_CHANGED', previousShopId: null };
        next.auditEvents.push(event(next.draftVersion, 'SKU_DUPLICATED', input.actorUserId, { sourceSkuKey, rowKey, offerId,
          sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId, sourceCaptureHash: draft.sourceCaptureHash,
          sourceDraftRevision: draft.revision, sourceDraftVersion: draft.draftVersion }));
        return next;
      });
    },

    async removeSkuCopy(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      expectedDraftVersion: number; operationKey: string; rowKey: string;
    }): Promise<OzonListingDraft> {
      const rowKey = required(input.rowKey, 'rowKey');
      if (!Number.isSafeInteger(input.expectedDraftVersion) || input.expectedDraftVersion < 1
        || typeof input.operationKey !== 'string' || input.operationKey.length < 8) {
        throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'SKU copy removal requires an operation key and draft version', 400);
      }
      return idempotentEditorMutation(input, 'SKU_DUPLICATED', { action: 'REMOVE', rowKey }, (draft) => {
        const rows = sourceListingOfferRowsForDraft(draft);
        const removed = rows.find((row) => row.rowKey === rowKey);
        if (!removed) throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_VERSION_CONFLICT', 'Copied SKU row was not found', 409);
        const next = structuredClone(draft);
        const currentRows = rows.filter((row) => row.rowKey !== rowKey);
        if (currentRows.length) next.offerRows = { contractVersion: 'source-listing-offer-rows/v1', rows: currentRows };
        else delete next.offerRows;
        if (next.pricing.value && typeof next.pricing.value === 'object' && !Array.isArray(next.pricing.value)) {
          const items = (next.pricing.value as any).items?.filter((item: any) => item?.skuKey !== rowKey) || [];
          next.pricing.value = { ...(next.pricing.value as any), items };
        }
        for (const value of Object.values(next.attributes.values)) {
          if (value.skuValues) delete value.skuValues[rowKey];
        }
        next.media.assignments = next.media.assignments.filter((assignment) => assignment.skuKey !== rowKey);
        if (next.media.videoBindings) next.media.videoBindings = next.media.videoBindings.filter((binding) => binding.skuKey !== rowKey);
        next.draftVersion += 1;
        for (const key of ['media', 'pricing', 'validation', 'content'] as const) next.freshness[key] = stale('SKU_SELECTION_CHANGED');
        next.validation.status = 'STALE';
        next.grantRevocation = { required: true, reason: 'SKU_SELECTION_CHANGED', previousShopId: null };
        next.auditEvents.push(event(next.draftVersion, 'SKU_DUPLICATED', input.actorUserId, { action: 'REMOVE', rowKey }));
        return next;
      });
    },

    async addAiCopyCandidate(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      titleRu?: string | null; descriptionRu?: string | null; sourcePromptVersion: string;
      kind?: 'MANUAL' | 'AI_GENERATED';
      generation?: OzonListingAiCopyGenerationProvenance;
      operationKey?: string;
      expectedDraftVersion?: number;
    }): Promise<{ draft: OzonListingDraft; candidate: OzonListingAiCopyCandidate }> {
      if ((input.kind === 'AI_GENERATED') !== Boolean(input.generation)) {
        throw new SourceListingWorkflowError(
          'OZON_LISTING_DRAFT_INPUT_INVALID',
          'AI-generated candidates require frozen generation provenance',
          400,
        );
      }
      const manualReceipt = input.operationKey !== undefined;
      if (manualReceipt && (input.generation || input.kind === 'AI_GENERATED'
        || !Number.isSafeInteger(input.expectedDraftVersion) || Number(input.expectedDraftVersion) < 1)) {
        throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'Manual copy receipts require a manual candidate and exact draft version', 400);
      }
      const manual = manualReceipt ? normalizeSourceListingManualCopy({
        ...(Object.prototype.hasOwnProperty.call(input, 'titleRu') ? { titleRu: input.titleRu } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, 'descriptionRu') ? { descriptionRu: input.descriptionRu } : {}),
      }) : null;
      const fields = manual?.fields || input.generation?.fields || [
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
      const source = manualReceipt ? await getDraft(input) : null;
      const request = manualReceipt ? {
        titleRu: Object.prototype.hasOwnProperty.call(input, 'titleRu') ? input.titleRu : undefined,
        descriptionRu: Object.prototype.hasOwnProperty.call(input, 'descriptionRu') ? input.descriptionRu : undefined,
        fields, sourceCaptureSnapshotId: source!.sourceCaptureSnapshotId, sourceCaptureHash: source!.sourceCaptureHash,
        shopId: source!.shopId, supplyGoodsId: source!.supplyGoodsId, selectedSkuKeys: source!.selectedSkuKeys,
      } : null;
      const update = (draft: OzonListingDraft) => {
        const next = structuredClone(draft);
        if (manualReceipt) next.draftVersion += 1;
        if (next.copy.candidates.length >= SOURCE_LISTING_AI_COPY_CANDIDATE_MAX_ITEMS) {
          throw new SourceListingWorkflowError(
            'OZON_LISTING_DRAFT_INPUT_INVALID',
            `AI copy candidates cannot exceed ${SOURCE_LISTING_AI_COPY_CANDIDATE_MAX_ITEMS} items`,
            400,
          );
        }
        const candidate: OzonListingAiCopyCandidate = {
          id: candidateId,
          kind: manualReceipt ? 'MANUAL' : input.kind || (input.generation ? 'AI_GENERATED' : 'MANUAL'),
          fields: [...fields],
          titleRu: manual ? manual.titleRu ?? null : input.titleRu ?? null,
          descriptionRu: manual ? manual.descriptionRu ?? null : input.descriptionRu ?? null,
          sourcePromptVersion: manualReceipt ? SOURCE_LISTING_MANUAL_COPY_PROMPT_VERSION : required(input.sourcePromptVersion, 'sourcePromptVersion'),
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
      };
      const persist = () => manualReceipt
        ? idempotentEditorMutation(input, 'AI_COPY_CANDIDATE_CREATED', request, update)
        : mutate(input, update);
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
      const acceptedId = manualReceipt ? updated.auditEvents.find((entry) => entry.details.editorOperationKey === input.operationKey)?.details.candidateId : candidateId;
      const candidate = updated.copy.candidates.find((value) => value.id === acceptedId);
      if (!candidate) throw new SourceListingWorkflowError('OZON_LISTING_AI_CANDIDATE_NOT_FOUND', 'Accepted manual copy candidate was not found', 404);
      return { draft: updated, candidate };
    },

    async applyAiCopyCandidate(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      candidateId: string; operationKey: string;
      expectedDraftVersion?: number;
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
      if (input.expectedDraftVersion !== undefined && current.draftVersion !== input.expectedDraftVersion) {
        throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_VERSION_CONFLICT', 'Copy approval draft version changed', 409);
      }
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
      const validation = normalizedValidation(input);
      return mutate(input, (draft) => recordedValidation(draft, validation, input.actorUserId));
    },

    async validateForEditor(input: {
      draftId: string; ownerUserId: string; actorUserId: string; expectedRevision: number;
      expectedDraftVersion: number; operationKey: string; schemaRevision: string;
    }, prepareValidation: (draft: OzonListingDraft) => Promise<SourceListingAttributeValidationInput>): Promise<OzonListingDraft> {
      if (!Number.isSafeInteger(input.expectedDraftVersion) || input.expectedDraftVersion < 1
        || typeof input.operationKey !== 'string' || typeof input.schemaRevision !== 'string'
        || !/^[a-f0-9]{64}$/u.test(input.schemaRevision) || typeof prepareValidation !== 'function') {
        throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_INPUT_INVALID', 'Editor validation requires a schema, operation key and exact draft version', 400);
      }
      const source = await getDraft(input);
      const request = { schemaRevision: input.schemaRevision, sourceCaptureSnapshotId: source.sourceCaptureSnapshotId,
        sourceCaptureHash: source.sourceCaptureHash, shopId: source.shopId, supplyGoodsId: source.supplyGoodsId,
        selectedSkuKeys: source.selectedSkuKeys };
      return idempotentEditorMutation(input, 'VALIDATION_RECORDED', request, async (draft) => {
        const validation = normalizedValidation(await prepareValidation(draft));
        if (validation.report.schemaRevision !== input.schemaRevision) {
          throw new SourceListingWorkflowError('OZON_LISTING_DRAFT_VERSION_CONFLICT', 'Prepared validation uses another official schema', 409);
        }
        return recordedValidation(draft, validation, input.actorUserId);
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

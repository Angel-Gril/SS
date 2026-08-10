import { readFileSync } from 'node:fs';
import type { OzonListingDraft, SourceProductCaptureV2Submission } from 'shared';
import { describe, expect, it, vi } from 'vitest';
import {
  buildSourceCaptureCommandEnvelope,
  createSourceCaptureService,
  type PreparedNativeSourceCapture,
  type SourceCaptureRepository,
} from '../services/source-capture.js';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import {
  createOzonListingPublisher,
  type CompiledOzonListingPublishRequest,
} from '../services/ozon-listing-publisher.js';
import {
  OzonPublishAttemptError,
  cloneOzonPublishJson,
  cloneOzonPublishObject,
  hashOzonPublishJson,
  type OzonPublishAttemptListPage,
  type OzonPublishAttemptRecord,
  type OzonPublishAttemptRepository,
  type OzonPublishAttemptSource,
  type OzonPublishAttemptSummary,
  type OzonPublishJson,
  type OzonPublishReconciliationLeaseClaim,
  type OzonReconciliationOutcome,
  type OzonSubmissionOutcome,
  type OzonUnknownResolution,
  type PrepareOzonPublishAttemptInput,
} from '../services/ozon-publish-attempts.js';
import {
  createSourceListingWorkflowService,
  hashOzonListingPublishState,
} from '../services/source-listing-workflow.js';
import { validateSourceListingPricing } from '../services/source-listing-workflow-readiness.js';

const fixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

const NOW = '2026-07-15T12:00:00.000Z';

function cloneAttempt(value: OzonPublishAttemptRecord): OzonPublishAttemptRecord {
  return structuredClone(value);
}

function attemptSummary(value: OzonPublishAttemptRecord): OzonPublishAttemptSummary {
  return {
    id: value.id,
    workflowId: value.workflowId,
    shopId: value.shopId,
    draftVersion: value.draftVersion,
    revision: value.revision,
    catalogSnapshotHash: value.catalogSnapshotHash,
    attributeSchemaHash: value.attributeSchemaHash,
    publisherContractVersion: value.publisherContractVersion,
    endpoint: value.endpoint,
    draftPayloadHash: value.draftPayloadHash,
    draftStateHash: value.draftStateHash,
    requestPayloadHash: value.requestPayloadHash,
    itemCount: value.itemCount,
    state: value.state,
    reconciliationState: value.reconciliationState,
    stateVersion: value.stateVersion,
    ozonTaskId: value.ozonTaskId,
    acceptanceSource: value.acceptanceSource,
    responseHash: value.responseHash,
    itemResults: structuredClone(value.itemResults),
    itemResultCount: value.itemResults?.length || 0,
    itemResultsTruncated: false,
    itemErrors: structuredClone(value.itemErrors),
    itemErrorCount: value.itemErrors.length,
    itemErrorsTruncated: false,
    lastErrorCode: value.lastErrorCode,
    lastErrorMessage: value.lastErrorMessage,
    submitStartedAt: value.submitStartedAt,
    submittedAt: value.submittedAt,
    unknownAt: value.unknownAt,
    rejectedAt: value.rejectedAt,
    nextReconcileAt: value.nextReconcileAt,
    reconcileAttemptCount: value.reconcileAttemptCount,
    lastReconciledAt: value.lastReconciledAt,
    completedAt: value.completedAt,
    resolutionEvidenceHash: value.resolutionEvidenceHash,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

class BoundedInMemoryAttemptRepository implements OzonPublishAttemptRepository {
  private readonly attempts = new Map<string, OzonPublishAttemptRecord>();
  private readonly attemptByIntent = new Map<string, string>();
  private readonly sources = new Map<string, OzonPublishAttemptSource>();
  private readonly preparationSignatures = new Map<string, string>();
  private pendingDraft: OzonListingDraft | null = null;
  private sequence = 0;
  readonly maximumAttempts = 4;
  lastPrepareInput: PrepareOzonPublishAttemptInput | null = null;

  bindFrozenDraft(draft: OzonListingDraft) {
    this.pendingDraft = structuredClone(draft);
  }

  private signature(input: PrepareOzonPublishAttemptInput): string {
    return hashOzonPublishJson(cloneOzonPublishObject({
      publishIntentId: input.publishIntentId,
      ownerUserId: input.ownerUserId,
      catalogSnapshotId: input.catalogSnapshotId,
      catalogRevision: input.catalogRevision,
      catalogSnapshotHash: input.catalogSnapshotHash,
      attributeSchemaHash: input.attributeSchemaHash,
      publisherContractVersion: input.publisherContractVersion,
      endpoint: input.endpoint || '/v3/product/import',
      requestPayloadHash: input.requestPayloadHash,
      offerTrace: input.offerTrace,
    }, 'attempt preparation signature', 256 * 1024));
  }

  async loadExactIntent(input: {
    publishIntentId: string;
    ownerUserId: string;
  }): Promise<OzonPublishAttemptSource | null> {
    const source = this.sources.get(input.publishIntentId);
    return source?.ownerUserId === input.ownerUserId ? structuredClone(source) : null;
  }

  async prepare(input: PrepareOzonPublishAttemptInput) {
    this.lastPrepareInput = structuredClone(input);
    const existingId = this.attemptByIntent.get(input.publishIntentId);
    if (existingId) {
      if (this.preparationSignatures.get(input.publishIntentId) !== this.signature(input)) {
        throw new OzonPublishAttemptError(
          'IDEMPOTENCY_CONFLICT',
          'The immutable Ozon request changed for an existing publish intent',
        );
      }
      return { attempt: cloneAttempt(this.attempts.get(existingId)!), idempotent: true };
    }
    if (this.attempts.size >= this.maximumAttempts) {
      throw new OzonPublishAttemptError('INVALID_INPUT', 'In-memory attempt capacity exceeded');
    }
    const draft = this.pendingDraft;
    if (!draft || draft.ownerUserId !== input.ownerUserId) {
      throw new OzonPublishAttemptError('NOT_FOUND', 'Frozen publish intent was not bound');
    }
    const requestPayload = cloneOzonPublishObject(
      input.requestPayload,
      'Ozon request payload',
      8 * 1024 * 1024,
    );
    const catalogSnapshot = cloneOzonPublishObject(
      input.catalogSnapshot,
      'catalog snapshot',
      2 * 1024 * 1024,
    );
    const attributeSchemaSnapshot = cloneOzonPublishObject(
      input.attributeSchemaSnapshot,
      'attribute schema snapshot',
      2 * 1024 * 1024,
    );
    if (hashOzonPublishJson(requestPayload) !== input.requestPayloadHash
      || hashOzonPublishJson(catalogSnapshot) !== input.catalogSnapshotHash
      || hashOzonPublishJson(attributeSchemaSnapshot) !== input.attributeSchemaHash) {
      throw new OzonPublishAttemptError('INVALID_INPUT', 'Frozen publish hash does not match its payload');
    }
    const publishEvent = [...draft.auditEvents].reverse().find((event) => (
      event.type === 'PUBLISH_INTENT_RECORDED'
    ));
    const idempotencyKey = String(publishEvent?.details.idempotencyKey || '');
    const draftPayload = cloneOzonPublishObject(draft, 'frozen draft', 8 * 1024 * 1024);
    const draftStateHash = hashOzonListingPublishState(draft);
    const draftPayloadHash = hashOzonPublishJson(draftPayload);
    const id = `attempt-${++this.sequence}`;
    const record: OzonPublishAttemptRecord = {
      id,
      publishIntentId: input.publishIntentId,
      workflowId: draft.id,
      ownerUserId: draft.ownerUserId,
      shopId: draft.shopId,
      draftVersion: draft.draftVersion,
      revision: draft.revision,
      sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
      actorUserId: publishEvent?.actorUserId || draft.ownerUserId,
      idempotencyKey,
      catalogSnapshotId: input.catalogSnapshotId,
      catalogRevision: input.catalogRevision,
      catalogSnapshot,
      catalogSnapshotHash: input.catalogSnapshotHash,
      attributeSchemaSnapshot,
      attributeSchemaHash: input.attributeSchemaHash,
      publisherContractVersion: input.publisherContractVersion,
      endpoint: input.endpoint || '/v3/product/import',
      draftPayloadHash,
      draftStateHash,
      requestPayload,
      requestPayloadHash: input.requestPayloadHash,
      offerTrace: structuredClone(input.offerTrace),
      itemCount: Array.isArray(requestPayload.items) ? requestPayload.items.length : 0,
      state: 'PREPARED',
      reconciliationState: 'NOT_REQUIRED',
      stateVersion: 1,
      ozonTaskId: null,
      acceptanceSource: null,
      response: null,
      responseHash: null,
      itemResults: null,
      itemErrors: [],
      lastErrorCode: null,
      lastErrorMessage: null,
      leasePurpose: null,
      leaseToken: null,
      leaseOwner: null,
      leaseEpoch: 0,
      heartbeatAt: null,
      leaseExpiresAt: null,
      submitStartedAt: null,
      submittedAt: null,
      unknownAt: null,
      rejectedAt: null,
      nextReconcileAt: null,
      reconcileAttemptCount: 0,
      lastReconciledAt: null,
      completedAt: null,
      resolvedByUserId: null,
      resolutionNote: null,
      resolutionEvidence: null,
      resolutionEvidenceHash: null,
      createdAt: NOW,
      updatedAt: NOW,
    };
    const source: OzonPublishAttemptSource = {
      publishIntentId: input.publishIntentId,
      workflowId: draft.id,
      ownerUserId: draft.ownerUserId,
      shopId: draft.shopId,
      draftVersion: draft.draftVersion,
      revision: draft.revision,
      sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId,
      actorUserId: record.actorUserId,
      idempotencyKey,
      draftStateHash,
      draftPayloadHash,
      draftPayload,
      currentRevision: draft.revision,
      currentDraftVersion: draft.draftVersion,
      currentShopId: draft.shopId,
      currentStage: draft.stage,
      currentStatus: draft.validation.status,
    };
    this.attempts.set(id, cloneAttempt(record));
    this.attemptByIntent.set(input.publishIntentId, id);
    this.sources.set(input.publishIntentId, structuredClone(source));
    this.preparationSignatures.set(input.publishIntentId, this.signature(input));
    this.pendingDraft = null;
    return { attempt: cloneAttempt(record), idempotent: false };
  }

  async getOwned(input: { attemptId: string; ownerUserId: string }) {
    const attempt = this.attempts.get(input.attemptId);
    return attempt?.ownerUserId === input.ownerUserId ? cloneAttempt(attempt) : null;
  }

  async getByPublishIntent(input: { publishIntentId: string; ownerUserId: string }) {
    const id = this.attemptByIntent.get(input.publishIntentId);
    return id ? this.getOwned({ attemptId: id, ownerUserId: input.ownerUserId }) : null;
  }

  async listOwnedByWorkflow(input: {
    workflowId: string;
    ownerUserId: string;
    limit?: unknown;
    cursor?: string | null;
  }): Promise<OzonPublishAttemptListPage> {
    if (input.cursor) return { items: [], nextCursor: null };
    const requested = Number.isSafeInteger(input.limit) ? Number(input.limit) : 20;
    const limit = Math.max(1, Math.min(this.maximumAttempts, requested));
    const items = [...this.attempts.values()]
      .filter((attempt) => (
        attempt.workflowId === input.workflowId && attempt.ownerUserId === input.ownerUserId
      ))
      .slice(-limit)
      .reverse()
      .map(attemptSummary);
    return { items, nextCursor: null };
  }

  async getLatestOwnedByWorkflow(input: {
    workflowId: string;
    ownerUserId: string;
  }): Promise<OzonPublishAttemptSummary | null> {
    const page = await this.listOwnedByWorkflow({ ...input, limit: 1 });
    return page.items[0] || null;
  }

  async claimSubmission(
    input: Parameters<OzonPublishAttemptRepository['claimSubmission']>[0],
  ) {
    const current = this.attempts.get(input.attemptId);
    if (!current || current.state !== 'PREPARED') return null;
    const claimed = cloneAttempt(current);
    claimed.state = 'SUBMITTING';
    claimed.stateVersion += 1;
    claimed.leasePurpose = 'SUBMIT';
    claimed.leaseOwner = input.workerId;
    claimed.leaseToken = `lease-${claimed.id}`;
    claimed.leaseEpoch += 1;
    claimed.heartbeatAt = NOW;
    claimed.leaseExpiresAt = new Date(Date.parse(NOW) + input.leaseMs).toISOString();
    claimed.submitStartedAt = NOW;
    claimed.updatedAt = NOW;
    this.attempts.set(claimed.id, cloneAttempt(claimed));
    return {
      attempt: cloneAttempt(claimed),
      leaseToken: claimed.leaseToken,
      leaseEpoch: claimed.leaseEpoch,
    };
  }

  async heartbeat(input: {
    attemptId: string;
    workerId: string;
    leaseToken: string;
    leaseEpoch: number;
    leaseMs: number;
  }) {
    const current = this.attempts.get(input.attemptId);
    return Boolean(current
      && current.state === 'SUBMITTING'
      && current.leaseOwner === input.workerId
      && current.leaseToken === input.leaseToken
      && current.leaseEpoch === input.leaseEpoch);
  }

  async completeSubmission(input: {
    attemptId: string;
    workerId: string;
    leaseToken: string;
    leaseEpoch: number;
    outcome: OzonSubmissionOutcome;
  }) {
    const current = this.attempts.get(input.attemptId);
    if (!current
      || current.state !== 'SUBMITTING'
      || current.leaseOwner !== input.workerId
      || current.leaseToken !== input.leaseToken
      || current.leaseEpoch !== input.leaseEpoch) {
      throw new OzonPublishAttemptError('LEASE_LOST', 'Submission lease was lost');
    }
    const next = cloneAttempt(current);
    next.state = input.outcome.kind;
    next.stateVersion += 1;
    next.leasePurpose = null;
    next.leaseToken = null;
    next.leaseOwner = null;
    next.heartbeatAt = null;
    next.leaseExpiresAt = null;
    next.response = input.outcome.response === undefined
      ? null
      : cloneOzonPublishJson(input.outcome.response, 'submission response', 512 * 1024);
    next.responseHash = next.response === null ? null : hashOzonPublishJson(next.response);
    next.updatedAt = NOW;
    if (input.outcome.kind === 'SUBMITTED') {
      next.ozonTaskId = input.outcome.taskId;
      next.acceptanceSource = input.outcome.acceptanceSource || 'OZON_TASK_RESPONSE';
      next.reconciliationState = 'PENDING';
      next.submittedAt = NOW;
      next.nextReconcileAt = NOW;
    } else {
      next.lastErrorCode = input.outcome.errorCode;
      next.lastErrorMessage = input.outcome.errorMessage;
      if (input.outcome.kind === 'UNKNOWN') next.unknownAt = NOW;
      else {
        next.rejectedAt = NOW;
        next.completedAt = NOW;
      }
    }
    this.attempts.set(next.id, cloneAttempt(next));
    return cloneAttempt(next);
  }

  async recoverSubmissionAcknowledgement(): Promise<OzonPublishAttemptRecord> {
    throw new OzonPublishAttemptError('LEASE_LOST', 'Recovery is not used by this bounded test repository');
  }

  async markStaleSubmissionsUnknown(): Promise<string[]> {
    return [];
  }

  async claimReconciliation(): Promise<OzonPublishReconciliationLeaseClaim[]> {
    return [];
  }

  async completeReconciliation(_input: {
    attemptId: string;
    workerId: string;
    leaseToken: string;
    leaseEpoch: number;
    outcome: OzonReconciliationOutcome;
  }): Promise<OzonPublishAttemptRecord> {
    throw new OzonPublishAttemptError('INVALID_TRANSITION', 'Reconciliation is outside this test');
  }

  async attachLateAcknowledgement(): Promise<OzonPublishAttemptRecord> {
    throw new OzonPublishAttemptError('INVALID_TRANSITION', 'Late acknowledgement is outside this test');
  }

  async resolveUnknown(_input: {
    attemptId: string;
    ownerUserId: string;
    actorUserId: string;
    expectedStateVersion: number;
    resolution: OzonUnknownResolution;
  }): Promise<OzonPublishAttemptRecord> {
    throw new OzonPublishAttemptError('INVALID_TRANSITION', 'Manual resolution is outside this test');
  }
}

function captureRepository() {
  let persisted: PreparedNativeSourceCapture | null = null;
  const repository: SourceCaptureRepository = {
    ingestNative: async (input) => {
      persisted = structuredClone(input);
      return {
        kind: 'created',
        subjectId: 'source-subject-1',
        snapshotId: 'source-snapshot-1',
        snapshotVersion: 1,
        supplyGoodsId: 'supply-goods-1',
        captureHash: input.captureHash,
      };
    },
    ingestLegacy: async () => { throw new Error('legacy capture must not run'); },
    loadLegacyProjection: async () => null,
    ensureLegacyProjection: async () => { throw new Error('legacy projection must not run'); },
  };
  return { repository, getPersisted: () => persisted };
}

function createCompiler(input: {
  attempts: BoundedInMemoryAttemptRepository;
  captureHash: string;
  snapshotId: string;
}) {
  return vi.fn(async ({
    ownerUserId,
    draft,
  }: {
    ownerUserId: string;
    draft: OzonListingDraft;
  }): Promise<CompiledOzonListingPublishRequest> => {
    expect(ownerUserId).toBe('owner-1');
    expect(draft).toMatchObject({
      ownerUserId,
      sourceCaptureSnapshotId: input.snapshotId,
      sourceCaptureHash: input.captureHash,
      selectedSkuKeys: ['sku-0'],
      stage: 'PUBLISH_INTENT_RECORDED',
      category: { categoryId: 17028922, typeId: 96349, catalogRevision: 'catalog-r42' },
    });
    const pricing = validateSourceListingPricing(draft.pricing.value, draft.selectedSkuKeys);
    const productMedia = draft.media.assignments.find((assignment) => assignment.scope === 'PRODUCT');
    if (!draft.category || !productMedia) throw new Error('Ready draft lost category or product media');
    const items = pricing.items.map((row) => ({
      offer_id: row.offerId,
      name: draft.copy.publishTitleRu,
      description_category_id: draft.category!.categoryId,
      type_id: draft.category!.typeId,
      price: row.price,
      old_price: row.oldPrice,
      currency_code: row.currencyCode,
      vat: row.vat,
      images: [productMedia.assetId],
      attributes: Object.entries(draft.attributes.values).map(([key, value]) => ({
        id: Number(key),
        values: [{ value: value.value }],
      })),
    }));
    const requestPayload = cloneOzonPublishObject({ items }, 'compiled request', 1024 * 1024);
    const catalogSnapshot = cloneOzonPublishObject({
      snapshotId: 'catalog-snapshot-r42',
      category: draft.category,
    }, 'catalog snapshot', 64 * 1024);
    const attributeSchemaSnapshot = cloneOzonPublishObject({
      schemaRevision: 'attribute-schema-r9',
      fields: [{ attributeId: 10, required: true, valuePolicy: 'FREE_TEXT' }],
    }, 'attribute schema snapshot', 64 * 1024);
    input.attempts.bindFrozenDraft(draft);
    return {
      publisherContractVersion: 'ozon-listing-publisher/v1',
      endpoint: '/v3/product/import',
      draftStateHash: hashOzonListingPublishState(draft),
      catalogSnapshotId: 'catalog-snapshot-r42',
      catalogRevision: draft.category.catalogRevision,
      catalogSnapshot,
      catalogSnapshotHash: hashOzonPublishJson(catalogSnapshot),
      attributeSchemaSnapshot,
      attributeSchemaHash: hashOzonPublishJson(attributeSchemaSnapshot),
      requestPayload,
      requestPayloadHash: hashOzonPublishJson(requestPayload),
      offerTrace: pricing.items.map((row, ordinal) => ({
        ordinal,
        offerId: row.offerId!,
        skuKey: row.skuKey,
      })),
    };
  });
}

describe('1688 Capture V2 to immutable Ozon publish attempt minimum closure', () => {
  it('closes one exact owner-bound snapshot without a network or real Ozon write', async () => {
    const captureStore = captureRepository();
    const capture = createSourceCaptureService({ repository: captureStore.repository });
    const captured = await capture.ingest({
      trusted: {
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        deviceSessionId: 'device-session-1',
        tokenId: 'command-token-1',
        rolloutRevision: 'unit6b-pilot-1',
        rolloutStage: 'v2_only',
        ingestChannel: 'EXTENSION_DEVICE',
      },
      submission: fixture,
      grant: {
        token: 'g'.repeat(43),
        idempotencyKey: 'unit6b-capture-command-1',
        requestHash: buildSourceCaptureCommandEnvelope(fixture).requestHash,
      },
    });
    const persistedCapture = captureStore.getPersisted();
    expect(persistedCapture).not.toBeNull();
    expect(persistedCapture!.capture.skus.map((sku) => sku.key)).toEqual(['sku-0']);
    expect(persistedCapture!.capture.media[0]).toMatchObject({
      key: 'media-main-0',
      role: 'product_main',
      skuKeys: [],
    });

    let idSequence = 0;
    const workflowRepository = new InMemoryOzonListingDraftRepository();
    const workflow = createSourceListingWorkflowService({
      repository: workflowRepository,
      now: () => new Date(NOW),
      idFactory: (prefix) => `${prefix}-${++idSequence}`,
    });
    const created = await workflow.createDraft({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      shopId: 'ozon-pilot-shop-1',
      supplyGoodsId: captured.supplyGoodsId,
      sourceCaptureSnapshotId: captured.snapshotId,
      sourceCaptureHash: captured.captureHash,
      selectedSkuKeys: persistedCapture!.capture.skus.map((sku) => sku.key),
    });
    await expect(workflow.createDraft({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      shopId: created.shopId,
      supplyGoodsId: captured.supplyGoodsId,
      sourceCaptureSnapshotId: captured.snapshotId,
      sourceCaptureHash: captured.captureHash,
      selectedSkuKeys: ['sku-0'],
    })).resolves.toMatchObject({ id: created.id, revision: created.revision });

    const categorized = await workflow.setCategory({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: created.revision,
      category: {
        categoryId: 17028922,
        typeId: 96349,
        catalogRevision: 'catalog-r42',
        categoryName: 'Футболки',
      },
    });
    await expect(workflow.setCategory({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: created.revision,
      category: categorized.category!,
    })).rejects.toMatchObject({
      code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT',
      statusCode: 409,
    });

    const attributed = await workflow.setAttributeValues({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: categorized.revision,
      values: {
        '10': {
          value: 'Хлопок',
          source: 'MANUAL',
          reviewed: true,
          evidence: [`capture:${captured.snapshotId}:facts.title`],
          confidence: 1,
          dictionaryMatch: { status: 'NOT_APPLICABLE', dictionaryValueId: null },
          manualReview: 'CONFIRMED',
        },
      },
      operation: 'MANUAL_EDIT',
      changeAudit: [{
        attributeId: 10,
        action: 'SET',
        evidence: [`capture:${captured.snapshotId}:facts.title`],
      }],
    });
    const candidate = await workflow.addAiCopyCandidate({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: attributed.revision,
      titleRu: 'Хлопковая футболка унисекс',
      descriptionRu: 'Проверенное описание товара на русском языке.',
      sourcePromptVersion: 'listing-copy-r3',
    });
    const copied = await workflow.applyAiCopyCandidate({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: candidate.draft.revision,
      candidateId: candidate.candidate.id,
      operationKey: 'unit6b-apply-copy-1',
    });
    const mediaAssetId = `source:${captured.snapshotId}:media-main-0`;
    const withMedia = await workflow.setMediaAssignments({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: copied.revision,
      assignments: [{
        scope: 'PRODUCT',
        slotKey: 'product-main',
        assetId: mediaAssetId,
        source: 'SOURCE',
      }],
    });
    await expect(workflow.setPricing({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: withMedia.revision,
      value: {
        contractVersion: 'ozon-listing-pricing/v1',
        items: [{
          skuKey: 'another-sku',
          price: '1290',
          oldPrice: '1490',
          currencyCode: 'RUB',
          vat: '0',
        }],
      },
    })).rejects.toMatchObject({ code: 'OZON_LISTING_PRICING_INVALID', statusCode: 400 });
    const priced = await workflow.setPricing({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: withMedia.revision,
      value: {
        contractVersion: 'ozon-listing-pricing/v1',
        items: [{
          skuKey: 'sku-0',
          offerId: 'ssp-unit6b-sku-0',
          price: '1290',
          oldPrice: '1490',
          currencyCode: 'RUB',
          vat: '0',
        }],
      },
    });
    const ready = await workflow.recordValidationResult({
      draftId: created.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: priced.revision,
      status: 'VALID',
      report: {
        schemaVersion: 'ozon-attribute-validation/v1',
        schemaRevision: 'attribute-schema-r9',
        operationReadiness: {
          ozonImport: { status: 'READY', issues: [] },
          inventoryActivation: { status: 'BLOCKED', issues: [{ code: 'STOCK_ZERO' }] },
        },
      },
      blockers: [],
      warnings: [{
        code: 'SOURCE_STOCK_ZERO',
        message: 'Source SKU stock was observed as zero; import remains allowed without activation.',
        fieldPath: 'skus.sku-0.stock',
      }],
    });
    expect(ready).toMatchObject({
      stage: 'READY_TO_PUBLISH',
      validation: {
        status: 'VALID',
        report: { operationReadiness: { ozonImport: { status: 'READY', issues: [] } } },
      },
      sourceCaptureSnapshotId: captured.snapshotId,
      sourceCaptureHash: captured.captureHash,
      selectedSkuKeys: ['sku-0'],
    });
    await expect(workflow.getDraft({ draftId: ready.id, ownerUserId: 'owner-2' }))
      .rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_NOT_FOUND', statusCode: 404 });

    const attempts = new BoundedInMemoryAttemptRepository();
    const compile = createCompiler({
      attempts,
      captureHash: captured.captureHash,
      snapshotId: captured.snapshotId,
    });
    const submittedPayloads: Array<Record<string, OzonPublishJson>> = [];
    const submitImportOnce = vi.fn(async (input: {
      requestPayload: Record<string, OzonPublishJson>;
    }) => {
      submittedPayloads.push(structuredClone(input.requestPayload));
      const rows = input.requestPayload.items;
      if (Array.isArray(rows) && rows[0] && typeof rows[0] === 'object' && !Array.isArray(rows[0])) {
        rows[0].price = 'mutated-only-inside-submit-stub';
      }
      return { result: { task_id: 880001 } };
    });
    const publisher = createOzonListingPublisher({
      workflow,
      attempts,
      compile,
      submitImportOnce,
      authorizeDraftMediaPublish: async () => ({ byokAssetIds: [], policyRevision: null }),
      workerId: 'unit6b-api-1',
      leaseMs: 60_000,
    });
    const publishInput = {
      draftId: ready.id,
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedRevision: ready.revision,
      idempotencyKey: 'unit6b-publish-attempt-1',
    };
    await expect(publisher.publish({
      ...publishInput,
      expectedRevision: ready.revision - 1,
      idempotencyKey: 'unit6b-stale-publish-1',
    })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT', statusCode: 409 });
    expect(compile).not.toHaveBeenCalled();
    expect(submitImportOnce).not.toHaveBeenCalled();

    const submitted = await publisher.publish(publishInput);
    expect(submitted).toMatchObject({
      workflowId: ready.id,
      ownerUserId: 'owner-1',
      shopId: 'ozon-pilot-shop-1',
      sourceCaptureSnapshotId: captured.snapshotId,
      state: 'SUBMITTED',
      reconciliationState: 'PENDING',
      ozonTaskId: '880001',
      requestPayloadHash: hashOzonPublishJson(submittedPayloads[0]!),
      offerTrace: [{ ordinal: 0, offerId: 'ssp-unit6b-sku-0', skuKey: 'sku-0' }],
    });
    const frozenSource = await attempts.loadExactIntent({
      publishIntentId: submitted.publishIntentId,
      ownerUserId: 'owner-1',
    });
    expect(frozenSource).toMatchObject({
      workflowId: ready.id,
      ownerUserId: 'owner-1',
      sourceCaptureSnapshotId: captured.snapshotId,
      draftStateHash: submitted.draftStateHash,
      draftPayloadHash: submitted.draftPayloadHash,
      draftPayload: {
        supplyGoodsId: captured.supplyGoodsId,
        sourceCaptureSnapshotId: captured.snapshotId,
        sourceCaptureHash: captured.captureHash,
        selectedSkuKeys: ['sku-0'],
        stage: 'PUBLISH_INTENT_RECORDED',
      },
    });
    expect(hashOzonPublishJson(frozenSource!.draftPayload)).toBe(submitted.draftPayloadHash);
    expect(submitted.requestPayload).toMatchObject({
      items: [{
        offer_id: 'ssp-unit6b-sku-0',
        description_category_id: 17028922,
        type_id: 96349,
        price: '1290',
        old_price: '1490',
        currency_code: 'RUB',
        images: [mediaAssetId],
        attributes: [{ id: 10, values: [{ value: 'Хлопок' }] }],
      }],
    });
    expect(submittedPayloads).toHaveLength(1);
    expect(compile).toHaveBeenCalledTimes(1);
    expect(submitImportOnce).toHaveBeenCalledTimes(1);

    const originalPreparation = attempts.lastPrepareInput!;
    const changedRequest = cloneOzonPublishObject(
      originalPreparation.requestPayload,
      'changed replay request',
      1024 * 1024,
    );
    (changedRequest.items as Array<Record<string, OzonPublishJson>>)[0]!.price = '1300';
    await expect(attempts.prepare({
      ...originalPreparation,
      requestPayload: changedRequest,
      requestPayloadHash: hashOzonPublishJson(changedRequest),
    })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
    await expect(attempts.getOwned({ attemptId: submitted.id, ownerUserId: 'owner-2' }))
      .resolves.toBeNull();

    const reloadCompile = vi.fn(async (): Promise<CompiledOzonListingPublishRequest> => {
      throw new Error('reload must recover the persisted attempt without recompiling');
    });
    const reloadSubmit = vi.fn(async () => {
      throw new Error('reload must never resubmit an acknowledged attempt');
    });
    const reloadedPublisher = createOzonListingPublisher({
      workflow,
      attempts,
      compile: reloadCompile,
      submitImportOnce: reloadSubmit,
      authorizeDraftMediaPublish: async () => ({ byokAssetIds: [], policyRevision: null }),
      workerId: 'unit6b-api-2',
      leaseMs: 60_000,
    });
    await expect(reloadedPublisher.getLatestAttempt({
      workflowId: ready.id,
      ownerUserId: 'owner-1',
    })).resolves.toMatchObject({
      id: submitted.id,
      state: 'SUBMITTED',
      ozonTaskId: '880001',
      requestPayloadHash: submitted.requestPayloadHash,
    });
    await expect(reloadedPublisher.listAttempts({
      workflowId: ready.id,
      ownerUserId: 'owner-1',
      limit: 100,
    })).resolves.toMatchObject({ items: [{ id: submitted.id }], nextCursor: null });
    await expect(reloadedPublisher.getLatestAttempt({
      workflowId: ready.id,
      ownerUserId: 'owner-2',
    })).resolves.toBeNull();
    await expect(reloadedPublisher.publish(publishInput)).resolves.toMatchObject({
      id: submitted.id,
      state: 'SUBMITTED',
      requestPayloadHash: submitted.requestPayloadHash,
    });
    expect(reloadCompile).not.toHaveBeenCalled();
    expect(reloadSubmit).not.toHaveBeenCalled();
    expect(submitImportOnce).toHaveBeenCalledTimes(1);
    await expect(reloadedPublisher.publish({ ...publishInput, actorUserId: 'owner-2' }))
      .rejects.toMatchObject({ code: 'OZON_PUBLISH_OWNER_REQUIRED', statusCode: 403 });
  });
});

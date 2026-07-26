import { describe, expect, it } from 'vitest';
import type { OzonListingDraft, OzonListingDraftMediaAssignment } from 'shared';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import {
  SOURCE_LISTING_EVIDENCE_ITEM_MAX_LENGTH,
  SourceListingWorkflowError,
  createSourceListingWorkflowService,
} from '../services/source-listing-workflow.js';

function setup() {
  const repository = new InMemoryOzonListingDraftRepository();
  let id = 0;
  const service = createSourceListingWorkflowService({
    repository,
    now: () => new Date('2026-07-15T08:00:00.000Z'),
    idFactory: (prefix) => `${prefix}-${++id}`,
  });
  return { repository, service };
}

async function base() {
  const context = setup();
  const draft = await context.service.createDraft({
    ownerUserId: 'owner-a', actorUserId: 'owner-a', shopId: 'shop-a', supplyGoodsId: 'goods-a',
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'a'.repeat(64),
    selectedSkuKeys: ['sku-red', 'sku-blue', 'sku-red'],
  });
  return { ...context, draft };
}

async function saveDraft(
  repository: InMemoryOzonListingDraftRepository,
  draft: OzonListingDraft,
  update: (next: OzonListingDraft) => void,
): Promise<OzonListingDraft> {
  const next = structuredClone(draft);
  update(next);
  next.revision = draft.revision + 1;
  return repository.compareAndSwap({
    draftId: draft.id,
    ownerUserId: draft.ownerUserId,
    actorUserId: draft.ownerUserId,
    expectedRevision: draft.revision,
    next,
  });
}

function strictPricing(skuKeys: string[]) {
  return {
    contractVersion: 'ozon-listing-pricing/v1',
    items: skuKeys.map((skuKey, index) => ({
      skuKey,
      price: String(100 + index),
      oldPrice: String(120 + index),
      currencyCode: 'RUB',
      vat: '0',
    })),
  };
}

function validationReport(blockers: Array<{
  code: string;
  message: string;
  fieldPath?: string;
}> = []) {
  return {
    schemaVersion: 'ozon-attribute-validation/v1',
    schemaRevision: 'schema-1',
    normalizedAttributes: [],
    fieldDecisions: [],
    operationReadiness: {
      ozonImport: {
        status: blockers.length ? 'BLOCKED' : 'READY',
        issues: structuredClone(blockers),
      },
      inventoryActivation: { status: 'READY', issues: [] },
      costingAutoPricing: { status: 'READY', issues: [] },
    },
  };
}

async function makeReady(
  service: ReturnType<typeof createSourceListingWorkflowService>,
  draft: OzonListingDraft,
): Promise<OzonListingDraft> {
  const categorized = await service.setCategory({
    draftId: draft.id,
    ownerUserId: draft.ownerUserId,
    actorUserId: draft.ownerUserId,
    expectedRevision: draft.revision,
    category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' },
  });
  const generated = await service.addAiCopyCandidate({
    draftId: draft.id,
    ownerUserId: draft.ownerUserId,
    actorUserId: draft.ownerUserId,
    expectedRevision: categorized.revision,
    titleRu: 'Товар для продажи',
    descriptionRu: 'Описание товара.',
    sourcePromptVersion: 'copy-v1',
  });
  const copied = await service.applyAiCopyCandidate({
    draftId: draft.id,
    ownerUserId: draft.ownerUserId,
    actorUserId: draft.ownerUserId,
    expectedRevision: generated.draft.revision,
    candidateId: generated.candidate.id,
    operationKey: `apply-${draft.id}`,
  });
  const withMedia = await service.setMediaAssignments({
    draftId: draft.id,
    ownerUserId: draft.ownerUserId,
    actorUserId: draft.ownerUserId,
    expectedRevision: copied.revision,
    assignments: [{
      scope: 'PRODUCT', slotKey: 'product-main', assetId: 'asset-main', source: 'REVIEWED',
    }],
  });
  const priced = await service.setPricing({
    draftId: draft.id,
    ownerUserId: draft.ownerUserId,
    actorUserId: draft.ownerUserId,
    expectedRevision: withMedia.revision,
    value: strictPricing(withMedia.selectedSkuKeys),
  });
  return service.recordValidationResult({
    draftId: draft.id,
    ownerUserId: draft.ownerUserId,
    actorUserId: draft.ownerUserId,
    expectedRevision: priced.revision,
    status: 'VALID',
    report: validationReport(),
    blockers: [],
    warnings: [],
  });
}

describe('source listing workflow', () => {
  it('rejects ambiguous or non-canonical media assignment scopes', async () => {
    const invalidAssignments: unknown[][] = [
      [{ slotKey: 'main', assetId: 'asset-1', source: 'REVIEWED' }],
      [{ scope: 'PRODUCT', skuKey: 'sku-red', slotKey: 'main', assetId: 'asset-1', source: 'REVIEWED' }],
      [{ scope: 'SKU', slotKey: 'hero', assetId: 'asset-1', source: 'REVIEWED' }],
      [{ scope: 'SKU', skuKey: 'sku-cancelled', slotKey: 'hero', assetId: 'asset-1', source: 'REVIEWED' }],
    ];
    for (const assignments of invalidAssignments) {
      const { service, draft: current } = await base();
      await expect(service.setMediaAssignments({
        draftId: current.id,
        ownerUserId: current.ownerUserId,
        actorUserId: current.ownerUserId,
        expectedRevision: current.revision,
        assignments: assignments as OzonListingDraftMediaAssignment[],
      })).rejects.toMatchObject({
        code: 'OZON_LISTING_DRAFT_INPUT_INVALID', statusCode: 400,
      });
    }
  });

  it('enforces the shared manual evidence item boundary in the domain service', async () => {
    const acceptedContext = await base();
    const accepted = await acceptedContext.service.confirmManualFact({
      draftId: acceptedContext.draft.id,
      ownerUserId: acceptedContext.draft.ownerUserId,
      actorUserId: acceptedContext.draft.ownerUserId,
      expectedRevision: acceptedContext.draft.revision,
      attributeKey: 'packageWeightG',
      value: 500,
      evidence: ['x'.repeat(SOURCE_LISTING_EVIDENCE_ITEM_MAX_LENGTH)],
    });
    expect(accepted.attributes.values.packageWeightG?.evidence?.[0]).toHaveLength(
      SOURCE_LISTING_EVIDENCE_ITEM_MAX_LENGTH,
    );

    const rejectedContext = await base();
    await expect(rejectedContext.service.confirmManualFact({
      draftId: rejectedContext.draft.id,
      ownerUserId: rejectedContext.draft.ownerUserId,
      actorUserId: rejectedContext.draft.ownerUserId,
      expectedRevision: rejectedContext.draft.revision,
      attributeKey: 'packageWeightG',
      value: 500,
      evidence: ['x'.repeat(SOURCE_LISTING_EVIDENCE_ITEM_MAX_LENGTH + 1)],
    })).rejects.toMatchObject({
      code: 'OZON_LISTING_DRAFT_INPUT_INVALID',
      statusCode: 400,
    });
  });

  it('binds owner, shop, immutable snapshot version and SKU identity', async () => {
    const { repository, service, draft } = await base();
    expect(draft).toMatchObject({
      ownerUserId: 'owner-a', shopId: 'shop-a', supplyGoodsId: 'goods-a',
      sourceCaptureSnapshotId: 'snapshot-1',
      selectedSkuKeys: ['sku-blue', 'sku-red'],
      draftVersion: 1, revision: 1,
      stage: 'CATEGORY_REVIEW', runState: 'ACTIVE',
    });
    await expect(service.getDraft({ draftId: draft.id, ownerUserId: 'owner-a' })).resolves.toEqual(draft);
    await expect(repository.getVersion({
      draftId: draft.id, ownerUserId: 'owner-a', draftVersion: 1,
    })).resolves.toEqual(draft);
    await expect(service.getDraftVersion({
      draftId: draft.id, ownerUserId: 'other-owner', draftVersion: 1,
    })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_NOT_FOUND', statusCode: 404 });
  });

  it('resumes the same current draft on an exact create retry', async () => {
    const { service, draft } = await base();
    const resumed = await service.createDraft({
      ownerUserId: 'owner-a', actorUserId: 'owner-a', shopId: 'shop-a', supplyGoodsId: 'goods-a',
      sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'a'.repeat(64),
      selectedSkuKeys: ['sku-red', 'sku-blue'],
    });
    expect(resumed).toEqual(draft);
    expect(resumed.auditEvents).toHaveLength(1);
  });

  it('resumes every recoverable run state without creating a duplicate workflow', async () => {
    for (const runState of ['PAUSED', 'RETRYABLE_FAILURE', 'MANUAL_REVIEW'] as const) {
      const { service, draft } = await base();
      const current = await service.setRunState({
        draftId: draft.id,
        ownerUserId: draft.ownerUserId,
        actorUserId: draft.ownerUserId,
        expectedRevision: draft.revision,
        runState,
        reason: runState,
      });
      const resumed = await service.createDraft({
        ownerUserId: 'owner-a', actorUserId: 'owner-a', shopId: 'shop-a', supplyGoodsId: 'goods-a',
        sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'a'.repeat(64),
        selectedSkuKeys: ['sku-red', 'sku-blue'],
      });
      expect(resumed).toEqual(current);
    }
  });

  it('does not resume cancelled, permanent-failure, or completed workflows', async () => {
    for (const runState of ['CANCELLED', 'PERMANENT_FAILURE'] as const) {
      const { service, draft } = await base();
      await service.setRunState({
        draftId: draft.id,
        ownerUserId: draft.ownerUserId,
        actorUserId: draft.ownerUserId,
        expectedRevision: draft.revision,
        runState,
        reason: runState,
      });
      const replacement = await service.createDraft({
        ownerUserId: 'owner-a', actorUserId: 'owner-a', shopId: 'shop-a', supplyGoodsId: 'goods-a',
        sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'a'.repeat(64),
        selectedSkuKeys: ['sku-blue', 'sku-red'],
      });
      expect(replacement.id).not.toBe(draft.id);
      expect(replacement.revision).toBe(1);
    }

    const { repository, service, draft } = await base();
    await saveDraft(repository, draft, (next) => {
      next.stage = 'PUBLISHED';
    });
    const replacement = await service.createDraft({
      ownerUserId: 'owner-a', actorUserId: 'owner-a', shopId: 'shop-a', supplyGoodsId: 'goods-a',
      sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'a'.repeat(64),
      selectedSkuKeys: ['sku-blue', 'sku-red'],
    });
    expect(replacement.id).not.toBe(draft.id);
  });

  it('appends publish-content versions while CAS revisions advance', async () => {
    const { repository, service, draft } = await base();
    const media = await service.setMediaAssignments({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: draft.revision,
      assignments: [{ scope: 'PRODUCT', slotKey: 'main', assetId: 'asset-1', source: 'REVIEWED' }],
    });
    const attributes = await service.setAttributeValues({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: media.revision,
      values: { color: { value: 'Красный', source: 'MANUAL', reviewed: true } },
      operation: 'MANUAL_EDIT',
    });
    expect(attributes).toMatchObject({ draftVersion: 3, revision: 3 });
    expect(attributes.auditEvents).toContainEqual(expect.objectContaining({
      type: 'ATTRIBUTE_VALUES_CHANGED',
      actorUserId: 'owner-a',
      details: { operation: 'MANUAL_EDIT', attributeKeys: ['color'] },
    }));
    await expect(repository.getVersion({
      draftId: draft.id, ownerUserId: draft.ownerUserId, draftVersion: 3,
    })).resolves.toMatchObject({ draftVersion: 3, revision: 3 });
  });

  it('records bounded attribute clear scope and evidence in the actor audit event', async () => {
    const { service, draft } = await base();
    const cleared = await service.setAttributeValues({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'reviewer-a',
      expectedRevision: draft.revision,
      values: {},
      operation: 'MANUAL_EDIT',
      changeAudit: [{
        attributeId: 100,
        skuKey: 'sku-red',
        action: 'CLEAR',
        evidence: ['reviewer:wrong-selection'],
      }],
    });

    expect(cleared.auditEvents).toContainEqual(expect.objectContaining({
      type: 'ATTRIBUTE_VALUES_CHANGED',
      actorUserId: 'reviewer-a',
      details: expect.objectContaining({
        changes: [{
          attributeId: 100,
          skuKey: 'sku-red',
          action: 'CLEAR',
          evidence: ['reviewer:wrong-selection'],
        }],
      }),
    }));
  });

  it('persists bounded workflow progress and versions pricing changes', async () => {
    const { service, draft } = await base();
    expect(draft).toMatchObject({
      completedStepHashes: {}, blockers: [], warnings: [], publishTaskIds: [],
    });
    const priced = await service.setPricing({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: draft.revision,
      value: strictPricing(draft.selectedSkuKeys),
    });
    expect(priced).toMatchObject({
      draftVersion: 2,
      revision: 2,
      pricing: { value: strictPricing(draft.selectedSkuKeys) },
      validation: { status: 'STALE' },
      freshness: { validation: { state: 'STALE', reason: 'PRICING_CHANGED' } },
      grantRevocation: { required: true, reason: 'PRICING_CHANGED' },
    });

    const progress = await service.setWorkflowProgress({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: priced.revision,
      completedStepHashes: { category: '1'.repeat(64), attributes: '2'.repeat(64) },
      blockers: [{ code: 'WEIGHT_REQUIRED', message: 'Weight must be confirmed', fieldPath: 'weightG' }],
      warnings: [{ code: 'FREIGHT_UNKNOWN', message: 'Freight is not available' }],
      publishTaskIds: ['task-1', 'task-1', 'task-2'],
    });
    expect(progress).toMatchObject({
      draftVersion: 2,
      revision: 3,
      completedStepHashes: { category: '1'.repeat(64), attributes: '2'.repeat(64) },
      blockers: [{ code: 'WEIGHT_REQUIRED', message: 'Weight must be confirmed', fieldPath: 'weightG' }],
      warnings: [{ code: 'FREIGHT_UNKNOWN', message: 'Freight is not available' }],
      publishTaskIds: ['task-1', 'task-2'],
      grantRevocation: { required: false, reason: null, previousShopId: null },
    });
  });

  it('rejects unbounded or malformed workflow progress', async () => {
    const { service, draft } = await base();
    await expect(service.setWorkflowProgress({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: draft.revision,
      completedStepHashes: { category: 'not-a-sha256' },
      blockers: [], warnings: [], publishTaskIds: [],
    })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID', statusCode: 400 });
    await expect(service.setWorkflowProgress({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: draft.revision,
      completedStepHashes: {}, blockers: [], warnings: [],
      publishTaskIds: Array.from({ length: 101 }, (_, index) => `task-${index}`),
    })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID', statusCode: 400 });
  });

  it('persists SKU-scoped validation issues for the maximum supported SKU key', async () => {
    const { service } = setup();
    const skuKey = '商'.repeat(500);
    const draft = await service.createDraft({
      ownerUserId: 'owner-a', actorUserId: 'owner-a', shopId: 'shop-a', supplyGoodsId: 'goods-a',
      sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'a'.repeat(64),
      selectedSkuKeys: [skuKey],
    });
    const fieldPath = `attributes.100.skuValues.${skuKey}`;

    const blocker = { code: 'OZON_ATTRIBUTE_SKU_VALUE_REQUIRED', message: 'SKU value required', fieldPath };
    const recorded = await service.recordValidationResult({
      draftId: draft.id,
      ownerUserId: draft.ownerUserId,
      actorUserId: draft.ownerUserId,
      expectedRevision: draft.revision,
      status: 'INVALID',
      report: validationReport([blocker]),
      blockers: [blocker],
      warnings: [],
    });

    expect(recorded.validation.status).toBe('INVALID');
    expect(recorded.blockers).toEqual(expect.arrayContaining([
      expect.objectContaining({ fieldPath }),
    ]));
  });

  it('confirms a manual fact with reviewed evidence and mandatory actor audit', async () => {
    const { service, draft } = await base();
    const confirmed = await service.confirmManualFact({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'reviewer-a',
      expectedRevision: draft.revision,
      attributeKey: 'packageWeightG', value: 500,
      evidence: ['supplier packaging label', 'operator checked'],
    });
    expect(confirmed).toMatchObject({
      draftVersion: 2,
      revision: 2,
      attributes: { values: { packageWeightG: {
        value: 500, source: 'MANUAL', reviewed: true,
        evidence: ['supplier packaging label', 'operator checked'],
        confidence: 1,
        dictionaryMatch: { status: 'NOT_APPLICABLE', dictionaryValueId: null },
        manualReview: 'CONFIRMED',
      } } },
      freshness: { validation: { state: 'STALE', reason: 'MANUAL_FACT_CONFIRMED' } },
      grantRevocation: { required: true, reason: 'MANUAL_FACT_CONFIRMED' },
    });
    expect(confirmed.auditEvents).toContainEqual(expect.objectContaining({
      type: 'MANUAL_FACT_CONFIRMED', actorUserId: 'reviewer-a', draftVersion: 2,
      details: {
        attributeKey: 'packageWeightG',
        evidence: ['supplier packaging label', 'operator checked'],
      },
    }));
  });

  it('rejects stale CAS updates', async () => {
    const { service, draft } = await base();
    const input = {
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: draft.revision,
      category: { categoryId: 1, typeId: 2, catalogRevision: 'catalog-1' },
    } as const;
    await service.setCategory(input);
    await expect(service.setCategory(input)).rejects.toMatchObject({
      code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT', statusCode: 409,
    } satisfies Partial<SourceListingWorkflowError>);
  });

  it('category change invalidates attributes and validation, not reviewed media', async () => {
    const { service, draft } = await base();
    const media = await service.setMediaAssignments({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: draft.revision,
      assignments: [{ scope: 'PRODUCT', slotKey: 'main', assetId: 'asset-1', source: 'REVIEWED' }],
    });
    const attrs = await service.setAttributeValues({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: media.revision,
      values: {
        color: { value: 'Красный', source: 'MANUAL', reviewed: true },
        obsoleteSize: { value: 'XL', source: 'SOURCE', reviewed: false },
      },
    });
    const changed = await service.setCategory({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: attrs.revision,
      category: { categoryId: 3, typeId: 4, catalogRevision: 'catalog-2' },
      retainedAttributeValues: { color: attrs.attributes.values.color! },
    });
    expect(changed.attributes.values).toEqual({ color: attrs.attributes.values.color });
    expect(changed.media.assignments).toEqual(media.media.assignments);
    expect(changed.freshness.attributes).toEqual({ state: 'STALE', reason: 'CATEGORY_CHANGED' });
    expect(changed.freshness.validation).toEqual({ state: 'STALE', reason: 'CATEGORY_CHANGED' });
    expect(changed.freshness.media).toEqual({ state: 'CURRENT', reason: null });
    expect(changed.draftVersion).toBe(4);
    await expect(service.getDraftVersion({
      draftId: draft.id, ownerUserId: draft.ownerUserId, draftVersion: 1,
    })).resolves.toMatchObject({ category: null, draftVersion: 1 });

    const nextEdit = await service.setWorkflowProgress({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: changed.revision,
      completedStepHashes: {}, blockers: [], warnings: [], publishTaskIds: [],
    });
    expect(nextEdit.grantRevocation).toEqual({ required: false, reason: null, previousShopId: null });
  });

  it('snapshot change appends a version and preserves stale copy/media outputs', async () => {
    const { repository, service, draft } = await base();
    const generated = await service.addAiCopyCandidate({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'worker',
      expectedRevision: draft.revision, titleRu: 'Товар', descriptionRu: 'Описание',
      sourcePromptVersion: 'copy-v1',
    });
    const media = await service.setMediaAssignments({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: generated.draft.revision,
      assignments: [{ scope: 'PRODUCT', slotKey: 'main', assetId: 'asset-1', source: 'GENERATED' }],
    });
    const changed = await service.replaceSourceSnapshot({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: media.revision,
      sourceCaptureSnapshotId: 'snapshot-2', sourceCaptureHash: 'b'.repeat(64),
      selectedSkuKeys: ['sku-green'],
    });
    expect(changed).toMatchObject({
      draftVersion: 3,
      sourceCaptureSnapshotId: 'snapshot-2',
      selectedSkuKeys: ['sku-green'],
      grantRevocation: { required: true, reason: 'SOURCE_SNAPSHOT_CHANGED' },
    });
    expect(changed.auditEvents.at(-1)).toMatchObject({
      type: 'SOURCE_SNAPSHOT_CHANGED',
      details: {
        previousSelectedSkuKeys: ['sku-blue', 'sku-red'],
        selectedSkuKeys: ['sku-green'],
      },
    });
    expect(changed.copy.candidates).toHaveLength(1);
    expect(changed.media.assignments).toHaveLength(1);
    expect(changed.freshness.content).toEqual({ state: 'STALE', reason: 'SOURCE_SNAPSHOT_CHANGED' });
    expect(changed.freshness.media).toEqual({ state: 'STALE', reason: 'SOURCE_SNAPSHOT_CHANGED' });
    await expect(repository.getVersion({
      draftId: draft.id, ownerUserId: draft.ownerUserId, draftVersion: 1,
    })).resolves.toMatchObject({ sourceCaptureSnapshotId: 'snapshot-1' });
  });

  it('shop and SKU changes append versions and signal grant revocation', async () => {
    const { repository, service, draft } = await base();
    const shop = await service.changeShop({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: draft.revision, shopId: 'shop-b',
    });
    expect(shop).toMatchObject({
      shopId: 'shop-b', draftVersion: 2,
      grantRevocation: { required: true, reason: 'SHOP_CHANGED', previousShopId: 'shop-a' },
    });
    const skus = await service.changeSkuSelection({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: shop.revision, selectedSkuKeys: ['sku-green'],
    });
    expect(skus).toMatchObject({ draftVersion: 3, selectedSkuKeys: ['sku-green'] });
    await expect(repository.getVersion({
      draftId: draft.id, ownerUserId: draft.ownerUserId, draftVersion: 1,
    })).resolves.toMatchObject({ shopId: 'shop-a' });
  });

  it('does not mutate publish copy until an explicit audited candidate apply', async () => {
    const { service, draft } = await base();
    const generated = await service.addAiCopyCandidate({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'worker',
      expectedRevision: draft.revision, titleRu: 'Товар', descriptionRu: 'Описание',
      sourcePromptVersion: 'copy-v1',
    });
    expect(generated.draft.copy).toMatchObject({ publishTitleRu: null, publishDescriptionRu: null });
    const applied = await service.applyAiCopyCandidate({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'reviewer',
      expectedRevision: generated.draft.revision, candidateId: generated.candidate.id,
      operationKey: 'apply-1',
    });
    expect(applied.copy).toMatchObject({ publishTitleRu: 'Товар', publishDescriptionRu: 'Описание' });
    expect(applied.copy.candidates).toContainEqual(generated.candidate);
    expect(applied.copy.applyAudit).toEqual([expect.objectContaining({
      candidateId: generated.candidate.id, actorUserId: 'reviewer', operationKey: 'apply-1', draftVersion: 2,
    })]);
    const replay = await service.applyAiCopyCandidate({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'reviewer',
      expectedRevision: generated.draft.revision, candidateId: generated.candidate.id,
      operationKey: 'apply-1',
    });
    expect(replay.revision).toBe(applied.revision);
    expect(replay.copy.applyAudit).toHaveLength(1);

    const second = await service.addAiCopyCandidate({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'worker',
      expectedRevision: applied.revision, titleRu: 'Другой товар', descriptionRu: null,
      sourcePromptVersion: 'copy-v2',
    });
    await expect(service.applyAiCopyCandidate({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'reviewer',
      expectedRevision: second.draft.revision, candidateId: second.candidate.id,
      operationKey: 'apply-1',
    })).rejects.toMatchObject({ code: 'OZON_LISTING_AI_APPLY_OPERATION_CONFLICT', statusCode: 409 });
  });

  it('preserves an approved field when a manual candidate explicitly reviews only the other field', async () => {
    const { service, draft } = await base();
    const initial = await service.addAiCopyCandidate({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'reviewer',
      expectedRevision: draft.revision, titleRu: 'Первый товар', descriptionRu: 'Проверенное описание',
      sourcePromptVersion: 'manual-v1',
    });
    const approved = await service.applyAiCopyCandidate({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'reviewer',
      expectedRevision: initial.draft.revision, candidateId: initial.candidate.id,
      operationKey: 'apply-manual-both',
    });
    const titleOnly = await service.addAiCopyCandidate({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'reviewer',
      expectedRevision: approved.revision, titleRu: 'Обновленный товар',
      sourcePromptVersion: 'manual-v2',
    });
    expect(titleOnly.candidate.fields).toEqual(['title']);

    const reapplied = await service.applyAiCopyCandidate({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'reviewer',
      expectedRevision: titleOnly.draft.revision, candidateId: titleOnly.candidate.id,
      operationKey: 'apply-manual-title',
    });
    expect(reapplied.copy.publishTitleRu).toBe('Обновленный товар');
    expect(reapplied.copy.publishDescriptionRu).toBe('Проверенное описание');
  });

  it('models pause/cancel/retryable/permanent/manual review states', async () => {
    const { service, draft } = await base();
    let current = draft;
    for (const runState of ['PAUSED', 'MANUAL_REVIEW', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE'] as const) {
      current = await service.setRunState({
        draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
        expectedRevision: current.revision, runState, reason: runState,
      });
    }
    await expect(service.setRunState({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: current.revision, runState: 'ACTIVE', reason: null,
    })).rejects.toMatchObject({ code: 'OZON_LISTING_WORKFLOW_TERMINAL' });
  });

  it('rejects every ordinary mutation after cancellation, permanent failure, or publication', async () => {
    for (const runState of ['CANCELLED', 'PERMANENT_FAILURE'] as const) {
      const { service, draft } = await base();
      const terminal = await service.setRunState({
        draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
        expectedRevision: draft.revision, runState, reason: runState,
      });
      await expect(service.setPricing({
        draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
        expectedRevision: terminal.revision, value: { price: '100' },
      })).rejects.toMatchObject({ code: 'OZON_LISTING_WORKFLOW_TERMINAL', statusCode: 409 });
    }

    const { repository, service, draft } = await base();
    const published = await saveDraft(repository, draft, (next) => { next.stage = 'PUBLISHED'; });
    await expect(service.confirmManualFact({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: published.revision, attributeKey: 'weight', value: 500, evidence: ['manual'],
    })).rejects.toMatchObject({ code: 'OZON_LISTING_WORKFLOW_TERMINAL', statusCode: 409 });
  });

  it('rejects a missing manual fact value before recording reviewed evidence', async () => {
    const { service, draft } = await base();
    await expect(service.confirmManualFact({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: draft.revision, attributeKey: 'weight', value: undefined, evidence: ['manual'],
    })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID', statusCode: 400 });
  });

  it('records an authoritative validation result through CAS before publish intent', async () => {
    const { service, draft } = await base();
    const ready = await makeReady(service, draft);
    expect(ready).toMatchObject({
      revision: 7,
      draftVersion: 5,
      stage: 'READY_TO_PUBLISH',
      validation: {
        status: 'VALID',
        report: { operationReadiness: { ozonImport: { status: 'READY', issues: [] } } },
      },
      freshness: {
        attributes: { state: 'CURRENT', reason: null },
        validation: { state: 'CURRENT', reason: null },
      },
    });
    expect(ready.auditEvents.at(-1)).toMatchObject({ type: 'VALIDATION_RECORDED' });
  });

  it('records idempotent publish intent locally without an Ozon call', async () => {
    const { service, draft: created } = await base();
    const draft = await makeReady(service, created);
    const first = await service.recordPublishIntent({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: draft.revision, idempotencyKey: 'publish-1',
    });
    const replay = await service.recordPublishIntent({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: draft.revision, idempotencyKey: 'publish-1',
    });
    expect(first.idempotent).toBe(false);
    expect(first.intent.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.draft.publishTaskIds).toEqual([first.intent.id]);
    expect(replay).toMatchObject({ idempotent: true, intent: first.intent });
    expect(replay.draft.revision).toBe(first.draft.revision);
    expect(replay.draft.publishTaskIds).toEqual([first.intent.id]);
    const changed = await service.setMediaAssignments({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: first.draft.revision,
      assignments: [{ scope: 'PRODUCT', slotKey: 'main', assetId: 'asset-new', source: 'REVIEWED' }],
    });
    await expect(service.recordPublishIntent({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: changed.revision, idempotencyKey: 'publish-1',
    })).rejects.toMatchObject({ code: 'OZON_LISTING_PUBLISH_INTENT_CONFLICT', statusCode: 409 });
  });

  it('rejects publish intent unless every readiness invariant is satisfied', async () => {
    const cases: Array<{
      label: string;
      update: (draft: OzonListingDraft) => void;
      message: string;
    }> = [
      { label: 'run state', update: (draft) => { draft.runState = 'PAUSED'; }, message: 'runState=PAUSED' },
      { label: 'stage', update: (draft) => { draft.stage = 'VALIDATION'; }, message: 'stage=VALIDATION' },
      {
        label: 'validation',
        update: (draft) => { draft.validation.status = 'INVALID'; },
        message: 'validation=INVALID',
      },
      {
        label: 'blockers',
        update: (draft) => { draft.blockers = [{ code: 'BLOCKED', message: 'blocked' }]; },
        message: 'blockers=1',
      },
      ...(['category', 'attributes', 'content', 'media', 'pricing', 'validation'] as const).map((section) => ({
        label: `${section} freshness`,
        update: (draft: OzonListingDraft) => {
          draft.freshness[section] = { state: 'STALE', reason: 'CATEGORY_CHANGED' };
        },
        message: `stale=${section}`,
      })),
    ];

    for (const testCase of cases) {
      const { repository, service, draft: created } = await base();
      const ready = await makeReady(service, created);
      const invalid = await saveDraft(repository, ready, testCase.update);
      await expect(service.recordPublishIntent({
        draftId: invalid.id,
        ownerUserId: invalid.ownerUserId,
        actorUserId: invalid.ownerUserId,
        expectedRevision: invalid.revision,
        idempotencyKey: `not-ready-${testCase.label}`,
      })).rejects.toMatchObject({
        code: 'OZON_LISTING_PUBLISH_NOT_READY',
        statusCode: 409,
        message: expect.stringContaining(testCase.message),
      });
    }
  });

  it('rechecks persisted copy, media and pricing before recording publish intent', async () => {
    const { repository, service, draft: created } = await base();
    const ready = await makeReady(service, created);
    const legacy = await saveDraft(repository, ready, (next) => {
      next.pricing.value = { currency: 'RUB', price: '100' };
    });

    await expect(service.recordPublishIntent({
      draftId: legacy.id,
      ownerUserId: legacy.ownerUserId,
      actorUserId: legacy.ownerUserId,
      expectedRevision: legacy.revision,
      idempotencyKey: 'legacy-pricing-state',
    })).rejects.toMatchObject({
      code: 'OZON_LISTING_PUBLISH_NOT_READY',
      statusCode: 409,
      message: expect.stringContaining('OZON_LISTING_PRICING_INVALID'),
    });
  });

  it('does not retain an intent when its CAS fails', async () => {
    const { repository, service, draft: created } = await base();
    const draft = await makeReady(service, created);
    const next = structuredClone(draft);
    next.revision = 2;
    next.stage = 'PUBLISH_INTENT_RECORDED';
    await expect(repository.recordPublishIntent({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: 99, idempotencyKey: 'atomic-intent', payloadHash: 'f'.repeat(64), next,
      intent: {
        id: 'intent-failed', draftId: draft.id, ownerUserId: draft.ownerUserId,
        shopId: draft.shopId, draftVersion: draft.draftVersion, revision: 2,
        idempotencyKey: 'atomic-intent', payloadHash: 'f'.repeat(64),
        actorUserId: 'owner-a', createdAt: '2026-07-15T08:00:00.000Z',
      },
    })).rejects.toMatchObject({ code: 'VERSION_CONFLICT' });
    await expect(service.getDraft({ draftId: draft.id, ownerUserId: draft.ownerUserId }))
      .resolves.toEqual(draft);
    await expect(service.recordPublishIntent({
      draftId: draft.id, ownerUserId: draft.ownerUserId, actorUserId: 'owner-a',
      expectedRevision: draft.revision, idempotencyKey: 'atomic-intent',
    })).resolves.toMatchObject({ idempotent: false });
  });
});

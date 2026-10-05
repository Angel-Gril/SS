import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
  createSourceProductCaptureV2Submission,
  verifySourceProductCaptureV2Submission,
  type SourceProductCaptureV2Submission,
} from 'shared';
import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionHostedAiImagePlanBindingRecord,
} from '../services/extension-hosted-ai-image-plan.js';
import type {
  ExtensionHostedCandidatePreviewBinding,
} from '../services/extension-hosted-ai-image-suite-candidate-preview.js';
import {
  createPrismaExtensionHostedAiImageAuthorityLoader,
  type ExtensionHostedAiImageAuthorityPrismaClient,
} from '../services/extension-hosted-ai-image-authority-prisma.js';
import { deriveSourceListingSkuCopyKey } from '../services/source-listing-sku-copies.js';

const captureFixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

const binding: ExtensionHostedCandidatePreviewBinding = {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-workflow-1',
  draftRevision: 5,
  draftVersion: 7,
  planId: 'plan-1',
  planVersionId: 'plan-version-1',
  planRevision: 3,
  suiteId: 'suite-1',
  suiteRevision: 9,
  slotId: 'slot-1',
  slotRevision: 5,
  workflowId: 'workflow-1',
  workflowRevision: 4,
  outputAssetId: 'asset-1',
};

const persistedBinding = createExtensionHostedAiImagePlanBindingRecord({
  planId: binding.planId,
  identity: {
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    deviceSessionId: 'device-session-1',
  },
  binding: {
    snapshotId: binding.snapshotId,
    supplyGoodsId: binding.supplyGoodsId,
    shopId: binding.shopId,
    listingWorkflowId: binding.listingWorkflowId,
    draftRevision: binding.draftRevision,
    draftVersion: binding.draftVersion,
  },
  selectedSkuKeys: ['sku-0'],
  candidateMediaKeys: ['media-main-0'],
});

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    listingWorkflowId: 'listing-workflow-1',
    workflowOwnerUserId: 'owner-1',
    workflowShopId: 'shop-1',
    workflowSourceSubjectId: 'source-subject-1',
    workflowSnapshotId: 'snapshot-1',
    workflowSupplyGoodsId: 'goods-1',
    workflowSelectedSkuKeys: ['sku-0'],
    workflowRevision: 5,
    workflowDraftVersion: 7,
    workflowStage: 'MEDIA_REVIEW',
    workflowStatus: 'ACTIVE',
    draftOwnerUserId: 'owner-1',
    draftShopId: 'shop-1',
    draftSnapshotId: 'snapshot-1',
    draftSupplyGoodsId: 'goods-1',
    draftSelectedSkuKeys: ['sku-0'],
    draftRevision: 5,
    draftVersion: 7,
    draftStage: 'MEDIA_REVIEW',
    draftStatus: 'ACTIVE',
    subjectOwnerUserId: 'owner-1',
    subjectSupplyGoodsId: 'goods-1',
    goodsOwnerUserId: 'owner-1',
    shopOwnerUserId: 'owner-1',
    shopStatus: 'ACTIVE',
    shopPlatform: 'OZON',
    snapshotSubjectId: 'source-subject-1',
    snapshotCaptureHash: captureFixture.captureHash,
    snapshotPayloadBytes: captureFixture.payloadBytes,
    snapshotPayload: structuredClone(captureFixture.capture),
    latestSnapshotId: 'snapshot-1',
    ...overrides,
  };
}

function bindingRow(overrides: Record<string, unknown> = {}) {
  return { ...persistedBinding, ...overrides };
}

function graphRow(overrides: Record<string, unknown> = {}) {
  return {
    bindingPlanId: persistedBinding.planId,
    bindingOwnerUserId: persistedBinding.ownerUserId,
    bindingDeviceSessionId: persistedBinding.deviceSessionId,
    bindingShopId: persistedBinding.shopId,
    bindingListingWorkflowId: persistedBinding.listingWorkflowId,
    bindingSnapshotId: persistedBinding.snapshotId,
    bindingSupplyGoodsId: persistedBinding.supplyGoodsId,
    bindingDraftRevision: persistedBinding.draftRevision,
    bindingDraftVersion: persistedBinding.draftVersion,
    bindingSelectedSkuHash: persistedBinding.selectedSkuHash,
    bindingCandidateMediaHash: persistedBinding.candidateMediaHash,
    bindingAuthorityHash: persistedBinding.authorityHash,
    bindingHash: persistedBinding.bindingHash,
    currentDraftRevision: 5,
    currentDraftVersion: 7,
    currentSnapshotId: 'snapshot-1',
    currentShopId: 'shop-1',
    currentSupplyGoodsId: 'goods-1',
    currentSourceSubjectId: 'source-subject-1',
    listingStatus: 'ACTIVE',
    listingStage: 'MEDIA_REVIEW',
    draftOwnerUserId: 'owner-1',
    draftShopId: 'shop-1',
    draftSnapshotId: 'snapshot-1',
    draftSupplyGoodsId: 'goods-1',
    draftRevision: 5,
    draftVersion: 7,
    draftStatus: 'ACTIVE',
    draftStage: 'MEDIA_REVIEW',
    currentSourceCaptureHash: captureFixture.captureHash,
    latestSnapshotId: 'snapshot-1',
    planId: 'plan-1',
    planOwnerUserId: 'owner-1',
    planSourceSubjectId: 'source-subject-1',
    planContextType: 'collect',
    planContextId: 'goods-1',
    planRevision: 3,
    planReviewStatus: 'APPROVED',
    planStaleAt: null,
    planCurrentVersionId: 'plan-version-1',
    planApprovedVersionId: 'plan-version-1',
    planVersionId: 'plan-version-1',
    planVersionPlanId: 'plan-1',
    planVersionOwnerUserId: 'owner-1',
    planVersionSourceSubjectId: 'source-subject-1',
    planVersionSnapshotId: 'snapshot-1',
    planVersionSourceHash: captureFixture.captureHash,
    planVersionSelectedSkuHash: persistedBinding.selectedSkuHash,
    planVersionCandidateMediaHash: persistedBinding.candidateMediaHash,
    planVersionInputSnapshot: { candidates: [{ id: 'media-main-0' }] },
    suiteId: 'suite-1',
    suiteOwnerUserId: 'owner-1',
    suitePlanId: 'plan-1',
    suitePlanVersionId: 'plan-version-1',
    suiteSourceSubjectId: 'source-subject-1',
    suiteSnapshotId: 'snapshot-1',
    suiteSourceHash: captureFixture.captureHash,
    suiteContextType: 'collect',
    suiteContextId: 'goods-1',
    suiteStatus: 'SUCCEEDED',
    suiteRevision: 9,
    slotId: 'slot-1',
    slotSuiteId: 'suite-1',
    slotOwnerUserId: 'owner-1',
    slotKey: 'sku:sku-0:hero',
    slotOwnershipLevel: 'sku',
    slotOwnershipKey: 'sku-0',
    slotStatus: 'SUCCEEDED',
    slotAttempt: 1,
    slotRevision: 5,
    slotWorkflowId: 'workflow-1',
    workflowId: 'workflow-1',
    workflowOwnerUserId: 'owner-1',
    workflowStatus: 'SUCCEEDED',
    workflowReviewStatus: 'PENDING',
    workflowRevision: 4,
    workflowCurrentAttempt: 1,
    workflowContextType: 'collect',
    workflowContextId: 'goods-1',
    workflowSkuKey: 'sku-0',
    workflowSlotKey: 'sku:sku-0:hero',
    workflowSelectedOutputAssetId: null,
    jobId: 'job-1',
    jobOwnerUserId: 'owner-1',
    jobWorkflowId: 'workflow-1',
    jobWorkflowAttempt: 1,
    jobExecutionMode: 'ERP_HOSTED',
    jobStatus: 'SUCCEEDED',
    jobActualCostCents: 8,
    jobBilledUnits: 1,
    reservationStatus: 'SETTLED',
    paidHosted: true,
    settledCostEvidence: true,
    outputId: 'asset-1',
    outputOwnerUserId: 'owner-1',
    outputJobId: 'job-1',
    outputKind: 'AI_GENERATED',
    outputSnapshotId: 'snapshot-1',
    outputStorageBackend: 'oss',
    outputStorageKey: 'owners/owner-1/ai/suite-1/final.png',
    outputMimeType: 'image/png',
    outputSizeBytes: 128_000,
    outputWidth: 900,
    outputHeight: 1200,
    outputSha256: 'a'.repeat(64),
    outputMetadata: {
      version: 'ai-image-suite-output/v1',
      normalizerVersion: 'ai-image-suite-output-normalizer/v1',
      suiteId: 'suite-1',
      slotId: 'slot-1',
      attempt: 1,
      providerResultUrl: 'https://provider.example/private-result',
      prompt: 'must-not-leak',
    },
    ...overrides,
  };
}

function fixture(results: unknown[][]) {
  const queue = [...results];
  const query = vi.fn(async (_query: string, ..._values: unknown[]) => queue.shift() || []);
  const client: ExtensionHostedAiImageAuthorityPrismaClient = {
    $queryRawUnsafe: query as unknown as ExtensionHostedAiImageAuthorityPrismaClient['$queryRawUnsafe'],
  };
  return {
    query,
    loader: createPrismaExtensionHostedAiImageAuthorityLoader(client),
  };
}

const candidateInput = () => ({
  ownerUserId: 'owner-1',
  deviceSessionId: 'device-session-1',
  binding: { ...binding },
});

describe('Prisma extension hosted AI image authority loader', () => {
  it('adds server-owned copied offers to planning authority without changing the captured source hash or canonical database selection', async () => {
    const operationKey = 'hosted-copy-operation', rowKey = deriveSourceListingSkuCopyKey('listing-workflow-1', operationKey);
    const row = planRow();
    const draftPayload = { id: 'listing-workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
      sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: row.snapshotCaptureHash, selectedSkuKeys: ['sku-0'], revision: 5, draftVersion: 7,
      offerRows: { contractVersion: 'source-listing-offer-rows/v1', rows: [{ rowKey, sourceSkuKey: 'sku-0', offerId: 'copy-offer',
        sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: row.snapshotCaptureHash, sourceDraftRevision: 4, sourceDraftVersion: 6,
        pricing: null, packaging: null, attributes: {} }] },
      auditEvents: [{ type: 'SKU_DUPLICATED', draftVersion: 7, details: { rowKey, sourceSkuKey: 'sku-0', editorOperationKey: operationKey } }] };
    const { loader } = fixture([[{ ...row, draftPayload }]]);
    const authority = await loader.loadPlanAuthority({ ownerUserId: 'owner-1', listingWorkflowId: 'listing-workflow-1' });
    expect(authority?.selectedSkuKeys.sort()).toEqual(['sku-0', rowKey].sort());
    expect(authority?.capturedSkuKeys).toContain(rowKey);
    expect(authority?.candidateMediaKeys).toEqual(['media-main-0']);
    expect(row.workflowSelectedSkuKeys).toEqual(['sku-0']);
    expect((row.snapshotPayload as any).skus).toHaveLength(1);
  });
  it('derives current plan authority and eligible media keys only from the verified capture', async () => {
    const { loader, query } = fixture([[planRow()]]);

    await expect(loader.loadPlanAuthority({
      ownerUserId: 'owner-1',
      listingWorkflowId: 'listing-workflow-1',
    })).resolves.toEqual({
      ownerUserId: 'owner-1',
      sourceSubjectId: 'source-subject-1',
      sourceCaptureCurrent: true,
      workflowStatus: 'ACTIVE',
      draftStage: 'MEDIA_REVIEW',
      snapshotId: 'snapshot-1',
      supplyGoodsId: 'goods-1',
      shopId: 'shop-1',
      listingWorkflowId: 'listing-workflow-1',
      draftRevision: 5,
      draftVersion: 7,
      selectedSkuKeys: ['sku-0'],
      capturedSkuKeys: ['sku-0'],
      candidateMediaKeys: ['media-main-0'],
    });

    const [sql, ...values] = query.mock.calls[0]!;
    expect(sql).toMatch(/JOIN LATERAL/u);
    expect(sql).toMatch(/"source_capture_snapshots"/u);
    expect(values).toEqual(['owner-1', 'listing-workflow-1']);
  });

  it('maps NFKC capture SKU aliases to canonical workflow and media authority keys', async () => {
    const capturedSkuKey = 'sku:variant\uff081.5cm+4cm\uff09';
    const canonicalSkuKey = capturedSkuKey.normalize('NFKC');
    const capture = structuredClone(captureFixture.capture);
    capture.skus[0]!.key = capturedSkuKey;
    capture.facts.selectedSkuKey = capturedSkuKey;
    capture.fieldEvidence.selectedSkuKey.value = capturedSkuKey;
    capture.prices[0]!.skuKey = capturedSkuKey;
    capture.prices[0]!.fieldEvidence.skuKey.value = capturedSkuKey;
    capture.media[0]!.skuKeys = [capturedSkuKey];
    const submission = await createSourceProductCaptureV2Submission(capture);
    await expect(verifySourceProductCaptureV2Submission(submission)).resolves.toMatchObject({
      valid: true,
    });
    const { loader } = fixture([[planRow({
      workflowSelectedSkuKeys: [canonicalSkuKey],
      draftSelectedSkuKeys: [canonicalSkuKey],
      snapshotCaptureHash: submission.captureHash,
      snapshotPayloadBytes: submission.payloadBytes,
      snapshotPayload: submission.capture,
    })]]);

    await expect(loader.loadPlanAuthority({
      ownerUserId: 'owner-1',
      listingWorkflowId: 'listing-workflow-1',
    })).resolves.toMatchObject({
      selectedSkuKeys: [canonicalSkuKey],
      capturedSkuKeys: [canonicalSkuKey],
      candidateMediaKeys: ['media-main-0'],
    });
  });

  it('does not treat an unbound SKU-role image as product-level candidate media', async () => {
    const capture = structuredClone(captureFixture.capture);
    capture.media[0]!.role = 'sku';
    capture.media[0]!.fieldEvidence.role.value = 'sku';
    capture.media[0]!.skuKeys = [];
    capture.skus[0]!.mediaKeys = [];
    const submission = await createSourceProductCaptureV2Submission(capture);
    await expect(verifySourceProductCaptureV2Submission(submission)).resolves.toMatchObject({
      valid: true,
    });
    const { loader } = fixture([[planRow({
      snapshotCaptureHash: submission.captureHash,
      snapshotPayloadBytes: submission.payloadBytes,
      snapshotPayload: submission.capture,
    })]]);

    await expect(loader.loadPlanAuthority({
      ownerUserId: 'owner-1',
      listingWorkflowId: 'listing-workflow-1',
    })).resolves.toMatchObject({ candidateMediaKeys: [] });
  });

  it('does not project accepted non-image URLs into hosted plan authority', async () => {
    const capture = structuredClone(captureFixture.capture);
    const invalid = structuredClone(capture.media[0]!);
    invalid.key = 'media-detail-page';
    invalid.ordinal = capture.media.length;
    invalid.role = 'product_detail';
    invalid.url = 'https://shop.example.com/page/activity.htm';
    invalid.mimeType = null;
    invalid.width = null;
    invalid.height = null;
    invalid.fieldEvidence.url.value = invalid.url;
    invalid.fieldEvidence.role.value = invalid.role;
    invalid.fieldEvidence.mimeType = {
      ...structuredClone(invalid.fieldEvidence.width),
      sourcePath: 'window.offerDetailData.detailImages[1].mimeType',
    };
    invalid.fieldEvidence.width.value = null;
    invalid.fieldEvidence.height.value = null;
    capture.media.push(invalid);
    Object.assign(capture.counts.find((row) => row.fieldPath === '/media')!, {
      totalCount: capture.media.length,
      capturedCount: capture.media.length,
      submittedCount: capture.media.length,
    });
    const submission = await createSourceProductCaptureV2Submission(capture);
    await expect(verifySourceProductCaptureV2Submission(submission)).resolves.toMatchObject({
      valid: true,
    });
    const { loader } = fixture([[planRow({
      snapshotCaptureHash: submission.captureHash,
      snapshotPayloadBytes: submission.payloadBytes,
      snapshotPayload: submission.capture,
    })]]);

    await expect(loader.loadPlanAuthority({
      ownerUserId: 'owner-1',
      listingWorkflowId: 'listing-workflow-1',
    })).resolves.toMatchObject({ candidateMediaKeys: ['media-main-0'] });
  });

  it('rejects capture SKU identities that collide after NFKC normalization', async () => {
    const capturedSkuKey = 'sku:variant\uff081.5cm+4cm\uff09';
    const canonicalSkuKey = capturedSkuKey.normalize('NFKC');
    const capture = structuredClone(captureFixture.capture);
    capture.skus[0]!.key = capturedSkuKey;
    const duplicate = structuredClone(capture.skus[0]!);
    duplicate.key = canonicalSkuKey;
    duplicate.ordinal = 1;
    duplicate.sourceSkuId = 'sku-source-1';
    duplicate.mediaKeys = [];
    duplicate.fieldEvidence.sourceSkuId.value = duplicate.sourceSkuId;
    capture.skus.push(duplicate);
    capture.facts.selectedSkuKey = capturedSkuKey;
    capture.fieldEvidence.selectedSkuKey.value = capturedSkuKey;
    capture.prices[0]!.skuKey = capturedSkuKey;
    capture.prices[0]!.fieldEvidence.skuKey.value = capturedSkuKey;
    capture.media[0]!.skuKeys = [capturedSkuKey];
    Object.assign(capture.counts.find((row) => row.fieldPath === '/skus')!, {
      totalCount: 2,
      capturedCount: 2,
      submittedCount: 2,
    });
    const submission = await createSourceProductCaptureV2Submission(capture);
    await expect(verifySourceProductCaptureV2Submission(submission)).resolves.toMatchObject({
      valid: true,
    });
    const { loader } = fixture([[planRow({
      workflowSelectedSkuKeys: [canonicalSkuKey],
      draftSelectedSkuKeys: [canonicalSkuKey],
      snapshotCaptureHash: submission.captureHash,
      snapshotPayloadBytes: submission.payloadBytes,
      snapshotPayload: submission.capture,
    })]]);

    await expect(loader.loadPlanAuthority({
      ownerUserId: 'owner-1',
      listingWorkflowId: 'listing-workflow-1',
    })).resolves.toBeNull();
  });

  it('returns null when capture verification rejects an unknown media SKU reference', async () => {
    const capture = structuredClone(captureFixture.capture);
    capture.media[0]!.skuKeys = ['missing-sku'];
    const submission = await createSourceProductCaptureV2Submission(capture);
    await expect(verifySourceProductCaptureV2Submission(submission)).resolves.toMatchObject({
      valid: false,
    });
    const { loader } = fixture([[planRow({
      snapshotCaptureHash: submission.captureHash,
      snapshotPayloadBytes: submission.payloadBytes,
      snapshotPayload: submission.capture,
    })]]);

    await expect(loader.loadPlanAuthority({
      ownerUserId: 'owner-1',
      listingWorkflowId: 'listing-workflow-1',
    })).resolves.toBeNull();
  });

  it.each([
    'CATEGORY_REVIEW',
    'ATTRIBUTE_REVIEW',
    'CONTENT_REVIEW',
    'MEDIA_REVIEW',
    'PRICING_REVIEW',
    'VALIDATION',
  ] as const)('returns the actual matching active %s draft stage for mode-lock authority', async (
    draftStage,
  ) => {
    const { loader } = fixture([[planRow({
      workflowStage: draftStage,
      draftStage,
    })]]);

    await expect(loader.loadPlanAuthority({
      ownerUserId: 'owner-1',
      listingWorkflowId: 'listing-workflow-1',
    })).resolves.toMatchObject({
      workflowStatus: 'ACTIVE',
      draftStage,
    });
  });

  it('derives the reserved product-only SKU from a verified capture with no SKU rows', async () => {
    const capture = structuredClone(captureFixture.capture);
    capture.skus = [];
    capture.facts.selectedSkuKey = null;
    capture.fieldEvidence.selectedSkuKey = {
      ...capture.fieldEvidence.selectedSkuKey,
      value: null,
      missingReason: 'not_applicable',
      derivedFrom: ['/skus'],
    };
    const price = capture.prices[0]!;
    price.skuKey = null;
    price.fieldEvidence.skuKey = {
      ...price.fieldEvidence.skuKey,
      value: null,
      missingReason: 'not_applicable',
      derivedFrom: ['/skus'],
    };
    Object.assign(capture.counts.find((row) => row.fieldPath === '/skus')!, {
      totalCount: 0,
      capturedCount: 0,
      submittedCount: 0,
    });
    const submission = await createSourceProductCaptureV2Submission(capture);
    const { loader } = fixture([[planRow({
      workflowSelectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
      draftSelectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
      snapshotCaptureHash: submission.captureHash,
      snapshotPayloadBytes: submission.payloadBytes,
      snapshotPayload: submission.capture,
    })]]);

    await expect(loader.loadPlanAuthority({
      ownerUserId: 'owner-1',
      listingWorkflowId: 'listing-workflow-1',
    })).resolves.toMatchObject({
      selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
      capturedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
      candidateMediaKeys: ['media-main-0'],
    });
  });

  it.each([
    ['stale workflow draft', { workflowRevision: 6 }],
    ['stale source capture', { latestSnapshotId: 'snapshot-2' }],
    ['foreign shop', { shopOwnerUserId: 'owner-2' }],
    ['foreign owner', { subjectOwnerUserId: 'owner-2' }],
    ['inactive workflow', { workflowStatus: 'COMPLETED' }],
    ['wrong stage', { draftStage: 'COPY_REVIEW' }],
    ['ready-to-publish draft', {
      workflowStage: 'READY_TO_PUBLISH',
      draftStage: 'READY_TO_PUBLISH',
      draftStatus: 'READY',
    }],
    ['publish-intent draft', {
      workflowStage: 'PUBLISH_INTENT_RECORDED',
      draftStage: 'PUBLISH_INTENT_RECORDED',
      draftStatus: 'READY',
    }],
    ['published workflow', { workflowStage: 'PUBLISHED', draftStage: 'PUBLISHED' }],
    ['mismatched workflow and draft stages', {
      workflowStage: 'CATEGORY_REVIEW',
      draftStage: 'ATTRIBUTE_REVIEW',
    }],
    ['selected SKU absent from capture', {
      workflowSelectedSkuKeys: ['sku-missing'],
      draftSelectedSkuKeys: ['sku-missing'],
    }],
    ['legacy source SKU alias stored as the selected key', {
      workflowSelectedSkuKeys: ['sku-source-0'],
      draftSelectedSkuKeys: ['sku-source-0'],
    }],
  ])('returns null for %s plan authority', async (_name, overrides) => {
    const { loader } = fixture([[planRow(overrides)]]);
    await expect(loader.loadPlanAuthority({
      ownerUserId: 'owner-1',
      listingWorkflowId: 'listing-workflow-1',
    })).resolves.toBeNull();
  });

  it('returns null for malformed source capture JSON', async () => {
    const { loader } = fixture([[planRow({
      snapshotPayload: { captureVersion: 'source-product-capture-v2', skus: 'not-an-array' },
    })]]);
    await expect(loader.loadPlanAuthority({
      ownerUserId: 'owner-1',
      listingWorkflowId: 'listing-workflow-1',
    })).resolves.toBeNull();
  });

  it('loads an exact paid hosted candidate without exposing Provider, Prompt, or URL fields', async () => {
    const { loader, query } = fixture([[bindingRow()], [graphRow()]]);

    const authority = await loader.loadCandidateAuthority(candidateInput());

    expect(authority).toMatchObject({
      ownerUserId: 'owner-1',
      binding,
      plan: { id: 'plan-1', revision: 3, reviewStatus: 'APPROVED' },
      suite: { id: 'suite-1', revision: 9, status: 'SUCCEEDED' },
      slot: { id: 'slot-1', revision: 5, attempt: 1 },
      workflow: { id: 'workflow-1', revision: 4, reviewStatus: 'PENDING' },
      job: {
        id: 'job-1',
        executionMode: 'ERP_HOSTED',
        status: 'SUCCEEDED',
        costReservationStatus: 'SETTLED',
      },
      output: {
        id: 'asset-1',
        kind: 'AI_GENERATED',
        storageBackend: 'oss',
        mimeType: 'image/png',
      },
    });
    expect(JSON.stringify(authority)).not.toMatch(/provider|model|prompt|https?:\/\//iu);
    expect(query).toHaveBeenCalledTimes(2);
    const [bindingSql, ...bindingValues] = query.mock.calls[0]!;
    expect(bindingSql).toMatch(/extension_hosted_ai_image_plan_bindings/u);
    expect(bindingValues).toEqual([
      'owner-1', 'device-session-1', 'listing-workflow-1', 5, 7,
      'snapshot-1', 'goods-1', 'shop-1', 'plan-1',
    ]);
    const [graphSql, ...graphValues] = query.mock.calls[1]!;
    expect(graphSql).toMatch(/"execution_mode"/u);
    expect(graphSql).toMatch(/ai_cost_settlements/u);
    expect(graphSql).toMatch(
      /settlement\."kind" IN \(\s*'CHARGE'::"AiCostSettlementKind",\s*'RECONCILED_CHARGE'::"AiCostSettlementKind"\s*\)/u,
    );
    expect(graphSql).not.toMatch(/output\."url"/u);
    expect(graphValues).toEqual([
      ...bindingValues,
      'plan-version-1', 3, 'suite-1', 9, 'slot-1', 5,
      'workflow-1', 4, 'asset-1',
    ]);
  });

  it('stops after the binding lookup for an unbound plan', async () => {
    const { loader, query } = fixture([[]]);
    await expect(loader.loadCandidateAuthority(candidateInput())).resolves.toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });

  it('previews a frozen reference subset sealed to the complete authorized media set', async () => {
    const selectedHash = createHash('sha256').update(JSON.stringify(['media-selected'])).digest('hex');
    const snapshot = { candidates: [{ id: 'media-selected' }], referenceSelection: {
      authorityCandidateMediaHash: persistedBinding.candidateMediaHash,
    } };
    const { loader } = fixture([[bindingRow()], [graphRow({
      planVersionCandidateMediaHash: selectedHash, planVersionInputSnapshot: snapshot,
    })]]);
    await expect(loader.loadCandidateAuthority(candidateInput())).resolves.toMatchObject({ output: { id: 'asset-1' } });
    for (const changed of [
      { ...snapshot, referenceSelection: { authorityCandidateMediaHash: 'f'.repeat(64) } },
      { ...snapshot, candidates: [{ id: 'different-selected' }] },
      { ...snapshot, referenceSelection: null },
      { ...snapshot, referenceSelection: { ...snapshot.referenceSelection, callerApproved: true } },
    ]) {
      const { loader: rejected } = fixture([[bindingRow()], [graphRow({
        planVersionCandidateMediaHash: selectedHash, planVersionInputSnapshot: changed,
      })]]);
      await expect(rejected.loadCandidateAuthority(candidateInput())).resolves.toBeNull();
    }
  });

  it.each([
    'CATEGORY_REVIEW', 'ATTRIBUTE_REVIEW', 'CONTENT_REVIEW',
    'MEDIA_REVIEW', 'PRICING_REVIEW', 'VALIDATION',
  ] as const)('loads the exact settled candidate for matching active %s draft stages', async (stage) => {
    const { loader } = fixture([[bindingRow()], [graphRow({ listingStage: stage, draftStage: stage })]]);
    await expect(loader.loadCandidateAuthority(candidateInput())).resolves.toMatchObject({
      binding, output: { id: 'asset-1', width: 900, height: 1200 },
    });
  });

  it.each([
    ['cross-device row', createExtensionHostedAiImagePlanBindingRecord({
      planId: binding.planId,
      identity: {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'device-session-2',
      },
      binding: {
        snapshotId: binding.snapshotId,
        supplyGoodsId: binding.supplyGoodsId,
        shopId: binding.shopId,
        listingWorkflowId: binding.listingWorkflowId,
        draftRevision: binding.draftRevision,
        draftVersion: binding.draftVersion,
      },
      selectedSkuKeys: ['sku-0'], candidateMediaKeys: ['media-main-0'],
    })],
    ['foreign-owner row', createExtensionHostedAiImagePlanBindingRecord({
      planId: binding.planId,
      identity: {
        ownerUserId: 'owner-2', actorUserId: 'owner-2', deviceSessionId: 'device-session-1',
      },
      binding: {
        snapshotId: binding.snapshotId,
        supplyGoodsId: binding.supplyGoodsId,
        shopId: binding.shopId,
        listingWorkflowId: binding.listingWorkflowId,
        draftRevision: binding.draftRevision,
        draftVersion: binding.draftVersion,
      },
      selectedSkuKeys: ['sku-0'], candidateMediaKeys: ['media-main-0'],
    })],
    ['foreign-shop row', createExtensionHostedAiImagePlanBindingRecord({
      planId: binding.planId,
      identity: {
        ownerUserId: 'owner-1', actorUserId: 'owner-1', deviceSessionId: 'device-session-1',
      },
      binding: {
        snapshotId: binding.snapshotId,
        supplyGoodsId: binding.supplyGoodsId,
        shopId: 'shop-2',
        listingWorkflowId: binding.listingWorkflowId,
        draftRevision: binding.draftRevision,
        draftVersion: binding.draftVersion,
      },
      selectedSkuKeys: ['sku-0'], candidateMediaKeys: ['media-main-0'],
    })],
  ])('rejects a %s before loading candidate graph authority', async (_name, row) => {
    const { loader, query } = fixture([[row]]);
    await expect(loader.loadCandidateAuthority(candidateInput())).resolves.toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });

  it.each([
    ['stale draft', { currentDraftRevision: 6 }],
    ['inactive listing', { listingStatus: 'CANCELLED' }],
    ['inactive draft', { draftStatus: 'CANCELLED' }],
    ['ready-to-publish draft', { listingStage: 'READY_TO_PUBLISH', draftStage: 'READY_TO_PUBLISH' }],
    ['recorded publish intent', { listingStage: 'PUBLISH_INTENT_RECORDED', draftStage: 'PUBLISH_INTENT_RECORDED' }],
    ['published draft', { listingStage: 'PUBLISHED', draftStage: 'PUBLISHED' }],
    ['mismatched active stages', { listingStage: 'CATEGORY_REVIEW', draftStage: 'ATTRIBUTE_REVIEW' }],
    ['stale plan revision', { planRevision: 4 }],
    ['stale suite revision', { suiteRevision: 10 }],
    ['stale slot revision', { slotRevision: 6 }],
    ['stale workflow revision', { workflowRevision: 5 }],
    ['raw Provider output', {
      outputKind: 'AI_PROVIDER_OUTPUT',
      outputMetadata: {
        version: 'ai-image-suite-provider-output/v1',
        normalizerVersion: 'ai-image-suite-output-normalizer/v1',
        suiteId: 'suite-1', slotId: 'slot-1', attempt: 1,
      },
    }],
    ['unsettled reservation', { reservationStatus: 'RESERVED', settledCostEvidence: false }],
    ['non-hosted job', { jobExecutionMode: 'BYOK' }],
    ['fake or unpaid Provider evidence', { paidHosted: false }],
  ])('returns null for %s candidate authority', async (_name, overrides) => {
    const { loader } = fixture([[bindingRow()], [graphRow(overrides)]]);
    await expect(loader.loadCandidateAuthority(candidateInput())).resolves.toBeNull();
  });

  it('rejects a binding row whose stored binding hash is not valid for its fields', async () => {
    const { loader, query } = fixture([[
      bindingRow({ selectedSkuHash: 'f'.repeat(64) }),
    ]]);
    await expect(loader.loadCandidateAuthority(candidateInput())).resolves.toBeNull();
    expect(query).toHaveBeenCalledOnce();
  });
});

import { createHash } from 'node:crypto';
import type { OzonListingDraft, OzonListingDraftMediaAssignment } from 'shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createHostedSuiteListingDraftAssignmentRequestHash,
  type AssignHostedSuiteOutputToListingDraftInput,
  type HostedSuiteListingDraftAssignmentCommitInput,
  type HostedSuiteListingDraftAssignmentRecord,
} from '../services/hosted-suite-listing-draft-assignment.js';
import {
  createPrismaHostedSuiteListingDraftAssignmentRepository,
  type HostedSuiteListingDraftAssignmentPrismaClient,
  type HostedSuiteListingDraftAssignmentPrismaTransaction,
} from '../services/hosted-suite-listing-draft-assignment-prisma.js';
import { OzonListingDraftRepositoryError } from '../services/ozon-listing-draft.js';

const workflowMocks = vi.hoisted(() => ({
  lockCurrent: vi.fn(),
  applyCas: vi.fn(),
}));

vi.mock('../services/source-listing-workflow-prisma.js', () => ({
  lockCurrentSourceListingDraft: workflowMocks.lockCurrent,
  applySourceListingDraftCasInTransaction: workflowMocks.applyCas,
}));

const NOW = new Date('2026-07-27T08:00:00.000Z');
const SNAPSHOT_HASH = 'a'.repeat(64);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  const item = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])]));
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function sourceAssignment(): OzonListingDraftMediaAssignment {
  return {
    scope: 'SKU',
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:source',
    assetId: 'source-asset-1',
    source: 'SOURCE',
  };
}

function draft(assignments = [sourceAssignment()]): OzonListingDraft {
  return {
    id: 'listing-workflow-1',
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: SNAPSHOT_HASH,
    selectedSkuKeys: ['sku-1', 'sku-2'],
    draftVersion: 7,
    revision: 5,
    stage: 'MEDIA_REVIEW',
    runState: 'ACTIVE',
    runStateReason: null,
    category: null,
    attributes: { values: {} },
    copy: { publishTitleRu: null, publishDescriptionRu: null, candidates: [], applyAudit: [] },
    media: { assignments },
    pricing: { value: null },
    validation: { status: 'VALID', report: null },
    completedStepHashes: {},
    blockers: [],
    warnings: [],
    publishTaskIds: [],
    freshness: {
      category: { state: 'CURRENT', reason: null },
      attributes: { state: 'CURRENT', reason: null },
      content: { state: 'CURRENT', reason: null },
      media: { state: 'CURRENT', reason: null },
      pricing: { state: 'CURRENT', reason: null },
      validation: { state: 'CURRENT', reason: null },
    },
    grantRevocation: { required: false, reason: null, previousShopId: null },
    auditEvents: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  } as OzonListingDraft;
}

function item(index: number) {
  const ordinal = index + 1;
  return {
    skuKey: `sku-${ordinal}`,
    slotKey: `sku:sku-${ordinal}:hero`,
    suiteSlotId: `suite-slot-${ordinal}`,
    expectedSuiteSlotRevision: 4 + index,
    childWorkflowId: `child-workflow-${ordinal}`,
    expectedChildWorkflowRevision: 3 + index,
    outputAssetId: `hosted-output-${ordinal}`,
  };
}

function command(): AssignHostedSuiteOutputToListingDraftInput {
  return {
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    deviceSessionId: 'device-session-1',
    shopId: 'shop-1',
    listingWorkflowId: 'listing-workflow-1',
    expectedDraftRevision: 5,
    expectedDraftVersion: 7,
    sourceCaptureSnapshotId: 'snapshot-1',
    assignmentStartOrdinal: 1,
    planId: 'plan-1',
    planVersionId: 'plan-version-1',
    expectedPlanRevision: 6,
    suiteId: 'suite-1',
    expectedSuiteRevision: 9,
    idempotencyKey: 'hosted-draft-assignment-batch-0001',
    items: [item(0), item(1)],
  };
}

function planInputSnapshot() {
  return {
    source: { subjectId: 'source-subject-1', snapshotId: 'snapshot-1' },
    context: { type: 'collect', id: 'goods-1' },
    skus: [{ skuKey: 'sku-1' }, { skuKey: 'sku-2' }],
    candidates: [{ id: 'candidate-media-1' }],
  };
}

function planPayload(grouped = false) {
  return {
    compatibilityGroups: grouped
      ? [{ groupKey: 'group-1', identitySignature: '{}', skuKeys: ['sku-1', 'sku-2'] }]
      : [],
    slots: [
      {
        slotKey: 'sku:sku-1:hero',
        ownership: { level: 'sku', key: 'sku-1' },
      },
      grouped
        ? {
          slotKey: 'sku:sku-2:hero',
          ownership: { level: 'compatibility_group', key: 'group-1' },
        }
        : {
          slotKey: 'sku:sku-2:hero',
          ownership: { level: 'sku', key: 'sku-2' },
        },
    ],
  };
}

function bindingValues() {
  const authority = {
    ownerUserId: 'owner-1',
    snapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    shopId: 'shop-1',
    listingWorkflowId: 'listing-workflow-1',
    draftRevision: 5,
    draftVersion: 7,
    selectedSkuHash: hash(['sku-1', 'sku-2']),
    candidateMediaHash: hash(['candidate-media-1']),
  };
  const authorityHash = hash(authority);
  const value = {
    planId: 'plan-1',
    deviceSessionId: 'device-session-1',
    ...authority,
    authorityHash,
  };
  return { ...value, bindingHash: hash(value) };
}

function authorityRow(index: number, overrides: Record<string, unknown> = {}) {
  const request = item(index);
  const ordinal = index + 1;
  const fingerprint = String.fromCharCode(98 + index).repeat(64);
  const binding = bindingValues();
  return {
    actorId: 'actor-1',
    actorParentId: 'owner-1',
    actorStatus: 'ACTIVE',
    deviceSessionId: 'device-session-1',
    deviceId: 'device-1',
    deviceOwnerUserId: 'owner-1',
    deviceActorUserId: 'actor-1',
    deviceRevokedAt: null,
    deviceExpiresAt: new Date('2026-07-28T08:00:00.000Z'),
    deviceScopes: ['media:read', 'listing:write'],
    deviceShopIds: ['shop-1'],
    shopId: 'shop-1',
    shopOwnerUserId: 'owner-1',
    shopStatus: 'ACTIVE',
    bindingPlanId: binding.planId,
    bindingOwnerUserId: binding.ownerUserId,
    bindingDeviceSessionId: binding.deviceSessionId,
    bindingShopId: binding.shopId,
    bindingListingWorkflowId: binding.listingWorkflowId,
    bindingSnapshotId: binding.snapshotId,
    bindingSupplyGoodsId: binding.supplyGoodsId,
    bindingDraftRevision: binding.draftRevision,
    bindingDraftVersion: binding.draftVersion,
    bindingSelectedSkuHash: binding.selectedSkuHash,
    bindingCandidateMediaHash: binding.candidateMediaHash,
    bindingAuthorityHash: binding.authorityHash,
    bindingHash: binding.bindingHash,
    planId: 'plan-1',
    planOwnerUserId: 'owner-1',
    planActorUserId: 'actor-1',
    planRevision: 6,
    planContextType: 'collect',
    planContextId: 'goods-1',
    planCurrentVersionId: 'plan-version-1',
    planApprovedVersionId: 'plan-version-1',
    planReviewStatus: 'APPROVED',
    planStaleAt: null,
    planVersionId: 'plan-version-1',
    planVersionPlanId: 'plan-1',
    planVersionOwnerUserId: 'owner-1',
    planVersionSourceSubjectId: 'source-subject-1',
    planVersionSnapshotId: 'snapshot-1',
    planVersionSourceHash: SNAPSHOT_HASH,
    planVersionInputSnapshot: planInputSnapshot(),
    planVersionPayload: planPayload(),
    suiteId: 'suite-1',
    suiteOwnerUserId: 'owner-1',
    suiteActorUserId: 'actor-1',
    suitePlanId: 'plan-1',
    suitePlanVersionId: 'plan-version-1',
    suiteSourceSubjectId: 'source-subject-1',
    suiteSnapshotId: 'snapshot-1',
    suiteSourceHash: SNAPSHOT_HASH,
    suiteContextType: 'collect',
    suiteContextId: 'goods-1',
    suiteStatus: 'SUCCEEDED',
    suiteRevision: 9,
    suiteProvider: 'custom',
    suiteModel: 'image-model-v1',
    suiteItemCount: 2,
    suiteCompletedAt: new Date('2026-07-27T07:56:00.000Z'),
    suiteSlotId: request.suiteSlotId,
    suiteSlotSuiteId: 'suite-1',
    suiteSlotOwnerUserId: 'owner-1',
    suiteSlotOrdinal: index,
    suiteSlotKey: request.slotKey,
    suiteSlotOwnershipLevel: 'sku',
    suiteSlotOwnershipKey: request.skuKey,
    suiteSlotCompatibilityGroupKey: null,
    suiteSlotStatus: 'SUCCEEDED',
    suiteSlotAttempt: 2,
    suiteSlotRevision: request.expectedSuiteSlotRevision,
    suiteSlotChildWorkflowId: request.childWorkflowId,
    childWorkflowId: request.childWorkflowId,
    childOwnerUserId: 'owner-1',
    childActorUserId: 'actor-1',
    childStatus: 'SUCCEEDED',
    childReviewStatus: 'APPROVED',
    childRevision: request.expectedChildWorkflowRevision,
    childCurrentAttempt: 2,
    childOperation: 'IMAGE_TO_IMAGE',
    childContextType: 'collect',
    childContextId: 'goods-1',
    childContextSkuKey: request.skuKey,
    childContextSlotKey: request.slotKey,
    childSelectedOutputAssetId: request.outputAssetId,
    childReviewedByUserId: 'owner-1',
    childReviewedAt: new Date('2026-07-27T07:58:00.000Z'),
    childInputSnapshotIds: ['snapshot-1'],
    jobId: `job-${ordinal}`,
    jobOwnerUserId: 'owner-1',
    jobActorUserId: 'actor-1',
    jobWorkflowId: request.childWorkflowId,
    jobWorkflowAttempt: 2,
    jobExecutionMode: 'ERP_HOSTED',
    jobStatus: 'SUCCEEDED',
    jobOperation: 'IMAGE_TO_IMAGE',
    jobProvider: 'custom',
    jobModel: 'image-model-v1',
    jobRequestFingerprint: fingerprint,
    jobActualCostMinor: 18 + index,
    jobBilledUnits: 1,
    jobAppliedAt: null,
    reservationId: `reservation-${ordinal}`,
    reservationOwnerUserId: 'owner-1',
    reservationActorUserId: 'actor-1',
    reservationWorkflowId: request.childWorkflowId,
    reservationJobId: `job-${ordinal}`,
    reservationStatus: 'SETTLED',
    reservationProvider: 'custom',
    reservationModel: 'image-model-v1',
    reservationOperation: 'IMAGE_TO_IMAGE',
    reservationRequestFingerprint: fingerprint,
    reservationSettledAt: new Date('2026-07-27T07:57:00.000Z'),
    settlementId: `settlement-${ordinal}`,
    settlementReservationId: `reservation-${ordinal}`,
    settlementOwnerUserId: 'owner-1',
    settlementActorUserId: 'actor-1',
    settlementKind: 'CHARGE',
    settlementRequestFingerprint: fingerprint,
    settlementActualCostMinor: 18 + index,
    settlementBilledUnits: 1,
    assetId: request.outputAssetId,
    assetOwnerUserId: 'owner-1',
    assetJobId: `job-${ordinal}`,
    assetKind: 'AI_GENERATED',
    assetSnapshotId: 'snapshot-1',
    assetStorageBackend: 'oss',
    assetStorageKey: `owners/owner-1/ai/suite-1/output-${ordinal}.png`,
    assetMimeType: 'image/png',
    assetSizeBytes: 128_000,
    assetWidth: 900,
    assetHeight: 1200,
    assetSha256: String.fromCharCode(100 + index).repeat(64),
    assetMetadata: {
      version: 'ai-image-suite-output/v1',
      suiteId: 'suite-1',
      slotId: request.suiteSlotId,
      attempt: 2,
      providerOutputAssetId: `provider-output-${ordinal}`,
    },
    ...overrides,
  };
}

function recordsFor(input = command()): HostedSuiteListingDraftAssignmentRecord[] {
  const requestHash = createHostedSuiteListingDraftAssignmentRequestHash(input);
  const batchId = `hosted-assignment-batch:${requestHash.slice(0, 48)}`;
  return input.items.map((request, index) => ({
    contractVersion: 'hosted-suite-listing-draft-assignment/v2',
    batchId,
    batchItemOrdinal: index,
    assignmentId: `hosted-assignment:${requestHash.slice(0, 40)}:${index}`,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    authorityHash: String.fromCharCode(102 - index).repeat(64),
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    deviceSessionId: input.deviceSessionId,
    shopId: input.shopId,
    listingWorkflowId: input.listingWorkflowId,
    sourceDraftRevision: input.expectedDraftRevision,
    sourceDraftVersion: input.expectedDraftVersion,
    boundDraftRevision: input.expectedDraftRevision + 1,
    boundDraftVersion: input.expectedDraftVersion + 1,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    assignmentScope: 'SKU',
    skuKey: request.skuKey,
    slotKey: request.slotKey,
    assignmentOrdinal: input.assignmentStartOrdinal + index,
    assetId: request.outputAssetId,
    assetSha256: String.fromCharCode(100 + index).repeat(64),
    assignmentSha256: String.fromCharCode(54 + index).repeat(64),
    planId: input.planId,
    planVersionId: input.planVersionId,
    planRevision: input.expectedPlanRevision,
    suiteId: input.suiteId,
    suiteSlotId: request.suiteSlotId,
    childWorkflowId: request.childWorkflowId,
    jobId: `job-${index + 1}`,
    reservationId: `reservation-${index + 1}`,
    settlementId: `settlement-${index + 1}`,
    createdAt: NOW,
  }));
}

function nextDraft(): OzonListingDraft {
  const next = structuredClone(draft());
  next.revision = 6;
  next.draftVersion = 8;
  for (const request of command().items) {
    next.media.assignments.push({
      scope: 'SKU',
      skuKey: request.skuKey,
      slotKey: request.slotKey,
      assetId: request.outputAssetId,
      source: 'GENERATED',
    });
  }
  return next;
}

function commitInput(): HostedSuiteListingDraftAssignmentCommitInput {
  const input = command();
  const records = recordsFor(input);
  return {
    idempotencyKey: input.idempotencyKey,
    requestHash: records[0]!.requestHash,
    batchId: records[0]!.batchId,
    appliedAt: NOW,
    records,
    nextDraft: nextDraft(),
    expected: {
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      deviceSessionId: input.deviceSessionId,
      shopId: input.shopId,
      listingWorkflowId: input.listingWorkflowId,
      draftRevision: input.expectedDraftRevision,
      draftVersion: input.expectedDraftVersion,
      sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
      sourceCaptureHash: SNAPSHOT_HASH,
      assignmentStartOrdinal: input.assignmentStartOrdinal,
      planId: input.planId,
      planVersionId: input.planVersionId,
      planRevision: input.expectedPlanRevision,
      suiteId: input.suiteId,
      suiteRevision: input.expectedSuiteRevision,
      items: input.items.map((request, index) => ({
        batchItemOrdinal: index,
        assignmentScope: 'SKU',
        skuKey: request.skuKey,
        slotKey: request.slotKey,
        assignmentOrdinal: input.assignmentStartOrdinal + index,
        planSlotOrdinal: index,
        suiteSlotId: request.suiteSlotId,
        suiteSlotRevision: request.expectedSuiteSlotRevision,
        childWorkflowId: request.childWorkflowId,
        childWorkflowRevision: request.expectedChildWorkflowRevision,
        childWorkflowAttempt: 2,
        jobId: `job-${index + 1}`,
        outputAssetId: request.outputAssetId,
        reservationId: `reservation-${index + 1}`,
        settlementId: `settlement-${index + 1}`,
        requestFingerprint: String.fromCharCode(98 + index).repeat(64),
        actualCostMinor: 18 + index,
        billedUnits: 1,
        assetSha256: String.fromCharCode(100 + index).repeat(64),
      })),
    },
  };
}

function ledgerRow(value: HostedSuiteListingDraftAssignmentRecord, overrides = {}) {
  return { ...value, executionMode: 'ERP_HOSTED', ...overrides };
}

interface FixtureOptions {
  ledgerLookups?: unknown[][];
  authorityRows?: unknown[][];
  insertRows?: unknown[];
  changedJobs?: Array<{ id: string }>;
}

function fixture(options: FixtureOptions = {}) {
  const ledgerLookups = [...(options.ledgerLookups || [])];
  const authorityRows = [...(options.authorityRows || [[authorityRow(0), authorityRow(1)]])];
  const query = vi.fn(async (sql: string, ..._params: unknown[]): Promise<unknown> => {
    if (sql.includes('INSERT INTO "extension_hosted_ai_image_listing_assignments"')) {
      return options.insertRows ?? recordsFor().map((entry) => ledgerRow(entry));
    }
    if (sql.includes('FROM "extension_hosted_ai_image_listing_assignments"')) {
      return ledgerLookups.shift() || [];
    }
    if (sql.includes('FROM "users" actor_account')) return authorityRows.shift() || [];
    if (sql.includes('UPDATE "ai_image_jobs"')) {
      return options.changedJobs ?? [{ id: 'job-1' }, { id: 'job-2' }];
    }
    throw new Error(`Unexpected SQL: ${sql.slice(0, 100)}`);
  });
  const execute = vi.fn(async (_sql: string, ..._params: unknown[]) => 0);
  const transaction: HostedSuiteListingDraftAssignmentPrismaTransaction = {
    $queryRawUnsafe: query as HostedSuiteListingDraftAssignmentPrismaTransaction['$queryRawUnsafe'],
    $executeRawUnsafe: execute,
    $transaction: vi.fn(),
  };
  const client: HostedSuiteListingDraftAssignmentPrismaClient = {
    ...transaction,
    $transaction: vi.fn(async (operation) => operation(transaction)),
  };
  return {
    client,
    query,
    execute,
    repository: createPrismaHostedSuiteListingDraftAssignmentRepository(client),
  };
}

beforeEach(() => {
  workflowMocks.lockCurrent.mockReset().mockResolvedValue(draft());
  workflowMocks.applyCas.mockReset().mockResolvedValue(nextDraft());
});

describe('Prisma hosted suite listing draft atomic batch repository', () => {
  it('uses a serializable transaction and reads every replay row in batch order', async () => {
    const records = recordsFor();
    const { client, repository, query } = fixture({
      ledgerLookups: [[...records].reverse().map((entry) => ledgerRow(entry))],
    });
    await expect(repository.transaction((tx) => tx.findReplay({
      ownerUserId: 'owner-1',
      idempotencyKey: command().idempotencyKey,
    }))).resolves.toMatchObject({
      batchId: records[0]!.batchId,
      records: [{ batchItemOrdinal: 0 }, { batchItemOrdinal: 1 }],
    });
    expect(client.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: 'Serializable' },
    );
    expect(query.mock.calls[0]![0]).toMatch(/ORDER BY "batch_item_ordinal"/u);
  });

  it('loads the immutable original binding and the complete two-slot manifest', async () => {
    const { repository, query } = fixture();
    const loaded = await repository.transaction((tx) => tx.loadAuthority(command()));
    expect(loaded?.plan.listingBinding).toEqual({
      ownerUserId: 'owner-1',
      deviceSessionId: 'device-session-1',
      shopId: 'shop-1',
      listingWorkflowId: 'listing-workflow-1',
      draftRevision: 5,
      draftVersion: 7,
      sourceCaptureSnapshotId: 'snapshot-1',
      selectedSkuKeys: ['sku-1', 'sku-2'],
    });
    expect(loaded?.slots.map((slot) => ({
      ordinal: slot.suiteSlot.ordinal,
      slotKey: slot.planSlot.slotKey,
      skuKeys: slot.planSlot.skuKeys,
    }))).toEqual([
      { ordinal: 0, slotKey: 'sku:sku-1:hero', skuKeys: ['sku-1'] },
      { ordinal: 1, slotKey: 'sku:sku-2:hero', skuKeys: ['sku-2'] },
    ]);
    const authorityCall = query.mock.calls.find(([sql]) => String(sql).includes(
      'FROM "users" actor_account',
    ));
    expect(authorityCall?.[0]).toMatch(/JOIN "extension_hosted_ai_image_plan_bindings" binding/u);
    expect(authorityCall?.[0]).toMatch(/ORDER BY suite_slot\."ordinal" ASC/u);
    expect(authorityCall?.[0]).toMatch(
      /'CHARGE'::"AiCostSettlementKind"[\s\S]*'RECONCILED_CHARGE'::"AiCostSettlementKind"/u,
    );
    expect(authorityCall?.slice(1)).toEqual([
      'owner-1', 'actor-1', 'device-session-1', 'shop-1', 'listing-workflow-1',
      'snapshot-1', 5, 7, 'plan-1', 'plan-version-1', 'suite-1',
    ]);
  });

  it('parses exact compatibility-group members from the frozen plan', async () => {
    const groupedRow = authorityRow(1, {
      planVersionPayload: planPayload(true),
      suiteSlotOwnershipLevel: 'compatibility_group',
      suiteSlotOwnershipKey: 'group-1',
      suiteSlotCompatibilityGroupKey: 'group-1',
      childContextSkuKey: null,
    });
    const first = authorityRow(0, { planVersionPayload: planPayload(true) });
    const { repository } = fixture({ authorityRows: [[first, groupedRow]] });
    const loaded = await repository.transaction((tx) => tx.loadAuthority(command()));
    expect(loaded?.slots[1]?.planSlot).toMatchObject({
      ownershipLevel: 'compatibility_group',
      ownershipKey: 'group-1',
      skuKeys: ['sku-1', 'sku-2'],
    });
  });

  it('accepts an immutable reference subset without rewriting the complete media binding', async () => {
    const authority = { ...bindingValues(), candidateMediaHash: hash(['candidate-media-1', 'candidate-media-2']) };
    const { bindingHash: _bindingHash, authorityHash: _authorityHash, planId, deviceSessionId, ...scope } = authority;
    const authorityHash = hash(scope), bindingHash = hash({ planId, deviceSessionId, ...scope, authorityHash });
    const snapshot = { ...planInputSnapshot(), referenceSelection: { authorityCandidateMediaHash: scope.candidateMediaHash } };
    const rows = [0, 1].map(index => authorityRow(index, { bindingCandidateMediaHash: scope.candidateMediaHash,
      bindingAuthorityHash: authorityHash, bindingHash, planVersionInputSnapshot: snapshot }));
    const { repository } = fixture({ authorityRows: [rows] });
    await expect(repository.transaction(tx => tx.loadAuthority(command()))).resolves.toMatchObject({
      plan: { listingBinding: { listingWorkflowId: 'listing-workflow-1' } },
    });
    for (const selection of [null, { authorityCandidateMediaHash: 'f'.repeat(64) },
      { authorityCandidateMediaHash: scope.candidateMediaHash, callerApproved: true }]) {
      const { repository: rejected } = fixture({ authorityRows: [rows.map(row => ({ ...row,
        planVersionInputSnapshot: { ...snapshot, referenceSelection: selection } }))] });
      await expect(rejected.transaction(tx => tx.loadAuthority(command()))).resolves.toBeNull();
    }
  });

  it('rejects forged binding hashes before exposing authority', async () => {
    const forged = authorityRow(0, { bindingAuthorityHash: 'f'.repeat(64) });
    const { repository } = fixture({ authorityRows: [[forged, authorityRow(1)]] });
    await expect(repository.transaction((tx) => tx.loadAuthority(command())))
      .resolves.toBeNull();
  });

  it('classifies an exact whole-batch replay separately from a key conflict', async () => {
    const input = commitInput();
    const exact = fixture({
      ledgerLookups: [input.records.map((entry) => ledgerRow(entry))],
    });
    await expect(exact.repository.transaction((tx) => tx.commit(input))).resolves.toMatchObject({
      kind: 'replayed',
      batch: { records: [{ assignmentId: input.records[0]!.assignmentId }, {
        assignmentId: input.records[1]!.assignmentId,
      }] },
    });
    expect(workflowMocks.applyCas).not.toHaveBeenCalled();

    const changed = structuredClone(input.records);
    changed[1]!.assetId = 'different-asset';
    const conflict = fixture({ ledgerLookups: [changed.map((entry) => ledgerRow(entry))] });
    await expect(conflict.repository.transaction((tx) => tx.commit(input))).resolves.toEqual({
      kind: 'idempotency-conflict',
    });
  });

  it('accepts RECONCILED_CHARGE during the transaction authority recheck', async () => {
    const input = commitInput();
    const reconciledRows = [
      authorityRow(0, { settlementKind: 'RECONCILED_CHARGE' }),
      authorityRow(1, { settlementKind: 'RECONCILED_CHARGE' }),
    ];
    const { repository } = fixture({
      ledgerLookups: [[], []],
      authorityRows: [reconciledRows],
      insertRows: input.records.map((entry) => ledgerRow(entry)),
    });

    await expect(repository.transaction((tx) => tx.commit(input))).resolves.toMatchObject({
      kind: 'committed',
      batch: { records: [{ jobId: 'job-1' }, { jobId: 'job-2' }] },
    });
  });

  it('inserts two ledger rows, performs one draft CAS, and marks both jobs atomically', async () => {
    const input = commitInput();
    const { repository, query, execute } = fixture({
      ledgerLookups: [[], []],
      insertRows: input.records.map((entry) => ledgerRow(entry)),
    });
    await expect(repository.transaction((tx) => tx.commit(input))).resolves.toMatchObject({
      kind: 'committed',
      batch: { records: [{ batchItemOrdinal: 0 }, { batchItemOrdinal: 1 }] },
    });
    expect(workflowMocks.applyCas).toHaveBeenCalledTimes(1);
    expect(workflowMocks.applyCas).toHaveBeenCalledWith(
      expect.any(Object),
      {
        draftId: 'listing-workflow-1',
        ownerUserId: 'owner-1',
        actorUserId: 'actor-1',
        expectedRevision: 5,
        next: input.nextDraft,
      },
      NOW,
    );
    const insertCall = query.mock.calls.find(([sql]) => String(sql).includes(
      'INSERT INTO "extension_hosted_ai_image_listing_assignments"',
    ));
    expect(insertCall?.[0]).toMatch(/ON CONFLICT DO NOTHING/u);
    expect(insertCall?.[0]).toMatch(/\$1[\s\S]*\$35[\s\S]*\$36[\s\S]*\$70/u);
    const jobCall = query.mock.calls.find(([sql]) => String(sql).includes(
      'UPDATE "ai_image_jobs"',
    ));
    expect(jobCall?.[0]).toMatch(/jsonb_to_recordset/u);
    expect(JSON.parse(String(jobCall?.[1]))).toEqual([
      expect.objectContaining({ id: 'job-1', workflowId: 'child-workflow-1' }),
      expect.objectContaining({ id: 'job-2', workflowId: 'child-workflow-2' }),
    ]);
    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      'SAVEPOINT hosted_suite_listing_assignment_batch_commit',
      'RELEASE SAVEPOINT hosted_suite_listing_assignment_batch_commit',
    ]);
  });

  it('rolls back both ledger rows and the draft when the second job fence fails', async () => {
    const input = commitInput();
    const { repository, execute } = fixture({
      ledgerLookups: [[], []],
      insertRows: input.records.map((entry) => ledgerRow(entry)),
      changedJobs: [{ id: 'job-1' }],
    });
    await expect(repository.transaction((tx) => tx.commit(input))).resolves.toEqual({
      kind: 'cas-conflict',
    });
    expect(workflowMocks.applyCas).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls.map(([sql]) => sql)).toEqual([
      'SAVEPOINT hosted_suite_listing_assignment_batch_commit',
      'ROLLBACK TO SAVEPOINT hosted_suite_listing_assignment_batch_commit',
      'RELEASE SAVEPOINT hosted_suite_listing_assignment_batch_commit',
    ]);
  });

  it('rolls back the entire batch when the single draft CAS loses', async () => {
    const input = commitInput();
    const { repository, query, execute } = fixture({
      ledgerLookups: [[], []],
      insertRows: input.records.map((entry) => ledgerRow(entry)),
    });
    workflowMocks.applyCas.mockRejectedValueOnce(
      new OzonListingDraftRepositoryError('VERSION_CONFLICT', 'drift'),
    );
    await expect(repository.transaction((tx) => tx.commit(input))).resolves.toEqual({
      kind: 'cas-conflict',
    });
    expect(workflowMocks.applyCas).toHaveBeenCalledTimes(1);
    expect(query.mock.calls.some(([sql]) => String(sql).includes(
      'UPDATE "ai_image_jobs"',
    ))).toBe(false);
    expect(execute.mock.calls.map(([sql]) => sql)).toContain(
      'ROLLBACK TO SAVEPOINT hosted_suite_listing_assignment_batch_commit',
    );
  });

  it('rolls back a partial unique insert and resolves only an exact concurrent winner', async () => {
    const input = commitInput();
    const exact = fixture({
      ledgerLookups: [[], input.records.map((entry) => ledgerRow(entry))],
      insertRows: [ledgerRow(input.records[0]!)],
    });
    await expect(exact.repository.transaction((tx) => tx.commit(input))).resolves.toMatchObject({
      kind: 'replayed',
    });
    expect(workflowMocks.applyCas).not.toHaveBeenCalled();

    const noWinner = fixture({
      ledgerLookups: [[], []],
      insertRows: [],
    });
    await expect(noWinner.repository.transaction((tx) => tx.commit(input))).resolves.toEqual({
      kind: 'cas-conflict',
    });
    expect(workflowMocks.applyCas).not.toHaveBeenCalled();
  });

  it('contains no BYOK, external URL, or rolling plan-binding mutation path', async () => {
    const input = commitInput();
    const { repository, query } = fixture({
      ledgerLookups: [[], []],
      insertRows: input.records.map((entry) => ledgerRow(entry)),
    });
    await repository.transaction((tx) => tx.commit(input));
    const sql = query.mock.calls.map(([value]) => String(value)).join('\n');
    expect(sql).not.toMatch(/UPDATE\s+"extension_hosted_ai_image_plan_bindings"/iu);
    expect(sql).not.toMatch(/byok|ingest|upload|provenance/iu);
    expect(sql).not.toMatch(/asset\."url"|source_url" AS/iu);
  });
});

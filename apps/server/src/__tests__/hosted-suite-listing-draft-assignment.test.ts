import type { OzonListingDraft, OzonListingDraftMediaAssignment } from 'shared';
import { describe, expect, it, vi } from 'vitest';
import {
  createHostedSuiteListingDraftAssignmentRequestHash,
  createHostedSuiteListingDraftAssignmentService,
  HostedSuiteListingDraftAssignmentError,
  type AssignHostedSuiteOutputToListingDraftInput,
  type HostedSuiteListingDraftAssignmentAuthority,
  type HostedSuiteListingDraftAssignmentBatchRecord,
  type HostedSuiteListingDraftAssignmentCommitInput,
  type HostedSuiteListingDraftAssignmentRepository,
  type HostedSuiteListingDraftAssignmentSlotAuthority,
} from '../services/hosted-suite-listing-draft-assignment.js';

const NOW = new Date('2026-07-27T08:00:00.000Z');
const SNAPSHOT_HASH = 'a'.repeat(64);

function mediaAssignment(
  overrides: Partial<OzonListingDraftMediaAssignment> = {},
): OzonListingDraftMediaAssignment {
  return {
    scope: 'SKU',
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:source',
    assetId: 'source-asset-1',
    source: 'SOURCE',
    ...overrides,
  } as OzonListingDraftMediaAssignment;
}

function draft(
  assignments: OzonListingDraftMediaAssignment[] = [mediaAssignment()],
): OzonListingDraft {
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
    copy: {
      publishTitleRu: null,
      publishDescriptionRu: null,
      candidates: [],
      applyAudit: [],
    },
    media: { assignments },
    pricing: { value: null },
    validation: { status: 'VALID', report: { checked: true } },
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

function command(
  overrides: Partial<AssignHostedSuiteOutputToListingDraftInput> = {},
): AssignHostedSuiteOutputToListingDraftInput {
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
    ...overrides,
  };
}

function slotAuthority(index: number): HostedSuiteListingDraftAssignmentSlotAuthority {
  const request = item(index);
  const ordinal = index + 1;
  const fingerprint = String.fromCharCode(98 + index).repeat(64);
  return {
    planSlot: {
      ordinal: index,
      slotKey: request.slotKey,
      ownershipLevel: 'sku',
      ownershipKey: request.skuKey,
      compatibilityGroupKey: null,
      skuKeys: [request.skuKey],
    },
    suiteSlot: {
      id: request.suiteSlotId,
      suiteId: 'suite-1',
      ownerUserId: 'owner-1',
      ordinal: index,
      slotKey: request.slotKey,
      ownershipLevel: 'sku',
      ownershipKey: request.skuKey,
      compatibilityGroupKey: null,
      status: 'SUCCEEDED',
      attempt: 2,
      revision: request.expectedSuiteSlotRevision,
      childWorkflowId: request.childWorkflowId,
    },
    childWorkflow: {
      id: request.childWorkflowId,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      status: 'SUCCEEDED',
      reviewStatus: 'APPROVED',
      revision: request.expectedChildWorkflowRevision,
      currentAttempt: 2,
      operation: 'IMAGE_TO_IMAGE',
      contextType: 'collect',
      contextId: 'goods-1',
      contextSkuKey: request.skuKey,
      contextSlotKey: request.slotKey,
      selectedOutputAssetId: request.outputAssetId,
      reviewedByOwnerUserId: 'owner-1',
      reviewedAt: new Date('2026-07-27T07:58:00.000Z'),
      inputSourceCaptureSnapshotIds: ['snapshot-1'],
    },
    currentJob: {
      id: `job-${ordinal}`,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      workflowId: request.childWorkflowId,
      workflowAttempt: 2,
      executionMode: 'ERP_HOSTED',
      status: 'SUCCEEDED',
      operation: 'IMAGE_TO_IMAGE',
      provider: 'custom',
      model: 'image-model-v1',
      requestFingerprint: fingerprint,
      actualCostMinor: 17 + ordinal,
      billedUnits: 1,
      appliedAt: null,
    },
    costReservation: {
      id: `reservation-${ordinal}`,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      workflowId: request.childWorkflowId,
      jobId: `job-${ordinal}`,
      status: 'SETTLED',
      provider: 'custom',
      model: 'image-model-v1',
      operation: 'IMAGE_TO_IMAGE',
      requestFingerprint: fingerprint,
      settledAt: new Date('2026-07-27T07:57:00.000Z'),
    },
    costSettlement: {
      id: `settlement-${ordinal}`,
      reservationId: `reservation-${ordinal}`,
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      kind: 'CHARGE',
      requestFingerprint: fingerprint,
      actualCostMinor: 17 + ordinal,
      billedUnits: 1,
    },
    outputAsset: {
      id: request.outputAssetId,
      ownerUserId: 'owner-1',
      aiImageJobId: `job-${ordinal}`,
      kind: 'AI_GENERATED',
      sourceCaptureSnapshotId: 'snapshot-1',
      storageBackend: 'oss',
      storageKey: `owners/owner-1/ai/suite-1/output-${ordinal}.png`,
      mimeType: 'image/png',
      sizeBytes: 128_000,
      width: 900,
      height: 1200,
      sha256: String.fromCharCode(100 + index).repeat(64),
      metadata: {
        version: 'ai-image-suite-output/v1',
        suiteId: 'suite-1',
        slotId: request.suiteSlotId,
        attempt: 2,
        providerOutputAssetId: `provider-output-${ordinal}`,
      },
    },
  };
}

function authority(): HostedSuiteListingDraftAssignmentAuthority {
  return {
    actor: { id: 'actor-1', ownerUserId: 'owner-1', active: true },
    deviceSession: {
      id: 'device-session-1',
      deviceId: 'device-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      revokedAt: null,
      expiresAt: new Date('2026-07-28T08:00:00.000Z'),
      scopes: ['media:read', 'listing:write'],
      shopIds: ['shop-1'],
    },
    shop: { id: 'shop-1', ownerUserId: 'owner-1', active: true },
    draft: draft(),
    plan: {
      id: 'plan-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      revision: 6,
      contextType: 'collect',
      contextId: 'goods-1',
      currentVersionId: 'plan-version-1',
      approvedVersionId: 'plan-version-1',
      reviewStatus: 'APPROVED',
      staleAt: null,
      listingBinding: {
        ownerUserId: 'owner-1',
        deviceSessionId: 'device-session-1',
        shopId: 'shop-1',
        listingWorkflowId: 'listing-workflow-1',
        draftRevision: 5,
        draftVersion: 7,
        sourceCaptureSnapshotId: 'snapshot-1',
        selectedSkuKeys: ['sku-1', 'sku-2'],
      },
    },
    planVersion: {
      id: 'plan-version-1',
      planId: 'plan-1',
      ownerUserId: 'owner-1',
      sourceSubjectId: 'source-subject-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      sourceCaptureHash: SNAPSHOT_HASH,
    },
    suite: {
      id: 'suite-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      planId: 'plan-1',
      planVersionId: 'plan-version-1',
      sourceSubjectId: 'source-subject-1',
      sourceCaptureSnapshotId: 'snapshot-1',
      sourceCaptureHash: SNAPSHOT_HASH,
      contextType: 'collect',
      contextId: 'goods-1',
      status: 'SUCCEEDED',
      revision: 9,
      provider: 'custom',
      model: 'image-model-v1',
      itemCount: 2,
      completedAt: new Date('2026-07-27T07:56:00.000Z'),
    },
    slots: [slotAuthority(0), slotAuthority(1)],
  };
}

interface RepositoryFixtureOptions {
  authority?: HostedSuiteListingDraftAssignmentAuthority | null;
  replay?: HostedSuiteListingDraftAssignmentBatchRecord | null;
  commitResult?: 'committed' | 'cas-conflict' | 'idempotency-conflict';
  racedReplay?: HostedSuiteListingDraftAssignmentBatchRecord;
}

function repositoryFixture(options: RepositoryFixtureOptions = {}) {
  let committed: HostedSuiteListingDraftAssignmentCommitInput | null = null;
  const transaction = {
    findReplay: vi.fn(async () => options.replay || null),
    loadAuthority: vi.fn(async () => options.authority === undefined
      ? authority()
      : options.authority),
    commit: vi.fn(async (input: HostedSuiteListingDraftAssignmentCommitInput) => {
      committed = input;
      if (options.commitResult === 'cas-conflict') return { kind: 'cas-conflict' as const };
      if (options.commitResult === 'idempotency-conflict') {
        return { kind: 'idempotency-conflict' as const };
      }
      if (options.racedReplay) {
        return { kind: 'replayed' as const, batch: options.racedReplay };
      }
      return {
        kind: 'committed' as const,
        batch: {
          batchId: input.batchId,
          requestHash: input.requestHash,
          ownerUserId: input.expected.ownerUserId,
          idempotencyKey: input.idempotencyKey,
          records: input.records,
        },
      };
    }),
  };
  const repository: HostedSuiteListingDraftAssignmentRepository = {
    transaction: async (operation) => operation(transaction),
  };
  return { repository, transaction, committed: () => committed };
}

function serviceFor(options: RepositoryFixtureOptions = {}) {
  const fixture = repositoryFixture(options);
  return {
    ...fixture,
    service: createHostedSuiteListingDraftAssignmentService(fixture.repository, {
      now: () => NOW,
    }),
  };
}

function clonedAuthority() {
  return structuredClone(authority());
}

async function preparedBatch() {
  const fixture = serviceFor();
  await fixture.service.assign(command());
  const commit = fixture.committed()!;
  return {
    batchId: commit.batchId,
    requestHash: commit.requestHash,
    ownerUserId: commit.expected.ownerUserId,
    idempotencyKey: commit.idempotencyKey,
    records: commit.records,
  } satisfies HostedSuiteListingDraftAssignmentBatchRecord;
}

describe('hosted suite listing-draft atomic batch assignment', () => {
  it('appends two approved outputs in immutable order and creates one new draft', async () => {
    const { service, committed } = serviceFor();
    const result = await service.assign(command());

    expect(result).toMatchObject({
      contractVersion: 'hosted-suite-listing-draft-assignment/v2',
      replayed: false,
      sourceDraftRevision: 5,
      sourceDraftVersion: 7,
      boundDraftRevision: 6,
      boundDraftVersion: 8,
      validationStatus: 'STALE',
      publishReadiness: 'STALE',
      assignments: [
        {
          assignmentScope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
          assignmentOrdinal: 1, assetId: 'hosted-output-1',
        },
        {
          assignmentScope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero',
          assignmentOrdinal: 2, assetId: 'hosted-output-2',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toMatch(/provider|model|url|storageKey|prompt|api.?key/iu);

    const commit = committed()!;
    expect(commit.records).toHaveLength(2);
    expect(commit.records.map((record) => record.batchItemOrdinal)).toEqual([0, 1]);
    expect(new Set(commit.records.map((record) => record.batchId)).size).toBe(1);
    expect(commit.nextDraft).toMatchObject({
      revision: 6,
      draftVersion: 8,
      validation: { status: 'STALE', report: null },
      freshness: {
        media: { state: 'CURRENT', reason: null },
        validation: { state: 'STALE', reason: 'MEDIA_ASSIGNMENT_CHANGED' },
      },
      grantRevocation: { required: true, reason: 'MEDIA_ASSIGNMENT_CHANGED' },
    });
    expect(commit.nextDraft.media.assignments.slice(-2)).toEqual([
      {
        scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
        assetId: 'hosted-output-1', source: 'GENERATED',
      },
      {
        scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero',
        assetId: 'hosted-output-2', source: 'GENERATED',
      },
    ]);
    expect(commit.nextDraft.auditEvents).toHaveLength(1);
    expect(commit.nextDraft.auditEvents[0]).toMatchObject({
      type: 'AI_MEDIA_ASSIGNMENT_APPLIED',
      draftVersion: 8,
      details: { assignmentCount: 2, executionMode: 'ERP_HOSTED' },
    });
    expect(commit.expected.items.map((entry) => entry.jobId)).toEqual(['job-1', 'job-2']);
    expect(commit).not.toHaveProperty('nextPlanBinding');
  });

  it('does not commit any item when the second approved output fails billing validation', async () => {
    const changed = clonedAuthority();
    changed.slots[1]!.costSettlement!.actualCostMinor = 999;
    const { service, transaction } = serviceFor({ authority: changed });

    await expect(service.assign(command())).rejects.toMatchObject({
      code: 'HOSTED_LISTING_ASSIGNMENT_BILLING_INCOMPLETE',
    });
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('accepts an exact reconciled charge for every approved paid attempt', async () => {
    const changed = clonedAuthority();
    changed.slots.forEach((slot) => {
      slot.costSettlement!.kind = 'RECONCILED_CHARGE';
    });
    const { service, committed } = serviceFor({ authority: changed });

    await expect(service.assign(command())).resolves.toMatchObject({
      assignments: [{ assetId: 'hosted-output-1' }, { assetId: 'hosted-output-2' }],
    });
    expect(committed()!.records).toHaveLength(2);
  });

  it('rejects duplicate asset input and duplicate paid-job authority across batch items', async () => {
    const duplicateAsset = serviceFor();
    await expect(duplicateAsset.service.assign(command({
      items: [item(0), { ...item(1), outputAssetId: item(0).outputAssetId }],
    }))).rejects.toMatchObject({ code: 'HOSTED_LISTING_ASSIGNMENT_INVALID_REQUEST' });
    expect(duplicateAsset.transaction.loadAuthority).not.toHaveBeenCalled();

    const changed = clonedAuthority();
    changed.slots[1]!.currentJob!.id = 'job-1';
    changed.slots[1]!.costReservation!.jobId = 'job-1';
    changed.slots[1]!.outputAsset!.aiImageJobId = 'job-1';
    const duplicateJob = serviceFor({ authority: changed });
    await expect(duplicateJob.service.assign(command())).rejects.toMatchObject({
      code: 'HOSTED_LISTING_ASSIGNMENT_CANDIDATE_INVALID',
    });
    expect(duplicateJob.transaction.commit).not.toHaveBeenCalled();
  });

  it('rejects omitted, duplicate, and unsorted approved item manifests', async () => {
    const omitted = serviceFor();
    await expect(omitted.service.assign(command({ items: [item(0)] }))).rejects.toMatchObject({
      code: 'HOSTED_LISTING_ASSIGNMENT_CANDIDATE_SET_MISMATCH',
    });
    expect(omitted.transaction.commit).not.toHaveBeenCalled();

    const duplicateItem = { ...item(1), outputAssetId: item(0).outputAssetId };
    const duplicate = serviceFor();
    await expect(duplicate.service.assign(command({
      items: [item(0), duplicateItem],
    }))).rejects.toMatchObject({ code: 'HOSTED_LISTING_ASSIGNMENT_INVALID_REQUEST' });
    expect(duplicate.transaction.loadAuthority).not.toHaveBeenCalled();

    const unsorted = serviceFor();
    await expect(unsorted.service.assign(command({
      items: [item(1), item(0)],
    }))).rejects.toMatchObject({
      code: 'HOSTED_LISTING_ASSIGNMENT_CANDIDATE_SET_MISMATCH',
    });
    expect(unsorted.transaction.commit).not.toHaveBeenCalled();
  });

  it('maps an exact compatibility group to one PRODUCT assignment', async () => {
    const changed = clonedAuthority();
    const grouped = changed.slots[1]!;
    grouped.planSlot.ownershipLevel = 'compatibility_group';
    grouped.planSlot.ownershipKey = 'group-1';
    grouped.planSlot.compatibilityGroupKey = 'group-1';
    grouped.planSlot.skuKeys = ['sku-2', 'sku-1'];
    grouped.suiteSlot.ownershipLevel = 'compatibility_group';
    grouped.suiteSlot.ownershipKey = 'group-1';
    grouped.suiteSlot.compatibilityGroupKey = 'group-1';
    grouped.childWorkflow!.contextSkuKey = null;
    const { service, committed } = serviceFor({ authority: changed });

    const result = await service.assign(command());
    expect(result.assignments[1]).toMatchObject({
      assignmentScope: 'PRODUCT',
      skuKey: 'sku-2',
      slotKey: 'sku:sku-2:hero',
    });
    expect(committed()!.nextDraft.media.assignments.at(-1)).toEqual({
      scope: 'PRODUCT',
      slotKey: 'sku:sku-2:hero',
      assetId: 'hosted-output-2',
      source: 'GENERATED',
    });
  });

  it('rejects a compatibility-group subset of the draft selected SKUs', async () => {
    const changed = clonedAuthority();
    const grouped = changed.slots[1]!;
    grouped.planSlot.ownershipLevel = 'compatibility_group';
    grouped.planSlot.ownershipKey = 'group-1';
    grouped.planSlot.compatibilityGroupKey = 'group-1';
    grouped.planSlot.skuKeys = ['sku-1'];
    grouped.suiteSlot.ownershipLevel = 'compatibility_group';
    grouped.suiteSlot.ownershipKey = 'group-1';
    grouped.suiteSlot.compatibilityGroupKey = 'group-1';
    grouped.childWorkflow!.contextSkuKey = null;
    const { service, transaction } = serviceFor({ authority: changed });

    await expect(service.assign(command())).rejects.toMatchObject({
      code: 'HOSTED_LISTING_ASSIGNMENT_PLAN_STALE',
    });
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('rejects a compatibility-group superset of the draft selected SKUs', async () => {
    const changed = clonedAuthority();
    const grouped = changed.slots[1]!;
    grouped.planSlot.ownershipLevel = 'compatibility_group';
    grouped.planSlot.ownershipKey = 'group-1';
    grouped.planSlot.compatibilityGroupKey = 'group-1';
    grouped.planSlot.skuKeys = ['sku-1', 'sku-2', 'sku-3'];
    grouped.suiteSlot.ownershipLevel = 'compatibility_group';
    grouped.suiteSlot.ownershipKey = 'group-1';
    grouped.suiteSlot.compatibilityGroupKey = 'group-1';
    grouped.childWorkflow!.contextSkuKey = null;
    const { service, transaction } = serviceFor({ authority: changed });

    await expect(service.assign(command())).rejects.toMatchObject({
      code: 'HOSTED_LISTING_ASSIGNMENT_PLAN_STALE',
    });
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('rejects a nonterminal suite manifest before any mutation', async () => {
    const changed = clonedAuthority();
    changed.suite.status = 'RUNNING';
    changed.suite.completedAt = null;
    changed.slots[1]!.suiteSlot.status = 'RUNNING';
    const { service, transaction } = serviceFor({ authority: changed });
    await expect(service.assign(command())).rejects.toMatchObject({
      code: 'HOSTED_LISTING_ASSIGNMENT_SUITE_STALE',
    });
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('rejects stale tail ordering and existing slot or asset conflicts', async () => {
    const badTail = serviceFor();
    await expect(badTail.service.assign(command({ assignmentStartOrdinal: 2 })))
      .rejects.toMatchObject({ code: 'HOSTED_LISTING_ASSIGNMENT_ORDER_CONFLICT' });

    const changed = clonedAuthority();
    changed.draft = draft([
      mediaAssignment(),
      mediaAssignment({ slotKey: 'sku:sku-1:hero', assetId: 'existing-hero' }),
    ]);
    const occupied = serviceFor({ authority: changed });
    await expect(occupied.service.assign(command({ assignmentStartOrdinal: 2 })))
      .rejects.toMatchObject({ code: 'HOSTED_LISTING_ASSIGNMENT_SLOT_CONFLICT' });
  });

  it('fails closed for forged caller, BYOK job, and unnormalized output authority', async () => {
    const cases: Array<[
      (changed: HostedSuiteListingDraftAssignmentAuthority) => void,
      string,
    ]> = [
      [(changed) => { changed.deviceSession.ownerUserId = 'owner-2'; },
        'HOSTED_LISTING_ASSIGNMENT_FORBIDDEN'],
      [(changed) => { changed.slots[0]!.currentJob!.executionMode = 'BYOK'; },
        'HOSTED_LISTING_ASSIGNMENT_BILLING_INCOMPLETE'],
      [(changed) => { changed.slots[0]!.outputAsset!.kind = 'AI_PROVIDER_OUTPUT'; },
        'HOSTED_LISTING_ASSIGNMENT_CANDIDATE_INVALID'],
    ];
    for (const [mutate, code] of cases) {
      const changed = clonedAuthority();
      mutate(changed);
      const fixture = serviceFor({ authority: changed });
      await expect(fixture.service.assign(command())).rejects.toMatchObject({ code });
      expect(fixture.transaction.commit).not.toHaveBeenCalled();
    }
  });

  it('hashes every client-controlled batch item and preserves order', () => {
    const base = command();
    const hash = createHostedSuiteListingDraftAssignmentRequestHash(base);
    expect(hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(createHostedSuiteListingDraftAssignmentRequestHash({ ...base })).toBe(hash);
    expect(createHostedSuiteListingDraftAssignmentRequestHash({
      ...base, items: [item(1), item(0)],
    })).not.toBe(hash);
    expect(createHostedSuiteListingDraftAssignmentRequestHash({
      ...base, assignmentStartOrdinal: 0,
    })).not.toBe(hash);
  });

  it('returns an exact whole-batch replay before reading mutable authority', async () => {
    const replay = await preparedBatch();
    const { service, transaction } = serviceFor({ replay });
    await expect(service.assign(command())).resolves.toMatchObject({
      replayed: true,
      batchId: replay.batchId,
      assignments: [{ assignmentOrdinal: 1 }, { assignmentOrdinal: 2 }],
    });
    expect(transaction.loadAuthority).not.toHaveBeenCalled();
    expect(transaction.commit).not.toHaveBeenCalled();
  });

  it('rejects same idempotency key with a different whole-batch request', async () => {
    const replay = await preparedBatch();
    replay.requestHash = 'f'.repeat(64);
    replay.records.forEach((entry) => { entry.requestHash = replay.requestHash; });
    const { service, transaction } = serviceFor({ replay });
    await expect(service.assign(command())).rejects.toMatchObject({
      code: 'HOSTED_LISTING_ASSIGNMENT_IDEMPOTENCY_CONFLICT',
    });
    expect(transaction.loadAuthority).not.toHaveBeenCalled();
  });

  it('maps a concurrent batch winner to exact replay or one CAS conflict', async () => {
    const exact = await preparedBatch();
    const replay = serviceFor({ racedReplay: exact });
    await expect(replay.service.assign(command())).resolves.toMatchObject({ replayed: true });

    const stale = serviceFor({ commitResult: 'cas-conflict' });
    await expect(stale.service.assign(command())).rejects.toMatchObject({
      code: 'HOSTED_LISTING_ASSIGNMENT_CAS_CONFLICT',
      statusCode: 409,
    });

    const conflicting = structuredClone(exact);
    conflicting.requestHash = 'f'.repeat(64);
    conflicting.records.forEach((entry) => { entry.requestHash = conflicting.requestHash; });
    const conflict = serviceFor({ racedReplay: conflicting });
    await expect(conflict.service.assign(command())).rejects.toBeInstanceOf(
      HostedSuiteListingDraftAssignmentError,
    );
    await expect(conflict.service.assign(command())).rejects.toMatchObject({
      code: 'HOSTED_LISTING_ASSIGNMENT_IDEMPOTENCY_CONFLICT',
    });
  });
});

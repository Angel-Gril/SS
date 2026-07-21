import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from 'shared';
import { PrismaAiMediaPlanningRepository } from '../repositories/ai-media-planning-repository.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';

function candidateEvidenceId(snapshotId: string, candidateId: string) {
  const path = `/media/${encodeURIComponent(candidateId)}`;
  const evidenceHash = createHash('sha256').update(`${path}\u0000${candidateId}`).digest('hex');
  return `capture:${snapshotId}:evidence:${evidenceHash}`;
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    planId: 'plan-1',
    ownerUserId: 'owner-1',
    version: 1,
    planningRunId: 'run-1',
    parentVersionId: null,
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'a'.repeat(64),
    sourceProfileHash: 'b'.repeat(64),
    sourceSchemaVersion: 'source-product-capture-v2',
    selectedSkuHash: '2'.repeat(64),
    inputAssetSetHash: '3'.repeat(64),
    inputFingerprint: 'c'.repeat(64),
    planSchemaVersion: 'ai-image-prompt-plan/2.0',
    plannerVersion: 'ai-media-rule-planner/v1',
    mode: 'RULE_BASED',
    fallbackReason: null,
    inputSnapshot: { candidates: [{ id: 'media-1', skuKeys: ['sku-1'] }] },
    inputHash: '4'.repeat(64),
    curation: {
      selectedCandidateIds: ['media-1'],
      selectionTarget: { minimum: 1, maximum: 14, eligibleCount: 1, selectedCount: 1, met: true },
    },
    curationHash: 'd'.repeat(64),
    visionEvidence: { images: [{ candidateId: 'media-1' }] },
    visionEvidenceHash: 'e'.repeat(64),
    planHash: 'f'.repeat(64),
    planPayload: {
      version: '2.0',
      mode: 'rule_based',
      compatibilityGroups: [{ groupKey: 'group-1', identitySignature: '{}', skuKeys: ['sku-1'] }],
      verifiedFacts: [],
      slots: [{
        slotKey: 'sku:sku-1:hero',
        status: 'READY', goal: 'sku_hero', ownership: { level: 'sku', key: 'sku-1' },
        references: [{ candidateId: 'media-1', evidenceIds: [candidateEvidenceId('snapshot-1', 'media-1')] }],
        factEvidenceIds: [],
        safetyConstraints: ['preserve_product_identity'],
        acceptanceChecks: ['product_matches_references'],
      }],
      manualSelectionAllowed: true,
      recoverable: true,
      diagnostics: [],
      fallbackReason: null,
    },
    planBytes: 1_000,
    provenance: {},
    provenanceHash: '1'.repeat(64),
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
    ...overrides,
  };
}

function planRow(overrides: Record<string, unknown> = {}) {
  const currentVersion = versionRow();
  return {
    id: 'plan-1',
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    sourceSubjectId: 'subject-1',
    contextType: 'collect',
    contextId: 'goods-1',
    idempotencyKey: 'plan-key-1',
    requestFingerprint: '2'.repeat(64),
    revision: 1,
    latestVersion: 1,
    currentVersionId: currentVersion.id,
    approvedVersionId: null,
    reviewStatus: 'PENDING',
    staleAt: null,
    staleAgainstFingerprint: null,
    staleReasons: null,
    reviewedByUserId: null,
    reviewedAt: null,
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
    currentVersion,
    approvedVersion: null,
    ...overrides,
  };
}

function sourceClient(plan: any, latest = {
  id: 'snapshot-1', captureHash: 'a'.repeat(64), profileHash: 'b'.repeat(64),
  schemaVersion: 'source-product-capture-v2',
}) {
  const tx: any = {
    aiMediaPlan: {
      findFirst: vi.fn(async () => plan),
      updateMany: vi.fn(async () => ({ count: 1 })),
    },
    aiMediaPlanEvent: {
      findUnique: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
    },
    aiMediaSuite: { findFirst: vi.fn(async () => null) },
    aiMediaPlanningRun: {
      findUnique: vi.fn(async () => ({ inputBytes: 1_000 })),
      findFirst: vi.fn(async () => ({ attempt: 1 })),
      create: vi.fn(async ({ data }: any) => ({ id: 'run-2', ...data })),
    },
    aiMediaPlanVersion: {
      create: vi.fn(async ({ data }: any) => ({ id: 'version-2', ...data })),
    },
    supplyGoods: { findFirst: vi.fn(async () => ({ id: 'goods-1' })) },
    sourceCaptureSubject: { findFirst: vi.fn(async () => ({ snapshots: [latest] })) },
  };
  return {
    $transaction: vi.fn(async (action: (client: any) => Promise<unknown>) => action(tx)),
    ...tx,
  } as any;
}

describe('Prisma AI media planning repository boundaries', () => {
  it('resolves product-only captures to the shared stable SKU identity', async () => {
    const findFirst = vi.fn(async () => ({
      sourceCaptureSubject: {
        id: 'subject-product-only',
        ownerUserId: 'owner-1',
        legacySupplyGoodsId: 'goods-1',
        snapshots: [{ id: 'snapshot-product-only', payload: { skus: [] } }],
      },
    }));
    const repository = new PrismaAiMediaPlanningRepository({
      supplyGoods: { findFirst },
    } as any);

    await expect(repository.resolveCurrentRulePlanningTarget({
      ownerUserId: 'owner-1', context: { type: 'collect', id: 'goods-1' },
    })).resolves.toEqual({
      sourceSubjectId: 'subject-product-only',
      sourceCaptureSnapshotId: 'snapshot-product-only',
      selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
    });
  });

  it('rejects a legacy subject whose tenant binding does not match the owned goods', async () => {
    const repository = new PrismaAiMediaPlanningRepository({
      supplyGoods: { findFirst: vi.fn(async () => ({
        sourceCaptureSubject: {
          id: 'subject-cross-owner', ownerUserId: 'owner-2', legacySupplyGoodsId: 'goods-1',
          snapshots: [{ id: 'snapshot-cross-owner', payload: { skus: [] } }],
        },
      })) },
    } as any);

    await expect(repository.resolveCurrentRulePlanningTarget({
      ownerUserId: 'owner-1', context: { type: 'collect', id: 'goods-1' },
    })).resolves.toBeNull();
  });

  it('selects the newest immutable plan creation, not the most recently reviewed plan', async () => {
    const newer = planRow({ id: 'plan-new', createdAt: new Date('2026-07-20T00:00:00.000Z') });
    const older = planRow({ id: 'plan-old', createdAt: new Date('2026-07-19T00:00:00.000Z') });
    const findFirst = vi.fn(async (args: any) => {
      expect(args.orderBy).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
      // A real database applies this immutable ordering; an updatedAt ordering
      // would incorrectly return the historical plan in this fixture.
      return args.orderBy[0].createdAt === 'desc' ? newer : older;
    });
    const repository = new PrismaAiMediaPlanningRepository({
      aiMediaPlan: { findFirst },
    } as any);

    const result = await repository.getLatestOwnedByContext({
      ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1',
    });
    expect(result).toMatchObject({ id: 'plan-new', ownerUserId: 'owner-1' });
  });

  it('bounds version history and applies the immutable version cursor', async () => {
    const findMany = vi.fn(async () => [versionRow({ version: 7 })]);
    const repository = new PrismaAiMediaPlanningRepository({
      aiMediaPlanVersion: { findMany },
    } as any);

    const result = await repository.listVersionsOwned('plan-1', 'owner-1', {
      limit: 20, beforeVersion: 8,
    });

    expect(result).toHaveLength(1);
    expect(findMany).toHaveBeenCalledWith({
      where: { planId: 'plan-1', ownerUserId: 'owner-1', version: { lt: 8 } },
      orderBy: { version: 'desc' },
      take: 20,
    });
  });

  it('preserves exact review replay semantics and persists newly stale source state', async () => {
    const operation = {
      operationKey: 'approve-replay-1', expectedRevision: 1, actorUserId: 'owner-1',
      decision: 'APPROVE' as const, note: null,
    };
    const event = {
      planId: 'plan-1', ownerUserId: 'owner-1',
      payloadHash: hashAiMediaPlanningJson(operation), eventType: 'REVIEW_APPROVED',
    };
    const plan = planRow({
      revision: 2, reviewStatus: 'APPROVED', approvedVersionId: 'version-1', event,
    }) as any;
    const latest = {
      id: 'snapshot-new', captureHash: '9'.repeat(64), profileHash: '8'.repeat(64),
      schemaVersion: 'source-product-capture-v2',
    };
    const client = sourceClient(plan, latest);
    client.aiMediaPlanEvent.findUnique.mockResolvedValue(event);
    client.aiMediaPlan.updateMany.mockImplementation(async () => {
      plan.staleAt = new Date('2026-07-21T00:00:00.000Z');
      plan.revision = 3;
      return { count: 1 };
    });
    const repository = new PrismaAiMediaPlanningRepository(client);

    const result = await repository.reviewCurrent({
      planId: 'plan-1', ownerUserId: 'owner-1', ...operation,
    });

    expect(result.kind).toBe('replayed');
    expect(result.plan).toMatchObject({
      id: 'plan-1', reviewStatus: 'APPROVED', staleAt: expect.any(Date), revision: 3,
    });
    expect(client.aiMediaPlanEvent.findUnique).toHaveBeenCalled();
    expect(client.aiMediaPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: 'plan-1', revision: 2, staleAt: null }),
    }));
  });

  it('does not approve or execute a plan with manual-required slots or missing evidence', async () => {
    const plan = planRow({
      currentVersion: versionRow({
        planPayload: {
          slots: [{
            status: 'MANUAL_REQUIRED', goal: 'sku_hero', ownership: { level: 'sku', key: 'sku-1' },
            references: [], safetyConstraints: ['preserve_product_identity'], acceptanceChecks: [],
          }],
        },
      }),
    }) as any;
    const client = sourceClient(plan);
    const repository = new PrismaAiMediaPlanningRepository(client);
    const review = await repository.reviewCurrent({
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1', expectedRevision: 1,
      operationKey: 'approve-not-ready', decision: 'APPROVE', note: null,
    });
    expect(review.kind).toBe('not-ready');
    expect(client.aiMediaPlan.updateMany).not.toHaveBeenCalled();

    plan.reviewStatus = 'APPROVED';
    plan.approvedVersionId = 'version-1';
    plan.approvedVersion = plan.currentVersion;
    plan.reviewedByUserId = 'owner-1';
    plan.reviewedAt = new Date();
    const execution = await repository.requireApprovedForExecution({
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
    });
    expect(execution.kind).toBe('not-ready');
  });

  it('does not approve a plan whose references are outside the frozen evidence graph', async () => {
    const plan = planRow({
      currentVersion: versionRow({
        planPayload: {
          verifiedFacts: [],
          slots: [{
            status: 'READY', goal: 'sku_hero', ownership: { level: 'sku', key: 'sku-1' },
            references: [{
              candidateId: 'forged-media',
              evidenceIds: [`capture:snapshot-1:evidence:${'8'.repeat(64)}`],
            }],
            factEvidenceIds: [],
            safetyConstraints: ['preserve_product_identity'],
            acceptanceChecks: ['product_matches_references'],
          }],
        },
      }),
    }) as any;
    const client = sourceClient(plan);
    const repository = new PrismaAiMediaPlanningRepository(client);

    const review = await repository.reviewCurrent({
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1', expectedRevision: 1,
      operationKey: 'approve-forged-reference', decision: 'APPROVE', note: null,
    });

    expect(review.kind).toBe('not-ready');
    expect(client.aiMediaPlan.updateMany).not.toHaveBeenCalled();
  });

  it('fails closed when a concurrent mutation wins the stale-mark CAS', async () => {
    const initial = planRow({
      revision: 2,
      reviewStatus: 'APPROVED',
      approvedVersionId: 'version-1',
      reviewedByUserId: 'owner-1',
      reviewedAt: new Date(),
    }) as any;
    initial.approvedVersion = initial.currentVersion;
    const concurrent = {
      ...initial,
      revision: 3,
      updatedAt: new Date('2026-07-21T00:00:00.000Z'),
    };
    const client = sourceClient(initial, {
      id: 'snapshot-new', captureHash: '9'.repeat(64), profileHash: '8'.repeat(64),
      schemaVersion: 'source-product-capture-v2',
    });
    client.aiMediaPlan.findFirst
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(concurrent);
    client.aiMediaPlan.updateMany.mockResolvedValueOnce({ count: 0 });
    const repository = new PrismaAiMediaPlanningRepository(client);

    const execution = await repository.requireApprovedForExecution({
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
    });

    expect(execution).toMatchObject({ kind: 'not-approved', plan: { revision: 3 } });
    expect(client.aiMediaPlanEvent.create).not.toHaveBeenCalled();
  });

  it('creates one immutable manual slot version and clears prior approval', async () => {
    const currentVersion = versionRow({
      inputSnapshot: { candidates: [
        { id: 'media-1', skuKeys: ['sku-1'] },
        { id: 'media-2', skuKeys: [] },
      ] },
      curation: {
        selectedCandidateIds: ['media-1', 'media-2'],
        selectionTarget: { minimum: 1, maximum: 14, eligibleCount: 2, selectedCount: 2, met: true },
      },
      visionEvidence: { images: [{ candidateId: 'media-1' }, { candidateId: 'media-2' }] },
    });
    const plan = planRow({
      revision: 2,
      reviewStatus: 'APPROVED',
      approvedVersionId: 'version-1',
      reviewedByUserId: 'owner-1',
      reviewedAt: new Date(),
      currentVersion,
      approvedVersion: currentVersion,
    }) as any;
    const client = sourceClient(plan);
    const repository = new PrismaAiMediaPlanningRepository(client);
    const result = await repository.updateSlotReferences({
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedRevision: 2, baseVersionId: 'version-1', operationKey: 'slot-update-1',
      changes: [{
        slotKey: 'sku:sku-1:hero',
        referenceCandidateIds: ['media-2', 'media-1'],
      }],
    });

    expect(result).toMatchObject({ kind: 'updated', createdVersionId: 'version-2' });
    expect(client.aiMediaPlanningRun.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      attempt: 2,
      inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      inputSnapshot: expect.objectContaining({ manualSlotEdit: expect.objectContaining({
        parentVersionId: 'version-1',
      }) }),
      engineVersion: 'ai-media-manual-slot-editor/v1',
      status: 'SUCCEEDED',
    }) });
    expect(client.aiMediaPlanVersion.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      version: 2,
      parentVersionId: 'version-1',
      inputFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/u),
      plannerVersion: 'ai-media-manual-slot-editor/v1',
      planPayload: expect.objectContaining({ slots: [expect.objectContaining({
        slotKey: 'sku:sku-1:hero',
        status: 'READY',
        references: [{
          candidateId: 'media-2', evidenceIds: [candidateEvidenceId('snapshot-1', 'media-2')],
        }, {
          candidateId: 'media-1', evidenceIds: [candidateEvidenceId('snapshot-1', 'media-1')],
        }],
      })] }),
    }) });
    const runInput = client.aiMediaPlanningRun.create.mock.calls[0]![0].data;
    const versionInput = client.aiMediaPlanVersion.create.mock.calls[0]![0].data;
    expect(runInput.inputFingerprint).not.toBe(currentVersion.inputFingerprint);
    expect(versionInput).toMatchObject({
      inputFingerprint: runInput.inputFingerprint,
      inputSnapshot: runInput.inputSnapshot,
      inputHash: runInput.inputHash,
    });
    expect(client.aiMediaPlan.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ revision: 2, currentVersionId: 'version-1' }),
      data: expect.objectContaining({
        approvedVersionId: null, reviewStatus: 'PENDING',
        reviewedByUserId: null, reviewedAt: null,
      }),
    }));
    expect(client.aiMediaPlanEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      versionId: 'version-2', runId: 'run-2', revision: 3,
      eventType: 'SLOT_REFERENCES_UPDATED',
    }) });
  });

  it('blocks every non-terminal suite but allows terminal suite history', async () => {
    const plan = planRow() as any;
    const blockedClient = sourceClient(plan);
    blockedClient.aiMediaSuite.findFirst.mockResolvedValue({ id: 'suite-1', status: 'FAILED' });
    const blocked = await new PrismaAiMediaPlanningRepository(blockedClient).updateSlotReferences({
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 1, baseVersionId: 'version-1', operationKey: 'slot-suite-blocked',
      changes: [{ slotKey: 'sku:sku-1:hero', referenceCandidateIds: [] }],
    });
    expect(blocked.kind).toBe('active-suite-conflict');
    expect(blockedClient.aiMediaPlanningRun.create).not.toHaveBeenCalled();
    expect(blockedClient.aiMediaSuite.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { planVersionId: 'version-1', status: { notIn: ['SUCCEEDED', 'CANCELLED'] } },
    }));

    const terminalClient = sourceClient(plan);
    terminalClient.aiMediaSuite.findFirst.mockResolvedValue(null);
    const terminal = await new PrismaAiMediaPlanningRepository(terminalClient).updateSlotReferences({
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 1, baseVersionId: 'version-1', operationKey: 'slot-suite-terminal',
      changes: [{ slotKey: 'sku:sku-1:hero', referenceCandidateIds: [] }],
    });
    expect(terminal.kind).toBe('updated');
  });

  it('rejects no-op, unselected and ownership-incompatible references before writes', async () => {
    const noOpClient = sourceClient(planRow());
    const noOp = await new PrismaAiMediaPlanningRepository(noOpClient).updateSlotReferences({
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 1, baseVersionId: 'version-1', operationKey: 'slot-noop-1',
      changes: [{ slotKey: 'sku:sku-1:hero', referenceCandidateIds: ['media-1'] }],
    });
    expect(noOp.kind).toBe('no-changes');
    expect(noOpClient.aiMediaPlanningRun.create).not.toHaveBeenCalled();

    const unselectedVersion = versionRow({
      inputSnapshot: { candidates: [
        { id: 'media-1', skuKeys: ['sku-1'] },
        { id: 'media-2', skuKeys: ['sku-1'] },
      ] },
      visionEvidence: { images: [{ candidateId: 'media-1' }, { candidateId: 'media-2' }] },
    });
    const unselectedClient = sourceClient(planRow({ currentVersion: unselectedVersion }));
    const unselected = await new PrismaAiMediaPlanningRepository(unselectedClient).updateSlotReferences({
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 1, baseVersionId: 'version-1', operationKey: 'slot-unselected-1',
      changes: [{ slotKey: 'sku:sku-1:hero', referenceCandidateIds: ['media-2'] }],
    });
    expect(unselected.kind).toBe('invalid-reference');

    const incompatibleVersion = versionRow({
      inputSnapshot: { candidates: [
        { id: 'media-1', skuKeys: ['sku-1'] },
        { id: 'media-2', skuKeys: ['sku-2'] },
      ] },
      curation: {
        selectedCandidateIds: ['media-1', 'media-2'],
        selectionTarget: { minimum: 1, maximum: 14, eligibleCount: 2, selectedCount: 2, met: true },
      },
      visionEvidence: { images: [{ candidateId: 'media-1' }, { candidateId: 'media-2' }] },
    });
    const incompatibleClient = sourceClient(planRow({ currentVersion: incompatibleVersion }));
    const incompatible = await new PrismaAiMediaPlanningRepository(incompatibleClient)
      .updateSlotReferences({
        planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
        expectedRevision: 1, baseVersionId: 'version-1', operationKey: 'slot-incompatible-1',
        changes: [{ slotKey: 'sku:sku-1:hero', referenceCandidateIds: ['media-2'] }],
      });
    expect(incompatible.kind).toBe('invalid-reference');
    expect(incompatibleClient.aiMediaPlanningRun.create).not.toHaveBeenCalled();
  });

  it('keeps operation replay tenant-scoped and conflicts on changed payload', async () => {
    const input = {
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 1, baseVersionId: 'version-1', operationKey: 'slot-operation-1',
      changes: [{ slotKey: 'sku:sku-1:hero', referenceCandidateIds: [] }],
    };
    const plan = planRow();
    const client = sourceClient(plan);
    client.aiMediaPlanEvent.findUnique.mockResolvedValue({
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      eventType: 'SLOT_REFERENCES_UPDATED', versionId: 'version-2',
      payload: { requestFingerprint: hashAiMediaPlanningJson({
        ...input,
        changes: [{ slotKey: 'sku:sku-1:hero', referenceCandidateIds: ['media-1'] }],
      }) },
    });
    const conflict = await new PrismaAiMediaPlanningRepository(client).updateSlotReferences(input);
    expect(conflict.kind).toBe('operation-conflict');
    expect(client.aiMediaSuite.findFirst).not.toHaveBeenCalled();

    const foreignClient = sourceClient(null);
    const missing = await new PrismaAiMediaPlanningRepository(foreignClient).updateSlotReferences(input);
    expect(missing.kind).toBe('not-found');
    expect(foreignClient.aiMediaPlanEvent.findUnique).not.toHaveBeenCalled();
  });

  it('replays exactly while persisting newly stale source state', async () => {
    const input = {
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 1, baseVersionId: 'version-1', operationKey: 'slot-replay-stale',
      changes: [{ slotKey: 'sku:sku-1:hero', referenceCandidateIds: [] }],
    };
    const plan = planRow() as any;
    const event = {
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      eventType: 'SLOT_REFERENCES_UPDATED', versionId: 'version-2',
      payload: { requestFingerprint: hashAiMediaPlanningJson(input) },
    };
    const client = sourceClient(plan, {
      id: 'snapshot-new', captureHash: '9'.repeat(64), profileHash: '8'.repeat(64),
      schemaVersion: 'source-product-capture-v2',
    });
    client.aiMediaPlanEvent.findUnique.mockResolvedValue(event);
    client.aiMediaPlan.updateMany.mockImplementation(async () => {
      plan.staleAt = new Date();
      plan.revision = 2;
      return { count: 1 };
    });

    const result = await new PrismaAiMediaPlanningRepository(client).updateSlotReferences(input);
    expect(result).toMatchObject({
      kind: 'replayed', createdVersionId: 'version-2', plan: { staleAt: expect.any(Date) },
    });
    expect(client.aiMediaPlanEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      eventType: 'SOURCE_CONTEXT_STALE',
    }) });
    expect(client.aiMediaPlanningRun.create).not.toHaveBeenCalled();
  });

  it('rolls back run/version work before classifying a lost plan CAS', async () => {
    const initial = planRow() as any;
    const concurrent = planRow({ revision: 2, currentVersionId: 'version-concurrent' }) as any;
    const client = sourceClient(initial);
    client.aiMediaPlan.findFirst
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(concurrent);
    client.aiMediaPlan.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await new PrismaAiMediaPlanningRepository(client).updateSlotReferences({
      planId: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 1, baseVersionId: 'version-1', operationKey: 'slot-cas-rollback',
      changes: [{ slotKey: 'sku:sku-1:hero', referenceCandidateIds: [] }],
    });

    expect(result.kind).toBe('revision-conflict');
    expect(client.$transaction).toHaveBeenCalledTimes(2);
    expect(client.aiMediaPlanEvent.create).not.toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: 'SLOT_REFERENCES_UPDATED' }),
    }));
  });

  it('re-runs unique-conflict classification inside a Serializable transaction', async () => {
    const operation = {
      operationKey: 'approve-unique-race', expectedRevision: 1, actorUserId: 'owner-1',
      decision: 'APPROVE' as const, note: null,
    };
    const event = {
      planId: 'plan-1', ownerUserId: 'owner-1',
      payloadHash: hashAiMediaPlanningJson(operation), eventType: 'REVIEW_APPROVED',
    };
    const plan = planRow({
      revision: 2, reviewStatus: 'APPROVED', approvedVersionId: 'version-1', event,
    });
    const client = sourceClient(plan);
    client.aiMediaPlanEvent.findUnique.mockResolvedValue(event);
    client.$transaction
      .mockRejectedValueOnce({ code: 'P2002' })
      .mockImplementation(async (action: (tx: any) => Promise<unknown>) => action(client));
    const repository = new PrismaAiMediaPlanningRepository(client);

    const result = await repository.reviewCurrent({
      planId: 'plan-1', ownerUserId: 'owner-1', ...operation,
    });

    expect(result).toMatchObject({ kind: 'replayed', plan: { revision: 2 } });
    expect(client.$transaction).toHaveBeenCalledTimes(2);
  });
});

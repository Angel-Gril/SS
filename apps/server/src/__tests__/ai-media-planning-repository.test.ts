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
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'a'.repeat(64),
    sourceProfileHash: 'b'.repeat(64),
    sourceSchemaVersion: 'source-product-capture-v2',
    inputFingerprint: 'c'.repeat(64),
    planSchemaVersion: 'ai-image-prompt-plan/2.0',
    plannerVersion: 'ai-media-rule-planner/v1',
    mode: 'RULE_BASED',
    fallbackReason: null,
    inputSnapshot: { candidates: [{ id: 'media-1' }] },
    curation: {
      selectedCandidateIds: ['media-1'],
      selectionTarget: { minimum: 1, maximum: 14, eligibleCount: 1, selectedCount: 1, met: true },
    },
    curationHash: 'd'.repeat(64),
    visionEvidence: { images: [{ candidateId: 'media-1' }] },
    visionEvidenceHash: 'e'.repeat(64),
    planHash: 'f'.repeat(64),
    planPayload: {
      verifiedFacts: [],
      slots: [{
        status: 'READY', goal: 'sku_hero', ownership: { level: 'sku', key: 'sku-1' },
        references: [{ candidateId: 'media-1', evidenceIds: [candidateEvidenceId('snapshot-1', 'media-1')] }],
        factEvidenceIds: [],
        safetyConstraints: ['preserve_product_identity'],
        acceptanceChecks: ['product_matches_references'],
      }],
    },
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

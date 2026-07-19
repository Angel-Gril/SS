import { describe, expect, it, vi } from 'vitest';
import { PrismaAiImageSuiteCandidateRepository } from '../repositories/ai-image-suite-candidate-repository.js';

const sourceUpdatedAt = new Date('2026-07-20T01:00:00.000Z');

function reviewInput(overrides: Record<string, unknown> = {}) {
  return {
    suiteId: 'suite-1', slotId: 'slot-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
    expectedWorkflowRevision: 3, operationKey: 'review-operation-1', outputAssetId: 'output-1',
    decision: 'APPROVE' as const, note: null, production: false,
    ...overrides,
  };
}

function applyInput(overrides: Record<string, unknown> = {}) {
  return {
    suiteId: 'suite-1', slotId: 'slot-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
    expectedWorkflowRevision: 4, operationKey: 'apply-operation-1',
    expectedTargetUpdatedAt: sourceUpdatedAt.toISOString(), production: false,
    ...overrides,
  };
}

function fixture(options: {
  reviewed?: boolean;
  stalePlan?: boolean;
  latestSnapshotId?: string;
} = {}) {
  const events = new Map<string, any>();
  const target = {
    id: 'goods-1', userId: 'owner-1', images: ['/original.png'],
    metadata: { watermarkedImages: ['/approved-original.png'], marker: 'keep' },
    updatedAt: new Date(sourceUpdatedAt),
    sourceCaptureSubject: {
      id: 'subject-1',
      snapshots: [{
        id: options.latestSnapshotId || 'snapshot-1', captureHash: 'a'.repeat(64),
        profileHash: 'b'.repeat(64), schemaVersion: 'source-product-capture-v2',
      }],
    },
  };
  const job: any = {
    id: 'job-1', ownerUserId: 'owner-1', workflowId: 'workflow-1', workflowAttempt: 1,
    status: 'SUCCEEDED', operation: 'IMAGE_TO_IMAGE', provider: 'fake', model: 'fake-image-suite-v1',
    assets: [{
      id: 'output-1', ownerUserId: 'owner-1', aiImageJobId: 'job-1',
      url: '/generated.png', createdAt: new Date('2026-07-20T00:30:00.000Z'),
    }],
  };
  const workflow: any = {
    id: 'workflow-1', ownerUserId: 'owner-1', contextType: 'collect', contextId: 'goods-1',
    contextSlotKey: 'sku:sku-1:hero', currentAttempt: 1, status: 'SUCCEEDED',
    reviewStatus: options.reviewed ? 'APPROVED' : 'PENDING',
    revision: options.reviewed ? 4 : 3,
    selectedOutputAssetId: options.reviewed ? 'output-1' : null,
    reviewedAt: options.reviewed ? new Date('2026-07-20T00:45:00.000Z') : null,
    inputs: [{
      ownerUserId: 'owner-1', assetId: 'source-1',
      asset: { id: 'source-1', ownerUserId: 'owner-1', sourceCaptureSnapshotId: 'snapshot-1' },
    }],
    jobs: [job],
  };
  const suite: any = {
    id: 'suite-1', ownerUserId: 'owner-1', planId: 'plan-1', planVersionId: 'version-1',
    sourceSubjectId: 'subject-1', sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'a'.repeat(64), sourceProfileHash: 'b'.repeat(64),
    sourceSchemaVersion: 'source-product-capture-v2', contextId: 'goods-1',
    provider: 'fake', model: 'fake-image-suite-v1',
    plan: {
      id: 'plan-1', ownerUserId: 'owner-1', sourceSubjectId: 'subject-1',
      currentVersionId: 'version-1', approvedVersionId: 'version-1',
      reviewStatus: 'APPROVED', staleAt: options.stalePlan ? new Date() : null,
    },
  };
  const slot: any = {
    id: 'slot-1', suiteId: 'suite-1', ownerUserId: 'owner-1', childWorkflowId: 'workflow-1',
    slotKey: 'sku:sku-1:hero', status: 'SUCCEEDED', attempt: 1, suite, childWorkflow: workflow,
  };

  const tx: any = {
    aiMediaSuiteSlot: {
      findFirst: vi.fn(async ({ where }: any) => (
        where.id === slot.id && where.suiteId === slot.suiteId && where.ownerUserId === slot.ownerUserId
          ? slot
          : null
      )),
    },
    supplyGoods: {
      findFirst: vi.fn(async ({ where }: any) => (
        where.id === target.id && where.userId === target.userId ? target : null
      )),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== target.id || where.userId !== target.userId
          || target.updatedAt.getTime() !== new Date(where.updatedAt).getTime()) return { count: 0 };
        Object.assign(target, data);
        return { count: 1 };
      }),
    },
    aiMediaWorkflow: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== workflow.id || where.ownerUserId !== workflow.ownerUserId
          || where.revision !== workflow.revision || where.currentAttempt !== workflow.currentAttempt
          || where.status !== workflow.status || where.reviewStatus !== workflow.reviewStatus
          || (where.selectedOutputAssetId !== undefined
            && where.selectedOutputAssetId !== workflow.selectedOutputAssetId)) return { count: 0 };
        if (data.reviewStatus) workflow.reviewStatus = data.reviewStatus;
        if (data.selectedOutputAssetId !== undefined) workflow.selectedOutputAssetId = data.selectedOutputAssetId;
        if (data.reviewedByUserId !== undefined) workflow.reviewedByUserId = data.reviewedByUserId;
        if (data.reviewedAt !== undefined) workflow.reviewedAt = data.reviewedAt;
        workflow.revision += Number(data.revision?.increment || 0);
        return { count: 1 };
      }),
    },
    aiMediaWorkflowEvent: {
      findUnique: vi.fn(async ({ where }: any) => events.get(where.eventKey) || null),
      create: vi.fn(async ({ data }: any) => {
        if (events.has(data.eventKey)) throw Object.assign(new Error('unique event'), { code: 'P2002' });
        const event = { id: `event-${events.size + 1}`, createdAt: new Date(), ...data };
        events.set(data.eventKey, event);
        return event;
      }),
    },
  };
  let tail = Promise.resolve();
  const client: any = {
    ...tx,
    $transaction: vi.fn((action: (client: any) => Promise<unknown>, settings: unknown) => {
      expect(settings).toEqual({ isolationLevel: 'Serializable' });
      const running = tail.then(() => action(tx));
      tail = running.then(() => undefined, () => undefined);
      return running;
    }),
  };
  return { client, tx, slot, suite, workflow, job, target, events };
}

describe('Prisma AI image suite candidate repository', () => {
  it('reviews the exact current output and replays the same operation without another mutation', async () => {
    const state = fixture();
    const repository = new PrismaAiImageSuiteCandidateRepository(state.client);

    const first = await repository.review(reviewInput());
    const replay = await repository.review(reviewInput());
    const changed = await repository.review(reviewInput({ operationKey: 'review-operation-2' }));

    expect(first).toMatchObject({ kind: 'updated', value: { reviewStatus: 'APPROVED', workflowRevision: 4 } });
    expect(replay).toMatchObject({ kind: 'replayed', value: { outputAssetId: 'output-1' } });
    expect(changed).toEqual({ kind: 'operation-conflict' });
    expect(state.tx.aiMediaWorkflow.updateMany).toHaveBeenCalledOnce();
    expect(state.events.size).toBe(1);
  });

  it('hides cross-owner candidates and rejects production fake candidates inside the transaction', async () => {
    const state = fixture();
    const repository = new PrismaAiImageSuiteCandidateRepository(state.client);

    await expect(repository.review(reviewInput({ ownerUserId: 'owner-2' })))
      .resolves.toEqual({ kind: 'not-found' });
    await expect(repository.review(reviewInput({ production: true })))
      .resolves.toEqual({ kind: 'provider-not-ready' });
    expect(state.tx.aiMediaWorkflow.updateMany).not.toHaveBeenCalled();
  });

  it('blocks stale plan and latest-source authority before review mutation', async () => {
    const stalePlan = fixture({ stalePlan: true });
    const staleSource = fixture({ latestSnapshotId: 'snapshot-2' });

    await expect(new PrismaAiImageSuiteCandidateRepository(stalePlan.client).review(reviewInput()))
      .resolves.toEqual({ kind: 'stale' });
    await expect(new PrismaAiImageSuiteCandidateRepository(staleSource.client).review(reviewInput()))
      .resolves.toEqual({ kind: 'stale' });
    expect(stalePlan.tx.aiMediaWorkflow.updateMany).not.toHaveBeenCalled();
    expect(staleSource.tx.aiMediaWorkflow.updateMany).not.toHaveBeenCalled();
  });

  it('appends through the collect publish projection and records only an immutable workflow event', async () => {
    const state = fixture({ reviewed: true });
    const repository = new PrismaAiImageSuiteCandidateRepository(state.client);

    const first = await repository.apply(applyInput());
    const replay = await repository.apply(applyInput());

    expect(first).toMatchObject({
      kind: 'updated',
      value: {
        jobId: 'job-1', outputAssetId: 'output-1', mode: 'append', targetType: 'collect',
        images: ['/approved-original.png', '/generated.png'], editedImages: ['/generated.png'],
      },
    });
    expect(replay).toMatchObject({ kind: 'replayed', value: { jobId: 'job-1' } });
    expect(state.target).toMatchObject({
      images: ['/approved-original.png', '/generated.png'],
      metadata: {
        marker: 'keep',
        watermarkedImages: ['/approved-original.png', '/generated.png'],
        editedImages: ['/generated.png'],
      },
    });
    expect(state.job.appliedAt).toBeUndefined();
    expect(state.job.appliedMode).toBeUndefined();
    expect(state.tx.supplyGoods.updateMany).toHaveBeenCalledOnce();
    expect([...state.events.values()]).toEqual([
      expect.objectContaining({ eventType: 'SUITE_CANDIDATE_APPLIED', jobId: 'job-1', assetId: 'output-1' }),
    ]);
  });

  it('replays an application after PostgreSQL JSONB changes payload key order', async () => {
    const state = fixture({ reviewed: true });
    const repository = new PrismaAiImageSuiteCandidateRepository(state.client);

    await expect(repository.apply(applyInput())).resolves.toMatchObject({ kind: 'updated' });
    const event = [...state.events.values()][0]!;
    event.payload = Object.fromEntries(Object.entries(event.payload).reverse());

    await expect(repository.apply(applyInput())).resolves.toMatchObject({
      kind: 'replayed',
      value: { jobId: 'job-1', outputAssetId: 'output-1' },
    });
  });

  it('does not persist unbounded or non-public image arrays in the application event', async () => {
    const state = fixture({ reviewed: true });
    state.target.metadata = {
      watermarkedImages: Array.from({ length: 40 }, (_, index) => `https://cdn.example/${index}.png`),
      editedImages: ['data:image/png;base64,secret'],
    } as any;
    const repository = new PrismaAiImageSuiteCandidateRepository(state.client);

    await expect(repository.apply(applyInput())).resolves.toMatchObject({ kind: 'updated' });
    const event = [...state.events.values()][0]!;
    expect(event.payload).toMatchObject({
      resultTruncated: true,
      images: [],
      editedImages: [],
      imageCount: 41,
      editedImageCount: 2,
    });
    expect(JSON.stringify(event.payload)).not.toContain('data:image/png;base64,secret');
  });

  it('returns current target CAS state without mutating the workflow', async () => {
    const state = fixture({ reviewed: true });
    state.target.updatedAt = new Date('2026-07-20T02:00:00.000Z');
    const repository = new PrismaAiImageSuiteCandidateRepository(state.client);

    const result = await repository.apply(applyInput());

    expect(result).toMatchObject({ kind: 'target-conflict', targetUpdatedAt: state.target.updatedAt });
    expect(state.tx.supplyGoods.updateMany).not.toHaveBeenCalled();
    expect(state.tx.aiMediaWorkflow.updateMany).not.toHaveBeenCalled();
  });

  it('serializes different operation keys so one candidate can be applied only once', async () => {
    const state = fixture({ reviewed: true });
    const repository = new PrismaAiImageSuiteCandidateRepository(state.client);

    const results = await Promise.all([
      repository.apply(applyInput({ operationKey: 'apply-concurrent-1' })),
      repository.apply(applyInput({ operationKey: 'apply-concurrent-2' })),
    ]);

    expect(results.map((result) => result.kind).sort()).toEqual(['operation-conflict', 'updated']);
    expect(state.tx.supplyGoods.updateMany).toHaveBeenCalledOnce();
    expect(state.events.size).toBe(1);
  });
});

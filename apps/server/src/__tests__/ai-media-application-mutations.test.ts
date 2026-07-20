import { describe, expect, it, vi } from 'vitest';
import {
  AiMediaApplicationMutationError,
  applyAiMediaWorkflowApplication,
  applyCollectMediaProjection,
  captureCollectMediaProjection,
  listAiMediaTargetApplications,
  nextAiMediaTargetVersion,
  rollbackAiMediaWorkflowApplication,
  restoreCollectMediaProjection,
} from '../services/ai-media-application-mutations.js';

function mutationDatabaseFixture() {
  const ownerUserId = 'owner-1';
  const workflow = {
    id: 'workflow-1',
    ownerUserId,
    revision: 1,
    status: 'SUCCEEDED',
    reviewStatus: 'APPROVED',
    selectedOutputAssetId: 'asset-1',
    selectedOutputAsset: {
      id: 'asset-1', kind: 'AI_GENERATED', aiImageJobId: 'job-1', url: '/generated.png',
    },
    contextType: 'collect',
    contextId: 'goods-1',
    contextSkuKey: null,
    contextSlotKey: null,
    currentAttempt: 1,
    operation: 'IMAGE_TO_IMAGE',
    inputs: [{ role: 'REFERENCE', asset: { sourceCaptureSnapshotId: 'snapshot-1' } }],
    suiteSlot: null,
  };
  const target = {
    id: 'goods-1',
    images: ['/original.png'],
    metadata: {},
    updatedAt: new Date('2026-07-20T00:00:00.000Z'),
    sourceCaptureSubject: {
      id: 'subject-1',
      snapshots: [{
        id: 'snapshot-1', captureHash: 'a'.repeat(64), profileHash: 'b'.repeat(64),
        schemaVersion: 'source-product-capture-v2',
      }],
    },
  };
  const job = {
    id: 'job-1', ownerUserId, workflowId: workflow.id, status: 'SUCCEEDED',
    operation: 'IMAGE_TO_IMAGE', provider: 'fake', model: 'fake-image-v1',
    appliedAt: null as Date | null, workflowAttempt: 1,
  };
  const mutations: any[] = [];
  const events: any[] = [];
  let createAttempts = 0;

  const withRelations = (row: any) => ({
    ...row,
    rolledBackBy: row.kind === 'APPLY'
      ? mutations.find((candidate) => candidate.kind === 'ROLLBACK' && candidate.rollbackOfId === row.id) || null
      : null,
  });
  const mutationMatches = (row: any, where: Record<string, any>) => {
    for (const [key, expected] of Object.entries(where)) {
      if (key === 'rolledBackBy') {
        const rollback = mutations.find((candidate) => (
          candidate.kind === 'ROLLBACK' && candidate.rollbackOfId === row.id
        ));
        if (expected === null && rollback) return false;
        continue;
      }
      if (key === 'targetSequence' && expected && typeof expected === 'object') {
        if (typeof expected.lt === 'number' && row.targetSequence >= expected.lt) return false;
        continue;
      }
      if (row[key] !== expected) return false;
    }
    return true;
  };

  const tx: any = {
    $queryRawUnsafe: async (query: string, id: string, owner: string) => {
      if (query.includes('FROM "ai_media_workflows"')) {
        return id === workflow.id && owner === ownerUserId ? [{ id }] : [];
      }
      if (query.includes('FROM "supply_goods"')) {
        return id === target.id && owner === ownerUserId ? [{ id }] : [];
      }
      return [];
    },
    aiMediaWorkflow: {
      findFirst: async ({ where }: any) => (
        where.id === workflow.id && where.ownerUserId === ownerUserId ? workflow : null
      ),
      updateMany: async ({ where, data }: any) => {
        if (where.id !== workflow.id || where.ownerUserId !== ownerUserId
          || where.revision !== workflow.revision) return { count: 0 };
        workflow.revision += Number(data.revision?.increment || 0);
        return { count: 1 };
      },
    },
    supplyGoods: {
      findFirst: async ({ where }: any) => (
        where.id === target.id && where.userId === ownerUserId ? target : null
      ),
      updateMany: async ({ where, data }: any) => {
        if (where.id !== target.id || where.userId !== ownerUserId
          || !(where.updatedAt instanceof Date)
          || where.updatedAt.getTime() !== target.updatedAt.getTime()) return { count: 0 };
        target.images = data.images;
        target.metadata = data.metadata;
        target.updatedAt = data.updatedAt;
        return { count: 1 };
      },
    },
    aiImageJob: {
      findFirst: async ({ where }: any) => (
        where.id === job.id && where.ownerUserId === ownerUserId && where.workflowId === workflow.id
          ? job
          : null
      ),
      updateMany: async ({ where, data }: any) => {
        if (where.id !== job.id || where.ownerUserId !== ownerUserId
          || where.status !== job.status || where.appliedAt !== job.appliedAt) return { count: 0 };
        job.appliedAt = data.appliedAt;
        return { count: 1 };
      },
      findMany: async () => [],
    },
    aiMediaApplicationMutation: {
      findFirst: async ({ where, orderBy }: any) => {
        const found = mutations
          .filter((row) => mutationMatches(row, where))
          .sort((left, right) => orderBy?.targetSequence === 'desc'
            ? right.targetSequence - left.targetSequence
            : 0)[0];
        return found ? withRelations(found) : null;
      },
      create: async ({ data }: any) => {
        createAttempts += 1;
        if (mutations.some((row) => row.jobId === data.jobId && row.kind === data.kind)) {
          throw Object.assign(new Error('Unique constraint failed on job_id, kind'), { code: 'P2002' });
        }
        const row = {
          id: `mutation-${mutations.length + 1}`,
          createdAt: new Date(data.targetVersionAfter),
          rollbackOfId: null,
          ...data,
        };
        mutations.push(row);
        return withRelations(row);
      },
    },
    aiMediaWorkflowEvent: {
      create: async ({ data }: any) => {
        events.push(data);
        return data;
      },
    },
  };
  const database = {
    ...tx,
    $transaction: async (action: (client: any) => Promise<unknown>) => action(tx),
  };

  return {
    database,
    ownerUserId,
    workflow,
    target,
    mutations,
    events,
    get createAttempts() { return createAttempts; },
  };
}

describe('AI media application mutations', () => {
  it('captures metadata field presence and restores only the managed image projection', () => {
    const beforeMetadata = { marker: 'keep', editedImages: ['https://cdn.example/existing-edit.png'] };
    const before = captureCollectMediaProjection(
      ['https://cdn.example/original.png'],
      beforeMetadata,
    );
    const applied = applyCollectMediaProjection(
      before,
      ['https://cdn.example/generated.png'],
      'append',
    );

    expect(before).toEqual({
      version: 'ai-media-collect-projection/v1',
      images: ['https://cdn.example/original.png'],
      watermarkedImages: { present: false, value: [] },
      editedImages: { present: true, value: ['https://cdn.example/existing-edit.png'] },
    });
    expect(applied.images).toEqual([
      'https://cdn.example/original.png',
      'https://cdn.example/generated.png',
    ]);
    expect(applied.watermarkedImages).toEqual({
      present: true,
      value: ['https://cdn.example/original.png', 'https://cdn.example/generated.png'],
    });
    expect(applied.editedImages.value).toEqual([
      'https://cdn.example/existing-edit.png',
      'https://cdn.example/generated.png',
    ]);

    expect(restoreCollectMediaProjection({
      marker: 'preserve-later-change',
      unrelated: { enabled: true },
      watermarkedImages: applied.watermarkedImages.value,
      editedImages: applied.editedImages.value,
    }, before)).toEqual({
      images: before.images,
      metadata: {
        marker: 'preserve-later-change',
        unrelated: { enabled: true },
        editedImages: ['https://cdn.example/existing-edit.png'],
      },
    });
  });

  it('supports an exact replace projection without mutating the captured before state', () => {
    const before = captureCollectMediaProjection(
      ['https://cdn.example/original.png'],
      {
        watermarkedImages: ['https://cdn.example/publish.png'],
        editedImages: ['https://cdn.example/edit.png'],
      },
    );

    const replaced = applyCollectMediaProjection(
      before,
      ['https://cdn.example/generated.png'],
      'replace',
    );

    expect(replaced.images).toEqual(['https://cdn.example/generated.png']);
    expect(replaced.watermarkedImages.value).toEqual(['https://cdn.example/generated.png']);
    expect(replaced.editedImages.value).toEqual(['https://cdn.example/generated.png']);
    expect(before.images).toEqual(['https://cdn.example/original.png']);
    expect(before.watermarkedImages.value).toEqual(['https://cdn.example/publish.png']);
  });

  it('preserves null images and rejects metadata that cannot be restored losslessly', () => {
    const before = captureCollectMediaProjection(null, null);
    expect(before.images).toBeNull();

    const applied = applyCollectMediaProjection(
      before,
      ['https://cdn.example/generated.png'],
      'append',
    );
    expect(restoreCollectMediaProjection({
      watermarkedImages: applied.watermarkedImages.value,
      editedImages: applied.editedImages.value,
    }, before).images).toBeNull();

    expect(() => captureCollectMediaProjection([], ['not', 'an', 'object']))
      .toThrowError(AiMediaApplicationMutationError);
    expect(() => restoreCollectMediaProjection(null, before))
      .toThrowError(AiMediaApplicationMutationError);
  });

  it('rejects malformed persisted projections before restore or hashing', () => {
    const malformed = {
      version: 'ai-media-collect-projection/v0',
      images: [],
      watermarkedImages: { present: 'yes', value: [] },
      editedImages: { present: false, value: [] },
    };

    expect(() => restoreCollectMediaProjection({}, malformed as never))
      .toThrowError(AiMediaApplicationMutationError);
  });

  it('rejects an unbounded reversible snapshot before a target can be changed', () => {
    expect(() => captureCollectMediaProjection(
      Array.from({ length: 101 }, (_, index) => `https://cdn.example/${index}.png`),
      {},
    )).toThrowError(AiMediaApplicationMutationError);
  });

  it('uses PostgreSQL jsonb text size when exponent numbers expand at persistence', () => {
    const legacyImages = [{ values: Array.from({ length: 12_000 }, () => 1e21) }];
    const compactProjection = {
      version: 'ai-media-collect-projection/v1',
      images: legacyImages,
      watermarkedImages: { present: false, value: [] },
      editedImages: { present: false, value: [] },
    };
    expect(Buffer.byteLength(JSON.stringify(compactProjection), 'utf8')).toBeLessThan(256 * 1024);
    expect(() => captureCollectMediaProjection(legacyImages, {})).toThrowError(expect.objectContaining({
      code: 'APPLICATION_STATE_TOO_LARGE',
    }));
  });

  it('always advances the target CAS timestamp by at least one millisecond', () => {
    const current = new Date(Date.now() + 60_000);
    expect(nextAiMediaTargetVersion(current).getTime()).toBe(current.getTime() + 1);
  });

  it('returns a controlled conflict when a rolled-back candidate is reapplied with a new operation key', async () => {
    const fixture = mutationDatabaseFixture();
    const applied = await applyAiMediaWorkflowApplication(fixture.database, {
      workflowId: fixture.workflow.id,
      ownerUserId: fixture.ownerUserId,
      actorUserId: fixture.ownerUserId,
      mode: 'append',
      operationKey: 'application-first-operation',
      expectedWorkflowRevision: 1,
      expectedTargetUpdatedAt: '2026-07-20T00:00:00.000Z',
    });
    const rolledBack = await rollbackAiMediaWorkflowApplication(fixture.database, {
      applicationId: applied.application.id,
      ownerUserId: fixture.ownerUserId,
      actorUserId: fixture.ownerUserId,
      operationKey: 'application-rollback-operation',
      expectedApplicationRevision: 1,
      expectedWorkflowRevision: 2,
      expectedTargetUpdatedAt: applied.target.updatedAt.toISOString(),
    });

    await expect(applyAiMediaWorkflowApplication(fixture.database, {
      workflowId: fixture.workflow.id,
      ownerUserId: fixture.ownerUserId,
      actorUserId: fixture.ownerUserId,
      mode: 'append',
      operationKey: 'application-second-operation',
      expectedWorkflowRevision: 3,
      expectedTargetUpdatedAt: rolledBack.target.updatedAt.toISOString(),
    })).rejects.toMatchObject({
      name: 'AiMediaApplicationMutationError',
      code: 'APPLICATION_CONFLICT',
      data: { applicationId: applied.application.id },
    });
    expect(fixture.createAttempts).toBe(2);
    expect(fixture.mutations.map((mutation) => mutation.kind)).toEqual(['APPLY', 'ROLLBACK']);
    expect(fixture.events).toHaveLength(2);
  });

  it('turns an owner operation-key unique race into replay or an idempotency conflict', async () => {
    const fixture = mutationDatabaseFixture();
    const input = {
      workflowId: fixture.workflow.id,
      ownerUserId: fixture.ownerUserId,
      actorUserId: fixture.ownerUserId,
      mode: 'append' as const,
      operationKey: 'application-race-operation',
      expectedWorkflowRevision: 1,
      expectedTargetUpdatedAt: '2026-07-20T00:00:00.000Z',
    };
    const applied = await applyAiMediaWorkflowApplication(fixture.database, input);
    fixture.database.$transaction = vi.fn(async () => {
      throw { code: 'P2002', meta: { target: ['owner_user_id', 'operation_key'] } };
    }) as any;

    const replay = await applyAiMediaWorkflowApplication(fixture.database, input);
    expect(replay.replayed).toBe(true);
    expect(replay.application.id).toBe(applied.application.id);
    await expect(applyAiMediaWorkflowApplication(fixture.database, {
      ...input,
      mode: 'replace',
      replaceConfirmed: true,
    })).rejects.toMatchObject({
      name: 'AiMediaApplicationMutationError',
      code: 'IDEMPOTENCY_KEY_CONFLICT',
    });
    expect(fixture.createAttempts).toBe(1);
  });

  it('reads the target, ledger and legacy envelope inside one repeatable-read transaction', async () => {
    const target = {
      id: 'goods-1', images: ['/original.png'], metadata: {},
      updatedAt: new Date('2026-07-20T00:00:00.000Z'),
      sourceCaptureSubject: { id: 'subject-1', snapshots: [] },
    };
    const tx = {
      supplyGoods: { findFirst: vi.fn(async () => target) },
      aiMediaApplicationMutation: {
        findMany: vi.fn(async () => []),
        findFirst: vi.fn(async () => null),
      },
      aiImageJob: { findMany: vi.fn(async () => []) },
    };
    const database = {
      $transaction: vi.fn(async (action: (client: typeof tx) => Promise<unknown>, options: unknown) => {
        expect(options).toEqual({ isolationLevel: 'RepeatableRead' });
        return action(tx);
      }),
    };
    const result = await listAiMediaTargetApplications(database, {
      ownerUserId: 'owner-1', targetId: 'goods-1', limit: 10,
    });
    expect(result.target.updatedAt).toEqual(target.updatedAt);
    expect(database.$transaction).toHaveBeenCalledOnce();
    expect(tx.supplyGoods.findFirst).toHaveBeenCalledOnce();
    expect(tx.aiMediaApplicationMutation.findMany).toHaveBeenCalled();
    expect(tx.aiImageJob.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        applicationMutations: { none: { kind: 'APPLY' } },
      }),
      take: 10,
    }));
  });
});

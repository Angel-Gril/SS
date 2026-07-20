import { describe, expect, it, vi } from 'vitest';
import {
  AiImageApplicationError,
  applyAiImageAssets,
  projectCollectImageAppend,
} from '../services/ai-image-application.js';

type State = ReturnType<typeof createState>;

function createState() {
  const job = {
    id: 'job-1',
    ownerUserId: 'owner-1',
    workflowId: null as string | null,
    operation: 'TEXT_TO_IMAGE' as string,
    status: 'SUCCEEDED',
    appliedMode: null as string | null,
    applyTargetType: null as string | null,
    applyTargetId: null as string | null,
    appliedAt: null as Date | null,
    assets: [
      { id: 'asset-1', kind: 'AI_GENERATED', ownerUserId: 'owner-1', aiImageJobId: 'job-1', url: 'https://cdn.example/generated-1.png' },
      { id: 'asset-2', kind: 'AI_GENERATED', ownerUserId: 'owner-1', aiImageJobId: 'job-1', url: 'https://cdn.example/generated-2.png' },
    ],
    workflow: {
      contextType: 'collect',
      contextId: 'collect-1',
      reviewStatus: 'APPROVED',
      selectedOutputAssetId: 'asset-1',
      inputs: [{ asset: { sourceCaptureSnapshotId: 'snapshot-1' } }],
    },
  };
  const collect = {
    id: 'collect-1', userId: 'owner-1', images: ['https://cdn.example/original.png'] as unknown,
    metadata: {} as Record<string, unknown>, updatedAt: new Date('2026-07-16T00:00:00.000Z'),
    sourceCaptureSubject: { snapshots: [{ id: 'snapshot-1' }] },
  };
  const product = {
    id: 'product-1', images: ['https://cdn.example/product-original.png'] as unknown,
    shop: { userId: 'owner-1' }, updatedAt: new Date('2026-07-16T00:00:00.000Z'),
  };

  return { job, collect, product };
}

function database(state: State) {
  const tx = {
    aiImageJob: {
      findUnique: vi.fn(async ({ where }: any) => where.id === state.job.id ? state.job : null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== state.job.id || state.job.appliedAt !== null) return { count: 0 };
        Object.assign(state.job, data);
        return { count: 1 };
      }),
    },
    aiMediaWorkflowEvent: {
      create: vi.fn(async () => ({})),
    },
    supplyGoods: {
      findFirst: vi.fn(async ({ where }: any) => where.id === state.collect.id && where.userId === state.collect.userId ? state.collect : null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== state.collect.id || where.userId !== state.collect.userId) return { count: 0 };
        if (where.updatedAt && where.updatedAt.getTime() !== state.collect.updatedAt.getTime()) return { count: 0 };
        Object.assign(state.collect, data);
        return { count: 1 };
      }),
    },
    product: {
      findFirst: vi.fn(async ({ where }: any) => where.id === state.product.id ? state.product : null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (where.id !== state.product.id) return { count: 0 };
        if (where.updatedAt && where.updatedAt.getTime() !== state.product.updatedAt.getTime()) return { count: 0 };
        Object.assign(state.product, data);
        return { count: 1 };
      }),
    },
  };
  return {
    tx,
    $transaction: vi.fn(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx)),
  };
}

const apply = (db: ReturnType<typeof database>, overrides: Partial<Parameters<typeof applyAiImageAssets>[1]> = {}) => applyAiImageAssets(db as any, {
  jobId: 'job-1',
  ownerUserId: 'owner-1',
  actorUserId: 'actor-1',
  mode: 'append',
  targetType: 'collect',
  targetId: 'collect-1',
  ...overrides,
});

describe('AI image asset application', () => {
  it('applies only the explicitly approved final edit candidate and never the raw Provider output', async () => {
    const state = createState();
    state.job.workflowId = 'workflow-1';
    state.job.operation = 'INPAINT';
    state.job.assets.push({
      id: 'raw-asset-1', kind: 'AI_PROVIDER_OUTPUT', ownerUserId: 'owner-1',
      aiImageJobId: 'job-1', url: 'https://cdn.example/provider-raw.png',
    });
    const db = database(state);

    const result = await apply(db, {
      selectedAssetId: 'asset-1',
      expectedTargetUpdatedAt: state.collect.updatedAt.toISOString(),
    });

    expect(result.images).toContain('https://cdn.example/generated-1.png');
    expect(result.images).not.toContain('https://cdn.example/provider-raw.png');
    expect(result.mode).toBe('append');
  });

  it('rejects edit replacement, missing final selection, and raw-output selection', async () => {
    const state = createState();
    state.job.workflowId = 'workflow-1';
    state.job.operation = 'FULL_EDIT';
    state.job.assets.push({
      id: 'raw-asset-1', kind: 'AI_PROVIDER_OUTPUT', ownerUserId: 'owner-1',
      aiImageJobId: 'job-1', url: 'https://cdn.example/provider-raw.png',
    });
    const updatedAt = state.collect.updatedAt.toISOString();

    await expect(apply(database(structuredClone(state) as State), {
      mode: 'replace', selectedAssetId: 'asset-1', expectedTargetUpdatedAt: updatedAt,
    })).rejects.toMatchObject({ code: 'UNSAFE_APPLY_MODE' });
    await expect(apply(database(structuredClone(state) as State), {
      selectedAssetId: null, expectedTargetUpdatedAt: updatedAt,
    })).rejects.toMatchObject({ code: 'INVALID_STATE' });
    await expect(apply(database(structuredClone(state) as State), {
      selectedAssetId: 'raw-asset-1', expectedTargetUpdatedAt: updatedAt,
    })).rejects.toMatchObject({ code: 'INVALID_STATE' });

    const rejected = structuredClone(state) as State;
    rejected.job.workflow.reviewStatus = 'REJECTED';
    await expect(apply(database(rejected), {
      selectedAssetId: 'asset-1', expectedTargetUpdatedAt: updatedAt,
    })).rejects.toMatchObject({ code: 'INVALID_STATE' });
  });

  it('projects append-only collect images from the current publish authority without mutating input', () => {
    const metadata = {
      marker: 'keep',
      watermarkedImages: ['https://cdn.example/approved.png'],
      editedImages: ['https://cdn.example/edited.png'],
    };

    const result = projectCollectImageAppend(
      ['https://cdn.example/legacy.png'],
      metadata,
      ['https://cdn.example/generated.png', 'https://cdn.example/generated.png'],
    );

    expect(result).toEqual({
      images: ['https://cdn.example/approved.png', 'https://cdn.example/generated.png'],
      editedImages: ['https://cdn.example/edited.png', 'https://cdn.example/generated.png'],
      mainImage: 'https://cdn.example/approved.png',
      metadata: {
        marker: 'keep',
        watermarkedImages: ['https://cdn.example/approved.png', 'https://cdn.example/generated.png'],
        editedImages: ['https://cdn.example/edited.png', 'https://cdn.example/generated.png'],
      },
    });
    expect(metadata.watermarkedImages).toEqual(['https://cdn.example/approved.png']);
  });

  it('rejects a job owned by another tenant without touching a target', async () => {
    const state = createState();
    const db = database(state);

    await expect(apply(db, { ownerUserId: 'other-owner' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.tx.supplyGoods.updateMany).not.toHaveBeenCalled();
    expect(db.tx.aiImageJob.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a target owned by another tenant', async () => {
    const state = createState();
    state.collect.userId = 'other-owner';
    const db = database(state);

    await expect(apply(db)).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
    expect(db.tx.supplyGoods.updateMany).not.toHaveBeenCalled();
  });

  it('appends generated images while preserving originals and removing duplicate URLs', async () => {
    const state = createState();
    state.collect.images = [
      'https://cdn.example/original.png',
      'https://cdn.example/generated-1.png',
      'https://cdn.example/original.png',
    ];
    const db = database(state);

    const result = await apply(db);

    expect(state.collect.images).toEqual([
      'https://cdn.example/original.png',
      'https://cdn.example/generated-1.png',
      'https://cdn.example/generated-2.png',
    ]);
    expect(result.images).toEqual(state.collect.images);
    expect(result.targetUpdatedAt).toEqual(state.collect.updatedAt);
    expect(state.collect.metadata).toMatchObject({
      watermarkedImages: state.collect.images,
      editedImages: ['https://cdn.example/generated-1.png', 'https://cdn.example/generated-2.png'],
    });
    expect(state.job).toMatchObject({
      appliedMode: 'append',
      applyTargetType: 'collect',
      applyTargetId: 'collect-1',
    });
    expect(state.job.appliedAt).toBeInstanceOf(Date);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
  });

  it('appends to the existing publish image authority instead of a stale legacy image array', async () => {
    const state = createState();
    state.collect.metadata = {
      sourceMainImages: ['https://source.example/original.png'],
      watermarkedImages: ['https://cdn.example/approved-original.png'],
    };
    const db = database(state);
    await apply(db);
    expect(state.collect.images).toEqual([
      'https://cdn.example/approved-original.png',
      'https://cdn.example/generated-1.png',
      'https://cdn.example/generated-2.png',
    ]);
    expect(state.collect.metadata.watermarkedImages).toEqual(state.collect.images);
  });

  it('records the applying actor and reviewed output in the immutable workflow event history', async () => {
    const state = createState();
    state.job.workflowId = 'workflow-1';
    const db = database(state);

    await apply(db, {
      selectedAssetId: 'asset-1',
      expectedTargetUpdatedAt: state.collect.updatedAt.toISOString(),
    });

    expect(db.tx.aiMediaWorkflowEvent.create).toHaveBeenCalledWith({ data: expect.objectContaining({
      workflowId: 'workflow-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      jobId: 'job-1',
      assetId: 'asset-1',
      eventKey: 'workflow-1:applied:job-1',
      eventType: 'APPLIED',
      payload: expect.objectContaining({ targetType: 'collect', targetId: 'collect-1', outputAssetId: 'asset-1' }),
      payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }) });
  });

  it('replaces the product image array and makes the first generated image the main image', async () => {
    const state = createState();
    const db = database(state);

    const result = await apply(db, { mode: 'replace', targetType: 'product', targetId: 'product-1' });

    expect(state.product.images).toEqual([
      'https://cdn.example/generated-1.png',
      'https://cdn.example/generated-2.png',
    ]);
    expect(result.mainImage).toBe('https://cdn.example/generated-1.png');
    expect(state.job).toMatchObject({ appliedMode: 'replace', applyTargetType: 'product', applyTargetId: 'product-1' });
  });

  it('rejects assets that do not belong to both the job and owner', async () => {
    const state = createState();
    state.job.assets[0]!.ownerUserId = 'other-owner';
    const db = database(state);

    await expect(apply(db)).rejects.toMatchObject({ code: 'INVALID_ASSETS' });
    expect(db.tx.supplyGoods.updateMany).not.toHaveBeenCalled();
  });

  it('rejects jobs that have not succeeded', async () => {
    const state = createState();
    state.job.status = 'FAILED';
    const db = database(state);

    await expect(apply(db)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(db.tx.supplyGoods.updateMany).not.toHaveBeenCalled();
  });

  it('keeps image translation application append-only', async () => {
    const state = createState();
    state.job.operation = 'IMAGE_TRANSLATE';
    const db = database(state);

    await expect(apply(db, { mode: 'replace' })).rejects.toMatchObject({
      code: 'UNSAFE_APPLY_MODE',
    });
    expect(db.tx.supplyGoods.updateMany).not.toHaveBeenCalled();
    expect(db.tx.aiImageJob.updateMany).not.toHaveBeenCalled();
  });

  it('prevents applying the same job twice', async () => {
    const state = createState();
    const db = database(state);
    await apply(db);
    const onceAppliedImages = structuredClone(state.collect.images);

    await expect(apply(db, { mode: 'replace' })).rejects.toBeInstanceOf(AiImageApplicationError);

    expect(state.collect.images).toEqual(onceAppliedImages);
    expect(db.tx.supplyGoods.updateMany).toHaveBeenCalledTimes(1);
  });

  it('rejects a stale target version before mutating the target, job or audit history', async () => {
    const state = createState();
    state.job.workflowId = 'workflow-1';
    const db = database(state);

    await expect(apply(db, {
      selectedAssetId: 'asset-1',
      expectedTargetUpdatedAt: '2026-07-15T00:00:00.000Z',
    })).rejects.toMatchObject({
      code: 'TARGET_CONFLICT',
      data: expect.objectContaining({ targetUpdatedAt: state.collect.updatedAt }),
    });

    expect(db.tx.supplyGoods.updateMany).not.toHaveBeenCalled();
    expect(db.tx.aiImageJob.updateMany).not.toHaveBeenCalled();
    expect(db.tx.aiMediaWorkflowEvent.create).not.toHaveBeenCalled();
  });

  it('requires a target version for workflow-backed collect application', async () => {
    const state = createState();
    state.job.workflowId = 'workflow-1';
    const db = database(state);

    await expect(apply(db, { selectedAssetId: 'asset-1' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(db.tx.supplyGoods.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a workflow candidate when the collect source snapshot changed', async () => {
    const state = createState();
    state.job.workflowId = 'workflow-1';
    state.collect.sourceCaptureSubject.snapshots = [{ id: 'snapshot-2' }];
    const db = database(state);

    await expect(apply(db, {
      selectedAssetId: 'asset-1',
      expectedTargetUpdatedAt: state.collect.updatedAt.toISOString(),
    })).rejects.toMatchObject({ code: 'STALE_MEDIA_WORKFLOW' });
    expect(db.tx.supplyGoods.updateMany).not.toHaveBeenCalled();
    expect(db.tx.aiImageJob.updateMany).not.toHaveBeenCalled();
  });

  it('reloads authoritative target state when the target CAS loses after the initial read', async () => {
    const state = createState();
    state.job.workflowId = 'workflow-1';
    const db = database(state);
    db.tx.supplyGoods.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(apply(db, {
      selectedAssetId: 'asset-1',
      expectedTargetUpdatedAt: state.collect.updatedAt.toISOString(),
    })).rejects.toMatchObject({
      code: 'TARGET_CONFLICT',
      data: expect.objectContaining({
        targetUpdatedAt: state.collect.updatedAt,
        images: state.collect.images,
      }),
    });

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(db.tx.aiImageJob.updateMany).not.toHaveBeenCalled();
  });

  it('retries a serializable apply conflict before exposing the stable application result', async () => {
    const state = createState();
    const db = database(state);
    db.$transaction.mockRejectedValueOnce({ code: 'P2034' });

    await expect(apply(db)).resolves.toMatchObject({ mode: 'append', targetId: 'collect-1' });

    expect(db.$transaction).toHaveBeenCalledTimes(2);
    expect(state.job.appliedAt).toBeInstanceOf(Date);
  });
});

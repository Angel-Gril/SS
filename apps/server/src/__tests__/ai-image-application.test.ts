import { describe, expect, it, vi } from 'vitest';
import {
  AiImageApplicationError,
  applyAiImageAssets,
} from '../services/ai-image-application.js';

type State = ReturnType<typeof createState>;

function createState() {
  const job = {
    id: 'job-1',
    ownerUserId: 'owner-1',
    status: 'SUCCEEDED',
    appliedMode: null as string | null,
    applyTargetType: null as string | null,
    applyTargetId: null as string | null,
    appliedAt: null as Date | null,
    assets: [
      { id: 'asset-1', ownerUserId: 'owner-1', aiImageJobId: 'job-1', url: 'https://cdn.example/generated-1.png' },
      { id: 'asset-2', ownerUserId: 'owner-1', aiImageJobId: 'job-1', url: 'https://cdn.example/generated-2.png' },
    ],
  };
  const collect = { id: 'collect-1', userId: 'owner-1', images: ['https://cdn.example/original.png'] as unknown };
  const product = { id: 'product-1', images: ['https://cdn.example/product-original.png'] as unknown, shop: { userId: 'owner-1' } };

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
    supplyGoods: {
      findFirst: vi.fn(async ({ where }: any) => where.id === state.collect.id && where.userId === state.collect.userId ? state.collect : null),
      update: vi.fn(async ({ data }: any) => Object.assign(state.collect, data)),
    },
    product: {
      findFirst: vi.fn(async ({ where }: any) => where.id === state.product.id ? state.product : null),
      update: vi.fn(async ({ data }: any) => Object.assign(state.product, data)),
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
  mode: 'append',
  targetType: 'collect',
  targetId: 'collect-1',
  ...overrides,
});

describe('AI image asset application', () => {
  it('rejects a job owned by another tenant without touching a target', async () => {
    const state = createState();
    const db = database(state);

    await expect(apply(db, { ownerUserId: 'other-owner' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(db.tx.supplyGoods.update).not.toHaveBeenCalled();
    expect(db.tx.aiImageJob.updateMany).not.toHaveBeenCalled();
  });

  it('rejects a target owned by another tenant', async () => {
    const state = createState();
    state.collect.userId = 'other-owner';
    const db = database(state);

    await expect(apply(db)).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
    expect(db.tx.supplyGoods.update).not.toHaveBeenCalled();
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
    expect(state.job).toMatchObject({
      appliedMode: 'append',
      applyTargetType: 'collect',
      applyTargetId: 'collect-1',
    });
    expect(state.job.appliedAt).toBeInstanceOf(Date);
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: 'Serializable' });
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
    expect(db.tx.supplyGoods.update).not.toHaveBeenCalled();
  });

  it('rejects jobs that have not succeeded', async () => {
    const state = createState();
    state.job.status = 'FAILED';
    const db = database(state);

    await expect(apply(db)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(db.tx.supplyGoods.update).not.toHaveBeenCalled();
  });

  it('prevents applying the same job twice', async () => {
    const state = createState();
    const db = database(state);
    await apply(db);
    const onceAppliedImages = structuredClone(state.collect.images);

    await expect(apply(db, { mode: 'replace' })).rejects.toBeInstanceOf(AiImageApplicationError);

    expect(state.collect.images).toEqual(onceAppliedImages);
    expect(db.tx.supplyGoods.update).toHaveBeenCalledTimes(1);
  });
});

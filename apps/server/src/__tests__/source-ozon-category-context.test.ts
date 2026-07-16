import { describe, expect, it, vi } from 'vitest';
import {
  createSourceOzonCategoryContextLoader,
  PrismaSourceOzonCategoryContextRepository,
  SourceOzonCategoryContextError,
} from '../services/source-ozon-category-context.js';

const profile = {
  profileVersion: 'source-product-profile/v1',
  sourceTitle: '女式棉质T恤',
  categoryName: 'T恤',
  categoryPath: ['服装', '女装', 'T恤'],
  categoryHints: ['女装', 'T恤'],
  productIntentTerms: ['T恤'],
  productTypeHints: ['上衣'],
  genderSeasonHints: ['女'],
};

describe('source Ozon category canonical context', () => {
  it('loads source identity and scoring profile only from the latest persisted snapshot', async () => {
    const findLatestSnapshot = vi.fn(async () => ({
      id: 'snapshot-7',
      profileHash: 'a'.repeat(64),
      payload: {
        platform: '1688',
        sourceCategory: { id: '1031910', path: [' 服装 ', '女装', 'T恤'] },
      },
      profile,
    }));
    const loader = createSourceOzonCategoryContextLoader({
      repository: { findLatestSnapshot },
    });

    await expect(loader.load({
      ownerUserId: 'tenant-a',
      supplyGoodsId: 'goods-1',
    })).resolves.toEqual({
      source: {
        snapshotId: 'snapshot-7',
        profileHash: 'a'.repeat(64),
        sourcePlatform: '1688',
        sourceCategoryId: '1031910',
        sourceCategoryPath: [' 服装 ', '女装', 'T恤'],
      },
      profile,
    });
    expect(findLatestSnapshot).toHaveBeenCalledWith({
      ownerUserId: 'tenant-a',
      supplyGoodsId: 'goods-1',
    });
  });

  it.each([
    ['missing snapshot', null],
    ['missing source category', {
      id: 'snapshot-7',
      profileHash: 'a'.repeat(64),
      payload: { platform: '1688', sourceCategory: null },
      profile,
    }],
    ['invalid profile hash', {
      id: 'snapshot-7',
      profileHash: 'forged',
      payload: { platform: '1688', sourceCategory: { id: '1031910', path: ['服装'] } },
      profile,
    }],
  ])('fails closed for %s', async (_label, snapshot) => {
    const loader = createSourceOzonCategoryContextLoader({
      repository: { findLatestSnapshot: vi.fn(async () => snapshot as any) },
    });

    await expect(loader.load({
      ownerUserId: 'tenant-a',
      supplyGoodsId: 'goods-1',
    })).rejects.toBeInstanceOf(SourceOzonCategoryContextError);
  });

  it('queries the owner-bound subject and selects only the latest snapshot fields', async () => {
    const findFirst = vi.fn(async () => ({
      snapshots: [{
        id: 'snapshot-7',
        profileHash: 'a'.repeat(64),
        payload: { platform: '1688', sourceCategory: { id: '1031910', path: ['服装'] } },
        profile,
      }],
    }));
    const repository = new PrismaSourceOzonCategoryContextRepository({
      sourceCaptureSubject: { findFirst },
    } as any);

    await expect(repository.findLatestSnapshot({
      ownerUserId: 'tenant-a',
      supplyGoodsId: 'goods-1',
    })).resolves.toMatchObject({ id: 'snapshot-7' });
    expect(findFirst).toHaveBeenCalledWith({
      where: {
        ownerUserId: 'tenant-a',
        legacySupplyGoodsId: 'goods-1',
      },
      select: {
        snapshots: {
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true, profileHash: true, payload: true, profile: true },
        },
      },
    });
  });
});

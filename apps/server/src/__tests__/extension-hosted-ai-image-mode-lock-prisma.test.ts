import { describe, expect, it, vi } from 'vitest';
import {
  ExtensionHostedAiImageModeLockPrismaError,
  createPrismaExtensionHostedAiImageModeLockLoader,
} from '../services/extension-hosted-ai-image-mode-lock-prisma.js';

const binding = {
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-1',
  draftRevision: 11,
  draftVersion: 7,
};

describe('extension hosted AI image mode lock Prisma loader', () => {
  it.each([false, true])('returns the exact persisted suite existence value %s', async (hasSuite) => {
    const client = {
      $queryRawUnsafe: vi.fn(async (_query: string, ..._values: unknown[]) => [{ hasSuite }]),
    };
    const loader = createPrismaExtensionHostedAiImageModeLockLoader(client);

    await expect(loader.hasHostedSuite({ ownerUserId: 'owner-1', binding })).resolves.toBe(hasSuite);
    expect(client.$queryRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, ...values] = client.$queryRawUnsafe.mock.calls[0]!;
    expect(sql).toContain('FROM "extension_hosted_ai_image_plan_bindings" binding');
    expect(sql).toContain('JOIN "ai_media_suites" suite');
    expect(sql).not.toContain('device_session_id');
    expect(values).toEqual([
      'owner-1',
      'shop-1',
      'listing-1',
      'snapshot-1',
      'goods-1',
      11,
      7,
    ]);
  });

  it.each([
    { label: 'empty result', rows: [] },
    { label: 'multiple rows', rows: [{ hasSuite: false }, { hasSuite: true }] },
    { label: 'non-boolean marker', rows: [{ hasSuite: 0 }] },
    { label: 'extra field', rows: [{ hasSuite: false, suiteId: null }] },
  ])('fails closed for $label', async ({ rows }) => {
    const loader = createPrismaExtensionHostedAiImageModeLockLoader({
      $queryRawUnsafe: vi.fn(async (_query: string, ..._values: unknown[]) => rows),
    });

    await expect(loader.hasHostedSuite({ ownerUserId: 'owner-1', binding })).rejects.toBeInstanceOf(
      ExtensionHostedAiImageModeLockPrismaError,
    );
  });

  it('rejects invalid input before database access', async () => {
    const client = {
      $queryRawUnsafe: vi.fn(async (_query: string, ..._values: unknown[]) => []),
    };
    const loader = createPrismaExtensionHostedAiImageModeLockLoader(client);

    await expect(loader.hasHostedSuite({
      ownerUserId: 'owner-1',
      binding: { ...binding, listingWorkflowId: ' listing-1' },
    })).rejects.toMatchObject({ code: 'HOSTED_AI_IMAGE_MODE_LOCK_PRISMA_INVALID_INPUT' });
    expect(client.$queryRawUnsafe).not.toHaveBeenCalled();
  });
});

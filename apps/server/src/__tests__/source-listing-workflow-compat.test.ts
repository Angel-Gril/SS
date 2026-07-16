import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from 'shared';

const adapterMocks = vi.hoisted(() => ({
  assertOwnedTarget: vi.fn(),
  createDraft: vi.fn(),
  queryRawUnsafe: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: { $queryRawUnsafe: adapterMocks.queryRawUnsafe },
}));

vi.mock('../services/source-listing-workflow.js', () => ({
  createSourceListingWorkflowService: () => ({ createDraft: adapterMocks.createDraft }),
}));

vi.mock('../services/source-listing-workflow-prisma.js', () => ({
  createPrismaSourceListingWorkflowRepository: () => ({}),
}));

vi.mock('../services/source-listing-workflow-context.js', () => ({
  createPrismaSourceListingWorkflowContextResolver: () => ({
    assertOwnedTarget: adapterMocks.assertOwnedTarget,
  }),
}));

import {
  createPrismaLegacySourceListingWorkflowAdapter,
  resolveLegacyProjectionSkuKeys,
  resolveLegacySourceListingCompatibility,
  sourceListingCompatibilityMetadata,
} from '../routes/source-listing-workflow-compat.js';

function flags(decision: Record<string, unknown>) {
  return { evaluate: vi.fn(async () => ({ captureStage: null, ...decision })) } as any;
}

const prepared = {
  drafts: [{ supplyGoodsId: 'goods-1', draftId: 'draft-1', draftVersion: 1, revision: 1 }],
  failures: [],
};

describe('legacy source listing workflow compatibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('maps the exact projected SKU set without silently truncating it', () => {
    const skus = Array.from({ length: 700 }, (_, index) => ({
      key: `canonical-${index}`,
      sourceSkuId: `source-${index}`,
    }));
    expect(resolveLegacyProjectionSkuKeys({
      payload: { skus },
      sku: 'source-600',
      variants: [{ sourceSkuId: 'source-12' }, { sku: 'source-499' }],
    })).toEqual(['canonical-12', 'canonical-499', 'canonical-600']);
    expect(resolveLegacyProjectionSkuKeys({ payload: { skus }, sku: null, variants: [] }))
      .toHaveLength(700);
  });

  it('maps and prepares a product-only capture through the reserved canonical SKU', async () => {
    expect(resolveLegacyProjectionSkuKeys({
      payload: { capture: { skus: [] } },
      sku: 'legacy-product-sku',
      variants: [{ sku: 'legacy-product-sku' }],
    })).toEqual([SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY]);

    adapterMocks.queryRawUnsafe.mockResolvedValue([{
      payload: { capture: { skus: [] } },
      sku: 'legacy-product-sku',
      variants: [],
    }]);
    adapterMocks.assertOwnedTarget.mockImplementation(async (input) => ({
      ...input,
      sourceCaptureSnapshotId: 'snapshot-product-only',
      sourceCaptureHash: 'a'.repeat(64),
    }));
    adapterMocks.createDraft.mockResolvedValue({ id: 'draft-product-only', draftVersion: 1, revision: 1 });

    await expect(createPrismaLegacySourceListingWorkflowAdapter().prepare({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      shopId: 'shop-1',
      supplyGoodsIds: ['goods-product-only'],
    })).resolves.toEqual({
      drafts: [{
        supplyGoodsId: 'goods-product-only',
        draftId: 'draft-product-only',
        draftVersion: 1,
        revision: 1,
        selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
      }],
      failures: [],
    });
    expect(adapterMocks.assertOwnedTarget).toHaveBeenCalledWith(expect.objectContaining({
      selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
    }));
    expect(adapterMocks.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
    }));
  });

  it('returns an explicit per-goods failure when a projection exceeds 500 SKUs', async () => {
    adapterMocks.queryRawUnsafe.mockResolvedValue([{
      payload: {
        skus: Array.from({ length: 501 }, (_, index) => ({ key: `sku-${index}` })),
      },
      sku: null,
      variants: [],
    }]);

    await expect(createPrismaLegacySourceListingWorkflowAdapter().prepare({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      shopId: 'shop-1',
      supplyGoodsIds: ['goods-large'],
    })).resolves.toEqual({
      drafts: [],
      failures: [{
        supplyGoodsId: 'goods-large',
        errorCode: 'SOURCE_LISTING_SKU_LIMIT_EXCEEDED',
      }],
    });
    expect(adapterMocks.assertOwnedTarget).not.toHaveBeenCalled();
    expect(adapterMocks.createDraft).not.toHaveBeenCalled();
  });

  it('prepares all 101 unique requested goods instead of silently stopping at 100', async () => {
    const supplyGoodsIds = Array.from({ length: 101 }, (_, index) => `goods-${index}`);
    const adapter = {
      prepare: vi.fn(async ({ supplyGoodsIds: requested }: { supplyGoodsIds: string[] }) => ({
        drafts: requested.map((supplyGoodsId, index) => ({
          supplyGoodsId,
          draftId: `draft-${index}`,
          draftVersion: 1,
          revision: 1,
        })),
        failures: [],
      })),
    };
    const result = await resolveLegacySourceListingCompatibility({
      featureFlags: flags({ enabled: true, legacyAllowed: true, listingStage: 'shadow_write', revision: 'r-many' }),
      adapter, ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
      platform: 'OZON', supplyGoodsIds: [...supplyGoodsIds, 'goods-100'],
    });

    expect(adapter.prepare).toHaveBeenCalledWith(expect.objectContaining({ supplyGoodsIds }));
    expect(result.requestedSupplyGoodsIds).toEqual(supplyGoodsIds);
    expect(result.drafts).toHaveLength(101);
    expect(sourceListingCompatibilityMetadata(result)).toMatchObject({
      draftWriteStatus: 'ready',
      workflowPrepared: true,
      coverage: { requested: 101, prepared: 101, failed: 0, complete: true },
    });
  });

  it('turns omitted adapter results into explicit failures and reports exact partial coverage', async () => {
    const adapter = { prepare: vi.fn(async () => prepared) };
    const result = await resolveLegacySourceListingCompatibility({
      featureFlags: flags({ enabled: true, legacyAllowed: true, listingStage: 'dual_read', revision: 'r-partial' }),
      adapter, ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
      platform: 'OZON', supplyGoodsIds: ['goods-1', 'goods-2', 'goods-2'],
    });

    expect(result.failures).toEqual([{
      supplyGoodsId: 'goods-2',
      errorCode: 'SOURCE_LISTING_SHADOW_WRITE_INCOMPLETE',
    }]);
    expect(sourceListingCompatibilityMetadata(result)).toMatchObject({
      readAuthority: 'legacy',
      publishPayloadSource: 'legacy',
      draftWriteStatus: 'partial',
      workflowPrepared: false,
      coverage: { requested: 2, prepared: 1, failed: 1, complete: true },
    });
  });

  it('keeps legacy authoritative while shadow-writing a draft', async () => {
    const adapter = { prepare: vi.fn(async () => prepared) };
    const result = await resolveLegacySourceListingCompatibility({
      featureFlags: flags({ enabled: true, legacyAllowed: true, listingStage: 'shadow_write', revision: 'r1' }),
      adapter, ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
      platform: 'OZON', supplyGoodsIds: ['goods-1'],
    });
    expect(result).toMatchObject({ action: 'legacy', stage: 'shadow_write', drafts: prepared.drafts });
    expect(adapter.prepare).toHaveBeenCalledOnce();
  });

  it('dual-read prepares the workflow while preserving the legacy writer', async () => {
    const adapter = { prepare: vi.fn(async () => prepared) };
    const base = {
      featureFlags: flags({ enabled: true, legacyAllowed: true, listingStage: 'dual_read', revision: 'r2' }),
      adapter, ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
      platform: 'OZON', supplyGoodsIds: ['goods-1'],
    };
    const result = await resolveLegacySourceListingCompatibility(base);
    expect(result).toMatchObject({ action: 'legacy', stage: 'dual_read' });
    expect(sourceListingCompatibilityMetadata(result)).toMatchObject({
      readAuthority: 'legacy',
      publishPayloadSource: 'legacy',
      workflowPrepared: true,
    });
    await expect(resolveLegacySourceListingCompatibility({ ...base, legacyFallback: true }))
      .resolves.toMatchObject({ action: 'legacy', legacyFallback: true });
    await expect(resolveLegacySourceListingCompatibility({ ...base, supplyGoodsIds: [] }))
      .resolves.toMatchObject({ action: 'legacy', stage: 'dual_read', drafts: [] });
  });

  it('keeps the legacy writer until publisher V2 owns the cutoff, including v2_only and policy errors', async () => {
    const adapter = { prepare: vi.fn(async () => prepared) };
    await expect(resolveLegacySourceListingCompatibility({
      featureFlags: flags({ enabled: true, legacyAllowed: false, listingStage: 'v2_only', revision: 'r3' }),
      adapter, ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
      platform: 'OZON', supplyGoodsIds: ['goods-1'],
    })).resolves.toMatchObject({ action: 'legacy', stage: 'v2_only' });
    await expect(resolveLegacySourceListingCompatibility({
      featureFlags: flags({ enabled: false, legacyAllowed: false, revision: 'unavailable' }),
      adapter, ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
      platform: 'OZON', supplyGoodsIds: [],
    })).resolves.toMatchObject({
      action: 'legacy', stage: 'off',
      failures: [{ errorCode: 'SOURCE_LISTING_WORKFLOW_POLICY_UNAVAILABLE' }],
    });
  });

  it('records a draft-write failure without interrupting the legacy writer', async () => {
    const adapter = { prepare: vi.fn(async () => { throw Object.assign(new Error('db unavailable'), { code: 'DB_UNAVAILABLE' }); }) };
    const result = await resolveLegacySourceListingCompatibility({
      featureFlags: flags({ enabled: true, legacyAllowed: true, listingStage: 'shadow_write', revision: 'r4' }),
      adapter, ownerUserId: 'owner-1', actorUserId: 'owner-1', shopId: 'shop-1',
      platform: 'OZON', supplyGoodsIds: ['goods-1'],
    });
    expect(result).toMatchObject({
      action: 'legacy',
      failures: [{ supplyGoodsId: 'goods-1', errorCode: 'DB_UNAVAILABLE' }],
    });
  });
});

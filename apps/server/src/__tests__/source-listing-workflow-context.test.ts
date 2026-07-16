import { describe, expect, it } from 'vitest';
import {
  createPrismaSourceListingWorkflowContextResolver,
  SourceListingWorkflowContextError,
} from '../services/source-listing-workflow-context.js';
import {
  SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
  capturedSourceSkuAliases,
} from '../services/source-listing-sku-identity.js';

class ScriptedClient {
  readonly calls: Array<{ sql: string; params: unknown[] }> = [];
  constructor(private readonly handler: (sql: string, params: unknown[]) => unknown[]) {}
  async $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T> {
    this.calls.push({ sql, params });
    return this.handler(sql, params) as T;
  }
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    snapshotId: 'snap-db', captureHash: 'a'.repeat(64), subjectId: 'subject-1',
    supplyGoodsId: 'goods-1', payload: {
      skus: [
        { key: 'canonical-a', sourceSkuId: 'sku-a' },
        { key: 'canonical-b', sourceSkuId: 'sku-b' },
      ],
    },
    ...overrides,
  };
}

describe('source listing SKU aliases', () => {
  it('gives canonical keys precedence while rejecting ambiguous legacy aliases', () => {
    const aliases = capturedSourceSkuAliases({
      skus: [
        { key: 'canonical-a', sourceSkuId: 'canonical-b' },
        { key: 'canonical-b', sourceSkuId: 'source-b' },
        { key: 'canonical-c', sourceSkuId: 'shared-alias' },
        { key: 'canonical-d', sourceSkuId: 'shared-alias' },
      ],
    });

    expect(aliases.get('canonical-a')).toBe('canonical-a');
    expect(aliases.get('canonical-b')).toBe('canonical-b');
    expect(aliases.get('source-b')).toBe('canonical-b');
    expect(aliases.get('shared-alias')).toBeNull();
  });

  it('rejects canonical keys and aliases whose targets collide after NFKC normalization', () => {
    const aliases = capturedSourceSkuAliases({
      skus: [
        { key: 'sku-A', sourceSkuId: 'source-a' },
        { key: 'ｓｋｕ-A', sourceSkuId: 'source-b' },
      ],
    });

    expect(aliases.get('sku-A')).toBeNull();
    expect(aliases.get('source-a')).toBeNull();
    expect(aliases.get('source-b')).toBeNull();
  });
});

describe('source listing workflow production context resolver', () => {
  it('resolves an owned shop/source/requested snapshot and uses the database hash', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "shops"')) return [{ id: 'shop-1' }];
      if (sql.includes('FROM "supply_goods"')) return [{ supplyGoodsId: 'goods-1', subjectId: 'subject-1' }];
      if (sql.includes('FROM "source_capture_snapshots"')) return [snapshot()];
      return [];
    });
    const result = await createPrismaSourceListingWorkflowContextResolver({ client })
      .assertOwnedTarget({
        ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
        sourceCaptureSnapshotId: 'snap-hint', selectedSkuKeys: [' sku-b ', 'sku-a', 'sku-a'],
      });
    expect(result).toEqual({
      shopId: 'shop-1', supplyGoodsId: 'goods-1', sourceCaptureSnapshotId: 'snap-db',
      sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['canonical-a', 'canonical-b'],
    });
    const snapshotCall = client.calls.find(({ sql }) => sql.includes('FROM "source_capture_snapshots"'))!;
    expect(snapshotCall.params).toEqual(['snap-hint', 'owner-1', 'subject-1']);
  });

  it('loads the latest owner-bound snapshot when the client does not choose one', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "shops"')) return [{ id: 'shop-1' }];
      if (sql.includes('FROM "supply_goods"')) return [{ supplyGoodsId: 'goods-1', subjectId: 'subject-1' }];
      if (sql.includes('ORDER BY sn."version" DESC')) return [snapshot({ snapshotId: 'snap-latest' })];
      return [];
    });
    const result = await createPrismaSourceListingWorkflowContextResolver({ client })
      .assertOwnedTarget({
        ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
        selectedSkuKeys: ['canonical-a'],
      });
    expect(result.sourceCaptureSnapshotId).toBe('snap-latest');
    expect(client.calls.some(({ sql }) => sql.includes('ORDER BY sn."version" DESC'))).toBe(true);
  });

  it('canonicalizes the product-only sentinel only for an owned snapshot with no SKU rows', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "shops"')) return [{ id: 'shop-1' }];
      if (sql.includes('FROM "supply_goods"')) return [{ supplyGoodsId: 'goods-1', subjectId: 'subject-1' }];
      if (sql.includes('FROM "source_capture_snapshots"')) {
        return [snapshot({ payload: { captureVersion: 'source-product-capture-v2', skus: [] } })];
      }
      return [];
    });

    await expect(createPrismaSourceListingWorkflowContextResolver({ client }).assertOwnedTarget({
      ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
      selectedSkuKeys: [` ${SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY} `],
    })).resolves.toMatchObject({
      selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
    });
  });

  it('never treats the product-only sentinel as an alias when real SKU rows exist', async () => {
    const client = new ScriptedClient((sql) => {
      if (sql.includes('FROM "shops"')) return [{ id: 'shop-1' }];
      if (sql.includes('FROM "supply_goods"')) return [{ supplyGoodsId: 'goods-1', subjectId: 'subject-1' }];
      if (sql.includes('FROM "source_capture_snapshots"')) {
        return [snapshot({
          payload: {
            skus: [{ key: 'canonical-a', sourceSkuId: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY }],
          },
        })];
      }
      return [];
    });

    await expect(createPrismaSourceListingWorkflowContextResolver({ client }).assertOwnedTarget({
      ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
      selectedSkuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY],
    })).rejects.toMatchObject({ code: 'SOURCE_LISTING_SKU_INVALID', statusCode: 422 });
  });

  it('rejects a foreign/inactive shop and SKU keys absent from the canonical snapshot', async () => {
    const noShop = new ScriptedClient(() => []);
    await expect(createPrismaSourceListingWorkflowContextResolver({ client: noShop })
      .assertOwnedTarget({
        ownerUserId: 'owner-1', shopId: 'foreign-shop', supplyGoodsId: 'goods-1',
        selectedSkuKeys: ['sku-a'],
      })).rejects.toMatchObject({
      code: 'SOURCE_LISTING_SHOP_NOT_FOUND', statusCode: 404,
    } satisfies Partial<SourceListingWorkflowContextError>);

    const invalidSku = new ScriptedClient((sql) => {
      if (sql.includes('FROM "shops"')) return [{ id: 'shop-1' }];
      if (sql.includes('FROM "supply_goods"')) return [{ supplyGoodsId: 'goods-1', subjectId: 'subject-1' }];
      if (sql.includes('FROM "source_capture_snapshots"')) return [snapshot()];
      return [];
    });
    await expect(createPrismaSourceListingWorkflowContextResolver({ client: invalidSku })
      .assertOwnedTarget({
        ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
        selectedSkuKeys: ['sku-foreign'],
      })).rejects.toMatchObject({ code: 'SOURCE_LISTING_SKU_INVALID', statusCode: 422 });
  });
});

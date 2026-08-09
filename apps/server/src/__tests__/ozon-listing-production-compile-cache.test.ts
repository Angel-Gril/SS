import { describe, expect, it, vi } from 'vitest';

import {
  createOzonListingProductionCompileCache,
  preflightOzonListingProductionCompile,
} from '../services/ozon-listing-production-compile-cache.js';

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workflow-1', ownerUserId: 'owner-1', shopId: 'shop-1',
    supplyGoodsId: 'supply-1', sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['sku-1'],
    draftVersion: 9, revision: 12, stage: 'READY_TO_PUBLISH', runState: 'ACTIVE',
    runStateReason: null,
    category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' },
    attributes: { values: { 1: { value: 'value-1' } } },
    copy: { publishTitleRu: 'Title', publishDescriptionRu: 'Description', candidates: [], applyAudit: [] },
    media: { assignments: [{ scope: 'SKU', skuKey: 'sku-1', slotKey: 'hero', assetId: 'asset-1', source: 'GENERATED' }] },
    pricing: { value: { items: [{ skuKey: 'sku-1', price: '10', oldPrice: '12', currencyCode: 'CNY', vat: '0' }] } },
    validation: { status: 'VALID', report: { schemaRevision: 'schema-1' } },
    completedStepHashes: {}, blockers: [], warnings: [], publishTaskIds: [],
    freshness: {}, grantRevocation: { required: false, reason: null, previousShopId: null },
    auditEvents: [], createdAt: '2026-08-09T00:00:00.000Z', updatedAt: '2026-08-09T00:00:00.000Z',
    ...overrides,
  } as any;
}

function input(value = draft()) {
  return { ownerUserId: 'owner-1', draft: value };
}

describe('Ozon listing production compile cache', () => {
  it('singleflights concurrent exact compilation and isolates returned values', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const compile = vi.fn(async () => {
      await gate;
      return { schema: { revision: 'schema-1' }, result: { status: 'VALID' } };
    });
    const cached = createOzonListingProductionCompileCache({ compile });

    const first = cached(input());
    const second = cached(input());
    await vi.waitFor(() => expect(compile).toHaveBeenCalledTimes(1));
    release();
    const [left, right] = await Promise.all([first, second]);
    left.schema.revision = 'mutated';
    expect(right.schema.revision).toBe('schema-1');
    expect((await cached(input())).schema.revision).toBe('schema-1');
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('reuses READY validation for the intent-only frozen draft transition', async () => {
    const compile = vi.fn(async () => ({ status: 'COMPILED' }));
    const cached = createOzonListingProductionCompileCache({ compile });
    const ready = draft();
    const frozen = draft({
      revision: 13,
      stage: 'PUBLISH_INTENT_RECORDED',
      publishTaskIds: ['intent-1'],
      auditEvents: [{ type: 'PUBLISH_INTENT_RECORDED' }],
      updatedAt: '2026-08-09T00:00:01.000Z',
    });

    await preflightOzonListingProductionCompile(cached, input(ready));
    await cached(input(frozen));
    expect(ready.stage).toBe('READY_TO_PUBLISH');
    expect(compile).toHaveBeenCalledWith(expect.objectContaining({
      draft: expect.objectContaining({
        revision: 12,
        stage: 'PUBLISH_INTENT_RECORDED',
      }),
    }));
    expect(compile).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-ready preflight without compiling', async () => {
    const compile = vi.fn(async () => ({ status: 'COMPILED' }));
    const cached = createOzonListingProductionCompileCache({ compile });

    await expect(preflightOzonListingProductionCompile(cached, input(draft({
      stage: 'PUBLISH_INTENT_RECORDED',
    })))).rejects.toThrow('Production compile preflight requires a ready draft');
    expect(compile).not.toHaveBeenCalled();
  });

  it('snapshots input before a caller can mutate it between keying and loading', async () => {
    const compile = vi.fn(async ({ draft: value }) => ({
      categoryId: value.category.categoryId,
      catalogRevision: value.category.catalogRevision,
    }));
    const cached = createOzonListingProductionCompileCache({ compile });
    const mutable = input();

    const original = cached(mutable);
    mutable.draft.category.categoryId = 11;
    mutable.draft.category.catalogRevision = 'catalog-2';

    await expect(original).resolves.toEqual({
      categoryId: 10,
      catalogRevision: 'catalog-1',
    });
    await expect(cached(mutable)).resolves.toEqual({
      categoryId: 11,
      catalogRevision: 'catalog-2',
    });
    await expect(cached(input())).resolves.toEqual({
      categoryId: 10,
      catalogRevision: 'catalog-1',
    });
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['category', { category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-2' } }],
    ['content', { copy: { publishTitleRu: 'Changed', publishDescriptionRu: 'Description', candidates: [], applyAudit: [] } }],
    ['media', { media: { assignments: [{ scope: 'SKU', skuKey: 'sku-1', slotKey: 'hero', assetId: 'asset-2', source: 'GENERATED' }] } }],
    ['validation', { validation: { status: 'VALID', report: { schemaRevision: 'schema-2' } } }],
    ['pricing', { pricing: { value: { items: [{ skuKey: 'sku-1', price: '11', oldPrice: '12', currencyCode: 'CNY', vat: '0' }] } } }],
  ])('invalidates when %s authority content changes', async (_label, change) => {
    const compile = vi.fn(async () => ({ status: 'COMPILED' }));
    const cached = createOzonListingProductionCompileCache({ compile });
    await cached(input());
    await cached(input(draft(change)));
    expect(compile).toHaveBeenCalledTimes(2);
  });

  it('expires successful validation and never caches a failure', async () => {
    let now = 0;
    const error = new Error('unavailable');
    const compile = vi.fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue({ status: 'COMPILED' });
    const cached = createOzonListingProductionCompileCache({
      compile, now: () => now, ttlMs: 1_000,
    });

    await expect(cached(input())).rejects.toBe(error);
    await expect(cached(input())).resolves.toEqual({ status: 'COMPILED' });
    now = 999;
    await cached(input());
    expect(compile).toHaveBeenCalledTimes(2);
    now = 1_001;
    await cached(input());
    expect(compile).toHaveBeenCalledTimes(3);
  });

  it('evicts the least-recent successful entry at the configured bound', async () => {
    const compile = vi.fn(async ({ draft: value }) => ({ workflowId: value.id }));
    const cached = createOzonListingProductionCompileCache({
      compile, maxEntries: 2,
    });
    const first = input(draft({ id: 'workflow-1' }));
    const second = input(draft({ id: 'workflow-2' }));
    const third = input(draft({ id: 'workflow-3' }));
    await cached(first);
    await cached(second);
    await cached(first);
    await cached(third);
    await cached(second);
    expect(compile).toHaveBeenCalledTimes(4);
  });
});

import { describe, expect, it, vi } from 'vitest';
import {
  createDirectListingSync,
  directListingSyncSchema,
  type DirectListingRepository,
} from '../services/direct-listing-sync.js';

const NOW = new Date('2026-11-11T04:00:00.000Z');

function payload(overrides: Record<string, unknown> = {}) {
  return {
    sourcePlatform: '1688',
    sourceProductId: '715234567890',
    sourceUrl: 'https://detail.1688.com/offer/715234567890.html',
    title: 'Платье миди женское',
    categoryId: 17028922,
    typeId: 93080,
    shopId: 'shop-1',
    items: [{
      offerId: '715234567890-1',
      skuKey: '粉色|M',
      productId: 6919447399,
      price: '2999',
      currency: 'RUB',
      status: 'imported',
      images: ['https://cdn.example.test/generated/a.png'],
    }],
    ...overrides,
  };
}

function repository(existing: { id: string; metadata: unknown } | null): DirectListingRepository & {
  update: ReturnType<typeof vi.fn>; create: ReturnType<typeof vi.fn>;
} {
  return {
    findBySource: vi.fn(async () => existing),
    update: vi.fn(async () => undefined),
    create: vi.fn(async () => ({ id: 'goods-new' })),
  };
}

describe('direct listing sync', () => {
  it('rejects payloads with non-https images, unknown keys, or no items', () => {
    expect(directListingSyncSchema.safeParse(payload()).success).toBe(true);
    expect(directListingSyncSchema.safeParse(payload({ items: [] })).success).toBe(false);
    expect(directListingSyncSchema.safeParse(payload({ ownerUserId: 'attacker' })).success).toBe(false);
    expect(directListingSyncSchema.safeParse(payload({
      items: [{ offerId: 'a-1', images: ['http://insecure.example.test/a.png'] }],
    })).success).toBe(false);
  });

  it('merges the direct listing into the existing collected record and keeps other metadata', async () => {
    const repo = repository({ id: 'goods-1', metadata: { publishTitleRu: 'old', watermarkApplied: true } });
    const sync = createDirectListingSync({ repository: repo, now: () => NOW });

    const result = await sync({ ownerUserId: 'owner-1', payload: directListingSyncSchema.parse(payload()) });

    expect(result).toEqual({ supplyGoodsId: 'goods-1', created: false, itemCount: 1 });
    expect(repo.findBySource).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', sourcePlatform: '1688', sourceProductId: '715234567890',
    });
    expect(repo.create).not.toHaveBeenCalled();
    const update = repo.update.mock.calls[0]![0];
    expect(update.id).toBe('goods-1');
    expect(update.ownerUserId).toBe('owner-1');
    expect(update.metadata).toMatchObject({
      publishTitleRu: 'old',
      watermarkApplied: true,
      directListing: {
        syncedAt: NOW.toISOString(),
        shopId: 'shop-1',
        title: 'Платье миди женское',
        categoryId: 17028922,
        typeId: 93080,
        items: [{ offerId: '715234567890-1', productId: '6919447399', images: ['https://cdn.example.test/generated/a.png'] }],
      },
    });
  });

  it('creates a collected record when the source product was never stored in ERP', async () => {
    const repo = repository(null);
    const sync = createDirectListingSync({ repository: repo, now: () => NOW });

    const result = await sync({ ownerUserId: 'owner-1', payload: directListingSyncSchema.parse(payload()) });

    expect(result).toEqual({ supplyGoodsId: 'goods-new', created: true, itemCount: 1 });
    expect(repo.update).not.toHaveBeenCalled();
    expect(repo.create).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1',
      sourcePlatform: '1688',
      sourceProductId: '715234567890',
      sourceUrl: 'https://detail.1688.com/offer/715234567890.html',
      title: 'Платье миди женское',
      images: ['https://cdn.example.test/generated/a.png'],
    }));
  });
});

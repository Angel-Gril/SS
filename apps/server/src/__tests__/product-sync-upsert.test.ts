import { describe, expect, it, vi } from 'vitest';
import { upsertSyncedOzonProduct } from '../services/product-sync-upsert.js';

describe('upsertSyncedOzonProduct', () => {
  it('uses platform product id as the normal sync key', async () => {
    const product = {
      upsert: vi.fn().mockResolvedValue({ id: 'product-1' }),
      update: vi.fn(),
    };

    await upsertSyncedOzonProduct({
      product,
      shopId: 'shop-1',
      platformProductId: '100',
      offerId: 'offer-1',
      create: { shopId: 'shop-1', platformProductId: '100', offerId: 'offer-1', title: 'A' },
      update: { title: 'A' },
    });

    expect(product.upsert).toHaveBeenCalledWith({
      where: { shopId_platformProductId: { shopId: 'shop-1', platformProductId: '100' } },
      create: { shopId: 'shop-1', platformProductId: '100', offerId: 'offer-1', title: 'A' },
      update: { title: 'A' },
    });
    expect(product.update).not.toHaveBeenCalled();
  });

  it('merges into the existing offer record when Ozon changes product id', async () => {
    const product = {
      upsert: vi.fn().mockRejectedValue({
        code: 'P2002',
        meta: { target: ['shop_id', 'offer_id'] },
      }),
      update: vi.fn().mockResolvedValue({ id: 'old-product' }),
    };

    await upsertSyncedOzonProduct({
      product,
      shopId: 'shop-1',
      platformProductId: '200',
      offerId: 'offer-1',
      create: { shopId: 'shop-1', platformProductId: '200', offerId: 'offer-1', title: 'B' },
      update: { title: 'B', syncStatus: 'SYNCED' },
    });

    expect(product.update).toHaveBeenCalledWith({
      where: { shopId_offerId: { shopId: 'shop-1', offerId: 'offer-1' } },
      data: { title: 'B', syncStatus: 'SYNCED', platformProductId: '200' },
    });
  });

  it('does not hide unrelated upsert errors', async () => {
    const error = { code: 'P2002', meta: { target: ['shop_id', 'platform_product_id'] } };
    const product = {
      upsert: vi.fn().mockRejectedValue(error),
      update: vi.fn(),
    };

    await expect(upsertSyncedOzonProduct({
      product,
      shopId: 'shop-1',
      platformProductId: '200',
      offerId: 'offer-1',
      create: {},
      update: {},
    })).rejects.toBe(error);
    expect(product.update).not.toHaveBeenCalled();
  });
});

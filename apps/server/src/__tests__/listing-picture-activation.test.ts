import { describe, expect, it, vi, beforeEach } from 'vitest';

const { productFindMany } = vi.hoisted(() => ({
  productFindMany: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    product: {
      findMany: productFindMany,
    },
  },
}));

import { findPictureActivationPendingItems } from '../routes/listing.js';

describe('listing picture activation checks', () => {
  beforeEach(() => {
    productFindMany.mockReset();
  });

  it('uses live Ozon product details before the local product cache', async () => {
    productFindMany.mockResolvedValue([
      { platformProductId: '1001', offerId: 'offer-blue', images: [] },
    ]);
    const client = {
      getProductInfoList: vi.fn().mockResolvedValue([
        {
          id: 1001,
          offer_id: 'offer-blue',
          primary_image: 'https://cdn.ozon.example/blue-main.jpg',
          images: [],
        },
      ]),
      getProductInfoAttributes: vi.fn().mockResolvedValue([]),
    };

    const pending = await findPictureActivationPendingItems(client as any, 'shop-1', [
      { product_id: 1001, offer_id: 'offer-blue' },
    ]);

    expect(pending).toEqual([]);
    expect(productFindMany).not.toHaveBeenCalled();
  });

  it('falls back to local products only when the live Ozon detail check fails', async () => {
    productFindMany.mockResolvedValue([
      { platformProductId: '1002', offerId: 'offer-red', images: [] },
      { platformProductId: '1003', offerId: 'offer-green', images: ['https://cdn.example/green.jpg'] },
    ]);
    const client = {
      getProductInfoList: vi.fn().mockRejectedValue(new Error('temporary ozon failure')),
      getProductInfoAttributes: vi.fn(),
    };

    const pending = await findPictureActivationPendingItems(client as any, 'shop-1', [
      { product_id: 1002, offer_id: 'offer-red' },
      { product_id: 1003, offer_id: 'offer-green' },
    ]);

    expect(pending).toEqual([
      {
        offerId: 'offer-red',
        productId: '1002',
        reason: 'Ozon 商品详情暂未返回图片',
      },
    ]);
    expect(productFindMany).toHaveBeenCalledOnce();
  });
});

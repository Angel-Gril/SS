import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateMock = vi.hoisted(() => vi.fn(async (request: any) => {
  request.user = { userId: 'user-1', role: 'USER' };
}));

const shopMock = vi.hoisted(() => ({
  findFirst: vi.fn(),
}));

const syncJobMock = vi.hoisted(() => ({
  create: vi.fn(),
}));

const supplyGoodsMock = vi.hoisted(() => ({
  findMany: vi.fn(),
  update: vi.fn(),
}));

const ozonRequestMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/auth.js', () => ({
  authenticate: authenticateMock,
}));

vi.mock('../lib/crypto.js', () => ({
  decrypt: vi.fn(() => 'plain-api-key'),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    shop: shopMock,
    syncJob: syncJobMock,
    supplyGoods: supplyGoodsMock,
  },
}));

vi.mock('../services/ozon-client.js', () => ({
  OzonClient: vi.fn(function (this: any) {
    this.request = ozonRequestMock;
  }),
}));

import { listingRoutes } from '../routes/listing.js';

describe('listing route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    shopMock.findFirst.mockResolvedValue({
      id: 'shop-1',
      userId: 'user-1',
      platform: 'OZON',
      status: 'ACTIVE',
      clientId: 'client-1',
      apiKeyEncrypted: 'encrypted-key',
    });
    syncJobMock.create.mockResolvedValue({ id: 'job-1' });
    supplyGoodsMock.findMany.mockResolvedValue([
      {
        id: 'supply-domestic',
        sourcePlatform: 'taobao',
        metadata: { sourceKind: 'alibaba1688' },
      },
      {
        id: 'supply-ozon',
        sourcePlatform: 'ozon',
        metadata: { sourceKind: 'ozon' },
      },
    ]);
    supplyGoodsMock.update.mockResolvedValue({});
    ozonRequestMock.mockResolvedValue({ result: { task_id: 9001 } });
  });

  it('updates only domestic supply records after submitting supply listing drafts', async () => {
    const app = Fastify();
    await app.register(listingRoutes, { prefix: '/api/listing' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/listing/batch',
      payload: {
        shopId: 'shop-1',
        source: '1688-listing',
        items: [
          {
            offerId: 'sstaobao-998877-tb-red',
            title: 'Товар Taobao',
            description: 'Описание',
            categoryId: 17028922,
            typeId: 93410,
            price: 129,
            currency: 'CNY',
            stock: 10,
            images: ['https://img.example.com/red.jpg'],
            weight: 500,
            height: 100,
            depth: 100,
            width: 100,
            sourceTrace: {
              supplyGoodsId: 'supply-domestic',
              sourcePlatform: 'taobao',
              sourceProductId: '998877',
              sourceSkuId: 'tb-red',
              ozonSku: 'ozon-red',
            },
          },
          {
            offerId: 'ssbad-ozon-red',
            title: 'Bad trace',
            description: 'Описание',
            categoryId: 17028922,
            typeId: 93410,
            price: 129,
            currency: 'CNY',
            stock: 10,
            images: ['https://img.example.com/bad.jpg'],
            weight: 500,
            height: 100,
            depth: 100,
            width: 100,
            sourceTrace: {
              supplyGoodsId: 'supply-ozon',
              sourcePlatform: 'ozon',
              sourceProductId: 'ozon-product-123',
              sourceSkuId: 'ozon-red',
            },
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ code: 1 });
    expect(supplyGoodsMock.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['supply-domestic', 'supply-ozon'] },
        userId: 'user-1',
        sourcePlatform: { in: ['1688', 'taobao', 'tmall', 'jd', 'pinduoduo', 'pdd'] },
      },
      select: { id: true, sourcePlatform: true, metadata: true },
    });
    expect(supplyGoodsMock.update).toHaveBeenCalledTimes(1);
    expect(supplyGoodsMock.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'supply-domestic' },
      data: expect.objectContaining({ status: 'listed' }),
    }));
  });
});

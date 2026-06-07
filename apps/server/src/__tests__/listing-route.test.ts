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
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({ code: 1 });
    expect(supplyGoodsMock.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['supply-domestic'] },
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

  it('rejects supply listing submissions without domestic source trace', async () => {
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
            offerId: 'sstaobao-998877-missing-trace',
            title: 'Товар без источника',
            description: 'Описание',
            categoryId: 17028922,
            typeId: 93410,
            price: 129,
            currency: 'CNY',
            stock: 10,
            images: ['https://img.example.com/missing-trace.jpg'],
            weight: 500,
            height: 100,
            depth: 100,
            width: 100,
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '货源上架商品缺少有效货源追踪，不能提交到 Ozon',
      data: {
        invalidItems: [
          {
            offerId: 'sstaobao-998877-missing-trace',
            reason: 'missing_source_trace',
          },
        ],
      },
    });
    expect(ozonRequestMock).not.toHaveBeenCalled();
    expect(syncJobMock.create).not.toHaveBeenCalled();
  });

  it('rejects supply listing submissions without source SKU trace', async () => {
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
            offerId: 'sstaobao-998877-no-source-sku',
            title: 'Товар без SKU источника',
            description: 'Описание',
            categoryId: 17028922,
            typeId: 93410,
            price: 129,
            currency: 'CNY',
            stock: 10,
            images: ['https://img.example.com/no-source-sku.jpg'],
            weight: 500,
            height: 100,
            depth: 100,
            width: 100,
            sourceTrace: {
              supplyGoodsId: 'supply-domestic',
              sourcePlatform: 'taobao',
              sourceProductId: '998877',
            },
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '货源上架商品缺少有效货源追踪，不能提交到 Ozon',
      data: {
        invalidItems: [
          {
            offerId: 'sstaobao-998877-no-source-sku',
            reason: 'missing_source_sku_id',
          },
        ],
      },
    });
    expect(ozonRequestMock).not.toHaveBeenCalled();
    expect(syncJobMock.create).not.toHaveBeenCalled();
  });

  it('rejects supply listing submissions that reference missing supply records before calling Ozon', async () => {
    supplyGoodsMock.findMany.mockResolvedValueOnce([]);

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
            offerId: 'sstaobao-missing-record-tb-red',
            title: 'Товар с отсутствующей записью',
            description: 'Описание',
            categoryId: 17028922,
            typeId: 93410,
            price: 129,
            currency: 'CNY',
            stock: 10,
            images: ['https://img.example.com/missing-record.jpg'],
            weight: 500,
            height: 100,
            depth: 100,
            width: 100,
            sourceTrace: {
              supplyGoodsId: 'missing-record',
              sourcePlatform: 'taobao',
              sourceProductId: '998877',
              sourceSkuId: 'tb-red',
            },
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '货源上架商品引用的采集记录不存在或不是货源记录',
      data: {
        invalidItems: [
          {
            offerId: 'sstaobao-missing-record-tb-red',
            supplyGoodsId: 'missing-record',
            reason: 'invalid_supply_goods_record',
          },
        ],
      },
    });
    expect(supplyGoodsMock.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ['missing-record'] },
        userId: 'user-1',
        sourcePlatform: { in: ['1688', 'taobao', 'tmall', 'jd', 'pinduoduo', 'pdd'] },
      },
      select: { id: true, sourcePlatform: true, sourceProductId: true, sku: true, variants: true },
    });
    expect(ozonRequestMock).not.toHaveBeenCalled();
    expect(syncJobMock.create).not.toHaveBeenCalled();
  });

  it('rejects supply listing submissions whose source SKU is not in the collected record variants', async () => {
    supplyGoodsMock.findMany.mockResolvedValueOnce([
      {
        id: 'supply-domestic',
        sourcePlatform: 'taobao',
        variants: [
          { sourceSkuId: 'tb-red', sourcePlatform: 'taobao' },
        ],
      },
    ]);

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
            offerId: 'sstaobao-998877-tb-blue',
            title: 'Товар с чужим SKU',
            description: 'Описание',
            categoryId: 17028922,
            typeId: 93410,
            price: 129,
            currency: 'CNY',
            stock: 10,
            images: ['https://img.example.com/tb-blue.jpg'],
            weight: 500,
            height: 100,
            depth: 100,
            width: 100,
            sourceTrace: {
              supplyGoodsId: 'supply-domestic',
              sourcePlatform: 'taobao',
              sourceProductId: '998877',
              sourceSkuId: 'tb-blue',
            },
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '货源上架商品引用的货源 SKU 不属于采集记录',
      data: {
        invalidItems: [
          {
            offerId: 'sstaobao-998877-tb-blue',
            supplyGoodsId: 'supply-domestic',
            sourceSkuId: 'tb-blue',
            reason: 'invalid_source_sku_id',
          },
        ],
      },
    });
    expect(ozonRequestMock).not.toHaveBeenCalled();
    expect(syncJobMock.create).not.toHaveBeenCalled();
  });

  it('rejects supply listing submissions whose Ozon trace does not match the collected source SKU variant', async () => {
    supplyGoodsMock.findMany.mockResolvedValueOnce([
      {
        id: 'supply-domestic',
        sourcePlatform: 'taobao',
        variants: [
          {
            sourceSkuId: 'tb-shared',
            sourcePlatform: 'taobao',
            ozonSku: 'ozon-red',
            ozonProductId: 'ozon-product-red',
            ozonOfferId: 'seller-offer-red',
          },
          {
            sourceSkuId: 'tb-shared',
            sourcePlatform: 'taobao',
            ozonSku: 'ozon-blue',
            ozonProductId: 'ozon-product-blue',
            ozonOfferId: 'seller-offer-blue',
          },
        ],
      },
    ]);

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
            offerId: 'sstaobao-998877-tb-shared',
            title: 'Товар с неверной связкой Ozon',
            description: 'Описание',
            categoryId: 17028922,
            typeId: 93410,
            price: 129,
            currency: 'CNY',
            stock: 10,
            images: ['https://img.example.com/tb-shared.jpg'],
            weight: 500,
            height: 100,
            depth: 100,
            width: 100,
            sourceTrace: {
              supplyGoodsId: 'supply-domestic',
              sourcePlatform: 'taobao',
              sourceProductId: '998877',
              sourceSkuId: 'tb-shared',
              ozonSku: 'ozon-green',
            },
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '货源上架商品引用的 Ozon 追踪不属于采集记录',
      data: {
        invalidItems: [
          {
            offerId: 'sstaobao-998877-tb-shared',
            supplyGoodsId: 'supply-domestic',
            sourceSkuId: 'tb-shared',
            ozonSku: 'ozon-green',
            reason: 'invalid_ozon_trace',
          },
        ],
      },
    });
    expect(ozonRequestMock).not.toHaveBeenCalled();
    expect(syncJobMock.create).not.toHaveBeenCalled();
  });

  it('rejects supply listing submissions whose source platform does not match the collected record', async () => {
    supplyGoodsMock.findMany.mockResolvedValueOnce([
      {
        id: 'supply-domestic',
        sourcePlatform: 'taobao',
        variants: [
          { sourceSkuId: 'tb-red', sourcePlatform: 'taobao' },
        ],
      },
    ]);

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
            offerId: 'ss1688-998877-tb-red',
            title: 'Товар с неверной платформой',
            description: 'Описание',
            categoryId: 17028922,
            typeId: 93410,
            price: 129,
            currency: 'CNY',
            stock: 10,
            images: ['https://img.example.com/tb-red.jpg'],
            weight: 500,
            height: 100,
            depth: 100,
            width: 100,
            sourceTrace: {
              supplyGoodsId: 'supply-domestic',
              sourcePlatform: '1688',
              sourceProductId: '998877',
              sourceSkuId: 'tb-red',
            },
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '货源上架商品引用的货源平台与采集记录不一致',
      data: {
        invalidItems: [
          {
            offerId: 'ss1688-998877-tb-red',
            supplyGoodsId: 'supply-domestic',
            sourcePlatform: '1688',
            collectedSourcePlatform: 'taobao',
            reason: 'source_platform_mismatch',
          },
        ],
      },
    });
    expect(ozonRequestMock).not.toHaveBeenCalled();
    expect(syncJobMock.create).not.toHaveBeenCalled();
  });

  it('rejects supply listing submissions whose source product id does not match the collected record', async () => {
    supplyGoodsMock.findMany.mockResolvedValueOnce([
      {
        id: 'supply-domestic',
        sourcePlatform: 'taobao',
        sourceProductId: '998877',
        sku: '998877',
        variants: [
          { sourceSkuId: 'tb-red', sourcePlatform: 'taobao' },
        ],
      },
    ]);

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
            title: 'Товар с неверным товаром источника',
            description: 'Описание',
            categoryId: 17028922,
            typeId: 93410,
            price: 129,
            currency: 'CNY',
            stock: 10,
            images: ['https://img.example.com/tb-red.jpg'],
            weight: 500,
            height: 100,
            depth: 100,
            width: 100,
            sourceTrace: {
              supplyGoodsId: 'supply-domestic',
              sourcePlatform: 'taobao',
              sourceProductId: 'wrong-product-id',
              sourceSkuId: 'tb-red',
            },
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '货源上架商品引用的货源商品与采集记录不一致',
      data: {
        invalidItems: [
          {
            offerId: 'sstaobao-998877-tb-red',
            supplyGoodsId: 'supply-domestic',
            sourceProductId: 'wrong-product-id',
            collectedSourceProductId: '998877',
            reason: 'source_product_mismatch',
          },
        ],
      },
    });
    expect(ozonRequestMock).not.toHaveBeenCalled();
    expect(syncJobMock.create).not.toHaveBeenCalled();
  });

  it('rejects supply listing submissions whose source SKU belongs to a different collected source platform variant', async () => {
    supplyGoodsMock.findMany.mockResolvedValueOnce([
      {
        id: 'supply-domestic',
        sourcePlatform: 'taobao',
        sourceProductId: '998877',
        sku: '998877',
        variants: [
          { sourceSkuId: 'shared-source-sku', sourcePlatform: '1688' },
        ],
      },
    ]);

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
            offerId: 'sstaobao-998877-shared-source-sku',
            title: 'Товар с неверной платформой SKU',
            description: 'Описание',
            categoryId: 17028922,
            typeId: 93410,
            price: 129,
            currency: 'CNY',
            stock: 10,
            images: ['https://img.example.com/shared-source-sku.jpg'],
            weight: 500,
            height: 100,
            depth: 100,
            width: 100,
            sourceTrace: {
              supplyGoodsId: 'supply-domestic',
              sourcePlatform: 'taobao',
              sourceProductId: '998877',
              sourceSkuId: 'shared-source-sku',
            },
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '货源上架商品引用的货源 SKU 不属于采集记录',
      data: {
        invalidItems: [
          {
            offerId: 'sstaobao-998877-shared-source-sku',
            supplyGoodsId: 'supply-domestic',
            sourcePlatform: 'taobao',
            sourceSkuId: 'shared-source-sku',
            reason: 'source_sku_platform_mismatch',
          },
        ],
      },
    });
    expect(ozonRequestMock).not.toHaveBeenCalled();
    expect(syncJobMock.create).not.toHaveBeenCalled();
  });
});

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateMock = vi.hoisted(() => vi.fn(async (request: any) => {
  request.user = { userId: 'user-1', role: 'USER' };
}));

const supplyGoodsMock = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));

const resolveCollectedPriceMock = vi.hoisted(() => vi.fn());

vi.mock('../lib/auth.js', () => ({
  authenticate: authenticateMock,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    supplyGoods: supplyGoodsMock,
  },
}));

vi.mock('../services/collect-pricing.js', () => ({
  resolveCollectedPrice: resolveCollectedPriceMock,
}));

import { collectRoutes } from '../routes/collect.js';

describe('1688 collect route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resolveCollectedPriceMock.mockResolvedValue({
      purchasePriceCny: 21.9,
      originalPrice: 21.9,
      originalCurrency: 'CNY',
      exchangeRateUsed: 1,
      needsReview: false,
    });
    supplyGoodsMock.findMany.mockResolvedValue([]);
    supplyGoodsMock.create.mockResolvedValue({ id: 'new-record' });
    supplyGoodsMock.update.mockResolvedValue({ id: 'existing-record' });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('updates an existing source product collect record without resetting listing preparation metadata', async () => {
    supplyGoodsMock.findFirst.mockResolvedValue({
      id: 'existing-record',
      status: 'listing_failed',
      metadata: {
        sourceKind: 'alibaba1688',
        preparedTitleRu: 'Старое название',
        targetPriceCny: '199',
        ozonCategoryId: 17031663,
        ozonTypeId: 971234,
        listingNotes: '人工确认过的上架草稿',
        listingPreparationStatus: 'ready',
        categoryMappingStatus: 'manual_ready',
        lastListingResultStatus: 'partial_failed',
        lastListingResultItems: [
          { offerId: 'sstaobao-998877-tb-red', sourceSkuId: 'tb-red', status: 'failed' },
        ],
      },
    });

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688',
      payload: {
        title: '淘宝更新货源商品',
        sourcePlatform: 'taobao',
        sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
        priceText: '¥21.90',
        images: ['https://img.example.com/new-main.jpg'],
        attributes: { 材质: '棉' },
        skuItems: [
          { sourceSkuId: 'tb-red', specText: '红色', price: '21.9', stock: 50, ozonSku: 'ozon-red' },
        ],
        description: '更新后的货源详情',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).data.id).toBe('existing-record');
    expect(supplyGoodsMock.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        sourcePlatform: 'taobao',
        sourceProductId: '998877',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(supplyGoodsMock.create).not.toHaveBeenCalled();
    expect(supplyGoodsMock.update).toHaveBeenCalledWith({
      where: { id: 'existing-record' },
      data: expect.objectContaining({
        title: '淘宝更新货源商品',
        sourcePlatform: 'taobao',
        sourceProductId: '998877',
        sku: null,
        status: 'listing_failed',
        metadata: expect.objectContaining({
          sourceKind: 'domestic_supply',
          description: '更新后的货源详情',
          attributes: { 材质: '棉' },
          priceText: '¥21.90',
          preparedTitleRu: 'Старое название',
          targetPriceCny: '199',
          ozonCategoryId: 17031663,
          ozonTypeId: 971234,
          listingNotes: '人工确认过的上架草稿',
          listingPreparationStatus: 'ready',
          categoryMappingStatus: 'manual_ready',
          lastListingResultStatus: 'partial_failed',
          lastListingResultItems: [
            { offerId: 'sstaobao-998877-tb-red', sourceSkuId: 'tb-red', status: 'failed' },
          ],
        }),
      }),
    });
  });

  it('creates domestic supply collect records without copying the source product id into sku', async () => {
    supplyGoodsMock.findFirst.mockResolvedValue(null);

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688',
      payload: {
        title: '1688 新货源商品',
        sourceUrl: 'https://detail.1688.com/offer/734567890123.html',
        priceText: '¥25.80',
        images: ['https://img.example.com/main.jpg'],
        skuItems: [
          { sourceSkuId: 'sku-red-42', specText: '红色 / 42', price: '25.8' },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(supplyGoodsMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourcePlatform: '1688',
        sourceProductId: '734567890123',
        sku: null,
        variants: [
          expect.objectContaining({
            sourceSkuId: 'sku-red-42',
            sourcePlatform: '1688',
          }),
        ],
      }),
    });
  });

  it('accepts explicit sourceProductId for domestic supply records without using sku as product id', async () => {
    supplyGoodsMock.findFirst.mockResolvedValue(null);

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688',
      payload: {
        title: '淘宝显式货源商品 ID',
        sourcePlatform: 'taobao',
        sourceProductId: 'tb-product-998877',
        sku: 'tb-display-row-should-not-be-product',
        priceText: '¥19.90',
        images: ['https://img.example.com/main.jpg'],
        attributes: { 材质: '棉' },
        skuItems: [
          { sourceSkuId: 'tb-sku-red', specText: '红色', price: '19.9' },
        ],
        description: '淘宝货源详情',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(supplyGoodsMock.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        sourcePlatform: 'taobao',
        sourceProductId: 'tb-product-998877',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(supplyGoodsMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourcePlatform: 'taobao',
        sourceProductId: 'tb-product-998877',
        sku: null,
        variants: [
          expect.objectContaining({
            sourceSkuId: 'tb-sku-red',
            sourcePlatform: 'taobao',
          }),
        ],
        metadata: expect.objectContaining({
          offerId: 'tb-product-998877',
        }),
      }),
    });
  });

  it('marks collected supply records with SKU rows missing source SKU ids as source-incomplete', async () => {
    supplyGoodsMock.findFirst.mockResolvedValue(null);

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688',
      payload: {
        title: '淘宝无货源 SKU ID 商品',
        sourcePlatform: 'taobao',
        sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
        priceText: '¥19.90',
        images: ['https://img.example.com/main.jpg'],
        attributes: { 材质: '棉' },
        skuItems: [
          { specText: '红色', price: '19.9' },
        ],
        description: '货源详情',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(supplyGoodsMock.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        sourcePlatform: 'taobao',
        sourceProductId: '998877',
        variants: [
          expect.objectContaining({
            sku: 'taobao-1',
            sourceSkuId: '',
            sourcePlatform: 'taobao',
          }),
        ],
        metadata: expect.objectContaining({
          sourceDataIssues: ['missing_source_sku_ids'],
          listingPreparationStatus: 'collected_only',
        }),
      }),
    });
  });

  it('rejects domestic supply payloads sent to the generic Ozon collect endpoint', async () => {
    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect',
      payload: {
        title: '误入普通采集入口的淘宝货源',
        sourcePlatform: 'taobao',
        sourceProductId: '998877',
        sku: 'tb-source-red',
        sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '货源平台商品请使用货源采集入口',
    });
    expect(resolveCollectedPriceMock).not.toHaveBeenCalled();
    expect(supplyGoodsMock.create).not.toHaveBeenCalled();
  });

  it('rejects domestic supply payloads sent to the generic Ozon batch collect endpoint', async () => {
    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/batch',
      payload: {
        items: [
          {
            title: '误入批量采集入口的 1688 货源',
            sourcePlatform: '1688',
            sourceProductId: '734567890123',
            sku: 'sku-red-42',
            sourceUrl: 'https://detail.1688.com/offer/734567890123.html',
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '货源平台商品请使用货源采集入口',
    });
    expect(resolveCollectedPriceMock).not.toHaveBeenCalled();
    expect(supplyGoodsMock.create).not.toHaveBeenCalled();
  });

  it('rejects editing generic collect records into domestic supply source URLs', async () => {
    supplyGoodsMock.findFirst.mockResolvedValue({
      id: 'ozon-record',
      userId: 'user-1',
      title: 'Ozon 采集记录',
      sourcePlatform: 'ozon',
      sourceUrl: 'https://www.ozon.ru/product/test-123456789/',
      metadata: { sourceKind: 'ozon' },
    });

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/collect/ozon-record',
      payload: {
        sourceUrl: 'https://detail.1688.com/offer/734567890123.html',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '货源平台商品请使用货源采集入口',
    });
    expect(supplyGoodsMock.update).not.toHaveBeenCalled();
  });

  it('ignores generic sku and source url edits for existing domestic supply records', async () => {
    supplyGoodsMock.findFirst.mockResolvedValue({
      id: 'supply-record',
      userId: 'user-1',
      title: '淘宝货源记录',
      sourcePlatform: 'taobao',
      sourceProductId: '998877',
      sku: null,
      sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
      metadata: { sourceKind: 'domestic_supply' },
    });

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'PUT',
      url: '/api/collect/supply-record',
      payload: {
        title: '更新后的淘宝货源记录',
        sku: 'ozon-or-display-sku-should-not-save',
        sourceUrl: 'https://item.taobao.com/item.htm?id=changed',
        purchasePrice: '29.90',
        notes: '只允许保存普通备注',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    const updateData = supplyGoodsMock.update.mock.calls[0]?.[0]?.data;
    expect(updateData).toMatchObject({
      title: '更新后的淘宝货源记录',
      purchasePrice: 29.9,
      notes: '只允许保存普通备注',
    });
    expect(updateData).not.toHaveProperty('sku');
    expect(updateData).not.toHaveProperty('sourceUrl');
  });

  it('preserves existing complete source data when a duplicate recollect payload is incomplete', async () => {
    resolveCollectedPriceMock.mockResolvedValueOnce({
      purchasePriceCny: null,
      originalPrice: null,
      originalCurrency: null,
      exchangeRateUsed: null,
      needsReview: true,
    });
    supplyGoodsMock.findFirst.mockResolvedValue({
      id: 'existing-complete-record',
      status: 'collected',
      images: ['https://img.example.com/old-main.jpg'],
      variants: [
        { sku: 'tb-red', sourceSkuId: 'tb-red', sourcePlatform: 'taobao', price: '19.9' },
      ],
      purchasePrice: { toString: () => '19.90' },
      metadata: {
        sourceKind: 'alibaba1688',
        description: '旧的完整货源详情',
        priceText: '¥19.90',
        categoryPath: '女装 > 连衣裙',
        supplierName: '杭州旧供应商',
        supplierLocation: '浙江 杭州',
        supplierYears: 5,
        monthlySales: 300,
        grossWeightGrams: 420,
        lengthMm: 300,
        widthMm: 220,
        heightMm: 80,
        dimensionsText: '30x22x8cm',
        minOrderQty: 2,
        logisticsText: '浙江发货',
        shippingInfo: { text: '浙江发货' },
        customizationInfo: { supported: true },
        attributes: { 材质: '棉' },
        sourceDataIssues: [],
        skuCount: 1,
      },
    });
    supplyGoodsMock.update.mockResolvedValue({ id: 'existing-complete-record' });

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688',
      payload: {
        title: '淘宝偶发缺字段货源商品',
        sourcePlatform: 'taobao',
        sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    const updateData = supplyGoodsMock.update.mock.calls[0]?.[0]?.data;
    expect(updateData).toBeTruthy();
    expect(Object.prototype.hasOwnProperty.call(updateData, 'images')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(updateData, 'variants')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(updateData, 'purchasePrice')).toBe(false);
    expect(updateData.metadata).toMatchObject({
      description: '旧的完整货源详情',
      priceText: '¥19.90',
      categoryPath: '女装 > 连衣裙',
      supplierName: '杭州旧供应商',
      supplierLocation: '浙江 杭州',
      supplierYears: 5,
      monthlySales: 300,
      grossWeightGrams: 420,
      lengthMm: 300,
      widthMm: 220,
      heightMm: 80,
      dimensionsText: '30x22x8cm',
      minOrderQty: 2,
      logisticsText: '浙江发货',
      shippingInfo: { text: '浙江发货' },
      customizationInfo: { supported: true },
      attributes: { 材质: '棉' },
      skuCount: 1,
      sourceDataIssues: [],
    });
  });

  it('preserves existing Ozon SKU trace when duplicate recollect variants omit price-check context', async () => {
    supplyGoodsMock.findFirst.mockResolvedValue({
      id: 'existing-price-check-record',
      status: 'collected',
      images: ['https://img.example.com/main.jpg'],
      variants: [
        {
          sku: 'tb-red',
          sourceSkuId: 'tb-red',
          sourcePlatform: 'taobao',
          ozonSku: 'ozon-red-old',
          ozonProductId: 'ozon-product-old',
          ozonOfferId: 'ozon-offer-old',
          price: '19.9',
        },
      ],
      purchasePrice: { toString: () => '19.90' },
      metadata: {
        sourceKind: 'alibaba1688',
        ozonPriceCheckContext: {
          sku: 'ozon-red-old',
          ozonSku: 'ozon-red-old',
          productId: 'ozon-product-old',
          offerId: 'ozon-offer-old',
        },
      },
    });
    supplyGoodsMock.update.mockResolvedValue({ id: 'existing-price-check-record' });

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688',
      payload: {
        title: '淘宝重新采集保留 Ozon 追踪',
        sourcePlatform: 'taobao',
        sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
        priceText: '¥21.90',
        skuItems: [
          { sourceSkuId: 'tb-red', specText: '红色', price: '21.9', stock: 60 },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    const updateData = supplyGoodsMock.update.mock.calls[0]?.[0]?.data;
    expect(updateData.variants).toEqual([
      expect.objectContaining({
        sourceSkuId: 'tb-red',
        sourcePlatform: 'taobao',
        ozonSku: 'ozon-red-old',
        ozonProductId: 'ozon-product-old',
        ozonOfferId: 'ozon-offer-old',
      }),
    ]);
    expect(updateData.metadata).toMatchObject({
      ozonPriceCheckContext: {
        sku: 'ozon-red-old',
        ozonSku: 'ozon-red-old',
        productId: 'ozon-product-old',
        offerId: 'ozon-offer-old',
      },
    });
  });

  it('preserves Ozon SKU trace for legacy variants that lack source platform', async () => {
    supplyGoodsMock.findFirst.mockResolvedValue({
      id: 'legacy-variant-record',
      status: 'collected',
      images: ['https://img.example.com/main.jpg'],
      variants: [
        {
          sku: 'legacy-red',
          sourceSkuId: 'legacy-red',
          ozonSku: 'ozon-legacy-red',
          ozonProductId: 'ozon-product-legacy',
          ozonOfferId: 'ozon-offer-legacy',
        },
      ],
      purchasePrice: { toString: () => '19.90' },
      metadata: { sourceKind: 'alibaba1688' },
    });
    supplyGoodsMock.update.mockResolvedValue({ id: 'legacy-variant-record' });

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688',
      payload: {
        title: '旧变体平台补齐',
        sourcePlatform: 'taobao',
        sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
        priceText: '¥22.90',
        skuItems: [
          { sourceSkuId: 'legacy-red', specText: '红色', price: '22.9' },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    const updateData = supplyGoodsMock.update.mock.calls[0]?.[0]?.data;
    expect(updateData.variants).toEqual([
      expect.objectContaining({
        sourceSkuId: 'legacy-red',
        sourcePlatform: 'taobao',
        ozonSku: 'ozon-legacy-red',
        ozonProductId: 'ozon-product-legacy',
        ozonOfferId: 'ozon-offer-legacy',
      }),
    ]);
  });

  it('does not inherit Ozon trace from legacy variants that only have generic sku', async () => {
    supplyGoodsMock.findFirst.mockResolvedValue({
      id: 'legacy-generic-sku-record',
      status: 'collected',
      images: ['https://img.example.com/main.jpg'],
      variants: [
        {
          sku: 'legacy-red',
          ozonSku: 'ozon-legacy-red',
          ozonProductId: 'ozon-product-legacy',
          ozonOfferId: 'ozon-offer-legacy',
        },
      ],
      purchasePrice: { toString: () => '19.90' },
      metadata: { sourceKind: 'alibaba1688' },
    });
    supplyGoodsMock.update.mockResolvedValue({ id: 'legacy-generic-sku-record' });

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688',
      payload: {
        title: '旧通用 SKU 重采集',
        sourcePlatform: 'taobao',
        sourceUrl: 'https://item.taobao.com/item.htm?id=998877',
        priceText: '¥22.90',
        skuItems: [
          { sourceSkuId: 'legacy-red', specText: '红色', price: '22.9' },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    const updateData = supplyGoodsMock.update.mock.calls[0]?.[0]?.data;
    expect(updateData.variants).toEqual([
      expect.objectContaining({
        sourceSkuId: 'legacy-red',
        sourcePlatform: 'taobao',
      }),
    ]);
    expect(updateData.variants[0]).not.toHaveProperty('ozonSku');
    expect(updateData.variants[0]).not.toHaveProperty('ozonProductId');
    expect(updateData.variants[0]).not.toHaveProperty('ozonOfferId');
  });

  it('reports invalid records when prefill payloads include Ozon collect records', async () => {
    supplyGoodsMock.findMany.mockResolvedValueOnce([
      {
        id: 'supply-record',
        userId: 'user-1',
        title: '淘宝货源',
        sourcePlatform: 'taobao',
        metadata: { sourceKind: 'alibaba1688' },
        images: [],
        variants: [],
        createdAt: new Date('2026-06-07T12:00:00.000Z'),
      },
      {
        id: 'ozon-record',
        userId: 'user-1',
        title: 'Ozon 采集记录',
        sourcePlatform: 'ozon',
        metadata: { sourceKind: 'ozon' },
        images: [],
        variants: [],
        createdAt: new Date('2026-06-07T12:00:00.000Z'),
      },
    ]);

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688/prefill',
      payload: {
        ids: ['supply-record', 'ozon-record'],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '只能选择货源采集记录进入货源上架准备',
      data: {
        invalid: [
          {
            id: 'ozon-record',
            title: 'Ozon 采集记录',
            sourcePlatform: 'ozon',
          },
        ],
      },
    });
  });

  it('rejects saving preparation for supply records that already have active listing results', async () => {
    supplyGoodsMock.findMany.mockResolvedValue([
      {
        id: 'submitted-record',
        userId: 'user-1',
        title: '已提交的淘宝货源',
        sourcePlatform: 'taobao',
        sourceProductId: '998877',
        images: ['https://img.example.com/main.jpg'],
        variants: [
          {
            sku: 'tb-red',
            sourceSkuId: 'tb-red',
            sourcePlatform: 'taobao',
            ozonSku: 'ozon-red',
            price: '21.9',
          },
        ],
        purchasePrice: { toString: () => '21.90' },
        metadata: {
          sourceKind: 'alibaba1688',
          lastListingResultStatus: 'submitted',
          listingPreparationStatus: 'ready',
        },
        createdAt: new Date('2026-06-07T12:00:00.000Z'),
      },
    ]);

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688/save-preparation',
      payload: {
        items: [
          {
            id: 'submitted-record',
            preparedTitleRu: 'Уже отправленный товар',
            targetPriceCny: '129',
            ozonCategoryId: 17028922,
            ozonTypeId: 93410,
            variants: [
              {
                sourceSkuId: 'tb-red',
                sourcePlatform: 'taobao',
                ozonSku: 'ozon-red',
                specText: '红色',
                price: '21.9',
              },
            ],
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '已提交、导入中或已上架成功的货源采集记录不能重新保存上架准备',
      data: {
        blocked: [
          {
            id: 'submitted-record',
            title: '已提交的淘宝货源',
            issue: 'listing_already_submitted',
          },
        ],
      },
    });
    expect(supplyGoodsMock.update).not.toHaveBeenCalled();
  });

  it('keeps saved preparation as draft when variants lack source SKU traces', async () => {
    supplyGoodsMock.findMany.mockResolvedValue([
      {
        id: 'source-missing-sku',
        userId: 'user-1',
        title: '淘宝货源',
        sourcePlatform: 'taobao',
        sourceProductId: '998877',
        images: ['https://img.example.com/main.jpg'],
        variants: [
          {
            sku: 'taobao-1',
            sourceSkuId: '',
            sourcePlatform: 'taobao',
            specText: '红色',
            price: '21.9',
          },
        ],
        purchasePrice: { toString: () => '21.90' },
        metadata: {
          sourceKind: 'domestic_supply',
          listingPreparationStatus: 'collected_only',
          categoryMappingStatus: 'deferred_until_listing',
        },
        createdAt: new Date('2026-06-07T12:00:00.000Z'),
      },
    ]);

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688/save-preparation',
      payload: {
        items: [
          {
            id: 'source-missing-sku',
            preparedTitleRu: 'Товар Taobao',
            targetPriceCny: '129',
            ozonCategoryId: 17028922,
            ozonTypeId: 93410,
            images: ['https://img.example.com/main.jpg'],
            purchasePrice: '21.90',
            description: 'Описание товара',
            attributes: { Материал: 'текстиль' },
            variants: [
              {
                specText: '红色',
                price: '21.9',
                sourcePlatform: 'taobao',
                ozonSku: 'ozon-red',
              },
            ],
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 1,
      data: {
        saved: 1,
        ready: 0,
        draft: 1,
        items: [
          {
            id: 'source-missing-sku',
            listingPreparationStatus: 'draft',
            listingPreparationIssues: ['missing_source_sku_ids'],
          },
        ],
      },
    });
    expect(supplyGoodsMock.update).toHaveBeenCalledWith({
      where: { id: 'source-missing-sku' },
      data: expect.objectContaining({
        variants: [
          expect.objectContaining({
            sku: 'taobao-1',
            sourceSkuId: '',
            sourcePlatform: 'taobao',
          }),
        ],
        metadata: expect.objectContaining({
          listingPreparationStatus: 'draft',
          listingPreparationIssues: ['missing_source_sku_ids'],
          sourceDataIssues: ['missing_source_sku_ids'],
        }),
      }),
    });
  });

  it('reports invalid records when saving preparation payloads include Ozon collect records', async () => {
    supplyGoodsMock.findMany.mockResolvedValue([
      {
        id: 'supply-record',
        userId: 'user-1',
        title: '淘宝货源',
        sourcePlatform: 'taobao',
        metadata: { sourceKind: 'alibaba1688' },
      },
      {
        id: 'ozon-record',
        userId: 'user-1',
        title: 'Ozon 采集记录',
        sourcePlatform: 'ozon',
        metadata: { sourceKind: 'ozon' },
      },
    ]);

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688/save-preparation',
      payload: {
        items: [
          {
            id: 'supply-record',
            preparedTitleRu: 'Товар Taobao',
            targetPriceCny: '129',
            ozonCategoryId: 17028922,
            ozonTypeId: 93410,
          },
          {
            id: 'ozon-record',
            preparedTitleRu: 'Товар Ozon',
            targetPriceCny: '199',
            ozonCategoryId: 17028922,
            ozonTypeId: 93410,
          },
        ],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '只能保存货源采集记录的上架准备草稿',
      data: {
        invalid: [
          {
            id: 'ozon-record',
            title: 'Ozon 采集记录',
            sourcePlatform: 'ozon',
          },
        ],
      },
    });
    expect(supplyGoodsMock.update).not.toHaveBeenCalled();
  });

  it('rejects listing draft generation when selected records include Ozon collect records', async () => {
    supplyGoodsMock.findMany.mockResolvedValueOnce([
      {
        id: 'supply-ready',
        userId: 'user-1',
        title: '淘宝货源',
        sourcePlatform: 'taobao',
        sourceProductId: '998877',
        images: ['https://img.example.com/supply-main.jpg'],
        variants: [
          {
            sku: 'tb-red',
            sourceSkuId: 'tb-red',
            sourcePlatform: 'taobao',
            attrs: { color: 'red' },
            stock: 10,
          },
        ],
        purchasePrice: { toString: () => '21.90' },
        currency: 'CNY',
        metadata: {
          sourceKind: 'alibaba1688',
          preparedTitleRu: 'Товар Taobao',
          targetPriceCny: '129',
          ozonCategoryId: 17028922,
          ozonTypeId: 93410,
          description: 'Описание товара',
          attributes: { Материал: 'текстиль' },
          listingPreparationStatus: 'ready',
        },
        createdAt: new Date('2026-06-07T12:00:00.000Z'),
      },
      {
        id: 'ozon-record',
        userId: 'user-1',
        title: 'Ozon 采集记录',
        sourcePlatform: 'ozon',
        sourceProductId: '123456789',
        images: ['https://img.example.com/ozon-main.jpg'],
        variants: [
          {
            sku: 'ozon-red',
            sourceSkuId: 'ozon-red',
            sourcePlatform: 'ozon',
            attrs: { color: 'red' },
            stock: 10,
          },
        ],
        purchasePrice: { toString: () => '1990' },
        currency: 'RUB',
        metadata: {
          sourceKind: 'ozon',
          preparedTitleRu: 'Товар Ozon',
          targetPriceCny: '199',
          ozonCategoryId: 17028922,
          ozonTypeId: 93410,
          description: 'Описание товара',
          attributes: { Материал: 'текстиль' },
          listingPreparationStatus: 'ready',
        },
        createdAt: new Date('2026-06-07T12:00:00.000Z'),
      },
    ]);

    const app = Fastify();
    await app.register(collectRoutes, { prefix: '/api/collect' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/1688/listing-drafts',
      payload: {
        ids: ['supply-ready', 'ozon-record'],
      },
    });

    await app.close();

    expect(response.statusCode).toBe(400);
    expect(JSON.parse(response.body)).toMatchObject({
      code: 0,
      msg: '只能选择货源采集记录生成货源 Ozon 上架草稿',
      data: {
        invalid: [
          {
            id: 'ozon-record',
            title: 'Ozon 采集记录',
            sourcePlatform: 'ozon',
          },
        ],
      },
    });
  });
});

import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authenticateMock = vi.hoisted(() => vi.fn(async (request: any) => {
  request.user = { userId: 'user-1', role: 'USER' };
}));

const supplyGoodsMock = vi.hoisted(() => ({
  findFirst: vi.fn(),
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
        status: 'listing_failed',
        metadata: expect.objectContaining({
          sourceKind: 'alibaba1688',
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
});

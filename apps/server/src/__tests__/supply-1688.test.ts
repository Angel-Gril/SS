import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../lib/auth.js';
import { supplyRoutes } from '../routes/supply.js';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  supplyGoods: {
    count: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  categoryMapping: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

const redisMock = vi.hoisted(() => ({
  exists: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../lib/redis.js', () => ({ redis: redisMock }));

async function buildSupplyApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(supplyRoutes, { prefix: '/api/supply' });
  await app.ready();
  return app;
}

function authHeader() {
  return {
    authorization: `Bearer ${signToken({ userId: 'user-1', role: 'USER' })}`,
  };
}

const mapping = {
  id: 'mapping-1',
  userId: 'user-1',
  sourcePlatform: '1688',
  sourceCategoryId: null,
  sourceCategoryName: '手机壳',
  sourceCategoryPath: null,
  targetPlatform: 'ozon',
  targetCategoryId: 17028711,
  targetTypeId: 95841,
  targetCategoryName: 'Чехлы',
  targetCategoryPath: null,
  defaultWeightG: 300,
  defaultLengthMm: 200,
  defaultWidthMm: 120,
  defaultHeightMm: 30,
  notes: null,
  createdAt: new Date('2026-06-08T00:00:00.000Z'),
  updatedAt: new Date('2026-06-08T00:00:00.000Z'),
};

beforeEach(() => {
  vi.clearAllMocks();
  redisMock.exists.mockResolvedValue(1);
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'user-1',
    parentId: null,
    accountCode: '101',
    status: 'ACTIVE',
    isSuperAdmin: false,
    role: 'USER',
  });
  prismaMock.supplyGoods.findFirst.mockResolvedValue(null);
  prismaMock.categoryMapping.findMany.mockResolvedValue([mapping]);
});

describe('1688 supply pricing and import routes', () => {
  it('previews 1688 pricing and matching category mapping without saving', async () => {
    const app = await buildSupplyApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/supply/1688/preview',
      headers: authHeader(),
      payload: {
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        title: '透明手机壳',
        sourceCategoryName: '手机壳',
        purchasePriceCny: 20,
        domesticShippingCny: 5,
        weightG: 500,
        packageFeeCny: 2,
        commissionPct: 12,
        logisticsFeeCny: 18,
        exchangeRateRubToCny: 0.08,
        targetMarginPct: 30,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        sourceProductId: '123456789',
        pricing: {
          ok: true,
          suggestedSalePriceCny: 73,
          suggestedSalePriceRub: 913,
        },
        mapping: {
          id: 'mapping-1',
          targetCategoryId: 17028711,
          targetTypeId: 95841,
        },
      },
    });
    expect(prismaMock.supplyGoods.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('previews when a 1688 item will update an existing supply good', async () => {
    const app = await buildSupplyApp();
    prismaMock.supplyGoods.findFirst.mockResolvedValue({
      id: 'goods-existing',
      userId: 'user-1',
      title: '透明手机壳旧版',
      sourcePlatform: '1688',
      sourceProductId: '123456789',
      updatedAt: new Date('2026-06-09T00:00:00.000Z'),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/supply/1688/preview',
      headers: authHeader(),
      payload: {
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        title: '透明手机壳新版',
        sourceCategoryName: '手机壳',
        purchasePriceCny: 22,
        domesticShippingCny: 5,
        weightG: 500,
        packageFeeCny: 2,
        commissionPct: 12,
        logisticsFeeCny: 18,
        exchangeRateRubToCny: 0.08,
        targetMarginPct: 30,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        sourceProductId: '123456789',
        saveMode: 'update',
        existingSupplyGood: {
          id: 'goods-existing',
          title: '透明手机壳旧版',
          sourceProductId: '123456789',
        },
      },
    });
    expect(prismaMock.supplyGoods.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        sourcePlatform: '1688',
        sourceProductId: '123456789',
      },
    });
    expect(prismaMock.supplyGoods.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('imports a 1688 item into supply goods with pricing and mapping metadata', async () => {
    const app = await buildSupplyApp();
    prismaMock.supplyGoods.create.mockResolvedValue({
      id: 'goods-1',
      userId: 'user-1',
      title: '透明手机壳',
      sourceUrl: 'https://detail.1688.com/offer/123456789.html',
      sourcePlatform: '1688',
      sourceProductId: '123456789',
      supplier: '义乌供应商',
      purchasePrice: { toString: () => '20' },
      currency: 'CNY',
      sku: 'SKU-1688-1',
      metadata: {},
      status: 'active',
      createdAt: new Date('2026-06-08T00:00:00.000Z'),
      updatedAt: new Date('2026-06-08T00:00:00.000Z'),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/supply/1688/import',
      headers: authHeader(),
      payload: {
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        title: '透明手机壳',
        sourceCategoryName: '手机壳',
        supplier: '义乌供应商',
        sku: 'SKU-1688-1',
        purchasePriceCny: 20,
        domesticShippingCny: 5,
        weightG: 500,
        packageFeeCny: 2,
        commissionPct: 12,
        logisticsFeeCny: 18,
        exchangeRateRubToCny: 0.08,
        targetMarginPct: 30,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, data: { id: 'goods-1' } });
    expect(prismaMock.supplyGoods.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        user: { connect: { id: 'user-1' } },
        title: '透明手机壳',
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        sourcePlatform: '1688',
        sourceProductId: '123456789',
        supplier: '义乌供应商',
        purchasePrice: 20,
        currency: 'CNY',
        sku: 'SKU-1688-1',
        metadata: expect.objectContaining({
          sourceCategoryName: '手机壳',
          mappedCategory: expect.objectContaining({
            mappingId: 'mapping-1',
            targetCategoryId: 17028711,
            targetTypeId: 95841,
          }),
          pricing: expect.objectContaining({
            suggestedSalePriceCny: 73,
            suggestedSalePriceRub: 913,
          }),
        }),
      }),
    });
    await app.close();
  });

  it('persists Ozon source context when a 1688 item comes from extension image search', async () => {
    const app = await buildSupplyApp();
    prismaMock.supplyGoods.create.mockResolvedValue({
      id: 'goods-ozon-source',
      userId: 'user-1',
      title: '透明手机壳',
      sourceUrl: 'https://detail.1688.com/offer/123456789.html',
      sourcePlatform: '1688',
      sourceProductId: '123456789',
      supplier: '义乌供应商',
      purchasePrice: { toString: () => '20' },
      currency: 'CNY',
      sku: 'SKU-1688-1',
      metadata: {},
      status: 'active',
      createdAt: new Date('2026-06-08T00:00:00.000Z'),
      updatedAt: new Date('2026-06-08T00:00:00.000Z'),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/supply/1688/import',
      headers: authHeader(),
      payload: {
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        title: '透明手机壳',
        sourceCategoryName: '手机壳',
        supplier: '义乌供应商',
        sku: 'SKU-1688-1',
        images: ['https://cbu01.alicdn.com/img/offer.jpg'],
        purchasePriceCny: 20,
        domesticShippingCny: 5,
        weightG: 500,
        packageFeeCny: 2,
        commissionPct: 12,
        logisticsFeeCny: 18,
        exchangeRateRubToCny: 0.08,
        targetMarginPct: 30,
        metadata: {
          sourceOzonProductId: '987654321',
          ozonSourceContext: {
            productId: '987654321',
            title: 'Ozon 透明手机壳',
            sourceUrl: 'https://www.ozon.ru/product/case-987654321/',
            imageUrl: 'https://cdn.ozon.ru/main.jpg',
            images: ['https://cdn.ozon.ru/main.jpg'],
            categoryName: '手机壳',
            brand: 'Brand X',
            weightG: 480,
            lengthMm: 200,
            widthMm: 120,
            heightMm: 30,
            savedAt: '2026-06-09T08:00:00.000Z',
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.supplyGoods.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          sourceOzonProductId: '987654321',
          ozonSourceContext: expect.objectContaining({
            productId: '987654321',
            title: 'Ozon 透明手机壳',
            imageUrl: 'https://cdn.ozon.ru/main.jpg',
            categoryName: '手机壳',
          }),
          pricingInput: expect.objectContaining({
            metadata: expect.any(Object),
          }),
        }),
      }),
    });
    await app.close();
  });

  it('persists per-sku pricing metadata for 1688 variants', async () => {
    const app = await buildSupplyApp();
    prismaMock.supplyGoods.create.mockResolvedValue({
      id: 'goods-sku-pricing',
      userId: 'user-1',
      title: '多规格手机壳',
      sourceUrl: 'https://detail.1688.com/offer/123456789.html',
      sourcePlatform: '1688',
      sourceProductId: '123456789',
      supplier: '义乌供应商',
      purchasePrice: { toString: () => '20' },
      currency: 'CNY',
      sku: '123456789',
      metadata: {},
      status: 'active',
      createdAt: new Date('2026-06-08T00:00:00.000Z'),
      updatedAt: new Date('2026-06-08T00:00:00.000Z'),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/supply/1688/import',
      headers: authHeader(),
      payload: {
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        title: '多规格手机壳',
        sourceCategoryName: '手机壳',
        purchasePriceCny: 20,
        domesticShippingCny: 5,
        weightG: 500,
        packageFeeCny: 2,
        commissionPct: 12,
        logisticsFeeCny: 18,
        exchangeRateRubToCny: 0.08,
        targetMarginPct: 30,
        skuItems: [
          { skuId: 'red', specText: '红色', price: 18, grossWeightGrams: 420 },
          { skuId: 'blue', specText: '蓝色', price: 25, grossWeightGrams: 650 },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.supplyGoods.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          pricing: expect.objectContaining({
            skuPricing: [
              expect.objectContaining({ skuId: 'red', suggestedSalePriceCny: 69 }),
              expect.objectContaining({ skuId: 'blue', suggestedSalePriceCny: 81 }),
            ],
            skuSummary: expect.objectContaining({
              count: 2,
              minSuggestedSalePriceCny: 69,
              maxSuggestedSalePriceCny: 81,
            }),
          }),
        }),
      }),
    });
    await app.close();
  });

  it('uses and persists per-sku logistics fees for 1688 variant pricing', async () => {
    const app = await buildSupplyApp();
    prismaMock.supplyGoods.create.mockResolvedValue({
      id: 'goods-sku-logistics',
      userId: 'user-1',
      title: '多重量手机壳',
      sourceUrl: 'https://detail.1688.com/offer/123456789.html',
      sourcePlatform: '1688',
      sourceProductId: '123456789',
      supplier: '义乌供应商',
      purchasePrice: { toString: () => '20' },
      currency: 'CNY',
      sku: '123456789',
      metadata: {},
      status: 'active',
      createdAt: new Date('2026-06-08T00:00:00.000Z'),
      updatedAt: new Date('2026-06-08T00:00:00.000Z'),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/supply/1688/import',
      headers: authHeader(),
      payload: {
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        title: '多重量手机壳',
        sourceCategoryName: '手机壳',
        purchasePriceCny: 20,
        domesticShippingCny: 5,
        weightG: 500,
        packageFeeCny: 2,
        commissionPct: 12,
        logisticsFeeCny: 18,
        exchangeRateRubToCny: 0.08,
        targetMarginPct: 30,
        skuItems: [
          { skuId: 'light', specText: '轻款', price: 18, grossWeightGrams: 300, logisticsFeeCny: 12 },
          { skuId: 'heavy', specText: '重款', price: 25, grossWeightGrams: 900, logisticsFeeCny: 30 },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.supplyGoods.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          sourceDetails: expect.objectContaining({
            skuItems: [
              expect.objectContaining({ skuId: 'light', logisticsFeeCny: 12 }),
              expect.objectContaining({ skuId: 'heavy', logisticsFeeCny: 30 }),
            ],
          }),
          pricingInput: expect.objectContaining({
            skuItems: [
              expect.objectContaining({ skuId: 'light', logisticsFeeCny: 12 }),
              expect.objectContaining({ skuId: 'heavy', logisticsFeeCny: 30 }),
            ],
          }),
          pricing: expect.objectContaining({
            skuPricing: [
              expect.objectContaining({
                skuId: 'light',
                logisticsFeeCny: 12,
                totalBaseCostCny: 37,
                suggestedSalePriceCny: 60,
              }),
              expect.objectContaining({
                skuId: 'heavy',
                logisticsFeeCny: 30,
                totalBaseCostCny: 62,
                suggestedSalePriceCny: 100,
              }),
            ],
            skuSummary: expect.objectContaining({
              count: 2,
              minSuggestedSalePriceCny: 60,
              maxSuggestedSalePriceCny: 100,
            }),
          }),
        }),
      }),
    });
    await app.close();
  });

  it('preserves rich 1688 detail fields for SKU mapping and export', async () => {
    const app = await buildSupplyApp();
    prismaMock.supplyGoods.create.mockResolvedValue({
      id: 'goods-rich-detail',
      userId: 'user-1',
      title: '富字段多规格手机壳',
      sourceUrl: 'https://detail.1688.com/offer/123456789.html',
      sourcePlatform: '1688',
      sourceProductId: '123456789',
      supplier: '义乌供应商',
      purchasePrice: { toString: () => '20' },
      currency: 'CNY',
      sku: '123456789',
      metadata: {},
      status: 'active',
      createdAt: new Date('2026-06-08T00:00:00.000Z'),
      updatedAt: new Date('2026-06-08T00:00:00.000Z'),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/supply/1688/import',
      headers: authHeader(),
      payload: {
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        title: '富字段多规格手机壳',
        sourceCategoryId: '1042954',
        sourceCategoryName: '手机壳',
        sourceCategoryPath: '数码配件 > 手机配件 > 手机壳',
        supplier: '义乌供应商',
        purchasePriceCny: 20,
        domesticShippingCny: 5,
        weightG: 500,
        lengthMm: 210,
        widthMm: 130,
        heightMm: 25,
        packageFeeCny: 2,
        commissionPct: 12,
        logisticsFeeCny: 18,
        exchangeRateRubToCny: 0.08,
        targetMarginPct: 30,
        attributes: [
          { name: '材质', value: 'TPU' },
          { name: '风格', value: '透明' },
        ],
        priceTiers: [
          { minQuantity: 2, price: 18.5 },
          { minQuantity: 100, price: 16.8 },
        ],
        detailImages: ['https://img.alicdn.com/detail-1.jpg'],
        skuItems: [
          {
            skuId: 'red-64',
            name: '红色 64G',
            specText: '颜色:红色 / 型号:64G',
            price: 18,
            stock: 120,
            imageUrl: 'https://img.alicdn.com/red.jpg',
            grossWeightGrams: 420,
            attributes: { 颜色: '红色', 型号: '64G' },
          },
        ],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.supplyGoods.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: expect.objectContaining({
          sourceCategoryId: '1042954',
          sourceCategoryPath: '数码配件 > 手机配件 > 手机壳',
          sourceDetails: expect.objectContaining({
            attributes: [
              { name: '材质', value: 'TPU' },
              { name: '风格', value: '透明' },
            ],
            priceTiers: [
              { minQuantity: 2, price: 18.5 },
              { minQuantity: 100, price: 16.8 },
            ],
            detailImages: ['https://img.alicdn.com/detail-1.jpg'],
            dimensions: { lengthMm: 210, widthMm: 130, heightMm: 25 },
            skuItems: [
              expect.objectContaining({
                skuId: 'red-64',
                stock: 120,
                imageUrl: 'https://img.alicdn.com/red.jpg',
                attributes: { 颜色: '红色', 型号: '64G' },
              }),
            ],
          }),
          pricingInput: expect.objectContaining({
            skuItems: [
              expect.objectContaining({
                stock: 120,
                imageUrl: 'https://img.alicdn.com/red.jpg',
                attributes: { 颜色: '红色', 型号: '64G' },
              }),
            ],
          }),
        }),
      }),
    });
    await app.close();
  });

  it('updates an existing 1688 supply item instead of creating duplicates for the same source product', async () => {
    const app = await buildSupplyApp();
    prismaMock.supplyGoods.findFirst.mockResolvedValue({
      id: 'goods-existing',
      userId: 'user-1',
      sourcePlatform: '1688',
      sourceProductId: '123456789',
    });
    prismaMock.supplyGoods.update.mockResolvedValue({
      id: 'goods-existing',
      userId: 'user-1',
      title: '透明手机壳新版',
      sourceUrl: 'https://detail.1688.com/offer/123456789.html',
      sourcePlatform: '1688',
      sourceProductId: '123456789',
      supplier: '义乌供应商',
      purchasePrice: { toString: () => '22' },
      currency: 'CNY',
      sku: 'SKU-1688-1',
      metadata: {},
      status: 'active',
      createdAt: new Date('2026-06-08T00:00:00.000Z'),
      updatedAt: new Date('2026-06-09T00:00:00.000Z'),
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/supply/1688/import',
      headers: authHeader(),
      payload: {
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        title: '透明手机壳新版',
        sourceCategoryName: '手机壳',
        supplier: '义乌供应商',
        sku: 'SKU-1688-1',
        purchasePriceCny: 22,
        domesticShippingCny: 5,
        weightG: 500,
        packageFeeCny: 2,
        commissionPct: 12,
        logisticsFeeCny: 18,
        exchangeRateRubToCny: 0.08,
        targetMarginPct: 30,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      msg: '1688货源已更新',
      data: { id: 'goods-existing' },
    });
    expect(prismaMock.supplyGoods.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        sourcePlatform: '1688',
        sourceProductId: '123456789',
      },
    });
    expect(prismaMock.supplyGoods.update).toHaveBeenCalledWith({
      where: { id: 'goods-existing' },
      data: expect.objectContaining({
        title: '透明手机壳新版',
        purchasePrice: 22,
        metadata: expect.objectContaining({
          pricing: expect.objectContaining({ ok: true }),
        }),
      }),
    });
    expect(prismaMock.supplyGoods.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('lists 1688 supply goods by updated time when requested', async () => {
    const app = await buildSupplyApp();
    prismaMock.supplyGoods.count.mockResolvedValue(2);
    prismaMock.supplyGoods.findMany.mockResolvedValue([
      {
        id: 'goods-newer-update',
        userId: 'user-1',
        title: '刚更新的 1688 货源',
        sourceUrl: 'https://detail.1688.com/offer/222.html',
        sourcePlatform: '1688',
        sourceProductId: '222',
        supplier: null,
        purchasePrice: { toString: () => '22' },
        currency: 'CNY',
        sku: '222',
        metadata: {},
        status: 'active',
        createdAt: new Date('2026-06-01T00:00:00.000Z'),
        updatedAt: new Date('2026-06-09T00:00:00.000Z'),
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/supply?sourcePlatform=1688&limit=8&sort=updatedAt',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        total: 2,
        rows: [
          {
            id: 'goods-newer-update',
            purchasePrice: '22',
            updatedAt: '2026-06-09T00:00:00.000Z',
          },
        ],
      },
    });
    expect(prismaMock.supplyGoods.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', sourcePlatform: '1688' },
      skip: 0,
      take: 8,
      orderBy: { updatedAt: 'desc' },
    });
    await app.close();
  });

  it('filters supply goods by exact id for extension post-import deep links', async () => {
    const app = await buildSupplyApp();
    prismaMock.supplyGoods.count.mockResolvedValue(1);
    prismaMock.supplyGoods.findMany.mockResolvedValue([
      {
        id: 'goods-target',
        userId: 'user-1',
        title: '刚保存的 1688 货源',
        sourceUrl: 'https://detail.1688.com/offer/333.html',
        sourcePlatform: '1688',
        sourceProductId: '333',
        supplier: null,
        purchasePrice: { toString: () => '33' },
        currency: 'CNY',
        sku: '333',
        metadata: {},
        status: 'active',
        createdAt: new Date('2026-06-10T00:00:00.000Z'),
        updatedAt: new Date('2026-06-10T00:00:00.000Z'),
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/supply?id=goods-target&limit=20',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        total: 1,
        rows: [
          {
            id: 'goods-target',
            purchasePrice: '33',
          },
        ],
      },
    });
    expect(prismaMock.supplyGoods.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: 'goods-target' },
    });
    expect(prismaMock.supplyGoods.findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', id: 'goods-target' },
      skip: 0,
      take: 20,
      orderBy: { createdAt: 'desc' },
    });
    await app.close();
  });

  it('rejects invalid 1688 pricing input', async () => {
    const app = await buildSupplyApp();

    const response = await app.inject({
      method: 'POST',
      url: '/api/supply/1688/preview',
      headers: authHeader(),
      payload: {
        title: '无效商品',
        purchasePriceCny: -1,
        exchangeRateRubToCny: 0,
        targetMarginPct: 30,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 0 });
    expect(prismaMock.supplyGoods.create).not.toHaveBeenCalled();
    await app.close();
  });
});

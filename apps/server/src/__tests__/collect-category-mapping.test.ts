import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../lib/auth.js';
import { collectRoutes } from '../routes/collect.js';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  shop: {
    findFirst: vi.fn(),
  },
  systemConfig: {
    findUnique: vi.fn(),
  },
  supplyGoods: {
    findMany: vi.fn(),
    update: vi.fn(),
  },
  syncJob: {
    create: vi.fn(),
  },
}));

const redisMock = vi.hoisted(() => ({
  exists: vi.fn(),
}));

const ozonClientMock = vi.hoisted(() => ({
  importBySku: vi.fn(),
  getImportInfo: vi.fn(),
  importProductPictures: vi.fn(),
  getProductInfoList: vi.fn(),
  getProductInfoAttributes: vi.fn(),
  getDescriptionCategoryAttributes: vi.fn(),
  getAttributeValues: vi.fn(),
  importProducts: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../lib/redis.js', () => ({ redis: redisMock }));
vi.mock('../lib/crypto.js', () => ({ decrypt: vi.fn((value: string) => value) }));
vi.mock('../services/ozon-client.js', () => ({ OzonClient: vi.fn(function OzonClient() { return ozonClientMock; }) }));

async function buildCollectApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(collectRoutes, { prefix: '/api/collect' });
  await app.ready();
  return app;
}

function authHeader() {
  return {
    authorization: `Bearer ${signToken({ userId: 'user-1', role: 'USER' })}`,
  };
}

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
  prismaMock.systemConfig.findUnique.mockResolvedValue(null);
});

describe('collect category mapping prefill', () => {
  it('uses 1688 mapped category metadata for Ozon clone prefill defaults', async () => {
    const app = await buildCollectApp();
    prismaMock.supplyGoods.findMany.mockResolvedValue([
      {
        id: 'goods-1',
        title: '透明手机壳',
        notes: null,
        sku: 'SKU-1688-1',
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        purchasePrice: { toString: () => '20' },
        currency: 'CNY',
        images: [],
        variants: [],
        modelId: null,
        metadata: {
          mappedCategory: {
            targetCategoryId: 17028711,
            targetTypeId: 95841,
            defaultWeightG: 300,
            defaultLengthMm: 200,
            defaultWidthMm: 120,
            defaultHeightMm: 30,
          },
        },
      },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/clone-prefill',
      headers: authHeader(),
      payload: { ids: ['goods-1'] },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: [
        {
          id: 'goods-1',
          categoryId: 17028711,
          typeId: 95841,
          weightG: 300,
          lengthMm: 200,
          widthMm: 120,
          heightMm: 30,
        },
      ],
    });
    await app.close();
  });

  it('keeps explicit customization before mapped category defaults', async () => {
    const app = await buildCollectApp();
    prismaMock.supplyGoods.findMany.mockResolvedValue([
      {
        id: 'goods-2',
        title: '手动类目商品',
        notes: null,
        sku: 'SKU-1688-2',
        sourceUrl: null,
        purchasePrice: null,
        currency: 'CNY',
        images: [],
        variants: [],
        modelId: null,
        metadata: {
          descriptionCategoryId: 999,
          typeId: 888,
          weightG: 777,
          lengthMm: 111,
          widthMm: 222,
          heightMm: 333,
          mappedCategory: {
            targetCategoryId: 17028711,
            targetTypeId: 95841,
            defaultWeightG: 300,
            defaultLengthMm: 200,
            defaultWidthMm: 120,
            defaultHeightMm: 30,
          },
        },
      },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/clone-prefill',
      headers: authHeader(),
      payload: { ids: ['goods-2'] },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: [
        {
          id: 'goods-2',
          categoryId: 999,
          typeId: 888,
          weightG: 777,
          lengthMm: 111,
          widthMm: 222,
          heightMm: 333,
        },
      ],
    });
    await app.close();
  });

  it('returns 1688 pricing and Ozon source metadata for listing prefill', async () => {
    const app = await buildCollectApp();
    prismaMock.supplyGoods.findMany.mockResolvedValue([
      {
        id: 'goods-1688-listing',
        title: '透明手机壳',
        notes: null,
        sku: '123456789',
        sourcePlatform: '1688',
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        purchasePrice: { toString: () => '20' },
        currency: 'CNY',
        images: [],
        variants: [],
        modelId: null,
        metadata: {
          sourceOzonProductId: '987654321',
          ozonSourceContext: {
            productId: '987654321',
            title: 'Ozon 透明手机壳',
            sourceUrl: 'https://www.ozon.ru/product/case-987654321/',
            categoryName: '手机壳',
          },
          pricing: {
            suggestedSalePriceCny: 73,
            suggestedSalePriceRub: 913,
            estimatedMarginPct: 30.1,
            skuPricing: [
              { skuId: 'red', specText: 'red', suggestedSalePriceCny: 69, suggestedSalePriceRub: 863 },
              { skuId: 'blue', specText: 'blue', suggestedSalePriceCny: 81, suggestedSalePriceRub: 1013 },
            ],
            skuSummary: {
              count: 2,
              minSuggestedSalePriceCny: 69,
              maxSuggestedSalePriceCny: 81,
              minSuggestedSalePriceRub: 863,
              maxSuggestedSalePriceRub: 1013,
            },
          },
          mappedCategory: {
            targetCategoryId: 17028711,
            targetTypeId: 95841,
            defaultWeightG: 300,
            defaultLengthMm: 200,
            defaultWidthMm: 120,
            defaultHeightMm: 30,
          },
        },
      },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/clone-prefill',
      headers: authHeader(),
      payload: { ids: ['goods-1688-listing'] },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: [
        {
          id: 'goods-1688-listing',
          sourcePlatform: '1688',
          sourceOzonProductId: '987654321',
          ozonSourceContext: {
            productId: '987654321',
            title: 'Ozon 透明手机壳',
            categoryName: '手机壳',
          },
          suggestedSalePriceCny: 73,
          suggestedSalePriceRub: 913,
          skuPricing: [
            { skuId: 'red', specText: 'red', suggestedSalePriceCny: 69 },
            { skuId: 'blue', specText: 'blue', suggestedSalePriceCny: 81 },
          ],
          skuSummary: {
            count: 2,
            minSuggestedSalePriceCny: 69,
            maxSuggestedSalePriceCny: 81,
          },
          variants: [
            { sku: 'red', source: '1688-pricing', price: '69', suggestedSalePriceCny: 69, suggestedSalePriceRub: 863 },
            { sku: 'blue', source: '1688-pricing', price: '81', suggestedSalePriceCny: 81, suggestedSalePriceRub: 1013 },
          ],
          categoryId: 17028711,
          typeId: 95841,
        },
      ],
    });
    await app.close();
  });

  it('uses 1688 per-sku listing prices for variant fallback publish', async () => {
    const app = await buildCollectApp();
    prismaMock.shop.findFirst.mockResolvedValue({
      id: 'shop-1',
      userId: 'user-1',
      clientId: 'client-1',
      apiKeyEncrypted: 'encrypted-key',
    });
    prismaMock.supplyGoods.findMany.mockResolvedValue([
      {
        id: 'goods-1688-variants',
        title: 'Case for iPhone',
        notes: null,
        sku: '123456789',
        sourcePlatform: '1688',
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        purchasePrice: { toString: () => '20' },
        currency: 'CNY',
        images: [],
        variants: [
          { sku: 'red-local', sourceProductId: '111111111', attrs: { color: 'red' }, price: '200', stock: 0 },
          { sku: 'blue-local', sourceProductId: '222222222', attrs: { color: 'blue' }, price: '210', stock: 0 },
        ],
        modelId: null,
        originalCurrency: null,
        exchangeRateUsed: null,
        metadata: {
          sourceOzonProductId: '987654321',
          ozonSourceContext: {
            productId: '987654321',
            title: 'Ozon source product',
          },
          pricing: {
            suggestedSalePriceCny: 73,
            skuPricing: [
              { skuId: 'red', specText: 'red', suggestedSalePriceCny: 69, suggestedSalePriceRub: 863 },
              { skuId: 'blue', specText: 'blue', suggestedSalePriceCny: 81, suggestedSalePriceRub: 1013 },
            ],
          },
        },
      },
    ]);
    prismaMock.supplyGoods.update.mockResolvedValue({});
    prismaMock.syncJob.create.mockResolvedValue({});
    ozonClientMock.importBySku.mockResolvedValue({
      result: { task_id: 43, unmatched_sku_list: [] },
    });
    ozonClientMock.getImportInfo.mockResolvedValue({ items: [] });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/publish-ozon',
      headers: authHeader(),
      payload: {
        ids: ['goods-1688-variants'],
        shopId: 'shop-1',
        categoryId: 17028711,
        typeId: 95841,
        markupPct: 0,
        mode: 'clone',
        source: 'listing-page',
        priceOverrides: {
          'goods-1688-variants': {
            'red-local': 69,
            'blue-local': 81,
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ozonClientMock.importBySku).toHaveBeenCalledWith([
      expect.objectContaining({ sku: 111111111, price: '69' }),
      expect.objectContaining({ sku: 222222222, price: '81' }),
    ]);
    await app.close();
  });

  it('does not treat persisted 1688 variant sku as Ozon source sku without explicit product id', async () => {
    const app = await buildCollectApp();
    prismaMock.shop.findFirst.mockResolvedValue({
      id: 'shop-1',
      userId: 'user-1',
      clientId: 'client-1',
      apiKeyEncrypted: 'encrypted-key',
    });
    prismaMock.supplyGoods.findMany.mockResolvedValue([
      {
        id: 'goods-1688-unsafe-variants',
        title: 'Case for iPhone',
        notes: null,
        sku: '123456789',
        sourcePlatform: '1688',
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        purchasePrice: { toString: () => '20' },
        currency: 'CNY',
        images: [],
        variants: [
          { sku: '111111111', attrs: { color: 'red' }, price: '69', stock: 0 },
        ],
        modelId: null,
        originalCurrency: null,
        exchangeRateUsed: null,
        metadata: {
          sourceOzonProductId: '987654321',
          ozonSourceContext: {
            productId: '987654321',
            title: 'Ozon source product',
          },
        },
      },
    ]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/publish-ozon',
      headers: authHeader(),
      payload: {
        ids: ['goods-1688-unsafe-variants'],
        shopId: 'shop-1',
        categoryId: 17028711,
        typeId: 95841,
        markupPct: 0,
        mode: 'clone',
        source: 'listing-page',
        priceOverrides: {
          'goods-1688-unsafe-variants': {
            '111111111': 69,
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 0,
      msg: '所有商品均缺少属性且无有效 SKU',
    });
    expect(ozonClientMock.importBySku).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not use 1688 pricing variant ids as Ozon source skus for fallback publish', async () => {
    const app = await buildCollectApp();
    prismaMock.shop.findFirst.mockResolvedValue({
      id: 'shop-1',
      userId: 'user-1',
      clientId: 'client-1',
      apiKeyEncrypted: 'encrypted-key',
    });
    prismaMock.supplyGoods.findMany.mockResolvedValue([
      {
        id: 'goods-1688-pricing-only',
        title: 'Case for iPhone',
        notes: null,
        sku: '123456789',
        sourcePlatform: '1688',
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        purchasePrice: { toString: () => '20' },
        currency: 'CNY',
        images: [],
        variants: [],
        modelId: null,
        originalCurrency: null,
        exchangeRateUsed: null,
        metadata: {
          sourceOzonProductId: '987654321',
          ozonSourceContext: {
            productId: '987654321',
            title: 'Ozon source product',
          },
          pricing: {
            suggestedSalePriceCny: 73,
            skuPricing: [
              { skuId: 'red', specText: '红色', suggestedSalePriceCny: 69, suggestedSalePriceRub: 863 },
              { skuId: 'blue', specText: '蓝色', suggestedSalePriceCny: 81, suggestedSalePriceRub: 1013 },
            ],
          },
        },
      },
    ]);
    prismaMock.supplyGoods.update.mockResolvedValue({});
    prismaMock.syncJob.create.mockResolvedValue({});
    ozonClientMock.importBySku.mockResolvedValue({
      result: { task_id: 44, unmatched_sku_list: [] },
    });
    ozonClientMock.getImportInfo.mockResolvedValue({ items: [] });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/publish-ozon',
      headers: authHeader(),
      payload: {
        ids: ['goods-1688-pricing-only'],
        shopId: 'shop-1',
        categoryId: 17028711,
        typeId: 95841,
        markupPct: 0,
        mode: 'clone',
        source: 'listing-page',
        priceOverrides: {
          'goods-1688-pricing-only': {
            _base: 73,
            red: 69,
            blue: 81,
          },
        },
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ozonClientMock.importBySku).toHaveBeenCalledWith([
      expect.objectContaining({ sku: 987654321, price: '69' }),
    ]);
    expect(ozonClientMock.importBySku).not.toHaveBeenCalledWith([
      expect.objectContaining({ sku: 123456789 }),
    ]);
    expect(ozonClientMock.importBySku).not.toHaveBeenCalledWith([
      expect.objectContaining({ sku: 'red' }),
    ]);
    await app.close();
  });

  it('does not expand metadata-only 1688 pricing variants in clone import publish', async () => {
    const app = await buildCollectApp();
    prismaMock.shop.findFirst.mockResolvedValue({
      id: 'shop-1',
      userId: 'user-1',
      clientId: 'client-1',
      apiKeyEncrypted: 'encrypted-key',
    });
    prismaMock.supplyGoods.findMany.mockResolvedValue([
      {
        id: 'goods-1688-import',
        title: 'Case for iPhone',
        notes: null,
        sku: '123456789',
        sourcePlatform: '1688',
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        purchasePrice: { toString: () => '20' },
        currency: 'CNY',
        images: [],
        variants: [],
        modelId: null,
        originalCurrency: null,
        exchangeRateUsed: null,
        metadata: {
          sourceOzonProductId: '987654321',
          ozonSourceContext: {
            productId: '987654321',
            title: 'Ozon source product',
          },
          ozonAttributes: [
            {
              attribute_id: 4180,
              complex_id: 0,
              values: [{ value: 'Source description', dictionary_value_id: 0 }],
            },
          ],
          pricing: {
            suggestedSalePriceCny: 73,
            skuPricing: [
              { skuId: 'red', specText: 'red', suggestedSalePriceCny: 69, suggestedSalePriceRub: 863 },
              { skuId: 'blue', specText: 'blue', suggestedSalePriceCny: 81, suggestedSalePriceRub: 1013 },
            ],
          },
        },
      },
    ]);
    prismaMock.supplyGoods.update.mockResolvedValue({});
    prismaMock.syncJob.create.mockResolvedValue({});
    ozonClientMock.getDescriptionCategoryAttributes.mockResolvedValue([]);
    ozonClientMock.importProducts.mockResolvedValue({ result: { task_id: 45 } });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/publish-ozon',
      headers: authHeader(),
      payload: {
        ids: ['goods-1688-import'],
        shopId: 'shop-1',
        categoryId: 17028711,
        typeId: 95841,
        markupPct: 0,
        mode: 'clone',
        source: 'listing-page',
        priceOverrides: {
          'goods-1688-import': {
            _base: 73,
            red: 69,
            blue: 81,
          },
        },
      },
    });

    expect(response.statusCode, response.body).toBe(200);
    expect(ozonClientMock.importProducts).toHaveBeenCalledTimes(1);
    const importItems = ozonClientMock.importProducts.mock.calls[0]?.[0] || [];
    expect(importItems).toHaveLength(1);
    expect(importItems[0]).toEqual(expect.objectContaining({
      offer_id: expect.not.stringContaining('red'),
      price: '69',
    }));
    await app.close();
  });

  it('uses Ozon source product id instead of 1688 offer id for listing fallback publish', async () => {
    const app = await buildCollectApp();
    prismaMock.shop.findFirst.mockResolvedValue({
      id: 'shop-1',
      userId: 'user-1',
      clientId: 'client-1',
      apiKeyEncrypted: 'encrypted-key',
    });
    prismaMock.supplyGoods.findMany.mockResolvedValue([
      {
        id: 'goods-1688-listing',
        title: 'Case for iPhone',
        notes: null,
        sku: '123456789',
        sourcePlatform: '1688',
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        purchasePrice: { toString: () => '20' },
        currency: 'CNY',
        images: [],
        variants: [],
        modelId: null,
        originalCurrency: null,
        exchangeRateUsed: null,
        metadata: {
          sourceOzonProductId: '987654321',
          ozonSourceContext: {
            productId: '987654321',
            title: 'Ozon source product',
          },
        },
      },
    ]);
    prismaMock.supplyGoods.update.mockResolvedValue({});
    prismaMock.syncJob.create.mockResolvedValue({});
    ozonClientMock.importBySku.mockResolvedValue({
      result: { task_id: 42, unmatched_sku_list: [987654321] },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/collect/publish-ozon',
      headers: authHeader(),
      payload: {
        ids: ['goods-1688-listing'],
        shopId: 'shop-1',
        categoryId: 17028711,
        typeId: 95841,
        markupPct: 0,
        mode: 'clone',
        source: 'listing-page',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ozonClientMock.importBySku).toHaveBeenCalledWith([
      expect.objectContaining({
        sku: 987654321,
        price: '20',
      }),
    ]);
    expect(ozonClientMock.importBySku).not.toHaveBeenCalledWith([
      expect.objectContaining({ sku: 123456789 }),
    ]);
    await app.close();
  });
});

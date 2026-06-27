import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { collectRoutes } from '../routes/collect.js';

const mocks = vi.hoisted(() => {
  const record = {
    id: 'collect-existing',
    userId: 'user-1',
    title: 'Old title',
    sourceUrl: 'https://www.ozon.ru/product/item-123/',
    sourcePlatform: 'ozon',
    sourceProductId: '123',
    sku: '123',
    images: ['old.jpg'],
    purchasePrice: { toString: () => '88.00' },
    currency: 'CNY',
    originalPrice: null,
    originalCurrency: null,
    exchangeRateUsed: null,
    priceNeedsReview: false,
    notes: 'old description',
    metadata: {
      publishTitleRu: 'Ручной заголовок',
      publishDescriptionRu: 'Ручное описание',
      watermarkedImages: ['custom-parent.jpg'],
      existingFlag: true,
      sourceDescriptionRu: 'Старое описание',
    },
    variants: [{ sku: '123', attrs: { Цвет: 'красный' } }],
    modelId: 'old-model',
    status: 'collected',
    createdAt: new Date('2026-06-18T00:00:00.000Z'),
    updatedAt: new Date('2026-06-18T00:00:00.000Z'),
  };

  return {
    authenticate: vi.fn(async (request: any) => {
      request.user = { userId: 'user-1' };
    }),
    supplyGoodsFindFirst: vi.fn(async () => ({ ...record })),
    supplyGoodsCreate: vi.fn(async ({ data }: any) => ({
      ...record,
      id: 'collect-new',
      ...data,
    })),
    supplyGoodsUpdate: vi.fn(async ({ where, data }: any) => ({
      ...record,
      id: where.id,
      ...data,
    })),
    supplyGoodsCount: vi.fn(async () => 1),
    supplyGoodsFindMany: vi.fn(async () => [{ ...record, updatedAt: new Date('2026-06-18T01:00:00.000Z') }]),
    resolveCollectedPrice: vi.fn(async () => ({
      purchasePriceCny: 99,
      originalPrice: 799,
      originalCurrency: 'RUB',
      exchangeRateUsed: 0.124,
      needsReview: false,
    })),
    transferSourceProductImages: vi.fn(async ({ images }: any): Promise<{ images: string[]; diagnostic: any }> => ({
      images: Array.isArray(images) ? images : [],
      diagnostic: null,
    })),
  };
});

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    supplyGoods: {
      findFirst: mocks.supplyGoodsFindFirst,
      create: mocks.supplyGoodsCreate,
      update: mocks.supplyGoodsUpdate,
      count: mocks.supplyGoodsCount,
      findMany: mocks.supplyGoodsFindMany,
      delete: vi.fn(),
    },
    shop: {
      findFirst: vi.fn(async () => null),
    },
  },
}));

vi.mock('../services/collect-pricing.js', () => ({
  resolveCollectedPrice: mocks.resolveCollectedPrice,
}));

vi.mock('../services/source-image-transfer.js', () => ({
  transferSourceProductImages: mocks.transferSourceProductImages,
}));

async function buildApp() {
  const app = Fastify();
  await app.register(collectRoutes, { prefix: '/api/collect' });
  await app.ready();
  return app;
}

function collectedOzonItem() {
  return {
    title: 'New collected title',
    publishTitle: 'Новый исходный заголовок',
    sourceTitleRaw: 'Новый исходный заголовок',
    sourceLocale: 'ru',
    sourceUrl: 'https://www.ozon.ru/product/new-item-123/',
    sourcePlatform: 'ozon',
    sourceProductId: '123',
    sku: '123',
    images: ['new-a.jpg', 'new-b.jpg'],
    priceText: '799',
    currency: 'RUB',
    description: 'Новое описание карточки',
    richDescriptionJson: '{"blocks":[]}',
    sourceVideos: [{ url: 'https://cdn.example.com/demo.mp4', coverUrl: 'https://cdn.example.com/demo.jpg' }],
    ozonAttributes: [{ id: 1, values: [{ value: 'значение' }] }],
    descriptionCategoryId: 17028706,
    typeId: 95913,
    weightG: 510,
    lengthMm: 220,
    widthMm: 180,
    heightMm: 70,
    manufacturerName: 'Factory',
    brandName: 'Brand',
    variants: [{ sku: '123', attrs: { Цвет: 'синий' } }, { sku: '124', attrs: { Цвет: 'черный' } }],
    modelId: 'new-model',
    widgetStatesDump: { recursiveVariantDiscovery: { finalVariantCount: 2 } },
  };
}

describe('collectRoutes batch upsert', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates a source collect record with complete 1688 metadata through the single collect endpoint', async () => {
    mocks.transferSourceProductImages.mockResolvedValueOnce({
      images: ['https://ss-erp.com/api/cdn/users/user-1/raw/1688-main.jpg'],
      diagnostic: {
        enabled: true,
        backend: 'oss',
        attempted: 1,
        transferred: 1,
        skipped: 0,
        errors: [],
      },
    });
    mocks.transferSourceProductImages.mockResolvedValueOnce({
      images: ['https://ss-erp.com/api/cdn/users/user-1/raw/1688-detail-1.jpg'],
      diagnostic: {
        enabled: true,
        backend: 'oss',
        attempted: 1,
        transferred: 1,
        skipped: 0,
        errors: [],
      },
    });
    const app = await buildApp();

    try {
      const payload = {
        title: '智能保温杯批发',
        sourceTitleRaw: '智能保温杯批发',
        sourceLocale: 'zh-CN',
        sourceUrl: 'https://detail.1688.com/offer/744455566677.html',
        sourcePlatform: '1688',
        sourceProductId: '744455566677',
        sku: '744455566677',
        images: ['https://img.example.com/main.jpg'],
        sourceMainImages: ['https://img.example.com/main.jpg'],
        sourceDetailImages: ['https://img.example.com/detail-1.jpg'],
        sourcePackagingRows: [{
          color: '红色',
          size: '500ml',
          lengthMm: 80,
          widthMm: 80,
          heightMm: 220,
          volumeCm3: 1408,
          weightG: 350,
        }],
        sourceRichContentDraft: {
          status: 'raw_source_requires_processing',
          source: '1688',
          locale: 'zh-CN',
          blocks: [
            { type: 'text', text: '双层真空保温，适合跨境上架。' },
            { type: 'image', url: 'https://img.example.com/detail-1.jpg' },
          ],
        },
        priceText: '¥18.80 ~ ¥22.50',
        displayPrice: '18.80-22.50',
        ladderPrices: [{ minQuantity: 2, price: 22.5 }, { minQuantity: 50, price: 18.8 }],
        currency: 'CNY',
        shippingCny: 5,
        totalCostCny: 23.8,
        priceSourceType: 'sku',
        priceConfidence: 'high',
        weightG: 350,
        lengthMm: 80,
        widthMm: 80,
        heightMm: 220,
        categoryPath: ['日用百货', '杯具', '保温杯'],
        categoryName: '保温杯',
        attributes: [
          { name: '材质', value: '316不锈钢' },
          { name: '容量', value: '500ml' },
        ],
        description: '双层真空保温，适合跨境上架。',
        sourceVideos: [{ url: 'https://video.example.com/a.mp4', coverUrl: 'https://img.example.com/video.jpg' }],
        selectedSku: { skuId: 'red-500', price: 18.8, attrs: { 颜色: '红色' } },
        skuItems: [{ skuId: 'red-500', price: 18.8, images: ['https://img.example.com/red.jpg'] }],
        variants: [{ skuId: 'red-500', price: 18.8, attrs: { 颜色: '红色' } }],
        rawSourceProduct: { offerId: '744455566677' },
        rejectedAssets: [{ url: 'https://img.example.com/icon.svg', reason: 'svg' }],
        extractionDiagnostics: {
          titleFound: true,
          imageCount: 1,
          detailImageCount: 1,
          rejectedImageCount: 1,
          skuCount: 1,
          skuSource: 'skuMap',
          attributeCount: 2,
          packagingCount: 1,
          descriptionFound: true,
          videoCount: 1,
          priceSourceType: 'sku',
          priceConfidence: 'high',
          missing: [],
        },
      };

      const response = await app.inject({
        method: 'POST',
        url: '/api/collect',
        payload,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { id: 'collect-new' },
      });

      const createArgs = mocks.supplyGoodsCreate.mock.calls[0]?.[0];
      expect(createArgs.data).toMatchObject({
        title: '智能保温杯批发',
        sourceUrl: 'https://detail.1688.com/offer/744455566677.html',
        sourcePlatform: '1688',
        sourceProductId: '744455566677',
        sku: '744455566677',
        images: ['https://ss-erp.com/api/cdn/users/user-1/raw/1688-main.jpg'],
        variants: [{ skuId: 'red-500', price: 18.8, attrs: { 颜色: '红色' } }],
      });
      expect(mocks.transferSourceProductImages).toHaveBeenCalledWith({
        images: ['https://img.example.com/main.jpg'],
        sourcePlatform: '1688',
        userId: 'user-1',
      });
      expect(mocks.transferSourceProductImages).toHaveBeenCalledWith({
        images: ['https://img.example.com/detail-1.jpg'],
        sourcePlatform: '1688',
        userId: 'user-1',
      });
      expect(createArgs.data.metadata).toMatchObject({
        titleNeedsReview: true,
        sourcePlatform: '1688',
        sourceTitleRaw: '智能保温杯批发',
        sourceLocale: 'zh-CN',
        sourceDescriptionRaw: '双层真空保温，适合跨境上架。',
        sourceMainImages: ['https://ss-erp.com/api/cdn/users/user-1/raw/1688-main.jpg'],
        sourceDetailImages: ['https://ss-erp.com/api/cdn/users/user-1/raw/1688-detail-1.jpg'],
        sourcePackagingRows: [{
          color: '红色',
          size: '500ml',
          lengthMm: 80,
          widthMm: 80,
          heightMm: 220,
          volumeCm3: 1408,
          weightG: 350,
        }],
        sourceRichContentDraft: {
          status: 'raw_source_requires_processing',
          source: '1688',
          locale: 'zh-CN',
          blocks: [
            { type: 'text', text: '双层真空保温，适合跨境上架。' },
            { type: 'image', url: 'https://ss-erp.com/api/cdn/users/user-1/raw/1688-detail-1.jpg' },
          ],
        },
        sourceVideos: [{ url: 'https://video.example.com/a.mp4', coverUrl: 'https://img.example.com/video.jpg' }],
        categoryPath: ['日用百货', '杯具', '保温杯'],
        categoryName: '保温杯',
        sourceAttributes: [
          { name: '材质', value: '316不锈钢' },
          { name: '容量', value: '500ml' },
        ],
        priceText: '¥18.80 ~ ¥22.50',
        displayPrice: '18.80-22.50',
        ladderPrices: [{ minQuantity: 2, price: 22.5 }, { minQuantity: 50, price: 18.8 }],
        shippingCny: 5,
        totalCostCny: 23.8,
        priceSourceType: 'sku',
        priceConfidence: 'high',
        weightG: 350,
        lengthMm: 80,
        widthMm: 80,
        heightMm: 220,
        selectedSku: { skuId: 'red-500', price: 18.8, attrs: { 颜色: '红色' } },
        skuItems: [{ skuId: 'red-500', price: 18.8, images: ['https://img.example.com/red.jpg'] }],
        rawSourceProduct: { offerId: '744455566677' },
        rejectedAssets: [{ url: 'https://img.example.com/icon.svg', reason: 'svg' }],
        extractionDiagnostics: {
          titleFound: true,
          imageCount: 1,
          detailImageCount: 1,
          rejectedImageCount: 1,
          skuCount: 1,
          skuSource: 'skuMap',
          attributeCount: 2,
          packagingCount: 1,
          descriptionFound: true,
          videoCount: 1,
          priceSourceType: 'sku',
          priceConfidence: 'high',
          missing: [],
        },
        sourceImageTransfer: {
          enabled: true,
          backend: 'oss',
          attempted: 1,
          transferred: 1,
          skipped: 0,
          errors: [],
        },
        sourceDetailImageTransfer: {
          enabled: true,
          backend: 'oss',
          attempted: 1,
          transferred: 1,
          skipped: 0,
          errors: [],
        },
      });
      expect(createArgs.data.metadata).not.toHaveProperty('sourceDescriptionRu');
    } finally {
      await app.close();
    }
  });

  it('filters the collect list between Ozon follow records and domestic source records', async () => {
    const app = await buildApp();

    try {
      const ozonResponse = await app.inject({
        method: 'GET',
        url: '/api/collect?sourceGroup=ozon',
      });
      expect(ozonResponse.statusCode).toBe(200);
      expect(mocks.supplyGoodsCount).toHaveBeenLastCalledWith({
        where: expect.objectContaining({
          userId: 'user-1',
          sourcePlatform: 'ozon',
        }),
      });

      const sourceResponse = await app.inject({
        method: 'GET',
        url: '/api/collect?sourceGroup=source',
      });
      expect(sourceResponse.statusCode).toBe(200);
      expect(mocks.supplyGoodsCount).toHaveBeenLastCalledWith({
        where: expect.objectContaining({
          userId: 'user-1',
          sourcePlatform: { in: ['1688', 'pdd', 'taobao', 'tmall', 'xianyu', 'goofish'] },
        }),
      });
    } finally {
      await app.close();
    }
  });

  it('rejects empty domestic source shell captures before they pollute the source list', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect',
        payload: {
          title: '拼多多批发 - 拼多多官方采购批发平台，多多批发',
          sourceTitleRaw: '拼多多批发 - 拼多多官方采购批发平台，多多批发',
          sourceUrl: 'https://pifa.pinduoduo.com/',
          sourcePlatform: 'pdd',
          sourceProductId: 'cmqwo1qoj00515o7oafa0lbj9',
          sku: 'cmqwo1qoj00515o7oafa0lbj9',
          images: [],
          priceText: '¥0',
          skuItems: [],
          variants: [],
          extractionDiagnostics: {
            titleFound: true,
            imageCount: 0,
            skuCount: 0,
            fieldConfidence: { price: 'missing', images: 'missing', sku: 'missing' },
          },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 0,
        msg: expect.stringContaining('采集结果不完整'),
      });
      expect(mocks.supplyGoodsCreate).not.toHaveBeenCalled();
      expect(mocks.transferSourceProductImages).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('creates a new Ozon collect record for repeated manual collection', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/batch',
        payload: {
          items: [collectedOzonItem()],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { saved: 1, errors: [] },
      });

      expect(mocks.supplyGoodsFindFirst).not.toHaveBeenCalled();
      expect(mocks.supplyGoodsUpdate).not.toHaveBeenCalled();
      expect(mocks.supplyGoodsCreate).toHaveBeenCalledTimes(1);

      const createArgs = mocks.supplyGoodsCreate.mock.calls[0]?.[0];
      expect(createArgs.data).toMatchObject({
        user: { connect: { id: 'user-1' } },
        title: 'New collected title',
        sourceUrl: 'https://www.ozon.ru/product/new-item-123/',
        sourcePlatform: 'ozon',
        sourceProductId: '123',
        sku: '123',
        images: ['new-a.jpg', 'new-b.jpg'],
        purchasePrice: 99,
        currency: 'CNY',
        originalPrice: 799,
        originalCurrency: 'RUB',
        exchangeRateUsed: 0.124,
        priceNeedsReview: false,
        notes: 'Новое описание карточки',
        variants: [{ sku: '123', attrs: { Цвет: 'синий' } }, { sku: '124', attrs: { Цвет: 'черный' } }],
        modelId: 'new-model',
      });
      expect(createArgs.data.metadata).toMatchObject({
        publishTitleRu: 'Новый исходный заголовок',
        sourceTitleRaw: 'Новый исходный заголовок',
        sourceLocale: 'ru',
        sourceDescriptionRu: 'Новое описание карточки',
        sourceRichDescriptionJson: '{"blocks":[]}',
        sourceVideos: [{ url: 'https://cdn.example.com/demo.mp4', coverUrl: 'https://cdn.example.com/demo.jpg' }],
        ozonAttributes: [{ id: 1, values: [{ value: 'значение' }] }],
        descriptionCategoryId: 17028706,
        typeId: 95913,
        weightG: 510,
        lengthMm: 220,
        widthMm: 180,
        heightMm: 70,
        manufacturerName: 'Factory',
        brandName: 'Brand',
        widgetStatesDump: { recursiveVariantDiscovery: { finalVariantCount: 2 } },
      });
      expect(createArgs.data.metadata).not.toHaveProperty('existingFlag');
      expect(createArgs.data.metadata).not.toHaveProperty('watermarkedImages');
    } finally {
      await app.close();
    }
  });

  it('updates an existing Ozon collect record during enrichment', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/batch',
        payload: {
          collectPhase: 'enrichment',
          items: [collectedOzonItem()],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { saved: 1, errors: [] },
      });

      expect(mocks.supplyGoodsCreate).not.toHaveBeenCalled();
      expect(mocks.supplyGoodsUpdate).toHaveBeenCalledTimes(1);
      expect(mocks.supplyGoodsFindFirst).toHaveBeenCalledWith(expect.objectContaining({
        where: expect.objectContaining({
          userId: 'user-1',
          sourcePlatform: 'ozon',
        }),
        orderBy: { updatedAt: 'desc' },
      }));

      const updateArgs = mocks.supplyGoodsUpdate.mock.calls[0]?.[0];
      expect(updateArgs.where).toEqual({ id: 'collect-existing' });
      expect(updateArgs.data.metadata).toMatchObject({
        existingFlag: true,
        publishTitleRu: 'Ручной заголовок',
        publishDescriptionRu: 'Ручное описание',
        watermarkedImages: ['custom-parent.jpg'],
        sourceTitleRaw: 'Новый исходный заголовок',
        sourceDescriptionRu: 'Новое описание карточки',
        sourceRichDescriptionJson: '{"blocks":[]}',
      });
    } finally {
      await app.close();
    }
  });

  it('orders the collect list by updatedAt so refreshed SKU records are visible first', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/collect?offset=0&limit=20',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { total: 1 },
      });
      expect(mocks.supplyGoodsFindMany).toHaveBeenCalledWith(expect.objectContaining({
        orderBy: { updatedAt: 'desc' },
      }));
    } finally {
      await app.close();
    }
  });

  it('keeps source list available when lazy source product profile persistence fails', async () => {
    const app = await buildApp();
    const legacySourceRow = {
      id: 'legacy-source-write-fails',
      title: '女士无痕内衣',
      sourcePlatform: '1688',
      sourceProductId: '945335480485',
      sku: '945335480485',
      purchasePrice: { toString: () => '8.50' },
      originalPrice: null,
      exchangeRateUsed: null,
      metadata: {
        sourceTitleRaw: '女士无痕内衣',
        sourceStandardAttributes: {
          packageWeightG: 100,
          packageDimensionsMm: null,
          missingForOzon: ['包装尺寸'],
        },
        extractionDiagnostics: {
          packaging: {
            status: 'weight_only',
            reason: 'weight_only',
            message: '只采到重量，缺包装尺寸',
          },
        },
      },
      variants: [{ sku: '945335480485', attrs: { 颜色: '黑色', 尺码: 'M' } }],
      createdAt: new Date('2026-06-18T00:00:00.000Z'),
      updatedAt: new Date('2026-06-18T01:00:00.000Z'),
    };
    mocks.supplyGoodsFindMany.mockResolvedValueOnce([legacySourceRow as any]);
    mocks.supplyGoodsUpdate.mockRejectedValueOnce(new Error('write conflict'));

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/collect?sourceGroup=source',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.rows[0].metadata.sourceProductProfile).toMatchObject({
        sourceProductId: '945335480485',
        packaging: expect.objectContaining({
          reasonCode: 'weight_only',
        }),
      });
      expect(mocks.supplyGoodsUpdate).toHaveBeenCalledTimes(1);
    } finally {
      await app.close();
    }
  });

  it('lazily persists source product profiles for legacy domestic source list rows', async () => {
    const app = await buildApp();
    const legacySourceRow = {
      id: 'legacy-source-1',
      userId: 'user-1',
      title: '女士无痕内衣',
      sourceUrl: 'https://detail.1688.com/offer/945335480485.html',
      sourcePlatform: '1688',
      sourceProductId: '945335480485',
      sku: '945335480485',
      images: ['https://img.example.com/main.jpg'],
      purchasePrice: { toString: () => '8.50' },
      currency: 'CNY',
      originalPrice: null,
      originalCurrency: null,
      exchangeRateUsed: null,
      priceNeedsReview: false,
      notes: '',
      modelId: null,
      metadata: {
        sourceTitleRaw: '女士无痕内衣',
        categoryPath: ['服饰内衣', '女士内衣'],
        sourceStandardAttributes: {
          colors: ['黑色'],
          sizes: ['M'],
          materials: ['锦纶'],
          categoryHints: ['内衣'],
          packageWeightG: 100,
          packageDimensionsMm: null,
          missingForOzon: ['包装尺寸'],
        },
        extractionDiagnostics: {
          packagingCount: 0,
          packaging: {
            status: 'weight_only',
            reason: 'weight_only',
            sectionFound: true,
            tableLike: true,
            rowCount: 0,
            hasWeight: true,
            hasDimensions: false,
            message: '只采到重量，缺包装尺寸',
          },
        },
      },
      variants: [{ sku: '945335480485', attrs: { 颜色: '黑色', 尺码: 'M' } }],
      status: 'collected',
      createdAt: new Date('2026-06-18T00:00:00.000Z'),
      updatedAt: new Date('2026-06-18T01:00:00.000Z'),
    };
    mocks.supplyGoodsFindMany.mockResolvedValueOnce([legacySourceRow as any]);

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/collect?sourceGroup=source',
      });

      expect(response.statusCode).toBe(200);
      const row = response.json().data.rows[0];
      expect(row.metadata.sourceProductProfile).toMatchObject({
        sourceProductId: '945335480485',
        packaging: {
          status: 'weight_only',
          reasonCode: 'weight_only',
          reasonLabel: '只采到重量，缺包装尺寸',
        },
      });
      expect(mocks.supplyGoodsUpdate).toHaveBeenCalledWith({
        where: { id: 'legacy-source-1' },
        data: {
          metadata: expect.objectContaining({
            sourceProductProfile: expect.objectContaining({
              sourceProductId: '945335480485',
              packaging: expect.objectContaining({
                reasonCode: 'weight_only',
              }),
            }),
          }),
        },
      });
    } finally {
      await app.close();
    }
  });
});

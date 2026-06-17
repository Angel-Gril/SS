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
    supplyGoodsCreate: vi.fn(async () => {
      throw new Error('create should not be called for existing Ozon collect records');
    }),
    supplyGoodsUpdate: vi.fn(async ({ where, data }: any) => ({
      ...record,
      id: where.id,
      ...data,
    })),
    resolveCollectedPrice: vi.fn(async () => ({
      purchasePriceCny: 99,
      originalPrice: 799,
      originalCurrency: 'RUB',
      exchangeRateUsed: 0.124,
      needsReview: false,
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
      findMany: vi.fn(async () => []),
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

async function buildApp() {
  const app = Fastify();
  await app.register(collectRoutes, { prefix: '/api/collect' });
  await app.ready();
  return app;
}

describe('collectRoutes batch upsert', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('updates an existing Ozon collect record instead of creating a duplicate during enrichment', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/collect/batch',
        payload: {
          items: [{
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
          }],
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
      }));

      const updateArgs = mocks.supplyGoodsUpdate.mock.calls[0]?.[0];
      expect(updateArgs.where).toEqual({ id: 'collect-existing' });
      expect(updateArgs.data).toMatchObject({
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
      expect(updateArgs.data.metadata).toMatchObject({
        existingFlag: true,
        publishTitleRu: 'Ручной заголовок',
        publishDescriptionRu: 'Ручное описание',
        watermarkedImages: ['custom-parent.jpg'],
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
    } finally {
      await app.close();
    }
  });
});

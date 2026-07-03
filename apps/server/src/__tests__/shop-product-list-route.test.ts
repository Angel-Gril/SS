import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shopRoutes } from '../routes/shop.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'user-1' };
  }),
  shopFindFirst: vi.fn(),
  productCount: vi.fn(),
  productFindMany: vi.fn(),
  categoryCatalogFindMany: vi.fn(),
  sourceQuoteFindMany: vi.fn(),
  sourceCandidateFindMany: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    shop: {
      findFirst: mocks.shopFindFirst,
    },
    product: {
      count: mocks.productCount,
      findMany: mocks.productFindMany,
    },
    ozonCategoryCatalog: {
      findMany: mocks.categoryCatalogFindMany,
    },
    sourceQuote: {
      findMany: mocks.sourceQuoteFindMany,
    },
    sourceCandidate: {
      findMany: mocks.sourceCandidateFindMany,
    },
  },
}));

async function buildApp() {
  const app = Fastify();
  await app.register(shopRoutes, { prefix: '/api/shops' });
  await app.ready();
  return app;
}

function statusFromWhere(where: any): 'current' | 'archived' | 'missing' | 'all' {
  const text = JSON.stringify(where);
  if (text.includes('"NOT"')) return 'current';
  if (text.includes('"MISSING"') || text.includes('"missing"')) return 'missing';
  if (text.includes('"ARCHIVED"') || text.includes('"archived"')) return 'archived';
  return 'all';
}

describe('shop product list route', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns status tab counts using the same non-status filters as the product list', async () => {
    const lastSyncAt = new Date('2026-07-03T08:00:00.000Z');
    mocks.shopFindFirst.mockResolvedValue({ id: 'shop-1', userId: 'user-1', platform: 'OZON', lastSyncAt });
    mocks.productFindMany.mockResolvedValue([]);
    mocks.productCount.mockImplementation(async ({ where }: { where: any }) => {
      expect(JSON.stringify(where)).toContain('phone');
      const status = statusFromWhere(where);
      return { current: 4, archived: 2, missing: 3, all: 9 }[status];
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/shops/shop-1/products?statusFilter=archived&search=phone&limit=20&offset=0',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        total: 2,
        rows: [],
        lastSyncAt: lastSyncAt.toISOString(),
        statusFilter: 'archived',
        statusCounts: {
          current: 4,
          archived: 2,
          missing: 3,
          all: 9,
        },
      },
    });
    expect(mocks.productCount).toHaveBeenCalledTimes(4);
    expect(mocks.productFindMany).toHaveBeenCalledTimes(1);

    await app.close();
  });

  it('returns buyer price from selected source quotes for product list rows', async () => {
    const lastSyncAt = new Date('2026-07-03T08:00:00.000Z');
    mocks.shopFindFirst.mockResolvedValue({ id: 'shop-1', userId: 'user-1', platform: 'OZON', lastSyncAt });
    mocks.productCount.mockResolvedValue(1);
    mocks.productFindMany.mockResolvedValue([{
      id: 'product-1',
      platformProductId: '100',
      sku: 'sku-1',
      offerId: 'offer-1',
      title: 'Ozon product',
      price: { toString: () => '122.00' },
      oldPrice: { toString: () => '147.00' },
      currency: 'RUB',
      stock: 1,
      weight: null,
      images: [],
      status: 'price_sent',
      visibility: 'VISIBLE',
      syncStatus: 'SYNCED',
      categoryId: null,
      commissionRate: null,
      minPrice: null,
      variants: null,
      ozonCreatedAt: null,
      ozonUpdatedAt: null,
      lastOzonSyncAt: null,
      createdAt: new Date('2026-07-03T07:00:00.000Z'),
      updatedAt: new Date('2026-07-03T07:00:00.000Z'),
    }]);
    mocks.sourceQuoteFindMany.mockResolvedValue([{
      ozonProductId: '100',
      costCny: { toString: () => '36.36' },
      sourcePlatform: '1688',
    }]);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/shops/shop-1/products?limit=20&offset=0',
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().data.rows[0]).toMatchObject({
      id: 'product-1',
      buyerPriceCny: '36.36',
      buyerSourcePlatform: '1688',
    });
    expect(mocks.sourceQuoteFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        userId: 'user-1',
        ozonProductId: { in: ['100'] },
      }),
    }));
    expect(mocks.sourceCandidateFindMany).not.toHaveBeenCalled();

    await app.close();
  });
});

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
});

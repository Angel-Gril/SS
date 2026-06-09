import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../lib/auth.js';
import { dashboardRoutes } from '../routes/dashboard.js';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  shop: {
    findMany: vi.fn(),
  },
  product: {
    count: vi.fn(),
  },
  order: {
    count: vi.fn(),
    aggregate: vi.fn(),
    findMany: vi.fn(),
  },
  supplyGoods: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
  categoryMapping: {
    count: vi.fn(),
    findFirst: vi.fn(),
  },
}));

const redisMock = vi.hoisted(() => ({
  exists: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../lib/redis.js', () => ({ redis: redisMock }));

async function buildDashboardApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
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
});

describe('dashboard business status', () => {
  it('summarizes visible 1688 and category mapping workflow status for the current user', async () => {
    const app = await buildDashboardApp();
    prismaMock.supplyGoods.count.mockResolvedValue(3);
    prismaMock.supplyGoods.findFirst.mockResolvedValue({
      id: 'goods-1',
      title: '透明手机壳',
      sourceProductId: '123456789',
      updatedAt: new Date('2026-06-09T00:00:00.000Z'),
    });
    prismaMock.categoryMapping.count.mockResolvedValue(5);
    prismaMock.categoryMapping.findFirst.mockResolvedValue({
      id: 'mapping-1',
      sourceCategoryName: '手机壳',
      targetCategoryId: 17028711,
      targetTypeId: 95841,
      updatedAt: new Date('2026-06-08T00:00:00.000Z'),
    });

    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/business-status',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        collect1688: {
          supplyGoodCount: 3,
          latestSupplyGood: {
            id: 'goods-1',
            title: '透明手机壳',
            sourceProductId: '123456789',
            updatedAt: '2026-06-09T00:00:00.000Z',
          },
        },
        categoryMapping: {
          mappingCount: 5,
          latestMapping: {
            id: 'mapping-1',
            sourceCategoryName: '手机壳',
            targetCategoryId: 17028711,
            targetTypeId: 95841,
          },
        },
      },
    });
    await app.close();
  });

  it('does not include another user supply goods or private category mappings', async () => {
    const app = await buildDashboardApp();
    prismaMock.supplyGoods.count.mockResolvedValue(0);
    prismaMock.supplyGoods.findFirst.mockResolvedValue(null);
    prismaMock.categoryMapping.count.mockResolvedValue(1);
    prismaMock.categoryMapping.findFirst.mockResolvedValue(null);

    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard/business-status',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(prismaMock.supplyGoods.count).toHaveBeenCalledWith({
      where: { userId: 'user-1', sourcePlatform: '1688' },
    });
    expect(prismaMock.supplyGoods.findFirst).toHaveBeenCalledWith({
      where: { userId: 'user-1', sourcePlatform: '1688' },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, sourceProductId: true, updatedAt: true },
    });
    expect(prismaMock.categoryMapping.count).toHaveBeenCalledWith({
      where: {
        OR: [{ userId: 'user-1' }, { userId: null }],
        sourcePlatform: '1688',
      },
    });
    expect(prismaMock.categoryMapping.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [{ userId: 'user-1' }, { userId: null }],
        sourcePlatform: '1688',
      },
      orderBy: [{ userId: 'desc' }, { updatedAt: 'desc' }],
      select: {
        id: true,
        sourceCategoryName: true,
        targetCategoryId: true,
        targetTypeId: true,
        updatedAt: true,
      },
    });
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        collect1688: { supplyGoodCount: 0, latestSupplyGood: null },
        categoryMapping: { mappingCount: 1, latestMapping: null },
      },
    });
    await app.close();
  });
});

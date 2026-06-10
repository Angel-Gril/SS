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
    findMany: vi.fn(),
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
  prismaMock.supplyGoods.findMany.mockResolvedValue([]);
});

describe('supply goods export route', () => {
  it('rejects unauthenticated export requests', async () => {
    const app = await buildSupplyApp();

    const response = await app.inject({
      method: 'GET',
      url: '/api/supply/export',
    });

    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('exports saved 1688 goods with Ozon context, mapping, and SKU pricing columns', async () => {
    const app = await buildSupplyApp();
    prismaMock.supplyGoods.findMany.mockResolvedValue([
      {
        id: 'goods-1688',
        title: '透明手机壳',
        sourcePlatform: '1688',
        sourceProductId: '123456789',
        sourceUrl: 'https://detail.1688.com/offer/123456789.html',
        supplier: '义乌供应商',
        sku: 'SKU-1',
        purchasePrice: { toString: () => '20.00' },
        currency: 'CNY',
        status: 'active',
        metadata: {
          sourceOzonProductId: '987654321',
          ozonSourceContext: {
            productId: '987654321',
            title: 'Ozon прозрачный чехол',
            categoryName: 'Чехлы',
          },
          sourceCategoryId: 'cat-1',
          sourceCategoryName: '手机壳',
          sourceCategoryPath: '手机配件 > 手机壳',
          mappedCategory: {
            targetCategoryId: 17028711,
            targetTypeId: 95841,
            targetCategoryName: 'Чехлы',
            targetCategoryPath: 'Ozon > Чехлы',
            matchType: 'sourceCategoryPath',
            scope: 'user',
          },
          pricing: {
            suggestedSalePriceCny: 73,
            suggestedSalePriceRub: 913,
            estimatedMarginPct: 26.36,
            skuSummary: {
              count: 2,
              minSuggestedSalePriceCny: 69,
              maxSuggestedSalePriceCny: 81,
              minSuggestedSalePriceRub: 863,
              maxSuggestedSalePriceRub: 1013,
            },
          },
          sourceDetails: {
            dimensions: {
              lengthMm: 200,
              widthMm: 120,
              heightMm: 30,
            },
          },
        },
        createdAt: new Date('2026-06-09T10:00:00.000Z'),
        updatedAt: new Date('2026-06-10T11:30:00.000Z'),
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/supply/export?sourcePlatform=1688&search=%E6%89%8B%E6%9C%BA%E5%A3%B3',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain('supply_goods_');
    expect(response.body.charCodeAt(0)).toBe(0xfeff);
    expect(response.body).toContain('商品名,来源平台,来源商品ID,来源URL,供应商,SKU,采购价,币种,状态');
    expect(response.body).toContain('透明手机壳,1688,123456789,https://detail.1688.com/offer/123456789.html,义乌供应商,SKU-1,20.00,CNY,active');
    expect(response.body).toContain('987654321,Ozon прозрачный чехол,Чехлы');
    expect(response.body).toContain('cat-1,手机壳,手机配件 > 手机壳');
    expect(response.body).toContain('17028711,95841,Чехлы,Ozon > Чехлы,路径匹配,我的映射');
    expect(response.body).toContain('73,913,26.36,2,69-81,863-1013,200,120,30');
    expect(prismaMock.supplyGoods.findMany).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        sourcePlatform: '1688',
        OR: [
          { title: { contains: '手机壳', mode: 'insensitive' } },
          { supplier: { contains: '手机壳', mode: 'insensitive' } },
          { sku: { contains: '手机壳', mode: 'insensitive' } },
          { sourceProductId: { contains: '手机壳', mode: 'insensitive' } },
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: 10000,
    });
    await app.close();
  });

  it('exports blank cells when optional metadata is missing', async () => {
    const app = await buildSupplyApp();
    prismaMock.supplyGoods.findMany.mockResolvedValue([
      {
        id: 'goods-manual',
        title: '手工货源',
        sourcePlatform: 'other',
        sourceProductId: null,
        sourceUrl: null,
        supplier: null,
        sku: null,
        purchasePrice: null,
        currency: 'CNY',
        status: 'active',
        metadata: null,
        createdAt: new Date('2026-06-09T10:00:00.000Z'),
        updatedAt: new Date('2026-06-10T11:30:00.000Z'),
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/supply/export',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.body).toContain('手工货源,other,,,,,,CNY,active');
    await app.close();
  });
});

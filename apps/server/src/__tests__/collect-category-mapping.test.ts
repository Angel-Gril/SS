import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../lib/auth.js';
import { collectRoutes } from '../routes/collect.js';

const prismaMock = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
  },
  supplyGoods: {
    findMany: vi.fn(),
  },
}));

const redisMock = vi.hoisted(() => ({
  exists: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../lib/redis.js', () => ({ redis: redisMock }));

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

    expect(response.statusCode).toBe(200);
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

    expect(response.statusCode).toBe(200);
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
});

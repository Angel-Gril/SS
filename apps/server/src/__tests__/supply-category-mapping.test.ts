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

describe('supply category mapping routes', () => {
  it('creates and lists user-owned category mappings', async () => {
    const app = await buildSupplyApp();
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
      defaultLengthMm: null,
      defaultWidthMm: null,
      defaultHeightMm: null,
      notes: null,
      createdAt: new Date('2026-06-08T00:00:00.000Z'),
      updatedAt: new Date('2026-06-08T00:00:00.000Z'),
    };
    prismaMock.categoryMapping.create.mockResolvedValue(mapping);
    prismaMock.categoryMapping.findMany.mockResolvedValue([mapping]);

    const createResponse = await app.inject({
      method: 'POST',
      url: '/api/supply/category-mappings',
      headers: authHeader(),
      payload: {
        sourcePlatform: '1688',
        sourceCategoryName: '手机壳',
        targetCategoryId: 17028711,
        targetTypeId: 95841,
        targetCategoryName: 'Чехлы',
        defaultWeightG: 300,
      },
    });

    expect(createResponse.statusCode).toBe(200);
    expect(createResponse.json()).toMatchObject({ code: 1, data: { id: 'mapping-1' } });
    expect(prismaMock.categoryMapping.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'user-1',
        sourcePlatform: '1688',
        sourceCategoryName: '手机壳',
        targetCategoryId: 17028711,
        targetTypeId: 95841,
      }),
    });

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/supply/category-mappings?sourcePlatform=1688',
      headers: authHeader(),
    });

    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json()).toMatchObject({ code: 1, data: [{ id: 'mapping-1' }] });
    expect(prismaMock.categoryMapping.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        OR: [{ userId: 'user-1' }, { userId: null }],
        sourcePlatform: '1688',
      }),
    }));
    await app.close();
  });

  it('looks up a user mapping before a global mapping', async () => {
    const app = await buildSupplyApp();
    prismaMock.categoryMapping.findMany.mockResolvedValue([
      {
        id: 'global-1',
        userId: null,
        sourcePlatform: '1688',
        sourceCategoryName: '手机壳',
        sourceCategoryId: null,
        targetCategoryId: 1,
        targetTypeId: 2,
      },
      {
        id: 'user-1',
        userId: 'user-1',
        sourcePlatform: '1688',
        sourceCategoryName: '手机壳',
        sourceCategoryId: null,
        targetCategoryId: 3,
        targetTypeId: 4,
      },
    ]);

    const response = await app.inject({
      method: 'GET',
      url: '/api/supply/category-mappings/lookup?sourcePlatform=1688&sourceCategoryName=%E6%89%8B%E6%9C%BA%E5%A3%B3',
      headers: authHeader(),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, data: { id: 'user-1', targetCategoryId: 3 } });
    await app.close();
  });

  it('rejects updates to another user mapping', async () => {
    const app = await buildSupplyApp();
    prismaMock.categoryMapping.findFirst.mockResolvedValue(null);

    const response = await app.inject({
      method: 'PUT',
      url: '/api/supply/category-mappings/mapping-2',
      headers: authHeader(),
      payload: {
        sourcePlatform: '1688',
        sourceCategoryName: '鞋子',
        targetCategoryId: 10,
        targetTypeId: 20,
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ code: 0, msg: '类目映射不存在' });
    expect(prismaMock.categoryMapping.update).not.toHaveBeenCalled();
    await app.close();
  });
});

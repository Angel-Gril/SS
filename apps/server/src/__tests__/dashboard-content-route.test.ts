import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dashboardContentRoutes } from '../routes/dashboard-content.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'user-1', role: 'USER' };
  }),
  requireRole: vi.fn(() => async () => undefined),
  blockFindMany: vi.fn(),
  blockCount: vi.fn(),
  blockCreate: vi.fn(),
  blockFindUnique: vi.fn(),
  blockUpdate: vi.fn(),
  blockDelete: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
  requireRole: mocks.requireRole,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    dashboardContentBlock: {
      findMany: mocks.blockFindMany,
      count: mocks.blockCount,
      create: mocks.blockCreate,
      findUnique: mocks.blockFindUnique,
      update: mocks.blockUpdate,
      delete: mocks.blockDelete,
    },
  },
}));

async function buildApp() {
  const app = Fastify();
  await app.register(dashboardContentRoutes, { prefix: '/api/dashboard-content' });
  await app.ready();
  return app;
}

describe('dashboard content routes', () => {
  beforeEach(() => {
    mocks.authenticate.mockImplementation(async (request: any) => {
      request.user = { userId: 'user-1', role: 'USER' };
    });
    mocks.blockFindMany.mockResolvedValue([]);
    mocks.blockCount.mockResolvedValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('returns only active content blocks for the current user role', async () => {
    const now = new Date('2026-07-03T06:00:00.000Z');
    vi.setSystemTime(now);
    mocks.blockFindMany.mockResolvedValue([
      {
        id: 'block-1',
        key: 'ozon-quick-links',
        type: 'QUICK_LINKS',
        title: '快捷入口',
        subtitle: null,
        content: { links: [{ label: '商品管理', href: '/products' }] },
        targetRole: 'ALL',
        enabled: true,
        sortOrder: 10,
        publishedAt: now,
        expiresAt: null,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const app = await buildApp();
    const response = await app.inject({
      method: 'GET',
      url: '/api/dashboard-content',
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.blockFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        enabled: true,
        targetRole: { in: ['ALL', 'USER'] },
        OR: [
          { publishedAt: null },
          { publishedAt: { lte: now } },
        ],
        AND: [
          {
            OR: [
              { expiresAt: null },
              { expiresAt: { gt: now } },
            ],
          },
        ],
      }),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    }));
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        items: [
          {
            key: 'ozon-quick-links',
            type: 'QUICK_LINKS',
            title: '快捷入口',
            content: { links: [{ label: '商品管理', href: '/products' }] },
          },
        ],
      },
    });

    await app.close();
  });

  it('lets admins create managed dashboard content blocks', async () => {
    mocks.authenticate.mockImplementationOnce(async (request: any) => {
      request.user = { userId: 'admin-1', role: 'ADMIN' };
    });
    mocks.blockCreate.mockResolvedValue({
      id: 'block-2',
      key: 'start-steps',
      type: 'STEP_GROUP',
      title: '开店步骤',
      subtitle: null,
      content: { groups: [{ title: '开店前', items: ['绑定店铺'] }] },
      targetRole: 'ALL',
      enabled: true,
      sortOrder: 1,
      publishedAt: null,
      expiresAt: null,
      createdAt: new Date('2026-07-03T06:00:00.000Z'),
      updatedAt: new Date('2026-07-03T06:00:00.000Z'),
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboard-content/admin/create',
      payload: {
        key: 'start-steps',
        type: 'STEP_GROUP',
        title: '开店步骤',
        content: { groups: [{ title: '开店前', items: ['绑定店铺'] }] },
        sortOrder: 1,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(mocks.requireRole).toHaveBeenCalledWith('ADMIN');
    expect(mocks.blockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: 'start-steps',
        type: 'STEP_GROUP',
        title: '开店步骤',
        content: { groups: [{ title: '开店前', items: ['绑定店铺'] }] },
        targetRole: 'ALL',
        enabled: true,
        sortOrder: 1,
        createdBy: 'admin-1',
      }),
    });

    await app.close();
  });

  it('rejects malformed dashboard content blocks', async () => {
    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/dashboard-content/admin/create',
      payload: {
        key: 'bad block',
        type: 'UNKNOWN',
        title: '',
        content: null,
      },
    });

    expect(response.statusCode).toBe(400);
    expect(mocks.blockCreate).not.toHaveBeenCalled();

    await app.close();
  });
});

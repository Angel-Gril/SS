import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { watermarkTemplateRoutes } from '../routes/watermark-template.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'user-1' };
  }),
  shopFindFirst: vi.fn(async () => ({ id: 'shop-1', name: 'BINI' })),
  watermarkFindMany: vi.fn(async (args: any) => {
    const shopIds = Array.isArray(args?.where?.OR)
      ? args.where.OR.map((entry: any) => entry.shopId)
      : [];
    if (!shopIds.includes('BINI')) return [];
    return [
      {
        id: 'tpl-legacy-bini',
        userId: 'user-1',
        shopId: 'BINI',
        name: 'BINI水印',
        type: 'text',
        text: 'BINI',
        imageUrl: null,
        position: 'bottom-right',
        opacity: 50,
        fontSize: 24,
        fontColor: '#ffffff',
        scale: null,
        isDefault: true,
        createdAt: new Date('2026-07-07T00:00:00.000Z'),
        updatedAt: new Date('2026-07-07T00:00:00.000Z'),
      },
    ];
  }),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    shop: {
      findFirst: mocks.shopFindFirst,
    },
    watermarkTemplate: {
      findMany: mocks.watermarkFindMany,
    },
  },
}));

async function buildApp() {
  const app = Fastify();
  await app.register(watermarkTemplateRoutes, { prefix: '/api/watermark-templates' });
  await app.ready();
  return app;
}

describe('watermark template legacy shop binding compatibility', () => {
  it('returns templates whose shopId was saved as the shop name when the workbench sends the real shop id', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/watermark-templates?shopId=shop-1',
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        code: 1,
        data: [{ id: 'tpl-legacy-bini', name: 'BINI水印', shopId: 'BINI' }],
      });
      expect(mocks.shopFindFirst).toHaveBeenCalledWith({
        where: { id: 'shop-1', userId: 'user-1' },
        select: { name: true },
      });
    } finally {
      await app.close();
    }
  });
});

import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { describe, expect, it, vi } from 'vitest';
import { shopRoutes } from '../routes/shop.js';
import { watermarkTemplateRoutes } from '../routes/watermark-template.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'user-1' };
  }),
  shopFindMany: vi.fn(async () => [
    {
      id: 'shop-1',
      platform: 'OZON',
      name: 'Ozon Main',
      clientId: 'client-1',
      status: 'ACTIVE',
      balance: { toString: () => '0' },
      lastSyncAt: null,
      errorMessage: null,
      createdAt: new Date('2026-07-06T00:00:00.000Z'),
      _count: { products: 0, orders: 0 },
    },
  ]),
  watermarkFindMany: vi.fn(async () => [
    {
      id: 'tpl-1',
      userId: 'user-1',
      shopId: null,
      name: 'Default watermark',
      type: 'text',
      text: 'SS ERP',
      imageUrl: null,
      position: 'bottom-right',
      opacity: 50,
      fontSize: 24,
      fontColor: '#ffffff',
      scale: null,
      isDefault: true,
      createdAt: new Date('2026-07-06T00:00:00.000Z'),
      updatedAt: new Date('2026-07-06T00:00:00.000Z'),
    },
  ]),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    shop: {
      findMany: mocks.shopFindMany,
    },
    watermarkTemplate: {
      findMany: mocks.watermarkFindMany,
    },
  },
}));

async function buildApp() {
  const app = Fastify();
  await app.register(rateLimit, { max: 1, timeWindow: '1 minute' });
  app.get('/api/ping', async () => ({ ok: true }));
  await app.register(shopRoutes, { prefix: '/api/shops' });
  await app.register(watermarkTemplateRoutes, { prefix: '/api/watermark-templates' });
  await app.ready();
  return app;
}

describe('extension configuration reads and global rate limiting', () => {
  it('does not rate-limit repeated shop and watermark reads used by the browser workbench', async () => {
    const app = await buildApp();

    try {
      for (let i = 0; i < 3; i += 1) {
        const response = await app.inject({ method: 'GET', url: '/api/shops' });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ code: 1 });
      }

      for (let i = 0; i < 3; i += 1) {
        const response = await app.inject({ method: 'GET', url: '/api/watermark-templates?shopId=shop-1' });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toMatchObject({ code: 1 });
      }

      const firstApiCall = await app.inject({ method: 'GET', url: '/api/ping' });
      expect(firstApiCall.statusCode).toBe(200);

      const secondApiCall = await app.inject({ method: 'GET', url: '/api/ping' });
      expect(secondApiCall.statusCode).toBe(429);
    } finally {
      await app.close();
    }
  });
});

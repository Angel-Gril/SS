import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shopRoutes } from '../routes/shop.js';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(async (request: any) => {
    request.user = { userId: 'user-1' };
  }),
  shopFindFirst: vi.fn(),
  getOzonCdnStorageBackend: vi.fn(),
  uploadBuffer: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  authenticate: mocks.authenticate,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    shop: {
      findFirst: mocks.shopFindFirst,
    },
  },
}));

vi.mock('../services/image-storage.js', () => ({
  getOzonCdnStorageBackend: mocks.getOzonCdnStorageBackend,
}));

async function buildApp() {
  const app = Fastify();
  await app.register(shopRoutes, { prefix: '/api/shops' });
  await app.ready();
  return app;
}

describe('shop Ozon video probe route', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('probes the current user Ozon shop with the stored Ozon CDN auth', async () => {
    mocks.shopFindFirst.mockResolvedValue({ id: 'shop-1', userId: 'user-1', platform: 'OZON' });
    mocks.uploadBuffer.mockResolvedValue({
      url: 'https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/asset_0_h264.mp4',
      filename: 'probe.mp4',
      backend: 'ozon-cdn',
    });
    mocks.getOzonCdnStorageBackend.mockResolvedValue({
      upload: vi.fn(),
      uploadBuffer: mocks.uploadBuffer,
    });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/ozon-video-probe',
      payload: {},
    });

    expect(response.statusCode).toBe(200);
    expect(mocks.shopFindFirst).toHaveBeenCalledWith({
      where: { id: 'shop-1', userId: 'user-1', status: { not: 'DISABLED' } },
    });
    expect(mocks.getOzonCdnStorageBackend).toHaveBeenCalledWith('shop-1');
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        status: 'auto_publish_ready',
        videoAsset: {
          videoId: '01KF0S7TY54CCQ9SZCCMQAM1RS',
        },
      },
    });

    await app.close();
  });

  it('rejects non-Ozon shops before touching the Ozon CDN backend', async () => {
    mocks.shopFindFirst.mockResolvedValue({ id: 'shop-1', userId: 'user-1', platform: 'YANDEX' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/ozon-video-probe',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 0,
      msg: expect.stringContaining('仅支持 OZON'),
    });
    expect(mocks.getOzonCdnStorageBackend).not.toHaveBeenCalled();

    await app.close();
  });

  it('returns a clear message when the shop has no synced cookie or company id', async () => {
    mocks.shopFindFirst.mockResolvedValue({ id: 'shop-1', userId: 'user-1', platform: 'OZON' });
    mocks.getOzonCdnStorageBackend.mockRejectedValue(new Error('目标店铺未同步 OZON CDN cookie/company_id，请通过浏览器扩展同步登录态'));

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/ozon-video-probe',
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      code: 0,
      msg: expect.stringContaining('未同步 OZON CDN cookie/company_id'),
    });

    await app.close();
  });
});

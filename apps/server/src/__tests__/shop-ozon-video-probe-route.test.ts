import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { shopRoutes } from '../routes/shop.js';

const mocks = vi.hoisted(() => {
  const authUser = {
    userId: 'user-1',
    actorUserId: 'user-1',
    role: 'ADMIN',
    isSuperAdmin: true,
    isSubAccount: false,
    tokenUse: 'account_session',
  };
  return {
    authUser,
    authenticate: vi.fn(async (request: any) => {
      request.user = { ...authUser };
    }),
    shopFindFirst: vi.fn(),
    getOzonCdnStorageBackend: vi.fn(),
    uploadBuffer: vi.fn(),
  };
});

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
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' });
  await app.register(shopRoutes, { prefix: '/api/shops' });
  await app.ready();
  return app;
}

describe('shop Ozon video probe route', () => {
  afterEach(() => {
    vi.clearAllMocks();
    Object.assign(mocks.authUser, {
      userId: 'user-1',
      actorUserId: 'user-1',
      role: 'ADMIN',
      isSuperAdmin: true,
      isSubAccount: false,
      tokenUse: 'account_session',
    });
  });

  it('requires a live super-admin account session before looking up the shop', async () => {
    Object.assign(mocks.authUser, { role: 'ADMIN', isSuperAdmin: false });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/ozon-video-probe',
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 0, msg: '需要超级管理员权限' });
    expect(mocks.shopFindFirst).not.toHaveBeenCalled();
    expect(mocks.getOzonCdnStorageBackend).not.toHaveBeenCalled();

    await app.close();
  });

  it('rate limits unauthorized probe bodies before authentication and shop lookup', async () => {
    Object.assign(mocks.authUser, { role: 'USER', isSuperAdmin: false });

    const app = await buildApp();
    try {
      const responses = [];
      for (let i = 0; i < 4; i += 1) {
        responses.push(await app.inject({
          method: 'POST',
          url: '/api/shops/shop-1/ozon-video-probe',
          payload: {},
        }));
      }

      expect(responses.slice(0, 3).map((response) => response.statusCode)).toEqual([403, 403, 403]);
      expect(responses[3]?.statusCode).toBe(429);
      expect(mocks.shopFindFirst).not.toHaveBeenCalled();
      expect(mocks.getOzonCdnStorageBackend).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('rejects legacy extension tokens even when the account is a super-admin', async () => {
    Object.assign(mocks.authUser, { tokenUse: 'legacy_extension' });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/ozon-video-probe',
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'ozon_video_probe_account_session_required',
    });
    expect(mocks.shopFindFirst).not.toHaveBeenCalled();
    expect(mocks.getOzonCdnStorageBackend).not.toHaveBeenCalled();

    await app.close();
  });

  it('rejects subaccount sessions even when the live role flags are inconsistent', async () => {
    Object.assign(mocks.authUser, { isSubAccount: true });

    const app = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/api/shops/shop-1/ozon-video-probe',
      payload: {},
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({
      code: 0,
      errorCode: 'ozon_video_probe_account_session_required',
    });
    expect(mocks.shopFindFirst).not.toHaveBeenCalled();

    await app.close();
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

  it('uses a low route-specific rate limit for repeated diagnostic uploads', async () => {
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
    try {
      const responses = [];
      for (let i = 0; i < 4; i += 1) {
        responses.push(await app.inject({
          method: 'POST',
          url: '/api/shops/shop-1/ozon-video-probe',
          payload: {},
        }));
      }

      expect(responses.slice(0, 3).map((response) => response.statusCode)).toEqual([200, 200, 200]);
      expect(responses[3]?.statusCode).toBe(429);
      expect(responses[3]?.json()).toMatchObject({
        code: 0,
        msg: '视频探针请求过于频繁，请稍后再试',
      });
    } finally {
      await app.close();
    }
  });
});

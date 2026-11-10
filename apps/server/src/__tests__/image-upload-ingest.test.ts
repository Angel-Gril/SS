import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getStorageBackend: vi.fn(),
  getConfig: vi.fn(),
  checkRateLimit: vi.fn(),
  checkDailyQuota: vi.fn(),
  getDailyUsage: vi.fn(),
}));

vi.mock('../services/image-storage.js', () => ({ getStorageBackend: mocks.getStorageBackend }));
vi.mock('../config/system-config-schema.js', () => ({ getConfig: mocks.getConfig }));
vi.mock('../lib/upload-limiter.js', () => ({
  UploadLimiterUnavailableError: class UploadLimiterUnavailableError extends Error {},
  uploadLimiter: {
    checkRateLimit: mocks.checkRateLimit,
    checkDailyQuota: mocks.checkDailyQuota,
    getDailyUsage: mocks.getDailyUsage,
  },
}));

import { storeDataUrlImage } from '../services/image-upload-ingest.js';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('storeDataUrlImage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConfig.mockImplementation(async (key: string) => ({
      upload_rate_limit_enabled: true,
      upload_rate_limit_per_minute: 30,
      upload_daily_quota_enabled: true,
      upload_daily_quota_mb: 500,
    } as Record<string, unknown>)[key]);
    mocks.checkRateLimit.mockResolvedValue(true);
    mocks.checkDailyQuota.mockResolvedValue(true);
    mocks.getDailyUsage.mockResolvedValue(0);
  });

  it('uploads through the shop-aware storage backend and tags the owner', async () => {
    const uploadBuffer = vi.fn(async () => ({ url: 'https://cdn.example.test/a.png', filename: 'a.png', backend: 'oss' }));
    mocks.getStorageBackend.mockResolvedValue({ uploadBuffer });

    const result = await storeDataUrlImage({ ownerUserId: 'owner-1', dataUrl: PNG, filename: 'a.png', shopId: 'shop-1' });

    expect(result).toEqual({ ok: true, data: { url: 'https://cdn.example.test/a.png', filename: 'a.png', backend: 'oss' } });
    expect(mocks.getStorageBackend).toHaveBeenCalledWith('shop-1');
    expect(uploadBuffer).toHaveBeenCalledWith(expect.any(Buffer), 'a.png', 'image/png', { category: 'raw', ownerId: 'owner-1' });
  });

  it('rejects non-image payloads and unsupported types before touching limits or storage', async () => {
    expect(await storeDataUrlImage({ ownerUserId: 'owner-1', dataUrl: 'https://example.test/a.png' }))
      .toMatchObject({ ok: false, statusCode: 400 });
    expect(await storeDataUrlImage({ ownerUserId: 'owner-1', dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' }))
      .toMatchObject({ ok: false, statusCode: 400 });
    expect(mocks.checkRateLimit).not.toHaveBeenCalled();
    expect(mocks.getStorageBackend).not.toHaveBeenCalled();
  });

  it('stops at the rate limit and never calls storage', async () => {
    mocks.checkRateLimit.mockResolvedValue(false);
    const result = await storeDataUrlImage({ ownerUserId: 'owner-1', dataUrl: PNG });
    expect(result).toMatchObject({ ok: false, statusCode: 429 });
    expect(mocks.getStorageBackend).not.toHaveBeenCalled();
  });

  it('reports a storage failure without throwing', async () => {
    mocks.getStorageBackend.mockResolvedValue({ uploadBuffer: vi.fn(async () => { throw new Error('bucket down'); }) });
    const result = await storeDataUrlImage({ ownerUserId: 'owner-1', dataUrl: PNG });
    expect(result).toEqual({ ok: false, statusCode: 500, msg: '上传失败: bucket down' });
  });
});

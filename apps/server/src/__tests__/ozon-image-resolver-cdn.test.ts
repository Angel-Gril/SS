import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadCalls: string[] = [];

vi.mock('../services/image-storage.js', () => ({
  getOzonCdnStorageBackend: vi.fn(async () => ({
    uploadBuffer: async () => {
      uploadCalls.push('ozon-cdn');
      return { url: 'https://ozon-cdn.example.com/direct.jpg', filename: 'direct.jpg', backend: 'ozon-cdn' };
    },
  })),
  getStorageBackend: vi.fn(async () => ({
    uploadBuffer: async () => {
      uploadCalls.push('oss');
      return { url: 'https://app.ss-erp.com/api/cdn/users/u/watermarked/a.jpg', filename: 'a.jpg', backend: 'oss' };
    },
  })),
}));

const { resolveImageUrls } = await import('../services/ozon-image-resolver.js');

describe('ozon image resolver cdn preference', () => {
  beforeEach(async () => {
    uploadCalls.length = 0;
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      url: 'https://ozon-cdn.example.com/direct.jpg',
      headers: {
        get(name: string) {
          if (name === 'content-type') return 'image/jpeg';
          if (name === 'content-length') return '1200';
          return null;
        },
      },
    })));
    await mkdir(join(process.cwd(), 'public', 'uploads'), { recursive: true });
    await writeFile(join(process.cwd(), 'public', 'uploads', 'resolver-cdn-test.jpg'), Buffer.from('fake image'));
  });

  it('uses Ozon CDN for local publish images when requested', async () => {
    await expect(resolveImageUrls(['/uploads/resolver-cdn-test.jpg'], 'shop-1', 'user-1', { preferOzonCdn: true }))
      .resolves.toEqual(['https://ozon-cdn.example.com/direct.jpg']);
    expect(uploadCalls).toEqual(['ozon-cdn']);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(join(process.cwd(), 'public', 'uploads', 'resolver-cdn-test.jpg'), { force: true });
  });
});

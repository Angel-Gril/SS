import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const uploadCalls: string[] = [];
const uploadedMimeTypes: Array<string | undefined> = [];

vi.mock('../services/image-storage.js', () => ({
  getOzonCdnStorageBackend: vi.fn(async () => ({
    uploadBuffer: async (_buffer: Buffer, _filename: string, mimeType?: string) => {
      uploadCalls.push('ozon-cdn');
      uploadedMimeTypes.push(mimeType);
      return { url: 'https://ozon-cdn.example.com/direct.jpg', filename: 'direct.jpg', backend: 'ozon-cdn' };
    },
  })),
  getStorageBackend: vi.fn(async () => ({
    uploadBuffer: async (_buffer: Buffer, _filename: string, mimeType?: string) => {
      uploadCalls.push('oss');
      uploadedMimeTypes.push(mimeType);
      return { url: 'https://app.ss-erp.com/api/cdn/users/u/watermarked/a.jpg', filename: 'a.jpg', backend: 'oss' };
    },
  })),
}));

const { resolveImageUrls } = await import('../services/ozon-image-resolver.js');

describe('ozon image resolver cdn preference', () => {
  beforeEach(async () => {
    uploadCalls.length = 0;
    uploadedMimeTypes.length = 0;
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
    const jpeg = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: '#ffffff',
      },
    }).jpeg().toBuffer();
    await writeFile(join(process.cwd(), 'public', 'uploads', 'resolver-cdn-test.jpg'), jpeg);
  });

  it('uses Ozon CDN for local publish images when requested', async () => {
    await expect(resolveImageUrls(['/uploads/resolver-cdn-test.jpg'], 'shop-1', 'user-1', { preferOzonCdn: true }))
      .resolves.toEqual(['https://ozon-cdn.example.com/direct.jpg']);
    expect(uploadCalls).toEqual(['ozon-cdn']);
  });

  it('transcodes public WebP images before returning Ozon publish URLs', async () => {
    const webp = await sharp({
      create: {
        width: 6,
        height: 6,
        channels: 3,
        background: '#2266aa',
      },
    }).webp().toBuffer();

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
      if (String(url).includes('/api/cdn/users/u/raw/source.jpg')) {
        if (init?.method === 'HEAD') {
          return {
            ok: true,
            status: 200,
            url,
            headers: {
              get(name: string) {
                if (name === 'content-type') return 'image/webp';
                if (name === 'content-length') return String(webp.length);
                return null;
              },
            },
          } as any;
        }
        return {
          ok: true,
          status: 200,
          url,
          arrayBuffer: async () => webp.buffer.slice(webp.byteOffset, webp.byteOffset + webp.byteLength),
          headers: {
            get(name: string) {
              if (name === 'content-type') return 'image/webp';
              if (name === 'content-length') return String(webp.length);
              return null;
            },
          },
        } as any;
      }
      return {
        ok: true,
        status: 200,
        url: String(url),
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'image/jpeg';
            return null;
          },
        },
      } as any;
    }));

    await expect(resolveImageUrls(
      ['https://app.ss-erp.com/api/cdn/users/u/raw/source.jpg'],
      'shop-1',
      'user-1',
      { preferOzonCdn: true },
    )).resolves.toEqual(['https://ozon-cdn.example.com/direct.jpg']);

    expect(uploadCalls).toEqual(['ozon-cdn']);
    expect(uploadedMimeTypes).toEqual(['image/jpeg']);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(join(process.cwd(), 'public', 'uploads', 'resolver-cdn-test.jpg'), { force: true });
  });
});

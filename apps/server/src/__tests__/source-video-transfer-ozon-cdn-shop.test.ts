import { afterEach, describe, expect, it, vi } from 'vitest';

describe('source video transfer shop context', () => {
  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('passes the selected Ozon shop to the storage backend resolver', async () => {
    const video = Buffer.from('mp4 bytes');
    const uploadBuffer = vi.fn(async (_buffer: Buffer, filename: string, _mime?: string) => ({
      url: `https://cdn1.ozone.ru/s3/sc-temporary/demo/${filename}`,
      filename,
      backend: 'ozon-cdn' as const,
    }));
    const getStorageBackend = vi.fn(async (_shopId?: string) => ({
      upload: vi.fn(),
      uploadBuffer,
    }));

    vi.doMock('../services/image-storage.js', () => ({
      getStorageBackend,
    }));

    const { transferSourceProductVideos } = await import('../services/source-video-transfer.js');

    const result = await transferSourceProductVideos({
      sourceVideos: [{ url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/demo.mp4' }],
      sourcePlatform: 'taobao',
      userId: 'user-1',
      shopId: 'shop-1',
      lookup: async () => [{ address: '1.1.1.1', family: 4 }],
      fetchImpl: async (_url: string, init?: { method?: string }) => {
        if (init?.method === 'HEAD') {
          return {
            ok: true,
            status: 200,
            url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/demo.mp4',
            headers: {
              get(name: string) {
                if (name === 'content-type') return 'video/mp4';
                if (name === 'content-length') return String(video.length);
                return null;
              },
            },
          } as any;
        }
        return {
          ok: true,
          status: 200,
          url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/demo.mp4',
          arrayBuffer: async () => video.buffer.slice(video.byteOffset, video.byteOffset + video.byteLength),
          headers: {
            get(name: string) {
              if (name === 'content-type') return 'video/mp4';
              if (name === 'content-length') return String(video.length);
              return null;
            },
          },
        } as any;
      },
    } as any);

    expect(getStorageBackend).toHaveBeenCalledWith('shop-1');
    expect(result.videos[0]).toMatchObject({
      url: 'https://cdn1.ozone.ru/s3/sc-temporary/demo/demo.mp4',
      transferStatus: 'uploaded',
    });
  });

  it('can force the selected Ozon shop CDN backend for publish-time video uploads', async () => {
    const video = Buffer.from('mp4 bytes');
    const uploadBuffer = vi.fn(async (_buffer: Buffer, filename: string, _mime?: string) => ({
      url: `https://cdn1.ozone.ru/s3/sc-temporary/publish/${filename}`,
      filename,
      backend: 'ozon-cdn' as const,
    }));
    const getStorageBackend = vi.fn(async () => {
      throw new Error('generic storage should not be used for publish video');
    });
    const getOzonCdnStorageBackend = vi.fn(async (_shopId: string) => ({
      upload: vi.fn(),
      uploadBuffer,
    }));

    vi.doMock('../services/image-storage.js', () => ({
      getStorageBackend,
      getOzonCdnStorageBackend,
    }));

    const { transferSourceProductVideos } = await import('../services/source-video-transfer.js');

    const result = await transferSourceProductVideos({
      sourceVideos: [{ url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/demo.mp4' }],
      sourcePlatform: 'taobao',
      userId: 'user-1',
      shopId: 'shop-1',
      preferOzonCdn: true,
      lookup: async () => [{ address: '1.1.1.1', family: 4 }],
      fetchImpl: async (_url: string, init?: { method?: string }) => {
        if (init?.method === 'HEAD') {
          return {
            ok: true,
            status: 200,
            url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/demo.mp4',
            headers: {
              get(name: string) {
                if (name === 'content-type') return 'video/mp4';
                if (name === 'content-length') return String(video.length);
                return null;
              },
            },
          } as any;
        }
        return {
          ok: true,
          status: 200,
          url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/demo.mp4',
          arrayBuffer: async () => video.buffer.slice(video.byteOffset, video.byteOffset + video.byteLength),
          headers: {
            get(name: string) {
              if (name === 'content-type') return 'video/mp4';
              if (name === 'content-length') return String(video.length);
              return null;
            },
          },
        } as any;
      },
    } as any);

    expect(getOzonCdnStorageBackend).toHaveBeenCalledWith('shop-1');
    expect(getStorageBackend).not.toHaveBeenCalled();
    expect(result.videos[0]).toMatchObject({
      url: 'https://cdn1.ozone.ru/s3/sc-temporary/publish/demo.mp4',
      transferStatus: 'uploaded',
    });
  });
});

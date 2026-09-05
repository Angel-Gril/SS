import { describe, expect, it, vi } from 'vitest';
import {
  diagnoseSourceVideoUrl,
  transferSourceProductVideos,
} from '../services/source-video-transfer.js';

const publicLookup = async () => [{ address: '1.1.1.1', family: 4 }];

describe('source video transfer', () => {
  it('diagnoses direct mp4 videos as transferable', async () => {
    const result = await diagnoseSourceVideoUrl('https://cdn.example.com/demo.mp4', {
      lookup: publicLookup,
      fetchImpl: async (_url, init) => ({
        ok: true,
        status: init?.method === 'HEAD' ? 200 : 206,
        url: 'https://cdn.example.com/demo.mp4',
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'video/mp4';
            if (name === 'content-length') return '1024';
            return null;
          },
        },
      }) as any,
    });

    expect(result).toMatchObject({
      status: 'direct_video',
      canTransfer: true,
      ozonAutoPublish: false,
      contentType: 'video/mp4',
    });
  });

  it('marks playlists and blocked hosts as not transferable', async () => {
    await expect(diagnoseSourceVideoUrl('https://cdn.example.com/master.m3u8')).resolves.toMatchObject({
      status: 'playlist_unsupported',
      canTransfer: false,
    });

    const blocked = await diagnoseSourceVideoUrl('https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/abc.mp4', {
      lookup: publicLookup,
      fetchImpl: async () => ({
        ok: false,
        status: 490,
        url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/abc.mp4',
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'application/json;charset=UTF-8';
            return null;
          },
        },
      }) as any,
    });

    expect(blocked).toMatchObject({
      status: 'blocked',
      canTransfer: false,
      statusCode: 490,
      contentType: 'application/json;charset=UTF-8',
    });
  });

  it('rejects a private redirect during video diagnosis before a second request', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 302,
      headers: { location: 'http://127.0.0.1:3001/internal' },
    }));

    const result = await diagnoseSourceVideoUrl('https://cdn.example.com/demo.mp4', {
      fetchImpl: fetchImpl as any,
      lookup: publicLookup,
    });

    expect(result).toMatchObject({ status: 'error', canTransfer: false });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('recognizes Ozon CDN videos as already auto-publishable', async () => {
    const result = await diagnoseSourceVideoUrl(
      'https://cdnvideo.v.ozone.ru/vod/video-64/01KF0S7TY54CCQ9SZCCMQAM1RS/asset_0_h264.mp4?type=pdp',
    );

    expect(result).toMatchObject({
      status: 'ozon_cdn_ready',
      canTransfer: false,
      ozonAutoPublish: true,
    });
  });

  it('uploads direct mp4 videos to OSS-compatible storage and records diagnostics', async () => {
    const video = Buffer.from('fake mp4 bytes');
    const uploadBuffer = vi.fn(async (_buffer: Buffer, filename: string, _mimeType?: string) => ({
      url: `https://app.ss-erp.com/api/cdn/users/user-1/video/${filename}`,
      filename,
      backend: 'oss' as const,
    }));

    const result = await transferSourceProductVideos({
      sourceVideos: [{ url: 'https://cdn.example.com/demo.mp4', coverUrl: 'https://cdn.example.com/cover.jpg' }],
      sourcePlatform: '1688',
      userId: 'user-1',
      lookup: publicLookup,
      fetchImpl: async (_url, init) => {
        if (init?.method === 'HEAD') {
          return {
            ok: true,
            status: 200,
            url: 'https://cdn.example.com/demo.mp4',
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
          url: 'https://cdn.example.com/demo.mp4',
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
      storageBackend: {
        upload: vi.fn(),
        uploadBuffer,
      },
    });

    expect(uploadBuffer).toHaveBeenCalledWith(
      video,
      'demo.mp4',
      'video/mp4',
      { category: 'video', ownerId: 'user-1' },
    );
    expect(result.videos[0]).toMatchObject({
      url: 'https://app.ss-erp.com/api/cdn/users/user-1/video/demo.mp4',
      originalUrl: 'https://cdn.example.com/demo.mp4',
      transferStatus: 'uploaded',
    });
    expect(result.diagnostic).toMatchObject({
      attempted: 1,
      transferred: 1,
      skipped: 0,
      entries: [
        expect.objectContaining({
          originalUrl: 'https://cdn.example.com/demo.mp4',
          status: 'uploaded',
          contentType: 'video/mp4',
        }),
      ],
    });
  });

  it('records source download timeouts separately from generic transfer failures', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'AbortError' });

    const result = await transferSourceProductVideos({
      sourceVideos: [{ url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/demo.mp4' }],
      sourcePlatform: '1688',
      userId: 'user-1',
      lookup: publicLookup,
      fetchImpl: async (_url, init) => {
        if (init?.method === 'HEAD') {
          return {
            ok: true,
            status: 200,
            url: 'https://caiyuanbao.alicdn.com/demo.mp4',
            headers: {
              get(name: string) {
                if (name === 'content-type') return 'video/mp4';
                if (name === 'content-length') return '1712183';
                return null;
              },
            },
          } as any;
        }
        throw timeout;
      },
      storageBackend: {
        upload: vi.fn(),
        uploadBuffer: vi.fn(),
      },
    });

    expect(result.videos[0]).toMatchObject({
      transferStatus: 'failed',
      transferReason: 'download_timeout',
    });
    expect(result.diagnostic).toMatchObject({
      attempted: 1,
      transferred: 0,
      entries: [
        expect.objectContaining({
          status: 'failed',
          reason: 'download_timeout',
          contentType: 'video/mp4',
          contentLength: '1712183',
        }),
      ],
    });
  });

  it('retries transient full video download failures before marking transfer failed', async () => {
    const video = Buffer.from('retry succeeds');
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'AbortError' });
    const uploadBuffer = vi.fn(async (_buffer: Buffer, filename: string, _mimeType?: string) => ({
      url: `https://app.ss-erp.com/api/cdn/users/user-1/video/${filename}`,
      filename,
      backend: 'oss' as const,
    }));
    const fullDownloadUrls: string[] = [];

    const result = await transferSourceProductVideos({
      sourceVideos: [{ url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/demo.mp4' }],
      sourcePlatform: '1688',
      userId: 'user-1',
      lookup: publicLookup,
      fetchImpl: async (url, init) => {
        if (init?.method === 'HEAD') {
          return {
            ok: true,
            status: 200,
            url: 'https://caiyuanbao.alicdn.com/demo.mp4?auth_key=retry',
            headers: {
              get(name: string) {
                if (name === 'content-type') return 'video/mp4';
                if (name === 'content-length') return String(video.length);
                return null;
              },
            },
          } as any;
        }
        fullDownloadUrls.push(url);
        if (fullDownloadUrls.length === 1) throw timeout;
        return {
          ok: true,
          status: 200,
          url,
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
      storageBackend: {
        upload: vi.fn(),
        uploadBuffer,
      },
    });

    expect(fullDownloadUrls).toEqual([
      'https://caiyuanbao.alicdn.com/demo.mp4?auth_key=retry',
      'https://caiyuanbao.alicdn.com/demo.mp4?auth_key=retry',
    ]);
    expect(uploadBuffer).toHaveBeenCalledWith(video, 'demo.mp4', 'video/mp4', { category: 'video', ownerId: 'user-1' });
    expect(result.videos[0]).toMatchObject({
      transferStatus: 'uploaded',
      transferReason: 'direct_video',
      originalUrl: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/demo.mp4',
    });
  });

  it('falls back to ranged downloads when repeated full downloads time out', async () => {
    const video = Buffer.concat([
      Buffer.alloc(1024 * 1024, 1),
      Buffer.from('tail'),
    ]);
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'AbortError' });
    const uploadBuffer = vi.fn(async (_buffer: Buffer, filename: string, _mimeType?: string) => ({
      url: `https://app.ss-erp.com/api/cdn/users/user-1/video/${filename}`,
      filename,
      backend: 'oss' as const,
    }));
    const rangeHeaders: string[] = [];
    let fullAttempts = 0;

    const result = await transferSourceProductVideos({
      sourceVideos: [{ url: 'https://cloud.video.taobao.com/play/u/1/p/2/e/6/t/1/ranged.mp4' }],
      sourcePlatform: '1688',
      userId: 'user-1',
      lookup: publicLookup,
      fetchImpl: async (url, init) => {
        if (init?.method === 'HEAD') {
          return {
            ok: true,
            status: 200,
            url: 'https://caiyuanbao.alicdn.com/ranged.mp4?auth_key=range',
            headers: {
              get(name: string) {
                if (name === 'content-type') return 'video/mp4';
                if (name === 'content-length') return String(video.length);
                return null;
              },
            },
          } as any;
        }
        const range = init?.headers?.range || init?.headers?.Range || '';
        if (!range) {
          fullAttempts += 1;
          throw timeout;
        }
        rangeHeaders.push(String(range));
        const match = String(range).match(/^bytes=(\d+)-(\d+)$/);
        if (!match) throw new Error('unexpected range header');
        const start = Number(match[1]);
        const end = Number(match[2]);
        const chunk = video.subarray(start, end + 1);
        return {
          ok: true,
          status: 206,
          url,
          arrayBuffer: async () => chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength),
          headers: {
            get(name: string) {
              if (name === 'content-type') return 'video/mp4';
              if (name === 'content-length') return String(chunk.length);
              if (name === 'content-range') return `bytes ${start}-${end}/${video.length}`;
              return null;
            },
          },
        } as any;
      },
      storageBackend: {
        upload: vi.fn(),
        uploadBuffer,
      },
    });

    expect(fullAttempts).toBeGreaterThanOrEqual(2);
    expect(rangeHeaders).toEqual([
      'bytes=0-1048575',
      `bytes=1048576-${video.length - 1}`,
    ]);
    expect(uploadBuffer).toHaveBeenCalledWith(video, 'ranged.mp4', 'video/mp4', { category: 'video', ownerId: 'user-1' });
    expect(result.videos[0]).toMatchObject({
      transferStatus: 'uploaded',
      transferReason: 'direct_video',
    });
  }, 10_000);
});

import { describe, expect, it } from 'vitest';
import {
  diagnoseOzonImageUrl,
  normalizeOzonPublishImageUrl,
  resolveImageUrls,
  waitForOzonImageReady,
} from '../services/ozon-image-resolver.js';

describe('ozon image resolver', () => {
  it('normalizes public image URLs before publishing', () => {
    expect(normalizeOzonPublishImageUrl(' //cdn.example.com/a b.jpg ')).toBe('https://cdn.example.com/a%20b.jpg');
  });

  it('upgrades Ozon resized thumbnail URLs to original image URLs before publishing', () => {
    expect(normalizeOzonPublishImageUrl('https://ir.ozone.ru/s3/multimedia-1-f/wc140/10231611531.jpg')).toBe(
      'https://ir.ozone.ru/s3/multimedia-1-f/10231611531.jpg',
    );
    expect(normalizeOzonPublishImageUrl('https://ir-2.ozonstatic.cn/s3/multimedia-1-f/wc140/10231611531.jpg')).toBe(
      'https://ir-2.ozonstatic.cn/s3/multimedia-1-f/10231611531.jpg',
    );
  });

  it('rejects local and private image URLs before OZON import', () => {
    expect(() => normalizeOzonPublishImageUrl('http://localhost:3001/uploads/a.jpg')).toThrow('不是公网地址');
    expect(() => normalizeOzonPublishImageUrl('http://127.0.0.1:3001/uploads/a.jpg')).toThrow('不是公网地址');
    expect(() => normalizeOzonPublishImageUrl('http://[::1]:3001/uploads/a.jpg')).toThrow('不是公网地址');
    expect(() => normalizeOzonPublishImageUrl('http://192.168.1.8/uploads/a.jpg')).toThrow('不是公网地址');
  });

  it('rejects unsupported URL schemes and empty values', () => {
    expect(() => normalizeOzonPublishImageUrl('')).toThrow('图片 URL 为空');
    expect(() => normalizeOzonPublishImageUrl('data:image/png;base64,abc')).toThrow('必须是 http/https');
    expect(() => normalizeOzonPublishImageUrl('/uploads/a.jpg')).toThrow('格式非法');
  });

  it('drops blank image entries while resolving publish images', async () => {
    await expect(resolveImageUrls(['', '  ', 'https://cdn.example.com/a.jpg'], 'shop-1')).resolves.toEqual([
      'https://cdn.example.com/a.jpg',
    ]);
  });

  it('diagnoses whether a public image URL is fetchable by status and content type', async () => {
    const result = await diagnoseOzonImageUrl('https://cdn.example.com/a.jpg', async () => ({
      ok: true,
      status: 200,
      url: 'https://cdn.example.com/final.jpg',
      headers: {
        get(name: string) {
          if (name === 'content-type') return 'image/jpeg';
          if (name === 'content-length') return '1200';
          return null;
        },
      },
    }) as any);

    expect(result).toEqual({
      ok: true,
      status: 200,
      contentType: 'image/jpeg',
      contentLength: '1200',
      finalUrl: 'https://cdn.example.com/final.jpg',
    });
  });

  it('falls back to GET when HEAD does not expose an image response', async () => {
    const methods: string[] = [];
    const result = await diagnoseOzonImageUrl('https://cdn.example.com/a.jpg', async (_url, init) => {
      methods.push(init?.method || 'GET');
      if (init?.method === 'HEAD') {
        return {
          ok: false,
          status: 405,
          url: 'https://cdn.example.com/a.jpg',
          headers: { get: () => null },
        } as any;
      }
      return {
        ok: true,
        status: 206,
        url: 'https://cdn.example.com/a.jpg',
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'image/webp';
            if (name === 'content-length') return '20';
            return null;
          },
        },
      } as any;
    });

    expect(methods).toEqual(['HEAD', 'GET']);
    expect(result.ok).toBe(true);
    expect(result.contentType).toBe('image/webp');
  });

  it('retries public image readiness before handing uploaded images to Ozon', async () => {
    let attempts = 0;
    const result = await waitForOzonImageReady('https://cdn.example.com/a.jpg', {
      attempts: 3,
      delayMs: 0,
      fetchImpl: async () => {
        attempts += 1;
        return {
          ok: attempts === 3,
          status: attempts === 3 ? 200 : 404,
          url: 'https://cdn.example.com/a.jpg',
          headers: {
            get(name: string) {
              if (attempts === 3 && name === 'content-type') return 'image/jpeg';
              return null;
            },
          },
        } as any;
      },
    });

    expect(attempts).toBe(3);
    expect(result.ok).toBe(true);
  });

  it('explains rate-limited public image checks clearly', async () => {
    await expect(waitForOzonImageReady('https://app.ss-erp.com/api/cdn/users/u/raw/a.jpg', {
      attempts: 1,
      delayMs: 0,
      fetchImpl: async () => ({
        ok: false,
        status: 429,
        url: 'https://app.ss-erp.com/api/cdn/users/u/raw/a.jpg',
        headers: {
          get(name: string) {
            if (name === 'content-type') return 'application/json';
            return null;
          },
        },
      }) as any,
    })).rejects.toThrow('图片代理或上游限流');
  });
});

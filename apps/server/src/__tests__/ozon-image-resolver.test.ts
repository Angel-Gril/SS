import { describe, expect, it } from 'vitest';
import { normalizeOzonPublishImageUrl, resolveImageUrls } from '../services/ozon-image-resolver.js';

describe('ozon image resolver', () => {
  it('normalizes public image URLs before publishing', () => {
    expect(normalizeOzonPublishImageUrl(' //cdn.example.com/a b.jpg ')).toBe('https://cdn.example.com/a%20b.jpg');
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
});

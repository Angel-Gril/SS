import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FallbackStorageBackend, type ImageStorageBackend, type ImageUploadResult } from '../services/image-storage.js';

function makeMockBackend(name: string, shouldFail = false, supportsPresign = false): ImageStorageBackend {
  const backend = name === 'cdn' ? 'ozon-cdn' : 'oss';
  return {
    async upload(_filePath: string): Promise<ImageUploadResult> {
      if (shouldFail) throw new Error(`${name} upload failed`);
      return { url: `https://${name}.example.com/img.jpg`, filename: 'img.jpg', backend };
    },
    async uploadBuffer(_buffer: Buffer, filename: string): Promise<ImageUploadResult> {
      if (shouldFail) throw new Error(`${name} uploadBuffer failed`);
      return { url: `https://${name}.example.com/${filename}`, filename, backend };
    },
    ...(supportsPresign ? {
      async getPresignedPutUrl() {
        if (shouldFail) throw new Error(`${name} presign failed`);
        return {
          uploadUrl: `https://${name}.example.com/upload`,
          finalUrl: `https://${name}.example.com/final.jpg`,
          key: `${name}/final.jpg`,
          objectKey: `${name}/final.jpg`,
          expiresIn: 300,
          maxBytes: 1024,
          headers: { 'Content-Type': 'image/jpeg' },
        };
      },
    } satisfies Partial<ImageStorageBackend> : {}),
  };
}

describe('FallbackStorageBackend', () => {
  beforeEach(() => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('uses primary backend when it succeeds', async () => {
    const primary = makeMockBackend('oss');
    const fallback = makeMockBackend('cdn');
    const backend = new FallbackStorageBackend(primary, fallback, 'OSS', 'CDN');

    const result = await backend.uploadBuffer(Buffer.from('test'), 'photo.jpg');
    expect(result.url).toContain('oss.example.com');
  });

  it('falls back to secondary when primary fails', async () => {
    const primary = makeMockBackend('oss', true);
    const fallback = makeMockBackend('cdn');
    const backend = new FallbackStorageBackend(primary, fallback, 'OSS', 'CDN');

    const result = await backend.uploadBuffer(Buffer.from('test'), 'photo.jpg');
    expect(result.url).toContain('cdn.example.com');
  });

  it('throws when both primary and fallback fail', async () => {
    const primary = makeMockBackend('oss', true);
    const fallback = makeMockBackend('cdn', true);
    const backend = new FallbackStorageBackend(primary, fallback, 'OSS', 'CDN');

    await expect(backend.uploadBuffer(Buffer.from('test'), 'photo.jpg')).rejects.toThrow('cdn uploadBuffer failed');
  });

  it('falls back on upload() method too', async () => {
    const primary = makeMockBackend('oss', true);
    const fallback = makeMockBackend('cdn');
    const backend = new FallbackStorageBackend(primary, fallback, 'OSS', 'CDN');

    const result = await backend.upload('/tmp/photo.jpg');
    expect(result.url).toContain('cdn.example.com');
  });

  it('uses primary presigned URL when it succeeds', async () => {
    const primary = makeMockBackend('oss', false, true);
    const fallback = makeMockBackend('cdn', false, true);
    const backend = new FallbackStorageBackend(primary, fallback, 'OSS', 'CDN');

    const result = await backend.getPresignedPutUrl({
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      maxBytes: 1024,
    });

    expect(result.finalUrl).toContain('oss.example.com');
  });

  it('falls back on presign when fallback supports it', async () => {
    const primary = makeMockBackend('oss', true, true);
    const fallback = makeMockBackend('cdn', false, true);
    const backend = new FallbackStorageBackend(primary, fallback, 'OSS', 'CDN');

    const result = await backend.getPresignedPutUrl({
      filename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 100,
      maxBytes: 1024,
    });

    expect(result.finalUrl).toContain('cdn.example.com');
  });
});

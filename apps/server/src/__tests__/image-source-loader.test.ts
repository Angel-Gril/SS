import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  createImageSourceLoader,
  createOwnedLocalImageReader,
} from '../services/image-source-loader.js';

describe('bounded image source loader', () => {
  it('passes limits to the public downloader and accepts bounded image metadata', async () => {
    const download = vi.fn(async () => ({
      sourceUrl: 'https://img.example/a.jpg',
      finalUrl: 'https://cdn.example/a.jpg',
      contentType: 'image/jpeg',
      buffer: Buffer.from('image'),
      redirectCount: 1,
    }));
    const inspect = vi.fn(async () => ({ width: 1000, height: 800, format: 'jpeg' }));
    const load = createImageSourceLoader({ download, inspect });

    await expect(load('https://img.example/a.jpg')).resolves.toMatchObject({
      finalUrl: 'https://cdn.example/a.jpg',
      width: 1000,
      height: 800,
    });
    expect(download).toHaveBeenCalledWith('https://img.example/a.jpg', expect.objectContaining({
      maxBytes: expect.any(Number),
      maxRedirects: expect.any(Number),
      timeoutMs: expect.any(Number),
    }));
  });

  it('keeps protocol-relative CDN URLs on the public downloader path', async () => {
    const download = vi.fn(async (rawUrl: string) => ({
      sourceUrl: `https:${rawUrl}`,
      finalUrl: `https:${rawUrl}`,
      contentType: 'image/jpeg',
      buffer: Buffer.from('image'),
      redirectCount: 0,
    }));
    const readLocal = vi.fn();
    const load = createImageSourceLoader({
      download,
      readLocal,
      inspect: async () => ({ width: 640, height: 480, format: 'jpeg' }),
    });

    await expect(load('//cdn.example/owned.jpg')).resolves.toMatchObject({ width: 640, height: 480 });
    expect(download).toHaveBeenCalled();
    expect(readLocal).not.toHaveBeenCalled();
  });

  it('rejects oversized or missing pixel metadata', async () => {
    const download = async () => ({
      sourceUrl: 'https://img.example/a.jpg',
      finalUrl: 'https://img.example/a.jpg',
      contentType: 'image/jpeg',
      buffer: Buffer.from('image'),
      redirectCount: 0,
    });

    await expect(createImageSourceLoader({
      download,
      inspect: async () => ({ width: 20000, height: 20000, format: 'jpeg' }),
    })('https://img.example/a.jpg')).rejects.toThrow(/dimensions|pixels/u);

    await expect(createImageSourceLoader({
      download,
      inspect: async () => ({ width: undefined, height: undefined, format: undefined }),
    })('https://img.example/a.jpg')).rejects.toThrow(/metadata/u);
  });

  it('reads only an explicitly owned local image path without using the public downloader', async () => {
    const download = vi.fn();
    const readLocal = vi.fn(async () => ({
      sourceUrl: '/uploads/owned.jpg',
      finalUrl: '/uploads/owned.jpg',
      contentType: 'image/jpeg',
      buffer: Buffer.from('local-image'),
      redirectCount: 0,
    }));
    const load = createImageSourceLoader({
      download,
      readLocal,
      inspect: async () => ({ width: 640, height: 480, format: 'jpeg' }),
    });

    await expect(load('/uploads/owned.jpg')).resolves.toMatchObject({ width: 640, height: 480 });
    expect(readLocal).toHaveBeenCalledWith('/uploads/owned.jpg', expect.any(Number));
    expect(download).not.toHaveBeenCalled();
    await expect(load('/uploads/../secret.txt')).rejects.toThrow(/local image path/u);
  });

  it('bounds real owned files beneath an explicit local storage root', async () => {
    const taskRoot = mkdtempSync(join(tmpdir(), 'ss-erp-local-image-reader-'));
    const publicRoot = join(taskRoot, 'public');
    const uploadRoot = join(publicRoot, 'uploads');
    mkdirSync(uploadRoot, { recursive: true });
    writeFileSync(join(uploadRoot, 'owned.jpg'), Buffer.from('owned-image'));
    const readLocal = createOwnedLocalImageReader(publicRoot);

    try {
      await expect(readLocal('/uploads/owned.jpg', 100)).resolves.toMatchObject({
        finalUrl: '/uploads/owned.jpg',
        contentType: 'image/jpeg',
      });
      await expect(readLocal('/uploads/owned.jpg', 4)).rejects.toThrow(/exceeds 4 bytes/u);
      await expect(readLocal('/uploads/../secret.txt', 100)).rejects.toThrow(/local image path/u);
    } finally {
      rmSync(taskRoot, { recursive: true, force: true });
    }
  });
});

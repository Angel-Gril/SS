import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  isLikelyNonImageMediaUrl,
  sanitizeOzonPublishImageBuffer,
} from '../services/ozon-image-sanitizer.js';

describe('ozon image sanitizer', () => {
  it('detects video and playlist URLs before they enter Ozon image fields', () => {
    expect(isLikelyNonImageMediaUrl('https://cloud.video.taobao.com/play/demo.mp4')).toBe(true);
    expect(isLikelyNonImageMediaUrl('https://cdn.example.com/video/master.m3u8?token=1')).toBe(true);
    expect(isLikelyNonImageMediaUrl('https://cdn.example.com/product.webp')).toBe(false);
    expect(isLikelyNonImageMediaUrl('https://cdn.example.com/product.jpg')).toBe(false);
  });

  it('converts WebP images to JPEG for Ozon publish compatibility', async () => {
    const webp = await sharp({
      create: {
        width: 8,
        height: 8,
        channels: 4,
        background: { r: 20, g: 80, b: 140, alpha: 0.7 },
      },
    }).webp().toBuffer();

    const result = await sanitizeOzonPublishImageBuffer(webp, 'source.webp', 'image/webp');

    expect(result.mimeType).toBe('image/jpeg');
    expect(result.filename).toBe('source.jpg');
    expect(result.converted).toBe(true);

    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe('jpeg');
  });

  it('keeps JPEG and PNG images in their original Ozon-compatible formats', async () => {
    const png = await sharp({
      create: {
        width: 4,
        height: 4,
        channels: 3,
        background: '#ffffff',
      },
    }).png().toBuffer();

    const result = await sanitizeOzonPublishImageBuffer(png, 'source.png', 'image/png');

    expect(result.mimeType).toBe('image/png');
    expect(result.filename).toBe('source.png');
    expect(result.converted).toBe(false);
  });
});

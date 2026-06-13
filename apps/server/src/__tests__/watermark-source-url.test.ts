import { describe, expect, it } from 'vitest';
import { normalizeWatermarkSourceUrl } from '../services/watermark.js';

describe('watermark source url normalization', () => {
  it('uses original Ozon images before applying watermarks', () => {
    expect(normalizeWatermarkSourceUrl('https://ir.ozone.ru/s3/multimedia-1-f/wc140/10231611531.jpg')).toBe(
      'https://ir.ozone.ru/s3/multimedia-1-f/10231611531.jpg',
    );
  });

  it('keeps local watermark paths untouched', () => {
    expect(normalizeWatermarkSourceUrl('/uploads/source.jpg')).toBe('/uploads/source.jpg');
  });
});

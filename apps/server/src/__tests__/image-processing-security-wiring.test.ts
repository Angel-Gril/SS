import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('image processing security wiring', () => {
  it('routes upload, watermark and resize URL reads through the bounded loader', () => {
    const route = readFileSync(new URL('../routes/image-upload.ts', import.meta.url), 'utf8');
    const watermark = readFileSync(new URL('../services/watermark.ts', import.meta.url), 'utf8');
    const collect = readFileSync(new URL('../routes/collect.ts', import.meta.url), 'utf8');
    const product = readFileSync(new URL('../routes/product.ts', import.meta.url), 'utf8');

    expect(route).toContain('loadBoundedImageSource');
    expect(route).toContain('parseBatchResizeInput');
    expect(route).toContain('parseWatermarkBatchInput');
    expect(route).not.toContain('lookup(hostname');
    expect(route).not.toContain('Buffer.from(await res.arrayBuffer())');
    expect(watermark).toContain('loadBoundedImageSource');
    expect(watermark).toContain('parseWatermarkImageUrls');
    expect(watermark).toContain('parseWatermarkConfig');
    expect(watermark).not.toMatch(/\bfetch\s*\(/u);
    expect(watermark).not.toContain('arrayBuffer()');
    expect(collect).toContain('parseCollectWatermarkInput');
    expect(product).toContain('parseWatermarkConfig');
  });
});

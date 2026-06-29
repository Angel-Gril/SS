import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('collect publish image storage defaults', () => {
  it('does not force Ozon CDN for collect publish image uploads', () => {
    const source = readFileSync(new URL('../routes/collect.ts', import.meta.url), 'utf8');

    const imageUploadCalls = Array.from(source.matchAll(/resolveImageUrls\([\s\S]*?\)/g)).map((match) => match[0]);

    expect(imageUploadCalls.length).toBeGreaterThan(0);
    for (const call of imageUploadCalls) {
      expect(call).not.toContain('preferOzonCdn');
    }
  });

  it('does not force Ozon CDN for domestic source video publish transfers', () => {
    const source = readFileSync(new URL('../routes/collect.ts', import.meta.url), 'utf8');

    const videoTransferCalls = Array.from(source.matchAll(/transferSourceProductVideos\(\{[\s\S]*?\}\)/g))
      .map((match) => match[0]);

    expect(videoTransferCalls.length).toBeGreaterThan(0);
    for (const call of videoTransferCalls) {
      expect(call).not.toContain('preferOzonCdn');
    }
  });
});

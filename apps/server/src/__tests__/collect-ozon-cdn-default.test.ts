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

  it('allows domestic source videos to force Ozon CDN only at publish time', () => {
    const source = readFileSync(new URL('../routes/collect.ts', import.meta.url), 'utf8');

    expect(source).toContain('transferSourceProductVideos({');
    expect(source).toContain('preferOzonCdn: true');
  });
});

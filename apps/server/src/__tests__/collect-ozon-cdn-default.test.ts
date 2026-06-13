import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

describe('collect publish image storage defaults', () => {
  it('does not force Ozon CDN for collect publish image uploads', () => {
    const source = readFileSync(new URL('../routes/collect.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('preferOzonCdn: true');
  });
});

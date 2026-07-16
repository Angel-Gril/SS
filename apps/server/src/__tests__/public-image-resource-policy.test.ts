import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('public image resource policy', () => {
  it('allows the Web origin to render API-hosted local image assets', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    expect(source).toContain("reply.header('Cross-Origin-Resource-Policy', 'cross-origin')");
    expect(source.match(/setPublicImageHeaders\(reply\)/gu)).toHaveLength(3);
  });
});

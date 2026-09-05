import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('database seed safety', () => {
  it('does not create or print a fixed administrator credential', () => {
    const source = readFileSync(new URL('../../prisma/seed.ts', import.meta.url), 'utf8');

    expect(source).not.toContain('admin123456');
    expect(source).not.toContain('13800000000');
    expect(source).not.toMatch(/prisma\.user\.(?:create|upsert)\s*\(/u);
    expect(source).not.toContain('bcrypt');
  });
});

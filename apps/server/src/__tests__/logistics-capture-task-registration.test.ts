import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('logistics capture route registration', () => {
  it('mounts admin issuance and device capture once behind the distribution flag', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../index.ts'), 'utf8');
    expect(source.match(/app\.register\(adminLogisticsCaptureTaskRoutes/g)).toHaveLength(1);
    expect(source.match(/app\.register\(logisticsCaptureTaskRoutes/g)).toHaveLength(1);
    expect(source).toContain("requiredScopes: ['logistics:capture']");
  });
});

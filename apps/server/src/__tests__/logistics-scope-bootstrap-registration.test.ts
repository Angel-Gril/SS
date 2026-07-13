import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('logistics scope bootstrap route registration', () => {
  it('mounts super-admin and device probe routes inside the logistics feature block', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../index.ts'), 'utf8');
    expect(source.match(/app\.register\(adminLogisticsScopeBootstrapRoutes/g)).toHaveLength(1);
    expect(source.match(/app\.register\(logisticsScopeBootstrapDeviceRoutes/g)).toHaveLength(1);
    expect(source).toContain("prefix: '/api/admin/logistics-rules'");
    expect(source).toContain("prefix: '/api/logistics-rules'");
    expect(source).toContain("requiredScopes: ['logistics:capture']");
    expect(source).toContain('createPrismaLogisticsScopeBootstrapRepository');
    expect(source).toContain('createLogisticsScopeBootstrapService');
  });
});

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('logistics rule device route registration', () => {
  it('mounts the real scoped distribution repository once behind the feature flag', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../index.ts'), 'utf8');
    const featureBlock = source.slice(
      source.indexOf('if (isLogisticsDistributionEnabled())'),
      source.indexOf("await app.register(setupRoutes"),
    );

    expect(source.match(/logisticsRuleRoutes/g)).toHaveLength(2);
    expect(source.match(/createPrismaLogisticsRuleDeviceRepository/g)).toHaveLength(2);
    expect(featureBlock.match(/app\.register\(logisticsRuleRoutes/g)).toHaveLength(1);
    expect(featureBlock).toContain("prefix: '/api/logistics-rules'");
    expect(featureBlock).toContain("requiredScopes: ['logistics:discover']");
    expect(featureBlock).toContain("requiredScopes: ['logistics:read']");
    expect(featureBlock).toContain("requiredScopes: ['logistics:receipt']");
    expect(featureBlock).toContain('createPrismaLogisticsRuleDeviceRepository');
    expect(featureBlock).toContain('extensionDeviceRepository.loadAuthorization');
    expect(featureBlock.indexOf('logisticsRuleRoutes')).toBeLessThan(
      featureBlock.indexOf('logisticsCaptureTaskRoutes'),
    );
  });
});

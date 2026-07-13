import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('admin logistics rule registration', () => {
  it('mounts the real Prisma admin service exactly once behind the logistics feature flag', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');

    expect(source.match(/adminLogisticsRuleRoutes/g)).toHaveLength(2);
    expect(source.match(/createPrismaLogisticsRuleAdminRepository/g)).toHaveLength(2);
    expect(source.match(/createLogisticsRuleAdminService/g)).toHaveLength(2);
    expect(source.match(/adminLogisticsInputUnitContractRoutes/g)).toHaveLength(2);
    expect(source.match(/createPrismaOfficialInputUnitContractRepository/g)).toHaveLength(2);
    expect(source.match(/createOfficialInputUnitContractService/g)).toHaveLength(2);

    const featureBlock = source.slice(
      source.indexOf('if (isLogisticsDistributionEnabled())'),
      source.indexOf("await app.register(setupRoutes"),
    );
    expect(featureBlock.match(/app\.register\(adminLogisticsRuleRoutes/g)).toHaveLength(1);
    expect(featureBlock.match(/app\.register\(adminLogisticsCaptureTaskRoutes/g)).toHaveLength(1);
    expect(featureBlock.match(/app\.register\(adminLogisticsScopeBootstrapRoutes/g)).toHaveLength(1);
    expect(featureBlock.match(/app\.register\(adminLogisticsInputUnitContractRoutes/g)).toHaveLength(1);
    expect(featureBlock.match(/prefix: '\/api\/admin\/logistics-rules'/g)).toHaveLength(4);
    expect(featureBlock).toContain('adminLogisticsRuleRoutes');
    expect(featureBlock).toContain('adminLogisticsCaptureTaskRoutes');
    expect(featureBlock).toContain('adminLogisticsScopeBootstrapRoutes');
    expect(featureBlock).toContain('adminLogisticsInputUnitContractRoutes');
    expect(featureBlock).toContain('createPrismaLogisticsRuleAdminRepository');
    expect(featureBlock).toContain('createLogisticsRuleAdminService');
    expect(featureBlock).toContain('createPrismaOfficialInputUnitContractRepository');
    expect(featureBlock).toContain('createOfficialInputUnitContractService');
  });
});

import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import {
  OZON_V3_IMPORT_PACKAGE_CONTRACT,
  OZON_V3_IMPORT_PACKAGE_REQUIREMENTS,
  validateOzonV3ImportPackageFacts,
} from '../services/ozon-v3-import-package-contract.js';

describe('Ozon V3 import package contract', () => {
  it('has stable versioned metadata and operational requirement flags', () => {
    expect(OZON_V3_IMPORT_PACKAGE_CONTRACT).toMatchObject({
      contractId: 'ss-erp/ozon-v3-product-import/package',
      revision: '1',
      endpoint: '/v3/product/import',
      units: { weight: 'g', dimensions: 'mm' },
      operationalRequirements: {
        packageWeightForImport: true,
        packageDimensionsForImport: true,
      },
    });
    expect(OZON_V3_IMPORT_PACKAGE_REQUIREMENTS).toBe(
      OZON_V3_IMPORT_PACKAGE_CONTRACT.operationalRequirements,
    );
    expect(OZON_V3_IMPORT_PACKAGE_CONTRACT.contractHash).toBe(
      '657698ccb8f2a72d6f039a8e8ef1190a9212727d12027cdf794302816019c58e',
    );
    expect(OZON_V3_IMPORT_PACKAGE_CONTRACT.contractHash).toBe(
      createHash('sha256').update(JSON.stringify({
        contractId: OZON_V3_IMPORT_PACKAGE_CONTRACT.contractId,
        revision: OZON_V3_IMPORT_PACKAGE_CONTRACT.revision,
        endpoint: OZON_V3_IMPORT_PACKAGE_CONTRACT.endpoint,
        units: OZON_V3_IMPORT_PACKAGE_CONTRACT.units,
        operationalRequirements: OZON_V3_IMPORT_PACKAGE_CONTRACT.operationalRequirements,
      })).digest('hex'),
    );
  });

  it('preserves exact positive package measurements', () => {
    const result = validateOzonV3ImportPackageFacts({
      packageWeightG: 487.125,
      packageLengthMm: 312.75,
      packageWidthMm: 201.5,
      packageHeightMm: 98.25,
    });

    expect(result).toEqual({
      contractId: OZON_V3_IMPORT_PACKAGE_CONTRACT.contractId,
      contractRevision: OZON_V3_IMPORT_PACKAGE_CONTRACT.revision,
      contractHash: OZON_V3_IMPORT_PACKAGE_CONTRACT.contractHash,
      status: 'READY',
      value: {
        packageWeightG: 487.125,
        packageLengthMm: 312.75,
        packageWidthMm: 201.5,
        packageHeightMm: 98.25,
      },
      issues: [],
    });
  });

  it.each([
    ['null', null],
    ['zero', 0],
    ['negative', -1],
  ])('blocks a %s package measurement', (_label, invalidValue) => {
    for (const field of [
      'packageWeightG',
      'packageLengthMm',
      'packageWidthMm',
      'packageHeightMm',
    ] as const) {
      const result = validateOzonV3ImportPackageFacts({
        packageWeightG: 500,
        packageLengthMm: 300,
        packageWidthMm: 200,
        packageHeightMm: 100,
        [field]: invalidValue,
      });

      expect(result.status).toBe('BLOCKED');
      expect(result.value).toBeNull();
      expect(result.issues).not.toHaveLength(0);
    }
  });

  it.each([
    'packageWeightG',
    'packageLengthMm',
    'packageWidthMm',
    'packageHeightMm',
  ] as const)('blocks partial facts missing %s without synthesizing a default', (missingField) => {
    const complete = {
      packageWeightG: 500,
      packageLengthMm: 300,
      packageWidthMm: 200,
      packageHeightMm: 100,
    };
    const partial = Object.fromEntries(
      Object.entries(complete).filter(([field]) => field !== missingField),
    );

    const result = validateOzonV3ImportPackageFacts(partial);

    expect(result.status).toBe('BLOCKED');
    expect(result.value).toBeNull();
  });
});

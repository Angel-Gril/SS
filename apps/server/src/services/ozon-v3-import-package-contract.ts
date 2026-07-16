import { createHash } from 'node:crypto';

import type { OzonListingWorkflowIssue } from 'shared';

export interface OzonV3ImportPackageFactsInput {
  packageWeightG?: unknown;
  packageLengthMm?: unknown;
  packageWidthMm?: unknown;
  packageHeightMm?: unknown;
}

export interface OzonV3ImportPackageFacts {
  packageWeightG: number;
  packageLengthMm: number;
  packageWidthMm: number;
  packageHeightMm: number;
}

export const OZON_V3_IMPORT_PACKAGE_REQUIREMENTS = Object.freeze({
  packageWeightForImport: true,
  packageDimensionsForImport: true,
} as const);

const CONTRACT_DEFINITION = Object.freeze({
  contractId: 'ss-erp/ozon-v3-product-import/package',
  revision: '1',
  endpoint: '/v3/product/import',
  units: Object.freeze({
    weight: 'g',
    dimensions: 'mm',
  } as const),
  operationalRequirements: OZON_V3_IMPORT_PACKAGE_REQUIREMENTS,
} as const);

const contractHash = createHash('sha256')
  .update(JSON.stringify(CONTRACT_DEFINITION))
  .digest('hex');

/**
 * Current internal SS ERP contract for the supported Ozon V3 import path.
 * It is pending live pilot verification and does not claim that every Ozon
 * category has the same package requirements.
 */
export const OZON_V3_IMPORT_PACKAGE_CONTRACT = Object.freeze({
  ...CONTRACT_DEFINITION,
  contractHash,
});

export interface OzonV3ImportPackageValidation {
  contractId: typeof OZON_V3_IMPORT_PACKAGE_CONTRACT.contractId;
  contractRevision: typeof OZON_V3_IMPORT_PACKAGE_CONTRACT.revision;
  contractHash: string;
  status: 'READY' | 'BLOCKED';
  value: OzonV3ImportPackageFacts | null;
  issues: OzonListingWorkflowIssue[];
}

function isPositiveMeasurement(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

export function validateOzonV3ImportPackageFacts(
  input: OzonV3ImportPackageFactsInput,
): OzonV3ImportPackageValidation {
  const issues: OzonListingWorkflowIssue[] = [];
  const weight = input.packageWeightG;
  const length = input.packageLengthMm;
  const width = input.packageWidthMm;
  const height = input.packageHeightMm;
  if (!isPositiveMeasurement(weight)) {
    issues.push({
      code: 'OZON_PACKAGE_WEIGHT_REQUIRED',
      message: 'The supported Ozon V3 import path requires a positive package weight in g',
      fieldPath: 'operational.packageWeightG',
    });
  }

  const dimensionsAreValid = isPositiveMeasurement(length)
    && isPositiveMeasurement(width)
    && isPositiveMeasurement(height);
  if (!dimensionsAreValid) {
    issues.push({
      code: 'OZON_PACKAGE_DIMENSIONS_REQUIRED',
      message: 'The supported Ozon V3 import path requires positive package length, width and height in mm',
      fieldPath: 'operational.packageDimensionsMm',
    });
  }

  const contract = {
    contractId: OZON_V3_IMPORT_PACKAGE_CONTRACT.contractId,
    contractRevision: OZON_V3_IMPORT_PACKAGE_CONTRACT.revision,
    contractHash: OZON_V3_IMPORT_PACKAGE_CONTRACT.contractHash,
  };
  if (issues.length
    || !isPositiveMeasurement(weight)
    || !isPositiveMeasurement(length)
    || !isPositiveMeasurement(width)
    || !isPositiveMeasurement(height)) {
    return {
      ...contract,
      status: 'BLOCKED',
      value: null,
      issues,
    };
  }

  return {
    ...contract,
    status: 'READY',
    value: {
      packageWeightG: weight,
      packageLengthMm: length,
      packageWidthMm: width,
      packageHeightMm: height,
    },
    issues: [],
  };
}

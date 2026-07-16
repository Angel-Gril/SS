import { describe, expect, it } from 'vitest';
import {
  hasTrustedSourceEvidence,
  isTrustedSourceEvidence,
  trustedNonNegativeSourceNumber,
  trustedObservedSkuStock,
  trustedPositiveSourceNumber,
} from '../services/source-evidence-trust.js';

const trustedEvidence = {
  confidence: 0.9,
  isEstimated: false,
};

describe('source evidence trust', () => {
  it('rejects zero-confidence and estimated evidence', () => {
    expect(isTrustedSourceEvidence({ confidence: 0, isEstimated: false })).toBe(false);
    expect(isTrustedSourceEvidence({ confidence: 1, isEstimated: true })).toBe(false);
    expect(hasTrustedSourceEvidence(
      trustedEvidence,
      { confidence: 0, isEstimated: false },
    )).toBe(false);
  });

  it('requires trusted evidence without coercing unknown operational facts', () => {
    expect(trustedPositiveSourceNumber(500, trustedEvidence)).toBe(500);
    expect(trustedPositiveSourceNumber(500, { confidence: 0, isEstimated: false })).toBeNull();
    expect(trustedNonNegativeSourceNumber(0, trustedEvidence)).toBe(0);
    expect(trustedNonNegativeSourceNumber(null, trustedEvidence)).toBeNull();
  });

  it('does not let a derived attribute matrix establish inventory', () => {
    expect(trustedObservedSkuStock({
      kind: 'derived_attribute_matrix',
      stock: 12,
      rowEvidence: trustedEvidence,
      fieldEvidence: { stock: trustedEvidence },
    })).toBeNull();
  });

  it('requires trusted row and stock field evidence for observed inventory', () => {
    expect(trustedObservedSkuStock({
      kind: 'observed',
      stock: 12,
      rowEvidence: { confidence: 0, isEstimated: false },
      fieldEvidence: { stock: trustedEvidence },
    })).toBeNull();
    expect(trustedObservedSkuStock({
      kind: 'observed',
      stock: 12,
      rowEvidence: trustedEvidence,
      fieldEvidence: { stock: { confidence: 0, isEstimated: false } },
    })).toBeNull();
  });

  it('treats observed zero stock with trusted evidence as known', () => {
    expect(trustedObservedSkuStock({
      kind: 'observed',
      stock: 0,
      rowEvidence: trustedEvidence,
      fieldEvidence: { stock: trustedEvidence },
    })).toBe(0);
  });
});

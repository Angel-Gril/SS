import { describe, expect, it } from 'vitest';
import { assertEffectiveOfficialFormulaResolution } from '../services/logistics-rule-release.js';

const resolution = {
  id: 'resolution-1',
  tenantId: 'tenant-1',
  shopId: 'shop-1',
  warehouseId: 'warehouse-1',
  officialFingerprint: 'official-fingerprint-1',
  sellerSourceRevisionId: 'revision-1',
  candidateSetChecksum: 'candidate-checksum-1',
  candidateServiceKeys: ['pickup', 'courier'],
  selectedServiceKey: 'pickup',
  status: 'CONFIRMED',
  reviewedById: 'admin-1',
  reviewedAt: new Date('2026-07-12T00:00:00.000Z'),
  evidence: { requirementKey: 'requirement-1', reason: 'matched exact pickup method' },
  invalidatedAt: null,
};

const expected = {
  tenantId: 'tenant-1',
  shopId: 'shop-1',
  warehouseId: 'warehouse-1',
  requirementKey: 'requirement-1',
  officialFingerprint: 'official-fingerprint-1',
  sellerSourceRevisionId: 'revision-1',
  candidateSetChecksum: 'candidate-checksum-1',
};

describe('Official-to-Seller formula resolutions', () => {
  it('accepts a reviewed selection from the exact candidate set', () => {
    expect(assertEffectiveOfficialFormulaResolution(resolution, expected)).toMatchObject({
      selectedServiceKey: 'pickup',
    });
  });

  it('rejects an ambiguous candidate set until a reviewer confirms one service', () => {
    expect(() => assertEffectiveOfficialFormulaResolution({
      ...resolution,
      status: 'SUGGESTED',
      selectedServiceKey: null,
      reviewedById: null,
      reviewedAt: null,
    }, expected)).toThrow(expect.objectContaining({ code: 'UNCONFIRMED_OFFICIAL_RESOLUTION' }));
  });

  it('invalidates a resolution when fingerprint, Seller revision, or candidate set changes', () => {
    for (const changed of [
      { officialFingerprint: 'official-fingerprint-2' },
      { sellerSourceRevisionId: 'revision-2' },
      { candidateSetChecksum: 'candidate-checksum-2' },
      { requirementKey: 'requirement-2' },
    ]) {
      expect(() => assertEffectiveOfficialFormulaResolution(resolution, {
        ...expected,
        ...changed,
      })).toThrow(expect.objectContaining({ code: 'STALE_OFFICIAL_RESOLUTION' }));
    }
  });
});

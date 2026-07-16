import { readFileSync } from 'node:fs';
import type { SourceProductCaptureV2Submission } from 'shared';
import { describe, expect, it } from 'vitest';
import { buildSourceProductProfileFromCapture } from '../services/source-product-profile.js';

const fixture = JSON.parse(readFileSync(new URL(
  '../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json',
  import.meta.url,
), 'utf8')) as SourceProductCaptureV2Submission;

describe('V2 source capture profile', () => {
  it('builds from the complete snapshot without collapsing explicit zero or unknown evidence', () => {
    const profile = buildSourceProductProfileFromCapture(fixture.capture, {
      itemId: 'snapshot-1',
      captureHash: fixture.captureHash,
    });

    expect(profile.itemId).toBe('snapshot-1');
    expect(profile.sourcePlatform).toBe('1688');
    expect(profile.sourceProductId).toBe('1000000000003');
    expect(profile.variantEvidence).toMatchObject({ variantCount: 1, hasVariantSku: true });
    expect(profile.packaging).toMatchObject({ hasWeight: false, hasDimensions: false, status: 'missing' });
    expect(profile.capture).toMatchObject({
      version: 'source-product-capture-v2',
      hash: fixture.captureHash,
      provenanceMode: 'native_v2',
      completenessStatus: 'partial',
      hasEstimatedValues: false,
      truncationCount: 0,
    });
    expect(profile.capture.facts.stock).toEqual({ known: 1, unknown: 0, zero: 1 });
    expect(profile.capture.facts.shippingCny).toMatchObject({ value: 0, missingReason: null });
    expect(profile.capture.facts.packageWeightG).toMatchObject({
      value: null,
      missingReason: 'source_returned_null',
    });
    expect(profile.hash).toMatch(/^[a-f0-9]{64}$/);
  });
});

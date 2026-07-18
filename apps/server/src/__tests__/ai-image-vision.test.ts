import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  normalizeAiImageVisionOutput,
  type NormalizeAiImageVisionInput,
} from '../services/ai-image-vision.js';

describe('AI image vision evidence normalization', () => {
  it('meets the fixed identity and unsupported-fact normalization gate', () => {
    const fixture = JSON.parse(readFileSync(
      new URL('./fixtures/ai-image-vision-eval.json', import.meta.url),
      'utf8',
    )) as NormalizeAiImageVisionInput & {
      expectedIdentities: Record<string, string>;
      expectedUnsupportedClaimFields: string[];
    };
    const result = normalizeAiImageVisionOutput(fixture);

    expect(result.mode).toBe('model');
    expect(result.images).toHaveLength(fixture.candidateIds.length);
    expect(Object.fromEntries(result.images.map((image) => [image.candidateId, image.productIdentity])))
      .toEqual(fixture.expectedIdentities);
    expect(result.unsupportedClaims.map((claim) => claim.field).sort())
      .toEqual([...fixture.expectedUnsupportedClaimFields].sort());
    expect(result.verifiedFacts).toEqual(fixture.verifiedFacts);
  });

  it('keeps bounded visual observations but never promotes material, dimensions or package claims', () => {
    const result = normalizeAiImageVisionOutput({
      candidateIds: ['main-1'],
      verifiedFacts: [{
        path: '/facts/productName',
        value: 'Insulated bottle',
        evidenceIds: ['capture:/facts/title'],
      }],
      modelOutput: {
        version: '1.0',
        images: [{
          candidateId: 'main-1',
          productIdentity: 'same_product',
          identityConfidence: 0.94,
          contentRoles: ['identity', 'detail'],
          observations: {
            colors: ['Black'],
            shapes: ['Cylindrical'],
            visibleComponents: ['Lid'],
            visibleText: [{ text: '500 ml', language: 'unknown' }],
          },
          claims: {
            material: 'Carbon fiber',
            dimensions: { widthMm: 70, heightMm: 250 },
            capacity: '500 ml',
            bundleCount: 2,
            packageContents: ['Cleaning brush'],
          },
        }],
      },
    });

    expect(result.mode).toBe('model');
    expect(result.verifiedFacts).toEqual([expect.objectContaining({
      path: '/facts/productName', evidenceIds: ['capture:/facts/title'],
    })]);
    expect(result.images).toEqual([expect.objectContaining({
      candidateId: 'main-1',
      productIdentity: 'same_product',
      observations: expect.objectContaining({ colors: ['black'], visibleComponents: ['lid'] }),
    })]);
    expect(result.images[0]).not.toHaveProperty('material');
    expect(result.images[0]).not.toHaveProperty('dimensions');
    expect(result.unsupportedClaims.map((claim) => claim.field).sort()).toEqual([
      'bundleCount', 'capacity', 'dimensions', 'material', 'packageContents',
    ]);
  });

  it('discards unknown and duplicate candidate results without creating evidence', () => {
    const result = normalizeAiImageVisionOutput({
      candidateIds: ['main-1'],
      verifiedFacts: [],
      modelOutput: {
        version: '1.0',
        images: [{
          candidateId: 'fabricated',
          productIdentity: 'same_product',
          identityConfidence: 1,
          contentRoles: ['identity'],
          observations: { colors: [], shapes: [], visibleComponents: [], visibleText: [] },
          claims: {},
        }, {
          candidateId: 'main-1',
          productIdentity: 'same_product',
          identityConfidence: 0.8,
          contentRoles: ['identity'],
          observations: { colors: ['red'], shapes: [], visibleComponents: [], visibleText: [] },
          claims: {},
        }, {
          candidateId: 'main-1',
          productIdentity: 'different_product',
          identityConfidence: 0.9,
          contentRoles: ['context'],
          observations: { colors: ['blue'], shapes: [], visibleComponents: [], visibleText: [] },
          claims: {},
        }],
      },
    });

    expect(result.discardedCandidateIds).toEqual(['fabricated']);
    expect(result.images).toHaveLength(1);
    expect(result.images[0]?.observations.colors).toEqual(['red']);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      code: 'DUPLICATE_CANDIDATE_RESULT', candidateId: 'main-1',
    }));
  });

  it('returns explicit uncertain observations for every selected image when JSON is malformed', () => {
    const result = normalizeAiImageVisionOutput({
      candidateIds: ['main-1', 'detail-1'],
      verifiedFacts: [],
      modelOutput: '{not-json',
    });

    expect(result.mode).toBe('fallback');
    expect(result.fallbackReason).toBe('INVALID_MODEL_OUTPUT');
    expect(result.images.map((image) => image.candidateId)).toEqual(['main-1', 'detail-1']);
    expect(result.images.every((image) => (
      image.productIdentity === 'uncertain'
      && image.identityConfidence === 0
      && image.contentRoles.length === 0
    ))).toBe(true);
  });

  it('rejects extra schema keys and never normalizes candidate identity whitespace', () => {
    const extraRoot = normalizeAiImageVisionOutput({
      candidateIds: ['main-1'],
      verifiedFacts: [],
      modelOutput: { version: '1.0', images: [], verifiedFacts: [{ path: '/fake', value: true }] },
    });
    expect(extraRoot).toMatchObject({ mode: 'fallback', fallbackReason: 'INVALID_MODEL_OUTPUT' });

    const paddedId = normalizeAiImageVisionOutput({
      candidateIds: ['main-1'],
      verifiedFacts: [],
      modelOutput: {
        version: '1.0',
        images: [{
          candidateId: ' main-1 ',
          productIdentity: 'same_product',
          identityConfidence: 1,
          contentRoles: ['identity'],
          observations: { colors: [], shapes: [], visibleComponents: [], visibleText: [] },
          claims: {},
        }],
      },
    });
    expect(paddedId.images[0]?.productIdentity).toBe('uncertain');
    expect(paddedId.diagnostics).toContainEqual(expect.objectContaining({ code: 'INVALID_CANDIDATE_RESULT' }));
  });

  it('preserves the explicit visual-variant identity without treating it as a product fact', () => {
    const result = normalizeAiImageVisionOutput({
      candidateIds: ['sku-blue'],
      verifiedFacts: [],
      modelOutput: {
        version: '1.0',
        images: [{
          candidateId: 'sku-blue',
          productIdentity: 'variant',
          identityConfidence: 0.91,
          contentRoles: ['identity'],
          observations: { colors: ['blue'], shapes: [], visibleComponents: [], visibleText: [] },
          claims: {},
        }],
      },
    });

    expect(result.images[0]).toMatchObject({ productIdentity: 'variant', identityConfidence: 0.91 });
    expect(result.verifiedFacts).toEqual([]);
  });

  it('accepts a valid result after an earlier malformed record with the same candidate ID', () => {
    const result = normalizeAiImageVisionOutput({
      candidateIds: ['main-1'],
      verifiedFacts: [],
      modelOutput: {
        version: '1.0',
        images: [{
          candidateId: 'main-1',
          productIdentity: 'unsupported-value',
          identityConfidence: 1,
          contentRoles: ['identity'],
          observations: { colors: [], shapes: [], visibleComponents: [], visibleText: [] },
          claims: {},
        }, {
          candidateId: 'main-1',
          productIdentity: 'same_product',
          identityConfidence: 0.88,
          contentRoles: ['identity'],
          observations: { colors: ['green'], shapes: [], visibleComponents: [], visibleText: [] },
          claims: {},
        }],
      },
    });

    expect(result.mode).toBe('model');
    expect(result.images[0]).toMatchObject({
      candidateId: 'main-1', productIdentity: 'same_product', identityConfidence: 0.88,
    });
    expect(result.diagnostics).toContainEqual({
      code: 'INVALID_CANDIDATE_RESULT', candidateId: 'main-1',
    });
  });

  it('accepts exact 500-character candidate IDs and rejects oversized object output', () => {
    const candidateId = 'x'.repeat(500);
    const valid = normalizeAiImageVisionOutput({
      candidateIds: [candidateId],
      verifiedFacts: [],
      modelOutput: {
        version: '1.0',
        images: [{
          candidateId,
          productIdentity: 'same_product',
          identityConfidence: 1,
          contentRoles: ['identity'],
          observations: { colors: [], shapes: [], visibleComponents: [], visibleText: [] },
          claims: {},
        }],
      },
    });
    expect(valid.images[0]?.candidateId).toBe(candidateId);

    const oversized = normalizeAiImageVisionOutput({
      candidateIds: ['main-1'],
      verifiedFacts: [],
      modelOutput: {
        version: '1.0',
        images: [{
          candidateId: 'main-1',
          productIdentity: 'same_product',
          identityConfidence: 1,
          contentRoles: ['identity'],
          observations: { colors: [], shapes: [], visibleComponents: [], visibleText: [] },
          claims: { material: 'x'.repeat(300_000) },
        }],
      },
    });
    expect(oversized).toMatchObject({ mode: 'fallback', fallbackReason: 'INVALID_MODEL_OUTPUT' });
  });
});

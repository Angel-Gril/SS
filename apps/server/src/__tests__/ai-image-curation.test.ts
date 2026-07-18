import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  AI_IMAGE_CURATION_RULES,
  createDeterministicImageCuration,
  normalizeImageCurationModelOutput,
  type ImageCurationCandidate,
} from '../services/ai-image-curation.js';

function candidate(id: string, overrides: Partial<ImageCurationCandidate> = {}): ImageCurationCandidate {
  return {
    id,
    url: `https://img.example.com/${id}.jpg`,
    width: 1200,
    height: 1600,
    mimeType: 'image/jpeg',
    role: 'product_detail',
    skuKeys: [],
    contentHash: `hash-${id}`,
    decorative: false,
    continuityGroup: null,
    ...overrides,
  };
}

describe('AI image deterministic curation', () => {
  it('matches the fixed keep/reject/manual evaluation fixture with explicit reasons', () => {
    const fixture = JSON.parse(readFileSync(
      new URL('./fixtures/ai-image-curation-eval.json', import.meta.url),
      'utf8',
    )) as Array<ImageCurationCandidate & {
      expectedDisposition: 'keep' | 'reject' | 'manual';
      expectedContentRole?: 'identity' | 'detail';
      expectedReason?: string;
    }>;
    const plan = createDeterministicImageCuration(fixture.map((item) => {
      const {
        expectedDisposition: _expectedDisposition,
        expectedContentRole: _expectedContentRole,
        expectedReason: _expectedReason,
        ...input
      } = item;
      return input;
    }));
    const byId = new Map(plan.decisions.map((decision) => [decision.candidateId, decision]));

    for (const expected of fixture) {
      const decision = byId.get(expected.id);
      expect(decision, expected.id).toBeDefined();
      expect(decision?.disposition, expected.id).toBe(expected.expectedDisposition);
      if (expected.expectedReason) {
        expect(decision?.reasonCodes, expected.id).toContain(expected.expectedReason);
      }
      if (expected.expectedContentRole) {
        expect(decision?.contentRole, expected.id).toBe(expected.expectedContentRole);
      }
    }
    expect(plan.decisions).toHaveLength(fixture.length);
    expect(plan.selectedCandidateIds).toEqual(['main-preferred', 'detail-preferred']);
  });

  it('enforces both image-size ceilings and the exact supported aspect boundaries', () => {
    const plan = createDeterministicImageCuration([
      candidate('long-edge', { width: 7681, height: 3000 }),
      candidate('short-edge', { width: 4321, height: 5000 }),
      candidate('ratio-low', { width: 350, height: 1001 }),
      candidate('ratio-high', { width: 2601, height: 1000 }),
      candidate('ratio-low-boundary', { width: 350, height: 1000 }),
      candidate('ratio-high-boundary', { width: 2600, height: 1000 }),
    ]);
    const byId = new Map(plan.decisions.map((decision) => [decision.candidateId, decision]));

    expect(byId.get('long-edge')?.reasonCodes).toContain('TOO_LARGE');
    expect(byId.get('short-edge')?.reasonCodes).toContain('TOO_LARGE');
    expect(byId.get('ratio-low')?.reasonCodes).toContain('EXTREME_ASPECT_RATIO');
    expect(byId.get('ratio-high')?.reasonCodes).toContain('EXTREME_ASPECT_RATIO');
    expect(byId.get('ratio-low-boundary')?.disposition).toBe('keep');
    expect(byId.get('ratio-high-boundary')?.disposition).toBe('keep');
  });

  it('accepts exact dimension boundaries and canonicalizes URL fragments for de-duplication', () => {
    const plan = createDeterministicImageCuration([
      candidate('min-width', { width: 200, height: 300 }),
      candidate('min-height', { width: 300, height: 200 }),
      candidate('max-long', { width: 7680, height: 3000 }),
      candidate('max-short', { width: 5000, height: 4320 }),
      candidate('url-original', {
        url: 'https://img.example.com/same.jpg#original', contentHash: null,
      }),
      candidate('url-copy', {
        url: 'https://img.example.com/same.jpg#copy', contentHash: null,
      }),
    ]);
    const byId = new Map(plan.decisions.map((decision) => [decision.candidateId, decision]));

    for (const id of ['min-width', 'min-height', 'max-long', 'max-short']) {
      expect(byId.get(id)?.disposition, id).toBe('keep');
    }
    expect(byId.get('url-copy')).toMatchObject({
      disposition: 'reject',
      duplicateOfCandidateId: 'url-original',
      reasonCodes: expect.arrayContaining(['DUPLICATE']),
    });
  });

  it('keeps the valid duplicate representative when an invalid image appears first', () => {
    const plan = createDeterministicImageCuration([
      candidate('invalid-first', {
        url: 'https://img.example.com/duplicate.jpg', width: 100, height: 400, contentHash: null,
      }),
      candidate('valid-second', {
        url: 'https://img.example.com/duplicate.jpg', width: 400, height: 400, contentHash: null,
      }),
    ]);
    const byId = new Map(plan.decisions.map((decision) => [decision.candidateId, decision]));

    expect(plan.selectedCandidateIds).toEqual(['valid-second']);
    expect(byId.get('invalid-first')?.reasonCodes).toContain('DUPLICATE');
    expect(byId.get('invalid-first')?.duplicateOfCandidateId).toBe('valid-second');
    expect(byId.get('valid-second')?.reasonCodes).not.toContain('DUPLICATE');
  });

  it('requires classification for unknown roles and hard-rejects video roles', () => {
    const candidates = [
      candidate('unknown-role', { role: 'unknown' }),
      candidate('video-role', { role: 'video', mimeType: 'image/jpeg' }),
    ];
    const deterministic = createDeterministicImageCuration(candidates);
    const byId = new Map(deterministic.decisions.map((decision) => [decision.candidateId, decision]));

    expect(byId.get('unknown-role')).toMatchObject({
      disposition: 'manual', reasonCodes: ['SOURCE_ROLE_UNKNOWN'],
    });
    expect(byId.get('video-role')).toMatchObject({
      disposition: 'reject', reasonCodes: expect.arrayContaining(['UNSUPPORTED_SOURCE_ROLE']),
    });

    const normalized = normalizeImageCurationModelOutput(candidates, {
      version: '1.0',
      decisions: [{
        candidateId: 'unknown-role',
        disposition: 'keep',
        translation: 'skip',
        contentRole: 'context',
      }],
    });
    expect(normalized.selectedCandidateIds).toEqual(['unknown-role']);
    expect(normalized.decisions.find((decision) => decision.candidateId === 'unknown-role'))
      .toMatchObject({ disposition: 'keep', contentRole: 'context' });
  });

  it('uses the exact shared 500-character candidate ID contract', () => {
    const longId = 'x'.repeat(500);
    expect(createDeterministicImageCuration([candidate(longId)]).selectedCandidateIds).toEqual([longId]);
    expect(() => createDeterministicImageCuration([candidate(' padded ')])).toThrow(/candidate ID/i);
    expect(() => createDeterministicImageCuration([candidate('x'.repeat(501))])).toThrow(/candidate ID/i);
  });

  it('bounds the model pool at 25 and selection at 14 without losing overflow state', () => {
    const candidates = Array.from({ length: 30 }, (_, index) => candidate(`image-${index + 1}`, {
      width: index === 24 ? 1200 : 1000,
      height: index === 24 ? 1600 : 1000,
    }));
    const plan = createDeterministicImageCuration(candidates);
    const byId = new Map(plan.decisions.map((decision) => [decision.candidateId, decision]));

    expect(AI_IMAGE_CURATION_RULES.maxCandidates).toBe(25);
    expect(plan.consideredCandidateIds).toHaveLength(25);
    expect(plan.selectedCandidateIds).toHaveLength(14);
    expect(plan.selectedCandidateIds).toContain('image-25');
    expect(byId.get('image-15')?.disposition).toBe('manual');
    expect(byId.get('image-15')?.reasonCodes).toContain('SELECTION_LIMIT');
    expect(byId.get('image-26')?.disposition).toBe('manual');
    expect(byId.get('image-26')?.reasonCodes).toContain('CANDIDATE_LIMIT');
    expect(plan.decisions).toHaveLength(30);
  });

  it('drops fabricated model IDs and falls back to the deterministic selected set', () => {
    const candidates = Array.from({ length: 8 }, (_, index) => candidate(`real-${index + 1}`));
    const deterministic = createDeterministicImageCuration(candidates);
    const normalized = normalizeImageCurationModelOutput(candidates, {
      version: '1.0',
      decisions: [{
        candidateId: 'fabricated-id',
        disposition: 'keep',
        translation: 'translate',
        contentRole: 'identity',
      }],
    });

    expect(normalized.mode).toBe('fallback');
    expect(normalized.fallbackReason).toBe('NO_VALID_MODEL_SELECTION');
    expect(normalized.discardedModelCandidateIds).toEqual(['fabricated-id']);
    expect(normalized.selectedCandidateIds).toEqual(deterministic.selectedCandidateIds);
    expect(normalized.decisions).toHaveLength(candidates.length);
  });

  it('keeps an accepted long-image continuity group together and de-duplicates model selections', () => {
    const candidates = [
      candidate('detail-before'),
      candidate('long-1', { continuityGroup: 'detail-strip-1' }),
      candidate('long-2', { continuityGroup: 'detail-strip-1' }),
      candidate('detail-after'),
    ];
    const normalized = normalizeImageCurationModelOutput(candidates, {
      version: '1.0',
      decisions: [
        { candidateId: 'long-1', disposition: 'keep', translation: 'translate', contentRole: 'detail' },
        { candidateId: 'long-1', disposition: 'keep', translation: 'translate', contentRole: 'detail' },
      ],
    });

    expect(normalized.mode).toBe('model');
    expect(normalized.selectedCandidateIds).toEqual(['long-1', 'long-2']);
    expect(normalized.decisions.find((decision) => decision.candidateId === 'detail-before')?.disposition)
      .toBe('manual');
    expect(normalized.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'DUPLICATE_MODEL_DECISION', candidateId: 'long-1' }),
      expect.objectContaining({ code: 'CONTINUITY_GROUP_EXPANDED', candidateId: 'long-2' }),
    ]));
  });

  it('never lets a model selection revive an image rejected by deterministic safety rules', () => {
    const normalized = normalizeImageCurationModelOutput([
      candidate('safe'),
      candidate('tiny', { width: 100, height: 100 }),
    ], {
      version: '1.0',
      decisions: [
        { candidateId: 'safe', disposition: 'keep', translation: 'unknown', contentRole: 'identity' },
        { candidateId: 'tiny', disposition: 'keep', translation: 'skip', contentRole: 'identity' },
      ],
    });

    expect(normalized.selectedCandidateIds).toEqual(['safe']);
    expect(normalized.decisions.find((decision) => decision.candidateId === 'tiny')).toMatchObject({
      disposition: 'reject', reasonCodes: expect.arrayContaining(['TOO_SMALL']),
    });
    expect(normalized.diagnostics).toContainEqual({
      code: 'MODEL_DECISION_BLOCKED_BY_RULE', candidateId: 'tiny',
    });
  });

  it('honors a valid model decision that rejects every visual candidate', () => {
    const candidates = [candidate('promotion-1'), candidate('promotion-2')];
    const normalized = normalizeImageCurationModelOutput(candidates, {
      version: '1.0',
      decisions: candidates.map((item) => ({
        candidateId: item.id,
        disposition: 'reject' as const,
        translation: 'skip' as const,
        contentRole: 'context' as const,
      })),
    });

    expect(normalized.mode).toBe('model');
    expect(normalized.fallbackReason).toBeNull();
    expect(normalized.selectedCandidateIds).toEqual([]);
    expect(normalized.selectionTarget).toMatchObject({
      minimum: 7, maximum: 14, eligibleCount: 2, selectedCount: 0, met: false,
    });
    expect(normalized.decisions.every((decision) => (
      decision.disposition === 'reject' && decision.reasonCodes.includes('MODEL_REJECTED')
    ))).toBe(true);
  });

  it('reports a below-target partial model selection without reviving rejected images', () => {
    const candidates = Array.from({ length: 8 }, (_, index) => candidate(`candidate-${index + 1}`));
    const normalized = normalizeImageCurationModelOutput(candidates, {
      version: '1.0',
      decisions: [{
        candidateId: 'candidate-1', disposition: 'keep', translation: 'unknown', contentRole: 'identity',
      }, ...candidates.slice(1).map((item) => ({
        candidateId: item.id,
        disposition: 'reject' as const,
        translation: 'skip' as const,
        contentRole: 'context' as const,
      }))],
    });

    expect(normalized.mode).toBe('model');
    expect(normalized.selectedCandidateIds).toEqual(['candidate-1']);
    expect(normalized.selectionTarget).toEqual({
      minimum: 7, maximum: 14, eligibleCount: 8, selectedCount: 1, met: false,
    });
  });

  it('never partially selects a continuity group containing a hard-rejected image', () => {
    const candidates = [
      candidate('strip-1', { continuityGroup: 'strip-a' }),
      candidate('strip-2', { continuityGroup: 'strip-a', width: 100, height: 100 }),
      candidate('safe'),
    ];
    const deterministic = createDeterministicImageCuration(candidates);
    const byId = new Map(deterministic.decisions.map((decision) => [decision.candidateId, decision]));

    expect(deterministic.selectedCandidateIds).toEqual(['safe']);
    expect(byId.get('strip-1')).toMatchObject({
      disposition: 'manual', reasonCodes: expect.arrayContaining(['CONTINUITY_GROUP_INCOMPLETE']),
    });
    expect(byId.get('strip-2')).toMatchObject({
      disposition: 'reject', reasonCodes: expect.arrayContaining(['TOO_SMALL']),
    });

    const normalized = normalizeImageCurationModelOutput(candidates, {
      version: '1.0',
      decisions: [{
        candidateId: 'strip-1', disposition: 'keep', translation: 'translate', contentRole: 'detail',
      }],
    });
    expect(normalized.mode).toBe('model');
    expect(normalized.selectedCandidateIds).toEqual([]);
    expect(normalized.decisions.find((decision) => decision.candidateId === 'safe')?.disposition)
      .toBe('manual');
  });

  it('does not turn an explicit model rejection into keep through continuity expansion', () => {
    const candidates = [
      candidate('strip-1', { continuityGroup: 'strip-a' }),
      candidate('strip-2', { continuityGroup: 'strip-a' }),
    ];
    const normalized = normalizeImageCurationModelOutput(candidates, {
      version: '1.0',
      decisions: [{
        candidateId: 'strip-1', disposition: 'keep', translation: 'translate', contentRole: 'detail',
      }, {
        candidateId: 'strip-2', disposition: 'reject', translation: 'skip', contentRole: 'detail',
      }],
    });

    expect(normalized.selectedCandidateIds).toEqual([]);
    expect(normalized.decisions.find((decision) => decision.candidateId === 'strip-1')).toMatchObject({
      disposition: 'manual', reasonCodes: expect.arrayContaining(['CONTINUITY_GROUP_MODEL_CONFLICT']),
    });
    expect(normalized.decisions.find((decision) => decision.candidateId === 'strip-2')).toMatchObject({
      disposition: 'reject', reasonCodes: expect.arrayContaining(['MODEL_REJECTED']),
    });
    expect(normalized.diagnostics).toContainEqual({
      code: 'CONTINUITY_GROUP_MODEL_CONFLICT', candidateId: 'strip-1',
    });
  });

  it('does not let an unrelated blocked keep trigger fallback that revives a model veto', () => {
    const candidates = [
      candidate('strip-1', { continuityGroup: 'strip-a' }),
      candidate('strip-2', { continuityGroup: 'strip-a' }),
      candidate('tiny', { width: 100, height: 100 }),
    ];
    const normalized = normalizeImageCurationModelOutput(candidates, {
      version: '1.0',
      decisions: [{
        candidateId: 'strip-1', disposition: 'keep', translation: 'translate', contentRole: 'detail',
      }, {
        candidateId: 'strip-2', disposition: 'reject', translation: 'skip', contentRole: 'detail',
      }, {
        candidateId: 'tiny', disposition: 'keep', translation: 'skip', contentRole: 'identity',
      }],
    });

    expect(normalized.mode).toBe('model');
    expect(normalized.selectedCandidateIds).toEqual([]);
    expect(normalized.decisions.find((decision) => decision.candidateId === 'strip-2')).toMatchObject({
      disposition: 'reject', reasonCodes: ['MODEL_REJECTED'],
    });
    expect(normalized.decisions.find((decision) => decision.candidateId === 'tiny')).toMatchObject({
      disposition: 'reject', reasonCodes: expect.arrayContaining(['TOO_SMALL']),
    });
  });

  it('preserves a valid-image veto when every requested keep is blocked by hard rules', () => {
    const normalized = normalizeImageCurationModelOutput([
      candidate('safe'),
      candidate('tiny', { width: 100, height: 100 }),
    ], {
      version: '1.0',
      decisions: [{
        candidateId: 'safe', disposition: 'reject', translation: 'skip', contentRole: 'context',
      }, {
        candidateId: 'tiny', disposition: 'keep', translation: 'skip', contentRole: 'identity',
      }],
    });

    expect(normalized.mode).toBe('model');
    expect(normalized.selectedCandidateIds).toEqual([]);
    expect(normalized.decisions.find((decision) => decision.candidateId === 'safe')).toMatchObject({
      disposition: 'reject', reasonCodes: ['MODEL_REJECTED'],
    });
  });
});

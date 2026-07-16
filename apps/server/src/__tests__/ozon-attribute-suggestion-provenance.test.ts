import { describe, expect, it } from 'vitest';
import {
  buildOzonAttributeSuggestionProvenance,
  type FrozenOzonAttributeSuggestionProvenanceInput,
  OZON_ATTRIBUTE_SUGGESTION_PROVENANCE_MAX_EVIDENCE_ITEMS,
  OZON_ATTRIBUTE_SUGGESTION_PROVENANCE_MAX_EVIDENCE_VALUE_BYTES,
} from '../services/ozon-attribute-suggestion-provenance.js';

type TestInput = FrozenOzonAttributeSuggestionProvenanceInput & {
  evidenceDetails: Array<Record<string, unknown>>;
  ignoredRuntimeField: string;
};

function input(): TestInput {
  return {
    attributeId: 100,
    candidateId: 'attribute-suggestion:100:abcdef0123456789abcdef01',
    candidateHash: 'a'.repeat(64),
    schemaRevision: 'b'.repeat(64),
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'c'.repeat(64),
    draftVersion: 3,
    draftRevision: 7,
    evidenceDetails: [{
      id: 'capture-standard:colors',
      attributeId: 100,
      source: 'SOURCE_STANDARD',
      path: 'capture:/skus/0/attributes/0/value',
      value: ['白色'],
      confidence: 0.9,
      isEstimated: false,
      ignoredRuntimeField: 'must not persist',
    }],
    ignoredRuntimeField: 'must not persist',
  };
}

describe('frozen Ozon attribute suggestion provenance', () => {
  it('copies only the bounded v1 contract and detaches evidence JSON', () => {
    const source = input();
    const result = buildOzonAttributeSuggestionProvenance(source);

    expect(result).toEqual({
      contractVersion: 'ozon-attribute-suggestion-provenance/v1',
      candidateId: source.candidateId,
      candidateHash: source.candidateHash,
      schemaRevision: source.schemaRevision,
      sourceCaptureSnapshotId: source.sourceCaptureSnapshotId,
      sourceCaptureHash: source.sourceCaptureHash,
      draftVersion: 3,
      draftRevision: 7,
      evidenceDetails: [{
        id: 'capture-standard:colors',
        attributeId: 100,
        source: 'SOURCE_STANDARD',
        path: 'capture:/skus/0/attributes/0/value',
        value: ['白色'],
        confidence: 0.9,
        isEstimated: false,
      }],
    });
    (source.evidenceDetails[0]!.value as string[])[0] = 'changed';
    expect(result.evidenceDetails[0]!.value).toEqual(['白色']);
  });

  it('rejects oversized or structurally invalid evidence instead of truncating it', () => {
    const tooMany = input();
    tooMany.evidenceDetails = Array.from(
      { length: OZON_ATTRIBUTE_SUGGESTION_PROVENANCE_MAX_EVIDENCE_ITEMS + 1 },
      (_, index) => ({
        ...input().evidenceDetails[0]!,
        id: `evidence-${index}`,
      }),
    );
    expect(() => buildOzonAttributeSuggestionProvenance(tooMany)).toThrow('evidenceDetails');

    const oversized = input();
    oversized.evidenceDetails[0]!.value = 'x'.repeat(
      OZON_ATTRIBUTE_SUGGESTION_PROVENANCE_MAX_EVIDENCE_VALUE_BYTES + 1,
    );
    expect(() => buildOzonAttributeSuggestionProvenance(oversized)).toThrow('value');

    const wrongAttribute = input();
    wrongAttribute.evidenceDetails[0]!.attributeId = 101;
    expect(() => buildOzonAttributeSuggestionProvenance(wrongAttribute)).toThrow('attributeId');
  });

  it('preserves __proto__ as inert JSON data and rejects over-budget trees', () => {
    const prototypeKey = input();
    prototypeKey.evidenceDetails[0]!.value = Object.fromEntries([
      ['__proto__', { retained: true }],
      ['constructor', 'plain data'],
    ]);
    const result = buildOzonAttributeSuggestionProvenance(prototypeKey);
    const value = result.evidenceDetails[0]!.value as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(value, '__proto__')).toBe(true);
    expect(value.__proto__).toEqual({ retained: true });
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);

    const tooWide = input();
    tooWide.evidenceDetails[0]!.value = Array.from({ length: 5000 }, () => null);
    expect(() => buildOzonAttributeSuggestionProvenance(tooWide)).toThrow('value');
  });
});

import { describe, expect, it } from 'vitest';
import type {
  OzonNormalizedAttributeField,
  SourceStandardAttributes,
} from 'shared';
import {
  buildOzonAttributeSuggestions,
  type OzonAttributeSuggestionEvidence,
} from '../services/ozon-attribute-suggestions.js';
import { buildSourceProductProfile } from '../services/source-product-profile.js';

function field(
  attributeId: number,
  name: string,
  overrides: Partial<OzonNormalizedAttributeField> = {},
): OzonNormalizedAttributeField {
  return {
    attributeId,
    name,
    description: '',
    sourceType: 'String',
    valueType: 'STRING',
    cardinality: 'SINGLE',
    required: false,
    dictionaryId: null,
    valuePolicy: 'FREE_TEXT',
    ownership: 'EDITOR',
    editorMode: 'EDITABLE',
    aiSuggestionAllowed: true,
    ...overrides,
  };
}

const standard: SourceStandardAttributes = {
  brand: { value: '其它', source: 'sourceAttributes', isBrandless: true },
  colors: ['白色', '藏青色'],
  sizes: ['M', 'L'],
  materials: ['棉'],
  gender: { value: 'female', source: 'sourceAttributes' },
  seasons: ['summer'],
  packageDimensionsMm: { length: 300, width: 200, height: 40 },
  packageWeightG: 250,
  categoryHints: ['服装', '女装'],
  missingForOzon: [],
};

const profile = buildSourceProductProfile({
  id: 'goods-1',
  title: '女士纯棉夏季 T 恤',
  sourcePlatform: '1688',
  sourceProductId: 'offer-1',
  metadata: {
    sourceTitleRaw: '女士纯棉夏季 T 恤',
    categoryPath: ['服装', '女装', 'T恤'],
    sourceStandardAttributes: standard,
  },
  variants: [
    { sku: 'white-m', attrs: { 颜色: '白色', 尺码: 'M' } },
    { sku: 'navy-l', attrs: { 颜色: '藏青色', 尺码: 'L' } },
  ],
});

describe('Ozon attribute evidence-backed suggestions', () => {
  it('preserves the six standard source mappings as high-confidence explainable suggestions', () => {
    const fields = [
      field(85, 'Бренд'),
      field(10096, 'Цвет товара', { cardinality: 'MULTI' }),
      field(4295, 'Российский размер', { cardinality: 'MULTI' }),
      field(9001, 'Материал', { cardinality: 'MULTI' }),
      field(9163, 'Пол'),
      field(9003, 'Сезон', { cardinality: 'MULTI' }),
    ];

    const result = buildOzonAttributeSuggestions({ fields, sourceProfile: profile, sourceStandard: standard });

    expect(Object.keys(result.suggestions).sort()).toEqual(['85', '10096', '4295', '9001', '9163', '9003'].sort());
    expect(result.suggestions['85']).toMatchObject({
      attributeId: 85,
      value: 'Без бренда',
      source: 'SOURCE',
      reviewed: false,
      confidence: 0.98,
      manualReview: 'NOT_REQUIRED',
      dictionaryMatch: { status: 'NOT_APPLICABLE', dictionaryValueId: null },
    });
    expect(result.suggestions['10096']?.value).toEqual(['白色', '藏青色']);
    expect(result.suggestions['4295']?.value).toEqual(['M', 'L']);
    expect(result.suggestions['9001']?.value).toEqual(['棉']);
    expect(result.suggestions['9163']?.value).toBe('female');
    expect(result.suggestions['9003']?.value).toEqual(['summer']);
    for (const suggestion of Object.values(result.suggestions)) {
      expect(suggestion.evidence).toHaveLength(1);
      expect(suggestion.evidenceDetails[0]).toMatchObject({
        source: 'SOURCE_STANDARD',
        confidence: 0.98,
        isEstimated: false,
      });
    }
    expect(result.blocked).toEqual([]);
  });

  it('uses source-profile evidence when a standard projection is unavailable', () => {
    const result = buildOzonAttributeSuggestions({
      fields: [
        field(10096, 'Цвет товара', { cardinality: 'MULTI' }),
        field(9001, 'Материал', { cardinality: 'MULTI' }),
      ],
      sourceProfile: profile,
    });

    expect(result.suggestions['10096']).toMatchObject({
      value: ['白色', '藏青色'],
      source: 'SOURCE',
      confidence: 0.94,
      evidenceDetails: [{ source: 'SOURCE_PROFILE', path: 'sourceProfile.colors' }],
    });
    expect(result.suggestions['9001']).toMatchObject({
      value: ['棉'],
      evidenceDetails: [{ source: 'SOURCE_PROFILE', path: 'sourceProfile.materials' }],
    });
  });

  it('preserves capture confidence and refuses estimated standard facts in the production posture', () => {
    const color = field(10096, 'Цвет товара', { cardinality: 'MULTI' });
    const trusted = buildOzonAttributeSuggestions({
      fields: [color],
      sourceProfile: profile,
      sourceStandard: standard,
      sourceStandardEvidence: {
        colors: {
          id: 'capture:colors',
          path: 'main_world:/skus/0/attributes/0',
          confidence: 0.71,
          isEstimated: false,
        },
      },
      allowSourceProfileFallback: false,
    });
    const estimated = buildOzonAttributeSuggestions({
      fields: [color],
      sourceProfile: profile,
      sourceStandard: standard,
      sourceStandardEvidence: {
        colors: {
          id: 'capture:colors',
          path: 'derived:/skus/0/attributes/0',
          confidence: 0.99,
          isEstimated: true,
        },
      },
      allowSourceProfileFallback: false,
    });

    expect(trusted.suggestions['10096']).toMatchObject({
      confidence: 0.71,
      evidence: ['capture:colors'],
      evidenceDetails: [{
        path: 'main_world:/skus/0/attributes/0',
        confidence: 0.71,
        isEstimated: false,
      }],
    });
    expect(estimated.suggestions).toEqual({});
  });

  it('preserves source color and size suggestions for schema-owned SKU matrix fields', () => {
    const fields = [
      field(10096, 'Цвет товара', {
        ownership: 'SKU',
        editorMode: 'SKU_MATRIX',
        aiSuggestionAllowed: false,
        cardinality: 'MULTI',
        dictionaryId: 200,
        valuePolicy: 'STRICT_DICTIONARY',
      }),
      field(4295, 'Российский размер', {
        ownership: 'SKU',
        editorMode: 'SKU_MATRIX',
        aiSuggestionAllowed: false,
        cardinality: 'MULTI',
        dictionaryId: 201,
        valuePolicy: 'STRICT_DICTIONARY',
      }),
    ];
    const result = buildOzonAttributeSuggestions({
      fields,
      sourceProfile: profile,
      sourceStandard: standard,
      dictionaryMatches: [
        { attributeId: 10096, inputValue: '白色', dictionaryValueId: 101, canonicalValue: 'Белый' },
        { attributeId: 10096, inputValue: '藏青色', dictionaryValueId: 102, canonicalValue: 'Темно-синий' },
        { attributeId: 4295, inputValue: 'M', dictionaryValueId: 201, canonicalValue: 'M' },
        { attributeId: 4295, inputValue: 'L', dictionaryValueId: 202, canonicalValue: 'L' },
      ],
    });

    expect(result.suggestions['10096']).toMatchObject({
      source: 'SOURCE',
      value: ['白色', '藏青色'],
      dictionaryMatch: { status: 'MATCHED' },
    });
    expect(result.suggestions['4295']).toMatchObject({
      source: 'SOURCE',
      value: ['M', 'L'],
      dictionaryMatch: { status: 'MATCHED' },
    });
    expect(result.blocked).toEqual([]);
  });

  it('keeps only server-resolved values for strict dictionaries and never invents id zero', () => {
    const color = field(10096, 'Цвет товара', {
      cardinality: 'MULTI',
      dictionaryId: 200,
      valuePolicy: 'STRICT_DICTIONARY',
    });
    const matched = buildOzonAttributeSuggestions({
      fields: [color],
      sourceProfile: profile,
      sourceStandard: standard,
      dictionaryMatches: [{
        attributeId: 10096,
        inputValue: '白色',
        dictionaryValueId: 101,
        canonicalValue: 'Белый',
      }, {
        attributeId: 10096,
        inputValue: '藏青色',
        dictionaryValueId: 102,
        canonicalValue: 'Темно-синий',
      }],
    });

    expect(matched.suggestions['10096']).toMatchObject({
      value: ['白色', '藏青色'],
      manualReview: 'NOT_REQUIRED',
      dictionaryMatch: { status: 'MATCHED', dictionaryValueId: null },
      dictionaryMatches: [
        { inputValue: '白色', dictionaryValueId: 101, canonicalValue: 'Белый' },
        { inputValue: '藏青色', dictionaryValueId: 102, canonicalValue: 'Темно-синий' },
      ],
    });

    const missed = buildOzonAttributeSuggestions({
      fields: [color],
      sourceProfile: profile,
      sourceStandard: standard,
      dictionaryMatches: [{
        attributeId: 10096,
        inputValue: '白色',
        dictionaryValueId: 0,
        canonicalValue: 'forged text fallback',
      }],
    });
    expect(missed.suggestions).not.toHaveProperty('10096');
    expect(missed.blocked).toContainEqual(expect.objectContaining({
      attributeId: 10096,
      reasonCode: 'STRICT_DICTIONARY_UNRESOLVED',
      manualReview: 'REQUIRED',
      unsupportedValues: ['白色', '藏青色'],
    }));
    expect(JSON.stringify(missed)).not.toContain('forged text fallback');
  });

  it('keeps resolved strict-dictionary values while blocking unresolved siblings', () => {
    const result = buildOzonAttributeSuggestions({
      fields: [field(10096, 'Цвет товара', {
        cardinality: 'MULTI',
        dictionaryId: 200,
        valuePolicy: 'STRICT_DICTIONARY',
      })],
      sourceProfile: profile,
      sourceStandard: standard,
      dictionaryMatches: [{
        attributeId: 10096,
        inputValue: '白色',
        dictionaryValueId: 101,
        canonicalValue: 'Белый',
      }],
    });

    expect(result.suggestions['10096']).toMatchObject({
      value: ['白色'],
      manualReview: 'REQUIRED',
      dictionaryMatch: { status: 'UNSUPPORTED', dictionaryValueId: null },
      dictionaryMatches: [{ inputValue: '白色', dictionaryValueId: 101 }],
    });
    expect(result.blocked).toContainEqual(expect.objectContaining({
      reasonCode: 'STRICT_DICTIONARY_UNRESOLVED',
      unsupportedValues: ['藏青色'],
    }));
  });

  it('accepts AI candidates only for eligible fields with non-estimated source or visual evidence', () => {
    const pattern = field(7100, 'Рисунок', { aiSuggestionAllowed: true });
    const visualEvidence: OzonAttributeSuggestionEvidence = {
      id: 'vision:pattern:1',
      attributeId: 7100,
      source: 'VISUAL',
      path: 'visionAnalysis.pattern',
      value: 'полоска',
      confidence: 0.91,
      isEstimated: false,
    };
    const result = buildOzonAttributeSuggestions({
      fields: [pattern],
      sourceProfile: profile,
      evidence: [visualEvidence],
      aiCandidates: [{
        attributeId: 7100,
        value: 'В полоску',
        confidence: 0.84,
        evidence: ['vision:pattern:1'],
      }],
    });

    expect(result.suggestions['7100']).toMatchObject({
      value: 'В полоску',
      source: 'AI',
      reviewed: false,
      confidence: 0.84,
      evidence: ['vision:pattern:1'],
      evidenceDetails: [visualEvidence],
      manualReview: 'REQUIRED',
    });

    const unsupported = buildOzonAttributeSuggestions({
      fields: [pattern],
      sourceProfile: profile,
      aiCandidates: [{ attributeId: 7100, value: 'Клетка', confidence: 0.9, evidence: [] }],
    });
    expect(unsupported.suggestions).toEqual({});
    expect(unsupported.blocked).toContainEqual(expect.objectContaining({
      attributeId: 7100,
      reasonCode: 'AI_EVIDENCE_REQUIRED',
      manualReview: 'REQUIRED',
    }));
  });

  it('rejects estimated evidence and schema fields that are not AI-eligible', () => {
    const estimatedField = field(7100, 'Рисунок');
    const manualField = field(7101, 'Особенность', {
      editorMode: 'MANUAL_REQUIRED',
      aiSuggestionAllowed: false,
    });
    const result = buildOzonAttributeSuggestions({
      fields: [estimatedField, manualField],
      sourceProfile: profile,
      evidence: [{
        id: 'vision:estimated',
        attributeId: 7100,
        source: 'VISUAL',
        path: 'visionAnalysis.pattern',
        value: 'полоска',
        confidence: 0.9,
        isEstimated: true,
      }, {
        id: 'profile:manual',
        attributeId: 7101,
        source: 'SOURCE_PROFILE',
        path: 'sourceProfile.textEvidence.description',
        value: 'feature',
        confidence: 0.9,
        isEstimated: false,
      }],
      aiCandidates: [{
        attributeId: 7100,
        value: 'В полоску',
        confidence: 0.8,
        evidence: ['vision:estimated'],
      }, {
        attributeId: 7101,
        value: 'Особенность',
        confidence: 0.8,
        evidence: ['profile:manual'],
      }],
    });

    expect(result.suggestions).toEqual({});
    expect(result.blocked).toEqual(expect.arrayContaining([
      expect.objectContaining({ attributeId: 7100, reasonCode: 'AI_ESTIMATED_EVIDENCE_FORBIDDEN' }),
      expect.objectContaining({ attributeId: 7101, reasonCode: 'AI_FIELD_NOT_ELIGIBLE' }),
    ]));
  });

  it('never accepts AI estimates for compliance, warranty, hazard, legal, origin, manufacturing, weight, or dimensions', () => {
    const forbidden = [
      field(8001, 'Номер сертификата'),
      field(8002, 'Гарантийный срок'),
      field(8003, 'Класс опасности'),
      field(8004, 'Юридическая декларация'),
      field(8005, 'Страна происхождения'),
      field(8006, 'Производитель'),
      field(8007, 'Вес товара, г', { valueType: 'INTEGER' }),
      field(8008, 'Габариты упаковки'),
      field(8009, 'Регуляторное поле', { complianceSensitive: true }),
    ];
    const evidence = forbidden.map((candidate): OzonAttributeSuggestionEvidence => ({
      id: `vision:${candidate.attributeId}`,
      attributeId: candidate.attributeId,
      source: 'VISUAL',
      path: `visionAnalysis.${candidate.attributeId}`,
      value: 'plausible',
      confidence: 0.99,
      isEstimated: false,
    }));

    const result = buildOzonAttributeSuggestions({
      fields: forbidden,
      sourceProfile: profile,
      evidence,
      aiCandidates: forbidden.map((candidate) => ({
        attributeId: candidate.attributeId,
        value: candidate.valueType === 'INTEGER' ? 500 : 'plausible',
        confidence: 0.99,
        evidence: [`vision:${candidate.attributeId}`],
      })),
    });

    expect(result.suggestions).toEqual({});
    expect(result.blocked).toHaveLength(forbidden.length);
    expect(result.blocked.every((entry) => entry.reasonCode === 'AI_FORBIDDEN_FACT')).toBe(true);
    expect(result.blocked.every((entry) => entry.manualReview === 'REQUIRED')).toBe(true);
  });

  it('preserves numeric types and multi cardinality without stringifying AI values', () => {
    const quantities = field(8200, 'Количество элементов', {
      valueType: 'INTEGER',
      cardinality: 'MULTI',
    });
    const result = buildOzonAttributeSuggestions({
      fields: [quantities],
      sourceProfile: profile,
      evidence: [{
        id: 'profile:quantities',
        attributeId: 8200,
        source: 'SOURCE_PROFILE',
        path: 'sourceProfile.variantEvidence.optionValues.quantity',
        value: [2, 4],
        confidence: 0.9,
        isEstimated: false,
      }],
      aiCandidates: [{
        attributeId: 8200,
        value: [2, 4],
        confidence: 0.82,
        evidence: ['profile:quantities'],
      }],
    });

    expect(result.suggestions['8200']).toMatchObject({
      valueType: 'INTEGER',
      cardinality: 'MULTI',
      value: [2, 4],
    });
    const value = result.suggestions['8200']?.value;
    expect(Array.isArray(value) && value.every((entry) => typeof entry === 'number')).toBe(true);
  });
});

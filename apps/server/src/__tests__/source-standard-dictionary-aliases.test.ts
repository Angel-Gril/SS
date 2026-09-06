import { describe, expect, it } from 'vitest';
import type { OzonNormalizedAttributeField, SourceStandardAttributes } from 'shared';
import {
  buildSourceStandardDictionaryAliasPlan,
  sourceStandardDictionaryAliases,
} from '../services/source-standard-dictionary-aliases.js';

function field(overrides: Partial<OzonNormalizedAttributeField> = {}): OzonNormalizedAttributeField {
  return {
    attributeId: 10096,
    name: 'Цвет товара',
    description: '',
    sourceType: 'String',
    valueType: 'STRING',
    cardinality: 'MULTI',
    required: true,
    dictionaryId: 1494,
    valuePolicy: 'STRICT_DICTIONARY',
    ownership: 'SKU',
    editorMode: 'SKU_MATRIX',
    aiSuggestionAllowed: true,
    requiresRussianText: true,
    readinessImpact: 'OZON_IMPORT',
    ...overrides,
  };
}

function standard(overrides: Partial<SourceStandardAttributes> = {}): SourceStandardAttributes {
  return {
    brand: { value: '', isBrandless: false },
    colors: [],
    sizes: [],
    materials: [],
    gender: { value: '' },
    seasons: [],
    packageDimensionsMm: null,
    packageWeightG: null,
    categoryHints: [],
    missingForOzon: [],
    ...overrides,
  };
}

describe('source standard dictionary aliases', () => {
  it('includes official Ozon search terms for brandless and PE source facts', () => {
    const sourceStandard = standard({
      brand: { value: '', isBrandless: true },
      materials: ['PE'],
    });
    expect(sourceStandardDictionaryAliases({
      field: field({ attributeId: 85, name: 'Бренд', cardinality: 'SINGLE', ownership: 'EDITOR' }),
      value: 'Без бренда',
      sourceContext: { sourceStandard },
    })).toEqual(['Без бренда', 'Нет бренда']);
    expect(sourceStandardDictionaryAliases({
      field: field({ attributeId: 6383, name: 'Материал', cardinality: 'MULTI', ownership: 'EDITOR' }),
      value: 'PE',
      sourceContext: { sourceStandard },
    })).toEqual(['PE', 'Полиэтилен']);
  });

  it('keeps explicit aliases for six Chinese colors without assigning multicolor to a single color', () => {
    const sourceStandard = standard({
      colors: ['白色', '黑色', '红色', '绿色', '蓝色', '黄色'],
    });
    const colorField = field();
    const plan = buildSourceStandardDictionaryAliasPlan({ field: colorField, sourceStandard });

    expect(plan).toEqual({
      standardKey: 'colors',
      valueAliases: [
        { sourceValue: '白色', aliases: ['белый'] },
        { sourceValue: '黑色', aliases: ['черный'] },
        { sourceValue: '红色', aliases: ['красный'] },
        { sourceValue: '绿色', aliases: ['зеленый'] },
        { sourceValue: '蓝色', aliases: ['синий'] },
        { sourceValue: '黄色', aliases: ['желтый'] },
      ],
      aggregateCandidate: {
        value: 'Разноцветный',
        sourceValues: ['白色', '黑色', '红色', '绿色', '蓝色', '黄色'],
      },
    });

    for (const [sourceValue, expectedAlias] of [
      ['白色', 'белый'],
      ['黑色', 'черный'],
      ['红色', 'красный'],
      ['绿色', 'зеленый'],
      ['蓝色', 'синий'],
      ['黄色', 'желтый'],
    ]) {
      const aliases = sourceStandardDictionaryAliases({
        field: colorField,
        value: sourceValue,
        sourceContext: { sourceStandard },
      });
      expect(aliases).toContain(expectedAlias);
      expect(aliases).not.toContain('Разноцветный');
    }
    expect(sourceStandardDictionaryAliases({
      field: colorField,
      value: 'Разноцветный',
      sourceContext: { sourceStandard },
    })).toContain('Разноцветный');
  });

  it('does not pair a source value with an unrelated target when translation cardinality differs', () => {
    const sourceStandard = standard({ sizes: ['S M'] });
    const sizeField = field({
      attributeId: 4295,
      name: 'Российский размер',
      cardinality: 'MULTI',
      dictionaryId: 835,
    });
    const plan = buildSourceStandardDictionaryAliasPlan({ field: sizeField, sourceStandard });

    expect(plan).toEqual({
      standardKey: 'sizes',
      valueAliases: [{ sourceValue: 'S M', aliases: [] }],
      aggregateCandidate: null,
    });
    expect(sourceStandardDictionaryAliases({
      field: sizeField,
      value: 'S M',
      sourceContext: { sourceStandard },
    })).toEqual(['S M']);
  });
});

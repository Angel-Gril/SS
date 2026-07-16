import { describe, expect, it } from 'vitest';
import {
  validateOzonAttributeValues,
  type OzonAttributeValidationField,
} from '../services/ozon-attribute-validation.js';

const colorField: OzonAttributeValidationField = {
  key: 'color',
  attributeId: 1001,
  name: 'Цвет',
  valueType: 'STRING',
  cardinality: 'SINGLE',
  required: true,
  valuePolicy: 'STRICT_DICTIONARY',
  dictionaryComplete: true,
  dictionaryValues: [
    { id: 101, value: 'Красный' },
    { id: 102, value: 'Синий' },
  ],
  requiresRussianText: false,
  readinessImpact: 'OZON_IMPORT',
};

describe('authoritative Ozon attribute validation', () => {
  it('resolves a strict dictionary value by its official server-side ID', () => {
    const result = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [colorField],
      values: {
        color: {
          value: 'Красный',
          source: 'SOURCE',
          reviewed: true,
          evidence: ['source-profile:color'],
          dictionaryMatch: { status: 'MATCHED', dictionaryValueId: 101, canonicalValue: 'Красный' },
          dictionaryMatches: [{ inputValue: 'Красный', dictionaryValueId: 101, canonicalValue: 'Красный' }],
        },
      },
    });

    expect(result.status).toBe('VALID');
    expect(result.blockers).toEqual([]);
    expect(result.report.normalizedAttributes).toEqual([{
      key: 'color',
      attributeId: 1001,
      values: [{ value: 'Красный', dictionaryValueId: 101 }],
      source: 'SOURCE',
      reviewed: true,
      evidence: ['source-profile:color'],
    }]);
    expect(result.report.operationReadiness.ozonImport).toEqual({ status: 'READY', issues: [] });
  });

  it('normalizes SKU-matrix dictionary values separately for every selected SKU', () => {
    const result = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      selectedSkuKeys: ['sku-red', 'sku-blue'],
      fields: [{ ...colorField, ownership: 'SKU' }],
      values: {
        color: {
          value: null,
          source: 'SYSTEM',
          reviewed: true,
          skuValues: {
            'sku-red': {
              value: 'Красный', source: 'SOURCE', reviewed: true, evidence: ['sku:sku-red:color'],
              dictionaryMatches: [{ inputValue: 'Красный', dictionaryValueId: 101, canonicalValue: 'Красный' }],
            },
            'sku-blue': {
              value: 'Синий', source: 'MANUAL', reviewed: true, evidence: ['owner:sku-blue:color'],
              dictionaryMatches: [{ inputValue: 'Синий', dictionaryValueId: 102, canonicalValue: 'Синий' }],
            },
          },
        },
      },
    });

    expect(result.status).toBe('VALID');
    expect(result.report.fieldDecisions).toEqual([expect.objectContaining({ accepted: true, issueCodes: [] })]);
    expect(result.report.normalizedAttributes).toEqual([
      {
        key: 'color', skuKey: 'sku-red', attributeId: 1001,
        values: [{ value: 'Красный', dictionaryValueId: 101 }],
        source: 'SOURCE', reviewed: true, evidence: ['sku:sku-red:color'],
      },
      {
        key: 'color', skuKey: 'sku-blue', attributeId: 1001,
        values: [{ value: 'Синий', dictionaryValueId: 102 }],
        source: 'MANUAL', reviewed: true, evidence: ['owner:sku-blue:color'],
      },
    ]);
  });

  it('blocks a SKU-matrix field when any selected SKU is missing', () => {
    const result = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      selectedSkuKeys: ['sku-red', 'sku-blue'],
      fields: [{ ...colorField, ownership: 'SKU' }],
      values: {
        color: {
          value: null,
          source: 'SYSTEM',
          reviewed: true,
          skuValues: {
            'sku-red': {
              value: 'Красный', source: 'SOURCE', reviewed: true,
              dictionaryMatches: [{ inputValue: 'Красный', dictionaryValueId: 101, canonicalValue: 'Красный' }],
            },
          },
        },
      },
    });

    expect(result.status).toBe('INVALID');
    expect(result.report.fieldDecisions[0]).toMatchObject({
      accepted: false,
      issueCodes: ['OZON_ATTRIBUTE_SKU_VALUE_REQUIRED'],
    });
    expect(result.blockers).toContainEqual(expect.objectContaining({
      code: 'OZON_ATTRIBUTE_SKU_VALUE_REQUIRED',
      fieldPath: 'attributes.color.skuValues.sku-blue',
    }));
    expect(result.report.normalizedAttributes).toEqual([
      expect.objectContaining({ key: 'color', skuKey: 'sku-red' }),
    ]);
  });

  it('never treats a global aggregate as selected-SKU coverage', () => {
    const result = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      selectedSkuKeys: ['sku-red', 'sku-blue'],
      fields: [{ ...colorField, ownership: 'SKU' }],
      values: {
        color: {
          value: ['Красный', 'Синий'],
          source: 'SOURCE',
          reviewed: true,
          dictionaryMatches: [
            { inputValue: 'Красный', dictionaryValueId: 101, canonicalValue: 'Красный' },
            { inputValue: 'Синий', dictionaryValueId: 102, canonicalValue: 'Синий' },
          ],
        },
      },
    });

    expect(result.status).toBe('INVALID');
    expect(result.report.normalizedAttributes).toEqual([]);
    expect(result.blockers).toHaveLength(2);
    expect(result.blockers.every((entry) => entry.code === 'OZON_ATTRIBUTE_SKU_VALUE_REQUIRED')).toBe(true);
  });

  it('reports a single invalid SKU value at its SKU-scoped path', () => {
    const result = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      selectedSkuKeys: ['sku-red'],
      fields: [{ ...colorField, ownership: 'SKU' }],
      values: {
        color: {
          value: null,
          source: 'SYSTEM',
          reviewed: true,
          skuValues: {
            'sku-red': { value: 'Алый', source: 'SOURCE', reviewed: true },
          },
        },
      },
    });

    expect(result.status).toBe('INVALID');
    expect(result.report.normalizedAttributes).toEqual([]);
    expect(result.blockers[0]).toMatchObject({
      code: 'OZON_ATTRIBUTE_STRICT_DICTIONARY_REQUIRED',
      fieldPath: 'attributes.color.skuValues.sku-red',
    });
  });

  it('preserves a resolved SKU subset while unresolved strict values keep the field blocked', () => {
    const sizeField: OzonAttributeValidationField = {
      key: 'size',
      attributeId: 1002,
      name: 'Размер',
      valueType: 'STRING',
      cardinality: 'MULTI',
      ownership: 'SKU',
      required: true,
      valuePolicy: 'STRICT_DICTIONARY',
      dictionaryComplete: true,
      dictionaryValues: [{ id: 201, value: 'S' }],
      readinessImpact: 'OZON_IMPORT',
    };
    const result = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      selectedSkuKeys: ['sku-small'],
      fields: [sizeField],
      values: {
        size: {
          value: null,
          source: 'SYSTEM',
          reviewed: true,
          skuValues: {
            'sku-small': {
              value: ['S'],
              unresolvedValues: ['XL'],
              source: 'SOURCE',
              reviewed: true,
              dictionaryMatches: [{ inputValue: 'S', dictionaryValueId: 201, canonicalValue: 'S' }],
            },
          },
        },
      },
    });

    expect(result.status).toBe('INVALID');
    expect(result.report.fieldDecisions[0]).toMatchObject({
      accepted: false,
      issueCodes: ['OZON_ATTRIBUTE_STRICT_DICTIONARY_REQUIRED'],
    });
    expect(result.report.normalizedAttributes).toEqual([{
      key: 'size',
      skuKey: 'sku-small',
      attributeId: 1002,
      values: [{ value: 'S', dictionaryValueId: 201 }],
      source: 'SOURCE',
      reviewed: true,
      evidence: [],
    }]);
  });

  it('omits a strict dictionary text miss and blocks Ozon import', () => {
    const result = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [colorField],
      values: {
        color: {
          value: 'Алый',
          source: 'SOURCE',
          reviewed: true,
          evidence: ['source-profile:color'],
        },
      },
    });

    expect(result.status).toBe('INVALID');
    expect(result.report.normalizedAttributes).toEqual([]);
    expect(result.blockers).toEqual([expect.objectContaining({
      code: 'OZON_ATTRIBUTE_STRICT_DICTIONARY_REQUIRED',
      fieldPath: 'attributes.color',
    })]);
    expect(result.report.operationReadiness.ozonImport.status).toBe('BLOCKED');
  });

  it('labels validation that used an expired complete dictionary cache', () => {
    const result = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [{ ...colorField, dictionarySource: 'stale-cache', dictionaryWarning: 'refresh failed' }],
      values: {
        color: {
          value: 'Красный', source: 'SOURCE', reviewed: true,
          dictionaryMatch: { status: 'MATCHED', dictionaryValueId: 101, canonicalValue: 'Красный' },
        },
      },
    });

    expect(result.status).toBe('VALID');
    expect(result.warnings).toContainEqual(expect.objectContaining({
      code: 'OZON_ATTRIBUTE_DICTIONARY_STALE_CACHE',
      message: 'refresh failed',
    }));
  });

  it('rejects unsupported or label-mismatched dictionary IDs supplied by the client', () => {
    const unsupported = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [colorField],
      values: {
        color: { value: 'Красный', dictionaryValueId: 999, source: 'SOURCE', reviewed: true },
      },
    });
    const mismatched = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [colorField],
      values: {
        color: { value: 'Синий', dictionaryValueId: 101, source: 'SOURCE', reviewed: true },
      },
    });

    expect(unsupported.report.normalizedAttributes).toEqual([]);
    expect(unsupported.blockers[0]?.code).toBe('OZON_ATTRIBUTE_STRICT_DICTIONARY_REQUIRED');
    expect(mismatched.report.normalizedAttributes).toEqual([]);
    expect(mismatched.blockers[0]?.code).toBe('OZON_ATTRIBUTE_STRICT_DICTIONARY_REQUIRED');
  });

  it('accepts validated Russian free text and rejects non-Russian or CJK text', () => {
    const titleField: OzonAttributeValidationField = {
      key: 'title',
      attributeId: 2001,
      name: 'Название модели',
      valueType: 'STRING',
      cardinality: 'SINGLE',
      required: true,
      valuePolicy: 'FREE_TEXT',
      requiresRussianText: true,
      readinessImpact: 'OZON_IMPORT',
    };
    const valid = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [titleField],
      values: {
        title: { value: 'Женское платье 2026', source: 'SOURCE', reviewed: true },
      },
    });
    const latinOnly = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [titleField],
      values: {
        title: { value: 'Womens dress', source: 'SOURCE', reviewed: true },
      },
    });
    const mixedCjk = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [titleField],
      values: {
        title: { value: '女装 платье', source: 'SOURCE', reviewed: true },
      },
    });

    expect(valid.status).toBe('VALID');
    expect(valid.report.normalizedAttributes[0]?.values).toEqual([{ value: 'Женское платье 2026' }]);
    expect(latinOnly.blockers[0]?.code).toBe('OZON_ATTRIBUTE_RUSSIAN_TEXT_REQUIRED');
    expect(mixedCjk.blockers[0]?.code).toBe('OZON_ATTRIBUTE_RUSSIAN_TEXT_REQUIRED');
  });

  it('allows reviewed open-dictionary text but never accepts dictionary ID zero as an escape hatch', () => {
    const materialField: OzonAttributeValidationField = {
      key: 'material',
      attributeId: 3001,
      name: 'Материал',
      valueType: 'STRING',
      cardinality: 'SINGLE',
      required: true,
      valuePolicy: 'OPEN_DICTIONARY',
      dictionaryComplete: true,
      dictionaryValues: [{ id: 301, value: 'Хлопок' }],
      requiresRussianText: true,
      readinessImpact: 'OZON_IMPORT',
    };
    const official = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [materialField],
      values: {
        material: {
          value: 'Хлопок',
          source: 'SOURCE',
          reviewed: false,
          dictionaryMatch: { status: 'MATCHED', dictionaryValueId: 301, canonicalValue: 'Хлопок' },
        },
      },
    });
    const reviewedText = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [materialField],
      values: {
        material: { value: 'Лиоцелл', source: 'SOURCE', reviewed: true, evidence: ['source:composition'] },
      },
    });
    const zeroEscape = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [materialField],
      values: {
        material: { value: 'Лиоцелл', dictionaryValueId: 0, source: 'SOURCE', reviewed: false },
      },
    });

    expect(official.status).toBe('VALID');
    expect(official.report.normalizedAttributes[0]?.values).toEqual([{ value: 'Хлопок', dictionaryValueId: 301 }]);
    expect(reviewedText.status).toBe('VALID');
    expect(reviewedText.report.normalizedAttributes[0]?.values).toEqual([{ value: 'Лиоцелл' }]);
    expect(zeroEscape.report.normalizedAttributes).toEqual([]);
    expect(zeroEscape.blockers[0]?.code).toBe('OZON_ATTRIBUTE_DICTIONARY_ID_INVALID');
  });

  it('validates every multi-dictionary match against its input, ID, and canonical server value', () => {
    const sizeField: OzonAttributeValidationField = {
      key: 'sizes',
      attributeId: 3201,
      name: 'Размер',
      valueType: 'STRING',
      cardinality: 'MULTI',
      required: true,
      valuePolicy: 'STRICT_DICTIONARY',
      dictionaryComplete: true,
      dictionaryValues: [{ id: 321, value: 'S' }, { id: 322, value: 'M' }],
      readinessImpact: 'OZON_IMPORT',
    };
    const valid = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [sizeField],
      values: {
        sizes: {
          value: ['S', 'M'],
          source: 'SOURCE',
          reviewed: true,
          dictionaryMatches: [
            { inputValue: 'S', dictionaryValueId: 321, canonicalValue: 'S' },
            { inputValue: 'M', dictionaryValueId: 322, canonicalValue: 'M' },
          ],
        },
      },
    });
    const tampered = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [sizeField],
      values: {
        sizes: {
          value: ['S', 'M'],
          source: 'SOURCE',
          reviewed: true,
          dictionaryMatches: [
            { inputValue: 'M', dictionaryValueId: 321, canonicalValue: 'S' },
            { inputValue: 'M', dictionaryValueId: 322, canonicalValue: 'XL' },
          ],
        },
      },
    });

    expect(valid.status).toBe('VALID');
    expect(valid.report.normalizedAttributes[0]?.values).toEqual([
      { value: 'S', dictionaryValueId: 321 },
      { value: 'M', dictionaryValueId: 322 },
    ]);
    expect(tampered.status).toBe('INVALID');
    expect(tampered.report.normalizedAttributes).toEqual([]);
    expect(tampered.blockers[0]?.code).toBe('OZON_ATTRIBUTE_STRICT_DICTIONARY_REQUIRED');
  });

  it('fails an unknown value policy closed by applying strict dictionary rules', () => {
    const result = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [{ ...colorField, valuePolicy: 'UNPROVEN_PROVIDER_POLICY' }],
      values: {
        color: { value: 'Алый', source: 'SOURCE', reviewed: true },
      },
    });

    expect(result.status).toBe('INVALID');
    expect(result.blockers[0]?.code).toBe('OZON_ATTRIBUTE_STRICT_DICTIONARY_REQUIRED');
    expect(result.report.fieldDecisions[0]?.valuePolicy).toBe('STRICT_DICTIONARY');
  });

  it('preserves numeric multi-select values and rejects actual type or cardinality mismatches', () => {
    const quantityField: OzonAttributeValidationField = {
      key: 'quantities',
      attributeId: 4001,
      name: 'Количество в упаковке',
      valueType: 'INTEGER',
      cardinality: 'MULTI',
      required: true,
      valuePolicy: 'FREE_TEXT',
      readinessImpact: 'OZON_IMPORT',
    };
    const valid = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [quantityField],
      values: {
        quantities: { value: [1, 2], source: 'MANUAL', reviewed: true, evidence: ['owner:package-count'] },
      },
    });
    const wrongType = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [quantityField],
      values: {
        quantities: { value: [1, '2'], source: 'MANUAL', reviewed: true, evidence: ['owner:package-count'] },
      },
    });
    const wrongCardinality = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [quantityField],
      values: {
        quantities: { value: 1, source: 'MANUAL', reviewed: true, evidence: ['owner:package-count'] },
      },
    });

    expect(valid.status).toBe('VALID');
    expect(valid.report.normalizedAttributes[0]?.values).toEqual([{ value: 1 }, { value: 2 }]);
    expect(wrongType.blockers[0]?.code).toBe('OZON_ATTRIBUTE_TYPE_INVALID');
    expect(wrongType.report.normalizedAttributes).toEqual([]);
    expect(wrongCardinality.blockers[0]?.code).toBe('OZON_ATTRIBUTE_CARDINALITY_INVALID');
  });

  it('preserves decimal and boolean scalars while single fields reject arrays and unknown types fail closed', () => {
    const valid = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [
        {
          attributeId: 4101, name: 'Вес', valueType: 'DECIMAL', cardinality: 'SINGLE',
          required: true, valuePolicy: 'FREE_TEXT', readinessImpact: 'OZON_IMPORT',
        },
        {
          attributeId: 4102, name: 'Хрупкий товар', valueType: 'BOOLEAN', cardinality: 'SINGLE',
          required: true, valuePolicy: 'FREE_TEXT', readinessImpact: 'OZON_IMPORT',
        },
      ],
      values: {
        '4101': { value: 1.25, source: 'MANUAL', reviewed: true },
        '4102': { value: false, source: 'MANUAL', reviewed: true },
      },
    });
    const singleArray = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [{
        attributeId: 4101, name: 'Вес', valueType: 'DECIMAL', cardinality: 'SINGLE',
        required: true, valuePolicy: 'FREE_TEXT', readinessImpact: 'OZON_IMPORT',
      }],
      values: { '4101': { value: [1.25], source: 'MANUAL', reviewed: true } },
    });
    const unknownType = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [{
        attributeId: 4103, name: 'Будущий тип', valueType: 'PROVIDER_MAGIC', cardinality: 'SINGLE',
        required: true, valuePolicy: 'FREE_TEXT', readinessImpact: 'OZON_IMPORT',
      }],
      values: { '4103': { value: 'значение', source: 'MANUAL', reviewed: true } },
    });

    expect(valid.report.normalizedAttributes.map((row) => row.values[0]?.value)).toEqual([1.25, false]);
    expect(singleArray.blockers[0]?.code).toBe('OZON_ATTRIBUTE_CARDINALITY_INVALID');
    expect(unknownType.blockers[0]?.code).toBe('OZON_ATTRIBUTE_TYPE_UNSUPPORTED');
    expect(unknownType.report.normalizedAttributes).toEqual([]);
  });

  it('requires reviewed manual evidence for compliance-sensitive attributes', () => {
    const certificationField: OzonAttributeValidationField = {
      key: 'certification',
      attributeId: 5001,
      name: 'Сертификация',
      valueType: 'STRING',
      cardinality: 'SINGLE',
      required: true,
      valuePolicy: 'FREE_TEXT',
      requiresRussianText: true,
      complianceSensitive: true,
      readinessImpact: 'OZON_IMPORT',
    };
    const aiGuess = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [certificationField],
      values: {
        certification: {
          value: 'Декларация соответствия',
          source: 'AI',
          reviewed: true,
          evidence: ['ai:vision-guess'],
        },
      },
    });
    const manualWithoutEvidence = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [certificationField],
      values: {
        certification: { value: 'Декларация соответствия', source: 'MANUAL', reviewed: true },
      },
    });
    const manualConfirmed = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [certificationField],
      values: {
        certification: {
          value: 'Декларация соответствия',
          source: 'MANUAL',
          reviewed: true,
          evidence: ['owner-upload:certificate-77'],
          manualReview: 'CONFIRMED',
        },
      },
    });

    expect(aiGuess.blockers[0]?.code).toBe('OZON_ATTRIBUTE_COMPLIANCE_MANUAL_REQUIRED');
    expect(manualWithoutEvidence.blockers[0]?.code).toBe('OZON_ATTRIBUTE_COMPLIANCE_MANUAL_REQUIRED');
    expect(manualConfirmed.status).toBe('VALID');
    expect(manualConfirmed.report.normalizedAttributes[0]?.evidence).toEqual(['owner-upload:certificate-77']);
  });

  it('classifies missing facts by operation without blocking an otherwise valid Ozon import', () => {
    const missingResult = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [
        {
          key: 'manufacturer', attributeId: 6001, name: 'Производитель', valueType: 'STRING',
          cardinality: 'SINGLE', required: false, valuePolicy: 'FREE_TEXT', readinessImpact: 'OZON_IMPORT',
        },
        {
          key: 'stock', attributeId: 6002, name: 'Остаток', valueType: 'INTEGER',
          cardinality: 'SINGLE', required: false, valuePolicy: 'FREE_TEXT', readinessImpact: 'INVENTORY_ACTIVATION',
        },
        {
          key: 'freight', attributeId: 6003, name: 'Фрахт', valueType: 'DECIMAL',
          cardinality: 'SINGLE', required: false, valuePolicy: 'FREE_TEXT', readinessImpact: 'COSTING_AUTO_PRICING',
        },
        {
          key: 'marketing_note', attributeId: 6004, name: 'Примечание', valueType: 'STRING',
          cardinality: 'SINGLE', required: false, valuePolicy: 'FREE_TEXT', readinessImpact: 'WARNING',
        },
      ],
      values: {},
    });
    const requiredImportFact = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [{
        key: 'manufacturer', attributeId: 6001, name: 'Производитель', valueType: 'STRING',
        cardinality: 'SINGLE', required: true, valuePolicy: 'FREE_TEXT', readinessImpact: 'UNPROVEN_IMPACT',
      }],
      values: {},
    });

    expect(missingResult.status).toBe('VALID');
    expect(missingResult.blockers).toEqual([]);
    expect(missingResult.report.operationReadiness.ozonImport.status).toBe('READY');
    expect(missingResult.report.operationReadiness.inventoryActivation).toEqual({
      status: 'BLOCKED',
      issues: [expect.objectContaining({ fieldPath: 'attributes.stock' })],
    });
    expect(missingResult.report.operationReadiness.costingAutoPricing).toEqual({
      status: 'BLOCKED',
      issues: [expect.objectContaining({ fieldPath: 'attributes.freight' })],
    });
    expect(missingResult.warnings.map((row) => row.fieldPath)).toEqual([
      'attributes.stock',
      'attributes.freight',
      'attributes.marketing_note',
    ]);
    expect(requiredImportFact.status).toBe('INVALID');
    expect(requiredImportFact.blockers[0]?.fieldPath).toBe('attributes.manufacturer');
  });

  it('returns the exact authoritative shape accepted by recordValidationResult', () => {
    const result = validateOzonAttributeValues({
      schemaRevision: 'catalog-v7',
      fields: [],
      values: {},
    });
    const transitionInput: {
      status: 'VALID' | 'INVALID';
      report: Record<string, unknown>;
      blockers: Array<{ code: string; message: string; fieldPath?: string }>;
      warnings: Array<{ code: string; message: string; fieldPath?: string }>;
    } = result;

    expect(transitionInput).toEqual(result);
    expect(result.report.schemaVersion).toBe('ozon-attribute-validation/v1');
  });
});

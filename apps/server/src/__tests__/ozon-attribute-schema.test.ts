import { describe, expect, it } from 'vitest';
import type { OzonAttributeDefinition } from '../services/ozon-attribute-definition-cache.js';
import {
  buildOzonAttributeSchema,
  OzonAttributeSchemaError,
} from '../services/ozon-attribute-schema.js';

const cacheKey = {
  shopId: 'shop-pilot',
  descriptionCategoryId: 17028706,
  typeId: 95913,
  language: 'DEFAULT',
  catalogRevision: 'catalog-pilot-v1',
};

const pilotDefinitions = [
  {
    id: 4180,
    name: 'Product name',
    description: 'Buyer-facing title',
    type: 'String',
    isCollection: false,
    isRequired: true,
    dictionaryId: null,
  },
  {
    id: 85,
    name: 'Brand',
    description: '',
    type: 'String',
    isCollection: false,
    isRequired: true,
    dictionaryId: 100,
  },
  {
    id: 10096,
    name: 'Product color',
    description: '',
    type: 'String',
    isCollection: true,
    isRequired: true,
    dictionaryId: 1494,
  },
  {
    id: 4295,
    name: 'Russian size',
    description: '',
    type: 'String',
    isCollection: true,
    isRequired: true,
    dictionaryId: 835,
  },
  {
    id: 4496,
    name: 'Material',
    description: '',
    type: 'String',
    isCollection: true,
    isRequired: false,
    dictionaryId: null,
  },
  {
    id: 90001,
    name: 'Manufacturer',
    description: 'Legal manufacturer name',
    type: 'String',
    isCollection: false,
    isRequired: true,
    dictionaryId: null,
  },
  {
    id: 4389,
    name: 'Country of manufacture',
    description: '',
    type: 'String',
    isCollection: false,
    isRequired: true,
    dictionaryId: 900,
  },
  {
    id: 22336,
    name: 'Rich-content JSON',
    description: '',
    type: 'JSON',
    isCollection: false,
    isRequired: false,
    dictionaryId: null,
  },
  {
    id: 50001,
    name: 'Package count',
    description: '',
    type: 'Integer',
    isCollection: true,
    isRequired: false,
    dictionaryId: null,
  },
] satisfies OzonAttributeDefinition[];

function build(
  definitions: OzonAttributeDefinition[] = pilotDefinitions,
  overrides: Record<number, 'STRICT_DICTIONARY' | 'OPEN_DICTIONARY' | 'FREE_TEXT'> = {},
) {
  return buildOzonAttributeSchema({
    cacheKey,
    definitionCache: {
      definitions,
      definitionsHash: 'a'.repeat(64),
      complete: true,
    },
    officialValuePolicyByAttributeId: overrides,
  });
}

describe('normalized Ozon attribute schema', () => {
  it('normalizes a pilot category without losing type, cardinality, ownership or readiness semantics', () => {
    const schema = build();
    const field = (attributeId: number) => schema.fields.find((row) => row.attributeId === attributeId);

    expect(schema).toMatchObject({
      schemaVersion: 'ozon-attribute-schema/v1',
      ...cacheKey,
      definitionsHash: 'a'.repeat(64),
    });
    expect(schema.fields.map((row) => row.attributeId)).toEqual([
      85, 4180, 4295, 4389, 4496, 10096, 22336, 50001, 90001,
    ]);
    expect(field(4180)).toMatchObject({
      valueType: 'STRING', cardinality: 'SINGLE', required: true,
      valuePolicy: 'FREE_TEXT', ownership: 'SYSTEM', editorMode: 'READ_ONLY',
      aiSuggestionAllowed: false, requiresRussianText: true, readinessImpact: 'OZON_IMPORT',
    });
    expect(field(85)).toMatchObject({
      valuePolicy: 'STRICT_DICTIONARY', dictionaryId: 100,
      ownership: 'EDITOR', editorMode: 'EDITABLE', aiSuggestionAllowed: true,
      requiresRussianText: false,
    });
    expect(field(10096)).toMatchObject({
      valueType: 'STRING', cardinality: 'MULTI', valuePolicy: 'STRICT_DICTIONARY',
      ownership: 'SKU', editorMode: 'SKU_MATRIX', aiSuggestionAllowed: true,
      requiresRussianText: false,
    });
    expect(field(4496)).toMatchObject({
      cardinality: 'MULTI', valuePolicy: 'FREE_TEXT', ownership: 'EDITOR',
      readinessImpact: 'WARNING',
    });
    expect(field(50001)).toMatchObject({
      valueType: 'INTEGER', cardinality: 'MULTI', ownership: 'SKU',
      valuePolicy: 'FREE_TEXT', requiresRussianText: false,
    });
    expect(field(90001)).toMatchObject({
      ownership: 'COMPLIANCE', editorMode: 'MANUAL_REQUIRED', aiSuggestionAllowed: false,
      complianceSensitive: true, readinessImpact: 'OZON_IMPORT',
    });
    expect(field(4389)).toMatchObject({
      ownership: 'COMPLIANCE', valuePolicy: 'STRICT_DICTIONARY',
      editorMode: 'MANUAL_REQUIRED', complianceSensitive: true,
    });
    expect(field(22336)).toMatchObject({
      valueType: 'JSON', ownership: 'MEDIA', editorMode: 'MEDIA_WORKBENCH',
      aiSuggestionAllowed: false, requiresRussianText: false,
    });
  });

  it('emits an open dictionary only when explicit official policy proves it', () => {
    expect(build().fields.find((field) => field.attributeId === 85)?.valuePolicy)
      .toBe('STRICT_DICTIONARY');
    expect(build(pilotDefinitions, { 85: 'OPEN_DICTIONARY' }).fields
      .find((field) => field.attributeId === 85)?.valuePolicy)
      .toBe('OPEN_DICTIONARY');
    expect(build(pilotDefinitions.map((definition) => definition.id === 85
      ? { ...definition, valuePolicy: 'OPEN_DICTIONARY' as const }
      : definition)).fields.find((field) => field.attributeId === 85)?.valuePolicy)
      .toBe('OPEN_DICTIONARY');
  });

  it('preserves complete stale-cache provenance for readiness warnings', () => {
    const schema = buildOzonAttributeSchema({
      cacheKey,
      definitionCache: {
        definitions: pilotDefinitions,
        definitionsHash: 'a'.repeat(64),
        complete: true,
        source: 'stale-cache',
        warning: 'refresh timed out',
      },
    });

    expect(schema).toMatchObject({
      definitionSource: 'stale-cache',
      definitionWarning: 'refresh timed out',
    });
  });

  it('defaults an unknown official type and unknown value policy to strict manual review', () => {
    const schema = build([{
      id: 777,
      name: 'Future field',
      description: '',
      type: 'OzonFutureScalar',
      isCollection: false,
      isRequired: true,
      dictionaryId: null,
    }]);

    expect(schema.fields[0]).toMatchObject({
      sourceType: 'OzonFutureScalar',
      valueType: 'UNKNOWN',
      valuePolicy: 'STRICT_DICTIONARY',
      ownership: 'EDITOR',
      editorMode: 'MANUAL_REQUIRED',
      aiSuggestionAllowed: false,
    });
  });

  it('treats manufacturer size as a SKU dimension, not a legal manufacturer fact', () => {
    const schema = build([{
      id: 778,
      name: 'Manufacturer size',
      description: '',
      type: 'String',
      isCollection: true,
      isRequired: true,
      dictionaryId: 55,
    }]);

    expect(schema.fields[0]).toMatchObject({
      ownership: 'SKU',
      editorMode: 'SKU_MATRIX',
      complianceSensitive: false,
      requiresRussianText: false,
    });
  });

  it.each([
    ['String', 'STRING'],
    ['Integer', 'INTEGER'],
    ['Int64', 'INTEGER'],
    ['Decimal', 'DECIMAL'],
    ['Double', 'DECIMAL'],
    ['Boolean', 'BOOLEAN'],
    ['Date', 'DATE'],
    ['DateTime', 'DATETIME'],
    ['JSON', 'JSON'],
  ] as const)('maps official %s fields to %s', (sourceType, valueType) => {
    const schema = build([{
      id: 10,
      name: 'Generic field',
      description: '',
      type: sourceType,
      isCollection: false,
      isRequired: false,
      dictionaryId: null,
    }]);
    expect(schema.fields[0]).toMatchObject({ valueType, cardinality: 'SINGLE' });
  });

  it('rejects incomplete, empty, stale or impossible official policy inputs', () => {
    expect(() => buildOzonAttributeSchema({
      cacheKey,
      definitionCache: {
        definitions: pilotDefinitions,
        definitionsHash: 'a'.repeat(64),
        complete: false,
      },
    })).toThrowError(OzonAttributeSchemaError);
    expect(() => build([])).toThrowError(expect.objectContaining({
      code: 'OZON_ATTRIBUTE_SCHEMA_INVALID',
    }));
    expect(() => build(pilotDefinitions, { 999999: 'OPEN_DICTIONARY' }))
      .toThrow('Official value-policy override references an unknown attribute');
    expect(() => build([{
      id: 10,
      name: 'Free field',
      description: '',
      type: 'String',
      isCollection: false,
      isRequired: false,
      dictionaryId: null,
    }], { 10: 'OPEN_DICTIONARY' })).toThrow('Open dictionary policy requires a dictionary id');
  });
});

import type {
  OzonAttributeCardinality,
  OzonAttributeEditorMode,
  OzonAttributeOwnership,
  OzonAttributeValuePolicy,
  OzonAttributeValueType,
  OzonNormalizedAttributeField,
  OzonNormalizedAttributeSchema,
} from 'shared';
import type {
  OzonAttributeDefinition,
  OzonAttributeDefinitionCacheKey,
  OzonAttributeDefinitionCacheResult,
} from './ozon-attribute-definition-cache.js';

export type {
  OzonAttributeCardinality,
  OzonAttributeEditorMode,
  OzonAttributeOwnership,
  OzonAttributeValuePolicy,
  OzonAttributeValueType,
  OzonNormalizedAttributeField,
  OzonNormalizedAttributeSchema,
} from 'shared';

export interface BuildOzonAttributeSchemaInput {
  cacheKey: OzonAttributeDefinitionCacheKey;
  definitionCache: Pick<
    OzonAttributeDefinitionCacheResult,
    'definitions' | 'definitionsHash' | 'complete'
  > & Partial<Pick<OzonAttributeDefinitionCacheResult, 'source' | 'warning'>>;
  officialValuePolicyByAttributeId?: Readonly<Record<number, OzonAttributeValuePolicy>>;
}

export class OzonAttributeSchemaError extends Error {
  readonly code = 'OZON_ATTRIBUTE_SCHEMA_INVALID';
  readonly statusCode = 422;

  constructor(message: string) {
    super(message);
    this.name = 'OzonAttributeSchemaError';
  }
}

const VALUE_POLICIES = new Set<OzonAttributeValuePolicy>([
  'STRICT_DICTIONARY',
  'OPEN_DICTIONARY',
  'FREE_TEXT',
]);

const SYSTEM_ATTRIBUTE_IDS = new Set([4180, 4191, 8292]);
const NON_RUSSIAN_SYSTEM_ATTRIBUTE_IDS = new Set([8292]);
const SKU_ATTRIBUTE_IDS = new Set([
  4295,
  9533,
  9688,
  9689,
  9695,
  10096,
  10097,
]);
const COMPLIANCE_ATTRIBUTE_IDS = new Set([4389, 23536]);
const MEDIA_ATTRIBUTE_IDS = new Set([
  11254,
  13164,
  21837,
  21838,
  21839,
  21840,
  21841,
  21842,
  21843,
  21844,
  21845,
  21846,
  22336,
  22964,
  23255,
  23256,
]);

const SYSTEM_NAME_RE = /^(?:product name|product description|название товара|описание товара)$/iu;
const MEDIA_NAME_RE = /(?:rich[-\s]*content|rich[-\s]*контент|media|медиа|video|видео|cover|обложк|size\s*chart\s*json|таблиц[аы]\s+размеров\s+json)/iu;
const COMPLIANCE_NAME_RE = /(?:manufacturer|изготовител|производител|country\s+of\s+(?:origin|manufacture)|страна\s+(?:производства|изготовления)|certificate|сертифик|declaration|декларац|warranty|гарант|hazard|опасн|маркиров|тн\s*вэд|hs\s*code|(?:^|\s)(?:weight|вес)(?:\s|$)|габарит|dimensions?|(?:package|packaging|упаковк)[\s\p{L}-]*(?:height|width|depth|length|dimension|высот|ширин|длин)|(?:height|width|depth|length|высот|ширин|длин)[\s\p{L}-]*(?:package|packaging|упаковк))/iu;
const SKU_NAME_RE = /(?:color|colour|цвет|russian\s+size|manufacturer\s+size|российск[\p{L}\s-]*размер|размер\s+производител|volume|об[ъь]?ем|scent|fragrance|аромат|model|модель|package\s+count|pack\s+count|количеств[оа]\s+(?:в\s+)?(?:упаков|комплект)|яче(?:й|ек))/iu;

function cleanText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();
}

function positiveInt(value: unknown, field: string): number {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new OzonAttributeSchemaError(`Invalid ${field}`);
  }
  return number;
}

export function normalizeOzonAttributeValueType(sourceType: unknown): OzonAttributeValueType {
  const token = cleanText(sourceType).toLocaleLowerCase('en-US').replace(/[\s_-]+/g, '');
  if (['string', 'text', 'varchar'].includes(token)) return 'STRING';
  if (['integer', 'int', 'int32', 'int64', 'long'].includes(token)) return 'INTEGER';
  if (['decimal', 'double', 'float', 'number', 'numeric'].includes(token)) return 'DECIMAL';
  if (['boolean', 'bool'].includes(token)) return 'BOOLEAN';
  if (token === 'date') return 'DATE';
  if (['datetime', 'timestamp'].includes(token)) return 'DATETIME';
  if (['json', 'object'].includes(token)) return 'JSON';
  return 'UNKNOWN';
}

function ownershipFor(definition: OzonAttributeDefinition): OzonAttributeOwnership {
  const id = definition.id;
  const name = cleanText(definition.name);
  if (SYSTEM_ATTRIBUTE_IDS.has(id) || SYSTEM_NAME_RE.test(name)) return 'SYSTEM';
  if (MEDIA_ATTRIBUTE_IDS.has(id) || MEDIA_NAME_RE.test(name)) return 'MEDIA';
  if (SKU_ATTRIBUTE_IDS.has(id)) return 'SKU';
  if (SKU_NAME_RE.test(name)) return 'SKU';
  if (COMPLIANCE_ATTRIBUTE_IDS.has(id) || COMPLIANCE_NAME_RE.test(name)) return 'COMPLIANCE';
  return 'EDITOR';
}

function editorModeFor(
  ownership: OzonAttributeOwnership,
  valueType: OzonAttributeValueType,
): OzonAttributeEditorMode {
  if (valueType === 'UNKNOWN') return 'MANUAL_REQUIRED';
  if (ownership === 'SYSTEM') return 'READ_ONLY';
  if (ownership === 'SKU') return 'SKU_MATRIX';
  if (ownership === 'MEDIA') return 'MEDIA_WORKBENCH';
  if (ownership === 'COMPLIANCE') return 'MANUAL_REQUIRED';
  return 'EDITABLE';
}

function validatedPolicyOverrides(
  definitions: OzonAttributeDefinition[],
  rawOverrides: BuildOzonAttributeSchemaInput['officialValuePolicyByAttributeId'],
): Map<number, OzonAttributeValuePolicy> {
  const definitionIds = new Set(definitions.map((definition) => definition.id));
  const overrides = new Map<number, OzonAttributeValuePolicy>();
  for (const [rawAttributeId, rawPolicy] of Object.entries(rawOverrides || {})) {
    const attributeId = positiveInt(rawAttributeId, 'official value-policy attribute id');
    if (!definitionIds.has(attributeId)) {
      throw new OzonAttributeSchemaError(
        `Official value-policy override references an unknown attribute: ${attributeId}`,
      );
    }
    if (!VALUE_POLICIES.has(rawPolicy as OzonAttributeValuePolicy)) {
      throw new OzonAttributeSchemaError(`Invalid official value policy for attribute ${attributeId}`);
    }
    overrides.set(attributeId, rawPolicy as OzonAttributeValuePolicy);
  }
  return overrides;
}

function valuePolicyFor(
  definition: OzonAttributeDefinition,
  valueType: OzonAttributeValueType,
  override: OzonAttributeValuePolicy | undefined,
): OzonAttributeValuePolicy {
  const provenPolicy = override || definition.valuePolicy;
  if (provenPolicy === 'OPEN_DICTIONARY' && definition.dictionaryId === null) {
    throw new OzonAttributeSchemaError(
      `Open dictionary policy requires a dictionary id for attribute ${definition.id}`,
    );
  }
  if (provenPolicy) return provenPolicy;
  if (valueType === 'UNKNOWN') return 'STRICT_DICTIONARY';
  return definition.dictionaryId === null ? 'FREE_TEXT' : 'STRICT_DICTIONARY';
}

function normalizeDefinitions(definitions: OzonAttributeDefinition[]): OzonAttributeDefinition[] {
  const sorted = [...definitions].sort((left, right) => left.id - right.id);
  const seen = new Set<number>();
  for (const definition of sorted) {
    positiveInt(definition.id, 'attribute id');
    if (!cleanText(definition.name) || !cleanText(definition.type)) {
      throw new OzonAttributeSchemaError(`Invalid official definition for attribute ${definition.id}`);
    }
    if (seen.has(definition.id)) {
      throw new OzonAttributeSchemaError(`Duplicate official attribute definition ${definition.id}`);
    }
    seen.add(definition.id);
  }
  return sorted;
}

function normalizeField(
  definition: OzonAttributeDefinition,
  override: OzonAttributeValuePolicy | undefined,
): OzonNormalizedAttributeField {
  const valueType = normalizeOzonAttributeValueType(definition.type);
  const ownership = ownershipFor(definition);
  const cardinality: OzonAttributeCardinality = definition.isCollection ? 'MULTI' : 'SINGLE';
  const valuePolicy = valuePolicyFor(definition, valueType, override);
  return {
    attributeId: definition.id,
    name: cleanText(definition.name),
    description: cleanText(definition.description),
    sourceType: cleanText(definition.type),
    valueType,
    cardinality,
    required: definition.isRequired,
    dictionaryId: definition.dictionaryId,
    valuePolicy,
    ownership,
    editorMode: editorModeFor(ownership, valueType),
    aiSuggestionAllowed: valueType !== 'UNKNOWN'
      && (ownership === 'SKU' || ownership === 'EDITOR'),
    complianceSensitive: ownership === 'COMPLIANCE',
    requiresRussianText: valueType === 'STRING'
      && valuePolicy !== 'STRICT_DICTIONARY'
      && ownership !== 'MEDIA'
      && ownership !== 'SKU'
      && !NON_RUSSIAN_SYSTEM_ATTRIBUTE_IDS.has(definition.id),
    readinessImpact: definition.isRequired ? 'OZON_IMPORT' : 'WARNING',
  };
}

export function buildOzonAttributeSchema(
  input: BuildOzonAttributeSchemaInput,
): OzonNormalizedAttributeSchema {
  const shopId = cleanText(input.cacheKey.shopId);
  const descriptionCategoryId = positiveInt(
    input.cacheKey.descriptionCategoryId,
    'description category id',
  );
  const typeId = positiveInt(input.cacheKey.typeId, 'type id');
  const language = cleanText(input.cacheKey.language) || 'DEFAULT';
  const catalogRevision = cleanText(input.cacheKey.catalogRevision);
  const definitionsHash = cleanText(input.definitionCache.definitionsHash).toLocaleLowerCase('en-US');
  if (!shopId || !catalogRevision) {
    throw new OzonAttributeSchemaError('Attribute schema requires shopId and catalogRevision');
  }
  if (input.definitionCache.complete !== true) {
    throw new OzonAttributeSchemaError('A complete official definition cache is required');
  }
  if (!/^[a-f0-9]{64}$/.test(definitionsHash)) {
    throw new OzonAttributeSchemaError('Attribute schema requires a valid definitions hash');
  }
  if (!Array.isArray(input.definitionCache.definitions) || !input.definitionCache.definitions.length) {
    throw new OzonAttributeSchemaError('Attribute schema requires official definitions');
  }

  const definitions = normalizeDefinitions(input.definitionCache.definitions);
  const overrides = validatedPolicyOverrides(
    definitions,
    input.officialValuePolicyByAttributeId,
  );
  return {
    schemaVersion: 'ozon-attribute-schema/v1',
    shopId,
    descriptionCategoryId,
    typeId,
    language,
    catalogRevision,
    definitionsHash,
    ...(input.definitionCache.source ? { definitionSource: input.definitionCache.source } : {}),
    ...(cleanText(input.definitionCache.warning)
      ? { definitionWarning: cleanText(input.definitionCache.warning) }
      : {}),
    fields: definitions.map((definition) => normalizeField(
      definition,
      overrides.get(definition.id),
    )),
  };
}

import type {
  OzonNormalizedAttributeField,
  SourceStandardAttributes,
} from 'shared';
import { buildSourceStandardOzonAttributePlan } from '../routes/collect.js';

type SourceStandardDictionaryFieldKey =
  | 'brand'
  | 'colors'
  | 'sizes'
  | 'materials'
  | 'gender'
  | 'seasons';

export interface SourceStandardDictionaryValueAliases {
  sourceValue: string;
  aliases: string[];
}

export interface SourceStandardDictionaryAggregateCandidate {
  value: string;
  sourceValues: string[];
}

export interface SourceStandardDictionaryAliasPlan {
  standardKey: SourceStandardDictionaryFieldKey | null;
  valueAliases: SourceStandardDictionaryValueAliases[];
  aggregateCandidate: SourceStandardDictionaryAggregateCandidate | null;
}

interface SourceStandardDictionaryAliasesInput {
  field: OzonNormalizedAttributeField;
  value: unknown;
  sourceContext: { sourceStandard?: SourceStandardAttributes | null };
}

function normalizedText(value: unknown): string {
  return String(value ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim().toLocaleLowerCase();
}

function uniqueStrings(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = String(raw ?? '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
    const key = normalizedText(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function attributeDefinition(field: OzonNormalizedAttributeField) {
  return {
    id: field.attributeId,
    name: field.name,
    is_required: field.required,
    ...(field.dictionaryId ? { dictionary_id: field.dictionaryId } : {}),
  };
}

function sourceValues(
  standard: SourceStandardAttributes,
  key: SourceStandardDictionaryFieldKey,
): string[] {
  if (key === 'brand') {
    if (standard.brand.isBrandless) return ['Без бренда'];
    return uniqueStrings([standard.brand.value]);
  }
  if (key === 'gender') return uniqueStrings([standard.gender.value]);
  return uniqueStrings(standard[key]);
}

function withSingleSourceValue(
  standard: SourceStandardAttributes,
  key: SourceStandardDictionaryFieldKey,
  value: string,
): SourceStandardAttributes {
  const isolated: SourceStandardAttributes = {
    ...standard,
    brand: { ...standard.brand },
    colors: [],
    sizes: [],
    materials: [],
    gender: { ...standard.gender },
    seasons: [],
    categoryHints: [...standard.categoryHints],
    missingForOzon: [...standard.missingForOzon],
  };
  if (key === 'brand') {
    isolated.brand = {
      ...isolated.brand,
      value: standard.brand.isBrandless ? '' : value,
      isBrandless: standard.brand.isBrandless && normalizedText(value) === normalizedText('Без бренда'),
    };
  } else if (key === 'gender') {
    isolated.gender = { ...isolated.gender, value };
  } else {
    isolated[key] = [value];
  }
  return isolated;
}

function projectedCandidateValues(
  standard: SourceStandardAttributes,
  field: OzonNormalizedAttributeField,
): { key: SourceStandardDictionaryFieldKey; values: string[] } | null {
  const candidate = buildSourceStandardOzonAttributePlan(
    standard as unknown as Record<string, unknown>,
    [attributeDefinition(field)],
  ).candidates[0];
  if (!candidate) return null;
  return { key: candidate.standardKey, values: uniqueStrings(candidate.values) };
}

export function buildSourceStandardDictionaryAliasPlan(input: {
  field: OzonNormalizedAttributeField;
  sourceStandard?: SourceStandardAttributes | null;
}): SourceStandardDictionaryAliasPlan {
  const standard = input.sourceStandard;
  if (!standard) return { standardKey: null, valueAliases: [], aggregateCandidate: null };

  const fieldProjection = projectedCandidateValues(standard, input.field);
  if (!fieldProjection) return { standardKey: null, valueAliases: [], aggregateCandidate: null };
  const rawValues = sourceValues(standard, fieldProjection.key);

  const valueAliases = rawValues.map((sourceValue) => {
    const isolatedProjection = projectedCandidateValues(
      withSingleSourceValue(standard, fieldProjection.key, sourceValue),
      input.field,
    );
    const aliases = isolatedProjection?.key === fieldProjection.key
      && isolatedProjection.values.length === 1
      ? isolatedProjection.values.filter((alias) => normalizedText(alias) !== normalizedText(sourceValue))
      : [];
    return { sourceValue, aliases };
  });

  const aggregateValue = fieldProjection.values.length === 1 ? fieldProjection.values[0] : undefined;
  const aggregateCandidate = fieldProjection.key === 'colors'
    && rawValues.length > 5
    && normalizedText(aggregateValue) === normalizedText('Разноцветный')
    ? { value: aggregateValue!, sourceValues: rawValues }
    : null;

  return {
    standardKey: fieldProjection.key,
    valueAliases,
    aggregateCandidate,
  };
}

export function sourceStandardDictionaryAliases(
  input: SourceStandardDictionaryAliasesInput,
): unknown[] {
  const plan = buildSourceStandardDictionaryAliasPlan({
    field: input.field,
    sourceStandard: input.sourceContext.sourceStandard,
  });
  const inputKey = normalizedText(input.value);
  const mapped = plan.valueAliases.find((entry) => normalizedText(entry.sourceValue) === inputKey);
  if (mapped) {
    const officialAliases = plan.standardKey === 'brand' && inputKey === normalizedText('Без бренда')
      ? ['Нет бренда']
      : plan.standardKey === 'materials' && inputKey === 'pe'
        ? ['Полиэтилен']
        : [];
    return [input.value, ...mapped.aliases, ...officialAliases];
  }

  // Aggregate aliases belong to the aggregate candidate itself, never to one contributing source value.
  if (plan.aggregateCandidate && normalizedText(plan.aggregateCandidate.value) === inputKey) {
    return [input.value, plan.aggregateCandidate.value];
  }
  return [input.value];
}

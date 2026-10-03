import { createHash } from 'crypto';
import type {
  OzonListingDraft,
  OzonListingDraftAttributeValue,
  OzonListingDraftCategory,
  OzonNormalizedAttributeField,
  OzonNormalizedAttributeSchema,
  SourceStandardAttributes,
} from 'shared';
import {
  buildOzonAttributeSuggestions,
  type OzonAttributeAiCandidate,
  type OzonAttributeDictionaryMatch,
  type OzonAttributeSuggestion,
  type OzonAttributeSuggestionBlock,
  type OzonAttributeSuggestionEvidence,
  type OzonAttributeSuggestionResult,
  type OzonStandardAttributeEvidence,
  type OzonStandardAttributeSuggestionKey,
} from './ozon-attribute-suggestions.js';
import {
  validateOzonAttributeValues,
  type OzonAttributeValidationField,
  type OzonAttributeValidationResult,
} from './ozon-attribute-validation.js';
import type { SourceProductProfile } from './source-product-profile.js';
import { buildOzonAttributeSuggestionProvenance } from './ozon-attribute-suggestion-provenance.js';
import { SOURCE_LISTING_SKU_PACKAGING_CONTRACT_VERSION, type OzonListingSkuPackagingFacts } from 'shared';
import { hasSourceListingSkuPackaging, projectSourceListingSkuPackaging } from './source-listing-sku-packaging.js';

const CATEGORY_INDEPENDENT_MANUAL_FACT_KEYS = new Set([
  'packaging',
  'packageWeightG',
  'packageLengthMm',
  'packageWidthMm',
  'packageHeightMm',
]);

export interface SourceListingAttributeSourceContext {
  sourceProfile: SourceProductProfile;
  sourceStandard?: SourceStandardAttributes | null;
  sourceStandardEvidence?: Partial<Record<
    OzonStandardAttributeSuggestionKey,
    OzonStandardAttributeEvidence
  >>;
  skuStandards?: Record<string, {
    sourceStandard: SourceStandardAttributes;
    sourceStandardEvidence?: Partial<Record<
      OzonStandardAttributeSuggestionKey,
      OzonStandardAttributeEvidence
    >>;
  }>;
  allowSourceProfileFallback?: boolean;
  evidence?: OzonAttributeSuggestionEvidence[];
  aiCandidates?: OzonAttributeAiCandidate[];
  operationalFacts?: {
    packageWeightG: number | null;
    packageLengthMm: number | null;
    packageWidthMm: number | null;
    packageHeightMm: number | null;
    selectedStock: { known: number; unknown: number };
    shippingCny: number | null;
    evidence: Record<string, string>;
    requirements: {
      packageWeightForImport: boolean;
      packageDimensionsForImport: boolean;
      importContract: {
        contractId: string;
        contractRevision: string;
        contractHash: string;
      };
    };
  };
}

export type SourceListingAttributeFreshness =
  | 'CACHE_ALLOWED'
  | 'OFFICIAL_REFRESH_REQUIRED'
  | 'PUBLISH_CACHE_REQUIRED';

export interface SourceListingAttributeSuggestionReference {
  attributeId: number;
  candidateId: string;
  candidateHash: string;
  schemaRevision: string;
}

export interface SourceListingFrozenAttributeSuggestion extends OzonAttributeSuggestion {
  candidateId: string;
  candidateHash: string;
  schemaRevision: string;
  draftRevision: number;
  draftVersion: number;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
}

export interface SourceListingAttributeDictionary {
  complete: boolean;
  values: Array<{ id: number; value?: string | null }>;
  source?: 'cache' | 'ozon_api' | 'stale-cache';
  warning?: string;
}

export interface SourceListingAttributeDictionarySearchResult {
  scope: 'SEARCH_RESULTS';
  catalogRevision: string;
  values: Array<{ id: number; value?: string | null }>;
  source: 'cache' | 'ozon_api' | 'stale-cache';
  resultExhaustive: boolean;
  warning?: string;
}

export interface SourceListingAttributeManualChange {
  attributeId: number;
  skuKey?: string;
  action?: 'SET' | 'CLEAR';
  value?: unknown;
  dictionaryValueId?: number;
  dictionaryValueIds?: number[];
  evidence: string[];
}

export interface SourceListingAttributeSuggestionBlock extends OzonAttributeSuggestionBlock {
  skuKey?: string;
  fieldPath?: string;
}

export interface SourceListingAttributeWorkspace {
  schema: OzonNormalizedAttributeSchema;
  schemaRevision: string;
  values: Record<string, OzonListingDraftAttributeValue>;
  suggestions: Record<string, SourceListingFrozenAttributeSuggestion>;
  blockedSuggestions: SourceListingAttributeSuggestionBlock[];
  validationPreview: OzonAttributeValidationResult;
}

export interface SourceListingWorkflowAttributeServiceOptions {
  loadSchema(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    category: OzonListingDraftCategory;
    freshness: SourceListingAttributeFreshness;
  }): Promise<OzonNormalizedAttributeSchema>;
  loadSourceContext(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
  }): Promise<SourceListingAttributeSourceContext>;
  loadDictionary(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    schema: OzonNormalizedAttributeSchema;
    field: OzonNormalizedAttributeField;
    freshness: SourceListingAttributeFreshness;
  }): Promise<SourceListingAttributeDictionary>;
  searchDictionary?(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    schema: OzonNormalizedAttributeSchema;
    field: OzonNormalizedAttributeField;
    queries: string[];
    freshness: Exclude<SourceListingAttributeFreshness, 'PUBLISH_CACHE_REQUIRED'>;
  }): Promise<SourceListingAttributeDictionarySearchResult>;
  dictionaryAliases?(input: {
    field: OzonNormalizedAttributeField;
    value: unknown;
    sourceContext: SourceListingAttributeSourceContext;
  }): unknown[] | Promise<unknown[]>;
}

export class SourceListingWorkflowAttributeError extends Error {
  constructor(
    public readonly code:
      | 'OZON_ATTRIBUTE_CATEGORY_REQUIRED'
      | 'OZON_ATTRIBUTE_SCHEMA_MISMATCH'
      | 'OZON_ATTRIBUTE_FIELD_UNKNOWN'
      | 'OZON_ATTRIBUTE_FIELD_READ_ONLY'
      | 'OZON_ATTRIBUTE_DICTIONARY_UNAVAILABLE'
      | 'OZON_ATTRIBUTE_VALUE_INVALID'
      | 'OZON_ATTRIBUTE_SUGGESTION_UNAVAILABLE'
      | 'OZON_ATTRIBUTE_SUGGESTION_STALE',
    public readonly statusCode: 409 | 422 | 503,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'SourceListingWorkflowAttributeError';
  }
}

function persistedSuggestionProvenance(
  suggestion: SourceListingFrozenAttributeSuggestion,
  attributeId: number,
  evidenceDetails: unknown,
) {
  try {
    return buildOzonAttributeSuggestionProvenance({
      attributeId,
      candidateId: suggestion.candidateId,
      candidateHash: suggestion.candidateHash,
      schemaRevision: suggestion.schemaRevision,
      sourceCaptureSnapshotId: suggestion.sourceCaptureSnapshotId,
      sourceCaptureHash: suggestion.sourceCaptureHash,
      draftVersion: suggestion.draftVersion,
      draftRevision: suggestion.draftRevision,
      evidenceDetails,
    });
  } catch {
    throw new SourceListingWorkflowAttributeError(
      'OZON_ATTRIBUTE_SUGGESTION_UNAVAILABLE',
      422,
      `Attribute suggestion ${attributeId} provenance exceeds the persistence contract`,
    );
  }
}

function normalizedText(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function uniqueEvidence(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || '').normalize('NFKC').trim()).filter(Boolean))]
    .slice(0, 20);
}

function schemaRevision(schema: OzonNormalizedAttributeSchema): string {
  return createHash('sha256').update(JSON.stringify({
    schemaVersion: schema.schemaVersion,
    shopId: schema.shopId,
    descriptionCategoryId: schema.descriptionCategoryId,
    typeId: schema.typeId,
    language: schema.language,
    catalogRevision: schema.catalogRevision,
    definitionsHash: schema.definitionsHash,
  })).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function freezeSuggestionResult(input: {
  draft: OzonListingDraft;
  schemaRevision: string;
  result: {
    suggestions: Record<string, OzonAttributeSuggestion>;
    blocked: SourceListingAttributeSuggestionBlock[];
  };
}): {
  suggestions: Record<string, SourceListingFrozenAttributeSuggestion>;
  blocked: SourceListingAttributeSuggestionBlock[];
} {
  const suggestions = Object.fromEntries(Object.entries(input.result.suggestions).map(([key, suggestion]) => {
    const relatedBlocks = input.result.blocked.filter((block) => block.attributeId === suggestion.attributeId);
    const unresolved = relatedBlocks
      .filter((block) => block.reasonCode === 'STRICT_DICTIONARY_UNRESOLVED')
      .flatMap((block) => block.unsupportedValues);
    const snapshot = {
      ...structuredClone(suggestion),
      ...(unresolved.length ? { unresolvedValues: structuredClone(unresolved) } : {}),
    };
    const candidateHash = createHash('sha256').update(canonicalJson({
      schemaRevision: input.schemaRevision,
      draftId: input.draft.id,
      draftRevision: input.draft.revision,
      draftVersion: input.draft.draftVersion,
      sourceCaptureSnapshotId: input.draft.sourceCaptureSnapshotId,
      sourceCaptureHash: input.draft.sourceCaptureHash,
      selectedSkuKeys: input.draft.selectedSkuKeys,
      suggestion: snapshot,
      relatedBlocks,
    })).digest('hex');
    return [key, {
      ...snapshot,
      candidateId: `attribute-suggestion:${suggestion.attributeId}:${candidateHash.slice(0, 24)}`,
      candidateHash,
      schemaRevision: input.schemaRevision,
      draftRevision: input.draft.revision,
      draftVersion: input.draft.draftVersion,
      sourceCaptureSnapshotId: input.draft.sourceCaptureSnapshotId,
      sourceCaptureHash: input.draft.sourceCaptureHash,
    }];
  }));
  return { suggestions, blocked: input.result.blocked };
}

function categoryFor(draft: OzonListingDraft): OzonListingDraftCategory {
  if (!draft.category) {
    throw new SourceListingWorkflowAttributeError(
      'OZON_ATTRIBUTE_CATEGORY_REQUIRED',
      409,
      'Confirm an Ozon category before preparing attributes',
    );
  }
  return draft.category;
}

function assertSchemaContext(
  draft: OzonListingDraft,
  category: OzonListingDraftCategory,
  schema: OzonNormalizedAttributeSchema,
): void {
  if (schema.shopId !== draft.shopId
    || schema.descriptionCategoryId !== category.categoryId
    || schema.typeId !== category.typeId
    || schema.catalogRevision !== category.catalogRevision) {
    throw new SourceListingWorkflowAttributeError(
      'OZON_ATTRIBUTE_SCHEMA_MISMATCH',
      409,
      'The official Ozon attribute schema does not match the current draft context',
    );
  }
}

function fieldValues(value: unknown, field: OzonNormalizedAttributeField): unknown[] | null {
  if (field.cardinality === 'MULTI') {
    return Array.isArray(value) && value.length ? value : null;
  }
  if (field.cardinality === 'SINGLE') {
    return Array.isArray(value) ? null : [value];
  }
  return null;
}

function normalizedDictionary(dictionary: SourceListingAttributeDictionary) {
  return dictionary.values
    .map((entry) => ({ id: Number(entry.id), value: String(entry.value || '').normalize('NFKC').trim() }))
    .filter((entry) => Number.isSafeInteger(entry.id) && entry.id > 0 && entry.value);
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const run = async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(values[index]!, index);
    }
  };
  await Promise.all(Array.from(
    { length: Math.min(Math.max(1, concurrency), values.length) },
    () => run(),
  ));
  return results;
}

function validationError(result: OzonAttributeValidationResult): SourceListingWorkflowAttributeError {
  const first = result.blockers[0] || result.warnings[0];
  return new SourceListingWorkflowAttributeError(
    'OZON_ATTRIBUTE_VALUE_INVALID',
    422,
    first?.message || 'The Ozon attribute value is invalid',
  );
}

function confirmedManualNumber(
  draft: OzonListingDraft,
  key: string,
): { value: number; evidence: string[] } | null {
  const value = draft.attributes.values[key];
  const number = value?.value;
  if (value?.source === 'MANUAL'
    && value.reviewed === true
    && (value.evidence?.length || 0) > 0
    && typeof number === 'number'
    && Number.isFinite(number)
    && number > 0) return { value: number, evidence: [...value.evidence!] };
  const packaging = draft.attributes.values.packaging;
  const packagingValue = packaging?.value && typeof packaging.value === 'object' && !Array.isArray(packaging.value)
    ? packaging.value as Record<string, unknown>
    : {};
  const packagingKey = ({
    packageWeightG: 'weightG',
    packageLengthMm: 'lengthMm',
    packageWidthMm: 'widthMm',
    packageHeightMm: 'heightMm',
  } as Record<string, string>)[key];
  const packagingNumber = packagingKey ? packagingValue[packagingKey] : undefined;
  return packaging?.source === 'MANUAL'
    && packaging.reviewed === true
    && (packaging.evidence?.length || 0) > 0
    && typeof packagingNumber === 'number'
    && Number.isFinite(packagingNumber)
    && packagingNumber > 0
    ? { value: packagingNumber, evidence: [...packaging.evidence!] }
    : null;
}

function fieldAccepted(result: OzonAttributeValidationResult, attributeId: number): boolean {
  return result.report.fieldDecisions.some((decision) => (
    decision.attributeId === attributeId && decision.accepted === true
  ));
}

function normalizedSkuKey(value: unknown): string {
  return String(value ?? '').normalize('NFKC').trim();
}

function selectedSkuKeys(draft: OzonListingDraft): string[] {
  return [...new Set(draft.selectedSkuKeys.map(normalizedSkuKey).filter(Boolean))];
}

function sourceContextForSku(
  sourceContext: SourceListingAttributeSourceContext,
  skuKey: string,
): SourceListingAttributeSourceContext {
  const skuStandard = sourceContext.skuStandards?.[skuKey];
  return {
    ...sourceContext,
    sourceStandard: skuStandard?.sourceStandard ?? null,
    sourceStandardEvidence: skuStandard?.sourceStandardEvidence,
    allowSourceProfileFallback: false,
    aiCandidates: [],
  };
}

function composeSkuAttributeValue(
  base: OzonListingDraftAttributeValue,
  skuValues: Record<string, OzonListingDraftAttributeValue>,
  skuKeys: string[],
): OzonListingDraftAttributeValue {
  const selectedLeaves = skuKeys
    .map((skuKey) => skuValues[skuKey])
    .filter((value): value is OzonListingDraftAttributeValue => value != null);
  const representative = selectedLeaves[0] || Object.values(skuValues)[0] || base;
  const sources = new Set(selectedLeaves.map((value) => value.source));
  const source = sources.size === 1
    ? selectedLeaves[0]!.source
    : sources.has('MANUAL')
      ? 'MANUAL'
      : sources.has('AI')
        ? 'AI'
        : sources.has('SOURCE')
          ? 'SOURCE'
          : representative.source;
  const dictionaryStatuses = selectedLeaves
    .map((value) => value.dictionaryMatch?.status)
    .filter((status) => status != null);
  const dictionaryStatus = dictionaryStatuses.length > 0
    && dictionaryStatuses.every((status) => status === 'NOT_APPLICABLE')
    ? 'NOT_APPLICABLE'
    : dictionaryStatuses.length > 0
      && dictionaryStatuses.every((status) => status === 'MATCHED')
      ? 'MATCHED'
      : dictionaryStatuses.some((status) => status === 'UNSUPPORTED')
        ? 'UNSUPPORTED'
        : 'UNRESOLVED';
  const manualReview = selectedLeaves.some((value) => value.manualReview === 'REQUIRED')
    ? 'REQUIRED'
    : selectedLeaves.length > 0
      && selectedLeaves.every((value) => value.manualReview === 'NOT_REQUIRED')
      ? 'NOT_REQUIRED'
      : 'CONFIRMED';
  const confidenceValues = selectedLeaves
    .map((value) => Number(value.confidence))
    .filter((value) => Number.isFinite(value));
  const unresolvedValues = selectedLeaves.flatMap((value) => value.unresolvedValues || []);
  return {
    value: structuredClone(representative.value),
    source,
    reviewed: skuKeys.length > 0
      && skuKeys.every((skuKey) => skuValues[skuKey]?.reviewed === true),
    evidence: uniqueEvidence(selectedLeaves.flatMap((value) => value.evidence || [])),
    ...(confidenceValues.length ? { confidence: Math.min(...confidenceValues) } : {}),
    dictionaryMatch: {
      status: dictionaryStatus,
      dictionaryValueId: selectedLeaves.length === 1
        ? selectedLeaves[0]?.dictionaryMatch?.dictionaryValueId ?? null
        : null,
      ...(selectedLeaves.length === 1 && selectedLeaves[0]?.dictionaryMatch?.canonicalValue != null
        ? { canonicalValue: selectedLeaves[0].dictionaryMatch.canonicalValue }
        : {}),
    },
    dictionaryMatches: selectedLeaves.flatMap((value) => value.dictionaryMatches || []),
    ...(unresolvedValues.length
      ? { unresolvedValues: structuredClone(unresolvedValues) }
      : {}),
    skuValues: structuredClone(skuValues),
    manualReview,
  };
}

function effectiveAttributeValues(
  schema: OzonNormalizedAttributeSchema,
  draft: OzonListingDraft,
): Record<string, OzonListingDraftAttributeValue> {
  const values = structuredClone(draft.attributes.values);
  for (const field of schema.fields) {
    if (field.ownership !== 'SYSTEM') continue;
    const value = field.attributeId === 4180
      ? draft.copy.publishTitleRu
      : field.attributeId === 4191
        ? draft.copy.publishDescriptionRu
        : field.attributeId === 8292
          ? `source-${draft.supplyGoodsId}`
          : null;
    if (value == null || String(value).trim() === '') {
      delete values[String(field.attributeId)];
      continue;
    }
    values[String(field.attributeId)] = {
      value,
      source: 'SYSTEM',
      reviewed: true,
      evidence: [field.attributeId === 8292 ? 'workflow:stable-source-identity' : 'workflow:reviewed-publish-copy'],
      confidence: 1,
      dictionaryMatch: { status: 'NOT_APPLICABLE', dictionaryValueId: null },
      dictionaryMatches: [],
      manualReview: 'NOT_REQUIRED',
    };
  }
  return values;
}

function withOperationalReadiness(
  result: OzonAttributeValidationResult,
  draft: OzonListingDraft,
  context: SourceListingAttributeSourceContext,
): OzonAttributeValidationResult {
  const facts = context.operationalFacts;
  if (!facts) return result;
  const next = structuredClone(result);
  const importIssues = next.report.operationReadiness.ozonImport.issues;
  const inventoryIssues = next.report.operationReadiness.inventoryActivation.issues;
  const costingIssues = next.report.operationReadiness.costingAutoPricing.issues;
  const usesSkuPackaging = hasSourceListingSkuPackaging(draft);
  let skuPackaging: OzonListingSkuPackagingFacts | null = null;
  if (usesSkuPackaging) {
    try {
      const items = projectSourceListingSkuPackaging(draft)!;
      skuPackaging = { contractVersion: SOURCE_LISTING_SKU_PACKAGING_CONTRACT_VERSION,
        items: Object.fromEntries(items.map(({ skuKey, ...value }) => [skuKey, value])) };
    } catch {
      importIssues.push({ code: 'OZON_PACKAGE_SKU_PACKAGING_INVALID',
        message: 'Every selected SKU requires a complete reviewed manual package', fieldPath: 'attributes.packaging.skuValues' });
    }
  }
  const manualWeight = confirmedManualNumber(draft, 'packageWeightG');
  const manualLength = confirmedManualNumber(draft, 'packageLengthMm');
  const manualWidth = confirmedManualNumber(draft, 'packageWidthMm');
  const manualHeight = confirmedManualNumber(draft, 'packageHeightMm');
  const weight = usesSkuPackaging ? null : manualWeight?.value ?? facts.packageWeightG;
  const dimensions = {
    lengthMm: usesSkuPackaging ? null : manualLength?.value ?? facts.packageLengthMm,
    widthMm: usesSkuPackaging ? null : manualWidth?.value ?? facts.packageWidthMm,
    heightMm: usesSkuPackaging ? null : manualHeight?.value ?? facts.packageHeightMm,
  };
  if (!usesSkuPackaging && facts.requirements.packageWeightForImport && weight == null) {
    importIssues.push({
      code: 'OZON_PACKAGE_WEIGHT_REQUIRED',
      message: 'Ozon product import requires a confirmed package weight',
      fieldPath: 'operational.packageWeightG',
    });
  }
  if (!usesSkuPackaging && facts.requirements.packageDimensionsForImport
    && Object.values(dimensions).some((value) => value == null)) {
    importIssues.push({
      code: 'OZON_PACKAGE_DIMENSIONS_REQUIRED',
      message: 'Ozon product import requires confirmed package length, width and height',
      fieldPath: 'operational.packageDimensionsMm',
    });
  }
  if (facts.selectedStock.unknown > 0) {
    inventoryIssues.push({
      code: 'SOURCE_SELECTED_SKU_STOCK_UNKNOWN',
      message: `${facts.selectedStock.unknown} selected SKU stock value(s) are unknown`,
      fieldPath: 'operational.selectedSkuStock',
    });
  }
  if (facts.shippingCny == null) {
    costingIssues.push({
      code: 'SOURCE_FREIGHT_UNKNOWN',
      message: 'Source freight is unknown, so trusted costing and auto-pricing are blocked',
      fieldPath: 'operational.shippingCny',
    });
  }
  next.report.operationReadiness.ozonImport.status = importIssues.length ? 'BLOCKED' : 'READY';
  next.report.operationReadiness.inventoryActivation.status = inventoryIssues.length ? 'BLOCKED' : 'READY';
  next.report.operationReadiness.costingAutoPricing.status = costingIssues.length ? 'BLOCKED' : 'READY';
  next.status = importIssues.length ? 'INVALID' : 'VALID';
  next.blockers = importIssues.slice(0, 100);
  next.warnings = [
    ...next.warnings,
    ...inventoryIssues,
    ...costingIssues,
  ].filter((issue, index, all) => all.findIndex((candidate) => (
    candidate.code === issue.code && candidate.fieldPath === issue.fieldPath
  )) === index).slice(0, 100);
  next.report.operationalFacts = {
    packageWeightG: weight,
    packageDimensionsMm: dimensions,
    selectedStock: facts.selectedStock,
    shippingCny: facts.shippingCny,
    evidence: {
      ...facts.evidence,
      ...(manualWeight ? { packageWeightG: manualWeight.evidence.join(', ') } : {}),
      ...(manualLength ? { packageLengthMm: manualLength.evidence.join(', ') } : {}),
      ...(manualWidth ? { packageWidthMm: manualWidth.evidence.join(', ') } : {}),
      ...(manualHeight ? { packageHeightMm: manualHeight.evidence.join(', ') } : {}),
    },
    sources: {
      packageWeightG: usesSkuPackaging || manualWeight ? 'MANUAL' : 'SOURCE',
      packageLengthMm: usesSkuPackaging || manualLength ? 'MANUAL' : 'SOURCE',
      packageWidthMm: usesSkuPackaging || manualWidth ? 'MANUAL' : 'SOURCE',
      packageHeightMm: usesSkuPackaging || manualHeight ? 'MANUAL' : 'SOURCE',
      selectedStock: 'SOURCE',
      shippingCny: 'SOURCE',
    },
    importContract: structuredClone(facts.requirements.importContract),
    ...(skuPackaging ? { skuPackaging } : {}),
  };
  return next;
}

export function createSourceListingWorkflowAttributeService(
  options: SourceListingWorkflowAttributeServiceOptions,
) {
  type DictionaryMemo = Map<string, Promise<SourceListingAttributeDictionary>>;
  async function loadSchema(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    category?: OzonListingDraftCategory;
    freshness?: SourceListingAttributeFreshness;
  }): Promise<OzonNormalizedAttributeSchema> {
    const category = input.category || categoryFor(input.draft);
    const schema = await options.loadSchema({
      ...input,
      category,
      freshness: input.freshness || 'CACHE_ALLOWED',
    });
    assertSchemaContext(input.draft, category, schema);
    return schema;
  }

  async function dictionaryFor(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    schema: OzonNormalizedAttributeSchema;
    field: OzonNormalizedAttributeField;
    freshness?: SourceListingAttributeFreshness;
    dictionaryMemo?: DictionaryMemo;
  }): Promise<SourceListingAttributeDictionary> {
    if (input.field.valuePolicy === 'FREE_TEXT') return { complete: true, values: [] };
    if (!input.field.dictionaryId) return { complete: false, values: [] };
    const freshness = input.freshness || 'CACHE_ALLOWED';
    const memoKey = `${freshness}:${input.field.attributeId}`;
    const cached = input.dictionaryMemo?.get(memoKey);
    if (cached) return cached;
    const value = options.loadDictionary({ ...input, freshness });
    input.dictionaryMemo?.set(memoKey, value);
    value.catch(() => input.dictionaryMemo?.delete(memoKey));
    return value;
  }

  function persistedDictionarySelections(input: {
    draft: OzonListingDraft;
    field: OzonNormalizedAttributeField;
    value: OzonListingDraftAttributeValue;
  }): Array<{ id: number; value: string }> | null {
    const leaves = input.field.ownership === 'SKU'
      ? selectedSkuKeys(input.draft).map((skuKey) => input.value.skuValues?.[skuKey])
      : [input.value];
    const selections: Array<{ id: number; value: string }> = [];
    for (const leaf of leaves) {
      if (!leaf) return null;
      const rawValues = fieldValues(leaf.value, input.field);
      if (!rawValues) return null;
      const matches = Array.isArray(leaf.dictionaryMatches) && leaf.dictionaryMatches.length
        ? leaf.dictionaryMatches
        : rawValues.length === 1 && leaf.dictionaryMatch?.dictionaryValueId
          ? [{
              inputValue: rawValues[0],
              dictionaryValueId: leaf.dictionaryMatch.dictionaryValueId,
              canonicalValue: leaf.dictionaryMatch.canonicalValue,
            }]
          : [];
      if (matches.length !== rawValues.length) return null;
      for (let index = 0; index < rawValues.length; index += 1) {
        const match = matches[index];
        const id = Number(match?.dictionaryValueId);
        const canonicalValue = String(match?.canonicalValue ?? '')
          .normalize('NFKC')
          .replace(/\s+/g, ' ')
          .trim();
        if (!Number.isSafeInteger(id)
          || id <= 0
          || !canonicalValue
          || normalizedText(rawValues[index]) !== normalizedText(canonicalValue)) return null;
        selections.push({ id, value: canonicalValue });
      }
    }
    return [...new Map(selections.map((selection) => [selection.id, selection])).values()];
  }

  async function targetedValidationDictionary(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    schema: OzonNormalizedAttributeSchema;
    field: OzonNormalizedAttributeField;
    selections: Array<{ id: number; value: string }>;
  }): Promise<SourceListingAttributeDictionary> {
    if (!options.searchDictionary) {
      return dictionaryFor({ ...input, freshness: 'OFFICIAL_REFRESH_REQUIRED' });
    }
    let results: SourceListingAttributeDictionarySearchResult[];
    try {
      results = await mapWithConcurrency(input.selections, 4, (selection) => options.searchDictionary!({
        ownerUserId: input.ownerUserId,
        draft: input.draft,
        schema: input.schema,
        field: input.field,
        queries: [selection.value],
        freshness: 'OFFICIAL_REFRESH_REQUIRED',
      }));
    } catch (error) {
      throw new SourceListingWorkflowAttributeError(
        'OZON_ATTRIBUTE_DICTIONARY_UNAVAILABLE',
        503,
        `${input.field.name} official selections could not be refreshed`,
        { cause: error },
      );
    }
    if (results.some((result) => result.source !== 'ozon_api'
      || result.catalogRevision !== input.schema.catalogRevision)) {
      throw new SourceListingWorkflowAttributeError(
        'OZON_ATTRIBUTE_DICTIONARY_UNAVAILABLE',
        503,
        `${input.field.name} official selection authority is stale`,
      );
    }
    const officialValues = [...new Map(results.flatMap((result) => result.values)
      .map((entry) => [Number(entry.id), entry])).values()];
    return {
      complete: true,
      source: 'ozon_api',
      values: input.selections.flatMap((selection) => {
        const official = officialValues.find((entry) => Number(entry.id) === selection.id
          && normalizedText(entry.value) === normalizedText(selection.value));
        return official ? [{
          id: selection.id,
          value: String(official.value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim(),
        }] : [];
      }),
    };
  }

  async function validationFields(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    schema: OzonNormalizedAttributeSchema;
    values: Record<string, OzonListingDraftAttributeValue>;
    freshness?: SourceListingAttributeFreshness;
    dictionaryMemo?: DictionaryMemo;
  }): Promise<OzonAttributeValidationField[]> {
    return mapWithConcurrency(input.schema.fields, 4, async (field) => {
      const key = String(field.attributeId);
      const value = input.values[key];
      if (!value || field.valuePolicy === 'FREE_TEXT' || !field.dictionaryId) {
        return { ...field, key };
      }
      const freshness = input.freshness || 'CACHE_ALLOWED';
      const persistedSelections = persistedDictionarySelections({
        draft: input.draft,
        field,
        value,
      });
      const dictionary = freshness === 'PUBLISH_CACHE_REQUIRED' || !persistedSelections
        ? await dictionaryFor({ ...input, field })
        : freshness === 'OFFICIAL_REFRESH_REQUIRED'
          ? await targetedValidationDictionary({
              ownerUserId: input.ownerUserId,
              draft: input.draft,
              schema: input.schema,
              field,
              selections: persistedSelections,
            })
          : {
              complete: true,
              values: persistedSelections,
            };
      return {
        ...field,
        key,
        dictionaryComplete: dictionary.complete === true,
        dictionaryValues: normalizedDictionary(dictionary),
        dictionarySource: dictionary.source,
        dictionaryWarning: dictionary.warning,
      };
    });
  }

  async function validateValues(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    schema: OzonNormalizedAttributeSchema;
    values: Record<string, OzonListingDraftAttributeValue>;
    selectedSkuKeys?: string[];
    freshness?: SourceListingAttributeFreshness;
    dictionaryMemo?: DictionaryMemo;
  }): Promise<OzonAttributeValidationResult> {
    const freshness = input.freshness || 'CACHE_ALLOWED';
    const fields = await validationFields({ ...input, freshness });
    const result = validateOzonAttributeValues({
      schemaRevision: schemaRevision(input.schema),
      selectedSkuKeys: input.selectedSkuKeys ?? selectedSkuKeys(input.draft),
      fields,
      values: input.values,
    });
    result.report.schemaSource = input.schema.definitionSource || 'unknown';
    if (input.schema.definitionWarning) {
      result.report.schemaWarning = input.schema.definitionWarning;
    }
    if (input.schema.definitionSource === 'stale-cache') {
      result.warnings.push({
        code: 'OZON_ATTRIBUTE_DEFINITIONS_STALE_CACHE',
        message: input.schema.definitionWarning
          || 'Ozon attribute definitions came from an expired complete cache',
        fieldPath: 'attributes',
      });
    }
    if (freshness !== 'CACHE_ALLOWED') {
      const requiredSource = freshness === 'PUBLISH_CACHE_REQUIRED' ? 'cache' : 'ozon_api';
      const schemaFresh = input.schema.definitionSource === requiredSource;
      const staleDictionaryFields = fields.filter((field) => (
        field.valuePolicy !== 'FREE_TEXT'
        && field.dictionaryId != null
        && input.values[field.key || String(field.attributeId)] != null
        && field.dictionarySource !== requiredSource
      ));
      const importIssues = result.report.operationReadiness.ozonImport.issues;
      if (!schemaFresh) {
        importIssues.push({
          code: 'OZON_ATTRIBUTE_DEFINITIONS_AUTHORITATIVE_REFRESH_REQUIRED',
          message: input.schema.definitionWarning
            || 'Official Ozon attribute definitions could not be refreshed for final validation',
          fieldPath: 'attributes',
        });
      }
      for (const field of staleDictionaryFields) {
        importIssues.push({
          code: 'OZON_ATTRIBUTE_DICTIONARY_AUTHORITATIVE_REFRESH_REQUIRED',
          message: field.dictionaryWarning
            || `${field.name} official dictionary could not be refreshed for final validation`,
          fieldPath: `attributes.${field.key || field.attributeId}`,
        });
      }
      result.report.officialDataFreshness = {
        requirement: freshness,
        schemaSource: input.schema.definitionSource || 'unknown',
        dictionarySources: Object.fromEntries(fields
          .filter((field) => field.valuePolicy !== 'FREE_TEXT'
            && field.dictionaryId != null
            && input.values[field.key || String(field.attributeId)] != null)
          .map((field) => [String(field.attributeId), field.dictionarySource || 'unknown'])),
      };
      result.report.operationReadiness.ozonImport.status = importIssues.length ? 'BLOCKED' : 'READY';
      result.status = importIssues.length ? 'INVALID' : 'VALID';
      result.blockers = importIssues.slice(0, 100);
    }
    return result;
  }

  async function aliasesFor(input: {
    field: OzonNormalizedAttributeField;
    value: unknown;
    sourceContext: SourceListingAttributeSourceContext;
  }): Promise<unknown[]> {
    const aliases = options.dictionaryAliases
      ? await options.dictionaryAliases(input)
      : [input.value];
    return [input.value, ...(Array.isArray(aliases) ? aliases : [])];
  }

  async function resolveDictionaryMatches(input: {
    field: OzonNormalizedAttributeField;
    values: unknown[];
    dictionary: SourceListingAttributeDictionary;
    sourceContext: SourceListingAttributeSourceContext;
    hintedIds?: number[];
  }): Promise<{ canonicalValues: unknown[]; matches: OzonAttributeDictionaryMatch[]; allMatched: boolean }> {
    const entries = normalizedDictionary(input.dictionary);
    const canonicalValues: unknown[] = [];
    const matches: OzonAttributeDictionaryMatch[] = [];
    for (let index = 0; index < input.values.length; index += 1) {
      const rawValue = input.values[index];
      const aliases = await aliasesFor({
        field: input.field,
        value: rawValue,
        sourceContext: input.sourceContext,
      });
      const aliasKeys = new Set(aliases.map(normalizedText).filter(Boolean));
      const hintedId = Number(input.hintedIds?.[index]);
      const match = Number.isSafeInteger(hintedId) && hintedId > 0
        ? entries.find((entry) => entry.id === hintedId && aliasKeys.has(normalizedText(entry.value)))
        : entries.find((entry) => aliasKeys.has(normalizedText(entry.value)));
      if (!match) {
        canonicalValues.push(rawValue);
        continue;
      }
      canonicalValues.push(match.value);
      matches.push({
        attributeId: input.field.attributeId,
        inputValue: rawValue as string | number | boolean,
        dictionaryValueId: match.id,
        canonicalValue: match.value,
      });
    }
    return { canonicalValues, matches, allMatched: matches.length === input.values.length };
  }

  async function canonicalValue(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    schema: OzonNormalizedAttributeSchema;
    field: OzonNormalizedAttributeField;
    value: unknown;
    sourceContext: SourceListingAttributeSourceContext;
    hintedIds?: number[];
    dictionaryMemo?: DictionaryMemo;
  }): Promise<Pick<OzonListingDraftAttributeValue, 'value' | 'dictionaryMatch' | 'dictionaryMatches' | 'manualReview'> & {
    validationDictionary?: SourceListingAttributeDictionary;
  }> {
    const rawValues = fieldValues(input.value, input.field);
    if (!rawValues) throw new SourceListingWorkflowAttributeError(
      'OZON_ATTRIBUTE_VALUE_INVALID', 422, `${input.field.name} has invalid cardinality`,
    );
    if (input.field.valuePolicy === 'FREE_TEXT') {
      return {
        value: input.field.cardinality === 'MULTI' ? rawValues : rawValues[0],
        dictionaryMatch: { status: 'NOT_APPLICABLE', dictionaryValueId: null },
        dictionaryMatches: [],
        manualReview: 'CONFIRMED',
      };
    }
    let dictionary: SourceListingAttributeDictionary | null = null;
    let validationDictionary: SourceListingAttributeDictionary | undefined;
    if (input.hintedIds?.length && options.searchDictionary) {
      let results: SourceListingAttributeDictionarySearchResult[];
      try {
        results = await mapWithConcurrency(rawValues, 4, (value) => options.searchDictionary!({
          ownerUserId: input.ownerUserId,
          draft: input.draft,
          schema: input.schema,
          field: input.field,
          queries: [String(value).normalize('NFKC').trim()],
          freshness: 'OFFICIAL_REFRESH_REQUIRED',
        }));
      } catch (error) {
        throw new SourceListingWorkflowAttributeError(
          'OZON_ATTRIBUTE_DICTIONARY_UNAVAILABLE',
          503,
          `${input.field.name} official selection could not be verified`,
          { cause: error },
        );
      }
      if (results.some((result) => result.source !== 'ozon_api'
        || result.catalogRevision !== input.schema.catalogRevision)) {
        throw new SourceListingWorkflowAttributeError(
          'OZON_ATTRIBUTE_DICTIONARY_UNAVAILABLE',
          503,
          `${input.field.name} official selection authority is stale`,
        );
      }
      dictionary = {
        complete: true,
        source: 'ozon_api',
        values: [...new Map(results.flatMap((result) => result.values)
          .map((entry) => [Number(entry.id), entry])).values()],
      };
      validationDictionary = dictionary;
    } else {
      dictionary = await dictionaryFor({
        ownerUserId: input.ownerUserId,
        draft: input.draft,
        schema: input.schema,
        field: input.field,
        dictionaryMemo: input.dictionaryMemo,
      });
      if (!dictionary.complete) throw new SourceListingWorkflowAttributeError(
        'OZON_ATTRIBUTE_VALUE_INVALID', 422, `${input.field.name} official dictionary is incomplete`,
      );
    }
    const resolution = await resolveDictionaryMatches({
      field: input.field,
      values: rawValues,
      dictionary,
      sourceContext: input.sourceContext,
      hintedIds: input.hintedIds,
    });
    if (input.field.valuePolicy === 'STRICT_DICTIONARY' && !resolution.allMatched) {
      throw new SourceListingWorkflowAttributeError(
        'OZON_ATTRIBUTE_VALUE_INVALID', 422, `${input.field.name} is not in the official dictionary`,
      );
    }
    if (input.hintedIds?.length && !resolution.allMatched) {
      throw new SourceListingWorkflowAttributeError(
        'OZON_ATTRIBUTE_VALUE_INVALID', 422, `${input.field.name} dictionary selection is invalid`,
      );
    }
    const allMatched = resolution.allMatched;
    const storedValues = allMatched ? resolution.canonicalValues : rawValues;
    const storedMatches = allMatched
      ? resolution.matches.map((match) => ({ ...match, inputValue: match.canonicalValue }))
      : [];
    const single = storedMatches.length === 1 ? storedMatches[0]! : null;
    return {
      value: input.field.cardinality === 'MULTI' ? storedValues : storedValues[0],
      dictionaryMatch: {
        status: allMatched ? 'MATCHED' : 'UNSUPPORTED',
        dictionaryValueId: single?.dictionaryValueId ?? null,
        canonicalValue: single?.canonicalValue ?? null,
      },
      dictionaryMatches: storedMatches,
      manualReview: allMatched ? 'CONFIRMED' : 'REQUIRED',
      ...(validationDictionary ? { validationDictionary } : {}),
    };
  }

  async function resolvedSuggestionResult(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    schema: OzonNormalizedAttributeSchema;
    fields: OzonNormalizedAttributeField[];
    sourceContext: SourceListingAttributeSourceContext;
    dictionaryMemo?: DictionaryMemo;
  }): Promise<OzonAttributeSuggestionResult> {
    const preliminary = buildOzonAttributeSuggestions({
      fields: input.fields,
      sourceProfile: input.sourceContext.sourceProfile,
      sourceStandard: input.sourceContext.sourceStandard,
      sourceStandardEvidence: input.sourceContext.sourceStandardEvidence,
      allowSourceProfileFallback: input.sourceContext.allowSourceProfileFallback,
      evidence: input.sourceContext.evidence,
      aiCandidates: input.sourceContext.aiCandidates,
    });
    const candidateValues = new Map<number, unknown[]>();
    for (const suggestion of Object.values(preliminary.suggestions)) {
      candidateValues.set(
        suggestion.attributeId,
        Array.isArray(suggestion.value) ? suggestion.value : [suggestion.value],
      );
    }
    for (const block of preliminary.blocked) {
      if (block.unsupportedValues.length) candidateValues.set(block.attributeId, block.unsupportedValues);
    }

    const dictionaryMatches: OzonAttributeDictionaryMatch[] = [];
    for (const [attributeId, values] of candidateValues) {
      const field = input.fields.find((entry) => entry.attributeId === attributeId);
      if (!field || field.valuePolicy === 'FREE_TEXT') continue;
      let dictionary: SourceListingAttributeDictionary;
      try {
        if (options.searchDictionary) {
          const aliases = (await Promise.all(values.map((value) => aliasesFor({
            field,
            value,
            sourceContext: input.sourceContext,
          })))).flat();
          const result = await options.searchDictionary({
            ownerUserId: input.ownerUserId,
            draft: input.draft,
            schema: input.schema,
            field,
            queries: [...new Set(aliases.map((value) => String(value ?? '').normalize('NFKC').trim())
              .filter(Boolean))],
            freshness: 'OFFICIAL_REFRESH_REQUIRED',
          });
          if (result.source !== 'ozon_api'
            || result.catalogRevision !== input.schema.catalogRevision) continue;
          dictionary = { complete: true, source: 'ozon_api', values: result.values };
        } else {
          dictionary = await dictionaryFor({
            ownerUserId: input.ownerUserId,
            draft: input.draft,
            schema: input.schema,
            field,
            dictionaryMemo: input.dictionaryMemo,
          });
        }
      } catch {
        // Unavailable official authority cannot authorize an AI suggestion.
        // Preserve the source value as blocked for explicit manual review.
        continue;
      }
      if (!dictionary.complete) continue;
      const resolution = await resolveDictionaryMatches({
        field,
        values,
        dictionary,
        sourceContext: input.sourceContext,
      });
      dictionaryMatches.push(...resolution.matches);
    }
    const resolved = buildOzonAttributeSuggestions({
      fields: input.fields,
      sourceProfile: input.sourceContext.sourceProfile,
      sourceStandard: input.sourceContext.sourceStandard,
      sourceStandardEvidence: input.sourceContext.sourceStandardEvidence,
      allowSourceProfileFallback: input.sourceContext.allowSourceProfileFallback,
      evidence: input.sourceContext.evidence,
      aiCandidates: input.sourceContext.aiCandidates,
      dictionaryMatches,
    });
    return resolved;
  }

  async function suggestionResult(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
    schema: OzonNormalizedAttributeSchema;
    sourceContext: SourceListingAttributeSourceContext;
    dictionaryMemo?: DictionaryMemo;
  }): Promise<{
    suggestions: Record<string, OzonAttributeSuggestion>;
    blocked: SourceListingAttributeSuggestionBlock[];
  }> {
    const productFields = input.schema.fields.filter((field) => field.ownership !== 'SKU');
    const product = await resolvedSuggestionResult({ ...input, fields: productFields });
    const suggestions: Record<string, OzonAttributeSuggestion> = { ...product.suggestions };
    const blocked: SourceListingAttributeSuggestionBlock[] = [...product.blocked];
    const skuKeys = selectedSkuKeys(input.draft);

    for (const field of input.schema.fields.filter((entry) => entry.ownership === 'SKU')) {
      const leafSuggestionEntries: Array<[string, OzonListingDraftAttributeValue]> = [];
      const leafSuggestionDetails: OzonAttributeSuggestion[] = [];
      for (const skuKey of skuKeys) {
        const skuContext = sourceContextForSku(input.sourceContext, skuKey);
        const result = await resolvedSuggestionResult({
          ...input,
          fields: [field],
          sourceContext: skuContext,
        });
        const leafBlocks = result.blocked
          .filter((block) => block.attributeId === field.attributeId)
          .map((block) => ({
            ...block,
            skuKey,
            fieldPath: `attributes.${field.attributeId}.skuValues.${skuKey}`,
          }));
        blocked.push(...leafBlocks);
        const suggestion = result.suggestions[String(field.attributeId)];
        if (!suggestion) continue;
        const unresolvedValues = leafBlocks
          .filter((block) => block.reasonCode === 'STRICT_DICTIONARY_UNRESOLVED')
          .flatMap((block) => block.unsupportedValues);
        const leaf = {
          ...structuredClone(suggestion),
          ...(unresolvedValues.length
            ? { unresolvedValues: structuredClone(unresolvedValues) }
            : {}),
        };
        leafSuggestionEntries.push([skuKey, leaf]);
        leafSuggestionDetails.push(leaf);
      }
      const first = leafSuggestionDetails[0];
      if (!first) continue;
      const leafSuggestions = Object.fromEntries(leafSuggestionEntries);
      const composed = composeSkuAttributeValue(first, leafSuggestions, skuKeys);
      const evidenceDetails = [...new Map(leafSuggestionDetails
        .flatMap((suggestion) => suggestion.evidenceDetails)
        .map((entry) => [entry.id, entry])).values()].slice(0, 100);
      suggestions[String(field.attributeId)] = {
        ...first,
        ...composed,
        attributeId: field.attributeId,
        attributeName: field.name,
        valueType: field.valueType,
        cardinality: field.cardinality,
        value: first.value,
        dictionaryMatches: leafSuggestionDetails.flatMap((suggestion) => suggestion.dictionaryMatches),
        evidenceDetails,
      };
    }
    return { suggestions, blocked };
  }

  async function workspace(input: { ownerUserId: string; draft: OzonListingDraft }): Promise<SourceListingAttributeWorkspace> {
    const dictionaryMemo: DictionaryMemo = new Map();
    const schema = await loadSchema(input);
    const sourceContext = await options.loadSourceContext(input);
    const revision = schemaRevision(schema);
    const suggestions = freezeSuggestionResult({
      draft: input.draft,
      schemaRevision: revision,
      result: await suggestionResult({ ...input, schema, sourceContext, dictionaryMemo }),
    });
    const values = effectiveAttributeValues(schema, input.draft);
    return {
      schema,
      schemaRevision: revision,
      values,
      suggestions: suggestions.suggestions,
      blockedSuggestions: suggestions.blocked,
      validationPreview: withOperationalReadiness(await validateValues({
        ...input,
        schema,
        values,
        dictionaryMemo,
      }), input.draft, sourceContext),
    };
  }

  async function validateWithFreshness(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
  }, freshness: Exclude<SourceListingAttributeFreshness, 'CACHE_ALLOWED'>): Promise<{
    schema: OzonNormalizedAttributeSchema;
    result: OzonAttributeValidationResult;
  }> {
    const dictionaryMemo: DictionaryMemo = new Map();
    const schema = await loadSchema({ ...input, freshness });
    const sourceContext = await options.loadSourceContext(input);
    const result = withOperationalReadiness(
      await validateValues({
        ...input,
        schema,
        values: effectiveAttributeValues(schema, input.draft),
        freshness,
        dictionaryMemo,
      }),
      input.draft,
      sourceContext,
    );
    return { schema, result };
  }

  async function validateAuthoritative(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
  }): Promise<{ schema: OzonNormalizedAttributeSchema; result: OzonAttributeValidationResult }> {
    return validateWithFreshness(input, 'OFFICIAL_REFRESH_REQUIRED');
  }

  async function validateForPublish(input: {
    ownerUserId: string;
    draft: OzonListingDraft;
  }): Promise<{
    authorityMode: 'PUBLISH_CACHE_REQUIRED';
    schema: OzonNormalizedAttributeSchema;
    result: OzonAttributeValidationResult;
  }> {
    return {
      authorityMode: 'PUBLISH_CACHE_REQUIRED',
      ...await validateWithFreshness(input, 'PUBLISH_CACHE_REQUIRED'),
    };
  }

  return {
    getWorkspace: workspace,
    async previewSchema(input: { ownerUserId: string; draft: OzonListingDraft; category: OzonListingDraftCategory }) {
      const schema = await loadSchema(input);
      return { schema, schemaRevision: schemaRevision(schema) };
    },
    validateAuthoritative,
    validateForPublish,

    async searchDictionary(input: {
      ownerUserId: string;
      draft: OzonListingDraft;
      attributeId: number;
      query?: string;
      limit?: number;
    }): Promise<{
      attributeId: number;
      complete: boolean;
      dictionaryComplete: boolean;
      resultExhaustive: boolean;
      hasMore: boolean;
      resultTruncated: boolean;
      source: 'cache' | 'ozon_api' | 'stale-cache' | 'bounded_scan';
      catalogRevision: string;
      values: Array<{ id: number; value: string }>;
    }> {
      const schema = await loadSchema(input);
      const field = schema.fields.find((entry) => entry.attributeId === input.attributeId);
      if (!field) throw new SourceListingWorkflowAttributeError(
        'OZON_ATTRIBUTE_FIELD_UNKNOWN', 422, `Unknown Ozon attribute ${input.attributeId}`,
      );
      if (field.valuePolicy === 'FREE_TEXT' || !field.dictionaryId) {
        throw new SourceListingWorkflowAttributeError(
          'OZON_ATTRIBUTE_FIELD_READ_ONLY', 422, `${field.name} does not have an official dictionary`,
        );
      }
      const query = normalizedText(input.query);
      const limit = Number.isSafeInteger(input.limit)
        ? Math.max(1, Math.min(100, Number(input.limit)))
        : 50;
      if (query && options.searchDictionary) {
        const result = await options.searchDictionary({
          ownerUserId: input.ownerUserId,
          draft: input.draft,
          schema,
          field,
          queries: [query],
          freshness: 'OFFICIAL_REFRESH_REQUIRED',
        });
        const values = normalizedDictionary({
          complete: false,
          values: result.values,
        })
          .slice(0, limit)
          .map((entry) => ({ id: entry.id, value: String(entry.value) }));
        return {
          attributeId: field.attributeId,
          complete: false,
          dictionaryComplete: false,
          resultExhaustive: result.resultExhaustive && result.values.length <= limit,
          hasMore: !result.resultExhaustive || result.values.length > limit,
          resultTruncated: !result.resultExhaustive || result.values.length > limit,
          source: result.source,
          catalogRevision: result.catalogRevision,
          values,
        };
      }
      const dictionary = await dictionaryFor({
        ownerUserId: input.ownerUserId,
        draft: input.draft,
        schema,
        field,
      });
      const matchingValues = normalizedDictionary(dictionary)
        .filter((entry) => !query || normalizedText(entry.value).includes(query));
      const values = matchingValues.slice(0, limit);
      return {
        attributeId: field.attributeId,
        complete: dictionary.complete === true,
        dictionaryComplete: dictionary.complete === true,
        resultExhaustive: values.length === matchingValues.length,
        hasMore: values.length < matchingValues.length,
        resultTruncated: values.length < matchingValues.length,
        source: dictionary.source === 'stale-cache'
          ? 'stale-cache'
          : dictionary.source === 'cache' ? 'cache' : 'ozon_api',
        catalogRevision: input.draft.category?.catalogRevision || '',
        values: values.map((entry) => ({ id: entry.id, value: String(entry.value) })),
      };
    },

    async prepareManualValues(input: {
      ownerUserId: string;
      actorUserId: string;
      draft: OzonListingDraft;
      changes: SourceListingAttributeManualChange[];
      expectedSchemaRevision?: string;
    }): Promise<Record<string, OzonListingDraftAttributeValue>> {
      const dictionaryMemo: DictionaryMemo = new Map();
      const schema = await loadSchema(input);
      if (input.expectedSchemaRevision !== undefined && input.expectedSchemaRevision !== schemaRevision(schema)) {
        throw new SourceListingWorkflowAttributeError('OZON_ATTRIBUTE_SCHEMA_MISMATCH', 409,
          'Official attribute schema changed before preparing manual values');
      }
      const sourceContext = await options.loadSourceContext(input);
      const values = structuredClone(input.draft.attributes.values);
      const selectedKeys = selectedSkuKeys(input.draft);
      const selectedKeySet = new Set(selectedKeys);
      const changedScopes = new Set<string>();
      for (const change of input.changes) {
        const field = schema.fields.find((entry) => entry.attributeId === change.attributeId);
        if (!field) throw new SourceListingWorkflowAttributeError(
          'OZON_ATTRIBUTE_FIELD_UNKNOWN', 422, `Unknown Ozon attribute ${change.attributeId}`,
        );
        if (field.ownership === 'SYSTEM' || field.ownership === 'MEDIA'
          || field.editorMode === 'READ_ONLY' || field.editorMode === 'MEDIA_WORKBENCH') {
          throw new SourceListingWorkflowAttributeError(
            'OZON_ATTRIBUTE_FIELD_READ_ONLY', 422, `${field.name} is managed by the system`,
          );
        }
        const skuKey = normalizedSkuKey(change.skuKey);
        if (field.ownership === 'SKU') {
          if (!skuKey) throw new SourceListingWorkflowAttributeError(
            'OZON_ATTRIBUTE_VALUE_INVALID', 422, `${field.name} requires a selected SKU key`,
          );
          if (!selectedKeySet.has(skuKey)) throw new SourceListingWorkflowAttributeError(
            'OZON_ATTRIBUTE_VALUE_INVALID', 422, `${field.name} SKU ${skuKey} is not selected`,
          );
        } else if (skuKey) {
          throw new SourceListingWorkflowAttributeError(
            'OZON_ATTRIBUTE_VALUE_INVALID', 422, `${field.name} is not a SKU-owned attribute`,
          );
        }
        const changedScope = `${field.attributeId}:${skuKey || 'product'}`;
        if (changedScopes.has(changedScope)) throw new SourceListingWorkflowAttributeError(
          'OZON_ATTRIBUTE_VALUE_INVALID', 422, `${field.name} has duplicate manual changes for the same scope`,
        );
        changedScopes.add(changedScope);
        const evidence = uniqueEvidence(change.evidence);
        if (!evidence.length) throw new SourceListingWorkflowAttributeError(
          'OZON_ATTRIBUTE_VALUE_INVALID', 422, `${field.name} requires manual evidence`,
        );
        const key = String(field.attributeId);
        if (change.action === 'CLEAR') {
          if (change.value !== undefined
            || change.dictionaryValueId !== undefined
            || change.dictionaryValueIds !== undefined) {
            throw new SourceListingWorkflowAttributeError(
              'OZON_ATTRIBUTE_VALUE_INVALID', 422, `${field.name} clear cannot include a value`,
            );
          }
          if (field.ownership === 'SKU') {
            const remainingLeaves = Object.fromEntries(Object.entries(values[key]?.skuValues || {})
              .filter(([candidateSkuKey]) => candidateSkuKey !== skuKey));
            if (!Object.keys(remainingLeaves).length) delete values[key];
            else values[key] = composeSkuAttributeValue(values[key]!, remainingLeaves, selectedKeys);
          } else {
            delete values[key];
          }
          continue;
        }
        if (change.value === undefined) throw new SourceListingWorkflowAttributeError(
          'OZON_ATTRIBUTE_VALUE_INVALID', 422, `${field.name} requires a value`,
        );
        const rawValues = fieldValues(change.value, field);
        const hintedIds = Array.isArray(change.dictionaryValueIds)
          ? change.dictionaryValueIds
          : change.dictionaryValueId != null
            ? [change.dictionaryValueId]
            : undefined;
        if (!rawValues || (hintedIds && hintedIds.length !== rawValues.length)) {
          throw new SourceListingWorkflowAttributeError(
            'OZON_ATTRIBUTE_VALUE_INVALID', 422, `${field.name} dictionary selections do not match its values`,
          );
        }
        const canonicalResult = await canonicalValue({
          ...input,
          schema,
          field,
          value: change.value,
          sourceContext: skuKey ? sourceContextForSku(sourceContext, skuKey) : sourceContext,
          hintedIds,
          dictionaryMemo,
        });
        const { validationDictionary, ...canonical } = canonicalResult;
        if (validationDictionary) {
          dictionaryMemo.set(
            `CACHE_ALLOWED:${field.attributeId}`,
            Promise.resolve(validationDictionary),
          );
        }
        const candidate: OzonListingDraftAttributeValue = {
          ...canonical,
          source: 'MANUAL',
          reviewed: true,
          evidence,
          confidence: 1,
          manualReview: 'CONFIRMED',
        };
        const storedValue = field.ownership === 'SKU'
          ? composeSkuAttributeValue(
            values[key] || candidate,
            { ...(values[key]?.skuValues || {}), [skuKey]: candidate },
            selectedKeys,
          )
          : candidate;
        const result = await validateValues({
          ...input,
          schema: { ...schema, fields: [field] },
          values: { [key]: storedValue },
          ...(field.ownership === 'SKU' ? { selectedSkuKeys: [skuKey] } : {}),
          dictionaryMemo,
        });
        if (!fieldAccepted(result, field.attributeId)) throw validationError(result);
        values[key] = storedValue;
      }
      return values;
    },

    async prepareSuggestedValues(input: {
      ownerUserId: string;
      actorUserId: string;
      draft: OzonListingDraft;
      candidates: SourceListingAttributeSuggestionReference[];
    }): Promise<Record<string, OzonListingDraftAttributeValue>> {
      const dictionaryMemo: DictionaryMemo = new Map();
      const schema = await loadSchema(input);
      const sourceContext = await options.loadSourceContext(input);
      const revision = schemaRevision(schema);
      const available = freezeSuggestionResult({
        draft: input.draft,
        schemaRevision: revision,
        result: await suggestionResult({ ...input, schema, sourceContext, dictionaryMemo }),
      });
      const values = structuredClone(input.draft.attributes.values);
      const attributeIds = input.candidates.map((candidate) => candidate.attributeId);
      if (new Set(attributeIds).size !== attributeIds.length) {
        throw new SourceListingWorkflowAttributeError(
          'OZON_ATTRIBUTE_SUGGESTION_STALE', 409, 'Attribute suggestion references must be unique',
        );
      }
      for (const reference of input.candidates) {
        const attributeId = reference.attributeId;
        const field = schema.fields.find((entry) => entry.attributeId === attributeId);
        const suggestion = available.suggestions[String(attributeId)];
        if (!field || !suggestion) throw new SourceListingWorkflowAttributeError(
          'OZON_ATTRIBUTE_SUGGESTION_UNAVAILABLE', 422, `Attribute suggestion ${attributeId} is unavailable`,
        );
        if (reference.schemaRevision !== revision
          || reference.candidateId !== suggestion.candidateId
          || reference.candidateHash !== suggestion.candidateHash) {
          throw new SourceListingWorkflowAttributeError(
            'OZON_ATTRIBUTE_SUGGESTION_STALE',
            409,
            `Attribute suggestion ${attributeId} changed after it was reviewed`,
          );
        }
        const key = String(attributeId);
        if (field.ownership === 'SKU') {
          const skuKeys = selectedSkuKeys(input.draft);
          let nextLeaves = structuredClone(values[key]?.skuValues || {});
          for (const skuKey of skuKeys) {
            const leaf = suggestion.skuValues?.[skuKey];
            if (!leaf) continue;
            const hintedIds = leaf.dictionaryMatches?.map((match) => match.dictionaryValueId);
            const canonical = await canonicalValue({
              ...input,
              schema,
              field,
              value: leaf.value,
              sourceContext: sourceContextForSku(sourceContext, skuKey),
              hintedIds: hintedIds?.length ? hintedIds : undefined,
              dictionaryMemo,
            });
            const candidate: OzonListingDraftAttributeValue = {
              ...canonical,
              source: leaf.source,
              reviewed: true,
              evidence: uniqueEvidence(leaf.evidence),
              confidence: leaf.confidence,
              suggestionProvenance: persistedSuggestionProvenance(
                suggestion,
                attributeId,
                (leaf as OzonListingDraftAttributeValue & { evidenceDetails?: unknown }).evidenceDetails,
              ),
              ...(leaf.unresolvedValues?.length
                ? { unresolvedValues: structuredClone(leaf.unresolvedValues) }
                : {}),
              manualReview: leaf.unresolvedValues?.length ? 'REQUIRED' : 'CONFIRMED',
            };
            const candidateRoot = composeSkuAttributeValue(
              values[key] || suggestion,
              { ...nextLeaves, [skuKey]: candidate },
              skuKeys,
            );
            const result = await validateValues({
              ...input,
              schema: { ...schema, fields: [field] },
              values: { [key]: candidateRoot },
              selectedSkuKeys: [skuKey],
              dictionaryMemo,
            });
            if (!fieldAccepted(result, field.attributeId)
              && !leaf.unresolvedValues?.length) throw validationError(result);
            nextLeaves = { ...nextLeaves, [skuKey]: candidate };
          }
          values[key] = composeSkuAttributeValue(
            values[key] || suggestion,
            nextLeaves,
            skuKeys,
          );
          continue;
        }
        const hintedIds = suggestion.dictionaryMatches?.map((match) => match.dictionaryValueId);
        const canonical = await canonicalValue({
          ...input,
          schema,
          field,
          value: suggestion.value,
          sourceContext,
          hintedIds: hintedIds?.length ? hintedIds : undefined,
          dictionaryMemo,
        });
        const candidate: OzonListingDraftAttributeValue = {
          ...canonical,
          source: suggestion.source,
          reviewed: true,
          evidence: uniqueEvidence(suggestion.evidence),
          confidence: suggestion.confidence,
          suggestionProvenance: persistedSuggestionProvenance(
            suggestion,
            attributeId,
            suggestion.evidenceDetails,
          ),
          ...(suggestion.unresolvedValues?.length
            ? { unresolvedValues: structuredClone(suggestion.unresolvedValues) }
            : {}),
          manualReview: suggestion.unresolvedValues?.length ? 'REQUIRED' : 'CONFIRMED',
        };
        const result = await validateValues({
          ...input,
          schema: { ...schema, fields: [field] },
          values: { [key]: candidate },
          dictionaryMemo,
        });
        if (!fieldAccepted(result, field.attributeId)
          && !suggestion.unresolvedValues?.length) throw validationError(result);
        values[key] = candidate;
      }
      return values;
    },

    async validate(input: {
      ownerUserId: string;
      draft: OzonListingDraft;
    }): Promise<OzonAttributeValidationResult> {
      return (await validateAuthoritative(input)).result;
    },

    async retainCompatibleReviewedValues(input: {
      ownerUserId: string;
      draft: OzonListingDraft;
      category: OzonListingDraftCategory;
    }): Promise<Record<string, OzonListingDraftAttributeValue>> {
      const dictionaryMemo: DictionaryMemo = new Map();
      const schema = await loadSchema(input);
      const retained: Record<string, OzonListingDraftAttributeValue> = {};
      for (const [key, value] of Object.entries(input.draft.attributes.values)) {
        if (CATEGORY_INDEPENDENT_MANUAL_FACT_KEYS.has(key)
          && value.source === 'MANUAL'
          && value.reviewed === true
          && (value.evidence?.length || 0) > 0) {
          retained[key] = structuredClone(value);
          continue;
        }
        const field = schema.fields.find((entry) => String(entry.attributeId) === key);
        if (!field) continue;
        if (field.ownership === 'SKU') {
          let retainedLeaves: Record<string, OzonListingDraftAttributeValue> = {};
          for (const skuKey of selectedSkuKeys(input.draft)) {
            const leaf = value.skuValues?.[skuKey];
            if (!leaf?.reviewed) continue;
            const candidateRoot = composeSkuAttributeValue(value, { [skuKey]: leaf }, [skuKey]);
            const result = await validateValues({
              ...input,
              schema: { ...schema, fields: [field] },
              values: { [key]: candidateRoot },
              selectedSkuKeys: [skuKey],
              freshness: 'OFFICIAL_REFRESH_REQUIRED',
              dictionaryMemo,
            });
            if (fieldAccepted(result, field.attributeId)) {
              retainedLeaves = { ...retainedLeaves, [skuKey]: structuredClone(leaf) };
            }
          }
          if (Object.keys(retainedLeaves).length) {
            retained[key] = composeSkuAttributeValue(
              value,
              retainedLeaves,
              selectedSkuKeys(input.draft),
            );
          }
          continue;
        }
        if (!value.reviewed) continue;
        const result = await validateValues({
          ...input,
          schema: { ...schema, fields: [field] },
          values: { [key]: value },
          freshness: 'OFFICIAL_REFRESH_REQUIRED',
          dictionaryMemo,
        });
        if (fieldAccepted(result, field.attributeId)) retained[key] = structuredClone(value);
      }
      return retained;
    },
  };
}

export type SourceListingWorkflowAttributeService = ReturnType<
  typeof createSourceListingWorkflowAttributeService
>;

import type {
  OzonAttributeCardinality,
  OzonAttributeManualReviewState,
  OzonAttributeValueType,
  OzonListingDraftAttributeValue,
  OzonNormalizedAttributeField,
  SourceStandardAttributes,
} from 'shared';
import type { SourceProductProfile } from './source-product-profile.js';

export type OzonAttributeSuggestionEvidenceSource =
  | 'SOURCE_STANDARD'
  | 'SOURCE_PROFILE'
  | 'VISUAL';

export interface OzonAttributeSuggestionEvidence {
  id: string;
  attributeId: number;
  source: OzonAttributeSuggestionEvidenceSource;
  path: string;
  value: unknown;
  confidence: number;
  isEstimated: boolean;
}

export interface OzonAttributeAiCandidate {
  attributeId: number;
  value: unknown;
  confidence: number;
  evidence: string[];
}

export interface OzonAttributeDictionaryMatch {
  attributeId: number;
  inputValue: string | number | boolean;
  dictionaryValueId: number;
  canonicalValue: string;
}

export type OzonAttributeSuggestionBlockReason =
  | 'STRICT_DICTIONARY_UNRESOLVED'
  | 'AI_FORBIDDEN_FACT'
  | 'AI_FIELD_NOT_ELIGIBLE'
  | 'AI_EVIDENCE_REQUIRED'
  | 'AI_ESTIMATED_EVIDENCE_FORBIDDEN'
  | 'AI_VALUE_INVALID'
  | 'AI_CARDINALITY_INVALID'
  | 'AI_SOURCE_PRIORITY';

type SuggestionScalar = string | number | boolean;
export type OzonStandardAttributeSuggestionKey =
  | 'brand'
  | 'colors'
  | 'sizes'
  | 'materials'
  | 'gender'
  | 'seasons';
type StandardKey = OzonStandardAttributeSuggestionKey;

export interface OzonStandardAttributeEvidence {
  id: string;
  path: string;
  confidence: number;
  isEstimated: boolean;
}

export interface OzonAttributeSuggestion extends OzonListingDraftAttributeValue {
  attributeId: number;
  attributeName: string;
  valueType: OzonAttributeValueType;
  cardinality: OzonAttributeCardinality;
  value: SuggestionScalar | SuggestionScalar[];
  evidence: string[];
  evidenceDetails: OzonAttributeSuggestionEvidence[];
  dictionaryMatches: OzonAttributeDictionaryMatch[];
  manualReview: OzonAttributeManualReviewState;
}

export interface OzonAttributeSuggestionBlock {
  attributeId: number;
  attributeName: string;
  reasonCode: OzonAttributeSuggestionBlockReason;
  message: string;
  candidateValue: unknown;
  unsupportedValues: SuggestionScalar[];
  evidence: string[];
  manualReview: 'REQUIRED';
}

export interface BuildOzonAttributeSuggestionsInput {
  fields: readonly OzonNormalizedAttributeField[];
  sourceProfile: SourceProductProfile;
  sourceStandard?: SourceStandardAttributes | null;
  sourceStandardEvidence?: Partial<Record<
    OzonStandardAttributeSuggestionKey,
    OzonStandardAttributeEvidence
  >>;
  allowSourceProfileFallback?: boolean;
  evidence?: readonly OzonAttributeSuggestionEvidence[];
  aiCandidates?: readonly OzonAttributeAiCandidate[];
  dictionaryMatches?: readonly OzonAttributeDictionaryMatch[];
}

export interface OzonAttributeSuggestionResult {
  suggestions: Record<string, OzonAttributeSuggestion>;
  blocked: OzonAttributeSuggestionBlock[];
}

const FORBIDDEN_AI_FACT_RE = /(?:certif|сертифик|декларац(?:ия|ии)?\s+соответ|认证|合格证|warrant|гарант|保修|质保|hazard|опасност|危险|flammab|легковосплам|legal|юридическ|правов|закон|法规|法律|лиценз|许可|country\s+of\s+origin|страна\s+происхожд|происхождени|原产|产地|manufacturer|manufacturing|производител|изготовител|制造商|生产商|weight|(?:^|[^\p{L}\p{N}])вес(?:$|[^\p{L}\p{N}])|重量|dimension|габарит|длин[аы]?|ширин[аы]?|высот[аы]?|包装.*(?:尺寸|长|宽|高)|(?:包装|包裹)尺寸)/iu;
const PACKAGING_DIMENSION_RE = /(?:dimension|габарит|длин|ширин|высот|упаков|包装|包裹)/iu;

function normalizedText(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKC').replace(/\s+/g, ' ').trim()
    : '';
}

function confidence(value: unknown): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(Math.max(0, Math.min(1, numeric)) * 10_000) / 10_000;
}

function uniqueStrings(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of values) {
    const value = normalizedText(raw);
    const key = value.toLocaleLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function standardKeyForField(field: OzonNormalizedAttributeField): StandardKey | null {
  const name = normalizedText(field.name);
  if (!name) return null;
  if (/(?:бренд|brand|品牌|商标)/iu.test(name)) return 'brand';
  if (/(?:цвет|color|colour|颜色|色号)/iu.test(name)) return 'colors';
  if (/(?:материал|состав|material|fabric|composition|材质|面料|成分)/iu.test(name)) return 'materials';
  if (/(?:^|\s)пол(?:\s|$)|gender|性别|适用人群/iu.test(name)) return 'gender';
  if (/(?:сезон|season|季节)/iu.test(name)) return 'seasons';
  if (!PACKAGING_DIMENSION_RE.test(name) && /(?:размер|size|尺码|规格)/iu.test(name)) return 'sizes';
  return null;
}

function profileGender(profile: SourceProductProfile): string {
  return profile.genderSeasonHints.find((value) => (
    /^(?:female|male|unisex|женск(?:ий|ая)?|мужск(?:ой|ая)?|女|男|中性)$/iu.test(normalizedText(value))
  )) || '';
}

function profileSeasons(profile: SourceProductProfile): string[] {
  return profile.genderSeasonHints.filter((value) => (
    /^(?:all-season|spring|summer|autumn|fall|winter|всесезон|весн|лет|осен|зим|四季|春|夏|秋|冬)/iu.test(normalizedText(value))
  ));
}

function standardValue(input: BuildOzonAttributeSuggestionsInput, key: StandardKey, attributeId: number): {
  value: string | string[];
  evidence: OzonAttributeSuggestionEvidence;
} | null {
  const standard = input.sourceStandard;

  let value: string | string[] = '';
  let path = `sourceStandardAttributes.${key}`;
  if (key === 'brand') {
    if (standard?.brand.isBrandless) {
      value = 'Без бренда';
      path = 'sourceStandardAttributes.brand.isBrandless';
    } else {
      value = normalizedText(standard?.brand.value);
      path = 'sourceStandardAttributes.brand.value';
    }
  } else if (key === 'gender') {
    value = normalizedText(standard?.gender.value);
    path = 'sourceStandardAttributes.gender.value';
  } else if (key === 'colors') value = uniqueStrings(standard?.colors);
  else if (key === 'sizes') value = uniqueStrings(standard?.sizes);
  else if (key === 'materials') value = uniqueStrings(standard?.materials);
  else value = uniqueStrings(standard?.seasons);

  const hasValue = Array.isArray(value) ? value.length > 0 : !!value;
  if (standard && hasValue) {
    const proof = input.sourceStandardEvidence?.[key];
    if (input.sourceStandardEvidence !== undefined
      && (!proof || proof.isEstimated || confidence(proof.confidence) <= 0)) {
      return null;
    }
    return {
      value,
      evidence: {
        id: proof?.id || `source-standard:${attributeId}:${key}`,
        attributeId,
        source: 'SOURCE_STANDARD',
        path: proof?.path || path,
        value,
        confidence: proof ? confidence(proof.confidence) : 0.98,
        isEstimated: proof?.isEstimated ?? false,
      },
    };
  }

  if (input.allowSourceProfileFallback === false) return null;
  if (key === 'colors') value = uniqueStrings(input.sourceProfile.colors);
  else if (key === 'sizes') value = uniqueStrings(input.sourceProfile.sizes);
  else if (key === 'materials') value = uniqueStrings(input.sourceProfile.materials);
  else if (key === 'gender') value = profileGender(input.sourceProfile);
  else if (key === 'seasons') value = profileSeasons(input.sourceProfile);
  else return null;
  if (Array.isArray(value) ? !value.length : !value) return null;
  return {
    value,
    evidence: {
      id: `source-profile:${attributeId}:${key}`,
      attributeId,
      source: 'SOURCE_PROFILE',
      path: `sourceProfile.${key === 'gender' || key === 'seasons' ? 'genderSeasonHints' : key}`,
      value,
      confidence: 0.94,
      isEstimated: false,
    },
  };
}

function scalarKey(value: SuggestionScalar): string {
  return `${typeof value}:${typeof value === 'string' ? normalizedText(value).toLocaleLowerCase() : String(value)}`;
}

function uniqueScalars(values: SuggestionScalar[]): SuggestionScalar[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = scalarKey(value);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function validScalar(value: unknown, valueType: OzonAttributeValueType): value is SuggestionScalar {
  if (valueType === 'STRING' || valueType === 'DATE' || valueType === 'DATETIME') {
    return typeof value === 'string' && !!normalizedText(value);
  }
  if (valueType === 'INTEGER') return typeof value === 'number' && Number.isSafeInteger(value);
  if (valueType === 'DECIMAL') return typeof value === 'number' && Number.isFinite(value);
  if (valueType === 'BOOLEAN') return typeof value === 'boolean';
  return false;
}

function normalizeValue(field: OzonNormalizedAttributeField, raw: unknown): {
  value: SuggestionScalar | SuggestionScalar[];
  values: SuggestionScalar[];
} | null {
  const rawValues = Array.isArray(raw) ? raw : [raw];
  if (field.cardinality === 'SINGLE' && rawValues.length !== 1) return null;
  const values = uniqueScalars(rawValues.flatMap((entry) => (
    validScalar(entry, field.valueType)
      ? [typeof entry === 'string' ? normalizedText(entry) : entry]
      : []
  )));
  if (!values.length || values.length !== rawValues.length) return null;
  return {
    value: field.cardinality === 'MULTI' ? values : values[0]!,
    values,
  };
}

function validDictionaryMatches(
  input: BuildOzonAttributeSuggestionsInput,
  field: OzonNormalizedAttributeField,
): OzonAttributeDictionaryMatch[] {
  return (input.dictionaryMatches || []).filter((match) => (
    match.attributeId === field.attributeId
    && Number.isSafeInteger(match.dictionaryValueId)
    && match.dictionaryValueId > 0
    && !!normalizedText(match.canonicalValue)
  )).map((match) => ({
    ...match,
    canonicalValue: normalizedText(match.canonicalValue),
  }));
}

function matchedDictionaryValues(
  values: SuggestionScalar[],
  matches: OzonAttributeDictionaryMatch[],
): { matched: OzonAttributeDictionaryMatch[]; unsupported: SuggestionScalar[] } {
  const byValue = new Map(matches.map((match) => [scalarKey(match.inputValue), match]));
  const matched: OzonAttributeDictionaryMatch[] = [];
  const unsupported: SuggestionScalar[] = [];
  for (const value of values) {
    const match = byValue.get(scalarKey(value));
    if (match) matched.push(match);
    else unsupported.push(value);
  }
  return { matched, unsupported };
}

function blocked(
  field: OzonNormalizedAttributeField,
  reasonCode: OzonAttributeSuggestionBlockReason,
  message: string,
  candidateValue: unknown,
  evidence: string[] = [],
  unsupportedValues: SuggestionScalar[] = [],
): OzonAttributeSuggestionBlock {
  return {
    attributeId: field.attributeId,
    attributeName: field.name,
    reasonCode,
    message,
    candidateValue,
    unsupportedValues,
    evidence,
    manualReview: 'REQUIRED',
  };
}

function createSuggestion(input: {
  field: OzonNormalizedAttributeField;
  normalized: NonNullable<ReturnType<typeof normalizeValue>>;
  source: 'SOURCE' | 'AI';
  confidence: number;
  evidence: OzonAttributeSuggestionEvidence[];
  dictionaryMatches: OzonAttributeDictionaryMatch[];
}): { suggestion: OzonAttributeSuggestion | null; block: OzonAttributeSuggestionBlock | null } {
  const { field } = input;
  const dictionary = matchedDictionaryValues(input.normalized.values, input.dictionaryMatches);
  const strictBlock = field.valuePolicy === 'STRICT_DICTIONARY' && dictionary.unsupported.length
    ? blocked(
      field,
      'STRICT_DICTIONARY_UNRESOLVED',
      'Strict dictionary values must be resolved by the server before they can be suggested',
      input.normalized.value,
      input.evidence.map((entry) => entry.id),
      dictionary.unsupported,
    )
    : null;
  if (strictBlock && !dictionary.matched.length) {
    return { suggestion: null, block: strictBlock };
  }

  const dictionaryStatus = field.valuePolicy === 'FREE_TEXT'
    ? 'NOT_APPLICABLE' as const
    : field.valuePolicy === 'STRICT_DICTIONARY' && dictionary.unsupported.length
      ? 'UNSUPPORTED' as const
    : dictionary.unsupported.length
      ? 'UNRESOLVED' as const
      : 'MATCHED' as const;
  const singleMatch = dictionaryStatus === 'MATCHED' && dictionary.matched.length === 1
    ? dictionary.matched[0]!
    : null;
  const requiresRussianReview = field.requiresRussianText === true
    && input.normalized.values.some((value) => typeof value === 'string' && /[\u3400-\u9fff]/u.test(value));
  const manualReview: OzonAttributeManualReviewState = input.source === 'AI'
    || field.editorMode === 'MANUAL_REQUIRED'
    || dictionaryStatus === 'UNRESOLVED'
    || dictionaryStatus === 'UNSUPPORTED'
    || requiresRussianReview
    ? 'REQUIRED'
    : 'NOT_REQUIRED';
  const suggestionValue = dictionaryStatus === 'UNSUPPORTED'
    ? (field.cardinality === 'MULTI'
      ? dictionary.matched.map((match) => match.inputValue)
      : dictionary.matched[0]!.inputValue)
    : input.normalized.value;
  return {
    suggestion: {
      attributeId: field.attributeId,
      attributeName: field.name,
      valueType: field.valueType,
      cardinality: field.cardinality,
      value: suggestionValue,
      source: input.source,
      reviewed: false,
      evidence: input.evidence.map((entry) => entry.id),
      evidenceDetails: input.evidence,
      confidence: input.confidence,
      dictionaryMatch: {
        status: dictionaryStatus,
        dictionaryValueId: singleMatch?.dictionaryValueId ?? null,
        canonicalValue: singleMatch?.canonicalValue ?? null,
      },
      dictionaryMatches: dictionary.matched,
      manualReview,
    },
    block: strictBlock,
  };
}

function hasEvidenceValue(value: unknown): boolean {
  if (typeof value === 'string') return !!normalizedText(value);
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'boolean') return true;
  if (Array.isArray(value)) return value.length > 0;
  return !!value && typeof value === 'object' && Object.keys(value as Record<string, unknown>).length > 0;
}

function aiForbidden(field: OzonNormalizedAttributeField): boolean {
  return field.complianceSensitive === true
    || field.ownership === 'COMPLIANCE'
    || FORBIDDEN_AI_FACT_RE.test(`${field.name} ${field.description}`);
}

function aiEligible(field: OzonNormalizedAttributeField): boolean {
  return field.ownership === 'EDITOR'
    && field.editorMode === 'EDITABLE'
    && field.aiSuggestionAllowed === true
    && field.valueType !== 'UNKNOWN'
    && field.valueType !== 'JSON';
}

export function buildOzonAttributeSuggestions(
  input: BuildOzonAttributeSuggestionsInput,
): OzonAttributeSuggestionResult {
  const suggestions: Record<string, OzonAttributeSuggestion> = {};
  const blockedCandidates: OzonAttributeSuggestionBlock[] = [];
  const fieldById = new Map(input.fields.map((field) => [field.attributeId, field]));
  const evidenceById = new Map((input.evidence || []).map((entry) => [entry.id, entry]));

  for (const field of input.fields) {
    if (field.ownership !== 'EDITOR' && field.ownership !== 'SKU') continue;
    const key = standardKeyForField(field);
    if (!key) continue;
    const source = standardValue(input, key, field.attributeId);
    if (!source) continue;
    const normalized = normalizeValue(field, source.value);
    if (!normalized) continue;
    const created = createSuggestion({
      field,
      normalized,
      source: 'SOURCE',
      confidence: source.evidence.confidence,
      evidence: [source.evidence],
      dictionaryMatches: validDictionaryMatches(input, field),
    });
    if (created.suggestion) suggestions[String(field.attributeId)] = created.suggestion;
    if (created.block) blockedCandidates.push(created.block);
  }

  for (const candidate of input.aiCandidates || []) {
    const field = fieldById.get(candidate.attributeId);
    if (!field) continue;
    if (suggestions[String(field.attributeId)]) {
      blockedCandidates.push(blocked(
        field,
        'AI_SOURCE_PRIORITY',
        'Direct source evidence takes priority over an AI suggestion',
        candidate.value,
        candidate.evidence,
      ));
      continue;
    }
    if (aiForbidden(field)) {
      blockedCandidates.push(blocked(
        field,
        'AI_FORBIDDEN_FACT',
        'This fact must come from authoritative source or explicit manual evidence',
        candidate.value,
        candidate.evidence,
      ));
      continue;
    }
    if (!aiEligible(field)) {
      blockedCandidates.push(blocked(
        field,
        'AI_FIELD_NOT_ELIGIBLE',
        'The normalized Ozon schema does not allow AI suggestions for this field',
        candidate.value,
        candidate.evidence,
      ));
      continue;
    }
    const normalized = normalizeValue(field, candidate.value);
    if (!normalized) {
      const reason = field.cardinality === 'SINGLE'
        && Array.isArray(candidate.value)
        && candidate.value.length !== 1
        ? 'AI_CARDINALITY_INVALID'
        : 'AI_VALUE_INVALID';
      blockedCandidates.push(blocked(
        field,
        reason,
        'AI candidate value does not match the field type or cardinality',
        candidate.value,
        candidate.evidence,
      ));
      continue;
    }

    const requestedEvidence = [...new Set(
      (Array.isArray(candidate.evidence) ? candidate.evidence : []).map(normalizedText).filter(Boolean),
    )];
    const resolvedEvidence = requestedEvidence
      .map((id) => evidenceById.get(id))
      .filter((entry): entry is OzonAttributeSuggestionEvidence => !!entry)
      .filter((entry) => (
        entry.attributeId === field.attributeId
        && (entry.source === 'SOURCE_PROFILE' || entry.source === 'VISUAL')
      ));
    const usableEvidence = resolvedEvidence.filter((entry) => (
      entry.isEstimated === false
      && confidence(entry.confidence) > 0
      && hasEvidenceValue(entry.value)
    ));
    if (!usableEvidence.length) {
      const estimated = resolvedEvidence.some((entry) => entry.isEstimated === true);
      blockedCandidates.push(blocked(
        field,
        estimated ? 'AI_ESTIMATED_EVIDENCE_FORBIDDEN' : 'AI_EVIDENCE_REQUIRED',
        estimated
          ? 'Estimated evidence cannot ground an AI attribute suggestion'
          : 'AI attribute suggestions require bound source-profile or visual evidence',
        candidate.value,
        requestedEvidence,
      ));
      continue;
    }
    const candidateConfidence = confidence(candidate.confidence);
    if (candidateConfidence <= 0) {
      blockedCandidates.push(blocked(
        field,
        'AI_VALUE_INVALID',
        'AI candidate confidence must be greater than zero',
        candidate.value,
        requestedEvidence,
      ));
      continue;
    }
    const groundedConfidence = Math.min(
      candidateConfidence,
      ...usableEvidence.map((entry) => confidence(entry.confidence)),
    );
    const created = createSuggestion({
      field,
      normalized,
      source: 'AI',
      confidence: groundedConfidence,
      evidence: usableEvidence,
      dictionaryMatches: validDictionaryMatches(input, field),
    });
    if (created.suggestion) suggestions[String(field.attributeId)] = created.suggestion;
    if (created.block) blockedCandidates.push(created.block);
  }

  return { suggestions, blocked: blockedCandidates };
}

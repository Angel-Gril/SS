import {
  AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH,
  isAiMediaPlanningJsonWithinBudget,
} from './ai-media-planning-contract.js';

export const AI_IMAGE_VISION_OUTPUT_VERSION = '1.0' as const;
export const AI_IMAGE_VISION_VERSION = AI_IMAGE_VISION_OUTPUT_VERSION;

const MAX_CANDIDATES = 25;
const MAX_FACTS = 100;
const MAX_JSON_DEPTH = 12;
const MAX_JSON_NODES = 4096;
const MAX_OBJECT_KEYS = 200;
const MAX_ARRAY_ITEMS = 200;
const MAX_ID_LENGTH = AI_MEDIA_PLANNING_IDENTIFIER_MAX_LENGTH;
const MAX_PATH_LENGTH = 2048;
const MAX_OBSERVATION_LENGTH = 500;
const MAX_CLAIM_FIELD_LENGTH = 100;

const PRODUCT_IDENTITIES = new Set<AiImageProductIdentity>([
  'same_product',
  'variant',
  'different_product',
  'uncertain',
]);
const CONTENT_ROLES = new Set<AiImageContentRole>(['identity', 'context', 'detail']);

export type AiImageProductIdentity = 'same_product' | 'variant' | 'different_product' | 'uncertain';
export type AiImageContentRole = 'identity' | 'context' | 'detail';

export interface AiImageVerifiedFact {
  path: string;
  value: unknown;
  evidenceIds: string[];
}

export interface AiImageVisibleTextObservation {
  text: string;
  language: string;
}

export interface AiImageVisionObservations {
  colors: string[];
  shapes: string[];
  visibleComponents: string[];
  visibleText: AiImageVisibleTextObservation[];
}

export interface AiImageVisionResultImage {
  candidateId: string;
  productIdentity: AiImageProductIdentity;
  identityConfidence: number;
  contentRoles: AiImageContentRole[];
  observations: AiImageVisionObservations;
}

export interface AiImageUnsupportedClaim {
  candidateId: string;
  field: string;
  value: unknown;
}

export type AiImageVisionDiagnosticCode =
  | 'UNKNOWN_CANDIDATE_RESULT'
  | 'DUPLICATE_CANDIDATE_RESULT'
  | 'INVALID_CANDIDATE_RESULT'
  | 'MISSING_CANDIDATE_RESULT'
  | 'INVALID_MODEL_OUTPUT';

export interface AiImageVisionDiagnostic {
  code: AiImageVisionDiagnosticCode;
  candidateId?: string;
}

export interface NormalizeAiImageVisionInput {
  candidateIds: string[];
  verifiedFacts: AiImageVerifiedFact[];
  modelOutput: unknown;
}

export interface NormalizedAiImageVisionOutput {
  version: typeof AI_IMAGE_VISION_OUTPUT_VERSION;
  mode: 'model' | 'fallback';
  fallbackReason: 'INVALID_MODEL_OUTPUT' | 'NO_VALID_MODEL_RESULTS' | null;
  verifiedFacts: AiImageVerifiedFact[];
  images: AiImageVisionResultImage[];
  unsupportedClaims: AiImageUnsupportedClaim[];
  discardedCandidateIds: string[];
  diagnostics: AiImageVisionDiagnostic[];
}

interface JsonBudget {
  nodes: number;
}

interface ParsedModelOutput {
  images: unknown[];
}

interface NormalizedModelImage {
  image: AiImageVisionResultImage;
  claims: AiImageUnsupportedClaim[];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function boundedString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) return null;
  return normalized;
}

function boundedIdentifier(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) return null;
  return value === value.trim() ? value : null;
}

function trustedString(value: unknown, field: string, maxLength: number): string {
  const normalized = boundedString(value, maxLength);
  if (normalized === null) throw new TypeError(`AI image vision ${field} is invalid`);
  return normalized;
}

function cloneJson(value: unknown, field: string, depth = 0, budget: JsonBudget = { nodes: 0 }): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) {
    throw new TypeError(`AI image vision ${field} exceeds JSON limits`);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError(`AI image vision ${field} is not finite`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) {
      throw new TypeError(`AI image vision ${field} exceeds array limits`);
    }
    return value.map((entry, index) => cloneJson(entry, `${field}[${index}]`, depth + 1, budget));
  }
  if (!isPlainObject(value)) throw new TypeError(`AI image vision ${field} is not JSON serializable`);
  const entries = Object.entries(value);
  if (entries.length > MAX_OBJECT_KEYS) {
    throw new TypeError(`AI image vision ${field} exceeds object limits`);
  }
  return Object.fromEntries(entries.map(([key, entry]) => {
    if (!key || key.length > MAX_OBSERVATION_LENGTH) {
      throw new TypeError(`AI image vision ${field} contains an invalid key`);
    }
    return [key, cloneJson(entry, `${field}.${key}`, depth + 1, budget)];
  }));
}

function normalizeCandidateIds(values: string[]): string[] {
  if (!Array.isArray(values) || values.length > MAX_CANDIDATES) {
    throw new TypeError('AI image vision candidateIds is invalid');
  }
  const result = values.map((value, index) => {
    const identifier = boundedIdentifier(value, MAX_ID_LENGTH);
    if (!identifier) throw new TypeError(`AI image vision candidateIds[${index}] is invalid`);
    return identifier;
  });
  if (new Set(result).size !== result.length) {
    throw new TypeError('AI image vision candidateIds contains duplicates');
  }
  return result;
}

function normalizeVerifiedFacts(values: AiImageVerifiedFact[]): AiImageVerifiedFact[] {
  if (!Array.isArray(values) || values.length > MAX_FACTS) {
    throw new TypeError('AI image vision verifiedFacts is invalid');
  }
  return values.map((value, index) => {
    if (!isPlainObject(value)) {
      throw new TypeError(`AI image vision verifiedFacts[${index}] is invalid`);
    }
    const path = trustedString(value.path, `verifiedFacts[${index}].path`, MAX_PATH_LENGTH);
    if (!path.startsWith('/')) {
      throw new TypeError(`AI image vision verifiedFacts[${index}].path is invalid`);
    }
    if (!Array.isArray(value.evidenceIds) || value.evidenceIds.length < 1 || value.evidenceIds.length > 50) {
      throw new TypeError(`AI image vision verifiedFacts[${index}].evidenceIds is invalid`);
    }
    const evidenceIds = value.evidenceIds.map((evidenceId, evidenceIndex) => {
      const identifier = boundedIdentifier(evidenceId, MAX_ID_LENGTH);
      if (!identifier) {
        throw new TypeError(`AI image vision verifiedFacts[${index}].evidenceIds[${evidenceIndex}] is invalid`);
      }
      return identifier;
    });
    if (new Set(evidenceIds).size !== evidenceIds.length) {
      throw new TypeError(`AI image vision verifiedFacts[${index}].evidenceIds contains duplicates`);
    }
    return {
      path,
      value: cloneJson(value.value, `verifiedFacts[${index}].value`),
      evidenceIds,
    };
  });
}

function parseModelOutput(value: unknown): ParsedModelOutput | null {
  if (!isAiMediaPlanningJsonWithinBudget(value)) return null;
  let parsed = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return null;
    }
  }
  if (!isPlainObject(parsed)
    || !hasOnlyKeys(parsed, ['version', 'images'])
    || parsed.version !== AI_IMAGE_VISION_OUTPUT_VERSION
    || !Array.isArray(parsed.images)
    || parsed.images.length > MAX_CANDIDATES) {
    return null;
  }
  return { images: parsed.images };
}

function normalizeStringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 25) return null;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const normalized = boundedString(entry, MAX_OBSERVATION_LENGTH)?.toLowerCase();
    if (!normalized) return null;
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function normalizeVisibleText(value: unknown): AiImageVisibleTextObservation[] | null {
  if (!Array.isArray(value) || value.length > 25) return null;
  const result: AiImageVisibleTextObservation[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!isPlainObject(entry)) return null;
    if (!hasOnlyKeys(entry, ['text', 'language'])) return null;
    const text = boundedString(entry.text, MAX_OBSERVATION_LENGTH);
    const language = boundedString(entry.language, 50)?.toLowerCase();
    if (!text || !language) return null;
    const key = `${language}\u0000${text}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ text, language });
    }
  }
  return result;
}

function normalizeContentRoles(value: unknown): AiImageContentRole[] | null {
  if (!Array.isArray(value) || value.length > CONTENT_ROLES.size) return null;
  const result: AiImageContentRole[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || !CONTENT_ROLES.has(entry as AiImageContentRole)) return null;
    const role = entry as AiImageContentRole;
    if (!result.includes(role)) result.push(role);
  }
  return result;
}

function normalizeClaims(candidateId: string, value: unknown): AiImageUnsupportedClaim[] | null {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value);
  if (entries.length > MAX_OBJECT_KEYS) return null;
  const result: AiImageUnsupportedClaim[] = [];
  try {
    for (const [field, claimValue] of entries.sort(([left], [right]) => left.localeCompare(right))) {
      if (!field || field.length > MAX_CLAIM_FIELD_LENGTH) return null;
      result.push({
        candidateId,
        field,
        value: cloneJson(claimValue, `modelOutput.claims.${field}`),
      });
    }
  } catch {
    return null;
  }
  return result;
}

function normalizeModelImage(value: unknown, candidateId: string): NormalizedModelImage | null {
  if (!isPlainObject(value)) return null;
  if (!hasOnlyKeys(value, [
    'candidateId',
    'productIdentity',
    'identityConfidence',
    'contentRoles',
    'observations',
    'claims',
  ])
    || typeof value.productIdentity !== 'string'
    || !PRODUCT_IDENTITIES.has(value.productIdentity as AiImageProductIdentity)
    || typeof value.identityConfidence !== 'number'
    || !Number.isFinite(value.identityConfidence)
    || value.identityConfidence < 0
    || value.identityConfidence > 1
    || !isPlainObject(value.observations)
    || !hasOnlyKeys(value.observations, ['colors', 'shapes', 'visibleComponents', 'visibleText'])) {
    return null;
  }
  const contentRoles = normalizeContentRoles(value.contentRoles);
  const colors = normalizeStringList(value.observations.colors);
  const shapes = normalizeStringList(value.observations.shapes);
  const visibleComponents = normalizeStringList(value.observations.visibleComponents);
  const visibleText = normalizeVisibleText(value.observations.visibleText);
  const claims = normalizeClaims(candidateId, value.claims);
  if (!contentRoles || !colors || !shapes || !visibleComponents || !visibleText || !claims) return null;
  return {
    image: {
      candidateId,
      productIdentity: value.productIdentity as AiImageProductIdentity,
      identityConfidence: value.identityConfidence,
      contentRoles,
      observations: { colors, shapes, visibleComponents, visibleText },
    },
    claims,
  };
}

function uncertainImage(candidateId: string): AiImageVisionResultImage {
  return {
    candidateId,
    productIdentity: 'uncertain',
    identityConfidence: 0,
    contentRoles: [],
    observations: { colors: [], shapes: [], visibleComponents: [], visibleText: [] },
  };
}

function malformedFallback(
  candidateIds: string[],
  verifiedFacts: AiImageVerifiedFact[],
): NormalizedAiImageVisionOutput {
  return {
    version: AI_IMAGE_VISION_OUTPUT_VERSION,
    mode: 'fallback',
    fallbackReason: 'INVALID_MODEL_OUTPUT',
    verifiedFacts,
    images: candidateIds.map(uncertainImage),
    unsupportedClaims: [],
    discardedCandidateIds: [],
    diagnostics: [{ code: 'INVALID_MODEL_OUTPUT' }],
  };
}

export function normalizeAiImageVisionOutput(
  input: NormalizeAiImageVisionInput,
): NormalizedAiImageVisionOutput {
  const candidateIds = normalizeCandidateIds(input.candidateIds);
  const verifiedFacts = normalizeVerifiedFacts(input.verifiedFacts);
  const modelOutput = parseModelOutput(input.modelOutput);
  if (!modelOutput) return malformedFallback(candidateIds, verifiedFacts);

  const allowedCandidateIds = new Set(candidateIds);
  const seenCandidateIds = new Set<string>();
  const normalizedByCandidateId = new Map<string, NormalizedModelImage>();
  const discardedCandidateIds: string[] = [];
  const discardedSet = new Set<string>();
  const diagnostics: AiImageVisionDiagnostic[] = [];

  for (const value of modelOutput.images) {
    if (!isPlainObject(value)) {
      diagnostics.push({ code: 'INVALID_CANDIDATE_RESULT' });
      continue;
    }
    const candidateId = boundedIdentifier(value.candidateId, MAX_ID_LENGTH);
    if (!candidateId) {
      diagnostics.push({ code: 'INVALID_CANDIDATE_RESULT' });
      continue;
    }
    if (!allowedCandidateIds.has(candidateId)) {
      if (!discardedSet.has(candidateId)) {
        discardedSet.add(candidateId);
        discardedCandidateIds.push(candidateId);
      }
      diagnostics.push({ code: 'UNKNOWN_CANDIDATE_RESULT', candidateId });
      continue;
    }
    if (seenCandidateIds.has(candidateId)) {
      diagnostics.push({ code: 'DUPLICATE_CANDIDATE_RESULT', candidateId });
      continue;
    }
    const normalized = normalizeModelImage(value, candidateId);
    if (!normalized) {
      diagnostics.push({ code: 'INVALID_CANDIDATE_RESULT', candidateId });
      continue;
    }
    seenCandidateIds.add(candidateId);
    normalizedByCandidateId.set(candidateId, normalized);
  }

  for (const candidateId of candidateIds) {
    if (!seenCandidateIds.has(candidateId)) {
      diagnostics.push({ code: 'MISSING_CANDIDATE_RESULT', candidateId });
    }
  }
  const validModelResults = normalizedByCandidateId.size;
  const mode = validModelResults > 0 || candidateIds.length === 0 ? 'model' : 'fallback';
  return {
    version: AI_IMAGE_VISION_OUTPUT_VERSION,
    mode,
    fallbackReason: mode === 'fallback' ? 'NO_VALID_MODEL_RESULTS' : null,
    verifiedFacts,
    images: candidateIds.map((candidateId) => (
      normalizedByCandidateId.get(candidateId)?.image || uncertainImage(candidateId)
    )),
    unsupportedClaims: candidateIds.flatMap((candidateId) => (
      normalizedByCandidateId.get(candidateId)?.claims || []
    )),
    discardedCandidateIds,
    diagnostics,
  };
}

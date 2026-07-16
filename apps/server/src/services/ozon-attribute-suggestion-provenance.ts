import type {
  OzonListingDraftAttributeSuggestionEvidence,
  OzonListingDraftAttributeSuggestionProvenance,
} from 'shared';

export const OZON_ATTRIBUTE_SUGGESTION_PROVENANCE_MAX_EVIDENCE_ITEMS = 20;
export const OZON_ATTRIBUTE_SUGGESTION_PROVENANCE_MAX_EVIDENCE_VALUE_BYTES = 16 * 1024;
export const OZON_ATTRIBUTE_SUGGESTION_PROVENANCE_MAX_BYTES = 64 * 1024;

const ID_MAX_LENGTH = 500;
const PATH_MAX_LENGTH = 4096;
const SNAPSHOT_ID_MAX_LENGTH = 200;
const JSON_MAX_DEPTH = 20;
const JSON_MAX_NODES = 4096;
const JSON_MAX_OBJECT_KEYS = 1000;
const JSON_KEY_MAX_LENGTH = 500;
const HASH_RE = /^[a-f0-9]{64}$/;
const EVIDENCE_SOURCES = new Set(['SOURCE_STANDARD', 'SOURCE_PROFILE', 'VISUAL']);

export interface FrozenOzonAttributeSuggestionProvenanceInput {
  attributeId: number;
  candidateId: unknown;
  candidateHash: unknown;
  schemaRevision: unknown;
  sourceCaptureSnapshotId: unknown;
  sourceCaptureHash: unknown;
  draftVersion: unknown;
  draftRevision: unknown;
  evidenceDetails: unknown;
}

function invalid(field: string): never {
  throw new TypeError(`Frozen Ozon attribute suggestion ${field} is invalid`);
}

function boundedString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength) invalid(field);
  return value;
}

function hash(value: unknown, field: string): string {
  const result = boundedString(value, field, 64);
  if (!HASH_RE.test(result)) invalid(field);
  return result;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) invalid(field);
  return Number(value);
}

function cloneJsonValue(
  value: unknown,
  field: string,
  depth = 0,
  budget: { nodes: number } = { nodes: 0 },
): unknown {
  budget.nodes += 1;
  if (budget.nodes > JSON_MAX_NODES) invalid(field);
  if (depth > JSON_MAX_DEPTH) invalid(field);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) invalid(field);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length + budget.nodes > JSON_MAX_NODES) invalid(field);
    return value.map((entry, index) => cloneJsonValue(
      entry,
      `${field}[${index}]`,
      depth + 1,
      budget,
    ));
  }
  if (!value || typeof value !== 'object') invalid(field);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(field);
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > JSON_MAX_OBJECT_KEYS) invalid(field);
  if (entries.length + budget.nodes > JSON_MAX_NODES) invalid(field);
  return Object.fromEntries(entries.map(([key, entry]) => {
    if (!key || key.length > JSON_KEY_MAX_LENGTH) invalid(`${field} key`);
    return [key, cloneJsonValue(entry, `${field}.${key}`, depth + 1, budget)];
  }));
}

function jsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function evidenceDetail(
  value: unknown,
  attributeId: number,
  index: number,
): OzonListingDraftAttributeSuggestionEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(`evidenceDetails[${index}]`);
  const detail = value as Record<string, unknown>;
  if (detail.attributeId !== attributeId) invalid(`evidenceDetails[${index}].attributeId`);
  if (!EVIDENCE_SOURCES.has(String(detail.source))) invalid(`evidenceDetails[${index}].source`);
  if (typeof detail.confidence !== 'number'
    || !Number.isFinite(detail.confidence)
    || detail.confidence < 0
    || detail.confidence > 1) invalid(`evidenceDetails[${index}].confidence`);
  if (typeof detail.isEstimated !== 'boolean') invalid(`evidenceDetails[${index}].isEstimated`);
  const evidenceValue = cloneJsonValue(detail.value, `evidenceDetails[${index}].value`);
  if (jsonBytes(evidenceValue) > OZON_ATTRIBUTE_SUGGESTION_PROVENANCE_MAX_EVIDENCE_VALUE_BYTES) {
    invalid(`evidenceDetails[${index}].value`);
  }
  return {
    id: boundedString(detail.id, `evidenceDetails[${index}].id`, ID_MAX_LENGTH),
    attributeId,
    source: detail.source as OzonListingDraftAttributeSuggestionEvidence['source'],
    path: boundedString(detail.path, `evidenceDetails[${index}].path`, PATH_MAX_LENGTH),
    value: evidenceValue,
    confidence: detail.confidence,
    isEstimated: detail.isEstimated,
  };
}

export function buildOzonAttributeSuggestionProvenance(
  input: FrozenOzonAttributeSuggestionProvenanceInput,
): OzonListingDraftAttributeSuggestionProvenance {
  const attributeId = positiveInteger(input.attributeId, 'attributeId');
  if (!Array.isArray(input.evidenceDetails)
    || input.evidenceDetails.length < 1
    || input.evidenceDetails.length > OZON_ATTRIBUTE_SUGGESTION_PROVENANCE_MAX_EVIDENCE_ITEMS) {
    invalid('evidenceDetails');
  }
  const evidenceDetails = input.evidenceDetails.map((entry, index) => (
    evidenceDetail(entry, attributeId, index)
  ));
  if (new Set(evidenceDetails.map((entry) => entry.id)).size !== evidenceDetails.length) {
    invalid('evidenceDetails ids');
  }
  const provenance: OzonListingDraftAttributeSuggestionProvenance = {
    contractVersion: 'ozon-attribute-suggestion-provenance/v1',
    candidateId: boundedString(input.candidateId, 'candidateId', 200),
    candidateHash: hash(input.candidateHash, 'candidateHash'),
    schemaRevision: hash(input.schemaRevision, 'schemaRevision'),
    sourceCaptureSnapshotId: boundedString(
      input.sourceCaptureSnapshotId,
      'sourceCaptureSnapshotId',
      SNAPSHOT_ID_MAX_LENGTH,
    ),
    sourceCaptureHash: hash(input.sourceCaptureHash, 'sourceCaptureHash'),
    draftVersion: positiveInteger(input.draftVersion, 'draftVersion'),
    draftRevision: positiveInteger(input.draftRevision, 'draftRevision'),
    evidenceDetails,
  };
  if (jsonBytes(provenance) > OZON_ATTRIBUTE_SUGGESTION_PROVENANCE_MAX_BYTES) invalid('payload size');
  return provenance;
}

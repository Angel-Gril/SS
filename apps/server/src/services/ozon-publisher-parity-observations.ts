import { createHash, randomUUID } from 'node:crypto';

import {
  OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION,
  type OzonPublisherEntrypoint,
  type OzonPublisherEntrypointParityReport,
  type OzonPublisherParityClassification,
  type OzonPublisherParityDiffKind,
  type OzonPublisherParityDiffRow,
  type OzonPublisherParityPresence,
  type OzonPublisherParityStatus,
  type OzonPublisherParityValueType,
} from './ozon-publisher-entrypoint-parity.js';

export const OZON_PUBLISHER_PARITY_OBSERVATION_CONTRACT_VERSION =
  'ozon-publisher-parity-observation/v1' as const;
export const OZON_PUBLISHER_PARITY_DIFFERENCE_SUBJECT_CONTRACT_VERSION =
  'ozon-publisher-parity-difference-subject/v1' as const;

const PUBLISHER_CONTRACT_VERSION = 'ozon-listing-production-compile-adapter/v1' as const;
const PAYLOAD_COMPILER_VERSION = 'ozon-listing-payload-compiler/v1' as const;
const DEFAULT_RETENTION_DAYS = 180;
const MIN_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 3650;
const MAX_DIFF_ROWS = 100;
const MAX_DIFF_TOTAL = 50_000;
const MAX_PATH_LENGTH = 512;

type EndpointKind =
  | 'OZON_V3_PRODUCT_IMPORT'
  | 'OZON_V1_PRODUCT_IMPORT_BY_SKU'
  | 'OTHER'
  | 'INVALID';

type CompilerVersion =
  | typeof PUBLISHER_CONTRACT_VERSION
  | typeof PAYLOAD_COMPILER_VERSION
  | null;

export interface SanitizedOzonPublisherParityCompilerVersions {
  publisherContractVersion: typeof PUBLISHER_CONTRACT_VERSION | null;
  payloadCompilerVersion: typeof PAYLOAD_COMPILER_VERSION | null;
}

interface SanitizedPayloadSummary {
  endpointKind: EndpointKind;
  payloadHash: string;
  itemCount: number;
}

interface SanitizedCompiledPayloadSummary extends SanitizedPayloadSummary {
  kind: 'COMPILED';
  compilerVersions: SanitizedOzonPublisherParityCompilerVersions;
}

interface SanitizedBlockedPayloadSummary {
  kind: 'BLOCKED';
  blockerCode: string;
  endpointKind: null;
  payloadHash: null;
  itemCount: null;
  compilerVersions: SanitizedOzonPublisherParityCompilerVersions;
}

interface SanitizedUnavailablePayloadSummary {
  kind: 'UNAVAILABLE';
  reasonCode: string;
  endpointKind: null;
  payloadHash: null;
  itemCount: null;
  compilerVersions: SanitizedOzonPublisherParityCompilerVersions;
}

export interface SanitizedOzonPublisherParityReport {
  contractVersion: typeof OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION;
  entrypoint: OzonPublisherEntrypoint;
  status: OzonPublisherParityStatus;
  classification: OzonPublisherParityClassification;
  switchEligible: boolean;
  legacy: SanitizedPayloadSummary;
  v2:
    | SanitizedCompiledPayloadSummary
    | SanitizedBlockedPayloadSummary
    | SanitizedUnavailablePayloadSummary;
  differences: {
    total: number;
    returned: number;
    truncated: boolean;
    rows: OzonPublisherParityDiffRow[];
  };
}

export interface OzonPublisherParityDifferenceSubject {
  contractVersion: typeof OZON_PUBLISHER_PARITY_DIFFERENCE_SUBJECT_CONTRACT_VERSION;
  key: string;
  entrypoint: OzonPublisherEntrypoint;
  rolloutRevision: string;
  legacyEndpointKind: EndpointKind;
  legacyItemCount: number;
  v2EndpointKind: EndpointKind;
  v2ItemCount: number;
  classification: Exclude<OzonPublisherParityClassification, 'MATCH' | 'NOT_COMPARABLE'>;
  compilerVersions: {
    publisherContractVersion: typeof PUBLISHER_CONTRACT_VERSION;
    payloadCompilerVersion: typeof PAYLOAD_COMPILER_VERSION;
  };
  differenceCount: number;
  rowsHash: string;
  rows: OzonPublisherParityDiffRow[];
  complete: true;
  approvalEligible: boolean;
}

export type OzonPublisherParityApprovalState =
  | 'PENDING'
  | 'APPROVED'
  | 'REJECTED'
  | 'REVOKED';

export interface OzonPublisherParityDifferenceSubjectRecord
extends OzonPublisherParityDifferenceSubject {
  approvalState: OzonPublisherParityApprovalState;
  stateVersion: number;
  observationCount: number;
  firstObservedAt: string;
  lastObservedAt: string;
  reviewedByUserId: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  revokedAt: string | null;
}

export interface OzonPublisherParityObservationRecord {
  id: string;
  recordKey: string;
  contractVersion: typeof OZON_PUBLISHER_PARITY_OBSERVATION_CONTRACT_VERSION;
  scopeHash: string;
  rolloutRevision: string;
  entrypoint: OzonPublisherEntrypoint;
  reportHash: string;
  report: SanitizedOzonPublisherParityReport;
  differenceSubjectKey: string | null;
  approvalEligible: boolean;
  eligibleAttemptKey?: string | null;
  observedAt: string;
  expiresAt: string;
}

export interface OzonPublisherParityObservationCursor {
  observedAt: string;
  id: string;
}

export interface ListOzonPublisherParityObservationsInput {
  entrypoint?: OzonPublisherEntrypoint;
  status?: OzonPublisherParityStatus;
  differenceSubjectKey?: string;
  cursor?: OzonPublisherParityObservationCursor | null;
  limit: number;
}

export interface ListOzonPublisherParityObservationsResult {
  observations: OzonPublisherParityObservationRecord[];
  nextCursor: OzonPublisherParityObservationCursor | null;
}

export interface OzonPublisherParityDifferenceSubjectCursor {
  lastObservedAt: string;
  key: string;
}

export interface ListOzonPublisherParityDifferenceSubjectsInput {
  entrypoint?: OzonPublisherEntrypoint;
  rolloutRevision?: string;
  approvalEligible?: boolean;
  cursor?: OzonPublisherParityDifferenceSubjectCursor | null;
  limit: number;
}

export interface ListOzonPublisherParityDifferenceSubjectsResult {
  subjects: OzonPublisherParityDifferenceSubjectRecord[];
  nextCursor: OzonPublisherParityDifferenceSubjectCursor | null;
}

export type OzonPublisherParityDifferenceReviewAction = 'APPROVE' | 'REJECT' | 'REVOKE';
export type OzonPublisherParityDifferenceReviewStatus = 'APPROVED' | 'REJECTED' | 'REVOKED';

export interface OzonPublisherParityDifferenceReviewRecord {
  subjectKey: string;
  status: OzonPublisherParityDifferenceReviewStatus;
  transitionVersion: number;
  actorUserId: string;
  reviewNote: string;
  reviewedAt: string;
  operationKey: string;
  requestHash: string;
}

export interface ApplyOzonPublisherParityDifferenceReviewInput {
  action: OzonPublisherParityDifferenceReviewAction;
  subjectKey: string;
  expectedTransitionVersion: number;
  actorUserId: string;
  reviewNote: string;
  operationKey: string;
  requestHash: string;
  reviewedAt: Date;
}

export interface PruneExpiredOzonPublisherParityObservationsInput {
  expiredBefore: Date;
  limit: number;
}

export interface PruneExpiredOzonPublisherParityObservationsResult {
  deletedCount: number;
  hasMore: boolean;
}

export interface OzonPublisherParityObservationRepository {
  createObservation(input: OzonPublisherParityObservationRecord): Promise<{
    observation: OzonPublisherParityObservationRecord;
    created: boolean;
  }>;
  listObservations(
    input: ListOzonPublisherParityObservationsInput,
  ): Promise<ListOzonPublisherParityObservationsResult>;
  findDifferenceSubject(input: {
    subjectKey: string;
  }): Promise<OzonPublisherParityDifferenceSubjectRecord | null>;
  listDifferenceSubjects(
    input: ListOzonPublisherParityDifferenceSubjectsInput,
  ): Promise<ListOzonPublisherParityDifferenceSubjectsResult>;
  applyDifferenceReview(input: ApplyOzonPublisherParityDifferenceReviewInput): Promise<{
    review: OzonPublisherParityDifferenceReviewRecord;
    idempotent: boolean;
  }>;
  pruneObservations(
    input: PruneExpiredOzonPublisherParityObservationsInput,
  ): Promise<PruneExpiredOzonPublisherParityObservationsResult>;
}

export class OzonPublisherParityObservationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode = 422,
  ) {
    super(message);
    this.name = 'OzonPublisherParityObservationError';
  }
}

const ENTRYPOINTS = new Set<OzonPublisherEntrypoint>([
  'COLLECT_PUBLISH_OZON', 'LISTING_BATCH', 'LISTING_IMPORT_BY_SKU',
  'BROWSER_ONE_CLICK', 'EXTENSION_ADAPTER',
]);
const STATUSES = new Set<OzonPublisherParityStatus>([
  'MATCH', 'DIFFERENT', 'V2_BLOCKED', 'NOT_COMPARABLE',
]);
const CLASSIFICATIONS = new Set<OzonPublisherParityClassification>([
  'MATCH', 'INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM', 'DEFECT', 'NOT_COMPARABLE',
]);
const DIFF_KINDS = new Set<OzonPublisherParityDiffKind>([
  'MISSING_IN_V2', 'MISSING_IN_LEGACY', 'TYPE_MISMATCH', 'VALUE_MISMATCH',
  'ORDER_MISMATCH', 'INVALID_PAYLOAD',
]);
const PRESENCES = new Set<OzonPublisherParityPresence>(['BOTH', 'LEGACY_ONLY', 'V2_ONLY']);
const VALUE_TYPES = new Set<OzonPublisherParityValueType>([
  'absent', 'null', 'boolean', 'number', 'string', 'array', 'object',
]);
const ENDPOINT_KINDS = new Set<EndpointKind>([
  'OZON_V3_PRODUCT_IMPORT', 'OZON_V1_PRODUCT_IMPORT_BY_SKU', 'OTHER', 'INVALID',
]);
const STRICT_BLOCKERS = new Set([
  'OZON_LISTING_COMPILE_STAGE_INVALID', 'OZON_LISTING_COMPILE_DRAFT_STALE',
  'OZON_LISTING_COMPILE_SOURCE_INVALID', 'OZON_LISTING_COMPILE_SKU_INVALID',
  'OZON_LISTING_COMPILE_VALIDATION_INVALID', 'OZON_LISTING_COMPILE_VALIDATION_STALE',
  'OZON_LISTING_COMPILE_TITLE_INVALID', 'OZON_LISTING_COMPILE_TITLE_UNREVIEWED',
  'OZON_LISTING_COMPILE_PRICING_INVALID', 'OZON_LISTING_COMPILE_PACKAGE_INVALID',
  'OZON_LISTING_COMPILE_IMAGES_INVALID', 'OZON_LISTING_COMPILE_ATTRIBUTE_UNSUPPORTED',
  'OZON_LISTING_COMPILE_OFFER_ID_INVALID', 'OZON_LISTING_PRODUCTION_CAPTURE_STALE',
  'OZON_LISTING_PRODUCTION_VALIDATION_STALE', 'OZON_LISTING_PRODUCTION_CATALOG_STALE',
  'OZON_LISTING_PRODUCTION_SCHEMA_STALE', 'OZON_LISTING_PRODUCTION_MEDIA_INVALID',
  'OZON_LISTING_PRODUCTION_PAYLOAD_INVALID',
]);
const UNAVAILABLE_REASONS = new Set([
  'CATALOG_UNAVAILABLE', 'CREDENTIAL_UNAVAILABLE', 'DATABASE_UNAVAILABLE',
  'WORKFLOW_UNAVAILABLE', 'INTERNAL_UNAVAILABLE',
]);
const SAFE_PATH_FIELDS = new Set([
  'offer_id', 'description_category_id', 'type_id', 'name', 'title', 'description',
  'price', 'old_price', 'currency_code', 'vat', 'dimension_unit', 'weight_unit',
  'weight', 'height', 'depth', 'width', 'images', 'primary_image', 'color_image',
  'attributes', 'id', 'complex_id', 'values', 'value', 'dictionary_value_id',
  'stock', 'stocks', 'quantity', 'sku', 'manufacturer', 'manufacturer_name',
  'manufacturerName',
]);

function invalid(message: string): never {
  throw new OzonPublisherParityObservationError(
    'INVALID_OZON_PUBLISHER_PARITY_OBSERVATION',
    message,
    400,
  );
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return invalid('parity report object is invalid');
  }
  return value as Record<string, unknown>;
}

function exactString(value: unknown, field: string, maxLength = 200): string {
  if (typeof value !== 'string') return invalid(`${field} is invalid`);
  const normalized = value.normalize('NFKC').trim();
  if (!normalized || normalized !== value || normalized.length > maxLength) {
    return invalid(`${field} is invalid`);
  }
  return normalized;
}

function checksum(value: unknown, field: string): string {
  const text = exactString(value, field, 64);
  if (!/^[a-f0-9]{64}$/u.test(text)) return invalid(`${field} is invalid`);
  return text;
}

function boundedInteger(value: unknown, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > maximum) {
    return invalid(`${field} is invalid`);
  }
  return Number(value);
}

function enumValue<T extends string>(value: unknown, values: Set<T>, field: string): T {
  if (typeof value !== 'string' || !values.has(value as T)) return invalid(`${field} is invalid`);
  return value as T;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== 'boolean') return invalid(`${field} is invalid`);
  return value;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const row = value as Record<string, unknown>;
  return `{${Object.keys(row).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(row[key])}`
  )).join(',')}}`;
}

function hash(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function compilerVersion(value: unknown, supported: string): CompilerVersion {
  return value === supported ? value as CompilerVersion : null;
}

function compilerVersions(value: unknown): SanitizedOzonPublisherParityCompilerVersions {
  const row = record(value);
  return {
    publisherContractVersion: compilerVersion(
      row.publisherContractVersion,
      PUBLISHER_CONTRACT_VERSION,
    ) as typeof PUBLISHER_CONTRACT_VERSION | null,
    payloadCompilerVersion: compilerVersion(
      row.payloadCompilerVersion,
      PAYLOAD_COMPILER_VERSION,
    ) as typeof PAYLOAD_COMPILER_VERSION | null,
  };
}

function payloadSummary(value: unknown, field: string): SanitizedPayloadSummary {
  const row = record(value);
  return {
    endpointKind: enumValue(row.endpointKind, ENDPOINT_KINDS, `${field}.endpointKind`),
    payloadHash: checksum(row.payloadHash, `${field}.payloadHash`),
    itemCount: boundedInteger(row.itemCount, `${field}.itemCount`, MAX_DIFF_TOTAL),
  };
}

function safePath(value: unknown): string {
  const path = exactString(value, 'differences.rows.path', MAX_PATH_LENGTH);
  if (path === '/payload' || path === '/endpoint') return path;
  const segments = path.split('/');
  if (segments[0] !== '' || segments[1] !== 'items' || !/^\d{1,6}$/u.test(segments[2] || '')) {
    return invalid('differences.rows.path is invalid');
  }
  for (const segment of segments.slice(3)) {
    if (!SAFE_PATH_FIELDS.has(segment)
      && !/^\d{1,6}$/u.test(segment)
      && !/^\$field-\d{1,6}$/u.test(segment)) {
      return invalid('differences.rows.path is invalid');
    }
  }
  return path;
}

function diffRow(value: unknown): OzonPublisherParityDiffRow {
  const row = record(value);
  const type = record(row.type);
  return {
    path: safePath(row.path),
    kind: enumValue(row.kind, DIFF_KINDS, 'differences.rows.kind'),
    classification: enumValue(
      row.classification,
      new Set(['INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM', 'DEFECT'] as const),
      'differences.rows.classification',
    ),
    presence: enumValue(row.presence, PRESENCES, 'differences.rows.presence'),
    type: {
      legacy: enumValue(type.legacy, VALUE_TYPES, 'differences.rows.type.legacy'),
      v2: enumValue(type.v2, VALUE_TYPES, 'differences.rows.type.v2'),
    },
  };
}

function normalizeDifferences(value: unknown) {
  const row = record(value);
  if (!Array.isArray(row.rows) || row.rows.length > MAX_DIFF_ROWS) {
    return invalid('differences.rows is invalid');
  }
  const rows = row.rows.map(diffRow).sort((left, right) => (
    stableStringify(left).localeCompare(stableStringify(right), 'en')
  ));
  const total = boundedInteger(row.total, 'differences.total', MAX_DIFF_TOTAL);
  const returned = boundedInteger(row.returned, 'differences.returned', MAX_DIFF_ROWS);
  const truncated = bool(row.truncated, 'differences.truncated');
  if (returned !== rows.length || total < returned || truncated !== (total > returned)) {
    return invalid('differences counts are inconsistent');
  }
  return { total, returned, truncated, rows };
}

function normalizeV2(value: unknown) {
  const row = record(value);
  const kind = enumValue(row.kind, new Set(['COMPILED', 'BLOCKED', 'UNAVAILABLE'] as const), 'v2.kind');
  if (kind === 'COMPILED') {
    return { kind, ...payloadSummary(row, 'v2'), compilerVersions: compilerVersions(row.compilerVersions) };
  }
  const versions = compilerVersions(row.compilerVersions);
  if (row.endpointKind !== null || row.payloadHash !== null || row.itemCount !== null) {
    return invalid('non-compiled v2 summary is invalid');
  }
  if (kind === 'BLOCKED') {
    return {
      kind,
      blockerCode: enumValue(row.blockerCode, STRICT_BLOCKERS, 'v2.blockerCode'),
      endpointKind: null,
      payloadHash: null,
      itemCount: null,
      compilerVersions: versions,
    };
  }
  return {
    kind,
    reasonCode: enumValue(row.reasonCode, UNAVAILABLE_REASONS, 'v2.reasonCode'),
    endpointKind: null,
    payloadHash: null,
    itemCount: null,
    compilerVersions: versions,
  };
}

export function normalizeOzonPublisherParityReport(
  value: OzonPublisherEntrypointParityReport | unknown,
): SanitizedOzonPublisherParityReport {
  const row = record(value);
  if (row.contractVersion !== OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION) {
    return invalid('parity report contract is unsupported');
  }
  const status = enumValue(row.status, STATUSES, 'status');
  const classification = enumValue(row.classification, CLASSIFICATIONS, 'classification');
  const switchEligible = bool(row.switchEligible, 'switchEligible');
  const legacy = payloadSummary(row.legacy, 'legacy');
  const v2 = normalizeV2(row.v2);
  const differences = normalizeDifferences(row.differences);
  const exactCompiler = v2.compilerVersions.publisherContractVersion === PUBLISHER_CONTRACT_VERSION
    && v2.compilerVersions.payloadCompilerVersion === PAYLOAD_COMPILER_VERSION;
  const consistent = (
    status === 'MATCH'
      ? v2.kind === 'COMPILED' && exactCompiler && classification === 'MATCH'
        && switchEligible && differences.total === 0
      : status === 'DIFFERENT'
        ? v2.kind === 'COMPILED' && exactCompiler
          && ['INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM', 'DEFECT'].includes(classification)
          && !switchEligible && differences.total > 0
        : status === 'V2_BLOCKED'
          ? v2.kind === 'BLOCKED' && classification === 'INTENTIONAL_STRICTER'
            && !switchEligible && differences.total === 0
          : classification === 'NOT_COMPARABLE' && !switchEligible
  );
  if (!consistent) return invalid('parity report state is inconsistent');
  if (!differences.truncated && status === 'DIFFERENT') {
    const weights = { COMPATIBILITY_TRANSFORM: 1, INTENTIONAL_STRICTER: 2, DEFECT: 3 } as const;
    const aggregate = differences.rows.reduce<OzonPublisherParityDiffRow['classification']>(
      (current, difference) => weights[difference.classification] > weights[current]
        ? difference.classification
        : current,
      differences.rows[0]!.classification,
    );
    if (aggregate !== classification) return invalid('difference classification is inconsistent');
  }
  return {
    contractVersion: OZON_PUBLISHER_ENTRYPOINT_PARITY_CONTRACT_VERSION,
    entrypoint: enumValue(row.entrypoint, ENTRYPOINTS, 'entrypoint'),
    status,
    classification,
    switchEligible,
    legacy,
    v2,
    differences,
  } as SanitizedOzonPublisherParityReport;
}

export function deriveOzonPublisherParityDifferenceSubject(
  report: SanitizedOzonPublisherParityReport,
  rolloutRevisionInput: string,
): OzonPublisherParityDifferenceSubject | null {
  if (report.status !== 'DIFFERENT'
    || report.v2.kind !== 'COMPILED'
    || report.differences.truncated
    || report.differences.total !== report.differences.returned
    || report.differences.returned !== report.differences.rows.length
    || report.v2.compilerVersions.publisherContractVersion !== PUBLISHER_CONTRACT_VERSION
    || report.v2.compilerVersions.payloadCompilerVersion !== PAYLOAD_COMPILER_VERSION) {
    return null;
  }
  const rolloutRevision = exactString(rolloutRevisionInput, 'rolloutRevision');
  const rowsHash = hash(report.differences.rows);
  const descriptor = {
    schema: OZON_PUBLISHER_PARITY_DIFFERENCE_SUBJECT_CONTRACT_VERSION,
    entrypoint: report.entrypoint,
    rolloutRevision,
    legacyEndpointKind: report.legacy.endpointKind,
    legacyItemCount: report.legacy.itemCount,
    v2EndpointKind: report.v2.endpointKind,
    v2ItemCount: report.v2.itemCount,
    publisherContractVersion: PUBLISHER_CONTRACT_VERSION,
    payloadCompilerVersion: PAYLOAD_COMPILER_VERSION,
    classification: report.classification,
    differenceCount: report.differences.total,
    rowsHash,
  };
  const allowed = new Set(['INTENTIONAL_STRICTER', 'COMPATIBILITY_TRANSFORM']);
  const approvalEligible = allowed.has(report.classification)
    && report.differences.rows.every((row) => allowed.has(row.classification));
  return {
    contractVersion: OZON_PUBLISHER_PARITY_DIFFERENCE_SUBJECT_CONTRACT_VERSION,
    key: hash(descriptor),
    entrypoint: report.entrypoint,
    rolloutRevision,
    legacyEndpointKind: report.legacy.endpointKind,
    legacyItemCount: report.legacy.itemCount,
    v2EndpointKind: report.v2.endpointKind,
    v2ItemCount: report.v2.itemCount,
    classification: report.classification as OzonPublisherParityDifferenceSubject['classification'],
    compilerVersions: {
      publisherContractVersion: PUBLISHER_CONTRACT_VERSION,
      payloadCompilerVersion: PAYLOAD_COMPILER_VERSION,
    },
    differenceCount: report.differences.total,
    rowsHash,
    rows: report.differences.rows.map((row) => ({
      ...row,
      type: { ...row.type },
    })),
    complete: true,
    approvalEligible,
  };
}

function nowFrom(clock: () => Date): Date {
  const value = clock();
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new OzonPublisherParityObservationError(
      'OZON_PUBLISHER_PARITY_OBSERVATION_CLOCK_INVALID',
      'Ozon publisher parity observation clock is invalid',
      500,
    );
  }
  return value;
}

function reviewForbidden(): never {
  throw new OzonPublisherParityObservationError(
    'OZON_PUBLISHER_PARITY_REVIEW_FORBIDDEN',
    'Ozon publisher parity review requires a super administrator',
    403,
  );
}

export function createOzonPublisherParityObservationService(options: {
  repository: OzonPublisherParityObservationRepository;
  now?: () => Date;
  createId?: () => string;
}) {
  const clock = options.now || (() => new Date());
  const createId = options.createId || randomUUID;
  return {
    recordObservation(input: {
      scopeHash: string;
      rolloutRevision: string;
      report: OzonPublisherEntrypointParityReport | unknown;
      eligibleAttemptKey?: string | null;
      retentionDays?: number;
    }) {
      const observedAt = nowFrom(clock);
      const retentionDays = input.retentionDays ?? DEFAULT_RETENTION_DAYS;
      if (!Number.isSafeInteger(retentionDays)
        || retentionDays < MIN_RETENTION_DAYS
        || retentionDays > MAX_RETENTION_DAYS) {
        return invalid('retentionDays is invalid');
      }
      const report = normalizeOzonPublisherParityReport(input.report);
      const scopeHash = checksum(input.scopeHash, 'scopeHash');
      const rolloutRevision = exactString(input.rolloutRevision, 'rolloutRevision');
      const subject = deriveOzonPublisherParityDifferenceSubject(report, rolloutRevision);
      const expiresAt = new Date(observedAt.getTime() + retentionDays * 86_400_000);
      const id = exactString(createId(), 'observationId');
      const reportHash = hash(report);
      const observation: OzonPublisherParityObservationRecord = {
        id,
        recordKey: hash({
          schema: 'ozon-publisher-parity-observation-record-key/v1',
          id,
          scopeHash,
          rolloutRevision,
          reportHash,
        }),
        contractVersion: OZON_PUBLISHER_PARITY_OBSERVATION_CONTRACT_VERSION,
        scopeHash,
        rolloutRevision,
        entrypoint: report.entrypoint,
        reportHash,
        report,
        differenceSubjectKey: subject?.key || null,
        approvalEligible: subject?.approvalEligible || false,
        eligibleAttemptKey: input.eligibleAttemptKey || null,
        observedAt: observedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      };
      return options.repository.createObservation(observation);
    },

    listObservations(input: ListOzonPublisherParityObservationsInput) {
      return options.repository.listObservations(input);
    },

    listDifferenceSubjects(input: ListOzonPublisherParityDifferenceSubjectsInput) {
      return options.repository.listDifferenceSubjects(input);
    },

    getDifferenceSubject(input: { subjectKey: string }) {
      return options.repository.findDifferenceSubject({
        subjectKey: checksum(input.subjectKey, 'subjectKey'),
      });
    },

    async reviewDifference(input: {
      action: OzonPublisherParityDifferenceReviewAction;
      subjectKey: string;
      expectedTransitionVersion: number;
      actorUserId: string;
      actorRole: string;
      isSuperAdmin: boolean;
      reviewNote: string;
    }) {
      if (input.actorRole !== 'ADMIN' || input.isSuperAdmin !== true) return reviewForbidden();
      const action = enumValue(
        input.action,
        new Set(['APPROVE', 'REJECT', 'REVOKE'] as const),
        'action',
      );
      const subjectKey = checksum(input.subjectKey, 'subjectKey');
      const expectedTransitionVersion = boundedInteger(
        input.expectedTransitionVersion,
        'expectedTransitionVersion',
        Number.MAX_SAFE_INTEGER,
      );
      const actorUserId = exactString(input.actorUserId, 'actorUserId');
      const reviewNote = exactString(input.reviewNote, 'reviewNote', 1000);
      if (reviewNote.length < 3) return invalid('reviewNote is invalid');
      const subject = await options.repository.findDifferenceSubject({ subjectKey });
      if (!subject || subject.key !== subjectKey) {
        throw new OzonPublisherParityObservationError(
          'OZON_PUBLISHER_PARITY_DIFFERENCE_SUBJECT_NOT_FOUND',
          'Ozon publisher parity difference subject was not found',
          404,
        );
      }
      if (action === 'APPROVE' && subject.approvalEligible !== true) {
        throw new OzonPublisherParityObservationError(
          'OZON_PUBLISHER_PARITY_DIFFERENCE_NOT_APPROVABLE',
          'Only complete intentional or compatibility differences can be approved',
          409,
        );
      }
      const logicalDecision = {
        schema: 'ozon-publisher-parity-difference-review-key/v1',
        action,
        subjectKey,
        expectedTransitionVersion,
        actorUserId,
      };
      return options.repository.applyDifferenceReview({
        action,
        subjectKey,
        expectedTransitionVersion,
        actorUserId,
        reviewNote,
        operationKey: hash(logicalDecision),
        requestHash: hash({ ...logicalDecision, reviewNote }),
        reviewedAt: nowFrom(clock),
      });
    },

    pruneExpiredObservations(input: PruneExpiredOzonPublisherParityObservationsInput) {
      return options.repository.pruneObservations(input);
    },
  };
}

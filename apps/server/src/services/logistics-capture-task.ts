import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  ozonOfficialTariffSchema,
  ozonProviderInventoryEntrySchema,
  ozonSellerFormulaSchema,
  ozonServiceIdentitySchema,
} from 'shared';

export const LEGACY_CAPTURE_TASK_VERSION = 'logistics-capture-task/v1' as const;
export const PREVIOUS_CAPTURE_TASK_VERSION = 'logistics-capture-task/v2' as const;
export const CAPTURE_TASK_VERSION = 'logistics-capture-task/v3' as const;
export type LogisticsCaptureTaskVersion =
  | typeof LEGACY_CAPTURE_TASK_VERSION
  | typeof PREVIOUS_CAPTURE_TASK_VERSION
  | typeof CAPTURE_TASK_VERSION;
export const SELLER_CAPTURE_SCHEMA = 'ozon-seller-logistics-capture/v1' as const;
export const OFFICIAL_CAPTURE_SCHEMA = 'ozon-official-logistics-capture/v1' as const;

export const SELLER_CAPTURE_ENDPOINTS = [
  'seller/template/by-location',
  'seller/provider-inventory',
] as const;
const CAPTURE_TASK_TTL_MS = 10 * 60 * 1000;
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
const MAX_PAYLOAD_DEPTH = 32;
const MAX_PAYLOAD_NODES = 100_000;
const CHECKSUM_RE = /^[a-f0-9]{64}$/i;
const POSITIVE_INTEGER_RE = /^[1-9]\d*$/;
const NONNEGATIVE_INTEGER_RE = /^\d+$/;

const CREDENTIAL_FIELDS = new Set([
  'authorization',
  'proxyauthorization',
  'cookie',
  'setcookie',
  'accesstoken',
  'refreshtoken',
  'apitoken',
  'accesskeysecret',
  'password',
  'secret',
  'token',
]);

export interface LogisticsCaptureScope {
  tenantId: string;
  shopId: string;
  companyId: string;
  warehouseId: string;
  originCountryUid: string;
  originCityUid: string;
}

export interface LogisticsCaptureDestination {
  countryUid: string;
  locationUid: string;
}

export interface OfficialCaptureFingerprint {
  originCountryUid: string;
  originCityUid: string;
  destinationCountryUid: string;
  destinationLocationUid: string;
  currency: string;
  declaredPriceMinor: string;
  weightGrams: string;
  dimensionsMm: {
    length: string;
    width: string;
    height: string;
  };
  batteryMode: 'UNSPECIFIED' | 'NONE' | 'CONTAINS_BATTERY';
}

export interface LogisticsCaptureAuthority {
  companyBinding: {
    status: 'CANDIDATE' | 'VERIFIED' | 'INVALIDATED';
    tenantId: string;
    shopId: string;
    companyId: string;
    openApiVerifiedAt: Date | null;
    sellerProbeVerifiedAt: Date | null;
    openApiIntersectionVerifiedAt: Date | null;
    invalidatedAt: Date | null;
    retiredAt: Date | null;
  };
  originBinding: {
    status: 'CANDIDATE' | 'VERIFIED' | 'INVALIDATED';
    tenantId: string;
    shopId: string;
    warehouseId: string;
    originCountryUid: string;
    originCityUid: string;
    openApiAddressVerifiedAt: Date | null;
    officialLocationVerifiedAt: Date | null;
    invalidatedAt: Date | null;
    retiredAt: Date | null;
  };
  verifiedDestinations: Array<{
    countryUid: string;
    locationUid: string;
    catalogVersion: string;
    verifiedAt: Date;
    invalidatedAt: Date | null;
  }>;
}

export interface LogisticsCaptureTask {
  id: string;
  version: LogisticsCaptureTaskVersion;
  kind: 'SELLER' | 'OFFICIAL';
  requestedByUserId: string;
  scope: LogisticsCaptureScope;
  destination: LogisticsCaptureDestination | null;
  officialFingerprint: OfficialCaptureFingerprint | null;
  expectedEndpoints: string[];
  fingerprintChecksum: string;
  nonce: string;
  status: 'ISSUED' | 'CLAIMED' | 'REVIEWABLE' | 'CANCELLED';
  claimedBySessionId: string | null;
  claimedAt: Date | null;
  uploadedAt: Date | null;
  reviewableAt: Date | null;
  issuedAt: Date;
  expiresAt: Date;
}

export type LogisticsCaptureCandidateState = 'CAPTURED' | 'QUARANTINED';

export interface LogisticsCaptureEndpointBatchDiagnostics {
  expected: string[];
  attempted: string[];
  succeeded: string[];
  failed: string[];
  empty: string[];
  counts: {
    expected: number;
    attempted: number;
    succeeded: number;
    failed: number;
    empty: number;
  };
}

export interface LogisticsCaptureCandidateInput {
  taskId: string;
  taskKind: LogisticsCaptureTask['kind'];
  taskVersion: LogisticsCaptureTaskVersion;
  scope: LogisticsCaptureScope;
  destination: LogisticsCaptureDestination | null;
  fingerprintChecksum: string;
  // Server-derived identity used for persistence, deduplication, and drift comparison.
  responseChecksum: string;
  // Untrusted client attestation retained only for diagnostics.
  sourceResponseChecksum: string | null;
  capturedAt: Date | null;
  receivedAt: Date;
  deviceSessionId: string | null;
  deviceOwnerUserId: string | null;
  allowedShopIds: string[];
  state: LogisticsCaptureCandidateState;
  reviewStatus: 'PENDING_REVIEW';
  sourceTrust: 'TENANT_ATTESTED';
  quarantineReasons: string[];
  normalizedPayload: Record<string, unknown> | null;
  diagnostics: {
    schema: string | null;
    historicalCountsOnly: true;
    endpointBatch?: LogisticsCaptureEndpointBatchDiagnostics;
    observedFieldNames?: string[];
  };
}

export type LogisticsCapturePersistenceResult =
  | {
      kind: 'duplicate';
      candidateId: string;
      state: LogisticsCaptureCandidateState;
    }
  | {
      kind: 'created';
      candidateId: string;
      state: LogisticsCaptureCandidateState;
      previousResponseChecksum: string | null;
    };

export interface LogisticsCaptureDeviceContext {
  sessionId: string;
  ownerUserId: string;
  allowedShopIds: string[];
}

export type LogisticsCaptureTaskProof =
  | { nonce: string; claimToken?: never }
  | { nonce?: never; claimToken: string };

export interface LogisticsCapturePendingTask extends Omit<LogisticsCaptureTask, 'nonce'> {
  claimToken: string;
  progress: {
    phase: 'waiting' | 'collecting';
    completed: false;
    percent: 0 | 50;
  };
}

export interface LogisticsCaptureAdminTaskCandidate {
  candidateId: string;
  state: LogisticsCaptureCandidateState;
  reviewStatus: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  responseChecksum: string;
  reviewedAt: Date | null;
}

export interface LogisticsCaptureAdminTask extends Omit<
  LogisticsCaptureTask,
  'nonce' | 'claimedBySessionId'
> {
  claimed: boolean;
  candidate: LogisticsCaptureAdminTaskCandidate | null;
  progress: {
    phase: 'waiting' | 'collecting' | 'review' | 'completed' | 'cancelled';
    completed: boolean;
    percent: 0 | 50 | 100;
  };
}

export type LogisticsCaptureCancelResult =
  | { state: 'cancelled'; duplicate: boolean; task: LogisticsCaptureTask }
  | { state: 'not_found' }
  | { state: 'expired' };

export type LogisticsCaptureClaimResult =
  | {
      state: 'claimed';
      duplicate: boolean;
      task: LogisticsCaptureTask;
    }
  | { state: 'not_found' }
  | { state: 'expired' };

export interface LogisticsCaptureReviewCandidate {
  candidateId: string;
  taskId: string;
  taskKind: LogisticsCaptureTask['kind'];
  taskVersion: LogisticsCaptureTaskVersion;
  tenantId: string;
  shopId: string;
  companyId: string;
  warehouseId: string;
  originCountryUid: string;
  originCityUid: string;
  destination: LogisticsCaptureDestination | null;
  state: LogisticsCaptureCandidateState;
  reviewStatus: 'PENDING_REVIEW' | 'VERIFIED' | 'REJECTED';
  responseChecksum: string;
  previousResponseChecksum: string | null;
  receivedAt: string;
}

export interface LogisticsCaptureReviewCandidateDetail extends LogisticsCaptureReviewCandidate {
  sourceResponseChecksum: string | null;
  capturedAt: string | null;
  quarantineReasons: string[];
  normalizedPayload: Record<string, unknown> | null;
  diagnostics: LogisticsCaptureCandidateInput['diagnostics'];
  reviewedById: string | null;
  reviewedAt: string | null;
  reviewReason: string | null;
}

export type LogisticsCaptureReviewResult =
  | {
      state: 'reviewed';
      duplicate: boolean;
      candidate: LogisticsCaptureReviewCandidateDetail;
    }
  | { state: 'not_found' }
  | { state: 'conflict' };

export interface LogisticsCaptureTaskRepository {
  resolveCaptureAuthority(scope: LogisticsCaptureScope): Promise<LogisticsCaptureAuthority | null>;
  createCaptureTask(task: LogisticsCaptureTask): Promise<LogisticsCaptureTask>;
  listCaptureTasks?(input: {
    tenantId?: string;
    shopId?: string;
    status?: LogisticsCaptureTask['status'];
    limit: number;
  }): Promise<LogisticsCaptureAdminTask[]>;
  getCaptureTaskForAdmin?(taskId: string): Promise<LogisticsCaptureAdminTask | null>;
  listPendingCaptureTasks?(input: {
    device: LogisticsCaptureDeviceContext;
    now: Date;
    limit: number;
  }): Promise<Array<Omit<LogisticsCaptureTask, 'nonce'> & { claimToken: string }>>;
  findCaptureTask(
    taskId: string,
    proof?: {
      nonce?: string;
      claimToken?: string;
      scope: LogisticsCaptureScope;
      device?: LogisticsCaptureDeviceContext;
      now: Date;
    },
  ): Promise<LogisticsCaptureTask | null>;
  claimCaptureTask(input: {
    taskId: string;
    taskVersion: string;
    nonce?: string;
    claimToken?: string;
    scope: LogisticsCaptureScope;
    device: LogisticsCaptureDeviceContext;
    now: Date;
  }): Promise<LogisticsCaptureClaimResult>;
  persistCaptureCandidate(
    input: LogisticsCaptureCandidateInput,
  ): Promise<LogisticsCapturePersistenceResult>;
  cancelCaptureTask?(input: {
    taskId: string;
    taskVersion: string;
    nonce?: string;
    claimToken?: string;
    scope: LogisticsCaptureScope;
    device: LogisticsCaptureDeviceContext;
    now: Date;
  }): Promise<LogisticsCaptureCancelResult>;
  cancelCaptureTaskAsAdmin?(input: {
    taskId: string;
    actorUserId: string;
    now: Date;
  }): Promise<LogisticsCaptureCancelResult>;
  getCaptureCandidate?(candidateId: string): Promise<LogisticsCaptureReviewCandidateDetail | null>;
  reviewCaptureCandidate?(input: {
    candidateId: string;
    actorUserId: string;
    decision: 'VERIFIED' | 'REJECTED';
    reason: string;
    reviewedAt: Date;
  }): Promise<LogisticsCaptureReviewResult>;
  listReviewableCandidates(input: {
    tenantId?: string;
    shopId?: string;
    limit: number;
  }): Promise<LogisticsCaptureReviewCandidate[]>;
  getReviewableCandidate(
    candidateId: string,
  ): Promise<LogisticsCaptureReviewCandidateDetail | null>;
}

export class LogisticsCaptureTaskError extends Error {
  constructor(
    public readonly code: string,
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'LogisticsCaptureTaskError';
  }
}

interface SellerEndpointBatch {
  expected: string[];
  attempted: string[];
  succeeded: string[];
  failed: string[];
  empty: string[];
}

interface ParsedCapture {
  state: LogisticsCaptureCandidateState;
  sourceResponseChecksum: string | null;
  capturedAt: Date | null;
  normalizedPayload: Record<string, unknown> | null;
  quarantineReasons: string[];
  diagnostics: LogisticsCaptureCandidateInput['diagnostics'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function normalizeIdentifier(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function validIdentifier(value: unknown): value is string {
  const normalized = normalizeIdentifier(value);
  return normalized.length > 0 && normalized.length <= 300;
}

function normalizeEndpointList(values: string[]): string[] {
  return [...new Set(values.map((value) => normalizeIdentifier(value)).filter(Boolean))];
}

function scopeIsValid(scope: unknown): scope is LogisticsCaptureScope {
  if (!isRecord(scope)) return false;
  const fields = [
    'tenantId',
    'shopId',
    'companyId',
    'warehouseId',
    'originCountryUid',
    'originCityUid',
  ];
  return (
    sameStringSet(Object.keys(scope), fields) &&
    fields.every((field) => validIdentifier(scope[field]))
  );
}

function sameScope(left: LogisticsCaptureScope, right: LogisticsCaptureScope): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.shopId === right.shopId &&
    left.companyId === right.companyId &&
    left.warehouseId === right.warehouseId &&
    left.originCountryUid === right.originCountryUid &&
    left.originCityUid === right.originCityUid
  );
}

function sameStringSet(left: string[], right: string[]): boolean {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, stableValue(value[key])]),
  );
}

function compareCanonical(left: unknown, right: unknown): number {
  const a = JSON.stringify(stableValue(left));
  const b = JSON.stringify(stableValue(right));
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortCanonical<T>(values: T[]): T[] {
  return [...values].sort(compareCanonical);
}
function checksum(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(stableValue(value)))
    .digest('hex');
}

function secureEqual(left: unknown, right: unknown): boolean {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function payloadJson(value: unknown): string {
  try {
    const encoded = JSON.stringify(value);
    if (typeof encoded !== 'string') throw new TypeError('not JSON serializable');
    return encoded;
  } catch {
    throw new LogisticsCaptureTaskError(
      'CAPTURE_PAYLOAD_INVALID',
      400,
      'Capture payload must be JSON serializable',
    );
  }
}

function normalizedCredentialKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function assertSafePayload(value: unknown): void {
  const encoded = payloadJson(value);
  if (Buffer.byteLength(encoded, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw new LogisticsCaptureTaskError(
      'CAPTURE_PAYLOAD_INVALID',
      400,
      'Capture payload is too large',
    );
  }

  const stack: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (stack.length) {
    const current = stack.pop()!;
    if (
      current.value === undefined ||
      typeof current.value === 'function' ||
      typeof current.value === 'symbol' ||
      typeof current.value === 'bigint'
    ) {
      throw new LogisticsCaptureTaskError(
        'CAPTURE_PAYLOAD_INVALID',
        400,
        'Capture payload must contain only JSON values',
      );
    }

    nodes += 1;
    if (nodes > MAX_PAYLOAD_NODES || current.depth > MAX_PAYLOAD_DEPTH) {
      throw new LogisticsCaptureTaskError(
        'CAPTURE_PAYLOAD_INVALID',
        400,
        'Capture payload structure is too complex',
      );
    }
    if (Array.isArray(current.value)) {
      for (const child of current.value) stack.push({ value: child, depth: current.depth + 1 });
      continue;
    }
    if (!isRecord(current.value)) continue;
    for (const [key, child] of Object.entries(current.value)) {
      if (CREDENTIAL_FIELDS.has(normalizedCredentialKey(key))) {
        throw new LogisticsCaptureTaskError(
          'CREDENTIAL_FIELDS_FORBIDDEN',
          400,
          'Credential-bearing capture fields are forbidden',
        );
      }
      stack.push({ value: child, depth: current.depth + 1 });
    }
  }
}

function authorityMatchesScope(
  authority: LogisticsCaptureAuthority | null,
  scope: LogisticsCaptureScope,
): authority is LogisticsCaptureAuthority {
  if (!authority) return false;
  const company = authority.companyBinding;
  const origin = authority.originBinding;
  return (
    company.status === 'VERIFIED' &&
    company.tenantId === scope.tenantId &&
    company.shopId === scope.shopId &&
    company.companyId === scope.companyId &&
    validDate(company.openApiVerifiedAt) &&
    validDate(company.sellerProbeVerifiedAt) &&
    validDate(company.openApiIntersectionVerifiedAt) &&
    company.invalidatedAt === null &&
    company.retiredAt === null &&
    origin.status === 'VERIFIED' &&
    origin.tenantId === scope.tenantId &&
    origin.shopId === scope.shopId &&
    origin.warehouseId === scope.warehouseId &&
    origin.originCountryUid === scope.originCountryUid &&
    origin.originCityUid === scope.originCityUid &&
    validDate(origin.openApiAddressVerifiedAt) &&
    validDate(origin.officialLocationVerifiedAt) &&
    origin.invalidatedAt === null &&
    origin.retiredAt === null
  );
}

function fingerprintIsValid(value: OfficialCaptureFingerprint): boolean {
  if (!isRecord(value) || !isRecord(value.dimensionsMm)) return false;
  const keys = Object.keys(value).sort();
  const expectedKeys = [
    'batteryMode',
    'currency',
    'declaredPriceMinor',
    'destinationCountryUid',
    'destinationLocationUid',
    'dimensionsMm',
    'originCityUid',
    'originCountryUid',
    'weightGrams',
  ].sort();
  if (!sameStringSet(keys, expectedKeys)) return false;
  if (!sameStringSet(Object.keys(value.dimensionsMm), ['length', 'width', 'height'])) return false;
  return (
    validIdentifier(value.originCountryUid) &&
    validIdentifier(value.originCityUid) &&
    validIdentifier(value.destinationCountryUid) &&
    validIdentifier(value.destinationLocationUid) &&
    /^[A-Z]{3}$/.test(value.currency) &&
    NONNEGATIVE_INTEGER_RE.test(value.declaredPriceMinor) &&
    POSITIVE_INTEGER_RE.test(value.weightGrams) &&
    POSITIVE_INTEGER_RE.test(value.dimensionsMm.length) &&
    POSITIVE_INTEGER_RE.test(value.dimensionsMm.width) &&
    POSITIVE_INTEGER_RE.test(value.dimensionsMm.height) &&
    (value.batteryMode === 'UNSPECIFIED' ||
      value.batteryMode === 'NONE' ||
      value.batteryMode === 'CONTAINS_BATTERY')
  );
}

function sourceResponseChecksum(value: Record<string, unknown>): string | null {
  const provided = normalizeIdentifier(value.responseChecksum);
  return CHECKSUM_RE.test(provided) ? provided.toLowerCase() : null;
}

function captureTime(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

function ownKeysAre(value: Record<string, unknown>, expected: string[]): boolean {
  return sameStringSet(Object.keys(value), expected);
}
function ownKeysMatch(
  value: Record<string, unknown>,
  required: string[],
  optional: string[] = [],
): boolean {
  const keys = Object.keys(value);
  return (
    required.every((key) => keys.includes(key)) &&
    keys.every((key) => required.includes(key) || optional.includes(key))
  );
}

function parseStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => !validIdentifier(item))) return null;
  const normalized = normalizeEndpointList(value as string[]);
  return normalized.length === value.length ? normalized : null;
}

function parseEndpointBatch(value: unknown): SellerEndpointBatch | null {
  if (
    !isRecord(value) ||
    !ownKeysAre(value, ['expected', 'attempted', 'succeeded', 'failed', 'empty'])
  ) {
    return null;
  }
  const expected = parseStringArray(value.expected);
  const attempted = parseStringArray(value.attempted);
  const succeeded = parseStringArray(value.succeeded);
  const failed = parseStringArray(value.failed);
  const empty = parseStringArray(value.empty);
  return expected && attempted && succeeded && failed && empty
    ? { expected, attempted, succeeded, failed, empty }
    : null;
}

function endpointDiagnostics(batch: SellerEndpointBatch): LogisticsCaptureEndpointBatchDiagnostics {
  return {
    expected: [...batch.expected],
    attempted: [...batch.attempted],
    succeeded: [...batch.succeeded],
    failed: [...batch.failed],
    empty: [...batch.empty],
    counts: {
      expected: batch.expected.length,
      attempted: batch.attempted.length,
      succeeded: batch.succeeded.length,
      failed: batch.failed.length,
      empty: batch.empty.length,
    },
  };
}

function normalizeRouteCandidate(value: unknown): Record<string, unknown> | null {
  if (
    !isRecord(value) ||
    !ownKeysAre(value, ['destinationCountryUid', 'destinationLocationUid', 'evidenceType']) ||
    !validIdentifier(value.destinationCountryUid) ||
    !(value.destinationLocationUid === null || validIdentifier(value.destinationLocationUid)) ||
    !['ozon_structured_destination', 'openapi_method_route'].includes(String(value.evidenceType))
  ) {
    return null;
  }
  return {
    destinationCountryUid: value.destinationCountryUid,
    destinationLocationUid: value.destinationLocationUid,
    evidenceType: value.evidenceType,
  };
}

function normalizeSellerService(value: unknown): Record<string, unknown> | null {
  if (
    !isRecord(value) ||
    !ownKeysAre(value, [
      'stableServiceKey',
      'providerId',
      'normalizedDescription',
      'templateType',
      'weightType',
      'batteryMode',
      'deliveryVariant',
      'routeCandidates',
      'calculationRule',
    ]) ||
    !Array.isArray(value.routeCandidates)
  ) {
    return null;
  }
  const identity = ozonServiceIdentitySchema.safeParse({
    stableServiceKey: value.stableServiceKey,
    providerId: value.providerId,
    normalizedDescription: value.normalizedDescription,
    templateType: value.templateType,
    weightType: value.weightType,
    batteryMode: value.batteryMode,
    deliveryVariant: value.deliveryVariant,
  });
  const formula = ozonSellerFormulaSchema.safeParse({
    stableServiceKey: value.stableServiceKey,
    calculationRule: value.calculationRule,
  });
  const routeCandidates = value.routeCandidates.map(normalizeRouteCandidate);
  if (
    !identity.success ||
    !formula.success ||
    routeCandidates.some((candidate) => candidate === null)
  )
    return null;
  return {
    ...identity.data,
    routeCandidates,
    calculationRule: formula.data.calculationRule,
  };
}

function normalizeSellerContext(value: unknown): Record<string, unknown> | null {
  if (
    !isRecord(value) ||
    !ownKeysAre(value, ['point']) ||
    !isRecord(value.point) ||
    !ownKeysAre(value.point, ['latitude', 'longitude']) ||
    typeof value.point.latitude !== 'number' ||
    !Number.isFinite(value.point.latitude) ||
    value.point.latitude < -90 ||
    value.point.latitude > 90 ||
    typeof value.point.longitude !== 'number' ||
    !Number.isFinite(value.point.longitude) ||
    value.point.longitude < -180 ||
    value.point.longitude > 180
  ) {
    return null;
  }
  return { point: { latitude: value.point.latitude, longitude: value.point.longitude } };
}

function normalizeProviderRows(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null;
  const rows = value.map((row) => ozonProviderInventoryEntrySchema.safeParse(row));
  if (rows.some((row) => !row.success)) return null;
  const normalized = rows.flatMap((row) => (row.success ? [row.data] : []));
  if (new Set(normalized.map((row) => row.providerId)).size !== normalized.length) return null;
  return normalized;
}

function deriveProviderStats(rows: Array<Record<string, unknown>>) {
  return {
    discovered: rows.length,
    attempted: rows.filter((row) => row.status !== 'pending').length,
    succeeded: rows.filter((row) => row.status === 'succeeded').length,
    failed: rows.filter((row) => row.status === 'failed').length,
    empty: rows.filter((row) => row.status === 'empty').length,
  };
}

function normalizeProviderStats(
  value: unknown,
  derived: ReturnType<typeof deriveProviderStats>,
  taskVersion: LogisticsCaptureTaskVersion,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const countFields = ['discovered', 'attempted', 'succeeded', 'failed', 'empty'];
  const completenessFields = [
    'catalogComplete',
    'methodBindingsComplete',
    'methodBindingsRequired',
    'complete',
  ];
  const hasAnyCompleteness = completenessFields.some((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
  const hasAllCompleteness = completenessFields.every((key) => typeof value[key] === 'boolean');
  if (
    hasAnyCompleteness !== hasAllCompleteness ||
    (taskVersion === CAPTURE_TASK_VERSION && !hasAllCompleteness) ||
    !ownKeysAre(
      value,
      hasAllCompleteness ? [...countFields, ...completenessFields] : countFields,
    ) ||
    !Object.entries(derived).every(([key, count]) => value[key] === count)
  ) {
    return null;
  }
  if (!hasAllCompleteness) return derived;
  const catalogPrerequisitesComplete =
    derived.attempted === derived.discovered && derived.failed === 0 && derived.empty === 0;
  if (value.catalogComplete === true && !catalogPrerequisitesComplete) return null;
  const expectedComplete =
    value.catalogComplete === true &&
    (value.methodBindingsRequired !== true || value.methodBindingsComplete === true);
  if (value.complete !== expectedComplete) return null;
  return {
    ...derived,
    catalogComplete: value.catalogComplete,
    methodBindingsComplete: value.methodBindingsComplete,
    methodBindingsRequired: value.methodBindingsRequired,
    complete: value.complete,
  };
}

function parseSellerCapture(
  task: LogisticsCaptureTask,
  payload: Record<string, unknown>,
): ParsedCapture {
  const reasons: string[] = [];
  if (
    !ownKeysMatch(
      payload,
      [
        'schema',
        'capturedAt',
        'responseChecksum',
        'sellerContext',
        'endpointBatch',
        'providerStats',
        'providerRows',
        'services',
      ],
      ['legacySelectedServiceKeys'],
    )
  ) {
    reasons.push('UNKNOWN_FIELDS');
  }

  const batch = parseEndpointBatch(payload.endpointBatch);
  let diagnostics: LogisticsCaptureCandidateInput['diagnostics'] = {
    schema: SELLER_CAPTURE_SCHEMA,
    historicalCountsOnly: true,
  };
  if (!batch) {
    reasons.push('MALFORMED_ENDPOINT_BATCH');
  } else {
    diagnostics = { ...diagnostics, endpointBatch: endpointDiagnostics(batch) };
    const outcomeUnion = [...batch.succeeded, ...batch.failed, ...batch.empty];
    const validPartition =
      new Set(outcomeUnion).size === outcomeUnion.length &&
      outcomeUnion.every((endpoint) => batch.attempted.includes(endpoint));
    const complete =
      sameStringSet(batch.expected, task.expectedEndpoints) &&
      sameStringSet(batch.attempted, task.expectedEndpoints) &&
      sameStringSet(outcomeUnion, task.expectedEndpoints) &&
      validPartition &&
      batch.failed.length === 0 &&
      batch.empty.length === 0;
    if (!complete) reasons.push('ENDPOINT_BATCH_INCOMPLETE');
    if (batch.empty.length) reasons.push('EMPTY_ENDPOINT_RESPONSE');
  }

  const sellerContext = normalizeSellerContext(payload.sellerContext);
  if (!sellerContext) reasons.push('MALFORMED_SELLER_CONTEXT');

  const providerRows = normalizeProviderRows(payload.providerRows);
  const derivedProviderStats = providerRows ? deriveProviderStats(providerRows) : null;
  const providerStats = derivedProviderStats
    ? normalizeProviderStats(payload.providerStats, derivedProviderStats, task.version)
    : null;
  if (!providerRows) {
    reasons.push('MALFORMED_PROVIDER_ROWS');
  } else if (!providerStats) {
    reasons.push('PROVIDER_STATS_MISMATCH');
  }

  const rawServices = Array.isArray(payload.services) ? payload.services : null;
  const services = rawServices?.map(normalizeSellerService) || [];
  if (!rawServices || services.some((service) => service === null)) {
    reasons.push('MALFORMED_SERVICES');
  }
  if (rawServices?.length === 0) reasons.push('EMPTY_CAPTURE');

  const capturedAt = captureTime(payload.capturedAt);
  if (!capturedAt) reasons.push('INVALID_CAPTURE_TIME');

  return {
    state: reasons.length ? 'QUARANTINED' : 'CAPTURED',
    sourceResponseChecksum: sourceResponseChecksum(payload),
    capturedAt,
    quarantineReasons: [...new Set(reasons)],
    diagnostics,
    normalizedPayload: {
      schema: SELLER_CAPTURE_SCHEMA,
      capturedAt: capturedAt?.toISOString() || null,
      sellerContext,
      endpointBatch: batch ? endpointDiagnostics(batch) : null,
      providerStats,
      providerRows: providerRows || [],
      services: services.filter((service): service is Record<string, unknown> => service !== null),
    },
  };
}

function normalizeObservedOfficialFingerprint(
  task: LogisticsCaptureTask,
  value: unknown,
): Record<string, unknown> {
  if (
    !task.officialFingerprint ||
    !isRecord(value) ||
    !ownKeysMatch(
      value,
      [
        'originCountryUid',
        'originCityUid',
        'destinationCountryUid',
        'destinationLocationUid',
        'currency',
        'declaredPriceMinor',
        'weightGrams',
        'dimensionsMm',
      ],
      ['batteryInput'],
    ) ||
    !isRecord(value.dimensionsMm) ||
    !ownKeysAre(value.dimensionsMm, ['length', 'width', 'height'])
  ) {
    throw new LogisticsCaptureTaskError(
      'CAPTURE_FINGERPRINT_MISMATCH',
      409,
      'Official capture fingerprint does not match the issued task',
    );
  }
  const expected = task.officialFingerprint;
  const baseMatches =
    value.originCountryUid === expected.originCountryUid &&
    value.originCityUid === expected.originCityUid &&
    value.destinationCountryUid === expected.destinationCountryUid &&
    value.destinationLocationUid === expected.destinationLocationUid &&
    value.currency === expected.currency &&
    value.declaredPriceMinor === expected.declaredPriceMinor &&
    value.weightGrams === expected.weightGrams &&
    value.dimensionsMm.length === expected.dimensionsMm.length &&
    value.dimensionsMm.width === expected.dimensionsMm.width &&
    value.dimensionsMm.height === expected.dimensionsMm.height;
  const hasBatteryInput = Object.prototype.hasOwnProperty.call(value, 'batteryInput');
  const batteryInput = hasBatteryInput ? value.batteryInput : null;
  const batteryMatches =
    expected.batteryMode === 'UNSPECIFIED'
      ? !hasBatteryInput
      : expected.batteryMode === 'NONE'
        ? hasBatteryInput && batteryInput === false
        : hasBatteryInput && batteryInput === true;
  if (!baseMatches || !batteryMatches) {
    throw new LogisticsCaptureTaskError(
      'CAPTURE_FINGERPRINT_MISMATCH',
      409,
      'Official capture fingerprint does not match the issued task',
    );
  }
  return {
    originCountryUid: expected.originCountryUid,
    originCityUid: expected.originCityUid,
    destinationCountryUid: expected.destinationCountryUid,
    destinationLocationUid: expected.destinationLocationUid,
    currency: expected.currency,
    declaredPriceMinor: expected.declaredPriceMinor,
    weightGrams: expected.weightGrams,
    dimensionsMm: structuredClone(expected.dimensionsMm),
    batteryInput,
  };
}

function normalizeOfficialQuote(value: unknown): Record<string, unknown> | null {
  if (
    !isRecord(value) ||
    !ownKeysAre(value, [
      'stableServiceKey',
      'providerId',
      'normalizedDescription',
      'templateType',
      'weightType',
      'batteryMode',
      'deliveryVariant',
      'priceMinor',
      'currency',
      'isDropOff',
      'clusterDeliverySpeeds',
      'deliverySpeed',
      'rating',
    ]) ||
    typeof value.priceMinor !== 'string' ||
    !NONNEGATIVE_INTEGER_RE.test(value.priceMinor)
  ) {
    return null;
  }
  const numericPrice = Number(value.priceMinor);
  if (!Number.isSafeInteger(numericPrice)) return null;
  const parsed = ozonOfficialTariffSchema.safeParse({
    ...value,
    priceMinor: numericPrice,
  });
  if (!parsed.success) return null;
  return { ...parsed.data, priceMinor: value.priceMinor };
}

function parseOfficialCapture(
  task: LogisticsCaptureTask,
  payload: Record<string, unknown>,
): ParsedCapture {
  const fingerprint = normalizeObservedOfficialFingerprint(task, payload.fingerprint);
  const reasons: string[] = [];
  if (!ownKeysAre(payload, ['schema', 'capturedAt', 'responseChecksum', 'fingerprint', 'quotes'])) {
    reasons.push('UNKNOWN_FIELDS');
  }
  const rawQuotes = Array.isArray(payload.quotes) ? payload.quotes : null;
  const quotes = rawQuotes?.map(normalizeOfficialQuote) || [];
  if (!rawQuotes || quotes.some((quote) => quote === null)) reasons.push('MALFORMED_QUOTES');
  if (rawQuotes?.length === 0) reasons.push('EMPTY_CAPTURE');

  const capturedAt = captureTime(payload.capturedAt);
  if (!capturedAt) reasons.push('INVALID_CAPTURE_TIME');

  return {
    state: reasons.length ? 'QUARANTINED' : 'CAPTURED',
    sourceResponseChecksum: sourceResponseChecksum(payload),
    capturedAt,
    quarantineReasons: [...new Set(reasons)],
    diagnostics: {
      schema: OFFICIAL_CAPTURE_SCHEMA,
      historicalCountsOnly: true,
    },
    normalizedPayload: {
      schema: OFFICIAL_CAPTURE_SCHEMA,
      capturedAt: capturedAt?.toISOString() || null,
      fingerprint,
      quotes: quotes.filter((quote): quote is Record<string, unknown> => quote !== null),
    },
  };
}

function parseCapture(task: LogisticsCaptureTask, payload: unknown): ParsedCapture {
  if (!isRecord(payload)) {
    return {
      state: 'QUARANTINED',
      sourceResponseChecksum: null,
      capturedAt: null,
      quarantineReasons: ['UNKNOWN_SCHEMA'],
      normalizedPayload: null,
      diagnostics: {
        schema: null,
        historicalCountsOnly: true,
        observedFieldNames: [],
      },
    };
  }
  const schema = normalizeIdentifier(payload.schema);
  if (task.kind === 'SELLER' && schema === SELLER_CAPTURE_SCHEMA) {
    return parseSellerCapture(task, payload);
  }
  if (task.kind === 'OFFICIAL' && schema === OFFICIAL_CAPTURE_SCHEMA) {
    return parseOfficialCapture(task, payload);
  }
  return {
    state: 'QUARANTINED',
    sourceResponseChecksum: sourceResponseChecksum(payload),
    capturedAt: captureTime(payload.capturedAt),
    quarantineReasons: ['UNKNOWN_SCHEMA'],
    normalizedPayload: null,
    diagnostics: {
      schema: schema.slice(0, 200) || null,
      historicalCountsOnly: true,
      observedFieldNames: Object.keys(payload).sort().slice(0, 100),
    },
  };
}

function withoutClientCaptureMetadata(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'responseChecksum' && key !== 'capturedAt'),
  );
}

function canonicalCaptureCollections(
  taskKind: LogisticsCaptureTask['kind'],
  value: unknown,
): unknown {
  if (!isRecord(value)) return value;
  if (taskKind === 'SELLER' && value.schema === SELLER_CAPTURE_SCHEMA) {
    const batch = isRecord(value.endpointBatch) ? value.endpointBatch : null;
    const endpointBatch = batch
      ? {
          ...batch,
          ...Object.fromEntries(
            ['expected', 'attempted', 'succeeded', 'failed', 'empty'].map((key) => [
              key,
              Array.isArray(batch[key]) ? sortCanonical(batch[key] as unknown[]) : batch[key],
            ]),
          ),
        }
      : value.endpointBatch;
    const services = Array.isArray(value.services)
      ? sortCanonical(
          value.services.map((service) =>
            isRecord(service) && Array.isArray(service.routeCandidates)
              ? { ...service, routeCandidates: sortCanonical(service.routeCandidates) }
              : service,
          ),
        )
      : value.services;
    return {
      ...value,
      endpointBatch,
      providerRows: Array.isArray(value.providerRows)
        ? sortCanonical(value.providerRows)
        : value.providerRows,
      services,
    };
  }
  if (taskKind === 'OFFICIAL' && value.schema === OFFICIAL_CAPTURE_SCHEMA) {
    return {
      ...value,
      quotes: Array.isArray(value.quotes)
        ? sortCanonical(
            value.quotes.map((quote) =>
              isRecord(quote) && Array.isArray(quote.clusterDeliverySpeeds)
                ? {
                    ...quote,
                    clusterDeliverySpeeds: sortCanonical(quote.clusterDeliverySpeeds),
                  }
                : quote,
            ),
          )
        : value.quotes,
    };
  }
  return value;
}
function serverResponseChecksum(
  task: LogisticsCaptureTask,
  parsed: ParsedCapture,
  rawPayload: unknown,
): string {
  return checksum({
    taskKind: task.kind,
    taskVersion: task.version,
    providerStatsEvidence:
      parsed.quarantineReasons.includes('PROVIDER_STATS_MISMATCH') && isRecord(rawPayload)
        ? rawPayload.providerStats
        : null,
    quarantineReasons: [...parsed.quarantineReasons].sort(),
    payload: canonicalCaptureCollections(
      task.kind,
      withoutClientCaptureMetadata(parsed.normalizedPayload || rawPayload),
    ),
  });
}

function validateTaskScopeInput(scope: LogisticsCaptureScope): void {
  if (!scopeIsValid(scope)) {
    throw new LogisticsCaptureTaskError('INVALID_CAPTURE_SCOPE', 400, 'Capture scope is invalid');
  }
}

function validTaskProof(input: { nonce?: unknown; claimToken?: unknown }): boolean {
  const nonce = normalizeIdentifier(input.nonce);
  const claimToken = normalizeIdentifier(input.claimToken);
  return (validIdentifier(nonce) && !claimToken) || (!nonce && validIdentifier(claimToken));
}

function pendingTaskProgress(task: Pick<LogisticsCaptureTask, 'status'>) {
  if (task.status === 'CLAIMED') {
    return { phase: 'collecting' as const, completed: false as const, percent: 50 as const };
  }
  return { phase: 'waiting' as const, completed: false as const, percent: 0 as const };
}

function destinationIsVerified(
  authority: LogisticsCaptureAuthority,
  destination: LogisticsCaptureDestination,
): boolean {
  return authority.verifiedDestinations.some(
    (candidate) =>
      candidate.countryUid === destination.countryUid &&
      candidate.locationUid === destination.locationUid &&
      validIdentifier(candidate.catalogVersion) &&
      validDate(candidate.verifiedAt) &&
      candidate.invalidatedAt === null,
  );
}

export function createLogisticsCaptureTaskService(options: {
  repository: LogisticsCaptureTaskRepository;
  now?: () => Date;
  taskId?: () => string;
  nonce?: () => string;
}) {
  const now = options.now || (() => new Date());
  const taskId = options.taskId || randomUUID;
  const nonce = options.nonce || (() => randomBytes(24).toString('base64url'));

  async function authorityFor(scope: LogisticsCaptureScope): Promise<LogisticsCaptureAuthority> {
    validateTaskScopeInput(scope);
    const authority = await options.repository.resolveCaptureAuthority(scope);
    if (!authorityMatchesScope(authority, scope)) {
      throw new LogisticsCaptureTaskError(
        'CAPTURE_BINDING_NOT_VERIFIED',
        409,
        'Company and origin bindings must be independently verified',
      );
    }
    return authority;
  }

  async function persistTask(input: {
    kind: LogisticsCaptureTask['kind'];
    requestedByUserId: string;
    scope: LogisticsCaptureScope;
    destination: LogisticsCaptureDestination | null;
    officialFingerprint: OfficialCaptureFingerprint | null;
    expectedEndpoints: string[];
  }) {
    if (!validIdentifier(input.requestedByUserId)) {
      throw new LogisticsCaptureTaskError('INVALID_CAPTURE_ACTOR', 400, 'Capture actor is invalid');
    }
    const issuedAt = now();
    const stableFingerprint = {
      version: CAPTURE_TASK_VERSION,
      kind: input.kind,
      scope: input.scope,
      destination: input.destination,
      officialFingerprint: input.officialFingerprint,
      expectedEndpoints: [...input.expectedEndpoints].sort(),
    };
    const task: LogisticsCaptureTask = {
      id: taskId(),
      version: CAPTURE_TASK_VERSION,
      kind: input.kind,
      requestedByUserId: input.requestedByUserId,
      scope: structuredClone(input.scope),
      destination: input.destination ? structuredClone(input.destination) : null,
      officialFingerprint: input.officialFingerprint
        ? structuredClone(input.officialFingerprint)
        : null,
      expectedEndpoints: [...input.expectedEndpoints],
      fingerprintChecksum: checksum(stableFingerprint),
      nonce: nonce(),
      status: 'ISSUED',
      claimedBySessionId: null,
      claimedAt: null,
      uploadedAt: null,
      reviewableAt: null,
      issuedAt,
      expiresAt: new Date(issuedAt.getTime() + CAPTURE_TASK_TTL_MS),
    };
    if (!validIdentifier(task.id) || task.nonce.length < 20) {
      throw new LogisticsCaptureTaskError(
        'CAPTURE_TASK_GENERATION_FAILED',
        500,
        'Capture task credentials are invalid',
      );
    }
    return options.repository.createCaptureTask(task);
  }

  return {
    async listCaptureTasks(input: {
      tenantId?: string;
      shopId?: string;
      status?: LogisticsCaptureTask['status'];
      limit?: number;
    }): Promise<LogisticsCaptureAdminTask[]> {
      const tenantId = input.tenantId ? normalizeIdentifier(input.tenantId) : undefined;
      const shopId = input.shopId ? normalizeIdentifier(input.shopId) : undefined;
      const status = input.status;
      if (
        (tenantId && !validIdentifier(tenantId)) ||
        (shopId && !validIdentifier(shopId)) ||
        (status && !['ISSUED', 'CLAIMED', 'REVIEWABLE', 'CANCELLED'].includes(status)) ||
        !options.repository.listCaptureTasks
      ) {
        throw new LogisticsCaptureTaskError(
          'INVALID_CAPTURE_QUERY',
          400,
          'Capture task filter is invalid',
        );
      }
      const limit = Math.min(Math.max(Math.floor(input.limit || 100), 1), 200);
      return options.repository.listCaptureTasks({ tenantId, shopId, status, limit });
    },

    async getCaptureTask(input: { taskId: string }): Promise<LogisticsCaptureAdminTask> {
      const taskId = normalizeIdentifier(input.taskId);
      if (!validIdentifier(taskId) || !options.repository.getCaptureTaskForAdmin) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_NOT_FOUND',
          404,
          'Capture task is unavailable',
        );
      }
      const task = await options.repository.getCaptureTaskForAdmin(taskId);
      if (!task) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_NOT_FOUND',
          404,
          'Capture task is unavailable',
        );
      }
      return task;
    },

    async listPendingCaptureTasks(input: {
      device: LogisticsCaptureDeviceContext;
      limit?: number;
    }): Promise<LogisticsCapturePendingTask[]> {
      if (
        !validIdentifier(input.device.sessionId) ||
        !validIdentifier(input.device.ownerUserId) ||
        !Array.isArray(input.device.allowedShopIds) ||
        !input.device.allowedShopIds.every(validIdentifier) ||
        !options.repository.listPendingCaptureTasks
      ) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_MISMATCH',
          404,
          'Capture task is unavailable',
        );
      }
      const current = now();
      const limit = Math.min(Math.max(Math.floor(input.limit || 100), 1), 200);
      const device = {
        ...input.device,
        allowedShopIds: [...input.device.allowedShopIds],
      };
      const tasks = await options.repository.listPendingCaptureTasks({
        device,
        now: current,
        limit,
      });
      return tasks
        .filter(
          (task) =>
            task.scope.tenantId === device.ownerUserId &&
            device.allowedShopIds.includes(task.scope.shopId) &&
            task.expiresAt.getTime() > current.getTime() &&
            (task.status === 'ISSUED' ||
              (task.status === 'CLAIMED' && task.claimedBySessionId === device.sessionId)),
        )
        .map((task) => {
          const sanitized = structuredClone(task) as typeof task & { nonce?: string };
          delete sanitized.nonce;
          return {
            ...sanitized,
            progress: pendingTaskProgress(task),
          };
        });
    },

    async issueSellerTask(input: {
      requestedByUserId: string;
      scope: LogisticsCaptureScope;
      expectedEndpoints: string[];
    }) {
      await authorityFor(input.scope);
      const endpoints = normalizeEndpointList(input.expectedEndpoints);
      if (
        endpoints.length !== input.expectedEndpoints.length ||
        !sameStringSet(endpoints, [...SELLER_CAPTURE_ENDPOINTS])
      ) {
        throw new LogisticsCaptureTaskError(
          'INVALID_CAPTURE_ENDPOINTS',
          400,
          'Seller capture endpoints are invalid',
        );
      }
      return persistTask({
        kind: 'SELLER',
        requestedByUserId: input.requestedByUserId,
        scope: input.scope,
        destination: null,
        officialFingerprint: null,
        expectedEndpoints: endpoints,
      });
    },

    async issueOfficialTask(input: {
      requestedByUserId: string;
      scope: LogisticsCaptureScope;
      destination: LogisticsCaptureDestination;
      fingerprint: OfficialCaptureFingerprint;
    }) {
      const authority = await authorityFor(input.scope);
      if (
        !fingerprintIsValid(input.fingerprint) ||
        input.fingerprint.originCountryUid !== input.scope.originCountryUid ||
        input.fingerprint.originCityUid !== input.scope.originCityUid ||
        input.fingerprint.destinationCountryUid !== input.destination.countryUid ||
        input.fingerprint.destinationLocationUid !== input.destination.locationUid
      ) {
        throw new LogisticsCaptureTaskError(
          'INVALID_OFFICIAL_FINGERPRINT',
          400,
          'Official capture fingerprint is incomplete or outside the requested scope',
        );
      }
      if (!destinationIsVerified(authority, input.destination)) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_DESTINATION_NOT_VERIFIED',
          409,
          'Official capture destination is not verified',
        );
      }
      return persistTask({
        kind: 'OFFICIAL',
        requestedByUserId: input.requestedByUserId,
        scope: input.scope,
        destination: input.destination,
        officialFingerprint: input.fingerprint,
        expectedEndpoints: ['global-calculator/calculate'],
      });
    },

    async claimCaptureTask(input: {
      taskId: string;
      taskVersion: string;
      nonce?: string;
      claimToken?: string;
      scope: LogisticsCaptureScope;
      device: LogisticsCaptureDeviceContext;
    }) {
      validateTaskScopeInput(input.scope);
      if (
        !validIdentifier(input.taskId) ||
        !validIdentifier(input.taskVersion) ||
        !validTaskProof(input) ||
        !validIdentifier(input.device.sessionId) ||
        !validIdentifier(input.device.ownerUserId) ||
        input.scope.tenantId !== input.device.ownerUserId ||
        !input.device.allowedShopIds.includes(input.scope.shopId)
      ) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_MISMATCH',
          404,
          'Capture task is unavailable',
        );
      }
      const result = await options.repository.claimCaptureTask({
        ...input,
        device: {
          ...input.device,
          allowedShopIds: [...input.device.allowedShopIds],
        },
        scope: structuredClone(input.scope),
        now: now(),
      });
      if (result.state === 'not_found') {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_MISMATCH',
          404,
          'Capture task is unavailable',
        );
      }
      if (result.state === 'expired') {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_EXPIRED',
          410,
          'Capture task has expired',
        );
      }
      return result.task;
    },

    async cancelCaptureTask(input: {
      taskId: string;
      taskVersion: string;
      nonce?: string;
      claimToken?: string;
      scope: LogisticsCaptureScope;
      device: LogisticsCaptureDeviceContext;
    }) {
      validateTaskScopeInput(input.scope);
      if (
        !validIdentifier(input.taskId) ||
        !validIdentifier(input.taskVersion) ||
        !validTaskProof(input) ||
        !validIdentifier(input.device.sessionId) ||
        !validIdentifier(input.device.ownerUserId) ||
        input.scope.tenantId !== input.device.ownerUserId ||
        !input.device.allowedShopIds.includes(input.scope.shopId) ||
        !options.repository.cancelCaptureTask
      ) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_MISMATCH',
          404,
          'Capture task is unavailable',
        );
      }
      const result = await options.repository.cancelCaptureTask({
        ...input,
        nonce: input.nonce,
        claimToken: input.claimToken,
        scope: structuredClone(input.scope),
        device: {
          ...input.device,
          allowedShopIds: [...input.device.allowedShopIds],
        },
        now: now(),
      });
      if (result.state === 'not_found') {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_MISMATCH',
          404,
          'Capture task is unavailable',
        );
      }
      if (result.state === 'expired') {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_EXPIRED',
          410,
          'Capture task has expired',
        );
      }
      return result.task;
    },

    async cancelCaptureTaskAsAdmin(input: { taskId: string; actorUserId: string }) {
      if (
        !validIdentifier(input.taskId) ||
        !validIdentifier(input.actorUserId) ||
        !options.repository.cancelCaptureTaskAsAdmin
      ) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_NOT_FOUND',
          404,
          'Capture task is unavailable',
        );
      }
      const result = await options.repository.cancelCaptureTaskAsAdmin({
        ...input,
        now: now(),
      });
      if (result.state === 'not_found') {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_NOT_FOUND',
          404,
          'Capture task is unavailable',
        );
      }
      if (result.state === 'expired') {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_EXPIRED',
          410,
          'Capture task has expired',
        );
      }
      return result.task;
    },

    async reviewCaptureCandidate(input: {
      candidateId: string;
      actorUserId: string;
      decision: 'VERIFIED' | 'REJECTED';
      reason: string;
    }) {
      if (
        !validIdentifier(input.candidateId) ||
        !validIdentifier(input.actorUserId) ||
        !['VERIFIED', 'REJECTED'].includes(input.decision) ||
        !options.repository.getCaptureCandidate ||
        !options.repository.reviewCaptureCandidate
      ) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_CANDIDATE_NOT_FOUND',
          404,
          'Capture candidate is unavailable',
        );
      }
      const reviewReason = normalizeIdentifier(input.reason);
      if (reviewReason.length < 3 || reviewReason.length > 1000) {
        throw new LogisticsCaptureTaskError(
          'INVALID_CAPTURE_REVIEW',
          400,
          'Capture review requires a reason between 3 and 1000 characters',
        );
      }
      const current = await options.repository.getCaptureCandidate(input.candidateId);
      if (!current) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_CANDIDATE_NOT_FOUND',
          404,
          'Capture candidate is unavailable',
        );
      }
      if (input.decision === 'VERIFIED' && current.state !== 'CAPTURED') {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_CANDIDATE_QUARANTINED',
          409,
          'Quarantined capture candidates cannot be verified',
        );
      }
      const result = await options.repository.reviewCaptureCandidate({
        ...input,
        reason: reviewReason,
        reviewedAt: now(),
      });
      if (result.state === 'not_found') {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_CANDIDATE_NOT_FOUND',
          404,
          'Capture candidate is unavailable',
        );
      }
      if (result.state === 'conflict') {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_CANDIDATE_REVIEW_CONFLICT',
          409,
          'Capture candidate was already reviewed',
        );
      }
      return result.candidate;
    },

    async listReviewableCandidates(input: { tenantId?: string; shopId?: string; limit?: number }) {
      const tenantId = input.tenantId ? normalizeIdentifier(input.tenantId) : undefined;
      const shopId = input.shopId ? normalizeIdentifier(input.shopId) : undefined;
      if (
        (input.tenantId && !validIdentifier(tenantId)) ||
        (input.shopId && !validIdentifier(shopId))
      ) {
        throw new LogisticsCaptureTaskError(
          'INVALID_CAPTURE_SCOPE',
          400,
          'Capture review filter is invalid',
        );
      }
      const limit = Math.min(Math.max(Math.floor(input.limit || 100), 1), 200);
      return options.repository.listReviewableCandidates({ tenantId, shopId, limit });
    },

    async getReviewableCandidate(input: { candidateId: string }) {
      const candidateId = normalizeIdentifier(input.candidateId);
      if (!validIdentifier(candidateId)) {
        throw new LogisticsCaptureTaskError(
          'INVALID_CAPTURE_CANDIDATE',
          400,
          'Capture candidate identifier is invalid',
        );
      }
      const candidate = await options.repository.getReviewableCandidate(candidateId);
      if (!candidate) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_CANDIDATE_NOT_FOUND',
          404,
          'Capture candidate is unavailable',
        );
      }
      return candidate;
    },

    async submitCapture(input: {
      taskId: string;
      taskVersion: string;
      nonce?: string;
      claimToken?: string;
      scope: LogisticsCaptureScope;
      payload: unknown;
      deviceSessionId?: string;
      deviceOwnerUserId?: string;
      allowedShopIds?: string[];
    }) {
      assertSafePayload(input.payload);
      const receivedAt = now();
      const device =
        input.deviceSessionId && input.deviceOwnerUserId
          ? {
              sessionId: input.deviceSessionId,
              ownerUserId: input.deviceOwnerUserId,
              allowedShopIds: [...(input.allowedShopIds || [])],
            }
          : undefined;
      const task = await options.repository.findCaptureTask(input.taskId, {
        nonce: input.nonce,
        claimToken: input.claimToken,
        scope: input.scope,
        device,
        now: receivedAt,
      });
      if (
        !task ||
        task.status === 'CANCELLED' ||
        (device &&
          ((task.status !== 'CLAIMED' && task.status !== 'REVIEWABLE') ||
            task.claimedBySessionId !== device.sessionId ||
            task.scope.tenantId !== device.ownerUserId ||
            !device.allowedShopIds.includes(task.scope.shopId))) ||
        !secureEqual(input.taskVersion, task.version) ||
        !validTaskProof(input) ||
        (!input.claimToken && !secureEqual(input.nonce, task.nonce)) ||
        !scopeIsValid(input.scope) ||
        !sameScope(input.scope, task.scope)
      ) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_MISMATCH',
          404,
          'Capture task is unavailable',
        );
      }
      if (receivedAt.getTime() >= task.expiresAt.getTime()) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_TASK_EXPIRED',
          410,
          'Capture task has expired',
        );
      }

      const authority = await authorityFor(task.scope);
      if (task.destination && !destinationIsVerified(authority, task.destination)) {
        throw new LogisticsCaptureTaskError(
          'CAPTURE_DESTINATION_NOT_VERIFIED',
          409,
          'Official capture destination is no longer verified',
        );
      }

      const parsed = parseCapture(task, input.payload);
      const canonicalChecksum = serverResponseChecksum(task, parsed, input.payload);
      const persisted = await options.repository.persistCaptureCandidate({
        taskId: task.id,
        taskKind: task.kind,
        taskVersion: task.version,
        deviceSessionId: device?.sessionId || null,
        deviceOwnerUserId: device?.ownerUserId || null,
        allowedShopIds: device?.allowedShopIds || [],
        scope: structuredClone(task.scope),
        destination: task.destination ? structuredClone(task.destination) : null,
        fingerprintChecksum: task.fingerprintChecksum,
        responseChecksum: canonicalChecksum,
        sourceResponseChecksum: parsed.sourceResponseChecksum,
        capturedAt: parsed.capturedAt,
        receivedAt,
        state: parsed.state,
        reviewStatus: 'PENDING_REVIEW',
        sourceTrust: 'TENANT_ATTESTED',
        quarantineReasons: [...parsed.quarantineReasons],
        normalizedPayload: parsed.normalizedPayload
          ? structuredClone(parsed.normalizedPayload)
          : null,
        diagnostics: structuredClone(parsed.diagnostics),
      });
      return persisted.kind === 'duplicate'
        ? {
            kind: 'duplicate' as const,
            candidateId: persisted.candidateId,
            state: persisted.state,
            duplicate: true,
            changedFromResponseChecksum: null,
            requiresReview: true,
          }
        : {
            kind: 'created' as const,
            candidateId: persisted.candidateId,
            state: persisted.state,
            duplicate: false,
            changedFromResponseChecksum: persisted.previousResponseChecksum,
            requiresReview: true,
          };
    },
  };
}

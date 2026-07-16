import { createHash } from 'node:crypto';

export const OZON_PUBLISH_ATTEMPT_STATES = [
  'PREPARED', 'SUBMITTING', 'SUBMITTED', 'UNKNOWN', 'REJECTED',
] as const;
export const OZON_PUBLISH_RECONCILIATION_STATES = [
  'NOT_REQUIRED', 'PENDING', 'RUNNING', 'RETRY_WAIT',
  'SUCCEEDED', 'PARTIAL_FAILURE', 'FAILED', 'MANUAL_REVIEW',
] as const;
export const OZON_PUBLISH_LEASE_PURPOSES = ['SUBMIT', 'RECONCILE'] as const;

export type OzonPublishAttemptState = typeof OZON_PUBLISH_ATTEMPT_STATES[number];
export type OzonPublishReconciliationState = typeof OZON_PUBLISH_RECONCILIATION_STATES[number];
export type OzonPublishLeasePurpose = typeof OZON_PUBLISH_LEASE_PURPOSES[number];
export type OzonPublishJson = null | boolean | number | string | OzonPublishJson[] | {
  [key: string]: OzonPublishJson;
};

export interface OzonPublishOfferTraceEntry {
  ordinal: number;
  offerId: string;
  skuKey: string;
}

export interface OzonPublishAttemptSource {
  publishIntentId: string;
  workflowId: string;
  ownerUserId: string;
  shopId: string;
  draftVersion: number;
  revision: number;
  sourceCaptureSnapshotId: string;
  actorUserId: string;
  idempotencyKey: string;
  draftStateHash: string;
  draftPayloadHash: string;
  draftPayload: Record<string, OzonPublishJson>;
  currentRevision: number;
  currentDraftVersion: number;
  currentShopId: string;
  currentStage: string;
  currentStatus: string;
}

export interface OzonPublishAttemptRecord {
  id: string;
  publishIntentId: string;
  workflowId: string;
  ownerUserId: string;
  shopId: string;
  draftVersion: number;
  revision: number;
  sourceCaptureSnapshotId: string;
  actorUserId: string;
  idempotencyKey: string;
  catalogSnapshotId: string;
  catalogRevision: string;
  catalogSnapshot: Record<string, OzonPublishJson>;
  catalogSnapshotHash: string;
  attributeSchemaSnapshot: Record<string, OzonPublishJson>;
  attributeSchemaHash: string;
  publisherContractVersion: string;
  endpoint: string;
  draftPayloadHash: string;
  draftStateHash: string;
  requestPayload: Record<string, OzonPublishJson>;
  requestPayloadHash: string;
  offerTrace: OzonPublishOfferTraceEntry[];
  itemCount: number;
  state: OzonPublishAttemptState;
  reconciliationState: OzonPublishReconciliationState;
  stateVersion: number;
  ozonTaskId: string | null;
  acceptanceSource: string | null;
  response: OzonPublishJson | null;
  responseHash: string | null;
  itemResults: OzonPublishJson[] | null;
  itemErrors: OzonPublishJson[];
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  leasePurpose: OzonPublishLeasePurpose | null;
  leaseToken: string | null;
  leaseOwner: string | null;
  leaseEpoch: number;
  heartbeatAt: string | null;
  leaseExpiresAt: string | null;
  submitStartedAt: string | null;
  submittedAt: string | null;
  unknownAt: string | null;
  rejectedAt: string | null;
  nextReconcileAt: string | null;
  reconcileAttemptCount: number;
  lastReconciledAt: string | null;
  completedAt: string | null;
  resolvedByUserId: string | null;
  resolutionNote: string | null;
  resolutionEvidence: Record<string, OzonPublishJson> | null;
  resolutionEvidenceHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OzonPublishAttemptCursor {
  createdAt: string;
  id: string;
}

export interface OzonPublishAttemptSummary {
  id: string;
  workflowId: string;
  shopId: string;
  draftVersion: number;
  revision: number;
  catalogSnapshotHash: string;
  attributeSchemaHash: string;
  publisherContractVersion: string;
  endpoint: string;
  draftPayloadHash: string;
  draftStateHash: string;
  requestPayloadHash: string;
  itemCount: number;
  state: OzonPublishAttemptState;
  reconciliationState: OzonPublishReconciliationState;
  stateVersion: number;
  ozonTaskId: string | null;
  acceptanceSource: string | null;
  responseHash: string | null;
  itemResults: OzonPublishJson[] | null;
  itemResultCount: number;
  itemResultsTruncated: boolean;
  itemErrors: OzonPublishJson[];
  itemErrorCount: number;
  itemErrorsTruncated: boolean;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  submitStartedAt: string | null;
  submittedAt: string | null;
  unknownAt: string | null;
  rejectedAt: string | null;
  nextReconcileAt: string | null;
  reconcileAttemptCount: number;
  lastReconciledAt: string | null;
  completedAt: string | null;
  resolutionEvidenceHash: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OzonPublishAttemptListPage {
  items: OzonPublishAttemptSummary[];
  nextCursor: string | null;
}

export interface PrepareOzonPublishAttemptInput {
  publishIntentId: string;
  ownerUserId: string;
  catalogSnapshotId: string;
  catalogRevision: string;
  catalogSnapshot: unknown;
  catalogSnapshotHash: string;
  attributeSchemaSnapshot: unknown;
  attributeSchemaHash: string;
  publisherContractVersion: string;
  endpoint?: string;
  requestPayload: unknown;
  requestPayloadHash: string;
  offerTrace: OzonPublishOfferTraceEntry[];
}

export type OzonSubmissionOutcome =
  | { kind: 'SUBMITTED'; taskId: string; response: unknown; acceptanceSource?: string }
  | { kind: 'UNKNOWN'; errorCode: string; errorMessage: string; response?: unknown }
  | { kind: 'REJECTED'; errorCode: string; errorMessage: string; response?: unknown };

export type OzonReconciliationOutcome =
  | { kind: 'RETRY_WAIT'; nextReconcileAt: Date; errorCode: string; errorMessage: string; itemResults?: unknown[]; itemErrors?: unknown[] }
  | { kind: 'SUCCEEDED' | 'PARTIAL_FAILURE' | 'FAILED' | 'MANUAL_REVIEW'; itemResults?: unknown[]; itemErrors?: unknown[]; errorCode?: string; errorMessage?: string };

export type OzonUnknownResolution =
  | { decision: 'SUBMITTED'; taskId?: string; note: string; evidence: unknown }
  | { decision: 'NOT_SUBMITTED'; note: string; evidence: unknown };

export interface OzonPublishLeaseClaim {
  attempt: OzonPublishAttemptRecord;
  leaseToken: string;
  leaseEpoch: number;
}

export type OzonPublishReconciliationAttemptRecord = Omit<
  OzonPublishAttemptRecord,
  | 'catalogSnapshot'
  | 'attributeSchemaSnapshot'
  | 'requestPayload'
  | 'response'
  | 'itemResults'
  | 'itemErrors'
  | 'resolutionEvidence'
>;

export interface OzonPublishReconciliationLeaseClaim {
  attempt: OzonPublishReconciliationAttemptRecord;
  leaseToken: string;
  leaseEpoch: number;
}

export class OzonPublishAttemptError extends Error {
  constructor(
    public readonly code:
      | 'NOT_FOUND'
      | 'INVALID_INPUT'
      | 'VERSION_CONFLICT'
      | 'IDEMPOTENCY_CONFLICT'
      | 'INVALID_TRANSITION'
      | 'LEASE_LOST',
    message: string,
  ) {
    super(message);
    this.name = 'OzonPublishAttemptError';
  }
}

function invalid(message: string): never {
  throw new OzonPublishAttemptError('INVALID_INPUT', message);
}

export function boundedOzonPublishText(
  value: unknown,
  label: string,
  maxLength: number,
  minLength = 1,
): string {
  if (typeof value !== 'string') invalid(`${label} must be a string`);
  const normalized = value.normalize('NFKC').trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    invalid(`${label} must contain ${minLength} to ${maxLength} characters`);
  }
  return normalized;
}

export function normalizeOzonPublishHash(value: unknown, label: string): string {
  const hash = boundedOzonPublishText(value, label, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(hash)) invalid(`${label} must be a SHA-256 hash`);
  return hash;
}

function jsonText(value: unknown, label: string, maxBytes: number): string {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    invalid(`${label} must be JSON serializable`);
  }
  if (serialized === undefined || Buffer.byteLength(serialized, 'utf8') > maxBytes) {
    invalid(`${label} exceeds ${maxBytes} UTF-8 bytes`);
  }
  return serialized;
}

export function cloneOzonPublishJson(
  value: unknown,
  label: string,
  maxBytes: number,
): OzonPublishJson {
  const serialized = jsonText(value, label, maxBytes);
  return JSON.parse(serialized) as OzonPublishJson;
}

export function cloneOzonPublishObject(
  value: unknown,
  label: string,
  maxBytes: number,
): Record<string, OzonPublishJson> {
  const cloned = cloneOzonPublishJson(value, label, maxBytes);
  if (!cloned || typeof cloned !== 'object' || Array.isArray(cloned)) invalid(`${label} must be an object`);
  return cloned as Record<string, OzonPublishJson>;
}

export function cloneOzonPublishArray(
  value: unknown,
  label: string,
  maxBytes: number,
): OzonPublishJson[] {
  const cloned = cloneOzonPublishJson(value, label, maxBytes);
  if (!Array.isArray(cloned)) invalid(`${label} must be an array`);
  return cloned;
}

export function canonicalOzonPublishJson(value: OzonPublishJson): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalOzonPublishJson).join(',')}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalOzonPublishJson(item)}`)
    .join(',')}}`;
}

export function hashOzonPublishJson(value: OzonPublishJson): string {
  return createHash('sha256').update(canonicalOzonPublishJson(value)).digest('hex');
}

export function normalizeOzonPublishTaskId(value: unknown): string {
  const taskId = typeof value === 'bigint' ? value.toString() : String(value ?? '').trim();
  if (!/^[0-9]{1,40}$/.test(taskId)) invalid('Ozon task ID is invalid');
  try {
    const normalized = BigInt(taskId);
    if (normalized <= 0n) invalid('Ozon task ID is invalid');
    return normalized.toString();
  } catch {
    return invalid('Ozon task ID is invalid');
  }
}

export function extractOzonPublishTaskId(response: unknown): string | null {
  const record = response && typeof response === 'object' && !Array.isArray(response)
    ? response as Record<string, unknown>
    : null;
  const result = record?.result && typeof record.result === 'object' && !Array.isArray(record.result)
    ? record.result as Record<string, unknown>
    : null;
  const value = result?.task_id;
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return null;
  if (!['string', 'number', 'bigint'].includes(typeof value)) return null;
  try {
    return normalizeOzonPublishTaskId(value);
  } catch {
    return null;
  }
}

export function normalizeOzonPublishOfferTrace(value: unknown): OzonPublishOfferTraceEntry[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) {
    invalid('offer trace must contain 1 to 500 entries');
  }
  const seen = new Set<string>();
  return value.map((entry, ordinal) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid(`offer trace ${ordinal} is invalid`);
    const row = entry as Partial<OzonPublishOfferTraceEntry>;
    if (row.ordinal !== ordinal) invalid('offer trace ordinals must be contiguous and deterministic');
    const offerId = boundedOzonPublishText(row.offerId, `offer trace ${ordinal} offerId`, 200);
    const skuKey = boundedOzonPublishText(row.skuKey, `offer trace ${ordinal} skuKey`, 500);
    if (seen.has(offerId)) invalid(`offer trace contains duplicate offer ID ${offerId}`);
    seen.add(offerId);
    return { ordinal, offerId, skuKey };
  });
}

export function normalizeOzonPublishLeaseMs(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1_000 || Number(value) > 15 * 60_000) {
    invalid('lease duration must be between 1000 and 900000 milliseconds');
  }
  return Number(value);
}

export function normalizeOzonPublishBatchLimit(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1 || Number(value) > 100) {
    invalid('claim limit must be between 1 and 100');
  }
  return Number(value);
}

export function normalizeOzonPublishAttemptListLimit(value: unknown): number {
  if (value === undefined || value === null || value === '') return 20;
  const limit = typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(limit) || Number(limit) < 1 || Number(limit) > 100) {
    invalid('attempt list limit must be between 1 and 100');
  }
  return Number(limit);
}

export function encodeOzonPublishAttemptCursor(cursor: OzonPublishAttemptCursor): string {
  const createdAt = boundedOzonPublishText(cursor?.createdAt, 'attempt cursor createdAt', 30);
  const parsedCreatedAt = new Date(createdAt);
  if (!Number.isFinite(parsedCreatedAt.getTime()) || parsedCreatedAt.toISOString() !== createdAt) {
    invalid('attempt cursor createdAt is invalid');
  }
  const id = boundedOzonPublishText(cursor?.id, 'attempt cursor id', 200);
  return Buffer.from(JSON.stringify({ v: 1, c: createdAt, i: id }), 'utf8').toString('base64url');
}

export function decodeOzonPublishAttemptCursor(value: unknown): OzonPublishAttemptCursor {
  const cursor = boundedOzonPublishText(value, 'attempt cursor', 500);
  if (!/^[A-Za-z0-9_-]+$/.test(cursor)) invalid('attempt cursor is invalid');
  let parsed: unknown;
  try {
    const decoded = Buffer.from(cursor, 'base64url');
    if (decoded.toString('base64url') !== cursor) invalid('attempt cursor is invalid');
    parsed = JSON.parse(decoded.toString('utf8'));
  } catch (error) {
    if (error instanceof OzonPublishAttemptError) throw error;
    invalid('attempt cursor is invalid');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    invalid('attempt cursor is invalid');
  }
  const row = parsed as Record<string, unknown>;
  if (row.v !== 1 || Object.keys(row).length !== 3) invalid('attempt cursor is invalid');
  const createdAt = boundedOzonPublishText(row.c, 'attempt cursor createdAt', 30);
  const parsedCreatedAt = new Date(createdAt);
  if (!Number.isFinite(parsedCreatedAt.getTime()) || parsedCreatedAt.toISOString() !== createdAt) {
    invalid('attempt cursor createdAt is invalid');
  }
  return {
    createdAt,
    id: boundedOzonPublishText(row.i, 'attempt cursor id', 200),
  };
}

export function normalizeOzonPublishError(input: {
  errorCode?: unknown;
  errorMessage?: unknown;
}): { errorCode: string | null; errorMessage: string | null } {
  return {
    errorCode: input.errorCode == null || String(input.errorCode).trim() === ''
      ? null
      : boundedOzonPublishText(String(input.errorCode), 'error code', 100),
    errorMessage: input.errorMessage == null || String(input.errorMessage).trim() === ''
      ? null
      : boundedOzonPublishText(String(input.errorMessage), 'error message', 2000),
  };
}

export interface OzonPublishAttemptRepository {
  loadExactIntent(input: { publishIntentId: string; ownerUserId: string }): Promise<OzonPublishAttemptSource | null>;
  prepare(input: PrepareOzonPublishAttemptInput): Promise<{ attempt: OzonPublishAttemptRecord; idempotent: boolean }>;
  getOwned(input: { attemptId: string; ownerUserId: string }): Promise<OzonPublishAttemptRecord | null>;
  getByPublishIntent(input: { publishIntentId: string; ownerUserId: string }): Promise<OzonPublishAttemptRecord | null>;
  listOwnedByWorkflow(input: {
    workflowId: string;
    ownerUserId: string;
    limit?: unknown;
    cursor?: string | null;
  }): Promise<OzonPublishAttemptListPage>;
  getLatestOwnedByWorkflow(input: {
    workflowId: string;
    ownerUserId: string;
  }): Promise<OzonPublishAttemptSummary | null>;
  claimSubmission(input: { attemptId: string; workerId: string; leaseMs: number }): Promise<OzonPublishLeaseClaim | null>;
  heartbeat(input: { attemptId: string; workerId: string; leaseToken: string; leaseEpoch: number; leaseMs: number }): Promise<boolean>;
  completeSubmission(input: { attemptId: string; workerId: string; leaseToken: string; leaseEpoch: number; outcome: OzonSubmissionOutcome }): Promise<OzonPublishAttemptRecord>;
  recoverSubmissionAcknowledgement(input: {
    attemptId: string;
    workerId: string;
    leaseToken: string;
    leaseEpoch: number;
    taskId: string;
    response: unknown;
  }): Promise<OzonPublishAttemptRecord>;
  markStaleSubmissionsUnknown(input: { workerId: string; limit: number }): Promise<string[]>;
  claimReconciliation(input: { workerId: string; leaseMs: number; limit: number }): Promise<OzonPublishReconciliationLeaseClaim[]>;
  completeReconciliation(input: { attemptId: string; workerId: string; leaseToken: string; leaseEpoch: number; outcome: OzonReconciliationOutcome }): Promise<OzonPublishAttemptRecord>;
  attachLateAcknowledgement(input: {
    attemptId: string;
    workerId: string;
    leaseToken: string;
    leaseEpoch: number;
    taskId: string;
    response: unknown;
  }): Promise<OzonPublishAttemptRecord>;
  resolveUnknown(input: { attemptId: string; ownerUserId: string; actorUserId: string; expectedStateVersion: number; resolution: OzonUnknownResolution }): Promise<OzonPublishAttemptRecord>;
}

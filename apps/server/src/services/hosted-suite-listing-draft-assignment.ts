import { createHash } from 'node:crypto';
import type { OzonListingDraft, OzonListingDraftMediaAssignment } from 'shared';
import {
  AI_IMAGE_SUITE_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_OUTPUT_WIDTH,
} from './ai-image-suite-materialization.js';
import {
  AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_INPUT_BYTES,
} from './ai-image-suite-output-normalizer.js';
import { admittedAiImageSuiteOutputNormalizer, type AiImageSuiteRawOutputAuthority } from './ai-image-suite-output-admission.js';

export const HOSTED_SUITE_LISTING_DRAFT_ASSIGNMENT_VERSION =
  'hosted-suite-listing-draft-assignment/v2' as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const BATCH_ID_PREFIX = 'hosted-assignment-batch:';
const ASSIGNMENT_ID_PREFIX = 'hosted-assignment:';
const MAX_ASSIGNMENTS = 500;

export interface AssignHostedSuiteOutputToListingDraftItemInput {
  skuKey: string;
  slotKey: string;
  suiteSlotId: string;
  expectedSuiteSlotRevision: number;
  childWorkflowId: string;
  expectedChildWorkflowRevision: number;
  outputAssetId: string;
}

export interface AssignHostedSuiteOutputToListingDraftInput {
  ownerUserId: string;
  actorUserId: string;
  deviceSessionId: string;
  shopId: string;
  listingWorkflowId: string;
  expectedDraftRevision: number;
  expectedDraftVersion: number;
  sourceCaptureSnapshotId: string;
  assignmentStartOrdinal: number;
  planId: string;
  planVersionId: string;
  expectedPlanRevision: number;
  suiteId: string;
  expectedSuiteRevision: number;
  idempotencyKey: string;
  items: AssignHostedSuiteOutputToListingDraftItemInput[];
}

export interface HostedSuiteListingDraftPlanSlotAuthority {
  ordinal: number;
  slotKey: string;
  ownershipLevel: string;
  ownershipKey: string;
  compatibilityGroupKey: string | null;
  skuKeys: string[];
}

export interface HostedSuiteListingDraftSuiteSlotAuthority {
  id: string;
  suiteId: string;
  ownerUserId: string;
  ordinal: number;
  slotKey: string;
  ownershipLevel: string;
  ownershipKey: string;
  compatibilityGroupKey: string | null;
  status: string;
  attempt: number;
  revision: number;
  childWorkflowId: string | null;
}

export interface HostedSuiteListingDraftChildWorkflowAuthority {
  id: string;
  ownerUserId: string;
  actorUserId: string | null;
  status: string;
  reviewStatus: string;
  revision: number;
  currentAttempt: number;
  operation: string;
  contextType: string;
  contextId: string;
  contextSkuKey: string | null;
  contextSlotKey: string | null;
  selectedOutputAssetId: string | null;
  reviewedByOwnerUserId: string | null;
  reviewedAt: Date | null;
  inputSourceCaptureSnapshotIds: string[];
}

export interface HostedSuiteListingDraftJobAuthority {
  id: string;
  ownerUserId: string;
  actorUserId: string | null;
  workflowId: string | null;
  workflowAttempt: number | null;
  executionMode: string;
  status: string;
  operation: string;
  provider: string;
  model: string;
  requestFingerprint: string | null;
  actualCostMinor: number | null;
  billedUnits: number;
  appliedAt: Date | null;
  operationConfig?: unknown;
  providerJobId?: string | null;
}

export interface HostedSuiteListingDraftReservationAuthority {
  id: string;
  ownerUserId: string;
  actorUserId: string;
  workflowId: string | null;
  jobId: string;
  status: string;
  provider: string;
  model: string;
  operation: string;
  requestFingerprint: string;
  settledAt: Date | null;
}

export interface HostedSuiteListingDraftSettlementAuthority {
  id: string;
  reservationId: string;
  ownerUserId: string;
  actorUserId: string;
  kind: string;
  requestFingerprint: string;
  actualCostMinor: number | null;
  billedUnits: number;
}

export interface HostedSuiteListingDraftOutputAuthority {
  id: string;
  ownerUserId: string;
  aiImageJobId: string | null;
  kind: string;
  sourceCaptureSnapshotId: string | null;
  storageBackend: string;
  storageKey: string | null;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  sha256: string | null;
  metadata: {
    version: string;
    suiteId: string;
    slotId: string;
    attempt: number;
    providerOutputAssetId: string;
    normalizerVersion?: string;
    sourceCaptureSnapshotId?: string;
    [key: string]: unknown;
  } | null;
}

export interface HostedSuiteListingDraftAssignmentSlotAuthority {
  planSlot: HostedSuiteListingDraftPlanSlotAuthority;
  suiteSlot: HostedSuiteListingDraftSuiteSlotAuthority;
  childWorkflow: HostedSuiteListingDraftChildWorkflowAuthority | null;
  currentJob: HostedSuiteListingDraftJobAuthority | null;
  costReservation: HostedSuiteListingDraftReservationAuthority | null;
  costSettlement: HostedSuiteListingDraftSettlementAuthority | null;
  outputAsset: HostedSuiteListingDraftOutputAuthority | null;
  rawOutputAsset?: AiImageSuiteRawOutputAuthority | null;
}

export interface HostedSuiteListingDraftAssignmentAuthority {
  actor: {
    id: string;
    ownerUserId: string;
    active: boolean;
  };
  deviceSession: {
    id: string;
    deviceId: string;
    ownerUserId: string;
    actorUserId: string;
    revokedAt: Date | null;
    expiresAt: Date;
    scopes: string[];
    shopIds: string[];
  };
  shop: {
    id: string;
    ownerUserId: string;
    active: boolean;
  };
  draft: OzonListingDraft;
  plan: {
    id: string;
    ownerUserId: string;
    actorUserId: string;
    revision: number;
    contextType: string;
    contextId: string;
    currentVersionId: string | null;
    approvedVersionId: string | null;
    reviewStatus: string;
    staleAt: Date | null;
    listingBinding: {
      ownerUserId: string;
      deviceSessionId: string;
      shopId: string;
      listingWorkflowId: string;
      draftRevision: number;
      draftVersion: number;
      sourceCaptureSnapshotId: string;
      selectedSkuKeys: string[];
    };
  };
  planVersion: {
    id: string;
    planId: string;
    ownerUserId: string;
    sourceSubjectId: string;
    sourceCaptureSnapshotId: string;
    sourceCaptureHash: string;
  };
  suite: {
    id: string;
    ownerUserId: string;
    actorUserId: string;
    planId: string;
    planVersionId: string;
    sourceSubjectId: string;
    sourceCaptureSnapshotId: string;
    sourceCaptureHash: string;
    contextType: string;
    contextId: string;
    status: string;
    revision: number;
    provider: string;
    model: string;
    itemCount: number;
    completedAt: Date | null;
  };
  slots: HostedSuiteListingDraftAssignmentSlotAuthority[];
}

export type HostedSuiteListingDraftAssignmentScope = 'SKU' | 'PRODUCT';

export interface HostedSuiteListingDraftAssignmentRecord {
  contractVersion: typeof HOSTED_SUITE_LISTING_DRAFT_ASSIGNMENT_VERSION;
  batchId: string;
  batchItemOrdinal: number;
  assignmentId: string;
  idempotencyKey: string;
  requestHash: string;
  authorityHash: string;
  ownerUserId: string;
  actorUserId: string;
  deviceSessionId: string;
  shopId: string;
  listingWorkflowId: string;
  sourceDraftRevision: number;
  sourceDraftVersion: number;
  boundDraftRevision: number;
  boundDraftVersion: number;
  sourceCaptureSnapshotId: string;
  assignmentScope: HostedSuiteListingDraftAssignmentScope;
  skuKey: string;
  slotKey: string;
  assignmentOrdinal: number;
  assetId: string;
  assetSha256: string;
  assignmentSha256: string;
  planId: string;
  planVersionId: string;
  planRevision: number;
  suiteId: string;
  suiteSlotId: string;
  childWorkflowId: string;
  jobId: string;
  reservationId: string;
  settlementId: string;
  createdAt: Date;
}

export interface HostedSuiteListingDraftAssignmentBatchRecord {
  batchId: string;
  requestHash: string;
  ownerUserId: string;
  idempotencyKey: string;
  records: HostedSuiteListingDraftAssignmentRecord[];
}

export interface HostedSuiteListingDraftAssignmentExpectedItemAuthority {
  batchItemOrdinal: number;
  assignmentScope: HostedSuiteListingDraftAssignmentScope;
  skuKey: string;
  slotKey: string;
  assignmentOrdinal: number;
  planSlotOrdinal: number;
  suiteSlotId: string;
  suiteSlotRevision: number;
  childWorkflowId: string;
  childWorkflowRevision: number;
  childWorkflowAttempt: number;
  jobId: string;
  outputAssetId: string;
  reservationId: string;
  settlementId: string;
  requestFingerprint: string;
  actualCostMinor: number;
  billedUnits: number;
  assetSha256: string;
}

export interface HostedSuiteListingDraftAssignmentExpectedAuthority {
  ownerUserId: string;
  actorUserId: string;
  deviceSessionId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
  sourceCaptureSnapshotId: string;
  sourceCaptureHash: string;
  assignmentStartOrdinal: number;
  planId: string;
  planVersionId: string;
  planRevision: number;
  suiteId: string;
  suiteRevision: number;
  items: HostedSuiteListingDraftAssignmentExpectedItemAuthority[];
}

export interface HostedSuiteListingDraftAssignmentCommitInput {
  idempotencyKey: string;
  requestHash: string;
  batchId: string;
  appliedAt: Date;
  records: HostedSuiteListingDraftAssignmentRecord[];
  nextDraft: OzonListingDraft;
  expected: HostedSuiteListingDraftAssignmentExpectedAuthority;
}

export type HostedSuiteListingDraftAssignmentCommitResult =
  | { kind: 'committed'; batch: HostedSuiteListingDraftAssignmentBatchRecord }
  | { kind: 'replayed'; batch: HostedSuiteListingDraftAssignmentBatchRecord }
  | { kind: 'cas-conflict' }
  | { kind: 'idempotency-conflict' };

export interface HostedSuiteListingDraftAssignmentTransaction {
  findReplay(input: {
    ownerUserId: string;
    idempotencyKey: string;
  }): Promise<HostedSuiteListingDraftAssignmentBatchRecord | null>;
  loadAuthority(
    input: AssignHostedSuiteOutputToListingDraftInput,
  ): Promise<HostedSuiteListingDraftAssignmentAuthority | null>;
  commit(
    input: HostedSuiteListingDraftAssignmentCommitInput,
  ): Promise<HostedSuiteListingDraftAssignmentCommitResult>;
}

export interface HostedSuiteListingDraftAssignmentRepository {
  transaction<T>(
    operation: (transaction: HostedSuiteListingDraftAssignmentTransaction) => Promise<T>,
  ): Promise<T>;
}

export type HostedSuiteListingDraftAssignmentErrorCode =
  | 'HOSTED_LISTING_ASSIGNMENT_INVALID_REQUEST'
  | 'HOSTED_LISTING_ASSIGNMENT_NOT_FOUND'
  | 'HOSTED_LISTING_ASSIGNMENT_FORBIDDEN'
  | 'HOSTED_LISTING_ASSIGNMENT_DRAFT_STALE'
  | 'HOSTED_LISTING_ASSIGNMENT_PLAN_STALE'
  | 'HOSTED_LISTING_ASSIGNMENT_SUITE_STALE'
  | 'HOSTED_LISTING_ASSIGNMENT_CANDIDATE_SET_MISMATCH'
  | 'HOSTED_LISTING_ASSIGNMENT_CANDIDATE_INVALID'
  | 'HOSTED_LISTING_ASSIGNMENT_BILLING_INCOMPLETE'
  | 'HOSTED_LISTING_ASSIGNMENT_SLOT_CONFLICT'
  | 'HOSTED_LISTING_ASSIGNMENT_ORDER_CONFLICT'
  | 'HOSTED_LISTING_ASSIGNMENT_IDEMPOTENCY_CONFLICT'
  | 'HOSTED_LISTING_ASSIGNMENT_CAS_CONFLICT';

export class HostedSuiteListingDraftAssignmentError extends Error {
  constructor(
    public readonly code: HostedSuiteListingDraftAssignmentErrorCode,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'HostedSuiteListingDraftAssignmentError';
  }
}

export interface HostedSuiteListingDraftAssignmentSummary {
  assignmentId: string;
  skuKey: string;
  slotKey: string;
  assignmentScope: HostedSuiteListingDraftAssignmentScope;
  assignmentOrdinal: number;
  assetId: string;
}

export interface HostedSuiteListingDraftAssignmentResult {
  contractVersion: typeof HOSTED_SUITE_LISTING_DRAFT_ASSIGNMENT_VERSION;
  batchId: string;
  replayed: boolean;
  shopId: string;
  listingWorkflowId: string;
  sourceDraftRevision: number;
  sourceDraftVersion: number;
  boundDraftRevision: number;
  boundDraftVersion: number;
  assignments: HostedSuiteListingDraftAssignmentSummary[];
  validationStatus: 'STALE';
  publishReadiness: 'STALE';
}

const INPUT_KEYS = Object.freeze([
  'ownerUserId',
  'actorUserId',
  'deviceSessionId',
  'shopId',
  'listingWorkflowId',
  'expectedDraftRevision',
  'expectedDraftVersion',
  'sourceCaptureSnapshotId',
  'assignmentStartOrdinal',
  'planId',
  'planVersionId',
  'expectedPlanRevision',
  'suiteId',
  'expectedSuiteRevision',
  'idempotencyKey',
  'items',
] as const);

const ITEM_KEYS = Object.freeze([
  'skuKey',
  'slotKey',
  'suiteSlotId',
  'expectedSuiteSlotRevision',
  'childWorkflowId',
  'expectedChildWorkflowRevision',
  'outputAssetId',
] as const);

function fail(
  code: HostedSuiteListingDraftAssignmentErrorCode,
  statusCode: number,
  message: string,
): never {
  throw new HostedSuiteListingDraftAssignmentError(code, message, statusCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0) || 0;
    return codePoint <= 31 || codePoint === 127;
  });
}

function hasTransportAuthority(value: string): boolean {
  const lower = value.toLowerCase();
  return value.includes('?')
    || value.includes('#')
    || lower.startsWith('data:')
    || /(?:https?|ftp):\/\//iu.test(value)
    || /(^|[\s:])authorization(?:[\s:=]|$)/iu.test(value)
    || /(^|[\s:])bearer\s+/iu.test(value)
    || /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|secret)\s*[:=]/iu.test(value);
}

function isExactIdentifier(value: unknown, maximum = 200): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maximum
    && value === value.trim()
    && value === value.normalize('NFKC')
    && !hasControlCharacter(value)
    && !hasTransportAuthority(value);
}

function exactInputIdentifier(value: unknown, label: string, maximum = 200): string {
  if (!isExactIdentifier(value, maximum)) {
    fail('HOSTED_LISTING_ASSIGNMENT_INVALID_REQUEST', 400, `${label} is invalid`);
  }
  return value;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function positiveInputInteger(value: unknown, label: string): number {
  if (!isPositiveInteger(value)) {
    fail('HOSTED_LISTING_ASSIGNMENT_INVALID_REQUEST', 400, `${label} is invalid`);
  }
  return Number(value);
}

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && SHA256_PATTERN.test(value);
}

function sameKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function normalizeItem(
  raw: AssignHostedSuiteOutputToListingDraftItemInput,
  index: number,
): AssignHostedSuiteOutputToListingDraftItemInput {
  if (!isRecord(raw) || !sameKeys(raw, ITEM_KEYS)) {
    fail('HOSTED_LISTING_ASSIGNMENT_INVALID_REQUEST', 400, `items[${index}] is invalid`);
  }
  return {
    skuKey: exactInputIdentifier(raw.skuKey, `items[${index}].skuKey`, 500),
    slotKey: exactInputIdentifier(raw.slotKey, `items[${index}].slotKey`, 1_024),
    suiteSlotId: exactInputIdentifier(raw.suiteSlotId, `items[${index}].suiteSlotId`),
    expectedSuiteSlotRevision: positiveInputInteger(
      raw.expectedSuiteSlotRevision,
      `items[${index}].expectedSuiteSlotRevision`,
    ),
    childWorkflowId: exactInputIdentifier(
      raw.childWorkflowId,
      `items[${index}].childWorkflowId`,
    ),
    expectedChildWorkflowRevision: positiveInputInteger(
      raw.expectedChildWorkflowRevision,
      `items[${index}].expectedChildWorkflowRevision`,
    ),
    outputAssetId: exactInputIdentifier(
      raw.outputAssetId,
      `items[${index}].outputAssetId`,
      500,
    ),
  };
}

function normalizeInput(
  input: AssignHostedSuiteOutputToListingDraftInput,
): AssignHostedSuiteOutputToListingDraftInput {
  if (!isRecord(input) || !sameKeys(input, INPUT_KEYS)
    || !Array.isArray(input.items)
    || input.items.length < 1
    || input.items.length > MAX_ASSIGNMENTS) {
    fail('HOSTED_LISTING_ASSIGNMENT_INVALID_REQUEST', 400, 'Assignment batch is invalid');
  }
  if (!Number.isSafeInteger(input.assignmentStartOrdinal)
    || input.assignmentStartOrdinal < 0
    || input.assignmentStartOrdinal >= MAX_ASSIGNMENTS
    || input.assignmentStartOrdinal + input.items.length > MAX_ASSIGNMENTS) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_INVALID_REQUEST',
      400,
      'assignmentStartOrdinal is invalid',
    );
  }
  const idempotencyKey = exactInputIdentifier(input.idempotencyKey, 'idempotencyKey');
  if (idempotencyKey.length < 16) {
    fail('HOSTED_LISTING_ASSIGNMENT_INVALID_REQUEST', 400, 'idempotencyKey is invalid');
  }
  const items = input.items.map(normalizeItem);
  const uniqueFields: Array<keyof AssignHostedSuiteOutputToListingDraftItemInput> = [
    'slotKey', 'suiteSlotId', 'childWorkflowId', 'outputAssetId',
  ];
  for (const field of uniqueFields) {
    if (new Set(items.map((item) => item[field])).size !== items.length) {
      fail(
        'HOSTED_LISTING_ASSIGNMENT_INVALID_REQUEST',
        400,
        `Assignment items contain duplicate ${field}`,
      );
    }
  }
  return {
    ownerUserId: exactInputIdentifier(input.ownerUserId, 'ownerUserId'),
    actorUserId: exactInputIdentifier(input.actorUserId, 'actorUserId'),
    deviceSessionId: exactInputIdentifier(input.deviceSessionId, 'deviceSessionId'),
    shopId: exactInputIdentifier(input.shopId, 'shopId'),
    listingWorkflowId: exactInputIdentifier(input.listingWorkflowId, 'listingWorkflowId'),
    expectedDraftRevision: positiveInputInteger(
      input.expectedDraftRevision,
      'expectedDraftRevision',
    ),
    expectedDraftVersion: positiveInputInteger(input.expectedDraftVersion, 'expectedDraftVersion'),
    sourceCaptureSnapshotId: exactInputIdentifier(
      input.sourceCaptureSnapshotId,
      'sourceCaptureSnapshotId',
    ),
    assignmentStartOrdinal: input.assignmentStartOrdinal,
    planId: exactInputIdentifier(input.planId, 'planId'),
    planVersionId: exactInputIdentifier(input.planVersionId, 'planVersionId'),
    expectedPlanRevision: positiveInputInteger(input.expectedPlanRevision, 'expectedPlanRevision'),
    suiteId: exactInputIdentifier(input.suiteId, 'suiteId'),
    expectedSuiteRevision: positiveInputInteger(
      input.expectedSuiteRevision,
      'expectedSuiteRevision',
    ),
    idempotencyKey,
    items,
  };
}

function canonicalJsonValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new Error('Cannot hash cyclic hosted assignment authority');
    ancestors.add(value);
    const result = value.map((item) => canonicalJsonValue(item, ancestors));
    ancestors.delete(value);
    return result;
  }
  if (isRecord(value)) {
    if (ancestors.has(value)) throw new Error('Cannot hash cyclic hosted assignment authority');
    ancestors.add(value);
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] !== undefined) result[key] = canonicalJsonValue(value[key], ancestors);
    }
    ancestors.delete(value);
    return result;
  }
  return value;
}

function hashJson(value: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalJsonValue(value)))
    .digest('hex');
}

function requestHashPayload(input: AssignHostedSuiteOutputToListingDraftInput) {
  return {
    contractVersion: HOSTED_SUITE_LISTING_DRAFT_ASSIGNMENT_VERSION,
    ...input,
  };
}

export function createHostedSuiteListingDraftAssignmentRequestHash(
  rawInput: AssignHostedSuiteOutputToListingDraftInput,
): string {
  return hashJson(requestHashPayload(normalizeInput(rawInput)));
}

function sameStringArray(left: unknown, right: readonly string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sameSortedStringSet(left: readonly string[], right: readonly string[]): boolean {
  const sort = (values: readonly string[]) => [...values].sort((first, second) => (
    first < second ? -1 : first > second ? 1 : 0
  ));
  return sameStringArray(sort(left), sort(right));
}

function validIdentifierArray(value: unknown, maximumLength: number, itemMaximum = 500): boolean {
  if (!Array.isArray(value) || value.length > maximumLength) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (!isExactIdentifier(item, itemMaximum) || seen.has(item)) return false;
    seen.add(item);
  }
  return true;
}

function assertCallerAuthority(
  authority: HostedSuiteListingDraftAssignmentAuthority,
  input: AssignHostedSuiteOutputToListingDraftInput,
  now: Date,
) {
  const { actor, deviceSession, shop } = authority;
  const valid = actor.id === input.actorUserId
    && actor.ownerUserId === input.ownerUserId
    && actor.active === true
    && deviceSession.id === input.deviceSessionId
    && isExactIdentifier(deviceSession.deviceId)
    && deviceSession.ownerUserId === input.ownerUserId
    && deviceSession.actorUserId === input.actorUserId
    && deviceSession.revokedAt === null
    && isValidDate(deviceSession.expiresAt)
    && deviceSession.expiresAt.getTime() > now.getTime()
    && validIdentifierArray(deviceSession.scopes, 100)
    && deviceSession.scopes.includes('listing:write')
    && validIdentifierArray(deviceSession.shopIds, 500)
    && deviceSession.shopIds.includes(input.shopId)
    && shop.id === input.shopId
    && shop.ownerUserId === input.ownerUserId
    && shop.active === true;
  if (!valid) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_FORBIDDEN',
      403,
      'The device is not authorized to update this listing draft',
    );
  }
}

const ASSIGNMENT_SOURCES = new Set([
  'SOURCE',
  'REVIEWED',
  'GENERATED',
  'TRANSLATED',
  'EDITED',
]);

function normalizedExistingAssignment(
  value: unknown,
): OzonListingDraftMediaAssignment | null {
  if (!isRecord(value)
    || !isExactIdentifier(value.slotKey, 1_024)
    || !isExactIdentifier(value.assetId, 500)
    || typeof value.source !== 'string'
    || !ASSIGNMENT_SOURCES.has(value.source)) return null;
  if (value.scope === 'PRODUCT') {
    if (!sameKeys(value, ['scope', 'slotKey', 'assetId', 'source'])) return null;
    return {
      scope: 'PRODUCT',
      slotKey: value.slotKey,
      assetId: value.assetId,
      source: value.source as OzonListingDraftMediaAssignment['source'],
    };
  }
  if (value.scope !== 'SKU'
    || !sameKeys(value, ['scope', 'skuKey', 'slotKey', 'assetId', 'source'])
    || !isExactIdentifier(value.skuKey, 500)) return null;
  return {
    scope: 'SKU',
    skuKey: value.skuKey,
    slotKey: value.slotKey,
    assetId: value.assetId,
    source: value.source as OzonListingDraftMediaAssignment['source'],
  };
}

function currentAssignments(draft: OzonListingDraft): OzonListingDraftMediaAssignment[] {
  if (!isRecord(draft.media)
    || !Array.isArray(draft.media.assignments)
    || draft.media.assignments.length >= MAX_ASSIGNMENTS) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_DRAFT_STALE',
      409,
      'The listing draft media authority is invalid',
    );
  }
  const assignments: OzonListingDraftMediaAssignment[] = [];
  const assetIds = new Set<string>();
  const slotKeys = new Set<string>();
  for (const value of draft.media.assignments) {
    const assignment = normalizedExistingAssignment(value);
    if (!assignment || assetIds.has(assignment.assetId) || slotKeys.has(assignment.slotKey)) {
      fail(
        'HOSTED_LISTING_ASSIGNMENT_DRAFT_STALE',
        409,
        'The listing draft media authority is ambiguous',
      );
    }
    assignments.push(assignment);
    assetIds.add(assignment.assetId);
    slotKeys.add(assignment.slotKey);
  }
  return assignments;
}

function assertDraftAuthority(
  draft: OzonListingDraft,
  input: AssignHostedSuiteOutputToListingDraftInput,
): OzonListingDraftMediaAssignment[] {
  const selectedSkuKeysValid = validIdentifierArray(sourceListingEditorSkuKeysForDraft(draft), 500);
  const draftValid = draft.id === input.listingWorkflowId
    && draft.ownerUserId === input.ownerUserId
    && draft.shopId === input.shopId
    && isExactIdentifier(draft.supplyGoodsId)
    && draft.revision === input.expectedDraftRevision
    && draft.draftVersion === input.expectedDraftVersion
    && draft.revision < Number.MAX_SAFE_INTEGER
    && draft.draftVersion < Number.MAX_SAFE_INTEGER
    && draft.sourceCaptureSnapshotId === input.sourceCaptureSnapshotId
    && isSha256(draft.sourceCaptureHash)
    && selectedSkuKeysValid
    && input.items.every((item) => sourceListingEditorSkuKeysForDraft(draft).includes(item.skuKey))
    && draft.stage !== 'PUBLISHED'
    && draft.stage !== 'PUBLISH_INTENT_RECORDED'
    && draft.runState !== 'CANCELLED'
    && draft.runState !== 'PERMANENT_FAILURE'
    && isRecord(draft.validation)
    && isRecord(draft.freshness)
    && isRecord(draft.grantRevocation)
    && Array.isArray(draft.auditEvents);
  if (!draftValid) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_DRAFT_STALE',
      409,
      'The listing draft no longer matches the approved hosted plan',
    );
  }
  const assignments = currentAssignments(draft);
  if (input.assignmentStartOrdinal !== assignments.length) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_ORDER_CONFLICT',
      409,
      'Hosted suite outputs may only be appended at the current media tail',
    );
  }
  return assignments;
}

function assertPlanAuthority(
  authority: HostedSuiteListingDraftAssignmentAuthority,
  input: AssignHostedSuiteOutputToListingDraftInput,
) {
  const { draft, plan, planVersion } = authority;
  const binding = plan.listingBinding;
  const valid = plan.id === input.planId
    && plan.ownerUserId === input.ownerUserId
    && plan.actorUserId === input.actorUserId
    && plan.revision === input.expectedPlanRevision
    && plan.contextType === 'collect'
    && plan.contextId === draft.supplyGoodsId
    && plan.currentVersionId === input.planVersionId
    && plan.approvedVersionId === input.planVersionId
    && plan.reviewStatus === 'APPROVED'
    && plan.staleAt === null
    && binding.ownerUserId === input.ownerUserId
    && binding.deviceSessionId === input.deviceSessionId
    && binding.shopId === input.shopId
    && binding.listingWorkflowId === input.listingWorkflowId
    && binding.draftRevision === input.expectedDraftRevision
    && binding.draftVersion === input.expectedDraftVersion
    && binding.sourceCaptureSnapshotId === input.sourceCaptureSnapshotId
    && sameStringArray(binding.selectedSkuKeys, sourceListingEditorSkuKeysForDraft(draft))
    && planVersion.id === input.planVersionId
    && planVersion.planId === input.planId
    && planVersion.ownerUserId === input.ownerUserId
    && isExactIdentifier(planVersion.sourceSubjectId)
    && planVersion.sourceCaptureSnapshotId === input.sourceCaptureSnapshotId
    && planVersion.sourceCaptureHash === draft.sourceCaptureHash;
  if (!valid) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_PLAN_STALE',
      409,
      'The approved hosted plan no longer matches the original listing draft',
    );
  }
}

function assertSuiteAuthority(
  authority: HostedSuiteListingDraftAssignmentAuthority,
  input: AssignHostedSuiteOutputToListingDraftInput,
  now: Date,
) {
  const { draft, planVersion, suite, slots } = authority;
  const valid = suite.id === input.suiteId
    && suite.ownerUserId === input.ownerUserId
    && suite.actorUserId === input.actorUserId
    && suite.planId === input.planId
    && suite.planVersionId === input.planVersionId
    && suite.sourceSubjectId === planVersion.sourceSubjectId
    && suite.sourceCaptureSnapshotId === input.sourceCaptureSnapshotId
    && suite.sourceCaptureHash === draft.sourceCaptureHash
    && suite.contextType === 'collect'
    && suite.contextId === draft.supplyGoodsId
    && ['SUCCEEDED', 'PARTIAL_FAILURE'].includes(suite.status)
    && suite.revision === input.expectedSuiteRevision
    && isExactIdentifier(suite.provider)
    && isExactIdentifier(suite.model)
    && isPositiveInteger(suite.itemCount)
    && suite.itemCount === slots.length
    && isValidDate(suite.completedAt)
    && suite.completedAt.getTime() <= now.getTime()
    && slots.length >= 1
    && slots.length <= MAX_ASSIGNMENTS;
  if (!valid) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_SUITE_STALE',
      409,
      'The hosted suite manifest is not complete and terminal',
    );
  }
  const slotIds = new Set<string>();
  const slotKeys = new Set<string>();
  for (const [ordinal, slot] of slots.entries()) {
    const terminal = ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(slot.suiteSlot.status);
    const exact = slot.planSlot.ordinal === ordinal
      && slot.suiteSlot.ordinal === ordinal
      && slot.planSlot.slotKey === slot.suiteSlot.slotKey
      && slot.planSlot.ownershipLevel === slot.suiteSlot.ownershipLevel
      && slot.planSlot.ownershipKey === slot.suiteSlot.ownershipKey
      && slot.planSlot.compatibilityGroupKey === slot.suiteSlot.compatibilityGroupKey
      && slot.suiteSlot.suiteId === input.suiteId
      && slot.suiteSlot.ownerUserId === input.ownerUserId
      && isExactIdentifier(slot.suiteSlot.id)
      && isExactIdentifier(slot.suiteSlot.slotKey, 1_024)
      && !slotIds.has(slot.suiteSlot.id)
      && !slotKeys.has(slot.suiteSlot.slotKey)
      && terminal
      && (suite.status !== 'SUCCEEDED' || slot.suiteSlot.status === 'SUCCEEDED');
    if (!exact) {
      fail(
        'HOSTED_LISTING_ASSIGNMENT_SUITE_STALE',
        409,
        'The hosted suite manifest has changed or is still running',
      );
    }
    slotIds.add(slot.suiteSlot.id);
    slotKeys.add(slot.suiteSlot.slotKey);
  }
}

function approvedSlots(
  authority: HostedSuiteListingDraftAssignmentAuthority,
  input: AssignHostedSuiteOutputToListingDraftInput,
): Array<{
  requested: AssignHostedSuiteOutputToListingDraftItemInput;
  authority: HostedSuiteListingDraftAssignmentSlotAuthority;
}> {
  const approved = authority.slots.filter((slot) => slot.childWorkflow?.reviewStatus === 'APPROVED');
  if (approved.length !== input.items.length) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_CANDIDATE_SET_MISMATCH',
      409,
      'The request must contain every currently approved hosted output exactly once',
    );
  }
  return approved.map((slot, index) => {
    const requested = input.items[index]!;
    const child = slot.childWorkflow;
    if (requested.suiteSlotId !== slot.suiteSlot.id
      || requested.slotKey !== slot.suiteSlot.slotKey
      || requested.childWorkflowId !== child?.id
      || requested.outputAssetId !== child.selectedOutputAssetId) {
      fail(
        'HOSTED_LISTING_ASSIGNMENT_CANDIDATE_SET_MISMATCH',
        409,
        'Approved hosted outputs must be submitted in immutable suite-slot order',
      );
    }
    return { requested, authority: slot };
  });
}

function assignmentScopeFor(
  slot: HostedSuiteListingDraftAssignmentSlotAuthority,
  item: AssignHostedSuiteOutputToListingDraftItemInput,
  draft: OzonListingDraft,
): HostedSuiteListingDraftAssignmentScope {
  const { planSlot, suiteSlot } = slot;
  if (planSlot.ownershipLevel === 'sku') {
    if (planSlot.ownershipKey !== item.skuKey
      || planSlot.compatibilityGroupKey !== null
      || suiteSlot.compatibilityGroupKey !== null
      || !sameStringArray(planSlot.skuKeys, [item.skuKey])) {
      fail('HOSTED_LISTING_ASSIGNMENT_PLAN_STALE', 409, 'Hosted SKU ownership is invalid');
    }
    return 'SKU';
  }
  if (planSlot.ownershipLevel !== 'compatibility_group'
    || planSlot.compatibilityGroupKey !== planSlot.ownershipKey
    || suiteSlot.compatibilityGroupKey !== planSlot.ownershipKey
    || !validIdentifierArray(planSlot.skuKeys, MAX_ASSIGNMENTS)
    || planSlot.skuKeys.length < 1
    || !planSlot.skuKeys.includes(item.skuKey)
    || !sameSortedStringSet(planSlot.skuKeys, sourceListingEditorSkuKeysForDraft(draft))) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_PLAN_STALE',
      409,
      'Hosted compatibility-group membership is invalid',
    );
  }
  return 'PRODUCT';
}

function assertChildCandidateAuthority(
  slot: HostedSuiteListingDraftAssignmentSlotAuthority,
  item: AssignHostedSuiteOutputToListingDraftItemInput,
  input: AssignHostedSuiteOutputToListingDraftInput,
  scope: HostedSuiteListingDraftAssignmentScope,
  draft: OzonListingDraft,
  now: Date,
) {
  const { suiteSlot, childWorkflow } = slot;
  const inputSnapshots = childWorkflow?.inputSourceCaptureSnapshotIds;
  const valid = suiteSlot.id === item.suiteSlotId
    && suiteSlot.status === 'SUCCEEDED'
    && isPositiveInteger(suiteSlot.attempt)
    && suiteSlot.revision === item.expectedSuiteSlotRevision
    && suiteSlot.childWorkflowId === item.childWorkflowId
    && childWorkflow !== null
    && childWorkflow.id === item.childWorkflowId
    && childWorkflow.ownerUserId === input.ownerUserId
    && childWorkflow.actorUserId === input.actorUserId
    && childWorkflow.status === 'SUCCEEDED'
    && childWorkflow.reviewStatus === 'APPROVED'
    && childWorkflow.revision === item.expectedChildWorkflowRevision
    && childWorkflow.currentAttempt === suiteSlot.attempt
    && childWorkflow.operation === 'IMAGE_TO_IMAGE'
    && childWorkflow.contextType === 'collect'
    && childWorkflow.contextId === draft.supplyGoodsId
    && childWorkflow.contextSkuKey === (scope === 'SKU' ? item.skuKey : null)
    && childWorkflow.contextSlotKey === item.slotKey
    && childWorkflow.selectedOutputAssetId === item.outputAssetId
    && childWorkflow.reviewedByOwnerUserId === input.ownerUserId
    && isValidDate(childWorkflow.reviewedAt)
    && childWorkflow.reviewedAt.getTime() <= now.getTime()
    && Array.isArray(inputSnapshots)
    && inputSnapshots.length > 0
    && inputSnapshots.length <= 16
    && inputSnapshots.every((snapshotId) => snapshotId === input.sourceCaptureSnapshotId);
  if (!valid) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_CANDIDATE_INVALID',
      409,
      'The hosted output is not the current approved candidate for this slot',
    );
  }
}

function assertPaidAttemptAuthority(
  slot: HostedSuiteListingDraftAssignmentSlotAuthority,
  input: AssignHostedSuiteOutputToListingDraftInput,
  suite: HostedSuiteListingDraftAssignmentAuthority['suite'],
  now: Date,
) {
  const {
    suiteSlot,
    childWorkflow,
    currentJob,
    costReservation,
    costSettlement,
  } = slot;
  const fingerprint = currentJob?.requestFingerprint;
  const cost = currentJob?.actualCostMinor;
  const valid = childWorkflow !== null
    && currentJob !== null
    && costReservation !== null
    && costSettlement !== null
    && isExactIdentifier(currentJob.id)
    && currentJob.ownerUserId === input.ownerUserId
    && currentJob.actorUserId === input.actorUserId
    && currentJob.workflowId === childWorkflow.id
    && currentJob.workflowAttempt === suiteSlot.attempt
    && currentJob.workflowAttempt === childWorkflow.currentAttempt
    && currentJob.executionMode === 'ERP_HOSTED'
    && currentJob.status === 'SUCCEEDED'
    && currentJob.operation === childWorkflow.operation
    && currentJob.provider === suite.provider
    && currentJob.model === suite.model
    && isSha256(fingerprint)
    && Number.isSafeInteger(cost)
    && Number(cost) >= 0
    && currentJob.billedUnits === 1
    && currentJob.appliedAt === null
    && isExactIdentifier(costReservation.id)
    && costReservation.ownerUserId === input.ownerUserId
    && costReservation.actorUserId === input.actorUserId
    && costReservation.workflowId === childWorkflow.id
    && costReservation.jobId === currentJob.id
    && costReservation.status === 'SETTLED'
    && costReservation.provider === currentJob.provider
    && costReservation.model === currentJob.model
    && costReservation.operation === currentJob.operation
    && costReservation.requestFingerprint === fingerprint
    && isValidDate(costReservation.settledAt)
    && costReservation.settledAt.getTime() <= now.getTime()
    && isExactIdentifier(costSettlement.id)
    && costSettlement.reservationId === costReservation.id
    && costSettlement.ownerUserId === input.ownerUserId
    && costSettlement.actorUserId === input.actorUserId
    && ['CHARGE', 'RECONCILED_CHARGE'].includes(costSettlement.kind)
    && costSettlement.requestFingerprint === fingerprint
    && costSettlement.actualCostMinor === cost
    && costSettlement.billedUnits === currentJob.billedUnits
    && costReservation.settledAt.getTime() <= childWorkflow.reviewedAt!.getTime();
  if (!valid) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_BILLING_INCOMPLETE',
      409,
      'A current ERP-hosted attempt does not have an exact settled charge',
    );
  }
}

function isExactStorageKey(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 2_000
    && value === value.trim()
    && !hasControlCharacter(value)
    && !hasTransportAuthority(value);
}

function assertOutputAuthority(
  slot: HostedSuiteListingDraftAssignmentSlotAuthority,
  item: AssignHostedSuiteOutputToListingDraftItemInput,
  input: AssignHostedSuiteOutputToListingDraftInput,
) {
  const { suiteSlot, currentJob, outputAsset } = slot;
  const metadata = outputAsset?.metadata;
  const allowedMetadataKeys = [
    'version',
    'suiteId',
    'slotId',
    'attempt',
    'providerOutputAssetId',
    'normalizerVersion',
    'sourceCaptureSnapshotId',
  ];
  const valid = currentJob !== null
    && outputAsset !== null
    && outputAsset.id === item.outputAssetId
    && outputAsset.ownerUserId === input.ownerUserId
    && outputAsset.aiImageJobId === currentJob.id
    && outputAsset.kind === 'AI_GENERATED'
    && outputAsset.sourceCaptureSnapshotId === input.sourceCaptureSnapshotId
    && ['local', 'oss'].includes(outputAsset.storageBackend)
    && isExactStorageKey(outputAsset.storageKey)
    && outputAsset.mimeType === 'image/png'
    && Number.isSafeInteger(outputAsset.sizeBytes)
    && outputAsset.sizeBytes > 0
    && outputAsset.sizeBytes <= AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_INPUT_BYTES
    && outputAsset.width === AI_IMAGE_SUITE_OUTPUT_WIDTH
    && outputAsset.height === AI_IMAGE_SUITE_OUTPUT_HEIGHT
    && isSha256(outputAsset.sha256)
    && isRecord(metadata)
    && Object.keys(metadata).every((key) => allowedMetadataKeys.includes(key))
    && metadata.version === 'ai-image-suite-output/v1'
    && metadata.suiteId === input.suiteId
    && metadata.slotId === item.suiteSlotId
    && metadata.attempt === suiteSlot.attempt
    && isExactIdentifier(metadata.providerOutputAssetId, 500)
    && metadata.providerOutputAssetId !== outputAsset.id
    && admittedAiImageSuiteOutputNormalizer({ provider: currentJob.provider, model: currentJob.model,
      operationConfig: currentJob.operationConfig, providerJobId: currentJob.providerJobId,
      actualCostCents: currentJob.actualCostMinor, ownerUserId: input.ownerUserId, jobId: currentJob.id,
      sourceCaptureSnapshotId: input.sourceCaptureSnapshotId, outputSha256: outputAsset.sha256,
      metadata, rawOutput: slot.rawOutputAsset, allowLegacyUnversioned: true }) !== null
    && (metadata.sourceCaptureSnapshotId === undefined
      || metadata.sourceCaptureSnapshotId === input.sourceCaptureSnapshotId);
  if (!valid) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_CANDIDATE_INVALID',
      409,
      'The approved hosted output is not a normalized ERP-owned asset',
    );
  }
}

function assertAppendOnlyAssignments(
  assignments: OzonListingDraftMediaAssignment[],
  approved: Array<{
    requested: AssignHostedSuiteOutputToListingDraftItemInput;
    authority: HostedSuiteListingDraftAssignmentSlotAuthority;
  }>,
) {
  const slotKeys = new Set(assignments.map((assignment) => assignment.slotKey));
  const assetIds = new Set(assignments.map((assignment) => assignment.assetId));
  for (const { requested } of approved) {
    if (slotKeys.has(requested.slotKey) || assetIds.has(requested.outputAssetId)) {
      fail(
        'HOSTED_LISTING_ASSIGNMENT_SLOT_CONFLICT',
        409,
        'A hosted output or destination slot is already assigned',
      );
    }
    slotKeys.add(requested.slotKey);
    assetIds.add(requested.outputAssetId);
  }
}

function assertUniqueApprovedAuthority(
  approved: Array<{
    authority: HostedSuiteListingDraftAssignmentSlotAuthority;
  }>,
) {
  const identifiers = [
    ['job', approved.map(({ authority }) => authority.currentJob!.id)],
    ['reservation', approved.map(({ authority }) => authority.costReservation!.id)],
    ['settlement', approved.map(({ authority }) => authority.costSettlement!.id)],
    ['asset', approved.map(({ authority }) => authority.outputAsset!.id)],
  ] as const;
  for (const [label, values] of identifiers) {
    if (new Set(values).size !== values.length) {
      fail(
        'HOSTED_LISTING_ASSIGNMENT_CANDIDATE_INVALID',
        409,
        `Approved hosted outputs share one ${label} authority`,
      );
    }
  }
}

function cloneDraft(draft: OzonListingDraft): OzonListingDraft {
  try {
    return JSON.parse(JSON.stringify(draft)) as OzonListingDraft;
  } catch {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_DRAFT_STALE',
      409,
      'The listing draft is not valid immutable JSON',
    );
  }
}

function assignmentHashPayload(
  input: AssignHostedSuiteOutputToListingDraftInput,
  record: Omit<HostedSuiteListingDraftAssignmentRecord, 'assignmentSha256'>,
) {
  return {
    contractVersion: HOSTED_SUITE_LISTING_DRAFT_ASSIGNMENT_VERSION,
    executionMode: 'ERP_HOSTED',
    requestHash: record.requestHash,
    batchId: record.batchId,
    batchItemOrdinal: record.batchItemOrdinal,
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    deviceSessionId: input.deviceSessionId,
    shopId: input.shopId,
    listingWorkflowId: input.listingWorkflowId,
    sourceDraftRevision: input.expectedDraftRevision,
    sourceDraftVersion: input.expectedDraftVersion,
    boundDraftRevision: input.expectedDraftRevision + 1,
    boundDraftVersion: input.expectedDraftVersion + 1,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    assignmentScope: record.assignmentScope,
    skuKey: record.skuKey,
    slotKey: record.slotKey,
    assignmentOrdinal: record.assignmentOrdinal,
    assetId: record.assetId,
    assetSha256: record.assetSha256,
    planId: input.planId,
    planVersionId: input.planVersionId,
    planRevision: input.expectedPlanRevision,
    suiteId: input.suiteId,
    suiteSlotId: record.suiteSlotId,
    childWorkflowId: record.childWorkflowId,
    jobId: record.jobId,
    reservationId: record.reservationId,
    settlementId: record.settlementId,
  };
}

function buildRecord(
  input: AssignHostedSuiteOutputToListingDraftInput,
  requestHash: string,
  authority: HostedSuiteListingDraftAssignmentAuthority,
  slot: HostedSuiteListingDraftAssignmentSlotAuthority,
  item: AssignHostedSuiteOutputToListingDraftItemInput,
  assignmentScope: HostedSuiteListingDraftAssignmentScope,
  batchItemOrdinal: number,
  assignments: OzonListingDraftMediaAssignment[],
  now: Date,
): HostedSuiteListingDraftAssignmentRecord {
  const batchId = `${BATCH_ID_PREFIX}${requestHash.slice(0, 48)}`;
  const base: Omit<HostedSuiteListingDraftAssignmentRecord, 'assignmentSha256'> = {
    contractVersion: HOSTED_SUITE_LISTING_DRAFT_ASSIGNMENT_VERSION,
    batchId,
    batchItemOrdinal,
    assignmentId: `${ASSIGNMENT_ID_PREFIX}${requestHash.slice(0, 40)}:${batchItemOrdinal}`,
    idempotencyKey: input.idempotencyKey,
    requestHash,
    authorityHash: hashJson({
      request: requestHashPayload(input),
      actor: authority.actor,
      deviceSession: authority.deviceSession,
      shop: authority.shop,
      draft: {
        id: authority.draft.id,
        ownerUserId: authority.draft.ownerUserId,
        shopId: authority.draft.shopId,
        supplyGoodsId: authority.draft.supplyGoodsId,
        sourceCaptureSnapshotId: authority.draft.sourceCaptureSnapshotId,
        sourceCaptureHash: authority.draft.sourceCaptureHash,
        selectedSkuKeys: sourceListingEditorSkuKeysForDraft(authority.draft),
        revision: authority.draft.revision,
        draftVersion: authority.draft.draftVersion,
        assignments,
      },
      plan: authority.plan,
      planVersion: authority.planVersion,
      suite: authority.suite,
      slot,
    }),
    ownerUserId: input.ownerUserId,
    actorUserId: input.actorUserId,
    deviceSessionId: input.deviceSessionId,
    shopId: input.shopId,
    listingWorkflowId: input.listingWorkflowId,
    sourceDraftRevision: input.expectedDraftRevision,
    sourceDraftVersion: input.expectedDraftVersion,
    boundDraftRevision: input.expectedDraftRevision + 1,
    boundDraftVersion: input.expectedDraftVersion + 1,
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
    assignmentScope,
    skuKey: item.skuKey,
    slotKey: item.slotKey,
    assignmentOrdinal: input.assignmentStartOrdinal + batchItemOrdinal,
    assetId: item.outputAssetId,
    assetSha256: slot.outputAsset!.sha256!,
    planId: input.planId,
    planVersionId: input.planVersionId,
    planRevision: input.expectedPlanRevision,
    suiteId: input.suiteId,
    suiteSlotId: item.suiteSlotId,
    childWorkflowId: item.childWorkflowId,
    jobId: slot.currentJob!.id,
    reservationId: slot.costReservation!.id,
    settlementId: slot.costSettlement!.id,
    createdAt: now,
  };
  return {
    ...base,
    assignmentSha256: hashJson(assignmentHashPayload(input, base)),
  };
}

function buildNextDraft(
  authority: HostedSuiteListingDraftAssignmentAuthority,
  records: HostedSuiteListingDraftAssignmentRecord[],
): OzonListingDraft {
  const first = records[0]!;
  const next = cloneDraft(authority.draft);
  next.revision = first.boundDraftRevision;
  next.draftVersion = first.boundDraftVersion;
  for (const record of records) {
    next.media.assignments.push(record.assignmentScope === 'PRODUCT'
      ? {
        scope: 'PRODUCT',
        slotKey: record.slotKey,
        assetId: record.assetId,
        source: 'GENERATED',
      }
      : {
        scope: 'SKU',
        skuKey: record.skuKey,
        slotKey: record.slotKey,
        assetId: record.assetId,
        source: 'GENERATED',
      });
  }
  next.validation = { status: 'STALE', report: null };
  next.freshness.media = { state: 'CURRENT', reason: null };
  next.freshness.validation = { state: 'STALE', reason: 'MEDIA_ASSIGNMENT_CHANGED' };
  next.grantRevocation = {
    required: true,
    reason: 'MEDIA_ASSIGNMENT_CHANGED',
    previousShopId: null,
  };
  next.updatedAt = first.createdAt.toISOString();
  next.auditEvents.push({
    id: `hosted-suite-listing-${first.batchId}`,
    type: 'AI_MEDIA_ASSIGNMENT_APPLIED',
    actorUserId: first.actorUserId,
    draftVersion: first.boundDraftVersion,
    occurredAt: first.createdAt.toISOString(),
    details: {
      batchId: first.batchId,
      executionMode: 'ERP_HOSTED',
      requestHash: first.requestHash,
      assignmentCount: records.length,
      assignments: records.map((record) => ({
        assignmentId: record.assignmentId,
        authorityHash: record.authorityHash,
        assignmentSha256: record.assignmentSha256,
        assignmentScope: record.assignmentScope,
        skuKey: record.skuKey,
        slotKey: record.slotKey,
        assignmentOrdinal: record.assignmentOrdinal,
        assetId: record.assetId,
        assetSha256: record.assetSha256,
        suiteSlotId: record.suiteSlotId,
        childWorkflowId: record.childWorkflowId,
        jobId: record.jobId,
        reservationId: record.reservationId,
        settlementId: record.settlementId,
      })),
      planId: first.planId,
      planVersionId: first.planVersionId,
      suiteId: first.suiteId,
      reason: 'MEDIA_ASSIGNMENT_CHANGED',
    },
  });
  return next;
}

function replayMatches(
  batch: HostedSuiteListingDraftAssignmentBatchRecord,
  input: AssignHostedSuiteOutputToListingDraftInput,
  requestHash: string,
): boolean {
  const batchId = `${BATCH_ID_PREFIX}${requestHash.slice(0, 48)}`;
  if (batch.batchId !== batchId
    || batch.requestHash !== requestHash
    || batch.ownerUserId !== input.ownerUserId
    || batch.idempotencyKey !== input.idempotencyKey
    || batch.records.length !== input.items.length) return false;
  return batch.records.every((record, index) => {
    const item = input.items[index]!;
    return record.contractVersion === HOSTED_SUITE_LISTING_DRAFT_ASSIGNMENT_VERSION
      && record.batchId === batchId
      && record.batchItemOrdinal === index
      && record.assignmentId === `${ASSIGNMENT_ID_PREFIX}${requestHash.slice(0, 40)}:${index}`
      && record.idempotencyKey === input.idempotencyKey
      && record.requestHash === requestHash
      && isSha256(record.authorityHash)
      && record.ownerUserId === input.ownerUserId
      && record.actorUserId === input.actorUserId
      && record.deviceSessionId === input.deviceSessionId
      && record.shopId === input.shopId
      && record.listingWorkflowId === input.listingWorkflowId
      && record.sourceDraftRevision === input.expectedDraftRevision
      && record.sourceDraftVersion === input.expectedDraftVersion
      && record.boundDraftRevision === input.expectedDraftRevision + 1
      && record.boundDraftVersion === input.expectedDraftVersion + 1
      && record.sourceCaptureSnapshotId === input.sourceCaptureSnapshotId
      && ['SKU', 'PRODUCT'].includes(record.assignmentScope)
      && record.skuKey === item.skuKey
      && record.slotKey === item.slotKey
      && record.assignmentOrdinal === input.assignmentStartOrdinal + index
      && record.assetId === item.outputAssetId
      && isSha256(record.assetSha256)
      && isSha256(record.assignmentSha256)
      && record.planId === input.planId
      && record.planVersionId === input.planVersionId
      && record.planRevision === input.expectedPlanRevision
      && record.suiteId === input.suiteId
      && record.suiteSlotId === item.suiteSlotId
      && record.childWorkflowId === item.childWorkflowId
      && isExactIdentifier(record.jobId)
      && isExactIdentifier(record.reservationId)
      && isExactIdentifier(record.settlementId)
      && isValidDate(record.createdAt);
  });
}

function replayOrConflict(
  batch: HostedSuiteListingDraftAssignmentBatchRecord,
  input: AssignHostedSuiteOutputToListingDraftInput,
  requestHash: string,
): HostedSuiteListingDraftAssignmentBatchRecord {
  if (!replayMatches(batch, input, requestHash)) {
    fail(
      'HOSTED_LISTING_ASSIGNMENT_IDEMPOTENCY_CONFLICT',
      409,
      'The hosted listing assignment idempotency key was reused',
    );
  }
  return batch;
}

function resultFor(
  batch: HostedSuiteListingDraftAssignmentBatchRecord,
  replayed: boolean,
): HostedSuiteListingDraftAssignmentResult {
  const first = batch.records[0]!;
  return {
    contractVersion: HOSTED_SUITE_LISTING_DRAFT_ASSIGNMENT_VERSION,
    batchId: batch.batchId,
    replayed,
    shopId: first.shopId,
    listingWorkflowId: first.listingWorkflowId,
    sourceDraftRevision: first.sourceDraftRevision,
    sourceDraftVersion: first.sourceDraftVersion,
    boundDraftRevision: first.boundDraftRevision,
    boundDraftVersion: first.boundDraftVersion,
    assignments: batch.records.map((record) => ({
      assignmentId: record.assignmentId,
      skuKey: record.skuKey,
      slotKey: record.slotKey,
      assignmentScope: record.assignmentScope,
      assignmentOrdinal: record.assignmentOrdinal,
      assetId: record.assetId,
    })),
    validationStatus: 'STALE',
    publishReadiness: 'STALE',
  };
}

function commitInput(
  input: AssignHostedSuiteOutputToListingDraftInput,
  requestHash: string,
  authority: HostedSuiteListingDraftAssignmentAuthority,
  assignments: OzonListingDraftMediaAssignment[],
  approved: Array<{
    requested: AssignHostedSuiteOutputToListingDraftItemInput;
    authority: HostedSuiteListingDraftAssignmentSlotAuthority;
    assignmentScope: HostedSuiteListingDraftAssignmentScope;
  }>,
  now: Date,
): HostedSuiteListingDraftAssignmentCommitInput {
  const records = approved.map((item, index) => buildRecord(
    input,
    requestHash,
    authority,
    item.authority,
    item.requested,
    item.assignmentScope,
    index,
    assignments,
    now,
  ));
  const batchId = records[0]!.batchId;
  return {
    idempotencyKey: input.idempotencyKey,
    requestHash,
    batchId,
    appliedAt: now,
    records,
    nextDraft: buildNextDraft(authority, records),
    expected: {
      ownerUserId: input.ownerUserId,
      actorUserId: input.actorUserId,
      deviceSessionId: input.deviceSessionId,
      shopId: input.shopId,
      listingWorkflowId: input.listingWorkflowId,
      draftRevision: input.expectedDraftRevision,
      draftVersion: input.expectedDraftVersion,
      sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
      sourceCaptureHash: authority.draft.sourceCaptureHash,
      assignmentStartOrdinal: input.assignmentStartOrdinal,
      planId: input.planId,
      planVersionId: input.planVersionId,
      planRevision: authority.plan.revision,
      suiteId: input.suiteId,
      suiteRevision: input.expectedSuiteRevision,
      items: approved.map(({ requested, authority: slot, assignmentScope }, index) => ({
        batchItemOrdinal: index,
        assignmentScope,
        skuKey: requested.skuKey,
        slotKey: requested.slotKey,
        assignmentOrdinal: input.assignmentStartOrdinal + index,
        planSlotOrdinal: slot.planSlot.ordinal,
        suiteSlotId: requested.suiteSlotId,
        suiteSlotRevision: requested.expectedSuiteSlotRevision,
        childWorkflowId: requested.childWorkflowId,
        childWorkflowRevision: requested.expectedChildWorkflowRevision,
        childWorkflowAttempt: slot.childWorkflow!.currentAttempt,
        jobId: slot.currentJob!.id,
        outputAssetId: requested.outputAssetId,
        reservationId: slot.costReservation!.id,
        settlementId: slot.costSettlement!.id,
        requestFingerprint: slot.currentJob!.requestFingerprint!,
        actualCostMinor: slot.currentJob!.actualCostMinor!,
        billedUnits: slot.currentJob!.billedUnits,
        assetSha256: slot.outputAsset!.sha256!,
      })),
    },
  };
}

export function createHostedSuiteListingDraftAssignmentService(
  repository: HostedSuiteListingDraftAssignmentRepository,
  options: { now?: () => Date } = {},
) {
  const clock = options.now || (() => new Date());
  return {
    async assign(
      rawInput: AssignHostedSuiteOutputToListingDraftInput,
    ): Promise<HostedSuiteListingDraftAssignmentResult> {
      const input = normalizeInput(rawInput);
      const requestHash = hashJson(requestHashPayload(input));
      return repository.transaction(async (transaction) => {
        const existing = await transaction.findReplay({
          ownerUserId: input.ownerUserId,
          idempotencyKey: input.idempotencyKey,
        });
        if (existing) {
          return resultFor(replayOrConflict(existing, input, requestHash), true);
        }

        const now = clock();
        if (!isValidDate(now)) throw new Error('Hosted listing assignment clock is invalid');
        const authority = await transaction.loadAuthority(input);
        if (!authority) {
          fail(
            'HOSTED_LISTING_ASSIGNMENT_NOT_FOUND',
            404,
            'The hosted suite listing assignment authority was not found',
          );
        }

        assertCallerAuthority(authority, input, now);
        const assignments = assertDraftAuthority(authority.draft, input);
        assertPlanAuthority(authority, input);
        assertSuiteAuthority(authority, input, now);
        const approved = approvedSlots(authority, input).map(({ requested, authority: slot }) => {
          const assignmentScope = assignmentScopeFor(slot, requested, authority.draft);
          assertChildCandidateAuthority(
            slot,
            requested,
            input,
            assignmentScope,
            authority.draft,
            now,
          );
          assertPaidAttemptAuthority(slot, input, authority.suite, now);
          assertOutputAuthority(slot, requested, input);
          return { requested, authority: slot, assignmentScope };
        });
        assertUniqueApprovedAuthority(approved);
        assertAppendOnlyAssignments(assignments, approved);

        const prepared = commitInput(input, requestHash, authority, assignments, approved, now);
        const committed = await transaction.commit(prepared);
        if (committed.kind === 'cas-conflict') {
          fail(
            'HOSTED_LISTING_ASSIGNMENT_CAS_CONFLICT',
            409,
            'The listing draft or hosted authority changed during assignment',
          );
        }
        if (committed.kind === 'idempotency-conflict') {
          fail(
            'HOSTED_LISTING_ASSIGNMENT_IDEMPOTENCY_CONFLICT',
            409,
            'The hosted listing assignment idempotency key was reused',
          );
        }
        const batch = replayOrConflict(committed.batch, input, requestHash);
        return resultFor(batch, committed.kind === 'replayed');
      });
    },
  };
}

export type HostedSuiteListingDraftAssignmentService = ReturnType<
  typeof createHostedSuiteListingDraftAssignmentService
>;
import { sourceListingEditorSkuKeysForDraft } from './source-listing-sku-copies.js';

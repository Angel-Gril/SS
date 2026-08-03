import { createHash, randomUUID } from 'node:crypto';
import type { ExtensionByokReadinessBinding } from './extension-byok-readiness-attestation.js';
import {
  canonicalizeExtensionByokProviderOrigin,
  EXTENSION_BYOK_READINESS_VERSION,
  type ExtensionByokOperation,
  type ExtensionByokReadinessDecision,
} from './extension-byok-policy.js';
import type {
  ExtensionByokExecutionIntentIdentity,
  ExtensionByokExecutionIntentRecord,
  ExtensionByokExecutionRequestMode,
} from './extension-byok-execution-intent.js';
import {
  EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
  resolveExtensionByokWorkbenchSlotTarget,
  type ExtensionByokWorkbenchDraft,
} from './extension-byok-workbench-launch.js';
import { containsSecretBearingIdentifier } from './extension-byok-media-provenance.js';

export const EXTENSION_BYOK_EXECUTION_BATCH_VERSION =
  'extension-byok-execution-batch/v1' as const;
export const EXTENSION_BYOK_EXECUTION_BATCH_STATUS_VERSION =
  'extension-byok-execution-batch-status/v1' as const;
export const EXTENSION_BYOK_EXECUTION_BATCH_STATUS_VERSION_V2 =
  'extension-byok-execution-batch-status/v2' as const;
export const EXTENSION_BYOK_EXECUTION_BATCH_REQUEST_VERSION =
  'extension-byok-execution-batch-request/v1' as const;
export const EXTENSION_BYOK_EXECUTION_BATCH_ATTEMPT_REQUEST_VERSION =
  'extension-byok-execution-batch-attempt-request/v1' as const;
export const EXTENSION_BYOK_EXECUTION_BATCH_ATTEMPT_VERSION =
  'extension-byok-execution-batch-attempt/v1' as const;
export const EXTENSION_BYOK_EXECUTION_BATCH_CANCEL_REQUEST_VERSION =
  'extension-byok-execution-batch-cancel-request/v1' as const;
export const EXTENSION_BYOK_EXECUTION_BATCH_CANCEL_VERSION =
  'extension-byok-execution-batch-cancel/v1' as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const REQUEST_MODES = new Set<ExtensionByokExecutionRequestMode>(['json', 'multipart']);
const MAX_ITEMS = 4;

export type ExtensionByokExecutionBatchErrorCode =
  | 'BYOK_EXECUTION_BATCH_INVALID_REQUEST'
  | 'BYOK_EXECUTION_BATCH_FORBIDDEN'
  | 'BYOK_EXECUTION_BATCH_CONTEXT_STALE'
  | 'BYOK_EXECUTION_BATCH_POLICY_UNAVAILABLE'
  | 'BYOK_EXECUTION_BATCH_POLICY_DISABLED'
  | 'BYOK_EXECUTION_BATCH_MODE_CONFLICT'
  | 'BYOK_EXECUTION_BATCH_IDEMPOTENCY_CONFLICT'
  | 'BYOK_EXECUTION_BATCH_RESERVATION_CONFLICT'
  | 'BYOK_EXECUTION_BATCH_NOT_FOUND'
  | 'BYOK_EXECUTION_BATCH_STATE_CONFLICT'
  | 'BYOK_EXECUTION_BATCH_ATTEMPT_BLOCKED'
  | 'BYOK_EXECUTION_BATCH_CAPACITY_EXCEEDED'
  | 'BYOK_EXECUTION_BATCH_UNAVAILABLE';

export class ExtensionByokExecutionBatchError extends Error {
  constructor(
    public readonly code: ExtensionByokExecutionBatchErrorCode,
    public readonly statusCode: 400 | 403 | 404 | 409 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionByokExecutionBatchError';
  }
}

export interface ExtensionByokExecutionBatchItemClaimInput {
  binding: ExtensionByokReadinessBinding;
  requestMode: ExtensionByokExecutionRequestMode;
  providerIdempotencyKey: string;
  providerRequestHash: string;
}

export interface ExtensionByokExecutionBatchClaimInput {
  identity: ExtensionByokExecutionIntentIdentity;
  idempotencyKey: string;
  items: ExtensionByokExecutionBatchItemClaimInput[];
}

export interface ExtensionByokExecutionBatchSuccessorClaimInput {
  identity: ExtensionByokExecutionIntentIdentity;
  batchId: string;
  itemIndex: number;
  currentIntentId: string;
  providerChargeConfirmed: true;
  item: ExtensionByokExecutionBatchItemClaimInput;
}

export interface ExtensionByokExecutionBatchCancelInput {
  identity: ExtensionByokExecutionIntentIdentity;
  batchId: string;
}

export interface ExtensionByokExecutionBatchStatusInput {
  identity: ExtensionByokExecutionIntentIdentity;
  batchId: string;
}

export interface ExtensionByokExecutionBatchIdempotencyStatusInput {
  identity: ExtensionByokExecutionIntentIdentity;
  idempotencyKey: string;
}

export interface ExtensionByokExecutionBatchRecord {
  id: string;
  contractVersion: typeof EXTENSION_BYOK_EXECUTION_BATCH_VERSION;
  status: 'OPEN' | 'BOUND' | 'CANCELLED';
  ownerUserId: string;
  actorUserId: string;
  deviceSessionId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
  sourcePlatform: '1688' | 'pdd' | 'taobao' | 'tmall';
  sourceProductId: string;
  sourceCaptureSnapshotId: string;
  supplyGoodsId: string;
  firstAssignmentOrdinal: number;
  itemCount: number;
  idempotencyKey: string;
  requestHash: string;
  boundDraftRevision: number | null;
  boundDraftVersion: number | null;
  boundAt: Date | null;
  cancelledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtensionByokExecutionBatchItemRecord {
  id: string;
  batchId: string;
  ownerUserId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
  itemIndex: number;
  skuKey: string;
  slotKey: string;
  assignmentOrdinal: number;
  status: 'ACTIVE' | 'BOUND' | 'RELEASED';
  boundAt: Date | null;
  releasedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtensionByokExecutionBatchCreateRecord {
  batch: ExtensionByokExecutionBatchRecord;
  items: ExtensionByokExecutionBatchItemRecord[];
  intents: ExtensionByokExecutionIntentRecord[];
}

export interface ExtensionByokExecutionBatchLoadedItem {
  item: ExtensionByokExecutionBatchItemRecord;
  intent: ExtensionByokExecutionIntentRecord;
}

export type ExtensionByokExecutionBatchLoadResult =
  | {
    kind: 'found';
    batch: ExtensionByokExecutionBatchRecord;
    items: ExtensionByokExecutionBatchLoadedItem[];
  }
  | { kind: 'not_found' }
  | { kind: 'forbidden' };

export type ExtensionByokExecutionBatchClaimResult =
  | {
    kind: 'created' | 'replayed';
    batch: ExtensionByokExecutionBatchRecord;
    intents: ExtensionByokExecutionIntentRecord[];
  }
  | {
    kind:
      | 'forbidden'
      | 'stale'
      | 'mode_conflict'
      | 'idempotency_conflict'
      | 'reservation_conflict'
      | 'capacity_exceeded';
  };

export type ExtensionByokExecutionBatchSuccessorClaimResult =
  | {
    kind: 'created' | 'replayed';
    batch: ExtensionByokExecutionBatchRecord;
    intent: ExtensionByokExecutionIntentRecord;
  }
  | {
    kind:
      | 'not_found'
      | 'forbidden'
      | 'stale'
      | 'state_conflict'
      | 'attempt_blocked'
      | 'idempotency_conflict'
      | 'capacity_exceeded';
  };

export type ExtensionByokExecutionBatchCancelResult =
  | { kind: 'cancelled' | 'replayed'; batch: ExtensionByokExecutionBatchRecord }
  | { kind: 'not_found' | 'forbidden' | 'state_conflict' | 'attempt_blocked' };

export interface ExtensionByokExecutionBatchRepository {
  loadBatchStateByIdempotency(input: {
    identity: ExtensionByokExecutionIntentIdentity;
    idempotencyKey: string;
  }): Promise<ExtensionByokExecutionBatchLoadResult>;
  loadBatchState(input: {
    identity: ExtensionByokExecutionIntentIdentity;
    batchId: string;
  }): Promise<ExtensionByokExecutionBatchLoadResult>;
  claimBatch(input: ExtensionByokExecutionBatchCreateRecord):
  Promise<ExtensionByokExecutionBatchClaimResult>;
  claimSuccessor(input: {
    identity: ExtensionByokExecutionIntentIdentity;
    batchId: string;
    itemIndex: number;
    currentIntentId: string;
    intent: ExtensionByokExecutionIntentRecord;
  }): Promise<ExtensionByokExecutionBatchSuccessorClaimResult>;
  cancelBatch(input: {
    identity: ExtensionByokExecutionIntentIdentity;
    batchId: string;
    now: Date;
  }): Promise<ExtensionByokExecutionBatchCancelResult>;
}

interface AuthorityOptions {
  loadShop(input: { shopId: string; ownerUserId: string }): Promise<{
    id: string;
    userId: string;
    platform: string;
    status: string;
  } | null>;
  loadDraft(input: { workflowId: string; ownerUserId: string }): Promise<
  ExtensionByokWorkbenchDraft | null>;
  evaluatePolicy(input: {
    ownerUserId: string;
    shopId: string;
    deviceSessionId: string;
    providerOrigin: string;
    operation: ExtensionByokOperation;
  }): Promise<ExtensionByokReadinessDecision>;
}

export interface ExtensionByokExecutionBatchServiceOptions extends AuthorityOptions {
  repository: ExtensionByokExecutionBatchRepository;
  createId?: () => string;
  now?: () => Date;
}

function fail(
  code: ExtensionByokExecutionBatchErrorCode,
  statusCode: 400 | 403 | 404 | 409 | 503,
  message: string,
): never {
  throw new ExtensionByokExecutionBatchError(code, statusCode, message);
}

function identifier(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value !== value.normalize('NFKC').trim()
    // eslint-disable-next-line no-control-regex
    || /[\u0000-\u001f\u007f]/u.test(value)
    || containsSecretBearingIdentifier(value)) {
    return fail('BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400, `${field} is invalid`);
  }
  return value;
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    return fail('BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400, `${field} is invalid`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    return fail('BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400, `${field} is invalid`);
  }
  return Number(value);
}

function ordinal(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 499) {
    return fail('BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400, `${field} is invalid`);
  }
  return Number(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  const row = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(row).sort().map((key) => [key, canonical(row[key])]));
}

function operationHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function textHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function identity(value: ExtensionByokExecutionIntentIdentity): ExtensionByokExecutionIntentIdentity {
  const normalized = {
    ownerUserId: identifier(value?.ownerUserId, 'ownerUserId'),
    actorUserId: identifier(value?.actorUserId, 'actorUserId'),
    deviceSessionId: identifier(value?.deviceSessionId, 'deviceSessionId'),
  };
  if (normalized.ownerUserId !== normalized.actorUserId) {
    return fail('BYOK_EXECUTION_BATCH_FORBIDDEN', 403, 'BYOK execution requires an owner device');
  }
  return normalized;
}

function sameIdentity(
  record: ExtensionByokExecutionBatchRecord,
  value: ExtensionByokExecutionIntentIdentity,
): boolean {
  return record.ownerUserId === value.ownerUserId
    && record.actorUserId === value.actorUserId
    && record.deviceSessionId === value.deviceSessionId;
}

function normalizeItem(value: ExtensionByokExecutionBatchItemClaimInput) {
  const binding = value?.binding;
  if (!binding
    || binding.contractVersion !== 'extension-byok-readiness-binding/v2'
    || binding.workflowId === null
    || binding.draftRevision === null
    || binding.draftVersion === null
    || binding.sourcePlatform === null
    || binding.sourceProductId === null
    || binding.sourceCaptureSnapshotId === null
    || binding.supplyGoodsId === null
    || binding.skuKey === null
    || binding.slotKey === null
    || binding.assignmentMode !== 'APPEND'
    || binding.assignmentOrdinal === null
    || !['1688', 'pdd', 'taobao', 'tmall'].includes(binding.sourcePlatform)
    || !['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(binding.operation)) {
    return fail('BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400, 'readiness binding is invalid');
  }
  let providerOrigin: string;
  try {
    providerOrigin = canonicalizeExtensionByokProviderOrigin(binding.providerOrigin);
  } catch {
    return fail('BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400, 'provider origin is invalid');
  }
  const normalizedBinding = {
    contractVersion: binding.contractVersion,
    ownerUserId: identifier(binding.ownerUserId, 'binding.ownerUserId'),
    deviceSessionId: identifier(binding.deviceSessionId, 'binding.deviceSessionId'),
    shopId: identifier(binding.shopId, 'binding.shopId'),
    workflowId: identifier(binding.workflowId, 'binding.workflowId'),
    draftRevision: positiveInteger(binding.draftRevision, 'binding.draftRevision'),
    draftVersion: positiveInteger(binding.draftVersion, 'binding.draftVersion'),
    sourcePlatform: binding.sourcePlatform as '1688' | 'pdd' | 'taobao' | 'tmall',
    sourceProductId: identifier(binding.sourceProductId, 'binding.sourceProductId'),
    sourceCaptureSnapshotId: identifier(
      binding.sourceCaptureSnapshotId,
      'binding.sourceCaptureSnapshotId',
    ),
    supplyGoodsId: identifier(binding.supplyGoodsId, 'binding.supplyGoodsId'),
    skuKey: identifier(binding.skuKey, 'binding.skuKey', 500),
    slotKey: identifier(binding.slotKey, 'binding.slotKey'),
    assignmentMode: 'APPEND' as const,
    assignmentOrdinal: ordinal(binding.assignmentOrdinal, 'binding.assignmentOrdinal'),
    providerOrigin,
    model: identifier(binding.model, 'binding.model'),
    operation: binding.operation as ExtensionByokOperation,
    policyRevision: positiveInteger(Number(binding.policyRevision), 'binding.policyRevision'),
  };
  if (!REQUEST_MODES.has(value.requestMode)
    || value.requestMode !== (normalizedBinding.operation === 'TEXT_TO_IMAGE' ? 'json' : 'multipart')) {
    return fail('BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400, 'requestMode is invalid');
  }
  const providerIdempotencyKey = identifier(
    value.providerIdempotencyKey,
    'providerIdempotencyKey',
  );
  if (providerIdempotencyKey.length < 16) {
    return fail('BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400, 'providerIdempotencyKey is invalid');
  }
  return {
    binding: normalizedBinding,
    requestMode: value.requestMode,
    providerIdempotencyKey,
    providerRequestHash: sha256(value.providerRequestHash, 'providerRequestHash'),
  };
}

type NormalizedItem = ReturnType<typeof normalizeItem>;

function sameContext(first: NormalizedItem, item: NormalizedItem): boolean {
  const left = first.binding;
  const right = item.binding;
  return [
    'ownerUserId', 'deviceSessionId', 'shopId', 'workflowId', 'draftRevision', 'draftVersion',
    'sourcePlatform', 'sourceProductId', 'sourceCaptureSnapshotId', 'supplyGoodsId',
  ].every((key) => left[key as keyof typeof left] === right[key as keyof typeof right]);
}

function createIntent(input: {
  id: string;
  identity: ExtensionByokExecutionIntentIdentity;
  item: NormalizedItem;
  createdAt: Date;
  executionBatchItemId: string | null;
  executionBatchAttemptIndex: number | null;
}): ExtensionByokExecutionIntentRecord {
  const { binding } = input.item;
  const requestIdentity = {
    contractVersion: 'extension-byok-execution-intent/v1' as const,
    executionMode: 'BYOK' as const,
    ...input.identity,
    shopId: binding.shopId,
    listingWorkflowId: binding.workflowId,
    draftRevision: binding.draftRevision,
    draftVersion: binding.draftVersion,
    sourceCaptureSnapshotId: binding.sourceCaptureSnapshotId,
    supplyGoodsId: binding.supplyGoodsId,
    skuKey: binding.skuKey,
    slotKey: binding.slotKey,
    assignmentMode: binding.assignmentMode,
    assignmentOrdinal: binding.assignmentOrdinal,
    policyRevision: binding.policyRevision,
    providerOriginSha256: textHash(binding.providerOrigin),
    model: binding.model,
    operation: binding.operation,
    requestMode: input.item.requestMode,
    providerIdempotencyKey: input.item.providerIdempotencyKey,
    providerRequestHash: input.item.providerRequestHash,
  };
  return {
    id: identifier(input.id, 'intentId'),
    ...requestIdentity,
    requestHash: operationHash(requestIdentity),
    executionBatchItemId: input.executionBatchItemId,
    executionBatchAttemptIndex: input.executionBatchAttemptIndex,
    outcome: 'PENDING',
    providerRequestIdSha256: null,
    resultSha256: null,
    outcomeUpdatedAt: null,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

function validatePolicy(
  value: ExtensionByokReadinessDecision,
  ownerIdentity: ExtensionByokExecutionIntentIdentity,
  item: NormalizedItem,
): void {
  const { binding } = item;
  if (!value
    || value.contractVersion !== EXTENSION_BYOK_READINESS_VERSION
    || value.context.ownerUserId !== ownerIdentity.ownerUserId
    || value.context.shopId !== binding.shopId
    || value.context.deviceSessionId !== ownerIdentity.deviceSessionId
    || value.context.providerOrigin !== binding.providerOrigin
    || value.context.operation !== binding.operation
    || !Number.isSafeInteger(value.policyRevision)) {
    return fail('BYOK_EXECUTION_BATCH_POLICY_UNAVAILABLE', 503, 'BYOK policy is unavailable');
  }
  if (value.capabilities.generation.ready !== true
    || value.policyRevision !== binding.policyRevision) {
    return fail('BYOK_EXECUTION_BATCH_POLICY_DISABLED', 409, 'BYOK policy is disabled or changed');
  }
}

function validateShop(
  shop: Awaited<ReturnType<AuthorityOptions['loadShop']>>,
  ownerIdentity: ExtensionByokExecutionIntentIdentity,
  shopId: string,
): void {
  if (!shop
    || shop.id !== shopId
    || shop.userId !== ownerIdentity.ownerUserId
    || shop.platform !== 'OZON'
    || shop.status !== 'ACTIVE') {
    return fail('BYOK_EXECUTION_BATCH_FORBIDDEN', 403, 'shop is unavailable');
  }
}

function validateTargets(
  draft: ExtensionByokWorkbenchDraft,
  ownerUserId: string,
  items: NormalizedItem[],
): void {
  const working = structuredClone(draft);
  for (let index = 0; index < items.length; index += 1) {
    const { binding } = items[index]!;
    try {
      resolveExtensionByokWorkbenchSlotTarget({
        ownerUserId,
        request: {
          contractVersion: EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
          sourcePlatform: binding.sourcePlatform,
          sourceProductId: binding.sourceProductId,
          sourceCaptureSnapshotId: binding.sourceCaptureSnapshotId,
          supplyGoodsId: binding.supplyGoodsId,
          shopId: binding.shopId,
          workflowId: binding.workflowId,
          draftRevision: binding.draftRevision,
          draftVersion: binding.draftVersion,
        },
        draft: working,
        target: {
          skuKey: binding.skuKey,
          slotKey: binding.slotKey,
          assignmentMode: 'APPEND',
          assignmentOrdinal: binding.assignmentOrdinal,
        },
      });
    } catch {
      return fail('BYOK_EXECUTION_BATCH_CONTEXT_STALE', 409, 'listing slot reservation is stale');
    }
    const assignment = binding.slotKey === `sku:${binding.skuKey}:hero`
      ? {
        scope: 'SKU' as const,
        skuKey: binding.skuKey,
        slotKey: binding.slotKey,
        assetId: `byok-reservation-${index}`,
        source: 'GENERATED' as const,
      }
      : {
        scope: 'PRODUCT' as const,
        slotKey: binding.slotKey,
        assetId: `byok-reservation-${index}`,
        source: 'GENERATED' as const,
      };
    working.media.assignments.push(assignment);
  }
}

function mapClaimFailure(kind: Exclude<ExtensionByokExecutionBatchClaimResult['kind'],
  'created' | 'replayed'>): never {
  const errors: Record<typeof kind, [ExtensionByokExecutionBatchErrorCode, 403 | 409, string]> = {
    forbidden: ['BYOK_EXECUTION_BATCH_FORBIDDEN', 403, 'device authority changed'],
    stale: ['BYOK_EXECUTION_BATCH_CONTEXT_STALE', 409, 'listing draft changed'],
    mode_conflict: ['BYOK_EXECUTION_BATCH_MODE_CONFLICT', 409, 'draft is locked to hosted mode'],
    idempotency_conflict: ['BYOK_EXECUTION_BATCH_IDEMPOTENCY_CONFLICT', 409, 'batch identity conflicts'],
    reservation_conflict: ['BYOK_EXECUTION_BATCH_RESERVATION_CONFLICT', 409, 'slot is already reserved'],
    capacity_exceeded: ['BYOK_EXECUTION_BATCH_CAPACITY_EXCEEDED', 409, 'attempt capacity exceeded'],
  };
  const [code, status, message] = errors[kind];
  return fail(code, status, message);
}

function resolveLoadedBatch(
  result: ExtensionByokExecutionBatchLoadResult,
  ownerIdentity: ExtensionByokExecutionIntentIdentity,
  expected: { batchId?: string; idempotencyKey?: string },
) {
  if (result.kind === 'not_found') {
    return fail('BYOK_EXECUTION_BATCH_NOT_FOUND', 404, 'batch reservation was not found');
  }
  if (result.kind === 'forbidden' || !sameIdentity(result.batch, ownerIdentity)) {
    return fail('BYOK_EXECUTION_BATCH_FORBIDDEN', 403, 'batch reservation is forbidden');
  }
  if ((expected.batchId !== undefined && result.batch.id !== expected.batchId)
    || (expected.idempotencyKey !== undefined
      && result.batch.idempotencyKey !== expected.idempotencyKey)
    || !Array.isArray(result.items)
    || result.items.some(({ intent }) => (
      intent.outcome === 'SUCCEEDED'
        ? typeof intent.resultSha256 !== 'string' || !HASH_PATTERN.test(intent.resultSha256)
        : intent.resultSha256 !== null
    ))) {
    return fail('BYOK_EXECUTION_BATCH_UNAVAILABLE', 503, 'batch recovery is unavailable');
  }
  return { batch: result.batch, items: result.items };
}

export function createExtensionByokExecutionBatchService(
  options: ExtensionByokExecutionBatchServiceOptions,
) {
  const createId = options.createId || randomUUID;
  const now = options.now || (() => new Date());
  return {
    async getStatusByIdempotencyKey(
      rawInput: ExtensionByokExecutionBatchIdempotencyStatusInput,
    ) {
      const ownerIdentity = identity(rawInput.identity);
      const idempotencyKey = identifier(rawInput.idempotencyKey, 'idempotencyKey');
      if (idempotencyKey.length < 16) {
        return fail('BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400, 'idempotencyKey is invalid');
      }
      let result: ExtensionByokExecutionBatchLoadResult;
      try {
        result = await options.repository.loadBatchStateByIdempotency({
          identity: ownerIdentity,
          idempotencyKey,
        });
      } catch {
        return fail('BYOK_EXECUTION_BATCH_UNAVAILABLE', 503, 'batch recovery is unavailable');
      }
      if (result.kind === 'forbidden') result = { kind: 'not_found' };
      return resolveLoadedBatch(result, ownerIdentity, { idempotencyKey });
    },

    async getStatus(rawInput: ExtensionByokExecutionBatchStatusInput) {
      const ownerIdentity = identity(rawInput.identity);
      const batchId = identifier(rawInput.batchId, 'batchId');
      let result: ExtensionByokExecutionBatchLoadResult;
      try {
        result = await options.repository.loadBatchState({
          identity: ownerIdentity,
          batchId,
        });
      } catch {
        return fail('BYOK_EXECUTION_BATCH_UNAVAILABLE', 503, 'batch recovery is unavailable');
      }
      return resolveLoadedBatch(result, ownerIdentity, { batchId });
    },

    async claim(rawInput: ExtensionByokExecutionBatchClaimInput) {
      const ownerIdentity = identity(rawInput.identity);
      const idempotencyKey = identifier(rawInput.idempotencyKey, 'idempotencyKey');
      if (idempotencyKey.length < 16
        || !Array.isArray(rawInput.items)
        || rawInput.items.length < 1
        || rawInput.items.length > MAX_ITEMS) {
        return fail('BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400, 'batch request is invalid');
      }
      const items = rawInput.items.map(normalizeItem);
      const first = items[0]!;
      if (items.some((item) => !sameContext(first, item))
        || first.binding.ownerUserId !== ownerIdentity.ownerUserId
        || first.binding.deviceSessionId !== ownerIdentity.deviceSessionId
        || items.some((item, index) => (
          item.binding.assignmentOrdinal !== first.binding.assignmentOrdinal + index
        ))) {
        return fail('BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400, 'batch context is inconsistent');
      }
      for (const values of [
        items.map((item) => item.binding.slotKey),
        items.map((item) => item.providerIdempotencyKey),
        items.map((item) => item.providerRequestHash),
      ]) {
        if (new Set(values).size !== values.length) {
          return fail('BYOK_EXECUTION_BATCH_INVALID_REQUEST', 400, 'batch identities must be unique');
        }
      }
      const createdAt = now();
      if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
        return fail('BYOK_EXECUTION_BATCH_UNAVAILABLE', 503, 'clock is unavailable');
      }
      let shop: Awaited<ReturnType<AuthorityOptions['loadShop']>>;
      let draft: ExtensionByokWorkbenchDraft | null;
      let policies: ExtensionByokReadinessDecision[];
      try {
        [shop, draft, policies] = await Promise.all([
          options.loadShop({
            shopId: first.binding.shopId,
            ownerUserId: ownerIdentity.ownerUserId,
          }),
          options.loadDraft({
            workflowId: first.binding.workflowId,
            ownerUserId: ownerIdentity.ownerUserId,
          }),
          Promise.all(items.map((item) => options.evaluatePolicy({
            ownerUserId: ownerIdentity.ownerUserId,
            shopId: item.binding.shopId,
            deviceSessionId: ownerIdentity.deviceSessionId,
            providerOrigin: item.binding.providerOrigin,
            operation: item.binding.operation,
          }))),
        ]);
      } catch {
        return fail('BYOK_EXECUTION_BATCH_UNAVAILABLE', 503, 'batch authority is unavailable');
      }
      validateShop(shop, ownerIdentity, first.binding.shopId);
      if (!draft) return fail('BYOK_EXECUTION_BATCH_CONTEXT_STALE', 409, 'listing draft is stale');
      items.forEach((item, index) => validatePolicy(policies[index]!, ownerIdentity, item));
      validateTargets(draft, ownerIdentity.ownerUserId, items);

      const batchId = identifier(createId(), 'batchId');
      const itemRecords = items.map((item, index): ExtensionByokExecutionBatchItemRecord => ({
        id: identifier(createId(), 'batchItemId'),
        batchId,
        ownerUserId: ownerIdentity.ownerUserId,
        listingWorkflowId: first.binding.workflowId,
        draftRevision: first.binding.draftRevision,
        draftVersion: first.binding.draftVersion,
        itemIndex: index,
        skuKey: item.binding.skuKey,
        slotKey: item.binding.slotKey,
        assignmentOrdinal: item.binding.assignmentOrdinal,
        status: 'ACTIVE',
        boundAt: null,
        releasedAt: null,
        createdAt,
        updatedAt: createdAt,
      }));
      const intents = items.map((item, index) => createIntent({
        id: createId(),
        identity: ownerIdentity,
        item,
        createdAt,
        executionBatchItemId: itemRecords[index]!.id,
        executionBatchAttemptIndex: 0,
      }));
      const requestIdentity = {
        contractVersion: EXTENSION_BYOK_EXECUTION_BATCH_VERSION,
        ownerUserId: ownerIdentity.ownerUserId,
        actorUserId: ownerIdentity.actorUserId,
        deviceSessionId: ownerIdentity.deviceSessionId,
        shopId: first.binding.shopId,
        listingWorkflowId: first.binding.workflowId,
        draftRevision: first.binding.draftRevision,
        draftVersion: first.binding.draftVersion,
        sourcePlatform: first.binding.sourcePlatform,
        sourceProductId: first.binding.sourceProductId,
        sourceCaptureSnapshotId: first.binding.sourceCaptureSnapshotId,
        supplyGoodsId: first.binding.supplyGoodsId,
        firstAssignmentOrdinal: first.binding.assignmentOrdinal,
        itemCount: items.length,
        idempotencyKey,
        items: intents.map((intent) => intent.requestHash),
      };
      const batch: ExtensionByokExecutionBatchRecord = {
        id: batchId,
        contractVersion: EXTENSION_BYOK_EXECUTION_BATCH_VERSION,
        status: 'OPEN',
        ownerUserId: ownerIdentity.ownerUserId,
        actorUserId: ownerIdentity.actorUserId,
        deviceSessionId: ownerIdentity.deviceSessionId,
        shopId: first.binding.shopId,
        listingWorkflowId: first.binding.workflowId,
        draftRevision: first.binding.draftRevision,
        draftVersion: first.binding.draftVersion,
        sourcePlatform: first.binding.sourcePlatform,
        sourceProductId: first.binding.sourceProductId,
        sourceCaptureSnapshotId: first.binding.sourceCaptureSnapshotId,
        supplyGoodsId: first.binding.supplyGoodsId,
        firstAssignmentOrdinal: first.binding.assignmentOrdinal,
        itemCount: items.length,
        idempotencyKey,
        requestHash: operationHash(requestIdentity),
        boundDraftRevision: null,
        boundDraftVersion: null,
        boundAt: null,
        cancelledAt: null,
        createdAt,
        updatedAt: createdAt,
      };
      let result: ExtensionByokExecutionBatchClaimResult;
      try {
        result = await options.repository.claimBatch({ batch, items: itemRecords, intents });
      } catch {
        return fail('BYOK_EXECUTION_BATCH_UNAVAILABLE', 503, 'batch reservation is unavailable');
      }
      if (result.kind !== 'created' && result.kind !== 'replayed') {
        return mapClaimFailure(result.kind);
      }
      return { replayed: result.kind === 'replayed', batch: result.batch, intents: result.intents };
    },

    async claimSuccessor(rawInput: ExtensionByokExecutionBatchSuccessorClaimInput) {
      const ownerIdentity = identity(rawInput.identity);
      const batchId = identifier(rawInput.batchId, 'batchId');
      const currentIntentId = identifier(rawInput.currentIntentId, 'currentIntentId');
      const itemIndex = ordinal(rawInput.itemIndex, 'itemIndex');
      if (itemIndex >= MAX_ITEMS || rawInput.providerChargeConfirmed !== true) {
        return fail(
          'BYOK_EXECUTION_BATCH_INVALID_REQUEST',
          400,
          'successor Provider charge confirmation is required',
        );
      }
      const item = normalizeItem(rawInput.item);
      if (item.binding.ownerUserId !== ownerIdentity.ownerUserId
        || item.binding.deviceSessionId !== ownerIdentity.deviceSessionId) {
        return fail('BYOK_EXECUTION_BATCH_FORBIDDEN', 403, 'successor identity is forbidden');
      }
      let shop: Awaited<ReturnType<AuthorityOptions['loadShop']>>;
      let policy: ExtensionByokReadinessDecision;
      try {
        [shop, policy] = await Promise.all([
          options.loadShop({
            shopId: item.binding.shopId,
            ownerUserId: ownerIdentity.ownerUserId,
          }),
          options.evaluatePolicy({
            ownerUserId: ownerIdentity.ownerUserId,
            shopId: item.binding.shopId,
            deviceSessionId: ownerIdentity.deviceSessionId,
            providerOrigin: item.binding.providerOrigin,
            operation: item.binding.operation,
          }),
        ]);
      } catch {
        return fail('BYOK_EXECUTION_BATCH_UNAVAILABLE', 503, 'successor authority is unavailable');
      }
      validateShop(shop, ownerIdentity, item.binding.shopId);
      validatePolicy(policy, ownerIdentity, item);
      const createdAt = now();
      if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
        return fail('BYOK_EXECUTION_BATCH_UNAVAILABLE', 503, 'clock is unavailable');
      }
      const intent = createIntent({
        id: createId(),
        identity: ownerIdentity,
        item,
        createdAt,
        executionBatchItemId: null,
        executionBatchAttemptIndex: null,
      });
      let result: ExtensionByokExecutionBatchSuccessorClaimResult;
      try {
        result = await options.repository.claimSuccessor({
          identity: ownerIdentity,
          batchId,
          itemIndex,
          currentIntentId,
          intent,
        });
      } catch {
        return fail('BYOK_EXECUTION_BATCH_UNAVAILABLE', 503, 'successor attempt is unavailable');
      }
      if (result.kind === 'created' || result.kind === 'replayed') {
        return { replayed: result.kind === 'replayed', batch: result.batch, intent: result.intent };
      }
      const errors: Record<typeof result.kind,
      [ExtensionByokExecutionBatchErrorCode, 403 | 404 | 409, string]> = {
        not_found: ['BYOK_EXECUTION_BATCH_NOT_FOUND', 404, 'batch reservation was not found'],
        forbidden: ['BYOK_EXECUTION_BATCH_FORBIDDEN', 403, 'batch reservation is forbidden'],
        stale: ['BYOK_EXECUTION_BATCH_CONTEXT_STALE', 409, 'listing draft changed'],
        state_conflict: ['BYOK_EXECUTION_BATCH_STATE_CONFLICT', 409, 'batch is not open'],
        attempt_blocked: ['BYOK_EXECUTION_BATCH_ATTEMPT_BLOCKED', 409, 'current attempt cannot be retried'],
        idempotency_conflict: ['BYOK_EXECUTION_BATCH_IDEMPOTENCY_CONFLICT', 409, 'attempt identity conflicts'],
        capacity_exceeded: ['BYOK_EXECUTION_BATCH_CAPACITY_EXCEEDED', 409, 'attempt capacity exceeded'],
      };
      const [code, status, message] = errors[result.kind];
      return fail(code, status, message);
    },

    async cancel(rawInput: ExtensionByokExecutionBatchCancelInput) {
      const ownerIdentity = identity(rawInput.identity);
      const batchId = identifier(rawInput.batchId, 'batchId');
      const cancelledAt = now();
      if (!(cancelledAt instanceof Date) || !Number.isFinite(cancelledAt.getTime())) {
        return fail('BYOK_EXECUTION_BATCH_UNAVAILABLE', 503, 'clock is unavailable');
      }
      let result: ExtensionByokExecutionBatchCancelResult;
      try {
        result = await options.repository.cancelBatch({
          identity: ownerIdentity,
          batchId,
          now: cancelledAt,
        });
      } catch {
        return fail('BYOK_EXECUTION_BATCH_UNAVAILABLE', 503, 'batch cancellation is unavailable');
      }
      if (result.kind === 'cancelled' || result.kind === 'replayed') {
        return { replayed: result.kind === 'replayed', batch: result.batch };
      }
      const errors: Record<typeof result.kind,
      [ExtensionByokExecutionBatchErrorCode, 403 | 404 | 409, string]> = {
        not_found: ['BYOK_EXECUTION_BATCH_NOT_FOUND', 404, 'batch reservation was not found'],
        forbidden: ['BYOK_EXECUTION_BATCH_FORBIDDEN', 403, 'batch reservation is forbidden'],
        state_conflict: ['BYOK_EXECUTION_BATCH_STATE_CONFLICT', 409, 'batch cannot be cancelled'],
        attempt_blocked: [
          'BYOK_EXECUTION_BATCH_ATTEMPT_BLOCKED',
          409,
          'pending or unknown Provider attempts prevent cancellation',
        ],
      };
      const [code, status, message] = errors[result.kind];
      return fail(code, status, message);
    },
  };
}

export type ExtensionByokExecutionBatchService = ReturnType<
typeof createExtensionByokExecutionBatchService
>;

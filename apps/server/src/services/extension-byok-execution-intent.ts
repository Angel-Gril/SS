import { createHash, randomUUID } from 'node:crypto';
import type { ExtensionByokReadinessBinding } from './extension-byok-readiness-attestation.js';
import {
  canonicalizeExtensionByokProviderOrigin,
  EXTENSION_BYOK_READINESS_VERSION,
  type ExtensionByokOperation,
  type ExtensionByokReadinessDecision,
} from './extension-byok-policy.js';
import {
  EXTENSION_BYOK_WORKBENCH_LAUNCH_REQUEST_VERSION,
  resolveExtensionByokWorkbenchSlotTarget,
  type ExtensionByokWorkbenchDraft,
} from './extension-byok-workbench-launch.js';
import { containsSecretBearingIdentifier } from './extension-byok-media-provenance.js';

export const EXTENSION_BYOK_EXECUTION_INTENT_VERSION =
  'extension-byok-execution-intent/v1' as const;
export const EXTENSION_BYOK_EXECUTION_INTENT_REQUEST_VERSION =
  'extension-byok-execution-intent-request/v1' as const;
export const EXTENSION_BYOK_EXECUTION_INTENT_OUTCOME_VERSION =
  'extension-byok-execution-intent-outcome/v1' as const;
export const EXTENSION_BYOK_EXECUTION_INTENT_OUTCOME_REQUEST_VERSION =
  'extension-byok-execution-intent-outcome-request/v1' as const;

const HASH_PATTERN = /^[a-f0-9]{64}$/u;
const REQUEST_MODES = ['json', 'multipart'] as const;
export type ExtensionByokExecutionRequestMode = typeof REQUEST_MODES[number];

export type ExtensionByokExecutionIntentErrorCode =
  | 'BYOK_EXECUTION_INTENT_INVALID_REQUEST'
  | 'BYOK_EXECUTION_INTENT_FORBIDDEN'
  | 'BYOK_EXECUTION_INTENT_CONTEXT_STALE'
  | 'BYOK_EXECUTION_INTENT_POLICY_UNAVAILABLE'
  | 'BYOK_EXECUTION_INTENT_POLICY_DISABLED'
  | 'BYOK_EXECUTION_INTENT_MODE_CONFLICT'
  | 'BYOK_EXECUTION_INTENT_IDEMPOTENCY_CONFLICT'
  | 'BYOK_EXECUTION_INTENT_NOT_FOUND'
  | 'BYOK_EXECUTION_INTENT_OUTCOME_CONFLICT'
  | 'BYOK_EXECUTION_INTENT_CAPACITY_EXCEEDED'
  | 'BYOK_EXECUTION_INTENT_UNAVAILABLE';

export class ExtensionByokExecutionIntentError extends Error {
  constructor(
    public readonly code: ExtensionByokExecutionIntentErrorCode,
    public readonly statusCode: 400 | 403 | 409 | 503,
    message: string,
  ) {
    super(message);
    this.name = 'ExtensionByokExecutionIntentError';
  }
}

export interface ExtensionByokExecutionIntentIdentity {
  ownerUserId: string;
  actorUserId: string;
  deviceSessionId: string;
}

export interface ExtensionByokExecutionIntentClaimInput {
  identity: ExtensionByokExecutionIntentIdentity;
  binding: ExtensionByokReadinessBinding;
  requestMode: ExtensionByokExecutionRequestMode;
  providerIdempotencyKey: string;
  providerRequestHash: string;
}

export interface ExtensionByokExecutionIntentRecord {
  id: string;
  contractVersion: typeof EXTENSION_BYOK_EXECUTION_INTENT_VERSION;
  executionMode: 'BYOK';
  ownerUserId: string;
  actorUserId: string;
  deviceSessionId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
  sourceCaptureSnapshotId: string;
  supplyGoodsId: string;
  skuKey: string;
  slotKey: string;
  assignmentMode: 'APPEND';
  assignmentOrdinal: number;
  policyRevision: number;
  providerOriginSha256: string;
  model: string;
  operation: ExtensionByokOperation;
  requestMode: ExtensionByokExecutionRequestMode;
  providerIdempotencyKey: string;
  providerRequestHash: string;
  requestHash: string;
  executionBatchItemId?: string | null;
  executionBatchAttemptIndex?: number | null;
  outcome: 'PENDING' | 'SUCCEEDED' | 'FAILED_FINAL' | 'UNKNOWN_OUTCOME';
  providerRequestIdSha256: string | null;
  resultSha256: string | null;
  outcomeUpdatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExtensionByokExecutionIntentOutcomeInput {
  identity: ExtensionByokExecutionIntentIdentity;
  intentId: string;
  providerIdempotencyKey: string;
  providerRequestHash: string;
  outcome: 'SUCCEEDED' | 'FAILED_FINAL' | 'UNKNOWN_OUTCOME';
  providerRequestIdSha256: string | null;
  resultSha256: string | null;
}

export interface ExtensionByokExecutionIntentOutcomeRecord {
  identity: ExtensionByokExecutionIntentIdentity;
  intentId: string;
  providerIdempotencyKey: string;
  providerRequestHash: string;
  outcome: ExtensionByokExecutionIntentOutcomeInput['outcome'];
  providerRequestIdSha256: string | null;
  resultSha256: string | null;
  outcomeUpdatedAt: Date;
}

export type ExtensionByokExecutionIntentClaimResult =
  | { kind: 'created' | 'replayed'; intent: ExtensionByokExecutionIntentRecord }
  | {
    kind:
      | 'forbidden' | 'stale' | 'mode_conflict' | 'idempotency_conflict'
      | 'reservation_conflict' | 'capacity_exceeded';
  };

export type ExtensionByokExecutionIntentOutcomeResult =
  | { kind: 'updated' | 'replayed'; intent: ExtensionByokExecutionIntentRecord }
  | { kind: 'not_found' | 'forbidden' | 'outcome_conflict' };

export interface ExtensionByokExecutionIntentRepository {
  claim(
    input: ExtensionByokExecutionIntentRecord,
  ): Promise<ExtensionByokExecutionIntentClaimResult>;
  recordOutcome(
    input: ExtensionByokExecutionIntentOutcomeRecord,
  ): Promise<ExtensionByokExecutionIntentOutcomeResult>;
}

export interface ExtensionByokExecutionIntentServiceOptions {
  loadShop(input: { shopId: string; ownerUserId: string }): Promise<{
    id: string;
    userId: string;
    platform: string;
    status: string;
  } | null>;
  loadDraft(input: { workflowId: string; ownerUserId: string }): Promise<
    ExtensionByokWorkbenchDraft | null
  >;
  evaluatePolicy(input: {
    ownerUserId: string;
    shopId: string;
    deviceSessionId: string;
    providerOrigin: string;
    operation: ExtensionByokOperation;
  }): Promise<ExtensionByokReadinessDecision>;
  repository: ExtensionByokExecutionIntentRepository;
  createId?: () => string;
  now?: () => Date;
}

function fail(
  code: ExtensionByokExecutionIntentErrorCode,
  statusCode: 400 | 403 | 409 | 503,
  message: string,
): never {
  throw new ExtensionByokExecutionIntentError(code, statusCode, message);
}

function identifier(value: unknown, field: string, maximum = 200): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > maximum
    || value !== value.normalize('NFKC').trim()
    // eslint-disable-next-line no-control-regex
    || /[\u0000-\u001f\u007f]/u.test(value)
    || containsSecretBearingIdentifier(value)) {
    return fail('BYOK_EXECUTION_INTENT_INVALID_REQUEST', 400, `${field} is invalid`);
  }
  return value;
}

function sha256(value: unknown, field: string): string {
  if (typeof value !== 'string' || !HASH_PATTERN.test(value)) {
    return fail('BYOK_EXECUTION_INTENT_INVALID_REQUEST', 400, `${field} is invalid`);
  }
  return value;
}

function nullableSha256(value: unknown, field: string): string | null {
  return value === null ? null : sha256(value, field);
}

function positiveInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    return fail('BYOK_EXECUTION_INTENT_INVALID_REQUEST', 400, `${field} is invalid`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 499) {
    return fail('BYOK_EXECUTION_INTENT_INVALID_REQUEST', 400, `${field} is invalid`);
  }
  return Number(value);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  const record = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonical(record[key])]));
}

function operationHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function textHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeIdentity(value: ExtensionByokExecutionIntentIdentity) {
  const identity = {
    ownerUserId: identifier(value?.ownerUserId, 'ownerUserId'),
    actorUserId: identifier(value?.actorUserId, 'actorUserId'),
    deviceSessionId: identifier(value?.deviceSessionId, 'deviceSessionId'),
  };
  if (identity.ownerUserId !== identity.actorUserId) {
    return fail('BYOK_EXECUTION_INTENT_FORBIDDEN', 403, 'BYOK execution requires an owner device');
  }
  return identity;
}

function normalizeBinding(value: ExtensionByokReadinessBinding) {
  if (!value || value.contractVersion !== 'extension-byok-readiness-binding/v2'
    || value.workflowId === null || value.draftRevision === null || value.draftVersion === null
    || value.sourcePlatform === null || value.sourceProductId === null
    || value.sourceCaptureSnapshotId === null || value.supplyGoodsId === null
    || value.skuKey === null || value.slotKey === null || value.assignmentMode !== 'APPEND'
    || value.assignmentOrdinal === null
    || !['1688', 'pdd', 'taobao', 'tmall'].includes(value.sourcePlatform)
    || !['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(value.operation)) {
    return fail('BYOK_EXECUTION_INTENT_INVALID_REQUEST', 400, 'readiness binding is invalid');
  }
  let providerOrigin: string;
  try {
    providerOrigin = canonicalizeExtensionByokProviderOrigin(value.providerOrigin);
  } catch {
    return fail('BYOK_EXECUTION_INTENT_INVALID_REQUEST', 400, 'provider origin is invalid');
  }
  const binding = {
    contractVersion: value.contractVersion,
    ownerUserId: identifier(value.ownerUserId, 'binding.ownerUserId'),
    deviceSessionId: identifier(value.deviceSessionId, 'binding.deviceSessionId'),
    shopId: identifier(value.shopId, 'binding.shopId'),
    workflowId: identifier(value.workflowId, 'binding.workflowId'),
    draftRevision: positiveInteger(value.draftRevision, 'binding.draftRevision'),
    draftVersion: positiveInteger(value.draftVersion, 'binding.draftVersion'),
    sourcePlatform: value.sourcePlatform,
    sourceProductId: identifier(value.sourceProductId, 'binding.sourceProductId'),
    sourceCaptureSnapshotId: identifier(
      value.sourceCaptureSnapshotId,
      'binding.sourceCaptureSnapshotId',
    ),
    supplyGoodsId: identifier(value.supplyGoodsId, 'binding.supplyGoodsId'),
    skuKey: identifier(value.skuKey, 'binding.skuKey', 500),
    slotKey: identifier(value.slotKey, 'binding.slotKey'),
    assignmentMode: 'APPEND' as const,
    assignmentOrdinal: nonNegativeInteger(value.assignmentOrdinal, 'binding.assignmentOrdinal'),
    providerOrigin,
    model: identifier(value.model, 'binding.model'),
    operation: value.operation,
    policyRevision: positiveInteger(Number(value.policyRevision), 'binding.policyRevision'),
  };
  return binding;
}

function exactPolicy(
  value: ExtensionByokReadinessDecision,
  identity: ReturnType<typeof normalizeIdentity>,
  binding: ReturnType<typeof normalizeBinding>,
) {
  if (!value || value.contractVersion !== EXTENSION_BYOK_READINESS_VERSION
    || value.context.ownerUserId !== identity.ownerUserId
    || value.context.shopId !== binding.shopId
    || value.context.deviceSessionId !== identity.deviceSessionId
    || value.context.providerOrigin !== binding.providerOrigin
    || value.context.operation !== binding.operation
    || !Number.isSafeInteger(value.policyRevision)) {
    return fail(
      'BYOK_EXECUTION_INTENT_POLICY_UNAVAILABLE',
      503,
      'BYOK execution policy is unavailable',
    );
  }
  if (value.capabilities.generation.ready !== true || value.policyRevision !== binding.policyRevision) {
    return fail(
      'BYOK_EXECUTION_INTENT_POLICY_DISABLED',
      409,
      'BYOK execution policy is disabled or changed',
    );
  }
  return value;
}

function expectedRequestMode(operation: ExtensionByokOperation): ExtensionByokExecutionRequestMode {
  return operation === 'TEXT_TO_IMAGE' ? 'json' : 'multipart';
}

export function createExtensionByokExecutionIntentService(
  options: ExtensionByokExecutionIntentServiceOptions,
) {
  return {
    async claim(rawInput: ExtensionByokExecutionIntentClaimInput) {
      const identity = normalizeIdentity(rawInput.identity);
      const binding = normalizeBinding(rawInput.binding);
      if (identity.ownerUserId !== binding.ownerUserId
        || identity.deviceSessionId !== binding.deviceSessionId) {
        return fail('BYOK_EXECUTION_INTENT_FORBIDDEN', 403, 'readiness identity is forbidden');
      }
      if (!REQUEST_MODES.includes(rawInput.requestMode)
        || rawInput.requestMode !== expectedRequestMode(binding.operation)) {
        return fail('BYOK_EXECUTION_INTENT_INVALID_REQUEST', 400, 'requestMode is invalid');
      }
      const providerIdempotencyKey = identifier(
        rawInput.providerIdempotencyKey,
        'providerIdempotencyKey',
      );
      if (providerIdempotencyKey.length < 16) {
        return fail(
          'BYOK_EXECUTION_INTENT_INVALID_REQUEST',
          400,
          'providerIdempotencyKey is invalid',
        );
      }
      const providerRequestHash = sha256(rawInput.providerRequestHash, 'providerRequestHash');

      let shop: Awaited<ReturnType<typeof options.loadShop>>;
      let draft: Awaited<ReturnType<typeof options.loadDraft>>;
      let policy: ExtensionByokReadinessDecision;
      try {
        [shop, draft, policy] = await Promise.all([
          options.loadShop({ shopId: binding.shopId, ownerUserId: identity.ownerUserId }),
          options.loadDraft({ workflowId: binding.workflowId, ownerUserId: identity.ownerUserId }),
          options.evaluatePolicy({
            ownerUserId: identity.ownerUserId,
            shopId: binding.shopId,
            deviceSessionId: identity.deviceSessionId,
            providerOrigin: binding.providerOrigin,
            operation: binding.operation,
          }),
        ]);
      } catch {
        return fail('BYOK_EXECUTION_INTENT_UNAVAILABLE', 503, 'BYOK execution authority is unavailable');
      }
      if (!shop || shop.id !== binding.shopId || shop.userId !== identity.ownerUserId
        || shop.platform !== 'OZON' || shop.status !== 'ACTIVE') {
        return fail('BYOK_EXECUTION_INTENT_FORBIDDEN', 403, 'shop is unavailable for BYOK execution');
      }
      if (!draft) {
        return fail('BYOK_EXECUTION_INTENT_CONTEXT_STALE', 409, 'listing draft is stale');
      }
      try {
        resolveExtensionByokWorkbenchSlotTarget({
          ownerUserId: identity.ownerUserId,
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
          draft,
          target: {
            skuKey: binding.skuKey,
            slotKey: binding.slotKey,
            assignmentMode: binding.assignmentMode,
            assignmentOrdinal: binding.assignmentOrdinal,
          },
        });
      } catch {
        return fail('BYOK_EXECUTION_INTENT_CONTEXT_STALE', 409, 'listing draft is stale');
      }
      exactPolicy(policy, identity, binding);

      const createdAt = (options.now || (() => new Date()))();
      if (!(createdAt instanceof Date) || !Number.isFinite(createdAt.getTime())) {
        return fail('BYOK_EXECUTION_INTENT_UNAVAILABLE', 503, 'clock is unavailable');
      }
      const providerOriginSha256 = textHash(binding.providerOrigin);
      const requestIdentity = {
        contractVersion: EXTENSION_BYOK_EXECUTION_INTENT_VERSION,
        executionMode: 'BYOK' as const,
        ...identity,
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
        providerOriginSha256,
        model: binding.model,
        operation: binding.operation,
        requestMode: rawInput.requestMode,
        providerIdempotencyKey,
        providerRequestHash,
      };
      const intent: ExtensionByokExecutionIntentRecord = {
        id: identifier((options.createId || randomUUID)(), 'intentId'),
        ...requestIdentity,
        requestHash: operationHash(requestIdentity),
        outcome: 'PENDING',
        providerRequestIdSha256: null,
        resultSha256: null,
        outcomeUpdatedAt: null,
        createdAt,
        updatedAt: createdAt,
      };
      let result: ExtensionByokExecutionIntentClaimResult;
      try {
        result = await options.repository.claim(intent);
      } catch {
        return fail('BYOK_EXECUTION_INTENT_UNAVAILABLE', 503, 'BYOK execution intent is unavailable');
      }
      if (result.kind === 'forbidden') {
        return fail('BYOK_EXECUTION_INTENT_FORBIDDEN', 403, 'device authority changed');
      }
      if (result.kind === 'stale') {
        return fail('BYOK_EXECUTION_INTENT_CONTEXT_STALE', 409, 'listing draft changed');
      }
      if (result.kind === 'mode_conflict') {
        return fail('BYOK_EXECUTION_INTENT_MODE_CONFLICT', 409, 'draft is locked to ERP hosted mode');
      }
      if (result.kind === 'idempotency_conflict') {
        return fail(
          'BYOK_EXECUTION_INTENT_IDEMPOTENCY_CONFLICT',
          409,
          'Provider attempt identity is already used',
        );
      }
      if (result.kind === 'reservation_conflict') {
        return fail(
          'BYOK_EXECUTION_INTENT_CONTEXT_STALE',
          409,
          'The requested media slot is reserved by another BYOK batch',
        );
      }
      if (result.kind === 'capacity_exceeded') {
        return fail(
          'BYOK_EXECUTION_INTENT_CAPACITY_EXCEEDED',
          409,
          'Too many BYOK attempts are retained for this draft',
        );
      }
      if (result.kind !== 'created' && result.kind !== 'replayed') {
        return fail(
          'BYOK_EXECUTION_INTENT_UNAVAILABLE',
          503,
          'BYOK execution intent returned an invalid result',
        );
      }
      return { replayed: result.kind === 'replayed', intent: result.intent };
    },

    async recordOutcome(rawInput: ExtensionByokExecutionIntentOutcomeInput) {
      const identity = normalizeIdentity(rawInput.identity);
      const intentId = identifier(rawInput.intentId, 'intentId');
      const providerIdempotencyKey = identifier(
        rawInput.providerIdempotencyKey,
        'providerIdempotencyKey',
      );
      if (providerIdempotencyKey.length < 16) {
        return fail(
          'BYOK_EXECUTION_INTENT_INVALID_REQUEST',
          400,
          'providerIdempotencyKey is invalid',
        );
      }
      const providerRequestHash = sha256(rawInput.providerRequestHash, 'providerRequestHash');
      if (!['SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME'].includes(rawInput.outcome)) {
        return fail('BYOK_EXECUTION_INTENT_INVALID_REQUEST', 400, 'outcome is invalid');
      }
      const providerRequestIdSha256 = nullableSha256(
        rawInput.providerRequestIdSha256,
        'providerRequestIdSha256',
      );
      const resultSha256 = nullableSha256(rawInput.resultSha256, 'resultSha256');
      if ((rawInput.outcome === 'SUCCEEDED') !== (resultSha256 !== null)) {
        return fail(
          'BYOK_EXECUTION_INTENT_INVALID_REQUEST',
          400,
          'resultSha256 is inconsistent with outcome',
        );
      }
      const outcomeUpdatedAt = (options.now || (() => new Date()))();
      if (!(outcomeUpdatedAt instanceof Date) || !Number.isFinite(outcomeUpdatedAt.getTime())) {
        return fail('BYOK_EXECUTION_INTENT_UNAVAILABLE', 503, 'clock is unavailable');
      }
      let result: ExtensionByokExecutionIntentOutcomeResult;
      try {
        result = await options.repository.recordOutcome({
          identity,
          intentId,
          providerIdempotencyKey,
          providerRequestHash,
          outcome: rawInput.outcome,
          providerRequestIdSha256,
          resultSha256,
          outcomeUpdatedAt,
        });
      } catch {
        return fail('BYOK_EXECUTION_INTENT_UNAVAILABLE', 503, 'BYOK execution outcome is unavailable');
      }
      if (result.kind === 'not_found') {
        return fail('BYOK_EXECUTION_INTENT_NOT_FOUND', 409, 'BYOK execution intent was not found');
      }
      if (result.kind === 'forbidden') {
        return fail('BYOK_EXECUTION_INTENT_FORBIDDEN', 403, 'device authority changed');
      }
      if (result.kind === 'outcome_conflict') {
        return fail(
          'BYOK_EXECUTION_INTENT_OUTCOME_CONFLICT',
          409,
          'BYOK execution outcome is already terminal',
        );
      }
      if (result.kind !== 'updated' && result.kind !== 'replayed') {
        return fail('BYOK_EXECUTION_INTENT_UNAVAILABLE', 503, 'BYOK execution outcome is invalid');
      }
      return { replayed: result.kind === 'replayed', intent: result.intent };
    },
  };
}

export type ExtensionByokExecutionIntentService = ReturnType<
  typeof createExtensionByokExecutionIntentService
>;

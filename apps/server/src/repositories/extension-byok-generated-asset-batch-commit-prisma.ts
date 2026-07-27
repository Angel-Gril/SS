import { createHash } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import type { OzonListingDraft, OzonListingDraftMediaAssignment } from 'shared';
import {
  createPrismaByokGeneratedAssetRepository,
} from './byok-generated-asset-repository.js';
import {
  PrismaExtensionByokMediaProvenanceRepository,
} from './extension-byok-media-provenance-repository.js';
import {
  byokGeneratedAssetMatchesCreateInput,
  byokGeneratedAssetMatchesSemanticIdentity,
  deriveByokGeneratedAssetIdentity,
  type ByokGeneratedAssetCreateInput,
  type ByokGeneratedAssetRecord,
} from '../services/byok-generated-asset-ingest.js';
import {
  consumeByokMediaIngestGrantInTransaction,
  EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION,
  EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION,
  type ExtensionByokMediaBatchIngestResolvedCommand,
  type ExtensionByokMediaIngestResolvedCommand,
} from '../services/extension-byok-media-ingest-grant.js';
import {
  createExtensionByokMediaProvenanceService,
  ExtensionByokMediaProvenanceError,
  EXTENSION_BYOK_MEDIA_PROVENANCE_VERSION,
} from '../services/extension-byok-media-provenance.js';
import {
  runExtensionCommandSerializableTransaction,
  type ExtensionCommandDatabaseClient,
  type ExtensionCommandTransactionClient,
} from '../services/extension-command-grants-prisma.js';
import type { ExtensionCommandBinding } from '../services/extension-command-grants.js';
import {
  planByokGeneratedAssetListingBinding,
  ByokListingMediaBindingError,
  type ByokListingMediaBindingResult,
} from '../services/byok-listing-media-binding.js';
import {
  applySourceListingDraftCasInTransaction,
  lockCurrentSourceListingDraft,
} from '../services/source-listing-workflow-prisma.js';
import { OzonListingDraftRepositoryError } from '../services/ozon-listing-draft.js';
import { commitExtensionByokUploadStagingInTransaction } from '../services/extension-byok-upload-staging.js';
import { isExtensionAiImageExecutionModeConflict } from '../services/extension-ai-image-execution-mode.js';
import {
  ExtensionByokGeneratedAssetCommitError,
  type ExtensionByokGeneratedAssetCommitErrorCode,
} from './extension-byok-generated-asset-commit-prisma.js';
import { requireExactExtensionByokExecutionIntentInTransaction } from './extension-byok-generated-asset-commit-shared.js';

export const EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION =
  'extension-byok-media-batch-ingest-receipt/v1' as const;

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SHARED_DETAIL_SLOT_KEYS = new Set([
  'shared:detail:SCENE',
  'shared:detail:DETAIL',
  'shared:detail:SPEC',
  'shared:detail:PACKAGING',
]);

export interface ExtensionByokMediaBatchIngestReceiptItem {
  assetId: string;
  provenanceId: string;
  executionIntentId: string;
  providerRequestHash: string;
  providerResultSha256: string;
  normalizedSha256: string;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  width: number;
  height: number;
  skuKey: string;
  slotKey: string;
  assignmentOrdinal: number;
  assignmentSha256: string;
  assignment: OzonListingDraftMediaAssignment;
  policyRevision: number;
}

export interface ExtensionByokMediaBatchIngestReceiptResult {
  contractVersion: typeof EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION;
  executionBatchId: string;
  requestHash: string;
  sourceDraftRevision: number;
  sourceDraftVersion: number;
  boundDraftRevision: number;
  boundDraftVersion: number;
  erpAiChargeCents: 0;
  items: ExtensionByokMediaBatchIngestReceiptItem[];
}

export interface CommitExtensionByokGeneratedAssetBatchItemInput {
  asset: ByokGeneratedAssetCreateInput;
  stagingId: string | null;
  stagingStorageNamespaceId?: string | null;
}

export interface CommitExtensionByokGeneratedAssetBatchInput {
  binding: ExtensionCommandBinding;
  tokenDigest: string;
  receiptId: string;
  actorUserId: string;
  now: Date;
  command: ExtensionByokMediaBatchIngestResolvedCommand;
  items: CommitExtensionByokGeneratedAssetBatchItemInput[];
}

export interface CommitExtensionByokGeneratedAssetBatchResult {
  replayed: boolean;
  receiptId: string;
  receipt: ExtensionByokMediaBatchIngestReceiptResult;
  assets: ByokGeneratedAssetRecord[];
}

type TransactionWithMedia = ExtensionCommandTransactionClient & {
  mediaAsset: PrismaClient['mediaAsset'];
  extensionByokMediaProvenance: any;
};

interface PlannedBatchItem {
  command: ExtensionByokMediaIngestResolvedCommand;
  input: CommitExtensionByokGeneratedAssetBatchItemInput;
  itemBinding: ExtensionCommandBinding;
  plan: ByokListingMediaBindingResult;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fail(
  code: ExtensionByokGeneratedAssetCommitErrorCode,
  statusCode: number,
  message: string,
): never {
  throw new ExtensionByokGeneratedAssetCommitError(code, statusCode, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length
    && actual.every((key, index) => key === wanted[index]);
}

function validIdentifier(value: unknown, minimum = 1, maximum = 200): value is string {
  return typeof value === 'string'
    && value.length >= minimum
    && value.length <= maximum
    && value === value.normalize('NFKC').trim()
    // eslint-disable-next-line no-control-regex
    && !/[\u0000-\u001f\u007f]/u.test(value);
}

/**
 * A batch grant has one public idempotency identity, while assets and
 * provenance rows require distinct deterministic identities.  Deriving the
 * child key from the immutable execution intent makes upload preparation and
 * the atomic transaction agree without exposing Provider credentials.
 */
export function deriveExtensionByokBatchItemIdempotencyKey(
  batchIdempotencyKey: string,
  executionIntentId: string,
): string {
  if (!validIdentifier(batchIdempotencyKey, 16)
    || !validIdentifier(executionIntentId)) {
    return fail(
      'BYOK_INGEST_GRANT_MISMATCH',
      409,
      'BYOK batch item idempotency identity is invalid',
    );
  }
  return `byok-batch-item-${sha256([
    EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION,
    batchIdempotencyKey,
    executionIntentId,
  ].join('\u0000'))}`;
}

function mapGrantFailure(kind: string): never {
  const errors: Record<string, [ExtensionByokGeneratedAssetCommitErrorCode, number, string]> = {
    not_found: ['BYOK_INGEST_GRANT_NOT_FOUND', 404, 'BYOK ingest grant was not found'],
    mismatch: ['BYOK_INGEST_GRANT_MISMATCH', 409, 'BYOK ingest grant does not match this request'],
    expired: ['BYOK_INGEST_GRANT_EXPIRED', 410, 'BYOK ingest grant expired'],
    revoked: ['BYOK_INGEST_GRANT_REVOKED', 410, 'BYOK ingest grant was revoked'],
    session_invalid: ['BYOK_INGEST_SESSION_INVALID', 401, 'Extension device session is invalid'],
    scope_denied: ['BYOK_INGEST_SCOPE_DENIED', 403, 'Extension device ingest scope is denied'],
    shop_denied: ['BYOK_INGEST_SHOP_DENIED', 403, 'Extension device shop access is denied'],
  };
  const [code, status, message] = errors[kind]
    || ['BYOK_INGEST_GRANT_MISMATCH', 409, 'BYOK ingest grant is invalid'];
  return fail(code, status, message);
}

function mapBindingFailure(error: ByokListingMediaBindingError): never {
  if (error.code === 'BYOK_LISTING_BINDING_ASSET_INVALID') {
    return fail('BYOK_INGEST_ASSET_CONFLICT', error.statusCode, error.message);
  }
  if (error.code === 'BYOK_LISTING_BINDING_SLOT_CONFLICT') {
    return fail('BYOK_INGEST_SLOT_CONFLICT', error.statusCode, error.message);
  }
  if (error.code === 'BYOK_LISTING_BINDING_ORDER_CONFLICT') {
    return fail('BYOK_INGEST_ORDER_CONFLICT', error.statusCode, error.message);
  }
  return fail('BYOK_INGEST_DRAFT_STALE', error.statusCode, error.message);
}

function sourceForOperation(
  operation: ExtensionByokMediaIngestResolvedCommand['providerOperation'],
): 'GENERATED' | 'EDITED' {
  return operation === 'TEXT_TO_IMAGE' || operation === 'IMAGE_TO_IMAGE'
    ? 'GENERATED'
    : 'EDITED';
}

function expectedAssignment(
  command: ExtensionByokMediaIngestResolvedCommand,
  assetId: string,
): OzonListingDraftMediaAssignment {
  const base = {
    slotKey: command.slotKey,
    assetId,
    source: sourceForOperation(command.providerOperation),
  };
  if (command.slotKey === `sku:${command.skuKey}:hero`) {
    return { scope: 'SKU', skuKey: command.skuKey, ...base };
  }
  if (SHARED_DETAIL_SLOT_KEYS.has(command.slotKey)) return { scope: 'PRODUCT', ...base };
  return fail('BYOK_INGEST_SLOT_CONFLICT', 409, 'BYOK batch slot target is unsupported');
}

function sameAssignment(
  left: unknown,
  right: OzonListingDraftMediaAssignment,
): boolean {
  if (!isRecord(left) || left.scope !== right.scope) return false;
  const expected = right.scope === 'PRODUCT'
    ? ['scope', 'slotKey', 'assetId', 'source']
    : ['scope', 'skuKey', 'slotKey', 'assetId', 'source'];
  return exactKeys(left, expected)
    && left.slotKey === right.slotKey
    && left.assetId === right.assetId
    && left.source === right.source
    && (right.scope === 'PRODUCT' || left.skuKey === right.skuKey);
}

function validateInput(input: CommitExtensionByokGeneratedAssetBatchInput): void {
  const commands = input.command?.items;
  if (input.command?.schemaVersion !== EXTENSION_BYOK_MEDIA_BATCH_INGEST_COMMAND_VERSION
    || !Array.isArray(commands)
    || commands.length < 1
    || commands.length > 4
    || !Array.isArray(input.items)
    || input.items.length !== commands.length
    || !validIdentifier(input.command.executionBatchId)
    || input.binding.operation !== 'BYOK_MEDIA_INGEST'
    || !input.binding.shopId
    || !input.binding.workflowId
    || !Number.isSafeInteger(input.binding.draftVersion)
    || Number(input.binding.draftVersion) < 1
    || !SHA256_PATTERN.test(input.binding.requestHash)
    || input.actorUserId !== input.binding.ownerUserId
    || !(input.now instanceof Date)
    || !Number.isFinite(input.now.getTime())) {
    fail('BYOK_INGEST_GRANT_MISMATCH', 409, 'BYOK batch commit identity is invalid');
  }

  const first = commands[0]!;
  const uniqueValues: Array<Array<string>> = [[], [], [], [], [], [], []];
  for (let index = 0; index < commands.length; index += 1) {
    const command = commands[index]!;
    const item = input.items[index]!;
    const itemIdempotencyKey = deriveExtensionByokBatchItemIdempotencyKey(
      input.binding.idempotencyKey,
      command.executionIntentId,
    );
    if (command.schemaVersion !== EXTENSION_BYOK_MEDIA_INGEST_COMMAND_VERSION
      || command.draftRevision !== first.draftRevision
      || command.authority?.sourceCaptureSnapshotId
        !== first.authority?.sourceCaptureSnapshotId
      || command.assignmentMode !== 'APPEND'
      || command.replaceConfirmed
      || command.assignmentOrdinal !== first.assignmentOrdinal + index
      || command.readiness?.contractVersion !== 'extension-byok-readiness/v1'
      || !Number.isSafeInteger(command.readiness.policyRevision)
      || command.readiness.policyRevision < 0
      || command.resultSha256 !== item.asset.metadata?.providerResultSha256
      || command.resultMimeType !== item.asset.metadata?.providerResultMimeType
      || command.resultSizeBytes !== item.asset.metadata?.providerResultSizeBytes
      || item.asset.metadata?.requestHash !== input.binding.requestHash
      || item.asset.metadata?.normalizedSha256 !== item.asset.sha256
      || item.asset.metadata?.idempotencyKeySha256 !== sha256(itemIdempotencyKey)) {
      fail('BYOK_INGEST_ASSET_CONFLICT', 409, 'BYOK batch item identity conflicts');
    }
    let identity;
    try {
      identity = deriveByokGeneratedAssetIdentity({
        ownerUserId: input.binding.ownerUserId,
        sourceCaptureSnapshotId: command.authority.sourceCaptureSnapshotId,
        idempotencyKey: itemIdempotencyKey,
        requestHash: input.binding.requestHash,
        expectedProviderResultSha256: command.resultSha256,
        declaredMimeType: command.resultMimeType,
        declaredSizeBytes: command.resultSizeBytes,
      });
    } catch {
      return fail('BYOK_INGEST_ASSET_CONFLICT', 409, 'BYOK batch asset identity is invalid');
    }
    if (identity.assetId !== item.asset.id
      || identity.sourceMediaKey !== item.asset.sourceMediaKey) {
      fail('BYOK_INGEST_ASSET_CONFLICT', 409, 'BYOK batch asset identity conflicts');
    }
    if (item.stagingId === null) {
      if (item.stagingStorageNamespaceId != null) {
        fail('BYOK_INGEST_STAGING_CONFLICT', 409, 'BYOK batch staging identity conflicts');
      }
    } else if (!validIdentifier(item.stagingId)
      || !SHA256_PATTERN.test(String(item.stagingStorageNamespaceId || ''))) {
      fail('BYOK_INGEST_STAGING_CONFLICT', 409, 'BYOK batch staging identity is invalid');
    }
    uniqueValues[0]!.push(command.executionIntentId);
    uniqueValues[1]!.push(command.providerIdempotencyKey);
    uniqueValues[2]!.push(command.providerRequestHash);
    uniqueValues[3]!.push(command.resultSha256);
    uniqueValues[4]!.push(command.slotKey);
    uniqueValues[5]!.push(item.asset.id);
    if (item.stagingId !== null) uniqueValues[6]!.push(item.stagingId);
  }
  if (uniqueValues.some((values) => new Set(values).size !== values.length)) {
    fail('BYOK_INGEST_GRANT_MISMATCH', 409, 'BYOK batch item identities must be unique');
  }
}

type ExecutionBatchState = 'OPEN' | 'BOUND';

interface LockedExecutionBatchItem {
  itemId: string;
}

async function lockExactExecutionBatchReservation(
  tx: ExtensionCommandTransactionClient,
  input: CommitExtensionByokGeneratedAssetBatchInput,
  expectedState: ExecutionBatchState,
): Promise<LockedExecutionBatchItem[]> {
  const first = input.command.items[0]!;
  const batchRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT
       "id",
       "status",
       "owner_user_id" AS "ownerUserId",
       "actor_user_id" AS "actorUserId",
       "device_session_id" AS "deviceSessionId",
       "shop_id" AS "shopId",
       "listing_workflow_id" AS "listingWorkflowId",
       "draft_revision" AS "draftRevision",
       "draft_version" AS "draftVersion",
       "source_capture_snapshot_id" AS "sourceCaptureSnapshotId",
       "first_assignment_ordinal" AS "firstAssignmentOrdinal",
       "item_count" AS "itemCount",
       "bound_draft_revision" AS "boundDraftRevision",
       "bound_draft_version" AS "boundDraftVersion"
     FROM "extension_byok_execution_batches"
     WHERE "id" = $1
     LIMIT 2
     FOR UPDATE`,
    input.command.executionBatchId,
  );
  if (!Array.isArray(batchRows) || batchRows.length !== 1) {
    fail(
      'BYOK_INGEST_EXECUTION_INTENT_MISMATCH',
      409,
      'BYOK execution batch reservation was not found',
    );
  }
  const batch = batchRows[0]!;
  const exactBatch = batch.id === input.command.executionBatchId
    && batch.status === expectedState
    && batch.ownerUserId === input.binding.ownerUserId
    && batch.actorUserId === input.actorUserId
    && batch.deviceSessionId === input.binding.sessionId
    && batch.shopId === input.binding.shopId
    && batch.listingWorkflowId === input.binding.workflowId
    && Number(batch.draftRevision) === first.draftRevision
    && Number(batch.draftVersion) === input.binding.draftVersion
    && batch.sourceCaptureSnapshotId === first.authority.sourceCaptureSnapshotId
    && Number(batch.firstAssignmentOrdinal) === first.assignmentOrdinal
    && Number(batch.itemCount) === input.command.items.length
    && batch.boundDraftRevision === (expectedState === 'BOUND' ? first.draftRevision + 1 : null)
    && batch.boundDraftVersion === (
      expectedState === 'BOUND' ? Number(input.binding.draftVersion) + 1 : null
    );
  if (!exactBatch) {
    fail(
      'BYOK_INGEST_EXECUTION_INTENT_MISMATCH',
      409,
      'BYOK execution batch reservation does not match the ingest command',
    );
  }

  const intentIds = input.command.items.map((command) => command.executionIntentId);
  const itemRows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT
       item."id" AS "itemId",
       item."batch_id" AS "batchId",
       item."owner_user_id" AS "ownerUserId",
       item."listing_workflow_id" AS "listingWorkflowId",
       item."draft_revision" AS "draftRevision",
       item."draft_version" AS "draftVersion",
       item."item_index" AS "itemIndex",
       item."sku_key" AS "skuKey",
       item."slot_key" AS "slotKey",
       item."assignment_ordinal" AS "assignmentOrdinal",
       item."status" AS "itemStatus",
       intent."id" AS "executionIntentId",
       intent."outcome" AS "intentOutcome",
       intent."provider_request_hash" AS "providerRequestHash",
       intent."result_sha256" AS "resultSha256"
     FROM "extension_byok_execution_batch_items" item
     JOIN "extension_byok_execution_intents" intent
       ON intent."execution_batch_item_id" = item."id"
      AND intent."id" = ANY($2::text[])
     WHERE item."batch_id" = $1
     ORDER BY item."item_index"
     FOR UPDATE OF item, intent`,
    input.command.executionBatchId,
    intentIds,
  );
  if (!Array.isArray(itemRows) || itemRows.length !== input.command.items.length) {
    fail(
      'BYOK_INGEST_EXECUTION_INTENT_MISMATCH',
      409,
      'BYOK execution intents do not cover the exact batch reservation',
    );
  }
  const expectedItemState = expectedState === 'BOUND' ? 'BOUND' : 'ACTIVE';
  const itemIds = new Set<string>();
  for (let index = 0; index < itemRows.length; index += 1) {
    const row = itemRows[index]!;
    const command = input.command.items[index]!;
    if (!validIdentifier(row.itemId)
      || itemIds.has(row.itemId)
      || row.batchId !== input.command.executionBatchId
      || row.ownerUserId !== input.binding.ownerUserId
      || row.listingWorkflowId !== input.binding.workflowId
      || Number(row.draftRevision) !== command.draftRevision
      || Number(row.draftVersion) !== input.binding.draftVersion
      || Number(row.itemIndex) !== index
      || row.skuKey !== command.skuKey
      || row.slotKey !== command.slotKey
      || Number(row.assignmentOrdinal) !== command.assignmentOrdinal
      || row.itemStatus !== expectedItemState
      || row.executionIntentId !== command.executionIntentId) {
      fail(
        'BYOK_INGEST_EXECUTION_INTENT_MISMATCH',
        409,
        'BYOK execution intent does not match its reserved batch item',
      );
    }
    if (row.intentOutcome !== 'SUCCEEDED') {
      fail(
        'BYOK_INGEST_EXECUTION_INTENT_OUTCOME_PENDING',
        409,
        'Every BYOK batch reservation item requires a successful Provider outcome',
      );
    }
    if (row.providerRequestHash !== command.providerRequestHash
      || row.resultSha256 !== command.resultSha256) {
      fail(
        'BYOK_INGEST_EXECUTION_INTENT_MISMATCH',
        409,
        'BYOK execution intent result does not match the accepted Provider result',
      );
    }
    itemIds.add(row.itemId);
  }
  return itemRows.map((row) => ({ itemId: String(row.itemId) }));
}

async function bindExecutionBatchReservation(
  tx: ExtensionCommandTransactionClient,
  input: CommitExtensionByokGeneratedAssetBatchInput,
  items: LockedExecutionBatchItem[],
): Promise<void> {
  const first = input.command.items[0]!;
  const boundDraftRevision = first.draftRevision + 1;
  const boundDraftVersion = Number(input.binding.draftVersion) + 1;
  const boundItems = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE "extension_byok_execution_batch_items"
     SET "status" = 'BOUND', "bound_at" = $2, "updated_at" = $2
     WHERE "batch_id" = $1 AND "status" = 'ACTIVE'
     RETURNING "id"`,
    input.command.executionBatchId,
    input.now,
  );
  const expectedIds = new Set(items.map((item) => item.itemId));
  if (!Array.isArray(boundItems)
    || boundItems.length !== expectedIds.size
    || boundItems.some((item) => !expectedIds.has(item.id))) {
    fail(
      'BYOK_INGEST_EXECUTION_INTENT_MISMATCH',
      409,
      'BYOK execution batch item binding was lost',
    );
  }
  const boundBatch = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE "extension_byok_execution_batches"
     SET "status" = 'BOUND',
         "bound_draft_revision" = $2,
         "bound_draft_version" = $3,
         "bound_at" = $4,
         "updated_at" = $4
     WHERE "id" = $1 AND "status" = 'OPEN'
     RETURNING "id"`,
    input.command.executionBatchId,
    boundDraftRevision,
    boundDraftVersion,
    input.now,
  );
  if (!Array.isArray(boundBatch)
    || boundBatch.length !== 1
    || boundBatch[0]?.id !== input.command.executionBatchId) {
    fail(
      'BYOK_INGEST_EXECUTION_INTENT_MISMATCH',
      409,
      'BYOK execution batch binding was lost',
    );
  }
}

function itemBinding(
  input: CommitExtensionByokGeneratedAssetBatchInput,
  command: ExtensionByokMediaIngestResolvedCommand,
): ExtensionCommandBinding {
  return {
    ...input.binding,
    idempotencyKey: deriveExtensionByokBatchItemIdempotencyKey(
      input.binding.idempotencyKey,
      command.executionIntentId,
    ),
  };
}

function planBatch(
  current: OzonListingDraft,
  input: CommitExtensionByokGeneratedAssetBatchInput,
): { next: OzonListingDraft; items: PlannedBatchItem[] } {
  const sourceRevision = current.revision;
  const sourceVersion = current.draftVersion;
  let working = current;
  const planned: PlannedBatchItem[] = [];
  for (let index = 0; index < input.command.items.length; index += 1) {
    const command = input.command.items[index]!;
    const item = input.items[index]!;
    const binding = itemBinding(input, command);
    let plan: ByokListingMediaBindingResult;
    try {
      plan = planByokGeneratedAssetListingBinding(working, {
        binding,
        command,
        actorUserId: input.actorUserId,
        asset: item.asset,
        now: input.now,
      });
    } catch (error) {
      if (error instanceof ByokListingMediaBindingError) return mapBindingFailure(error);
      throw error;
    }
    planned.push({ command, input: item, itemBinding: binding, plan });
    working = plan.draft;
    if (index < input.command.items.length - 1) {
      working = structuredClone(working);
      working.revision = sourceRevision;
      working.draftVersion = sourceVersion;
    }
  }
  return { next: working, items: planned };
}

async function persistDraft(
  tx: ExtensionCommandTransactionClient,
  current: OzonListingDraft,
  next: OzonListingDraft,
  input: CommitExtensionByokGeneratedAssetBatchInput,
): Promise<void> {
  let persisted: OzonListingDraft;
  try {
    persisted = await applySourceListingDraftCasInTransaction(tx as never, {
      draftId: current.id,
      ownerUserId: input.binding.ownerUserId,
      actorUserId: input.actorUserId,
      expectedRevision: current.revision,
      next,
    }, input.now);
  } catch (error) {
    if (error instanceof OzonListingDraftRepositoryError
      && ['NOT_FOUND', 'VERSION_CONFLICT'].includes(error.code)) {
      fail('BYOK_INGEST_DRAFT_STALE', 409, 'The listing draft changed during BYOK batch binding');
    }
    throw error;
  }
  if (persisted.revision !== current.revision + 1
    || persisted.draftVersion !== current.draftVersion + 1) {
    fail('BYOK_INGEST_DRAFT_STALE', 409, 'The BYOK batch draft binding did not persist exactly');
  }
}

async function completeReceipt(
  tx: ExtensionCommandTransactionClient,
  receiptId: string,
  result: ExtensionByokMediaBatchIngestReceiptResult,
  now: Date,
): Promise<void> {
  const rows = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `UPDATE "extension_command_receipts"
     SET "status" = 'SUCCEEDED',
         "result" = $2::jsonb,
         "failure_code" = NULL,
         "completed_at" = $3
     WHERE "id" = $1 AND "status" = 'PENDING'
     RETURNING "id"`,
    receiptId,
    JSON.stringify(result),
    now,
  );
  if (rows.length !== 1) {
    fail('BYOK_INGEST_RECEIPT_CONFLICT', 409, 'BYOK batch receipt could not be completed');
  }
}

function parseReceiptItem(
  value: unknown,
  input: CommitExtensionByokGeneratedAssetBatchInput,
  index: number,
): ExtensionByokMediaBatchIngestReceiptItem {
  const result = isRecord(value) ? value : null;
  const command = input.command.items[index]!;
  const asset = input.items[index]!.asset;
  const assignment = expectedAssignment(command, asset.id);
  const expectedKeys = [
    'assetId', 'provenanceId', 'executionIntentId', 'providerRequestHash',
    'providerResultSha256', 'normalizedSha256', 'mimeType', 'width', 'height',
    'skuKey', 'slotKey', 'assignmentOrdinal', 'assignmentSha256', 'assignment',
    'policyRevision',
  ];
  if (!result
    || !exactKeys(result, expectedKeys)
    || result.assetId !== asset.id
    || !validIdentifier(result.provenanceId)
    || result.executionIntentId !== command.executionIntentId
    || result.providerRequestHash !== command.providerRequestHash
    || result.providerResultSha256 !== command.resultSha256
    || result.normalizedSha256 !== asset.sha256
    || result.mimeType !== asset.mimeType
    || result.width !== asset.width
    || result.height !== asset.height
    || result.skuKey !== command.skuKey
    || result.slotKey !== command.slotKey
    || result.assignmentOrdinal !== command.assignmentOrdinal
    || typeof result.assignmentSha256 !== 'string'
    || !SHA256_PATTERN.test(result.assignmentSha256)
    || !sameAssignment(result.assignment, assignment)
    || result.policyRevision !== command.readiness.policyRevision) {
    fail('BYOK_INGEST_RECEIPT_CONFLICT', 409, 'BYOK batch receipt item identity conflicts');
  }
  return result as unknown as ExtensionByokMediaBatchIngestReceiptItem;
}

function parseReceiptResult(
  value: unknown,
  input: CommitExtensionByokGeneratedAssetBatchInput,
): ExtensionByokMediaBatchIngestReceiptResult {
  const result = isRecord(value) ? value : null;
  const first = input.command.items[0]!;
  const expectedKeys = [
    'contractVersion', 'executionBatchId', 'requestHash', 'sourceDraftRevision', 'sourceDraftVersion',
    'boundDraftRevision', 'boundDraftVersion', 'erpAiChargeCents', 'items',
  ];
  if (!result
    || !exactKeys(result, expectedKeys)
    || result.contractVersion !== EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION
    || result.executionBatchId !== input.command.executionBatchId
    || result.requestHash !== input.binding.requestHash
    || result.sourceDraftRevision !== first.draftRevision
    || result.sourceDraftVersion !== input.binding.draftVersion
    || result.boundDraftRevision !== first.draftRevision + 1
    || result.boundDraftVersion !== Number(input.binding.draftVersion) + 1
    || result.erpAiChargeCents !== 0
    || !Array.isArray(result.items)
    || result.items.length !== input.items.length) {
    fail('BYOK_INGEST_RECEIPT_CONFLICT', 409, 'BYOK batch receipt identity conflicts');
  }
  return {
    contractVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION,
    executionBatchId: input.command.executionBatchId,
    requestHash: input.binding.requestHash,
    sourceDraftRevision: first.draftRevision,
    sourceDraftVersion: input.binding.draftVersion!,
    boundDraftRevision: first.draftRevision + 1,
    boundDraftVersion: input.binding.draftVersion! + 1,
    erpAiChargeCents: 0,
    items: result.items.map((item, index) => parseReceiptItem(item, input, index)),
  };
}

export function createPrismaExtensionByokGeneratedAssetBatchCommitter(
  client: ExtensionCommandDatabaseClient,
) {
  return async (
    input: CommitExtensionByokGeneratedAssetBatchInput,
  ): Promise<CommitExtensionByokGeneratedAssetBatchResult> => {
    validateInput(input);
    try {
      return await runExtensionCommandSerializableTransaction(client, async (rawTx) => {
        const consumed = await consumeByokMediaIngestGrantInTransaction(rawTx, {
          tokenDigest: input.tokenDigest,
          binding: input.binding,
          receiptId: input.receiptId,
          now: input.now,
        });
        const tx = rawTx as TransactionWithMedia;
        const assetRepository = createPrismaByokGeneratedAssetRepository(tx as never);
        if (consumed.kind === 'replay') {
          if (consumed.receipt.status === 'PENDING') {
            fail('BYOK_INGEST_RECEIPT_PENDING', 409, 'BYOK batch ingest is already in progress');
          }
          if (consumed.receipt.status !== 'SUCCEEDED') {
            fail('BYOK_INGEST_RECEIPT_FAILED', 409, 'The prior BYOK batch ingest failed');
          }
          await lockExactExecutionBatchReservation(rawTx, input, 'BOUND');
          const assets: ByokGeneratedAssetRecord[] = [];
          for (const item of input.items) {
            const asset = await assetRepository.findById({
              assetId: item.asset.id,
              ownerUserId: item.asset.ownerUserId,
            });
            if (!asset || !byokGeneratedAssetMatchesSemanticIdentity(asset, item.asset)) {
              fail('BYOK_INGEST_ASSET_CONFLICT', 409, 'A replayed BYOK batch asset conflicts');
            }
            assets.push(asset);
          }
          return {
            replayed: true,
            receiptId: consumed.receipt.id,
            receipt: parseReceiptResult(consumed.receipt.result, input),
            assets,
          };
        }
        if (consumed.kind !== 'execute') return mapGrantFailure(consumed.kind);

        const reservationItems = await lockExactExecutionBatchReservation(rawTx, input, 'OPEN');
        for (let index = 0; index < input.command.items.length; index += 1) {
          const command = input.command.items[index]!;
          await requireExactExtensionByokExecutionIntentInTransaction(rawTx, {
            binding: input.binding,
            actorUserId: input.actorUserId,
            command,
            expectedExecutionBatchItemId: reservationItems[index]!.itemId,
            reject: fail,
          });
        }
        const current = await lockCurrentSourceListingDraft(rawTx as never, {
          draftId: input.binding.workflowId!,
          ownerUserId: input.binding.ownerUserId,
        });
        if (!current) {
          fail('BYOK_INGEST_DRAFT_STALE', 409, 'The listing draft no longer exists');
        }
        const batchPlan = planBatch(current, input);

        const storedAssets: ByokGeneratedAssetRecord[] = [];
        for (const planned of batchPlan.items) {
          const stored = await assetRepository.createOrReplay(planned.input.asset);
          if (stored.kind === 'conflict'
            || !byokGeneratedAssetMatchesCreateInput(stored.asset, planned.input.asset)) {
            fail('BYOK_INGEST_ASSET_CONFLICT', 409, 'A BYOK batch asset identity conflicts');
          }
          if (planned.input.stagingId
            && !await commitExtensionByokUploadStagingInTransaction(rawTx, {
              stagingId: planned.input.stagingId,
              ownerUserId: input.binding.ownerUserId,
              deviceSessionId: input.binding.sessionId,
              assetId: stored.asset.id,
              requestHash: input.binding.requestHash,
              storageBackend: stored.asset.storageBackend,
              storageNamespaceId: planned.input.stagingStorageNamespaceId!,
              storageKey: stored.asset.storageKey,
              now: input.now,
            })) {
            fail('BYOK_INGEST_STAGING_CONFLICT', 409, 'A BYOK batch staging identity conflicts');
          }
          storedAssets.push(stored.asset);
        }

        // The provenance FK and authority trigger require the exact +1 draft
        // to exist. It remains invisible until this serializable transaction commits.
        await persistDraft(rawTx, current, batchPlan.next, input);

        const provenanceService = createExtensionByokMediaProvenanceService(
          new PrismaExtensionByokMediaProvenanceRepository(tx as never),
        );
        const receiptItems: ExtensionByokMediaBatchIngestReceiptItem[] = [];
        for (let index = 0; index < batchPlan.items.length; index += 1) {
          const planned = batchPlan.items[index]!;
          const asset = storedAssets[index]!;
          let recorded;
          try {
            recorded = await provenanceService.record({
              contractVersion: EXTENSION_BYOK_MEDIA_PROVENANCE_VERSION,
              executionMode: 'BYOK',
              ownerUserId: input.binding.ownerUserId,
              actorUserId: input.actorUserId,
              deviceSessionId: input.binding.sessionId,
              shopId: input.binding.shopId,
              workflowId: input.binding.workflowId,
              draftRevision: planned.command.draftRevision,
              draftVersion: input.binding.draftVersion,
              boundDraftRevision: planned.plan.boundDraftRevision,
              boundDraftVersion: planned.plan.boundDraftVersion,
              skuKey: planned.command.skuKey,
              slotKey: planned.command.slotKey,
              assignmentOrdinal: planned.plan.assignmentOrdinal,
              assignmentSha256: planned.plan.assignmentSha256,
              policyRevision: planned.command.readiness.policyRevision,
              endpointOriginSha256: sha256(planned.command.providerOrigin),
              model: planned.command.model,
              operation: planned.command.providerOperation,
              providerRequestIdSha256: planned.command.providerRequestIdSha256,
              promptSha256: planned.command.promptSha256,
              negativePromptSha256: planned.command.negativePromptSha256,
              sourceSha256: planned.command.sourceSha256,
              referenceSha256s: planned.command.referenceSha256s,
              maskSha256: planned.command.maskSha256,
              resultSha256: asset.sha256,
              assetId: asset.id,
              resultMimeType: asset.mimeType,
              resultWidth: asset.width,
              resultHeight: asset.height,
              idempotencyKey: planned.itemBinding.idempotencyKey,
              requestHash: input.binding.requestHash,
              executionIntentId: planned.command.executionIntentId,
              publishIntentId: null,
              publishReceiptId: null,
              erpAiChargeCents: 0,
            });
          } catch (error) {
            if (error instanceof ExtensionByokMediaProvenanceError) {
              fail('BYOK_INGEST_ASSET_CONFLICT', 409, 'BYOK batch provenance identity conflicts');
            }
            throw error;
          }
          if (recorded.idempotent) {
            fail(
              'BYOK_INGEST_EXECUTION_INTENT_ALREADY_USED',
              409,
              'BYOK execution intent was already bound to provenance',
            );
          }
          receiptItems.push({
            assetId: asset.id,
            provenanceId: recorded.provenance.id,
            executionIntentId: planned.command.executionIntentId,
            providerRequestHash: planned.command.providerRequestHash,
            providerResultSha256: planned.command.resultSha256,
            normalizedSha256: asset.sha256,
            mimeType: asset.mimeType,
            width: asset.width,
            height: asset.height,
            skuKey: planned.command.skuKey,
            slotKey: planned.command.slotKey,
            assignmentOrdinal: planned.plan.assignmentOrdinal,
            assignmentSha256: planned.plan.assignmentSha256,
            assignment: planned.plan.assignment,
            policyRevision: planned.command.readiness.policyRevision,
          });
        }

        await bindExecutionBatchReservation(rawTx, input, reservationItems);
        const first = input.command.items[0]!;
        const receipt: ExtensionByokMediaBatchIngestReceiptResult = {
          contractVersion: EXTENSION_BYOK_MEDIA_BATCH_INGEST_RECEIPT_VERSION,
          executionBatchId: input.command.executionBatchId,
          requestHash: input.binding.requestHash,
          sourceDraftRevision: first.draftRevision,
          sourceDraftVersion: input.binding.draftVersion!,
          boundDraftRevision: first.draftRevision + 1,
          boundDraftVersion: input.binding.draftVersion! + 1,
          erpAiChargeCents: 0,
          items: receiptItems,
        };
        await completeReceipt(rawTx, consumed.receipt.id, receipt, input.now);
        return {
          replayed: false,
          receiptId: consumed.receipt.id,
          receipt,
          assets: storedAssets,
        };
      });
    } catch (error) {
      if (isExtensionAiImageExecutionModeConflict(error)) {
        fail(
          'BYOK_INGEST_MODE_CONFLICT',
          409,
          'This listing draft already started ERP-hosted image execution',
        );
      }
      throw error;
    }
  };
}

import {
  isExtensionAiImageExecutionModeConflict,
} from './extension-ai-image-execution-mode.js';
import {
  runExtensionCommandSerializableTransaction,
  type ExtensionCommandDatabaseClient,
  type ExtensionCommandTransactionClient,
} from './extension-command-grants-prisma.js';
import type {
  ExtensionByokExecutionBatchCancelResult,
  ExtensionByokExecutionBatchClaimResult,
  ExtensionByokExecutionBatchCreateRecord,
  ExtensionByokExecutionBatchItemRecord,
  ExtensionByokExecutionBatchLoadResult,
  ExtensionByokExecutionBatchRecord,
  ExtensionByokExecutionBatchRepository,
  ExtensionByokExecutionBatchSuccessorClaimResult,
} from './extension-byok-execution-batch.js';
import type {
  ExtensionByokExecutionIntentIdentity,
  ExtensionByokExecutionIntentRecord,
} from './extension-byok-execution-intent.js';

export type ExtensionByokExecutionBatchPrismaClient = ExtensionCommandDatabaseClient;

const MAX_RETAINED_ATTEMPTS = 500;

const BATCH_COLUMNS = `
  "id",
  "contract_version" AS "contractVersion",
  "status",
  "owner_user_id" AS "ownerUserId",
  "actor_user_id" AS "actorUserId",
  "device_session_id" AS "deviceSessionId",
  "shop_id" AS "shopId",
  "listing_workflow_id" AS "listingWorkflowId",
  "draft_revision" AS "draftRevision",
  "draft_version" AS "draftVersion",
  "source_platform" AS "sourcePlatform",
  "source_product_id" AS "sourceProductId",
  "source_capture_snapshot_id" AS "sourceCaptureSnapshotId",
  "supply_goods_id" AS "supplyGoodsId",
  "first_assignment_ordinal" AS "firstAssignmentOrdinal",
  "item_count" AS "itemCount",
  "idempotency_key" AS "idempotencyKey",
  "request_hash" AS "requestHash",
  "bound_draft_revision" AS "boundDraftRevision",
  "bound_draft_version" AS "boundDraftVersion",
  "bound_at" AS "boundAt",
  "cancelled_at" AS "cancelledAt",
  "created_at" AS "createdAt",
  "updated_at" AS "updatedAt"`;

const ITEM_COLUMNS = `
  "id",
  "batch_id" AS "batchId",
  "owner_user_id" AS "ownerUserId",
  "listing_workflow_id" AS "listingWorkflowId",
  "draft_revision" AS "draftRevision",
  "draft_version" AS "draftVersion",
  "item_index" AS "itemIndex",
  "sku_key" AS "skuKey",
  "slot_key" AS "slotKey",
  "assignment_ordinal" AS "assignmentOrdinal",
  "status",
  "bound_at" AS "boundAt",
  "released_at" AS "releasedAt",
  "created_at" AS "createdAt",
  "updated_at" AS "updatedAt"`;

const INTENT_COLUMNS = `
  "id",
  "contract_version" AS "contractVersion",
  "execution_mode" AS "executionMode",
  "owner_user_id" AS "ownerUserId",
  "actor_user_id" AS "actorUserId",
  "device_session_id" AS "deviceSessionId",
  "shop_id" AS "shopId",
  "listing_workflow_id" AS "listingWorkflowId",
  "draft_revision" AS "draftRevision",
  "draft_version" AS "draftVersion",
  "source_capture_snapshot_id" AS "sourceCaptureSnapshotId",
  "supply_goods_id" AS "supplyGoodsId",
  "sku_key" AS "skuKey",
  "slot_key" AS "slotKey",
  "assignment_mode" AS "assignmentMode",
  "assignment_ordinal" AS "assignmentOrdinal",
  "policy_revision" AS "policyRevision",
  "provider_origin_sha256" AS "providerOriginSha256",
  "model",
  "operation",
  "request_mode" AS "requestMode",
  "provider_idempotency_key" AS "providerIdempotencyKey",
  "provider_request_hash" AS "providerRequestHash",
  "request_hash" AS "requestHash",
  "execution_batch_item_id" AS "executionBatchItemId",
  "execution_batch_attempt_index" AS "executionBatchAttemptIndex",
  "outcome",
  "provider_request_id_sha256" AS "providerRequestIdSha256",
  "result_sha256" AS "resultSha256",
  "outcome_updated_at" AS "outcomeUpdatedAt",
  "created_at" AS "createdAt",
  "updated_at" AS "updatedAt"`;

class BatchClaimRollback extends Error {
  constructor(public readonly result: ExtensionByokExecutionBatchClaimResult) {
    super('Rollback rejected BYOK execution batch claim');
    this.name = 'BatchClaimRollback';
  }
}

class BatchSuccessorRollback extends Error {
  constructor(public readonly result: ExtensionByokExecutionBatchSuccessorClaimResult) {
    super('Rollback rejected BYOK execution batch successor');
    this.name = 'BatchSuccessorRollback';
  }
}

class BatchCancelRollback extends Error {
  constructor(public readonly result: ExtensionByokExecutionBatchCancelResult) {
    super('Rollback rejected BYOK execution batch cancellation');
    this.name = 'BatchCancelRollback';
  }
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function rows(value: unknown, label: string): Record<string, unknown>[] {
  if (!Array.isArray(value) || value.some((entry) => record(entry) === null)) {
    throw new Error(`Extension BYOK execution ${label} rows are invalid`);
  }
  return value as Record<string, unknown>[];
}

function date(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

function nullableDate(value: unknown): Date | null {
  return value == null ? null : date(value);
}

function mapBatch(value: unknown): ExtensionByokExecutionBatchRecord {
  const source = record(value);
  if (!source) throw new Error('Extension BYOK execution batch row is invalid');
  const mapped: Record<string, unknown> & {
    boundAt: Date | null;
    cancelledAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } = {
    ...source,
    boundAt: nullableDate(source.boundAt),
    cancelledAt: nullableDate(source.cancelledAt),
    createdAt: date(source.createdAt),
    updatedAt: date(source.updatedAt),
  };
  if (typeof mapped.id !== 'string'
    || mapped.contractVersion !== 'extension-byok-execution-batch/v1'
    || !['OPEN', 'BOUND', 'CANCELLED'].includes(String(mapped.status))
    || typeof mapped.ownerUserId !== 'string'
    || typeof mapped.actorUserId !== 'string'
    || typeof mapped.deviceSessionId !== 'string'
    || typeof mapped.shopId !== 'string'
    || typeof mapped.listingWorkflowId !== 'string'
    || !Number.isSafeInteger(mapped.draftRevision)
    || !Number.isSafeInteger(mapped.draftVersion)
    || !['1688', 'pdd', 'taobao', 'tmall'].includes(String(mapped.sourcePlatform))
    || typeof mapped.sourceProductId !== 'string'
    || typeof mapped.sourceCaptureSnapshotId !== 'string'
    || typeof mapped.supplyGoodsId !== 'string'
    || !Number.isSafeInteger(mapped.firstAssignmentOrdinal)
    || !Number.isSafeInteger(mapped.itemCount)
    || typeof mapped.idempotencyKey !== 'string'
    || typeof mapped.requestHash !== 'string'
    || (mapped.boundDraftRevision !== null && !Number.isSafeInteger(mapped.boundDraftRevision))
    || (mapped.boundDraftVersion !== null && !Number.isSafeInteger(mapped.boundDraftVersion))
    || !Number.isFinite(mapped.createdAt.getTime())
    || !Number.isFinite(mapped.updatedAt.getTime())
    || (mapped.boundAt !== null && !Number.isFinite(mapped.boundAt.getTime()))
    || (mapped.cancelledAt !== null && !Number.isFinite(mapped.cancelledAt.getTime()))) {
    throw new Error('Extension BYOK execution batch row is invalid');
  }
  return mapped as unknown as ExtensionByokExecutionBatchRecord;
}

function mapItem(value: unknown): ExtensionByokExecutionBatchItemRecord {
  const source = record(value);
  if (!source) throw new Error('Extension BYOK execution batch item row is invalid');
  const mapped: Record<string, unknown> & {
    boundAt: Date | null;
    releasedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } = {
    ...source,
    boundAt: nullableDate(source.boundAt),
    releasedAt: nullableDate(source.releasedAt),
    createdAt: date(source.createdAt),
    updatedAt: date(source.updatedAt),
  };
  if (typeof mapped.id !== 'string'
    || typeof mapped.batchId !== 'string'
    || typeof mapped.ownerUserId !== 'string'
    || typeof mapped.listingWorkflowId !== 'string'
    || !Number.isSafeInteger(mapped.draftRevision)
    || !Number.isSafeInteger(mapped.draftVersion)
    || !Number.isSafeInteger(mapped.itemIndex)
    || typeof mapped.skuKey !== 'string'
    || typeof mapped.slotKey !== 'string'
    || !Number.isSafeInteger(mapped.assignmentOrdinal)
    || !['ACTIVE', 'BOUND', 'RELEASED'].includes(String(mapped.status))
    || (mapped.boundAt !== null && !Number.isFinite(mapped.boundAt.getTime()))
    || (mapped.releasedAt !== null && !Number.isFinite(mapped.releasedAt.getTime()))
    || !Number.isFinite(mapped.createdAt.getTime())
    || !Number.isFinite(mapped.updatedAt.getTime())) {
    throw new Error('Extension BYOK execution batch item row is invalid');
  }
  return mapped as unknown as ExtensionByokExecutionBatchItemRecord;
}

function mapIntent(value: unknown): ExtensionByokExecutionIntentRecord {
  const source = record(value);
  if (!source) throw new Error('Extension BYOK execution batch intent row is invalid');
  const mapped: Record<string, unknown> & {
    executionBatchItemId: unknown;
    executionBatchAttemptIndex: unknown;
    outcomeUpdatedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  } = {
    ...source,
    executionBatchItemId: source.executionBatchItemId ?? null,
    executionBatchAttemptIndex: source.executionBatchAttemptIndex ?? null,
    outcomeUpdatedAt: nullableDate(source.outcomeUpdatedAt),
    createdAt: date(source.createdAt),
    updatedAt: date(source.updatedAt),
  };
  if (typeof mapped.id !== 'string'
    || mapped.contractVersion !== 'extension-byok-execution-intent/v1'
    || mapped.executionMode !== 'BYOK'
    || typeof mapped.ownerUserId !== 'string'
    || typeof mapped.actorUserId !== 'string'
    || typeof mapped.deviceSessionId !== 'string'
    || typeof mapped.shopId !== 'string'
    || typeof mapped.listingWorkflowId !== 'string'
    || !Number.isSafeInteger(mapped.draftRevision)
    || !Number.isSafeInteger(mapped.draftVersion)
    || typeof mapped.sourceCaptureSnapshotId !== 'string'
    || typeof mapped.supplyGoodsId !== 'string'
    || typeof mapped.skuKey !== 'string'
    || typeof mapped.slotKey !== 'string'
    || mapped.assignmentMode !== 'APPEND'
    || !Number.isSafeInteger(mapped.assignmentOrdinal)
    || !Number.isSafeInteger(mapped.policyRevision)
    || typeof mapped.providerOriginSha256 !== 'string'
    || typeof mapped.model !== 'string'
    || !['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']
      .includes(String(mapped.operation))
    || !['json', 'multipart'].includes(String(mapped.requestMode))
    || typeof mapped.providerIdempotencyKey !== 'string'
    || typeof mapped.providerRequestHash !== 'string'
    || typeof mapped.requestHash !== 'string'
    || !(
      (mapped.executionBatchItemId === null && mapped.executionBatchAttemptIndex === null)
      || (typeof mapped.executionBatchItemId === 'string'
        && Number.isSafeInteger(mapped.executionBatchAttemptIndex)
        && Number(mapped.executionBatchAttemptIndex) >= 0)
    )
    || !['PENDING', 'SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME']
      .includes(String(mapped.outcome))
    || (mapped.providerRequestIdSha256 !== null
      && typeof mapped.providerRequestIdSha256 !== 'string')
    || (mapped.resultSha256 !== null && typeof mapped.resultSha256 !== 'string')
    || !Number.isFinite(mapped.createdAt.getTime())
    || !Number.isFinite(mapped.updatedAt.getTime())
    || (mapped.outcomeUpdatedAt !== null && !Number.isFinite(mapped.outcomeUpdatedAt.getTime()))) {
    throw new Error('Extension BYOK execution batch intent row is invalid');
  }
  return mapped as unknown as ExtensionByokExecutionIntentRecord;
}

const BATCH_IDENTITY_KEYS = [
  'contractVersion', 'ownerUserId', 'actorUserId', 'deviceSessionId', 'shopId',
  'listingWorkflowId', 'draftRevision', 'draftVersion', 'sourcePlatform', 'sourceProductId',
  'sourceCaptureSnapshotId', 'supplyGoodsId', 'firstAssignmentOrdinal', 'itemCount',
  'idempotencyKey', 'requestHash',
] as const;

const ITEM_IDENTITY_KEYS = [
  'ownerUserId', 'listingWorkflowId', 'draftRevision', 'draftVersion', 'itemIndex',
  'skuKey', 'slotKey', 'assignmentOrdinal',
] as const;

const INTENT_IDENTITY_KEYS = [
  'contractVersion', 'executionMode', 'ownerUserId', 'actorUserId', 'deviceSessionId',
  'shopId', 'listingWorkflowId', 'draftRevision', 'draftVersion', 'sourceCaptureSnapshotId',
  'supplyGoodsId', 'skuKey', 'slotKey', 'assignmentMode', 'assignmentOrdinal',
  'policyRevision', 'providerOriginSha256', 'model', 'operation', 'requestMode',
  'providerIdempotencyKey', 'providerRequestHash', 'requestHash',
] as const;

function sameKeys<T extends object>(
  left: T,
  right: T,
  keys: readonly (keyof T)[],
): boolean {
  return keys.every((key) => left[key] === right[key]);
}

function validateCreateInput(input: ExtensionByokExecutionBatchCreateRecord): void {
  if (input.batch.status !== 'OPEN'
    || input.items.length < 1
    || input.items.length > 4
    || input.items.length !== input.batch.itemCount
    || input.intents.length !== input.items.length
    || input.items.some((item, index) => (
      item.batchId !== input.batch.id
      || item.itemIndex !== index
      || item.status !== 'ACTIVE'
      || item.ownerUserId !== input.batch.ownerUserId
      || item.listingWorkflowId !== input.batch.listingWorkflowId
      || item.draftRevision !== input.batch.draftRevision
      || item.draftVersion !== input.batch.draftVersion
      || item.assignmentOrdinal !== input.batch.firstAssignmentOrdinal + index
    ))
    || input.intents.some((intent, index) => (
      intent.executionBatchItemId !== input.items[index]?.id
      || intent.executionBatchAttemptIndex !== 0
      || intent.outcome !== 'PENDING'
    ))) {
    throw new Error('Extension BYOK execution batch create input is inconsistent');
  }
}

interface AuthorityContext {
  ownerUserId: string;
  actorUserId: string;
  deviceSessionId: string;
  shopId: string;
  listingWorkflowId: string;
  draftRevision: number;
  draftVersion: number;
  sourceCaptureSnapshotId: string;
  supplyGoodsId: string;
}

async function authority(
  tx: ExtensionCommandTransactionClient,
  input: AuthorityContext,
): Promise<'allowed' | 'forbidden' | 'stale'> {
  const result = rows(await tx.$queryRawUnsafe(
    `SELECT
       EXISTS (
         SELECT 1
         FROM "extension_device_sessions" session
         JOIN "extension_device_shop_grants" shop_grant
           ON shop_grant."session_id" = session."id"
          AND shop_grant."shop_id" = $4
          AND shop_grant."status" = 'ACTIVE'
         JOIN "shops" shop
           ON shop."id" = shop_grant."shop_id"
          AND shop."user_id" = session."owner_user_id"
          AND shop."platform" = 'OZON'
          AND shop."status" = 'ACTIVE'
         JOIN "users" owner_account
           ON owner_account."id" = session."owner_user_id"
          AND owner_account."status" = 'ACTIVE'
          AND owner_account."role" IN ('USER', 'ADMIN')
          AND owner_account."parent_id" IS NULL
         JOIN "users" actor_account
           ON actor_account."id" = session."actor_user_id"
          AND actor_account."status" = 'ACTIVE'
          AND actor_account."role" IN ('USER', 'ADMIN')
          AND actor_account."parent_id" IS NULL
         WHERE session."id" = $1
           AND session."owner_user_id" = $2
           AND session."actor_user_id" = $3
           AND session."actor_user_id" = session."owner_user_id"
           AND session."status" = 'ACTIVE'
           AND session."expires_at" > CURRENT_TIMESTAMP
           AND 'byok:media:ingest' = ANY(session."scopes")
       ) AS "allowed",
       EXISTS (
         SELECT 1
         FROM "source_listing_workflows" workflow
         JOIN "source_listing_draft_versions" draft
           ON draft."workflow_id" = workflow."id"
          AND draft."owner_user_id" = workflow."owner_user_id"
          AND draft."revision" = workflow."current_revision"
          AND draft."draft_version" = workflow."current_draft_version"
         WHERE workflow."id" = $5
           AND workflow."owner_user_id" = $2
           AND workflow."shop_id" = $4
           AND workflow."current_revision" = $6
           AND workflow."current_draft_version" = $7
           AND workflow."current_source_capture_snapshot_id" = $8
           AND workflow."supply_goods_id" = $9
           AND workflow."status" = 'ACTIVE'
           AND draft."shop_id" = $4
           AND draft."source_capture_snapshot_id" = $8
           AND draft."supply_goods_id" = $9
           AND draft."status" = 'ACTIVE'
           AND draft."stage" <> 'PUBLISHED'
       ) AS "current"`,
    input.deviceSessionId,
    input.ownerUserId,
    input.actorUserId,
    input.shopId,
    input.listingWorkflowId,
    input.draftRevision,
    input.draftVersion,
    input.sourceCaptureSnapshotId,
    input.supplyGoodsId,
  ), 'authority');
  const resultRow = result[0];
  if (result.length !== 1
    || typeof resultRow?.allowed !== 'boolean'
    || typeof resultRow.current !== 'boolean') {
    throw new Error('Extension BYOK execution batch authority result is invalid');
  }
  if (!resultRow.allowed) return 'forbidden';
  return resultRow.current ? 'allowed' : 'stale';
}

async function claimMode(
  tx: ExtensionCommandTransactionClient,
  input: AuthorityContext,
): Promise<void> {
  await tx.$queryRawUnsafe(
    `SELECT claim_extension_ai_image_execution_mode(
       $1, $2, $3, $4::INTEGER, $5::INTEGER, 'BYOK'::TEXT
     )::TEXT AS "claimed"`,
    input.ownerUserId,
    input.shopId,
    input.listingWorkflowId,
    input.draftRevision,
    input.draftVersion,
  );
}

async function loadClaimReplay(
  tx: ExtensionCommandTransactionClient,
  input: ExtensionByokExecutionBatchCreateRecord,
): Promise<ExtensionByokExecutionBatchClaimResult | null> {
  const batchRows = rows(await tx.$queryRawUnsafe(
    `SELECT ${BATCH_COLUMNS}
     FROM "extension_byok_execution_batches"
     WHERE "owner_user_id" = $1
       AND ("idempotency_key" = $2 OR "request_hash" = $3)
     ORDER BY "created_at", "id"
     LIMIT 2
     FOR UPDATE`,
    input.batch.ownerUserId,
    input.batch.idempotencyKey,
    input.batch.requestHash,
  ), 'batch replay');
  if (batchRows.length === 0) return null;
  if (batchRows.length !== 1) return { kind: 'idempotency_conflict' };
  const batch = mapBatch(batchRows[0]);
  if (!sameKeys(batch, input.batch, BATCH_IDENTITY_KEYS)) {
    return { kind: 'idempotency_conflict' };
  }
  const itemRows = rows(await tx.$queryRawUnsafe(
    `SELECT ${ITEM_COLUMNS}
     FROM "extension_byok_execution_batch_items"
     WHERE "batch_id" = $1
     ORDER BY "item_index"
     FOR UPDATE`,
    batch.id,
  ), 'batch item replay');
  const intentRows = rows(await tx.$queryRawUnsafe(
    `SELECT ${INTENT_COLUMNS}
     FROM "extension_byok_execution_intents" intent
     WHERE intent."execution_batch_item_id" IN (
       SELECT item."id"
       FROM "extension_byok_execution_batch_items" item
       WHERE item."batch_id" = $1
     )
       AND intent."execution_batch_attempt_index" = 0
     ORDER BY (
       SELECT item."item_index"
       FROM "extension_byok_execution_batch_items" item
       WHERE item."id" = intent."execution_batch_item_id"
     )
     FOR UPDATE`,
    batch.id,
  ), 'batch intent replay');
  if (itemRows.length !== input.items.length || intentRows.length !== input.intents.length) {
    throw new Error('Extension BYOK execution batch replay is incomplete');
  }
  const items = itemRows.map(mapItem);
  const intents = intentRows.map(mapIntent);
  const exact = items.every((item, index) => (
    item.batchId === batch.id
    && sameKeys(item, input.items[index]!, ITEM_IDENTITY_KEYS)
  )) && intents.every((intent, index) => (
    intent.executionBatchItemId === items[index]!.id
    && intent.executionBatchAttemptIndex === 0
    && sameKeys(intent, input.intents[index]!, INTENT_IDENTITY_KEYS)
  ));
  return exact
    ? { kind: 'replayed', batch, intents }
    : { kind: 'idempotency_conflict' };
}

async function retainedAttemptCount(
  tx: ExtensionCommandTransactionClient,
  input: AuthorityContext,
): Promise<number> {
  const result = rows(await tx.$queryRawUnsafe(
    `SELECT COUNT(*)::INTEGER AS "count"
     FROM "extension_byok_execution_intents"
     WHERE "owner_user_id" = $1
       AND "device_session_id" = $2
       AND "listing_workflow_id" = $3
       AND "draft_revision" = $4
       AND "draft_version" = $5`,
    input.ownerUserId,
    input.deviceSessionId,
    input.listingWorkflowId,
    input.draftRevision,
    input.draftVersion,
  ), 'retained attempt count');
  const countRow = result[0];
  if (result.length !== 1 || !countRow || !Number.isSafeInteger(countRow.count)) {
    throw new Error('Extension BYOK execution batch capacity result is invalid');
  }
  return Number(countRow.count);
}

async function hasBlockingStandaloneIntent(
  tx: ExtensionCommandTransactionClient,
  input: ExtensionByokExecutionBatchCreateRecord,
): Promise<boolean> {
  const slots = input.items.map((item) => item.slotKey);
  const ordinals = input.items.map((item) => item.assignmentOrdinal);
  const result = rows(await tx.$queryRawUnsafe(
    `SELECT EXISTS (
       SELECT 1
       FROM "extension_byok_execution_intents" intent
       LEFT JOIN "extension_byok_media_provenance" provenance
         ON provenance."execution_intent_id" = intent."id"
       WHERE intent."owner_user_id" = $1
         AND intent."listing_workflow_id" = $2
         AND intent."draft_revision" = $3
         AND intent."draft_version" = $4
         AND intent."execution_batch_item_id" IS NULL
         AND (
           intent."outcome" IN ('PENDING', 'UNKNOWN_OUTCOME')
           OR (intent."outcome" = 'SUCCEEDED' AND provenance."id" IS NULL)
         )
         AND (
           intent."slot_key" = ANY($5::text[])
           OR intent."assignment_ordinal" = ANY($6::integer[])
         )
     ) AS "reserved"`,
    input.batch.ownerUserId,
    input.batch.listingWorkflowId,
    input.batch.draftRevision,
    input.batch.draftVersion,
    slots,
    ordinals,
  ), 'standalone intent reservation');
  if (result.length !== 1 || typeof result[0]?.reserved !== 'boolean') {
    throw new Error('Extension BYOK standalone reservation result is invalid');
  }
  return Boolean(result[0].reserved);
}

async function insertBatch(
  tx: ExtensionCommandTransactionClient,
  input: ExtensionByokExecutionBatchRecord,
): Promise<ExtensionByokExecutionBatchRecord> {
  const inserted = rows(await tx.$queryRawUnsafe(
    `INSERT INTO "extension_byok_execution_batches"
      ("id", "contract_version", "status", "owner_user_id", "actor_user_id",
       "device_session_id", "shop_id", "listing_workflow_id", "draft_revision",
       "draft_version", "source_platform", "source_product_id",
       "source_capture_snapshot_id", "supply_goods_id", "first_assignment_ordinal",
       "item_count", "idempotency_key", "request_hash", "bound_draft_revision",
       "bound_draft_version", "bound_at", "cancelled_at", "created_at", "updated_at")
     VALUES
      ($1, $2, 'OPEN', $3, $4, $5, $6, $7, $8::INTEGER, $9::INTEGER, $10, $11,
       $12, $13, $14::INTEGER, $15::SMALLINT, $16, $17, NULL, NULL, NULL, NULL, $18, $18)
     RETURNING ${BATCH_COLUMNS}`,
    input.id,
    input.contractVersion,
    input.ownerUserId,
    input.actorUserId,
    input.deviceSessionId,
    input.shopId,
    input.listingWorkflowId,
    input.draftRevision,
    input.draftVersion,
    input.sourcePlatform,
    input.sourceProductId,
    input.sourceCaptureSnapshotId,
    input.supplyGoodsId,
    input.firstAssignmentOrdinal,
    input.itemCount,
    input.idempotencyKey,
    input.requestHash,
    input.createdAt,
  ), 'batch insert');
  if (inserted.length !== 1) throw new Error('Extension BYOK execution batch insert was lost');
  const stored = mapBatch(inserted[0]);
  if (!sameKeys(stored, input, BATCH_IDENTITY_KEYS)) {
    throw new Error('Extension BYOK execution batch insert identity changed');
  }
  return stored;
}

async function insertItem(
  tx: ExtensionCommandTransactionClient,
  input: ExtensionByokExecutionBatchItemRecord,
): Promise<ExtensionByokExecutionBatchItemRecord> {
  const inserted = rows(await tx.$queryRawUnsafe(
    `INSERT INTO "extension_byok_execution_batch_items"
      ("id", "batch_id", "owner_user_id", "listing_workflow_id", "draft_revision",
       "draft_version", "item_index", "sku_key", "slot_key", "assignment_ordinal",
       "status", "bound_at", "released_at", "created_at", "updated_at")
     VALUES
      ($1, $2, $3, $4, $5::INTEGER, $6::INTEGER, $7::SMALLINT, $8, $9,
       $10::INTEGER, 'ACTIVE', NULL, NULL, $11, $11)
     RETURNING ${ITEM_COLUMNS}`,
    input.id,
    input.batchId,
    input.ownerUserId,
    input.listingWorkflowId,
    input.draftRevision,
    input.draftVersion,
    input.itemIndex,
    input.skuKey,
    input.slotKey,
    input.assignmentOrdinal,
    input.createdAt,
  ), 'batch item insert');
  if (inserted.length !== 1) {
    throw new Error('Extension BYOK execution batch item insert was lost');
  }
  const stored = mapItem(inserted[0]);
  if (stored.batchId !== input.batchId
    || !sameKeys(stored, input, ITEM_IDENTITY_KEYS)) {
    throw new Error('Extension BYOK execution batch item insert identity changed');
  }
  return stored;
}

async function insertIntent(
  tx: ExtensionCommandTransactionClient,
  input: ExtensionByokExecutionIntentRecord,
): Promise<ExtensionByokExecutionIntentRecord> {
  const inserted = rows(await tx.$queryRawUnsafe(
    `INSERT INTO "extension_byok_execution_intents"
      ("id", "contract_version", "execution_mode", "owner_user_id", "actor_user_id",
       "device_session_id", "shop_id", "listing_workflow_id", "draft_revision",
       "draft_version", "source_capture_snapshot_id", "supply_goods_id", "sku_key",
       "slot_key", "assignment_mode", "assignment_ordinal", "policy_revision",
       "provider_origin_sha256", "model", "operation", "request_mode",
       "provider_idempotency_key", "provider_request_hash", "request_hash",
       "execution_batch_item_id", "execution_batch_attempt_index", "outcome",
       "provider_request_id_sha256", "result_sha256", "outcome_updated_at", "created_at",
       "updated_at")
     VALUES
      ($1, $2, 'BYOK', $3, $4, $5, $6, $7, $8::INTEGER, $9::INTEGER, $10, $11,
       $12, $13, 'APPEND', $14::INTEGER, $15::INTEGER, $16, $17,
       $18::"AiMediaOperation", $19, $20, $21, $22, $23, $24::SMALLINT,
       'PENDING', NULL, NULL, NULL, $25, $25)
     RETURNING ${INTENT_COLUMNS}`,
    input.id,
    input.contractVersion,
    input.ownerUserId,
    input.actorUserId,
    input.deviceSessionId,
    input.shopId,
    input.listingWorkflowId,
    input.draftRevision,
    input.draftVersion,
    input.sourceCaptureSnapshotId,
    input.supplyGoodsId,
    input.skuKey,
    input.slotKey,
    input.assignmentOrdinal,
    input.policyRevision,
    input.providerOriginSha256,
    input.model,
    input.operation,
    input.requestMode,
    input.providerIdempotencyKey,
    input.providerRequestHash,
    input.requestHash,
    input.executionBatchItemId,
    input.executionBatchAttemptIndex,
    input.createdAt,
  ), 'batch intent insert');
  if (inserted.length !== 1) {
    throw new Error('Extension BYOK execution batch intent insert was lost');
  }
  const stored = mapIntent(inserted[0]);
  if (stored.executionBatchItemId !== input.executionBatchItemId
    || stored.executionBatchAttemptIndex !== input.executionBatchAttemptIndex
    || !sameKeys(stored, input, INTENT_IDENTITY_KEYS)) {
    throw new Error('Extension BYOK execution batch intent insert identity changed');
  }
  return stored;
}

async function claimBatchTransaction(
  tx: ExtensionCommandTransactionClient,
  input: ExtensionByokExecutionBatchCreateRecord,
): Promise<ExtensionByokExecutionBatchClaimResult> {
  const decision = await authority(tx, input.batch);
  if (decision !== 'allowed') return { kind: decision };
  await claimMode(tx, input.batch);
  const replay = await loadClaimReplay(tx, input);
  if (replay) {
    if (replay.kind !== 'replayed') throw new BatchClaimRollback(replay);
    return replay;
  }
  if (await hasBlockingStandaloneIntent(tx, input)) {
    throw new BatchClaimRollback({ kind: 'reservation_conflict' });
  }
  const count = await retainedAttemptCount(tx, input.batch);
  if (count + input.intents.length > MAX_RETAINED_ATTEMPTS) {
    throw new BatchClaimRollback({ kind: 'capacity_exceeded' });
  }
  const batch = await insertBatch(tx, input.batch);
  for (const item of input.items) await insertItem(tx, item);
  const intents: ExtensionByokExecutionIntentRecord[] = [];
  for (const intent of input.intents) intents.push(await insertIntent(tx, intent));
  return { kind: 'created', batch, intents };
}

async function loadBatchById(
  tx: ExtensionCommandTransactionClient,
  batchId: string,
): Promise<ExtensionByokExecutionBatchRecord | null> {
  const result = rows(await tx.$queryRawUnsafe(
    `SELECT ${BATCH_COLUMNS}
     FROM "extension_byok_execution_batches"
     WHERE "id" = $1
     LIMIT 2
     FOR UPDATE`,
    batchId,
  ), 'batch lookup');
  if (result.length > 1) throw new Error('Extension BYOK execution batch lookup is ambiguous');
  return result.length === 0 ? null : mapBatch(result[0]);
}

function identityMatches(
  batch: ExtensionByokExecutionBatchRecord,
  identity: ExtensionByokExecutionIntentIdentity,
): boolean {
  return batch.ownerUserId === identity.ownerUserId
    && batch.actorUserId === identity.actorUserId
    && batch.deviceSessionId === identity.deviceSessionId;
}

function validateLoadedBatchState(batch: ExtensionByokExecutionBatchRecord): void {
  const open = batch.status === 'OPEN'
    && batch.boundDraftRevision === null
    && batch.boundDraftVersion === null
    && batch.boundAt === null
    && batch.cancelledAt === null;
  const bound = batch.status === 'BOUND'
    && batch.boundDraftRevision === batch.draftRevision + 1
    && batch.boundDraftVersion === batch.draftVersion + 1
    && batch.boundAt !== null
    && batch.cancelledAt === null;
  const cancelled = batch.status === 'CANCELLED'
    && batch.boundDraftRevision === null
    && batch.boundDraftVersion === null
    && batch.boundAt === null
    && batch.cancelledAt !== null;
  if ((!open && !bound && !cancelled)
    || batch.draftRevision < 1
    || batch.draftVersion < 1
    || batch.firstAssignmentOrdinal < 0
    || batch.firstAssignmentOrdinal > 499
    || batch.itemCount < 1
    || batch.itemCount > 4
    || batch.firstAssignmentOrdinal + batch.itemCount > 500) {
    throw new Error('Extension BYOK execution batch recovery state is invalid');
  }
}

function validateLoadedItems(
  batch: ExtensionByokExecutionBatchRecord,
  items: ExtensionByokExecutionBatchItemRecord[],
): void {
  const expectedStatus = batch.status === 'OPEN'
    ? 'ACTIVE'
    : batch.status === 'BOUND' ? 'BOUND' : 'RELEASED';
  const ids = new Set<string>();
  const slots = new Set<string>();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    const timestampsMatch = item.status === 'ACTIVE'
      ? item.boundAt === null && item.releasedAt === null
      : item.status === 'BOUND'
        ? item.boundAt !== null && item.releasedAt === null
        : item.boundAt === null && item.releasedAt !== null;
    if (item.batchId !== batch.id
      || item.ownerUserId !== batch.ownerUserId
      || item.listingWorkflowId !== batch.listingWorkflowId
      || item.draftRevision !== batch.draftRevision
      || item.draftVersion !== batch.draftVersion
      || item.itemIndex !== index
      || item.assignmentOrdinal !== batch.firstAssignmentOrdinal + index
      || item.status !== expectedStatus
      || !timestampsMatch
      || ids.has(item.id)
      || slots.has(item.slotKey)) {
      throw new Error('Extension BYOK execution batch reservation item is invalid');
    }
    ids.add(item.id);
    slots.add(item.slotKey);
  }
}

async function loadRecoveryIntentSnapshot(
  tx: ExtensionCommandTransactionClient,
  itemId: string,
  batchStatus: ExtensionByokExecutionBatchRecord['status'],
): Promise<ExtensionByokExecutionIntentRecord> {
  const selection = batchStatus === 'BOUND'
    ? `EXISTS (
         SELECT 1
         FROM "extension_byok_media_provenance" provenance
         WHERE provenance."execution_intent_id"
           = "extension_byok_execution_intents"."id"
       )`
    : `"execution_batch_attempt_index" = (
         SELECT MAX(latest."execution_batch_attempt_index")
         FROM "extension_byok_execution_intents" latest
         WHERE latest."execution_batch_item_id" = $1
       )`;
  const result = rows(await tx.$queryRawUnsafe(
    `SELECT ${INTENT_COLUMNS}
     FROM "extension_byok_execution_intents"
     WHERE "execution_batch_item_id" = $1
       AND ${selection}
     ORDER BY "id"
     LIMIT 2`,
    itemId,
  ), 'batch recovery intent');
  if (result.length !== 1) {
    throw new Error('Extension BYOK execution batch recovery intent is missing or ambiguous');
  }
  return mapIntent(result[0]);
}

async function loadCompleteBatchState(
  tx: ExtensionCommandTransactionClient,
  identity: ExtensionByokExecutionIntentIdentity,
  batchRows: Record<string, unknown>[],
): Promise<ExtensionByokExecutionBatchLoadResult> {
  if (batchRows.length > 1) {
    throw new Error('Extension BYOK execution batch recovery lookup is ambiguous');
  }
  if (batchRows.length === 0) return { kind: 'not_found' };
  const batch = mapBatch(batchRows[0]);
  if (!identityMatches(batch, identity)) return { kind: 'forbidden' };
  validateLoadedBatchState(batch);

  const itemRows = rows(await tx.$queryRawUnsafe(
    `SELECT ${ITEM_COLUMNS}
     FROM "extension_byok_execution_batch_items"
     WHERE "batch_id" = $1
     ORDER BY "item_index"`,
    batch.id,
  ), 'batch recovery items');
  const items = itemRows.map(mapItem);
  if (items.length !== batch.itemCount) {
    throw new Error('Extension BYOK execution batch recovery item count is invalid');
  }
  validateLoadedItems(batch, items);

  const loaded = [];
  for (const item of items) {
    const intent = await loadRecoveryIntentSnapshot(tx, item.id, batch.status);
    const attemptIndex = intent.executionBatchAttemptIndex;
    if (intent.executionBatchItemId !== item.id
      || attemptIndex === null
      || attemptIndex === undefined
      || attemptIndex < 0
      || !intentMatchesBatchItem(intent, batch, item)
      || (batch.status === 'BOUND' && intent.outcome !== 'SUCCEEDED')
      || (batch.status === 'CANCELLED'
        && ['PENDING', 'UNKNOWN_OUTCOME'].includes(intent.outcome))) {
      throw new Error('Extension BYOK execution batch recovery intent identity is invalid');
    }
    loaded.push({ item, intent });
  }
  return { kind: 'found', batch, items: loaded };
}

async function loadBatchStateTransaction(
  tx: ExtensionCommandTransactionClient,
  input: Parameters<ExtensionByokExecutionBatchRepository['loadBatchState']>[0],
): Promise<ExtensionByokExecutionBatchLoadResult> {
  const batchRows = rows(await tx.$queryRawUnsafe(
    `SELECT ${BATCH_COLUMNS}
     FROM "extension_byok_execution_batches"
     WHERE "id" = $1
     LIMIT 2`,
    input.batchId,
  ), 'batch recovery lookup');
  return loadCompleteBatchState(tx, input.identity, batchRows);
}

async function loadBatchStateByIdempotencyTransaction(
  tx: ExtensionCommandTransactionClient,
  input: Parameters<
  ExtensionByokExecutionBatchRepository['loadBatchStateByIdempotency']
  >[0],
): Promise<ExtensionByokExecutionBatchLoadResult> {
  const batchRows = rows(await tx.$queryRawUnsafe(
    `SELECT ${BATCH_COLUMNS}
     FROM "extension_byok_execution_batches"
     WHERE "owner_user_id" = $1
       AND "actor_user_id" = $2
       AND "device_session_id" = $3
       AND "idempotency_key" = $4
     ORDER BY "id"
     LIMIT 2`,
    input.identity.ownerUserId,
    input.identity.actorUserId,
    input.identity.deviceSessionId,
    input.idempotencyKey,
  ), 'batch idempotency recovery lookup');
  return loadCompleteBatchState(tx, input.identity, batchRows);
}

async function loadItemByIndex(
  tx: ExtensionCommandTransactionClient,
  batchId: string,
  itemIndex: number,
): Promise<ExtensionByokExecutionBatchItemRecord | null> {
  const result = rows(await tx.$queryRawUnsafe(
    `SELECT ${ITEM_COLUMNS}
     FROM "extension_byok_execution_batch_items"
     WHERE "batch_id" = $1 AND "item_index" = $2
     LIMIT 2
     FOR UPDATE`,
    batchId,
    itemIndex,
  ), 'batch item lookup');
  if (result.length > 1) throw new Error('Extension BYOK execution batch item is ambiguous');
  return result.length === 0 ? null : mapItem(result[0]);
}

function intentMatchesBatchItem(
  intent: ExtensionByokExecutionIntentRecord,
  batch: ExtensionByokExecutionBatchRecord,
  item: ExtensionByokExecutionBatchItemRecord,
): boolean {
  return intent.ownerUserId === batch.ownerUserId
    && intent.actorUserId === batch.actorUserId
    && intent.deviceSessionId === batch.deviceSessionId
    && intent.shopId === batch.shopId
    && intent.listingWorkflowId === batch.listingWorkflowId
    && intent.draftRevision === batch.draftRevision
    && intent.draftVersion === batch.draftVersion
    && intent.sourceCaptureSnapshotId === batch.sourceCaptureSnapshotId
    && intent.supplyGoodsId === batch.supplyGoodsId
    && intent.skuKey === item.skuKey
    && intent.slotKey === item.slotKey
    && intent.assignmentOrdinal === item.assignmentOrdinal;
}

async function loadIntentCollision(
  tx: ExtensionCommandTransactionClient,
  input: ExtensionByokExecutionIntentRecord,
): Promise<ExtensionByokExecutionIntentRecord | 'conflict' | null> {
  const result = rows(await tx.$queryRawUnsafe(
    `SELECT ${INTENT_COLUMNS}
     FROM "extension_byok_execution_intents"
     WHERE "owner_user_id" = $1
       AND ("provider_idempotency_key" = $2 OR "request_hash" = $3)
     ORDER BY "created_at", "id"
     LIMIT 2
     FOR UPDATE`,
    input.ownerUserId,
    input.providerIdempotencyKey,
    input.requestHash,
  ), 'successor replay');
  if (result.length === 0) return null;
  if (result.length !== 1) return 'conflict';
  return mapIntent(result[0]);
}

async function predecessorMatches(
  tx: ExtensionCommandTransactionClient,
  intent: ExtensionByokExecutionIntentRecord,
  currentIntentId: string,
): Promise<boolean> {
  const attemptIndex = intent.executionBatchAttemptIndex;
  if (intent.executionBatchItemId === null
    || intent.executionBatchItemId === undefined
    || attemptIndex === null
    || attemptIndex === undefined
    || attemptIndex < 1) return false;
  const result = rows(await tx.$queryRawUnsafe(
    `SELECT "id"
     FROM "extension_byok_execution_intents"
     WHERE "execution_batch_item_id" = $1
       AND "execution_batch_attempt_index" = $2
     LIMIT 2
     FOR UPDATE`,
    intent.executionBatchItemId,
    attemptIndex - 1,
  ), 'successor predecessor');
  return result.length === 1 && result[0]?.id === currentIntentId;
}

async function latestIntent(
  tx: ExtensionCommandTransactionClient,
  itemId: string,
): Promise<ExtensionByokExecutionIntentRecord | null> {
  const result = rows(await tx.$queryRawUnsafe(
    `SELECT ${INTENT_COLUMNS}
     FROM "extension_byok_execution_intents"
     WHERE "execution_batch_item_id" = $1
     ORDER BY "execution_batch_attempt_index" DESC
     LIMIT 1
     FOR UPDATE`,
    itemId,
  ), 'latest batch intent');
  return result.length === 0 ? null : mapIntent(result[0]);
}

async function claimSuccessorTransaction(
  tx: ExtensionCommandTransactionClient,
  input: Parameters<ExtensionByokExecutionBatchRepository['claimSuccessor']>[0],
): Promise<ExtensionByokExecutionBatchSuccessorClaimResult> {
  const batch = await loadBatchById(tx, input.batchId);
  if (!batch) return { kind: 'not_found' };
  if (!identityMatches(batch, input.identity)) return { kind: 'forbidden' };
  const decision = await authority(tx, batch);
  if (decision !== 'allowed') return { kind: decision };
  await claimMode(tx, batch);
  if (batch.status !== 'OPEN') return { kind: 'state_conflict' };
  const item = await loadItemByIndex(tx, batch.id, input.itemIndex);
  if (!item || item.status !== 'ACTIVE') return { kind: 'state_conflict' };
  if (!intentMatchesBatchItem(input.intent, batch, item)) return { kind: 'stale' };

  const collision = await loadIntentCollision(tx, input.intent);
  if (collision === 'conflict') {
    throw new BatchSuccessorRollback({ kind: 'idempotency_conflict' });
  }
  if (collision) {
    const exact = collision.executionBatchItemId === item.id
      && sameKeys(collision, input.intent, INTENT_IDENTITY_KEYS)
      && await predecessorMatches(tx, collision, input.currentIntentId);
    if (!exact) throw new BatchSuccessorRollback({ kind: 'idempotency_conflict' });
    return { kind: 'replayed', batch, intent: collision };
  }

  const latest = await latestIntent(tx, item.id);
  if (!latest
    || latest.id !== input.currentIntentId
    || !['FAILED_FINAL', 'SUCCEEDED'].includes(latest.outcome)) {
    throw new BatchSuccessorRollback({ kind: 'attempt_blocked' });
  }
  const latestIndex = latest.executionBatchAttemptIndex;
  if (latestIndex === null || latestIndex === undefined || latestIndex >= 499) {
    throw new BatchSuccessorRollback({ kind: 'capacity_exceeded' });
  }
  if (await retainedAttemptCount(tx, batch) >= MAX_RETAINED_ATTEMPTS) {
    throw new BatchSuccessorRollback({ kind: 'capacity_exceeded' });
  }
  const linkedIntent: ExtensionByokExecutionIntentRecord = {
    ...input.intent,
    executionBatchItemId: item.id,
    executionBatchAttemptIndex: latestIndex + 1,
  };
  const intent = await insertIntent(tx, linkedIntent);
  return { kind: 'created', batch, intent };
}

async function cancelBatchTransaction(
  tx: ExtensionCommandTransactionClient,
  input: Parameters<ExtensionByokExecutionBatchRepository['cancelBatch']>[0],
): Promise<ExtensionByokExecutionBatchCancelResult> {
  const batch = await loadBatchById(tx, input.batchId);
  if (!batch) return { kind: 'not_found' };
  if (!identityMatches(batch, input.identity)) return { kind: 'forbidden' };
  const decision = await authority(tx, batch);
  if (decision !== 'allowed') {
    return decision === 'forbidden' ? { kind: 'forbidden' } : { kind: 'state_conflict' };
  }
  await claimMode(tx, batch);
  if (batch.status === 'CANCELLED') return { kind: 'replayed', batch };
  if (batch.status !== 'OPEN') return { kind: 'state_conflict' };

  const itemRows = rows(await tx.$queryRawUnsafe(
    `SELECT ${ITEM_COLUMNS}
     FROM "extension_byok_execution_batch_items"
     WHERE "batch_id" = $1
     ORDER BY "item_index"
     FOR UPDATE`,
    batch.id,
  ), 'batch cancellation items');
  const items = itemRows.map(mapItem);
  if (items.length !== batch.itemCount || items.some((item) => item.status !== 'ACTIVE')) {
    throw new BatchCancelRollback({ kind: 'state_conflict' });
  }
  const pending = rows(await tx.$queryRawUnsafe(
    `SELECT intent."id"
     FROM "extension_byok_execution_intents" intent
     JOIN "extension_byok_execution_batch_items" item
       ON item."id" = intent."execution_batch_item_id"
     WHERE item."batch_id" = $1
       AND intent."outcome" IN ('PENDING', 'UNKNOWN_OUTCOME')
     LIMIT 1
     FOR UPDATE OF intent`,
    batch.id,
  ), 'batch cancellation attempts');
  if (pending.length > 0) throw new BatchCancelRollback({ kind: 'attempt_blocked' });

  const released = rows(await tx.$queryRawUnsafe(
    `UPDATE "extension_byok_execution_batch_items"
     SET "status" = 'RELEASED', "released_at" = $2, "updated_at" = $2
     WHERE "batch_id" = $1 AND "status" = 'ACTIVE'
     RETURNING "id"`,
    batch.id,
    input.now,
  ), 'batch cancellation release');
  if (released.length !== items.length) {
    throw new Error('Extension BYOK execution batch reservation release was lost');
  }
  const updated = rows(await tx.$queryRawUnsafe(
    `UPDATE "extension_byok_execution_batches"
     SET "status" = 'CANCELLED', "cancelled_at" = $2, "updated_at" = $2
     WHERE "id" = $1 AND "status" = 'OPEN'
     RETURNING ${BATCH_COLUMNS}`,
    batch.id,
    input.now,
  ), 'batch cancellation update');
  if (updated.length !== 1) {
    throw new Error('Extension BYOK execution batch cancellation was lost');
  }
  return { kind: 'cancelled', batch: mapBatch(updated[0]) };
}

function contains(error: unknown, needles: readonly string[], depth = 0): boolean {
  if (depth > 5 || error == null) return false;
  if (typeof error === 'string') return needles.some((needle) => error.includes(needle));
  if (typeof error !== 'object') return false;
  const candidate = error as Record<string, unknown>;
  return ['constraint', 'code', 'message', 'meta', 'cause'].some((key) => (
    contains(candidate[key], needles, depth + 1)
  ));
}

const RESERVATION_CONSTRAINTS = [
  'extension_byok_execution_batch_active_slot_key',
  'extension_byok_execution_batch_active_ordinal_key',
  'extension_byok_execution_intent_standalone_reservation_conflict',
] as const;

const RESERVATION_UNIQUE_SIGNATURES = [
  '(owner_user_id, listing_workflow_id, draft_revision, draft_version, slot_key)',
  '(owner_user_id, listing_workflow_id, draft_revision, draft_version, assignment_ordinal)',
] as const;

const IDEMPOTENCY_CONSTRAINTS = [
  'extension_byok_execution_batch_owner_idempotency_key',
  'extension_byok_execution_batch_owner_request_hash_key',
  'extension_byok_execution_intent_owner_provider_key',
  'extension_byok_execution_intent_owner_request_hash_key',
  'extension_byok_execution_intent_batch_attempt_key',
] as const;

const IDEMPOTENCY_UNIQUE_SIGNATURES = [
  '(owner_user_id, idempotency_key)',
  '(owner_user_id, request_hash)',
  '(owner_user_id, provider_idempotency_key)',
  '(execution_batch_item_id, execution_batch_attempt_index)',
] as const;

const ATTEMPT_BLOCKED_CONSTRAINTS = [
  'extension_byok_execution_intent_successor_blocked',
  'extension_byok_execution_batch_item_release_blocked',
  'extension_byok_execution_batch_cancel_blocked',
] as const;

function isUniqueConflict(error: unknown, signatures: readonly string[]): boolean {
  return contains(error, ['23505']) && contains(error, signatures);
}

function isReservationConflict(error: unknown): boolean {
  return contains(error, RESERVATION_CONSTRAINTS)
    || isUniqueConflict(error, RESERVATION_UNIQUE_SIGNATURES);
}

function isIdempotencyConflict(error: unknown): boolean {
  return contains(error, IDEMPOTENCY_CONSTRAINTS)
    || isUniqueConflict(error, IDEMPOTENCY_UNIQUE_SIGNATURES);
}

export function createPrismaExtensionByokExecutionBatchRepository(
  client: ExtensionByokExecutionBatchPrismaClient,
): ExtensionByokExecutionBatchRepository {
  return {
    async loadBatchStateByIdempotency(input) {
      return runExtensionCommandSerializableTransaction(
        client,
        (tx) => loadBatchStateByIdempotencyTransaction(tx, input),
      );
    },

    async loadBatchState(input) {
      return runExtensionCommandSerializableTransaction(
        client,
        (tx) => loadBatchStateTransaction(tx, input),
      );
    },

    async claimBatch(input) {
      validateCreateInput(input);
      try {
        return await runExtensionCommandSerializableTransaction(
          client,
          (tx) => claimBatchTransaction(tx, input),
        );
      } catch (error) {
        if (error instanceof BatchClaimRollback) return error.result;
        if (isExtensionAiImageExecutionModeConflict(error)) return { kind: 'mode_conflict' };
        if (isReservationConflict(error)) return { kind: 'reservation_conflict' };
        if (isIdempotencyConflict(error)) return { kind: 'idempotency_conflict' };
        throw error;
      }
    },

    async claimSuccessor(input) {
      try {
        return await runExtensionCommandSerializableTransaction(
          client,
          (tx) => claimSuccessorTransaction(tx, input),
        );
      } catch (error) {
        if (error instanceof BatchSuccessorRollback) return error.result;
        if (isExtensionAiImageExecutionModeConflict(error)) return { kind: 'state_conflict' };
        if (contains(error, ATTEMPT_BLOCKED_CONSTRAINTS)) return { kind: 'attempt_blocked' };
        if (isIdempotencyConflict(error)) return { kind: 'idempotency_conflict' };
        throw error;
      }
    },

    async cancelBatch(input) {
      try {
        return await runExtensionCommandSerializableTransaction(
          client,
          (tx) => cancelBatchTransaction(tx, input),
        );
      } catch (error) {
        if (error instanceof BatchCancelRollback) return error.result;
        if (contains(error, ATTEMPT_BLOCKED_CONSTRAINTS)) return { kind: 'attempt_blocked' };
        throw error;
      }
    },
  };
}

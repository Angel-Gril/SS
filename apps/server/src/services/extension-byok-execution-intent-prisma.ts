import {
  isExtensionAiImageExecutionModeConflict,
} from './extension-ai-image-execution-mode.js';
import {
  runExtensionCommandSerializableTransaction,
  type ExtensionCommandDatabaseClient,
  type ExtensionCommandTransactionClient,
} from './extension-command-grants-prisma.js';
import type {
  ExtensionByokExecutionIntentClaimResult,
  ExtensionByokExecutionIntentRecord,
  ExtensionByokExecutionIntentRepository,
} from './extension-byok-execution-intent.js';

export type ExtensionByokExecutionIntentPrismaClient = ExtensionCommandDatabaseClient;

class ExtensionByokExecutionIntentClaimRollback extends Error {
  constructor(public readonly result: ExtensionByokExecutionIntentClaimResult) {
    super('Rollback rejected BYOK execution intent claim');
    this.name = 'ExtensionByokExecutionIntentClaimRollback';
  }
}

function contains(error: unknown, needle: string, depth = 0): boolean {
  if (depth > 5 || error == null) return false;
  if (typeof error === 'string') return error.includes(needle);
  if (typeof error !== 'object') return false;
  const candidate = error as Record<string, unknown>;
  return ['constraint', 'code', 'message', 'meta', 'cause'].some((key) => (
    contains(candidate[key], needle, depth + 1)
  ));
}

function isBatchReservationConflict(error: unknown): boolean {
  return contains(error, 'extension_byok_execution_intent_batch_reservation_conflict');
}

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

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function oneRow(value: unknown): Record<string, unknown> | null {
  return Array.isArray(value) && value.length === 1 ? record(value[0]) : null;
}

function mapRow(value: unknown): ExtensionByokExecutionIntentRecord {
  const row = record(value);
  const createdAt = row?.createdAt instanceof Date ? row.createdAt : new Date(String(row?.createdAt));
  const updatedAt = row?.updatedAt instanceof Date ? row.updatedAt : new Date(String(row?.updatedAt));
  const outcomeUpdatedAt = row?.outcomeUpdatedAt == null
    ? null
    : row.outcomeUpdatedAt instanceof Date
      ? row.outcomeUpdatedAt
      : new Date(String(row.outcomeUpdatedAt));
  const intent: Record<string, unknown> | null = row
    ? { ...row, createdAt, updatedAt, outcomeUpdatedAt }
    : null;
  if (!intent
    || typeof intent.id !== 'string'
    || intent.contractVersion !== 'extension-byok-execution-intent/v1'
    || intent.executionMode !== 'BYOK'
    || typeof intent.ownerUserId !== 'string'
    || typeof intent.actorUserId !== 'string'
    || typeof intent.deviceSessionId !== 'string'
    || typeof intent.shopId !== 'string'
    || typeof intent.listingWorkflowId !== 'string'
    || !Number.isSafeInteger(intent.draftRevision)
    || !Number.isSafeInteger(intent.draftVersion)
    || typeof intent.sourceCaptureSnapshotId !== 'string'
    || typeof intent.supplyGoodsId !== 'string'
    || typeof intent.skuKey !== 'string'
    || typeof intent.slotKey !== 'string'
    || intent.assignmentMode !== 'APPEND'
    || !Number.isSafeInteger(intent.assignmentOrdinal)
    || !Number.isSafeInteger(intent.policyRevision)
    || typeof intent.providerOriginSha256 !== 'string'
    || typeof intent.model !== 'string'
    || !['TEXT_TO_IMAGE', 'IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT'].includes(String(intent.operation))
    || !['json', 'multipart'].includes(String(intent.requestMode))
    || typeof intent.providerIdempotencyKey !== 'string'
    || typeof intent.providerRequestHash !== 'string'
    || typeof intent.requestHash !== 'string'
    || !(
      (intent.executionBatchItemId == null && intent.executionBatchAttemptIndex == null)
      || (typeof intent.executionBatchItemId === 'string'
        && Number.isSafeInteger(intent.executionBatchAttemptIndex)
        && Number(intent.executionBatchAttemptIndex) >= 0)
    )
    || !['PENDING', 'SUCCEEDED', 'FAILED_FINAL', 'UNKNOWN_OUTCOME'].includes(String(intent.outcome))
    || (intent.providerRequestIdSha256 !== null
      && typeof intent.providerRequestIdSha256 !== 'string')
    || (intent.resultSha256 !== null && typeof intent.resultSha256 !== 'string')
    || (intent.outcome === 'SUCCEEDED') !== (typeof intent.resultSha256 === 'string')
    || (intent.outcome === 'PENDING'
      && (intent.providerRequestIdSha256 !== null
        || intent.resultSha256 !== null
        || outcomeUpdatedAt !== null))
    || (intent.outcome !== 'PENDING' && outcomeUpdatedAt === null)
    || (outcomeUpdatedAt !== null && !Number.isFinite(outcomeUpdatedAt.getTime()))
    || !Number.isFinite(createdAt.getTime())
    || !Number.isFinite(updatedAt.getTime())) {
    throw new Error('Extension BYOK execution intent row is invalid');
  }
  return intent as unknown as ExtensionByokExecutionIntentRecord;
}

function sameIntent(
  left: ExtensionByokExecutionIntentRecord,
  right: ExtensionByokExecutionIntentRecord,
): boolean {
  const ignored = new Set([
    'id', 'outcome', 'providerRequestIdSha256', 'resultSha256', 'outcomeUpdatedAt',
    'createdAt', 'updatedAt',
  ]);
  return Object.keys(right).every((key) => (
    ignored.has(key)
      || left[key as keyof ExtensionByokExecutionIntentRecord]
        === right[key as keyof ExtensionByokExecutionIntentRecord]
  ));
}

async function authority(
  tx: ExtensionCommandTransactionClient,
  input: ExtensionByokExecutionIntentRecord,
): Promise<'allowed' | 'forbidden' | 'stale'> {
  const result = await tx.$queryRawUnsafe<unknown[]>(
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
  );
  const row = oneRow(result);
  if (!row || typeof row.allowed !== 'boolean' || typeof row.current !== 'boolean') {
    throw new Error('Extension BYOK execution authority result is invalid');
  }
  if (!row.allowed) return 'forbidden';
  return row.current ? 'allowed' : 'stale';
}

async function insertOrReplay(
  tx: ExtensionCommandTransactionClient,
  input: ExtensionByokExecutionIntentRecord,
): Promise<ExtensionByokExecutionIntentClaimResult> {
  const inserted = await tx.$queryRawUnsafe<unknown[]>(
    `INSERT INTO "extension_byok_execution_intents"
      ("id", "contract_version", "execution_mode", "owner_user_id", "actor_user_id",
       "device_session_id", "shop_id", "listing_workflow_id", "draft_revision",
       "draft_version", "source_capture_snapshot_id", "supply_goods_id", "sku_key",
       "slot_key", "assignment_mode", "assignment_ordinal", "policy_revision",
       "provider_origin_sha256", "model", "operation", "request_mode",
       "provider_idempotency_key", "provider_request_hash", "request_hash", "outcome",
       "provider_request_id_sha256", "result_sha256", "outcome_updated_at", "created_at",
       "updated_at")
     SELECT
       $1, $2, 'BYOK', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'APPEND',
       $14, $15, $16, $17, $18::"AiMediaOperation", $19, $20, $21, $22,
       'PENDING', NULL, NULL, NULL, $23, $23
     WHERE (
       SELECT count(*)
       FROM "extension_byok_execution_intents" retained
       WHERE retained."owner_user_id" = $3
         AND retained."device_session_id" = $5
         AND retained."listing_workflow_id" = $7
         AND retained."draft_revision" = $8
         AND retained."draft_version" = $9
     ) < 500
     ON CONFLICT ("owner_user_id", "provider_idempotency_key") DO NOTHING
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
    input.createdAt,
  );
  if (!Array.isArray(inserted) || inserted.length > 1) {
    throw new Error('Extension BYOK execution intent insert result is invalid');
  }
  if (inserted.length === 1) {
    const stored = mapRow(inserted[0]);
    if (!sameIntent(stored, input)) {
      throw new Error('Extension BYOK execution intent insert identity changed');
    }
    return { kind: 'created', intent: stored };
  }
  const replayRows = await tx.$queryRawUnsafe<unknown[]>(
    `SELECT ${INTENT_COLUMNS}
     FROM "extension_byok_execution_intents"
     WHERE "owner_user_id" = $1
       AND "provider_idempotency_key" = $2
     ORDER BY "created_at" DESC, "id" DESC
     LIMIT 2
     FOR UPDATE`,
    input.ownerUserId,
    input.providerIdempotencyKey,
  );
  if (!Array.isArray(replayRows) || replayRows.length > 1) {
    throw new Error('Extension BYOK execution intent replay row is unavailable');
  }
  if (replayRows.length === 0) return { kind: 'capacity_exceeded' };
  const existing = mapRow(replayRows[0]);
  return sameIntent(existing, input)
    ? { kind: 'replayed', intent: existing }
    : { kind: 'idempotency_conflict' };
}

async function hasActiveBatchReservation(
  tx: ExtensionCommandTransactionClient,
  input: ExtensionByokExecutionIntentRecord,
): Promise<boolean> {
  const rows = await tx.$queryRawUnsafe<Array<{ reserved: boolean }>>(
    `SELECT EXISTS (
       SELECT 1
       FROM "extension_byok_execution_batch_items" item
       JOIN "extension_byok_execution_batches" batch ON batch."id" = item."batch_id"
       WHERE item."owner_user_id" = $1
         AND item."listing_workflow_id" = $2
         AND item."draft_revision" = $3
         AND item."draft_version" = $4
         AND item."status" = 'ACTIVE'
         AND batch."status" = 'OPEN'
         AND (item."slot_key" = $5 OR item."assignment_ordinal" = $6)
     ) AS "reserved"`,
    input.ownerUserId,
    input.listingWorkflowId,
    input.draftRevision,
    input.draftVersion,
    input.slotKey,
    input.assignmentOrdinal,
  );
  if (rows.length !== 1 || typeof rows[0]?.reserved !== 'boolean') {
    throw new Error('Extension BYOK batch reservation result is invalid');
  }
  return rows[0].reserved;
}

async function recordOutcome(
  tx: ExtensionCommandTransactionClient,
  input: Parameters<ExtensionByokExecutionIntentRepository['recordOutcome']>[0],
): Promise<Awaited<ReturnType<ExtensionByokExecutionIntentRepository['recordOutcome']>>> {
  const rows = await tx.$queryRawUnsafe<unknown[]>(
    `SELECT ${INTENT_COLUMNS}
     FROM "extension_byok_execution_intents"
     WHERE "id" = $1
       AND "owner_user_id" = $2
       AND "provider_idempotency_key" = $3
       AND "provider_request_hash" = $4
     LIMIT 2
     FOR UPDATE`,
    input.intentId,
    input.identity.ownerUserId,
    input.providerIdempotencyKey,
    input.providerRequestHash,
  );
  if (!Array.isArray(rows) || rows.length > 1) {
    throw new Error('Extension BYOK execution intent outcome row is unavailable');
  }
  if (rows.length === 0) return { kind: 'not_found' };
  const existing = mapRow(rows[0]);
  if (existing.actorUserId !== input.identity.actorUserId
    || existing.deviceSessionId !== input.identity.deviceSessionId) {
    return { kind: 'forbidden' };
  }
  const authorityRows = await tx.$queryRawUnsafe<unknown[]>(
    `SELECT EXISTS (
       SELECT 1
       FROM "extension_device_sessions" session
       WHERE session."id" = $1
         AND session."owner_user_id" = $2
         AND session."actor_user_id" = $3
         AND session."actor_user_id" = session."owner_user_id"
         AND session."status" = 'ACTIVE'
         AND session."expires_at" > CURRENT_TIMESTAMP
         AND 'byok:media:ingest' = ANY(session."scopes")
     ) AS "allowed"`,
    input.identity.deviceSessionId,
    input.identity.ownerUserId,
    input.identity.actorUserId,
  );
  const authorityRow = oneRow(authorityRows);
  if (!authorityRow || typeof authorityRow.allowed !== 'boolean') {
    throw new Error('Extension BYOK execution intent outcome authority is unavailable');
  }
  if (!authorityRow.allowed) return { kind: 'forbidden' };
  if (existing.outcome !== 'PENDING') {
    return existing.outcome === input.outcome
      && existing.providerRequestIdSha256 === input.providerRequestIdSha256
      && existing.resultSha256 === input.resultSha256
      ? { kind: 'replayed', intent: existing }
      : { kind: 'outcome_conflict' };
  }
  const updated = await tx.$queryRawUnsafe<unknown[]>(
    `UPDATE "extension_byok_execution_intents"
     SET "outcome" = $5,
         "provider_request_id_sha256" = $6,
         "result_sha256" = $7,
         "outcome_updated_at" = $8,
         "updated_at" = $8
     WHERE "id" = $1
       AND "owner_user_id" = $2
       AND "provider_idempotency_key" = $3
       AND "provider_request_hash" = $4
       AND "outcome" = 'PENDING'
     RETURNING ${INTENT_COLUMNS}`,
    input.intentId,
    input.identity.ownerUserId,
    input.providerIdempotencyKey,
    input.providerRequestHash,
    input.outcome,
    input.providerRequestIdSha256,
    input.resultSha256,
    input.outcomeUpdatedAt,
  );
  if (!Array.isArray(updated) || updated.length !== 1) {
    throw new Error('Extension BYOK execution intent outcome update was lost');
  }
  return { kind: 'updated', intent: mapRow(updated[0]) };
}

export function createPrismaExtensionByokExecutionIntentRepository(
  client: ExtensionByokExecutionIntentPrismaClient,
): ExtensionByokExecutionIntentRepository {
  return {
    async claim(input) {
      try {
        return await runExtensionCommandSerializableTransaction(client, async (tx) => {
          const decision = await authority(tx, input);
          if (decision !== 'allowed') return { kind: decision };
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
          if (await hasActiveBatchReservation(tx, input)) {
            throw new ExtensionByokExecutionIntentClaimRollback({
              kind: 'reservation_conflict',
            });
          }
          const result = await insertOrReplay(tx, input);
          if (result.kind !== 'created' && result.kind !== 'replayed') {
            throw new ExtensionByokExecutionIntentClaimRollback(result);
          }
          return result;
        });
      } catch (error) {
        if (error instanceof ExtensionByokExecutionIntentClaimRollback) return error.result;
        if (isExtensionAiImageExecutionModeConflict(error)) return { kind: 'mode_conflict' };
        if (isBatchReservationConflict(error)) return { kind: 'reservation_conflict' };
        throw error;
      }
    },
    async recordOutcome(input) {
      return runExtensionCommandSerializableTransaction(client, (tx) => recordOutcome(tx, input));
    },
  };
}

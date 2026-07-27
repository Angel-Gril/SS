import { createHash } from 'node:crypto';
import type { ExtensionByokMediaIngestResolvedCommand } from '../services/extension-byok-media-ingest-grant.js';
import type { ExtensionCommandTransactionClient } from '../services/extension-command-grants-prisma.js';
import type { ExtensionCommandBinding } from '../services/extension-command-grants.js';

export type ExtensionByokExecutionIntentCommitErrorCode =
  | 'BYOK_INGEST_EXECUTION_INTENT_NOT_FOUND'
  | 'BYOK_INGEST_EXECUTION_INTENT_MISMATCH'
  | 'BYOK_INGEST_EXECUTION_INTENT_OUTCOME_PENDING'
  | 'BYOK_INGEST_EXECUTION_INTENT_ALREADY_USED';

export interface RequireExactExtensionByokExecutionIntentInput {
  binding: ExtensionCommandBinding;
  actorUserId: string;
  command: ExtensionByokMediaIngestResolvedCommand;
  expectedExecutionBatchItemId: string | null;
  reject(
    code: ExtensionByokExecutionIntentCommitErrorCode,
    statusCode: number,
    message: string,
  ): never;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Lock and prove the exact successful Provider attempt before provenance can consume it. */
export async function requireExactExtensionByokExecutionIntentInTransaction(
  tx: ExtensionCommandTransactionClient,
  input: RequireExactExtensionByokExecutionIntentInput,
): Promise<void> {
  const rows = await tx.$queryRawUnsafe<Array<Record<string, unknown>>>(
    `SELECT intent.*,
       provenance."id" AS "provenanceId"
     FROM "extension_byok_execution_intents" intent
     LEFT JOIN "extension_byok_media_provenance" provenance
       ON provenance."execution_intent_id" = intent."id"
     WHERE intent."id" = $1
       AND intent."owner_user_id" = $2
     LIMIT 2
     FOR UPDATE OF intent`,
    input.command.executionIntentId,
    input.binding.ownerUserId,
  );
  if (!Array.isArray(rows) || rows.length > 1) {
    input.reject(
      'BYOK_INGEST_EXECUTION_INTENT_MISMATCH',
      409,
      'BYOK execution intent identity is ambiguous',
    );
  }
  const intent = rows[0];
  if (!intent) {
    input.reject(
      'BYOK_INGEST_EXECUTION_INTENT_NOT_FOUND',
      409,
      'BYOK execution intent was not found',
    );
  }
  if (intent.provenanceId != null) {
    input.reject(
      'BYOK_INGEST_EXECUTION_INTENT_ALREADY_USED',
      409,
      'BYOK execution intent was already used',
    );
  }
  if (intent.outcome !== 'SUCCEEDED') {
    input.reject(
      'BYOK_INGEST_EXECUTION_INTENT_OUTCOME_PENDING',
      409,
      'BYOK execution intent does not have a successful Provider outcome',
    );
  }
  const { binding, actorUserId, command } = input;
  const exact = intent.contract_version === 'extension-byok-execution-intent/v1'
    && intent.execution_mode === 'BYOK'
    && intent.owner_user_id === binding.ownerUserId
    && intent.actor_user_id === actorUserId
    && intent.device_session_id === binding.sessionId
    && intent.shop_id === binding.shopId
    && intent.listing_workflow_id === binding.workflowId
    && Number(intent.draft_revision) === command.draftRevision
    && Number(intent.draft_version) === binding.draftVersion
    && intent.source_capture_snapshot_id === command.authority.sourceCaptureSnapshotId
    && intent.sku_key === command.skuKey
    && intent.slot_key === command.slotKey
    && intent.assignment_mode === command.assignmentMode
    && command.assignmentMode === 'APPEND'
    && command.replaceConfirmed === false
    && Number(intent.assignment_ordinal) === command.assignmentOrdinal
    && Number(intent.policy_revision) === command.readiness.policyRevision
    && intent.provider_origin_sha256 === sha256(command.providerOrigin)
    && intent.model === command.model
    && intent.operation === command.providerOperation
    && intent.request_mode === command.requestMode
    && intent.provider_idempotency_key === command.providerIdempotencyKey
    && intent.provider_request_hash === command.providerRequestHash
    && intent.provider_request_id_sha256 === command.providerRequestIdSha256
    && intent.result_sha256 === command.resultSha256
    && (input.expectedExecutionBatchItemId === null
      ? intent.execution_batch_item_id == null
        && intent.execution_batch_attempt_index == null
      : intent.execution_batch_item_id === input.expectedExecutionBatchItemId
        && Number.isSafeInteger(Number(intent.execution_batch_attempt_index))
        && Number(intent.execution_batch_attempt_index) >= 0);
  if (!exact) {
    input.reject(
      'BYOK_INGEST_EXECUTION_INTENT_MISMATCH',
      409,
      'BYOK execution intent does not match the accepted Provider result',
    );
  }
}

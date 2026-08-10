import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  OzonPublishAttemptError,
  boundedOzonPublishText,
  cloneOzonPublishArray,
  cloneOzonPublishJson,
  cloneOzonPublishObject,
  decodeOzonPublishAttemptCursor,
  encodeOzonPublishAttemptCursor,
  extractOzonPublishTaskId,
  hashOzonPublishJson,
  normalizeOzonPublishAttemptListLimit,
  normalizeOzonPublishBatchLimit,
  normalizeOzonPublishError,
  normalizeOzonPublishHash,
  normalizeOzonPublishLeaseMs,
  normalizeOzonPublishOfferTrace,
  normalizeOzonPublishSubmissionClaimBoundary,
  normalizeOzonPublishTaskId,
  type OzonPublishAttemptRecord,
  type OzonPublishAttemptListPage,
  type OzonPublishAttemptRepository,
  type OzonPublishAttemptSummary,
  type OzonPublishAttemptSource,
  type OzonPublishJson,
  type OzonPublishReconciliationAttemptRecord,
  type PrepareOzonPublishAttemptInput,
} from './ozon-publish-attempts.js';

interface SqlClient {
  $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T>;
  $transaction<T>(
    action: (tx: SqlClient) => Promise<T>,
    options?: { isolationLevel?: 'Serializable' },
  ): Promise<T>;
}

interface PreparedAttemptInput {
  publishIntentId: string;
  ownerUserId: string;
  catalogSnapshotId: string;
  catalogRevision: string;
  catalogSnapshot: Record<string, OzonPublishJson>;
  catalogSnapshotHash: string;
  attributeSchemaSnapshot: Record<string, OzonPublishJson>;
  attributeSchemaHash: string;
  publisherContractVersion: string;
  endpoint: string;
  requestPayload: Record<string, OzonPublishJson>;
  requestPayloadHash: string;
  offerTrace: ReturnType<typeof normalizeOzonPublishOfferTrace>;
}

const ATTEMPT_COLUMNS = `
  a."id", a."publish_intent_id" AS "publishIntentId",
  a."workflow_id" AS "workflowId", a."owner_user_id" AS "ownerUserId",
  a."shop_id" AS "shopId", a."draft_version" AS "draftVersion", a."revision",
  a."source_capture_snapshot_id" AS "sourceCaptureSnapshotId",
  a."actor_user_id" AS "actorUserId", a."idempotency_key" AS "idempotencyKey",
  a."catalog_snapshot_id" AS "catalogSnapshotId", a."catalog_revision" AS "catalogRevision",
  a."catalog_snapshot_json" AS "catalogSnapshot", a."catalog_snapshot_hash" AS "catalogSnapshotHash",
  a."attribute_schema_snapshot_json" AS "attributeSchemaSnapshot",
  a."attribute_schema_hash" AS "attributeSchemaHash",
  a."publisher_contract_version" AS "publisherContractVersion", a."endpoint",
  a."draft_payload_hash" AS "draftPayloadHash", a."draft_state_hash" AS "draftStateHash",
  a."request_payload_json" AS "requestPayload", a."request_payload_hash" AS "requestPayloadHash",
  a."offer_trace_json" AS "offerTrace", a."item_count" AS "itemCount",
  a."state", a."reconciliation_state" AS "reconciliationState",
  a."state_version" AS "stateVersion", a."ozon_task_id" AS "ozonTaskId",
  a."acceptance_source" AS "acceptanceSource", a."response_json" AS "response",
  a."response_hash" AS "responseHash", a."item_results_json" AS "itemResults",
  a."item_errors_json" AS "itemErrors", a."last_error_code" AS "lastErrorCode",
  a."last_error_message" AS "lastErrorMessage", a."lease_purpose" AS "leasePurpose",
  a."lease_token" AS "leaseToken", a."lease_owner" AS "leaseOwner",
  a."lease_epoch" AS "leaseEpoch", a."heartbeat_at" AS "heartbeatAt",
  a."lease_expires_at" AS "leaseExpiresAt", a."submit_started_at" AS "submitStartedAt",
  a."submitted_at" AS "submittedAt", a."unknown_at" AS "unknownAt",
  a."rejected_at" AS "rejectedAt", a."next_reconcile_at" AS "nextReconcileAt",
  a."reconcile_attempt_count" AS "reconcileAttemptCount",
  a."last_reconciled_at" AS "lastReconciledAt", a."completed_at" AS "completedAt",
  a."resolved_by_user_id" AS "resolvedByUserId", a."resolution_note" AS "resolutionNote",
  a."resolution_evidence_json" AS "resolutionEvidence",
  a."resolution_evidence_hash" AS "resolutionEvidenceHash",
  a."created_at" AS "createdAt", a."updated_at" AS "updatedAt"`;

const RECONCILIATION_ATTEMPT_COLUMNS = `
  a."id", a."publish_intent_id" AS "publishIntentId",
  a."workflow_id" AS "workflowId", a."owner_user_id" AS "ownerUserId",
  a."shop_id" AS "shopId", a."draft_version" AS "draftVersion", a."revision",
  a."source_capture_snapshot_id" AS "sourceCaptureSnapshotId",
  a."actor_user_id" AS "actorUserId", a."idempotency_key" AS "idempotencyKey",
  a."catalog_snapshot_id" AS "catalogSnapshotId", a."catalog_revision" AS "catalogRevision",
  a."catalog_snapshot_hash" AS "catalogSnapshotHash",
  a."attribute_schema_hash" AS "attributeSchemaHash",
  a."publisher_contract_version" AS "publisherContractVersion", a."endpoint",
  a."draft_payload_hash" AS "draftPayloadHash", a."draft_state_hash" AS "draftStateHash",
  a."request_payload_hash" AS "requestPayloadHash", a."offer_trace_json" AS "offerTrace",
  a."item_count" AS "itemCount", a."state",
  a."reconciliation_state" AS "reconciliationState", a."state_version" AS "stateVersion",
  a."ozon_task_id" AS "ozonTaskId", a."acceptance_source" AS "acceptanceSource",
  a."response_hash" AS "responseHash", a."last_error_code" AS "lastErrorCode",
  a."last_error_message" AS "lastErrorMessage", a."lease_purpose" AS "leasePurpose",
  a."lease_token" AS "leaseToken", a."lease_owner" AS "leaseOwner",
  a."lease_epoch" AS "leaseEpoch", a."heartbeat_at" AS "heartbeatAt",
  a."lease_expires_at" AS "leaseExpiresAt", a."submit_started_at" AS "submitStartedAt",
  a."submitted_at" AS "submittedAt", a."unknown_at" AS "unknownAt",
  a."rejected_at" AS "rejectedAt", a."next_reconcile_at" AS "nextReconcileAt",
  a."reconcile_attempt_count" AS "reconcileAttemptCount",
  a."last_reconciled_at" AS "lastReconciledAt", a."completed_at" AS "completedAt",
  a."resolved_by_user_id" AS "resolvedByUserId", a."resolution_note" AS "resolutionNote",
  a."resolution_evidence_hash" AS "resolutionEvidenceHash",
  a."created_at" AS "createdAt", a."updated_at" AS "updatedAt"`;

const ATTEMPT_SUMMARY_COLUMNS = `
  a."id", a."workflow_id" AS "workflowId", a."shop_id" AS "shopId",
  a."draft_version" AS "draftVersion", a."revision",
  a."catalog_snapshot_hash" AS "catalogSnapshotHash",
  a."attribute_schema_hash" AS "attributeSchemaHash",
  a."publisher_contract_version" AS "publisherContractVersion", a."endpoint",
  a."draft_payload_hash" AS "draftPayloadHash", a."draft_state_hash" AS "draftStateHash",
  a."request_payload_hash" AS "requestPayloadHash", a."item_count" AS "itemCount",
  a."state", a."reconciliation_state" AS "reconciliationState",
  a."state_version" AS "stateVersion", a."ozon_task_id" AS "ozonTaskId",
  a."acceptance_source" AS "acceptanceSource", a."response_hash" AS "responseHash",
  CASE WHEN a."item_results_json" IS NULL THEN NULL ELSE COALESCE((
    SELECT jsonb_agg(
      CASE WHEN octet_length(result.value::text) <= 8192 THEN result.value
        ELSE jsonb_build_object('_truncated', TRUE, 'bytes', octet_length(result.value::text)) END
      ORDER BY result.ordinality
    )
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(a."item_results_json") = 'array'
        THEN a."item_results_json" ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS result(value, ordinality)
    WHERE result.ordinality <= 20
  ), '[]'::jsonb) END AS "itemResults",
  CASE WHEN jsonb_typeof(a."item_results_json") = 'array'
    THEN jsonb_array_length(a."item_results_json") ELSE 0 END AS "itemResultCount",
  COALESCE((
    SELECT jsonb_agg(
      CASE WHEN octet_length(item_error.value::text) <= 8192 THEN item_error.value
        ELSE jsonb_build_object('_truncated', TRUE, 'bytes', octet_length(item_error.value::text)) END
      ORDER BY item_error.ordinality
    )
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(a."item_errors_json") = 'array'
        THEN a."item_errors_json" ELSE '[]'::jsonb END
    ) WITH ORDINALITY AS item_error(value, ordinality)
    WHERE item_error.ordinality <= 20
  ), '[]'::jsonb) AS "itemErrors",
  CASE WHEN jsonb_typeof(a."item_errors_json") = 'array'
    THEN jsonb_array_length(a."item_errors_json") ELSE 0 END AS "itemErrorCount",
  a."last_error_code" AS "lastErrorCode", a."last_error_message" AS "lastErrorMessage",
  a."submit_started_at" AS "submitStartedAt", a."submitted_at" AS "submittedAt",
  a."unknown_at" AS "unknownAt", a."rejected_at" AS "rejectedAt",
  a."next_reconcile_at" AS "nextReconcileAt",
  a."reconcile_attempt_count" AS "reconcileAttemptCount",
  a."last_reconciled_at" AS "lastReconciledAt", a."completed_at" AS "completedAt",
  a."resolution_evidence_hash" AS "resolutionEvidenceHash",
  a."created_at" AS "createdAt", a."updated_at" AS "updatedAt"`;

function iso(value: unknown): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function attemptRow(row: any): OzonPublishAttemptRecord {
  return {
    id: String(row.id),
    publishIntentId: String(row.publishIntentId),
    workflowId: String(row.workflowId),
    ownerUserId: String(row.ownerUserId),
    shopId: String(row.shopId),
    draftVersion: Number(row.draftVersion),
    revision: Number(row.revision),
    sourceCaptureSnapshotId: String(row.sourceCaptureSnapshotId),
    actorUserId: String(row.actorUserId),
    idempotencyKey: String(row.idempotencyKey),
    catalogSnapshotId: String(row.catalogSnapshotId),
    catalogRevision: String(row.catalogRevision),
    catalogSnapshot: structuredClone(row.catalogSnapshot || {}),
    catalogSnapshotHash: String(row.catalogSnapshotHash),
    attributeSchemaSnapshot: structuredClone(row.attributeSchemaSnapshot || {}),
    attributeSchemaHash: String(row.attributeSchemaHash),
    publisherContractVersion: String(row.publisherContractVersion),
    endpoint: String(row.endpoint),
    draftPayloadHash: String(row.draftPayloadHash),
    draftStateHash: String(row.draftStateHash),
    requestPayload: structuredClone(row.requestPayload || {}),
    requestPayloadHash: String(row.requestPayloadHash),
    offerTrace: structuredClone(row.offerTrace || []),
    itemCount: Number(row.itemCount),
    state: row.state,
    reconciliationState: row.reconciliationState,
    stateVersion: Number(row.stateVersion),
    ozonTaskId: row.ozonTaskId == null ? null : String(row.ozonTaskId),
    acceptanceSource: row.acceptanceSource == null ? null : String(row.acceptanceSource),
    response: row.response == null ? null : structuredClone(row.response),
    responseHash: row.responseHash == null ? null : String(row.responseHash),
    itemResults: row.itemResults == null ? null : structuredClone(row.itemResults),
    itemErrors: structuredClone(row.itemErrors || []),
    lastErrorCode: row.lastErrorCode == null ? null : String(row.lastErrorCode),
    lastErrorMessage: row.lastErrorMessage == null ? null : String(row.lastErrorMessage),
    leasePurpose: row.leasePurpose || null,
    leaseToken: row.leaseToken == null ? null : String(row.leaseToken),
    leaseOwner: row.leaseOwner == null ? null : String(row.leaseOwner),
    leaseEpoch: Number(row.leaseEpoch),
    heartbeatAt: iso(row.heartbeatAt),
    leaseExpiresAt: iso(row.leaseExpiresAt),
    submitStartedAt: iso(row.submitStartedAt),
    submittedAt: iso(row.submittedAt),
    unknownAt: iso(row.unknownAt),
    rejectedAt: iso(row.rejectedAt),
    nextReconcileAt: iso(row.nextReconcileAt),
    reconcileAttemptCount: Number(row.reconcileAttemptCount),
    lastReconciledAt: iso(row.lastReconciledAt),
    completedAt: iso(row.completedAt),
    resolvedByUserId: row.resolvedByUserId == null ? null : String(row.resolvedByUserId),
    resolutionNote: row.resolutionNote == null ? null : String(row.resolutionNote),
    resolutionEvidence: row.resolutionEvidence == null ? null : structuredClone(row.resolutionEvidence),
    resolutionEvidenceHash: row.resolutionEvidenceHash == null ? null : String(row.resolutionEvidenceHash),
    createdAt: iso(row.createdAt) || new Date(0).toISOString(),
    updatedAt: iso(row.updatedAt) || new Date(0).toISOString(),
  };
}

function reconciliationAttemptRow(row: any): OzonPublishReconciliationAttemptRecord {
  return {
    id: String(row.id),
    publishIntentId: String(row.publishIntentId),
    workflowId: String(row.workflowId),
    ownerUserId: String(row.ownerUserId),
    shopId: String(row.shopId),
    draftVersion: Number(row.draftVersion),
    revision: Number(row.revision),
    sourceCaptureSnapshotId: String(row.sourceCaptureSnapshotId),
    actorUserId: String(row.actorUserId),
    idempotencyKey: String(row.idempotencyKey),
    catalogSnapshotId: String(row.catalogSnapshotId),
    catalogRevision: String(row.catalogRevision),
    catalogSnapshotHash: String(row.catalogSnapshotHash),
    attributeSchemaHash: String(row.attributeSchemaHash),
    publisherContractVersion: String(row.publisherContractVersion),
    endpoint: String(row.endpoint),
    draftPayloadHash: String(row.draftPayloadHash),
    draftStateHash: String(row.draftStateHash),
    requestPayloadHash: String(row.requestPayloadHash),
    offerTrace: structuredClone(row.offerTrace || []),
    itemCount: Number(row.itemCount),
    state: row.state,
    reconciliationState: row.reconciliationState,
    stateVersion: Number(row.stateVersion),
    ozonTaskId: row.ozonTaskId == null ? null : String(row.ozonTaskId),
    acceptanceSource: row.acceptanceSource == null ? null : String(row.acceptanceSource),
    responseHash: row.responseHash == null ? null : String(row.responseHash),
    lastErrorCode: row.lastErrorCode == null ? null : String(row.lastErrorCode),
    lastErrorMessage: row.lastErrorMessage == null ? null : String(row.lastErrorMessage),
    leasePurpose: row.leasePurpose || null,
    leaseToken: row.leaseToken == null ? null : String(row.leaseToken),
    leaseOwner: row.leaseOwner == null ? null : String(row.leaseOwner),
    leaseEpoch: Number(row.leaseEpoch),
    heartbeatAt: iso(row.heartbeatAt),
    leaseExpiresAt: iso(row.leaseExpiresAt),
    submitStartedAt: iso(row.submitStartedAt),
    submittedAt: iso(row.submittedAt),
    unknownAt: iso(row.unknownAt),
    rejectedAt: iso(row.rejectedAt),
    nextReconcileAt: iso(row.nextReconcileAt),
    reconcileAttemptCount: Number(row.reconcileAttemptCount),
    lastReconciledAt: iso(row.lastReconciledAt),
    completedAt: iso(row.completedAt),
    resolvedByUserId: row.resolvedByUserId == null ? null : String(row.resolvedByUserId),
    resolutionNote: row.resolutionNote == null ? null : String(row.resolutionNote),
    resolutionEvidenceHash: row.resolutionEvidenceHash == null
      ? null
      : String(row.resolutionEvidenceHash),
    createdAt: iso(row.createdAt) || new Date(0).toISOString(),
    updatedAt: iso(row.updatedAt) || new Date(0).toISOString(),
  };
}

function summaryJsonArray(value: unknown): OzonPublishJson[] {
  return Array.isArray(value) ? structuredClone(value) as OzonPublishJson[] : [];
}

function hasTruncatedSummaryEntry(values: OzonPublishJson[]): boolean {
  return values.some((value) => Boolean(
    value && typeof value === 'object' && !Array.isArray(value) && value._truncated === true,
  ));
}

function attemptSummaryRow(row: any): OzonPublishAttemptSummary {
  const itemResults = row.itemResults == null ? null : summaryJsonArray(row.itemResults);
  const itemErrors = summaryJsonArray(row.itemErrors);
  const itemResultCount = Math.max(0, Number(row.itemResultCount) || 0);
  const itemErrorCount = Math.max(0, Number(row.itemErrorCount) || 0);
  return {
    id: String(row.id),
    workflowId: String(row.workflowId),
    shopId: String(row.shopId),
    draftVersion: Number(row.draftVersion),
    revision: Number(row.revision),
    catalogSnapshotHash: String(row.catalogSnapshotHash),
    attributeSchemaHash: String(row.attributeSchemaHash),
    publisherContractVersion: String(row.publisherContractVersion),
    endpoint: String(row.endpoint),
    draftPayloadHash: String(row.draftPayloadHash),
    draftStateHash: String(row.draftStateHash),
    requestPayloadHash: String(row.requestPayloadHash),
    itemCount: Number(row.itemCount),
    state: row.state,
    reconciliationState: row.reconciliationState,
    stateVersion: Number(row.stateVersion),
    ozonTaskId: row.ozonTaskId == null ? null : String(row.ozonTaskId),
    acceptanceSource: row.acceptanceSource == null ? null : String(row.acceptanceSource),
    responseHash: row.responseHash == null ? null : String(row.responseHash),
    itemResults,
    itemResultCount,
    itemResultsTruncated: itemResults !== null
      && (itemResultCount > itemResults.length || hasTruncatedSummaryEntry(itemResults)),
    itemErrors,
    itemErrorCount,
    itemErrorsTruncated: itemErrorCount > itemErrors.length || hasTruncatedSummaryEntry(itemErrors),
    lastErrorCode: row.lastErrorCode == null ? null : String(row.lastErrorCode),
    lastErrorMessage: row.lastErrorMessage == null ? null : String(row.lastErrorMessage),
    submitStartedAt: iso(row.submitStartedAt),
    submittedAt: iso(row.submittedAt),
    unknownAt: iso(row.unknownAt),
    rejectedAt: iso(row.rejectedAt),
    nextReconcileAt: iso(row.nextReconcileAt),
    reconcileAttemptCount: Number(row.reconcileAttemptCount),
    lastReconciledAt: iso(row.lastReconciledAt),
    completedAt: iso(row.completedAt),
    resolutionEvidenceHash: row.resolutionEvidenceHash == null
      ? null
      : String(row.resolutionEvidenceHash),
    createdAt: iso(row.createdAt) || new Date(0).toISOString(),
    updatedAt: iso(row.updatedAt) || new Date(0).toISOString(),
  };
}

function sourceRow(row: any): OzonPublishAttemptSource {
  return {
    publishIntentId: String(row.publishIntentId),
    workflowId: String(row.workflowId),
    ownerUserId: String(row.ownerUserId),
    shopId: String(row.shopId),
    draftVersion: Number(row.draftVersion),
    revision: Number(row.revision),
    sourceCaptureSnapshotId: String(row.sourceCaptureSnapshotId),
    actorUserId: String(row.actorUserId),
    idempotencyKey: String(row.idempotencyKey),
    draftStateHash: String(row.draftStateHash),
    draftPayloadHash: String(row.draftPayloadHash),
    draftPayload: structuredClone(row.draftPayload || {}),
    currentRevision: Number(row.currentRevision),
    currentDraftVersion: Number(row.currentDraftVersion),
    currentShopId: String(row.currentShopId),
    currentStage: String(row.currentStage),
    currentStatus: String(row.currentStatus),
  };
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function leaseTokenHash(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameLeaseTokenHash(value: unknown, expected: string): boolean {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) return false;
  return timingSafeEqual(Buffer.from(value, 'hex'), Buffer.from(expected, 'hex'));
}

function retryable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  const codes = [candidate.code, candidate.meta?.code].map((value) => String(value || ''));
  return codes.some((code) => ['40001', '40P01', 'P2034'].includes(code))
    || String(candidate.message || '').includes('could not serialize');
}

function sqlCode(error: unknown): string {
  if (!error || typeof error !== 'object') return '';
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return [candidate.meta?.code, candidate.code].map((value) => String(value || ''))
    .find((value) => /^(?:23|40|P\d)/.test(value)) || '';
}

function mappedError(error: unknown): Error {
  if (error instanceof OzonPublishAttemptError) return error;
  const code = sqlCode(error);
  if (code === '23505' || code === 'P2002') {
    return new OzonPublishAttemptError('IDEMPOTENCY_CONFLICT', 'Ozon publish attempt identity was reused');
  }
  if (code === '23514' || code === '23503') {
    return new OzonPublishAttemptError('INVALID_TRANSITION', 'Ozon publish attempt violates its persisted contract');
  }
  return error instanceof Error ? error : new Error(String(error));
}

async function serializable<T>(client: SqlClient, action: (tx: SqlClient) => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await client.$transaction(action, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (!retryable(error)) throw mappedError(error);
      lastError = error;
    }
  }
  throw mappedError(lastError);
}

function requiredPositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new OzonPublishAttemptError('INVALID_INPUT', `${label} must be a positive integer`);
  }
  return Number(value);
}

function preparedInput(input: PrepareOzonPublishAttemptInput): PreparedAttemptInput {
  const catalogSnapshot = cloneOzonPublishObject(input.catalogSnapshot, 'catalog snapshot', 2 * 1024 * 1024);
  const attributeSchemaSnapshot = cloneOzonPublishObject(
    input.attributeSchemaSnapshot,
    'attribute schema snapshot',
    2 * 1024 * 1024,
  );
  const requestPayload = cloneOzonPublishObject(input.requestPayload, 'Ozon request payload', 8 * 1024 * 1024);
  const offerTrace = normalizeOzonPublishOfferTrace(input.offerTrace);
  if (!Array.isArray(requestPayload.items) || requestPayload.items.length !== offerTrace.length) {
    throw new OzonPublishAttemptError('INVALID_INPUT', 'Ozon request items must match the deterministic offer trace');
  }
  for (const [ordinal, trace] of offerTrace.entries()) {
    const item = requestPayload.items[ordinal];
    if (!item || typeof item !== 'object' || Array.isArray(item)
      || typeof item.offer_id !== 'string' || item.offer_id !== trace.offerId) {
      throw new OzonPublishAttemptError(
        'INVALID_INPUT',
        `Ozon request item ${ordinal} does not match its deterministic offer trace`,
      );
    }
  }
  const hashes = [
    [input.catalogSnapshotHash, hashOzonPublishJson(catalogSnapshot), 'catalog snapshot hash'],
    [input.attributeSchemaHash, hashOzonPublishJson(attributeSchemaSnapshot), 'attribute schema hash'],
    [input.requestPayloadHash, hashOzonPublishJson(requestPayload), 'request payload hash'],
  ] as const;
  for (const [provided, actual, label] of hashes) {
    if (normalizeOzonPublishHash(provided, label) !== actual) {
      throw new OzonPublishAttemptError('INVALID_INPUT', `${label} does not match its snapshot`);
    }
  }
  return {
    publishIntentId: boundedOzonPublishText(input.publishIntentId, 'publishIntentId', 200),
    ownerUserId: boundedOzonPublishText(input.ownerUserId, 'ownerUserId', 200),
    catalogSnapshotId: boundedOzonPublishText(input.catalogSnapshotId, 'catalogSnapshotId', 200),
    catalogRevision: boundedOzonPublishText(input.catalogRevision, 'catalogRevision', 200),
    catalogSnapshot,
    catalogSnapshotHash: hashes[0][1],
    attributeSchemaSnapshot,
    attributeSchemaHash: hashes[1][1],
    publisherContractVersion: boundedOzonPublishText(
      input.publisherContractVersion,
      'publisherContractVersion',
      120,
    ),
    endpoint: boundedOzonPublishText(input.endpoint || '/v3/product/import', 'endpoint', 200),
    requestPayload,
    requestPayloadHash: hashes[2][1],
    offerTrace,
  };
}

async function loadExactIntentRow(
  client: SqlClient,
  input: { publishIntentId: string; ownerUserId: string },
  lock = false,
): Promise<OzonPublishAttemptSource | null> {
  const rows = await client.$queryRawUnsafe<any[]>(
    `SELECT intent."id" AS "publishIntentId", intent."workflow_id" AS "workflowId",
            intent."owner_user_id" AS "ownerUserId", intent."shop_id" AS "shopId",
            intent."draft_version" AS "draftVersion", intent."revision",
            draft."source_capture_snapshot_id" AS "sourceCaptureSnapshotId",
            intent."actor_user_id" AS "actorUserId", intent."idempotency_key" AS "idempotencyKey",
            intent."payload_hash" AS "draftStateHash", draft."payload_hash" AS "draftPayloadHash",
            draft."payload" AS "draftPayload", workflow."current_revision" AS "currentRevision",
            workflow."current_draft_version" AS "currentDraftVersion",
            workflow."shop_id" AS "currentShopId", workflow."stage" AS "currentStage",
            workflow."status"::text AS "currentStatus"
     FROM "source_listing_publish_intents" intent
     JOIN "source_listing_draft_versions" draft
       ON draft."workflow_id" = intent."workflow_id" AND draft."revision" = intent."revision"
     JOIN "source_listing_workflows" workflow ON workflow."id" = intent."workflow_id"
     WHERE intent."id" = $1 AND intent."owner_user_id" = $2
     ${lock ? 'FOR KEY SHARE OF intent, draft, workflow' : ''}`,
    input.publishIntentId,
    input.ownerUserId,
  );
  return rows[0] ? sourceRow(rows[0]) : null;
}

async function loadAttempt(
  client: SqlClient,
  whereSql: string,
  params: unknown[],
  lock = false,
): Promise<OzonPublishAttemptRecord | null> {
  const rows = await client.$queryRawUnsafe<any[]>(
    `SELECT ${ATTEMPT_COLUMNS} FROM "ozon_publish_attempts" a
     WHERE ${whereSql} ${lock ? 'FOR UPDATE OF a' : ''}`,
    ...params,
  );
  return rows[0] ? attemptRow(rows[0]) : null;
}

async function appendEvent(
  tx: SqlClient,
  attempt: Pick<
    OzonPublishAttemptRecord,
    'id' | 'state' | 'reconciliationState' | 'stateVersion'
  >,
  input: { eventType: string; actorUserId?: string; workerId?: string; payload?: unknown },
  createId: () => string,
): Promise<void> {
  const payload = cloneOzonPublishObject(input.payload || {}, 'attempt event payload', 256 * 1024);
  await tx.$queryRawUnsafe(
    `INSERT INTO "ozon_publish_attempt_events"
      ("id", "attempt_id", "sequence", "event_type", "state", "reconciliation_state",
       "actor_user_id", "worker_id", "payload", "payload_hash", "created_at")
     VALUES ($1, $2, $3, $4, $5::"OzonPublishAttemptState",
             $6::"OzonPublishReconciliationState", $7, $8, $9::jsonb, $10, clock_timestamp())`,
    createId(), attempt.id, attempt.stateVersion,
    boundedOzonPublishText(input.eventType, 'attempt event type', 100),
    attempt.state, attempt.reconciliationState,
    input.actorUserId || null,
    input.workerId ? boundedOzonPublishText(input.workerId, 'workerId', 200) : null,
    json(payload), hashOzonPublishJson(payload),
  );
}

async function rejectPreparedSubmissionClaim(
  tx: SqlClient,
  input: {
    attemptId: string;
    workerId: string;
    errorCode: string;
    errorMessage: string;
    createId: () => string;
  },
): Promise<void> {
  const rows = await tx.$queryRawUnsafe<any[]>(
    `UPDATE "ozon_publish_attempts" a
     SET "state" = 'REJECTED', "state_version" = "state_version" + 1,
         "last_error_code" = $2, "last_error_message" = $3,
         "rejected_at" = clock_timestamp(), "updated_at" = clock_timestamp()
     WHERE a."id" = $1 AND a."state" = 'PREPARED'
     RETURNING ${ATTEMPT_COLUMNS}`,
    input.attemptId,
    input.errorCode,
    input.errorMessage,
  );
  if (!rows[0]) return;
  const rejected = attemptRow(rows[0]);
  await appendEvent(tx, rejected, {
    eventType: 'LOCAL_REJECTED',
    workerId: input.workerId,
    payload: { errorCode: rejected.lastErrorCode },
  }, input.createId);
}

function exactAuthoritativeAssetSet(value: unknown, expected: string[]): value is string[] {
  if (!Array.isArray(value) || value.length > 500 || value.length !== expected.length) return false;
  const authoritative = new Set<string>();
  for (const assetId of value) {
    if (typeof assetId !== 'string'
      || !assetId
      || assetId.length > 500
      || assetId !== assetId.normalize('NFKC').trim()
      || authoritative.has(assetId)) return false;
    authoritative.add(assetId);
  }
  return expected.every((assetId) => authoritative.has(assetId));
}

function samePreparedAttempt(
  attempt: OzonPublishAttemptRecord,
  source: OzonPublishAttemptSource,
  input: PreparedAttemptInput,
): boolean {
  return attempt.publishIntentId === source.publishIntentId
    && attempt.ownerUserId === source.ownerUserId
    && attempt.workflowId === source.workflowId
    && attempt.shopId === source.shopId
    && attempt.revision === source.revision
    && attempt.draftVersion === source.draftVersion
    && attempt.draftPayloadHash === source.draftPayloadHash
    && attempt.draftStateHash === source.draftStateHash
    && attempt.catalogSnapshotId === input.catalogSnapshotId
    && attempt.catalogRevision === input.catalogRevision
    && attempt.catalogSnapshotHash === input.catalogSnapshotHash
    && attempt.attributeSchemaHash === input.attributeSchemaHash
    && attempt.publisherContractVersion === input.publisherContractVersion
    && attempt.endpoint === input.endpoint
    && attempt.requestPayloadHash === input.requestPayloadHash
    && hashOzonPublishJson(attempt.offerTrace as unknown as OzonPublishJson)
      === hashOzonPublishJson(input.offerTrace as unknown as OzonPublishJson);
}

function ensureLease(
  attempt: OzonPublishAttemptRecord | null,
  input: { workerId: string; leaseToken: string; leaseEpoch: number; purpose: 'SUBMIT' | 'RECONCILE' },
): OzonPublishAttemptRecord {
  if (!attempt) throw new OzonPublishAttemptError('NOT_FOUND', 'Ozon publish attempt was not found');
  if (attempt.leasePurpose !== input.purpose
    || attempt.leaseOwner !== input.workerId
    || attempt.leaseToken !== input.leaseToken
    || attempt.leaseEpoch !== input.leaseEpoch) {
    throw new OzonPublishAttemptError('LEASE_LOST', 'Ozon publish attempt lease was lost');
  }
  return attempt;
}

async function listOwnedWorkflowAttempts(
  client: SqlClient,
  rawInput: {
    workflowId: string;
    ownerUserId: string;
    limit?: unknown;
    cursor?: string | null;
  },
): Promise<OzonPublishAttemptListPage> {
  const workflowId = boundedOzonPublishText(rawInput.workflowId, 'workflowId', 200);
  const ownerUserId = boundedOzonPublishText(rawInput.ownerUserId, 'ownerUserId', 200);
  const limit = normalizeOzonPublishAttemptListLimit(rawInput.limit);
  const cursor = rawInput.cursor ? decodeOzonPublishAttemptCursor(rawInput.cursor) : null;
  const rows = await client.$queryRawUnsafe<any[]>(
    `SELECT ${ATTEMPT_SUMMARY_COLUMNS}
     FROM "ozon_publish_attempts" a
     WHERE a."workflow_id" = $1 AND a."owner_user_id" = $2
       AND ($3::timestamptz IS NULL OR (a."created_at", a."id") < ($3::timestamptz, $4))
     ORDER BY a."created_at" DESC, a."id" DESC
     LIMIT $5`,
    workflowId,
    ownerUserId,
    cursor ? new Date(cursor.createdAt) : null,
    cursor?.id || null,
    limit + 1,
  );
  const pageRows = rows.slice(0, limit);
  const items = pageRows.map(attemptSummaryRow);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > limit && last
      ? encodeOzonPublishAttemptCursor({ createdAt: last.createdAt, id: last.id })
      : null,
  };
}

export function createPrismaOzonPublishAttemptRepository(options: {
  client: SqlClient;
  createId?: () => string;
  createLeaseToken?: () => string;
}): OzonPublishAttemptRepository {
  const createId = options.createId || randomUUID;
  const createLeaseToken = options.createLeaseToken || randomUUID;

  return {
    async loadExactIntent(input) {
      return loadExactIntentRow(options.client, {
        publishIntentId: boundedOzonPublishText(input.publishIntentId, 'publishIntentId', 200),
        ownerUserId: boundedOzonPublishText(input.ownerUserId, 'ownerUserId', 200),
      });
    },

    async prepare(rawInput) {
      const input = preparedInput(rawInput);
      return serializable(options.client, async (tx) => {
        const source = await loadExactIntentRow(tx, input, true);
        if (!source) throw new OzonPublishAttemptError('NOT_FOUND', 'Publish intent was not found');
        await tx.$queryRawUnsafe(
          'SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
          `ozon-publish-attempt-workflow:${source.ownerUserId}:${source.workflowId}`,
        );
        const existing = await loadAttempt(tx, 'a."publish_intent_id" = $1', [source.publishIntentId], true);
        if (existing) {
          if (!samePreparedAttempt(existing, source, input)) {
            throw new OzonPublishAttemptError(
              'IDEMPOTENCY_CONFLICT',
              'Publish intent was already prepared with another immutable request',
            );
          }
          return { attempt: existing, idempotent: true };
        }
        if (source.currentRevision !== source.revision
          || source.currentDraftVersion !== source.draftVersion
          || source.currentShopId !== source.shopId
          || source.currentStage !== 'PUBLISH_INTENT_RECORDED'
          || source.currentStatus !== 'ACTIVE') {
          throw new OzonPublishAttemptError('VERSION_CONFLICT', 'Publish intent no longer references the current draft');
        }
        const blocked = await tx.$queryRawUnsafe<Array<{ blocked: boolean }>>(
          `SELECT EXISTS (
             SELECT 1 FROM "ozon_publish_attempts" other
             WHERE other."owner_user_id" = $1 AND other."workflow_id" = $2
               AND NOT (
                 other."state" = 'REJECTED'
                 AND other."reconciliation_state" = 'NOT_REQUIRED'
                 AND other."ozon_task_id" IS NULL
                 AND other."acceptance_source" IS NULL
                 AND other."lease_purpose" IS NULL
                 AND other."lease_token" IS NULL
                 AND other."lease_owner" IS NULL
                 AND other."heartbeat_at" IS NULL
                 AND other."lease_expires_at" IS NULL
                 AND other."submitted_at" IS NULL
               )
           ) AS "blocked"`,
          source.ownerUserId,
          source.workflowId,
        );
        if (blocked[0]?.blocked !== false) {
          throw new OzonPublishAttemptError(
            'VERSION_CONFLICT',
            'A prior Ozon publish attempt for this workflow is not a terminal rejection',
          );
        }
        const catalogs = await tx.$queryRawUnsafe<Array<{ id: string }>>(
          `SELECT "id" FROM "ozon_category_catalog_snapshots"
           WHERE "id" = $1 AND "shop_id" = $2 AND "revision" = $3
             AND "complete" = TRUE AND "default_tree_complete" = TRUE
             AND "zh_hans_tree_complete" = TRUE AND "is_current" = TRUE
             AND "expires_at" > clock_timestamp()
           FOR KEY SHARE`,
          input.catalogSnapshotId, source.shopId, input.catalogRevision,
        );
        if (!catalogs[0]) {
          throw new OzonPublishAttemptError('VERSION_CONFLICT', 'The frozen Ozon catalog is not current and complete');
        }
        const rows = await tx.$queryRawUnsafe<any[]>(
          `INSERT INTO "ozon_publish_attempts"
            ("id", "publish_intent_id", "workflow_id", "owner_user_id", "shop_id",
             "draft_version", "revision", "source_capture_snapshot_id", "actor_user_id",
             "idempotency_key", "catalog_snapshot_id", "catalog_revision",
             "catalog_snapshot_json", "catalog_snapshot_hash",
             "attribute_schema_snapshot_json", "attribute_schema_hash",
             "publisher_contract_version", "endpoint", "draft_payload_hash", "draft_state_hash",
             "request_payload_json", "request_payload_hash", "offer_trace_json", "item_count",
             "state", "reconciliation_state", "state_version", "item_errors_json",
             "created_at", "updated_at")
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                   $13::jsonb, $14, $15::jsonb, $16, $17, $18, $19, $20,
                   $21::jsonb, $22, $23::jsonb, $24, 'PREPARED', 'NOT_REQUIRED', 1,
                   '[]'::jsonb, clock_timestamp(), clock_timestamp())
           RETURNING ${ATTEMPT_COLUMNS.replaceAll('a.', '"ozon_publish_attempts".')}`,
          createId(), source.publishIntentId, source.workflowId, source.ownerUserId, source.shopId,
          source.draftVersion, source.revision, source.sourceCaptureSnapshotId, source.actorUserId,
          source.idempotencyKey, input.catalogSnapshotId, input.catalogRevision,
          json(input.catalogSnapshot), input.catalogSnapshotHash,
          json(input.attributeSchemaSnapshot), input.attributeSchemaHash,
          input.publisherContractVersion, input.endpoint, source.draftPayloadHash, source.draftStateHash,
          json(input.requestPayload), input.requestPayloadHash, json(input.offerTrace), input.offerTrace.length,
        );
        const attempt = attemptRow(rows[0]);
        await appendEvent(tx, attempt, {
          eventType: 'PREPARED',
          actorUserId: source.actorUserId,
          payload: { requestPayloadHash: attempt.requestPayloadHash, itemCount: attempt.itemCount },
        }, createId);
        return { attempt, idempotent: false };
      });
    },

    async getOwned(input) {
      return loadAttempt(
        options.client,
        'a."id" = $1 AND a."owner_user_id" = $2',
        [
          boundedOzonPublishText(input.attemptId, 'attemptId', 200),
          boundedOzonPublishText(input.ownerUserId, 'ownerUserId', 200),
        ],
      );
    },

    async getByPublishIntent(input) {
      return loadAttempt(
        options.client,
        'a."publish_intent_id" = $1 AND a."owner_user_id" = $2',
        [
          boundedOzonPublishText(input.publishIntentId, 'publishIntentId', 200),
          boundedOzonPublishText(input.ownerUserId, 'ownerUserId', 200),
        ],
      );
    },

    async listOwnedByWorkflow(input) {
      return listOwnedWorkflowAttempts(options.client, input);
    },

    async getLatestOwnedByWorkflow(input) {
      const page = await listOwnedWorkflowAttempts(options.client, { ...input, limit: 1 });
      return page.items[0] || null;
    },

    async claimSubmission(input) {
      const attemptId = boundedOzonPublishText(input.attemptId, 'attemptId', 200);
      const workerId = boundedOzonPublishText(input.workerId, 'workerId', 200);
      const leaseMs = normalizeOzonPublishLeaseMs(input.leaseMs);
      const claimBoundary = normalizeOzonPublishSubmissionClaimBoundary(input);
      return serializable(options.client, async (tx) => {
        const observed = await loadAttempt(tx, 'a."id" = $1', [attemptId]);
        if (!observed || observed.state !== 'PREPARED') return null;
        await tx.$queryRawUnsafe(
          'SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
          `ozon-publish-attempt-workflow:${observed.ownerUserId}:${observed.workflowId}`,
        );
        const current = await loadAttempt(tx, 'a."id" = $1', [attemptId], true);
        if (!current || current.state !== 'PREPARED') return null;

        const frozenAuthority = await tx.$queryRawUnsafe<Array<{
          draftValid: boolean;
          authoritativeByokAssetIds: string[];
        }>>(
          `WITH frozen_draft AS (
             SELECT draft."payload"
             FROM "source_listing_publish_intents" intent
             JOIN "source_listing_draft_versions" draft
               ON draft."workflow_id" = intent."workflow_id"
              AND draft."revision" = intent."revision"
              AND draft."owner_user_id" = intent."owner_user_id"
              AND draft."draft_version" = intent."draft_version"
             WHERE intent."id" = $1
               AND intent."owner_user_id" = $2
               AND intent."shop_id" = $3
               AND intent."workflow_id" = $4
               AND intent."revision" = $5
               AND intent."draft_version" = $6
               AND draft."shop_id" = $3
           ), assignment_values AS (
             SELECT assignment."value" AS "assignment"
             FROM frozen_draft
             CROSS JOIN LATERAL jsonb_array_elements(
               CASE
                 WHEN jsonb_typeof(frozen_draft."payload"->'media'->'assignments') = 'array'
                   THEN frozen_draft."payload"->'media'->'assignments'
                 ELSE '[]'::jsonb
               END
             ) assignment
           ), assignment_assets AS (
             SELECT assignment, assignment->>'assetId' AS "assetId"
             FROM assignment_values
           ), classified_byok AS (
             SELECT DISTINCT assignment_asset."assetId"
             FROM assignment_assets assignment_asset
             LEFT JOIN "media_assets" asset
               ON asset."id" = assignment_asset."assetId"
              AND asset."owner_user_id" = $2
             WHERE left(asset."id", 5) = 'byok_'
                OR left(asset."source_media_key", 15) = 'extension-byok:'
                OR asset."metadata"->>'generatedAssetSource' = 'EXTENSION_BYOK'
                OR asset."metadata"->>'executionMode' = 'BYOK'
                OR asset."metadata"->>'outputRole' = 'BYOK_ACCEPTED'
                OR EXISTS (
                  SELECT 1
                  FROM "extension_byok_media_provenance" marker_provenance
                  WHERE marker_provenance."execution_mode" = 'BYOK'
                    AND marker_provenance."owner_user_id" = $2
                    AND marker_provenance."shop_id" = $3
                    AND marker_provenance."workflow_id" = $4
                    AND marker_provenance."asset_id" = assignment_asset."assetId"
                )
           ), draft_validity AS (
             SELECT EXISTS (SELECT 1 FROM frozen_draft)
               AND COALESCE((
                 SELECT jsonb_typeof(frozen_draft."payload") = 'object'
                   AND jsonb_typeof(frozen_draft."payload"->'media') = 'object'
                   AND jsonb_typeof(frozen_draft."payload"->'media'->'assignments') = 'array'
                 FROM frozen_draft
               ), FALSE)
               AND (SELECT count(*) FROM assignment_values) <= 500
               AND NOT EXISTS (
                 SELECT 1
                 FROM assignment_assets assignment_asset
                 LEFT JOIN "media_assets" asset
                   ON asset."id" = assignment_asset."assetId"
                  AND asset."owner_user_id" = $2
                 WHERE jsonb_typeof(assignment_asset."assignment") <> 'object'
                    OR jsonb_typeof(assignment_asset."assignment"->'assetId') <> 'string'
                    OR assignment_asset."assetId" IS NULL
                    OR assignment_asset."assetId" = ''
                    OR char_length(assignment_asset."assetId") > 500
                    OR btrim(assignment_asset."assetId") <> assignment_asset."assetId"
                    OR asset."id" IS NULL
               ) AS "draftValid"
           )
           SELECT draft_validity."draftValid",
                  COALESCE((
                    SELECT array_agg(classified_byok."assetId" ORDER BY classified_byok."assetId")
                    FROM classified_byok
                  ), ARRAY[]::TEXT[]) AS "authoritativeByokAssetIds"
           FROM draft_validity`,
          current.publishIntentId,
          current.ownerUserId,
          current.shopId,
          current.workflowId,
          current.revision,
          current.draftVersion,
        );
        const authoritativeByokAssetIds = frozenAuthority[0]?.authoritativeByokAssetIds;
        if (frozenAuthority[0]?.draftValid !== true
          || !exactAuthoritativeAssetSet(
            authoritativeByokAssetIds,
            claimBoundary.byokAssetIds,
          )) {
          await rejectPreparedSubmissionClaim(tx, {
            attemptId,
            workerId,
            errorCode: 'LOCAL_BYOK_PROVENANCE_CONFLICT',
            errorMessage: 'Frozen draft BYOK authority changed before Ozon submission',
            createId,
          });
          return null;
        }

        if (authoritativeByokAssetIds.length) {
          const liveAuthority = await tx.$queryRawUnsafe<Array<{ sessionId: string }>>(
            `SELECT session."id" AS "sessionId"
             FROM "extension_device_sessions" session
             JOIN "extension_device_pairing_codes" pairing
               ON pairing."id" = session."pairing_code_id"
              AND pairing."deployment_id" = session."deployment_id"
              AND pairing."owner_user_id" = session."owner_user_id"
              AND pairing."actor_user_id" = session."actor_user_id"
             JOIN "extension_device_shop_grants" shop_grant
               ON shop_grant."session_id" = session."id"
              AND shop_grant."shop_id" = $4
             WHERE session."id" = $1
               AND session."owner_user_id" = $2
               AND session."actor_user_id" = $3
               AND nullif(session."deployment_id", '') IS NOT NULL
               AND session."status" = 'ACTIVE'
               AND session."revoked_at" IS NULL
               AND session."revoked_reason" IS NULL
               AND session."expires_at" > clock_timestamp()
               AND session."scopes" @> ARRAY[
                 'byok:media:ingest', 'listing:publish'
               ]::TEXT[]
               AND pairing."status" = 'CLAIMED'
               AND pairing."claimed_at" IS NOT NULL
               AND pairing."canceled_at" IS NULL
               AND $4 = ANY(pairing."shop_ids")
               AND pairing."scopes" @> ARRAY[
                 'byok:media:ingest', 'listing:publish'
               ]::TEXT[]
               AND shop_grant."status" = 'ACTIVE'
               AND shop_grant."revoked_at" IS NULL
               AND shop_grant."revoked_reason" IS NULL
             FOR UPDATE OF session, shop_grant`,
            claimBoundary.requestingDeviceSessionId,
            current.ownerUserId,
            current.actorUserId,
            current.shopId,
          );
          if (liveAuthority.length !== 1
            || liveAuthority[0]?.sessionId !== claimBoundary.requestingDeviceSessionId) {
            await rejectPreparedSubmissionClaim(tx, {
              attemptId,
              workerId,
              errorCode: 'LOCAL_BYOK_SESSION_AUTHORITY_CONFLICT',
              errorMessage: 'BYOK device session authority changed before Ozon submission',
              createId,
            });
            return null;
          }

          const provenance = await tx.$queryRawUnsafe<Array<{
            assetId: string;
            sessionMatches: boolean;
            historySafe: boolean;
          }>>(
            `SELECT provenance."asset_id" AS "assetId",
                    "extension_byok_publish_session_matches"(
                      provenance."device_session_id", $5, $1, $4, $2
                    ) AS "sessionMatches",
                    (
                      (
                        provenance."publish_intent_id" IS NULL
                        AND provenance."publish_receipt_id" IS NULL
                      )
                      OR (
                        provenance."publish_intent_id" IS NOT NULL
                        AND provenance."publish_receipt_id" IS NOT NULL
                        AND intent."id" = provenance."publish_intent_id"
                        AND receipt."id" = provenance."publish_receipt_id"
                        AND intent."owner_user_id" = $1
                        AND intent."shop_id" = $2
                        AND intent."workflow_id" = $3
                        AND command_grant."owner_user_id" = $1
                        AND command_grant."shop_id" = $2
                        AND command_grant."workflow_id" = $3
                        AND attempt."owner_user_id" = $1
                        AND attempt."shop_id" = $2
                        AND attempt."workflow_id" = $3
                        AND attempt."publish_intent_id" = intent."id"
                        AND intent."draft_version" >= 1
                        AND attempt."draft_version" = intent."draft_version"
                        AND command_grant."draft_version" = intent."draft_version"
                        AND command_grant."operation" = 'OZON_PUBLISH'
                        AND nullif(intent."idempotency_key", '') IS NOT NULL
                        AND command_grant."idempotency_key" = intent."idempotency_key"
                        AND receipt."status" = 'FAILED'
                        AND (
                          receipt."result" IS NULL
                          OR receipt."result" = 'null'::jsonb
                        )
                        AND receipt."failure_code" = 'OZON_SUBMIT_REJECTED'
                        AND attempt."state" = 'REJECTED'
                        AND attempt."reconciliation_state" = 'NOT_REQUIRED'
                        AND attempt."ozon_task_id" IS NULL
                        AND attempt."acceptance_source" IS NULL
                        AND attempt."lease_purpose" IS NULL
                        AND attempt."lease_token" IS NULL
                        AND attempt."lease_owner" IS NULL
                        AND attempt."heartbeat_at" IS NULL
                        AND attempt."lease_expires_at" IS NULL
                        AND attempt."submit_started_at" IS NOT NULL
                        AND attempt."submitted_at" IS NULL
                        AND attempt."rejected_at" IS NOT NULL
                      )
                    ) AS "historySafe"
             FROM "extension_byok_media_provenance" provenance
             LEFT JOIN "source_listing_publish_intents" intent
               ON intent."id" = provenance."publish_intent_id"
             LEFT JOIN "extension_command_receipts" receipt
               ON receipt."id" = provenance."publish_receipt_id"
             LEFT JOIN "extension_command_grants" command_grant
               ON command_grant."id" = receipt."grant_id"
             LEFT JOIN "ozon_publish_attempts" attempt
               ON attempt."publish_intent_id" = intent."id"
             WHERE provenance."execution_mode" = 'BYOK'
               AND provenance."owner_user_id" = $1
               AND provenance."shop_id" = $2
               AND provenance."workflow_id" = $3
               AND provenance."actor_user_id" = $4
               AND provenance."asset_id" = ANY($6::TEXT[])
             ORDER BY provenance."asset_id"
             FOR UPDATE OF provenance`,
            current.ownerUserId,
            current.shopId,
            current.workflowId,
            current.actorUserId,
            claimBoundary.requestingDeviceSessionId,
            authoritativeByokAssetIds,
          );
          const expectedAssets = new Set(authoritativeByokAssetIds);
          const seenAssets = new Set<string>();
          let provenanceValid = provenance.length === expectedAssets.size;
          for (const row of provenance) {
            if (typeof row.assetId !== 'string'
              || !expectedAssets.has(row.assetId)
              || seenAssets.has(row.assetId)
              || row.sessionMatches !== true
              || row.historySafe !== true) {
              provenanceValid = false;
              break;
            }
            seenAssets.add(row.assetId);
          }
          if (!provenanceValid) {
            await rejectPreparedSubmissionClaim(tx, {
              attemptId,
              workerId,
              errorCode: 'LOCAL_BYOK_PROVENANCE_CONFLICT',
              errorMessage: 'BYOK provenance changed before Ozon submission',
              createId,
            });
            return null;
          }
        }
        const valid = await tx.$queryRawUnsafe<Array<{ valid: boolean }>>(
          `SELECT EXISTS (
             SELECT 1 FROM "source_listing_workflows" workflow
             WHERE workflow."id" = $1 AND workflow."owner_user_id" = $2
               AND workflow."shop_id" = $3 AND workflow."current_revision" = $4
               AND workflow."current_draft_version" = $5
               AND workflow."stage" = 'PUBLISH_INTENT_RECORDED'
               AND workflow."status" = 'ACTIVE'
               AND EXISTS (
                 SELECT 1 FROM "ozon_category_catalog_snapshots" catalog
                 WHERE catalog."id" = $6 AND catalog."shop_id" = $3
                   AND catalog."revision" = $7 AND catalog."complete" = TRUE
                   AND catalog."default_tree_complete" = TRUE
                   AND catalog."zh_hans_tree_complete" = TRUE
                   AND catalog."is_current" = TRUE
                   AND catalog."expires_at" > clock_timestamp()
               )
               AND NOT EXISTS (
                 SELECT 1 FROM "ozon_publish_attempts" other
                 WHERE other."owner_user_id" = $2 AND other."workflow_id" = $1
                   AND other."id" <> $8
                   AND NOT (
                     other."state" = 'REJECTED'
                     AND other."reconciliation_state" = 'NOT_REQUIRED'
                     AND other."ozon_task_id" IS NULL
                     AND other."acceptance_source" IS NULL
                     AND other."lease_purpose" IS NULL
                     AND other."lease_token" IS NULL
                     AND other."lease_owner" IS NULL
                     AND other."heartbeat_at" IS NULL
                     AND other."lease_expires_at" IS NULL
                     AND other."submitted_at" IS NULL
                   )
               )
           ) AS "valid"`,
          current.workflowId, current.ownerUserId, current.shopId,
          current.revision, current.draftVersion,
          current.catalogSnapshotId, current.catalogRevision,
          current.id,
        );
        if (valid[0]?.valid !== true) {
          const rows = await tx.$queryRawUnsafe<any[]>(
            `UPDATE "ozon_publish_attempts" a
             SET "state" = 'REJECTED', "state_version" = "state_version" + 1,
                 "last_error_code" = 'LOCAL_STALE_DRAFT',
                 "last_error_message" = 'Publish intent or catalog no longer references current authoritative state',
                 "rejected_at" = clock_timestamp(), "updated_at" = clock_timestamp()
             WHERE a."id" = $1 AND a."state" = 'PREPARED'
             RETURNING ${ATTEMPT_COLUMNS}`,
            attemptId,
          );
          const rejected = attemptRow(rows[0]);
          await appendEvent(tx, rejected, {
            eventType: 'LOCAL_REJECTED', workerId,
            payload: { errorCode: rejected.lastErrorCode },
          }, createId);
          return null;
        }
        const leaseToken = createLeaseToken();
        const rows = await tx.$queryRawUnsafe<any[]>(
          `UPDATE "ozon_publish_attempts" a
           SET "state" = 'SUBMITTING', "state_version" = "state_version" + 1,
               "lease_purpose" = 'SUBMIT', "lease_token" = $2, "lease_owner" = $3,
               "lease_epoch" = "lease_epoch" + 1, "heartbeat_at" = clock_timestamp(),
               "lease_expires_at" = clock_timestamp() + ($4 * interval '1 millisecond'),
               "submit_started_at" = clock_timestamp(), "updated_at" = clock_timestamp(),
               "last_error_code" = NULL, "last_error_message" = NULL
           WHERE a."id" = $1 AND a."state" = 'PREPARED'
           RETURNING ${ATTEMPT_COLUMNS}`,
          attemptId, leaseToken, workerId, leaseMs,
        );
        if (!rows[0]) return null;
        const attempt = attemptRow(rows[0]);
        await appendEvent(tx, attempt, {
          eventType: 'SUBMISSION_CLAIMED', workerId,
          payload: { leaseEpoch: attempt.leaseEpoch, leaseTokenHash: leaseTokenHash(leaseToken) },
        }, createId);
        return { attempt, leaseToken, leaseEpoch: attempt.leaseEpoch };
      });
    },

    async heartbeat(input) {
      const rows = await options.client.$queryRawUnsafe<Array<{ id: string }>>(
        `UPDATE "ozon_publish_attempts"
         SET "heartbeat_at" = clock_timestamp(),
             "lease_expires_at" = clock_timestamp() + ($5 * interval '1 millisecond'),
             "updated_at" = clock_timestamp()
         WHERE "id" = $1 AND "lease_owner" = $2 AND "lease_token" = $3
           AND "lease_epoch" = $4 AND "lease_purpose" IN ('SUBMIT', 'RECONCILE')
           AND "lease_expires_at" > clock_timestamp()
         RETURNING "id"`,
        boundedOzonPublishText(input.attemptId, 'attemptId', 200),
        boundedOzonPublishText(input.workerId, 'workerId', 200),
        boundedOzonPublishText(input.leaseToken, 'leaseToken', 100),
        requiredPositiveInteger(input.leaseEpoch, 'leaseEpoch'),
        normalizeOzonPublishLeaseMs(input.leaseMs),
      );
      return Boolean(rows[0]);
    },

    async completeSubmission(input) {
      const attemptId = boundedOzonPublishText(input.attemptId, 'attemptId', 200);
      const workerId = boundedOzonPublishText(input.workerId, 'workerId', 200);
      const leaseToken = boundedOzonPublishText(input.leaseToken, 'leaseToken', 100);
      const leaseEpoch = requiredPositiveInteger(input.leaseEpoch, 'leaseEpoch');
      return serializable(options.client, async (tx) => {
        const current = ensureLease(
          await loadAttempt(tx, 'a."id" = $1', [attemptId], true),
          { workerId, leaseToken, leaseEpoch, purpose: 'SUBMIT' },
        );
        if (current.state !== 'SUBMITTING') {
          throw new OzonPublishAttemptError('INVALID_TRANSITION', 'Attempt is not submitting');
        }
        const response = input.outcome.response === undefined
          ? null
          : cloneOzonPublishJson(input.outcome.response, 'Ozon submission response', 512 * 1024);
        const responseHash = response === null ? null : hashOzonPublishJson(response);
        const error = input.outcome.kind === 'SUBMITTED'
          ? { errorCode: null, errorMessage: null }
          : normalizeOzonPublishError(input.outcome);
        const state = input.outcome.kind;
        const reconciliation = state === 'SUBMITTED' ? 'PENDING' : state === 'UNKNOWN' ? 'PENDING' : 'NOT_REQUIRED';
        const taskId = state === 'SUBMITTED' ? normalizeOzonPublishTaskId(input.outcome.taskId) : null;
        const acceptanceSource = state === 'SUBMITTED'
          ? boundedOzonPublishText(input.outcome.acceptanceSource || 'TASK_ACK', 'acceptanceSource', 80)
          : null;
        const rows = await tx.$queryRawUnsafe<any[]>(
          `UPDATE "ozon_publish_attempts" a
           SET "state" = $2::"OzonPublishAttemptState",
               "reconciliation_state" = $3::"OzonPublishReconciliationState",
               "state_version" = "state_version" + 1, "ozon_task_id" = $4,
               "acceptance_source" = $5, "response_json" = $6::jsonb, "response_hash" = $7,
               "last_error_code" = $8, "last_error_message" = $9,
               "submitted_at" = CASE WHEN $2 = 'SUBMITTED' THEN clock_timestamp() ELSE "submitted_at" END,
               "unknown_at" = CASE WHEN $2 = 'UNKNOWN' THEN clock_timestamp() ELSE "unknown_at" END,
               "rejected_at" = CASE WHEN $2 = 'REJECTED' THEN clock_timestamp() ELSE "rejected_at" END,
               "next_reconcile_at" = CASE WHEN $2 IN ('SUBMITTED', 'UNKNOWN') THEN clock_timestamp() ELSE NULL END,
               "lease_purpose" = NULL, "lease_token" = NULL, "lease_owner" = NULL,
               "heartbeat_at" = NULL, "lease_expires_at" = NULL, "updated_at" = clock_timestamp()
           WHERE a."id" = $1 AND a."state" = 'SUBMITTING'
             AND a."lease_owner" = $10 AND a."lease_token" = $11 AND a."lease_epoch" = $12
           RETURNING ${ATTEMPT_COLUMNS}`,
          attemptId, state, reconciliation, taskId, acceptanceSource,
          response === null ? null : json(response), responseHash,
          error.errorCode, error.errorMessage, workerId, leaseToken, leaseEpoch,
        );
        if (!rows[0]) throw new OzonPublishAttemptError('LEASE_LOST', 'Submission lease was lost');
        const attempt = attemptRow(rows[0]);
        await appendEvent(tx, attempt, {
          eventType: `SUBMISSION_${state}`, workerId,
          payload: { taskId, responseHash, errorCode: error.errorCode },
        }, createId);
        return attempt;
      });
    },

    async recoverSubmissionAcknowledgement(input) {
      const attemptId = boundedOzonPublishText(input.attemptId, 'attemptId', 200);
      const workerId = boundedOzonPublishText(input.workerId, 'workerId', 200);
      const leaseToken = boundedOzonPublishText(input.leaseToken, 'leaseToken', 100);
      const leaseEpoch = requiredPositiveInteger(input.leaseEpoch, 'leaseEpoch');
      const taskId = normalizeOzonPublishTaskId(input.taskId);
      const response = cloneOzonPublishJson(
        input.response,
        'recovered Ozon submission response',
        512 * 1024,
      );
      const responseHash = hashOzonPublishJson(response);
      if (extractOzonPublishTaskId(response) !== taskId) {
        throw new OzonPublishAttemptError(
          'INVALID_INPUT',
          'Recovered Ozon response task ID does not match the acknowledgement',
        );
      }
      return serializable(options.client, async (tx) => {
        const current = await loadAttempt(tx, 'a."id" = $1', [attemptId], true);
        if (!current) {
          throw new OzonPublishAttemptError('NOT_FOUND', 'Ozon publish attempt was not found');
        }
        if (current.state === 'SUBMITTED') {
          if (current.ozonTaskId === taskId && current.responseHash === responseHash) return current;
          throw new OzonPublishAttemptError(
            'IDEMPOTENCY_CONFLICT',
            'Ozon publish attempt already has another acknowledgement',
          );
        }
        if (current.state !== 'SUBMITTING' && current.state !== 'UNKNOWN') {
          throw new OzonPublishAttemptError(
            'INVALID_TRANSITION',
            'Ozon publish attempt cannot accept a recovered acknowledgement',
          );
        }

        let claimVerified = current.state === 'SUBMITTING'
          && current.leasePurpose === 'SUBMIT'
          && current.leaseOwner === workerId
          && current.leaseToken === leaseToken
          && current.leaseEpoch === leaseEpoch;
        if (current.state === 'UNKNOWN') {
          if (current.response !== null) {
            throw new OzonPublishAttemptError(
              'IDEMPOTENCY_CONFLICT',
              'Unknown Ozon publish attempt already contains another provider response',
            );
          }
          const claims = await tx.$queryRawUnsafe<Array<{ leaseTokenHash: string | null }>>(
            `SELECT "payload"->>'leaseTokenHash' AS "leaseTokenHash"
             FROM "ozon_publish_attempt_events"
             WHERE "attempt_id" = $1 AND "event_type" = 'SUBMISSION_CLAIMED'
               AND "state" = 'SUBMITTING' AND "reconciliation_state" = 'NOT_REQUIRED'
               AND "worker_id" = $2
               AND "payload" @> jsonb_build_object('leaseEpoch', $3::integer)
             LIMIT 1`,
            attemptId, workerId, leaseEpoch,
          );
          claimVerified = current.leaseEpoch >= leaseEpoch
            && sameLeaseTokenHash(claims[0]?.leaseTokenHash, leaseTokenHash(leaseToken));
        }
        if (!claimVerified) {
          throw new OzonPublishAttemptError(
            'LEASE_LOST',
            'Trusted Ozon acknowledgement does not match the original submission claim',
          );
        }

        const rows = await tx.$queryRawUnsafe<any[]>(
          `UPDATE "ozon_publish_attempts" a
           SET "state" = 'SUBMITTED', "reconciliation_state" = 'PENDING',
               "state_version" = "state_version" + 1, "ozon_task_id" = $2,
               "acceptance_source" = 'RECOVERED_TASK_RESPONSE',
               "response_json" = $3::jsonb, "response_hash" = $4,
               "submitted_at" = COALESCE("submitted_at", clock_timestamp()),
               "next_reconcile_at" = clock_timestamp(), "completed_at" = NULL,
               "last_error_code" = NULL, "last_error_message" = NULL,
               "lease_purpose" = NULL, "lease_token" = NULL, "lease_owner" = NULL,
               "heartbeat_at" = NULL, "lease_expires_at" = NULL,
               "updated_at" = clock_timestamp()
           WHERE a."id" = $1 AND a."state" = $5::"OzonPublishAttemptState"
             AND a."state_version" = $6
             AND ($5 <> 'SUBMITTING'
               OR (a."lease_owner" = $7 AND a."lease_token" = $8 AND a."lease_epoch" = $9))
           RETURNING ${ATTEMPT_COLUMNS}`,
          attemptId, taskId, json(response), responseHash, current.state, current.stateVersion,
          workerId, leaseToken, leaseEpoch,
        );
        if (!rows[0]) {
          throw new OzonPublishAttemptError(
            'VERSION_CONFLICT',
            'Ozon publish attempt changed during acknowledgement recovery',
          );
        }
        const attempt = attemptRow(rows[0]);
        await appendEvent(tx, attempt, {
          eventType: 'SUBMISSION_ACKNOWLEDGEMENT_RECOVERED',
          workerId,
          payload: {
            taskId,
            responseHash,
            submissionLeaseEpoch: leaseEpoch,
            submissionLeaseTokenHash: leaseTokenHash(leaseToken),
            preemptedReconciliationEpoch: current.leasePurpose === 'RECONCILE'
              ? current.leaseEpoch
              : null,
            preemptedReconciliationOwner: current.leasePurpose === 'RECONCILE'
              ? current.leaseOwner
              : null,
          },
        }, createId);
        return attempt;
      });
    },

    async markStaleSubmissionsUnknown(input) {
      const workerId = boundedOzonPublishText(input.workerId, 'workerId', 200);
      const limit = normalizeOzonPublishBatchLimit(input.limit);
      return serializable(options.client, async (tx) => {
        const rows = await tx.$queryRawUnsafe<Array<{
          id: string;
          state: OzonPublishAttemptRecord['state'];
          reconciliationState: OzonPublishAttemptRecord['reconciliationState'];
          stateVersion: number;
          leaseEpoch: number;
        }>>(
          `WITH candidates AS (
             SELECT "id" FROM "ozon_publish_attempts"
             WHERE "state" = 'SUBMITTING' AND "lease_expires_at" <= clock_timestamp()
             ORDER BY "lease_expires_at", "id"
             FOR UPDATE SKIP LOCKED LIMIT $1
           )
           UPDATE "ozon_publish_attempts" a
           SET "state" = 'UNKNOWN', "reconciliation_state" = 'PENDING',
               "state_version" = a."state_version" + 1,
               "unknown_at" = clock_timestamp(), "next_reconcile_at" = clock_timestamp(),
               "last_error_code" = 'STALE_SUBMISSION_LEASE',
               "last_error_message" = 'Submission lease expired before a durable acknowledgement',
               "lease_purpose" = NULL, "lease_token" = NULL, "lease_owner" = NULL,
               "heartbeat_at" = NULL, "lease_expires_at" = NULL, "updated_at" = clock_timestamp()
           FROM candidates WHERE a."id" = candidates."id"
           RETURNING a."id", a."state",
             a."reconciliation_state" AS "reconciliationState",
             a."state_version" AS "stateVersion", a."lease_epoch" AS "leaseEpoch"`,
          limit,
        );
        for (const row of rows) {
          await appendEvent(tx, row, {
            eventType: 'STALE_SUBMISSION_UNKNOWN', workerId,
            payload: { leaseEpoch: Number(row.leaseEpoch) },
          }, createId);
        }
        return rows.map(({ id }) => String(id));
      });
    },

    async claimReconciliation(input) {
      const workerId = boundedOzonPublishText(input.workerId, 'workerId', 200);
      const leaseMs = normalizeOzonPublishLeaseMs(input.leaseMs);
      const limit = normalizeOzonPublishBatchLimit(input.limit);
      return serializable(options.client, async (tx) => {
        const candidates = await tx.$queryRawUnsafe<Array<{ id: string; staleLease: boolean }>>(
          `SELECT "id", ("reconciliation_state" = 'RUNNING') AS "staleLease"
           FROM "ozon_publish_attempts"
           WHERE "state" IN ('SUBMITTED', 'UNKNOWN')
             AND (("reconciliation_state" IN ('PENDING', 'RETRY_WAIT')
                   AND "next_reconcile_at" <= clock_timestamp())
               OR ("reconciliation_state" = 'RUNNING'
                   AND "lease_purpose" = 'RECONCILE'
                   AND "lease_expires_at" <= clock_timestamp()))
           ORDER BY COALESCE("next_reconcile_at", "lease_expires_at"), "id"
           FOR UPDATE SKIP LOCKED LIMIT $1`,
          limit,
        );
        const claims = [];
        for (const candidate of candidates) {
          const leaseToken = createLeaseToken();
          const rows = await tx.$queryRawUnsafe<any[]>(
            `UPDATE "ozon_publish_attempts" a
             SET "reconciliation_state" = 'RUNNING', "state_version" = "state_version" + 1,
                 "reconcile_attempt_count" = "reconcile_attempt_count" + 1,
                 "next_reconcile_at" = NULL, "lease_purpose" = 'RECONCILE',
                 "lease_token" = $2, "lease_owner" = $3, "lease_epoch" = "lease_epoch" + 1,
                 "heartbeat_at" = clock_timestamp(),
                 "lease_expires_at" = clock_timestamp() + ($4 * interval '1 millisecond'),
                 "updated_at" = clock_timestamp()
             WHERE a."id" = $1 AND a."state" IN ('SUBMITTED', 'UNKNOWN')
               AND ((NOT $5 AND a."reconciliation_state" IN ('PENDING', 'RETRY_WAIT')
                     AND a."next_reconcile_at" <= clock_timestamp())
                 OR ($5 AND a."reconciliation_state" = 'RUNNING'
                     AND a."lease_purpose" = 'RECONCILE'
                     AND a."lease_expires_at" <= clock_timestamp()))
             RETURNING ${RECONCILIATION_ATTEMPT_COLUMNS}`,
            candidate.id, leaseToken, workerId, leaseMs, candidate.staleLease,
          );
          if (!rows[0]) continue;
          const attempt = reconciliationAttemptRow(rows[0]);
          await appendEvent(tx, attempt, {
            eventType: candidate.staleLease ? 'RECONCILIATION_RECLAIMED' : 'RECONCILIATION_CLAIMED', workerId,
            payload: { leaseEpoch: attempt.leaseEpoch, reconcileAttemptCount: attempt.reconcileAttemptCount },
          }, createId);
          claims.push({ attempt, leaseToken, leaseEpoch: attempt.leaseEpoch });
        }
        return claims;
      });
    },

    async completeReconciliation(input) {
      const attemptId = boundedOzonPublishText(input.attemptId, 'attemptId', 200);
      const workerId = boundedOzonPublishText(input.workerId, 'workerId', 200);
      const leaseToken = boundedOzonPublishText(input.leaseToken, 'leaseToken', 100);
      const leaseEpoch = requiredPositiveInteger(input.leaseEpoch, 'leaseEpoch');
      return serializable(options.client, async (tx) => {
        const current = ensureLease(
          await loadAttempt(tx, 'a."id" = $1', [attemptId], true),
          { workerId, leaseToken, leaseEpoch, purpose: 'RECONCILE' },
        );
        if (!['SUBMITTED', 'UNKNOWN'].includes(current.state) || current.reconciliationState !== 'RUNNING') {
          throw new OzonPublishAttemptError('INVALID_TRANSITION', 'Attempt is not reconciling');
        }
        if (current.state === 'UNKNOWN' && !['RETRY_WAIT', 'MANUAL_REVIEW'].includes(input.outcome.kind)) {
          throw new OzonPublishAttemptError(
            'INVALID_TRANSITION',
            'Unknown submission must first be acknowledged or remain under review',
          );
        }
        const itemResultsProvided = input.outcome.itemResults !== undefined;
        const itemErrorsProvided = input.outcome.itemErrors !== undefined;
        const itemResults = itemResultsProvided
          ? cloneOzonPublishArray(input.outcome.itemResults, 'Ozon item results', 2 * 1024 * 1024)
          : null;
        const itemErrors = itemErrorsProvided
          ? cloneOzonPublishArray(input.outcome.itemErrors, 'Ozon item errors', 2 * 1024 * 1024)
          : null;
        const error = normalizeOzonPublishError(input.outcome);
        const nextAt = input.outcome.kind === 'RETRY_WAIT'
          ? input.outcome.nextReconcileAt
          : null;
        if (nextAt && !Number.isFinite(nextAt.getTime())) {
          throw new OzonPublishAttemptError('INVALID_INPUT', 'nextReconcileAt is invalid');
        }
        const rows = await tx.$queryRawUnsafe<any[]>(
          `UPDATE "ozon_publish_attempts" a
           SET "reconciliation_state" = $2::"OzonPublishReconciliationState",
               "state_version" = "state_version" + 1,
               "item_results_json" = CASE WHEN $3 THEN $4::jsonb ELSE a."item_results_json" END,
               "item_errors_json" = CASE WHEN $5 THEN $6::jsonb ELSE a."item_errors_json" END,
               "last_error_code" = $7, "last_error_message" = $8,
               "last_reconciled_at" = clock_timestamp(), "next_reconcile_at" = $9,
               "completed_at" = CASE WHEN $2 IN ('SUCCEEDED', 'PARTIAL_FAILURE', 'FAILED')
                 THEN clock_timestamp() ELSE NULL END,
               "lease_purpose" = NULL, "lease_token" = NULL, "lease_owner" = NULL,
               "heartbeat_at" = NULL, "lease_expires_at" = NULL, "updated_at" = clock_timestamp()
           WHERE a."id" = $1 AND a."reconciliation_state" = 'RUNNING'
             AND a."lease_owner" = $10 AND a."lease_token" = $11 AND a."lease_epoch" = $12
           RETURNING ${ATTEMPT_COLUMNS}`,
          attemptId, input.outcome.kind,
          itemResultsProvided, itemResults === null ? null : json(itemResults),
          itemErrorsProvided, itemErrors === null ? null : json(itemErrors),
          error.errorCode, error.errorMessage, nextAt, workerId, leaseToken, leaseEpoch,
        );
        if (!rows[0]) throw new OzonPublishAttemptError('LEASE_LOST', 'Reconciliation lease was lost');
        const attempt = attemptRow(rows[0]);
        await appendEvent(tx, attempt, {
          eventType: `RECONCILIATION_${input.outcome.kind}`, workerId,
          payload: {
            itemErrorCount: attempt.itemErrors.length,
            errorCode: error.errorCode,
          },
        }, createId);
        return attempt;
      });
    },

    async attachLateAcknowledgement(input) {
      const attemptId = boundedOzonPublishText(input.attemptId, 'attemptId', 200);
      const workerId = boundedOzonPublishText(input.workerId, 'workerId', 200);
      const leaseToken = boundedOzonPublishText(input.leaseToken, 'leaseToken', 100);
      const leaseEpoch = requiredPositiveInteger(input.leaseEpoch, 'leaseEpoch');
      const taskId = normalizeOzonPublishTaskId(input.taskId);
      const response = cloneOzonPublishJson(input.response, 'late Ozon acknowledgement', 512 * 1024);
      const responseHash = hashOzonPublishJson(response);
      return serializable(options.client, async (tx) => {
        const current = ensureLease(
          await loadAttempt(tx, 'a."id" = $1', [attemptId], true),
          { workerId, leaseToken, leaseEpoch, purpose: 'RECONCILE' },
        );
        if (current.state !== 'UNKNOWN' || current.reconciliationState !== 'RUNNING') {
          throw new OzonPublishAttemptError(
            'INVALID_TRANSITION',
            'Late acknowledgement requires an unknown attempt under reconciliation',
          );
        }
        if (current.response !== null) {
          throw new OzonPublishAttemptError(
            'IDEMPOTENCY_CONFLICT',
            'Late acknowledgement cannot overwrite the original unknown provider response',
          );
        }
        const rows = await tx.$queryRawUnsafe<any[]>(
          `UPDATE "ozon_publish_attempts" a
           SET "state" = 'SUBMITTED',
               "reconciliation_state" = 'PENDING',
               "state_version" = "state_version" + 1, "ozon_task_id" = $2,
               "acceptance_source" = 'LATE_TASK_ACK', "response_json" = $3::jsonb,
               "response_hash" = $4, "submitted_at" = clock_timestamp(),
               "next_reconcile_at" = clock_timestamp(),
               "last_error_code" = NULL, "last_error_message" = NULL,
               "lease_purpose" = NULL, "lease_token" = NULL, "lease_owner" = NULL,
               "heartbeat_at" = NULL, "lease_expires_at" = NULL,
               "updated_at" = clock_timestamp()
           WHERE a."id" = $1 AND a."state" = 'UNKNOWN'
             AND a."reconciliation_state" = 'RUNNING'
             AND a."lease_owner" = $5 AND a."lease_token" = $6 AND a."lease_epoch" = $7
           RETURNING ${ATTEMPT_COLUMNS}`,
          attemptId, taskId, json(response), responseHash, workerId, leaseToken, leaseEpoch,
        );
        if (!rows[0]) throw new OzonPublishAttemptError('LEASE_LOST', 'Reconciliation lease was lost');
        const attempt = attemptRow(rows[0]);
        await appendEvent(tx, attempt, {
          eventType: 'LATE_ACKNOWLEDGEMENT', workerId,
          payload: { taskId, responseHash },
        }, createId);
        return attempt;
      });
    },

    async resolveUnknown(input) {
      const attemptId = boundedOzonPublishText(input.attemptId, 'attemptId', 200);
      const ownerUserId = boundedOzonPublishText(input.ownerUserId, 'ownerUserId', 200);
      const actorUserId = boundedOzonPublishText(input.actorUserId, 'actorUserId', 200);
      if (ownerUserId !== actorUserId) {
        throw new OzonPublishAttemptError('INVALID_INPUT', 'Only the owner may resolve an unknown publish attempt');
      }
      const expectedStateVersion = requiredPositiveInteger(input.expectedStateVersion, 'expectedStateVersion');
      const note = boundedOzonPublishText(input.resolution.note, 'resolution note', 2000);
      const evidence = cloneOzonPublishObject(input.resolution.evidence, 'resolution evidence', 256 * 1024);
      const evidenceHash = hashOzonPublishJson(evidence);
      const taskId = input.resolution.decision === 'SUBMITTED' && input.resolution.taskId
        ? normalizeOzonPublishTaskId(input.resolution.taskId)
        : null;
      return serializable(options.client, async (tx) => {
        const current = await loadAttempt(
          tx,
          'a."id" = $1 AND a."owner_user_id" = $2',
          [attemptId, ownerUserId],
          true,
        );
        if (!current) throw new OzonPublishAttemptError('NOT_FOUND', 'Ozon publish attempt was not found');
        if (current.state !== 'UNKNOWN' || current.reconciliationState === 'RUNNING') {
          throw new OzonPublishAttemptError('INVALID_TRANSITION', 'Attempt is not available for owner resolution');
        }
        if (current.stateVersion !== expectedStateVersion) {
          throw new OzonPublishAttemptError('VERSION_CONFLICT', 'Ozon publish attempt state changed');
        }
        const submitted = input.resolution.decision === 'SUBMITTED';
        const rows = await tx.$queryRawUnsafe<any[]>(
          `UPDATE "ozon_publish_attempts" a
           SET "state" = CASE WHEN $4 THEN 'SUBMITTED'::"OzonPublishAttemptState"
                 ELSE 'REJECTED'::"OzonPublishAttemptState" END,
               "reconciliation_state" = CASE WHEN $4 THEN 'PENDING'::"OzonPublishReconciliationState"
                 ELSE 'NOT_REQUIRED'::"OzonPublishReconciliationState" END,
               "state_version" = "state_version" + 1, "ozon_task_id" = $5,
               "acceptance_source" = CASE WHEN $4 THEN 'OPERATOR_EVIDENCE' ELSE NULL END,
               "submitted_at" = CASE WHEN $4 THEN clock_timestamp() ELSE "submitted_at" END,
               "rejected_at" = CASE WHEN $4 THEN "rejected_at" ELSE clock_timestamp() END,
               "next_reconcile_at" = CASE WHEN $4 THEN clock_timestamp() ELSE NULL END,
               "resolved_by_user_id" = $3, "resolution_note" = $6,
               "resolution_evidence_json" = $7::jsonb, "resolution_evidence_hash" = $8,
               "last_error_code" = CASE WHEN $4 THEN NULL ELSE 'OPERATOR_PROVEN_NOT_SUBMITTED' END,
               "last_error_message" = CASE WHEN $4 THEN NULL ELSE 'Owner evidence proved that resubmission requires a new attempt' END,
               "updated_at" = clock_timestamp()
           WHERE a."id" = $1 AND a."owner_user_id" = $2 AND a."state" = 'UNKNOWN'
             AND a."state_version" = $9
           RETURNING ${ATTEMPT_COLUMNS}`,
          attemptId, ownerUserId, actorUserId, submitted, taskId, note,
          json(evidence), evidenceHash, expectedStateVersion,
        );
        if (!rows[0]) throw new OzonPublishAttemptError('VERSION_CONFLICT', 'Ozon publish attempt state changed');
        const attempt = attemptRow(rows[0]);
        await appendEvent(tx, attempt, {
          eventType: submitted ? 'OWNER_RESOLVED_SUBMITTED' : 'OWNER_RESOLVED_NOT_SUBMITTED',
          actorUserId,
          payload: { taskId, evidenceHash },
        }, createId);
        return attempt;
      });
    },
  };
}

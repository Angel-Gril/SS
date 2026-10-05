import { createHash } from 'node:crypto';
import { runAiMediaSerializableTransaction } from '../lib/ai-media-transaction.js';
import {
  HOSTED_SUITE_LISTING_DRAFT_ASSIGNMENT_VERSION,
  type AssignHostedSuiteOutputToListingDraftInput,
  type HostedSuiteListingDraftAssignmentAuthority,
  type HostedSuiteListingDraftAssignmentBatchRecord,
  type HostedSuiteListingDraftAssignmentCommitInput,
  type HostedSuiteListingDraftAssignmentCommitResult,
  type HostedSuiteListingDraftAssignmentRecord,
  type HostedSuiteListingDraftAssignmentRepository,
  type HostedSuiteListingDraftAssignmentSlotAuthority,
  type HostedSuiteListingDraftAssignmentTransaction,
  type HostedSuiteListingDraftOutputAuthority,
} from './hosted-suite-listing-draft-assignment.js';
import { OzonListingDraftRepositoryError } from './ozon-listing-draft.js';
import {
  applySourceListingDraftCasInTransaction,
  lockCurrentSourceListingDraft,
  type SourceListingWorkflowSqlClient,
} from './source-listing-workflow-prisma.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const SAVEPOINT = 'hosted_suite_listing_assignment_batch_commit';
const MAX_ASSIGNMENTS = 500;

export interface HostedSuiteListingDraftAssignmentPrismaTransaction
  extends SourceListingWorkflowSqlClient {
  $executeRawUnsafe(sql: string, ...params: unknown[]): Promise<number>;
}

export type HostedSuiteListingDraftAssignmentPrismaClient =
  HostedSuiteListingDraftAssignmentPrismaTransaction;

export class HostedSuiteListingDraftAssignmentPrismaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'HostedSuiteListingDraftAssignmentPrismaError';
  }
}

const LEDGER_COLUMNS = `
  "assignment_id" AS "assignmentId",
  "contract_version" AS "contractVersion",
  "execution_mode" AS "executionMode",
  "batch_id" AS "batchId",
  "batch_item_ordinal" AS "batchItemOrdinal",
  "idempotency_key" AS "idempotencyKey",
  "request_hash" AS "requestHash",
  "authority_hash" AS "authorityHash",
  "owner_user_id" AS "ownerUserId",
  "actor_user_id" AS "actorUserId",
  "device_session_id" AS "deviceSessionId",
  "shop_id" AS "shopId",
  "listing_workflow_id" AS "listingWorkflowId",
  "source_draft_revision" AS "sourceDraftRevision",
  "source_draft_version" AS "sourceDraftVersion",
  "bound_draft_revision" AS "boundDraftRevision",
  "bound_draft_version" AS "boundDraftVersion",
  "source_capture_snapshot_id" AS "sourceCaptureSnapshotId",
  "assignment_scope" AS "assignmentScope",
  "sku_key" AS "skuKey",
  "slot_key" AS "slotKey",
  "assignment_ordinal" AS "assignmentOrdinal",
  "asset_id" AS "assetId",
  "asset_sha256" AS "assetSha256",
  "assignment_sha256" AS "assignmentSha256",
  "plan_id" AS "planId",
  "plan_version_id" AS "planVersionId",
  "plan_revision" AS "planRevision",
  "suite_id" AS "suiteId",
  "suite_slot_id" AS "suiteSlotId",
  "child_workflow_id" AS "childWorkflowId",
  "job_id" AS "jobId",
  "reservation_id" AS "reservationId",
  "settlement_id" AS "settlementId",
  "created_at" AS "createdAt"`;

const AUTHORITY_SQL = `
  SELECT
    actor_account."id" AS "actorId",
    actor_account."parent_id" AS "actorParentId",
    actor_account."status"::text AS "actorStatus",
    session."id" AS "deviceSessionId",
    session."device_id" AS "deviceId",
    session."owner_user_id" AS "deviceOwnerUserId",
    session."actor_user_id" AS "deviceActorUserId",
    session."revoked_at" AS "deviceRevokedAt",
    session."expires_at" AS "deviceExpiresAt",
    session."scopes" AS "deviceScopes",
    ARRAY(
      SELECT granted_shop."shop_id"
      FROM "extension_device_shop_grants" granted_shop
      WHERE granted_shop."session_id" = session."id"
        AND granted_shop."status" = 'ACTIVE'::"ExtensionDeviceShopGrantStatus"
      ORDER BY granted_shop."shop_id"
    ) AS "deviceShopIds",
    shop."id" AS "shopId",
    shop."user_id" AS "shopOwnerUserId",
    shop."status"::text AS "shopStatus",
    binding."plan_id" AS "bindingPlanId",
    binding."owner_user_id" AS "bindingOwnerUserId",
    binding."device_session_id" AS "bindingDeviceSessionId",
    binding."shop_id" AS "bindingShopId",
    binding."listing_workflow_id" AS "bindingListingWorkflowId",
    binding."source_capture_snapshot_id" AS "bindingSnapshotId",
    binding."supply_goods_id" AS "bindingSupplyGoodsId",
    binding."draft_revision" AS "bindingDraftRevision",
    binding."draft_version" AS "bindingDraftVersion",
    binding."selected_sku_hash" AS "bindingSelectedSkuHash",
    binding."candidate_media_hash" AS "bindingCandidateMediaHash",
    binding."authority_hash" AS "bindingAuthorityHash",
    binding."binding_hash" AS "bindingHash",
    plan."id" AS "planId",
    plan."owner_user_id" AS "planOwnerUserId",
    plan."actor_user_id" AS "planActorUserId",
    plan."revision" AS "planRevision",
    plan."context_type" AS "planContextType",
    plan."context_id" AS "planContextId",
    plan."current_version_id" AS "planCurrentVersionId",
    plan."approved_version_id" AS "planApprovedVersionId",
    plan."review_status"::text AS "planReviewStatus",
    plan."stale_at" AS "planStaleAt",
    version."id" AS "planVersionId",
    version."plan_id" AS "planVersionPlanId",
    version."owner_user_id" AS "planVersionOwnerUserId",
    version."source_subject_id" AS "planVersionSourceSubjectId",
    version."source_capture_snapshot_id" AS "planVersionSnapshotId",
    version."source_capture_hash" AS "planVersionSourceHash",
    version."input_snapshot_json" AS "planVersionInputSnapshot",
    version."plan_json" AS "planVersionPayload",
    suite."id" AS "suiteId",
    suite."owner_user_id" AS "suiteOwnerUserId",
    suite."actor_user_id" AS "suiteActorUserId",
    suite."plan_id" AS "suitePlanId",
    suite."plan_version_id" AS "suitePlanVersionId",
    suite."source_subject_id" AS "suiteSourceSubjectId",
    suite."source_capture_snapshot_id" AS "suiteSnapshotId",
    suite."source_capture_hash" AS "suiteSourceHash",
    suite."context_type" AS "suiteContextType",
    suite."context_id" AS "suiteContextId",
    suite."status"::text AS "suiteStatus",
    suite."revision" AS "suiteRevision",
    suite."provider" AS "suiteProvider",
    suite."model" AS "suiteModel",
    suite."item_count" AS "suiteItemCount",
    suite."completed_at" AS "suiteCompletedAt",
    suite_slot."id" AS "suiteSlotId",
    suite_slot."suite_id" AS "suiteSlotSuiteId",
    suite_slot."owner_user_id" AS "suiteSlotOwnerUserId",
    suite_slot."ordinal" AS "suiteSlotOrdinal",
    suite_slot."slot_key" AS "suiteSlotKey",
    suite_slot."ownership_level" AS "suiteSlotOwnershipLevel",
    suite_slot."ownership_key" AS "suiteSlotOwnershipKey",
    suite_slot."compatibility_group_key" AS "suiteSlotCompatibilityGroupKey",
    suite_slot."status"::text AS "suiteSlotStatus",
    suite_slot."attempt" AS "suiteSlotAttempt",
    suite_slot."revision" AS "suiteSlotRevision",
    suite_slot."child_workflow_id" AS "suiteSlotChildWorkflowId",
    child."id" AS "childWorkflowId",
    child."owner_user_id" AS "childOwnerUserId",
    child."actor_user_id" AS "childActorUserId",
    child."status"::text AS "childStatus",
    child."review_status"::text AS "childReviewStatus",
    child."revision" AS "childRevision",
    child."current_attempt" AS "childCurrentAttempt",
    child."operation"::text AS "childOperation",
    child."context_type" AS "childContextType",
    child."context_id" AS "childContextId",
    child."context_sku_key" AS "childContextSkuKey",
    child."context_slot_key" AS "childContextSlotKey",
    child."selected_output_asset_id" AS "childSelectedOutputAssetId",
    child."reviewed_by_user_id" AS "childReviewedByUserId",
    child."reviewed_at" AS "childReviewedAt",
    ARRAY(
      SELECT input_asset."source_capture_snapshot_id"
      FROM "ai_media_workflow_inputs" workflow_input
      JOIN "media_assets" input_asset
        ON input_asset."id" = workflow_input."asset_id"
       AND input_asset."owner_user_id" = workflow_input."owner_user_id"
      WHERE workflow_input."workflow_id" = child."id"
        AND workflow_input."owner_user_id" = child."owner_user_id"
      ORDER BY workflow_input."role"::text, workflow_input."ordinal", workflow_input."id"
    ) AS "childInputSnapshotIds",
    job."id" AS "jobId",
    job."owner_user_id" AS "jobOwnerUserId",
    job."actor_user_id" AS "jobActorUserId",
    job."workflow_id" AS "jobWorkflowId",
    job."workflow_attempt" AS "jobWorkflowAttempt",
    job."execution_mode" AS "jobExecutionMode",
    job."status"::text AS "jobStatus",
    job."operation"::text AS "jobOperation",
    job."provider" AS "jobProvider",
    job."model" AS "jobModel",
    job."request_fingerprint" AS "jobRequestFingerprint",
    job."actual_cost_cents" AS "jobActualCostMinor",
    job."billed_units" AS "jobBilledUnits",
    job."applied_at" AS "jobAppliedAt",
    reservation."id" AS "reservationId",
    reservation."owner_user_id" AS "reservationOwnerUserId",
    reservation."actor_user_id" AS "reservationActorUserId",
    reservation."workflow_id" AS "reservationWorkflowId",
    reservation."job_id" AS "reservationJobId",
    reservation."status"::text AS "reservationStatus",
    reservation."provider" AS "reservationProvider",
    reservation."model" AS "reservationModel",
    reservation."operation"::text AS "reservationOperation",
    reservation."request_fingerprint" AS "reservationRequestFingerprint",
    reservation."settled_at" AS "reservationSettledAt",
    settlement."id" AS "settlementId",
    settlement."reservation_id" AS "settlementReservationId",
    settlement."owner_user_id" AS "settlementOwnerUserId",
    settlement."actor_user_id" AS "settlementActorUserId",
    settlement."kind"::text AS "settlementKind",
    settlement."request_fingerprint" AS "settlementRequestFingerprint",
    settlement."actual_cost_minor" AS "settlementActualCostMinor",
    settlement."billed_units" AS "settlementBilledUnits",
    asset."id" AS "assetId",
    asset."owner_user_id" AS "assetOwnerUserId",
    asset."ai_image_job_id" AS "assetJobId",
    asset."kind"::text AS "assetKind",
    asset."source_capture_snapshot_id" AS "assetSnapshotId",
    asset."storage_backend" AS "assetStorageBackend",
    asset."storage_key" AS "assetStorageKey",
    asset."mime_type" AS "assetMimeType",
    asset."size_bytes" AS "assetSizeBytes",
    asset."width" AS "assetWidth",
    asset."height" AS "assetHeight",
    asset."sha256" AS "assetSha256",
    asset."metadata" AS "assetMetadata"
  FROM "users" actor_account
  JOIN "extension_device_sessions" session
    ON session."id" = $3
   AND session."owner_user_id" = $1
   AND session."actor_user_id" = actor_account."id"
   AND session."status" = 'ACTIVE'::"ExtensionDeviceSessionStatus"
   AND session."revoked_at" IS NULL
  JOIN "extension_device_shop_grants" requested_grant
    ON requested_grant."session_id" = session."id"
   AND requested_grant."shop_id" = $4
   AND requested_grant."status" = 'ACTIVE'::"ExtensionDeviceShopGrantStatus"
  JOIN "shops" shop
    ON shop."id" = requested_grant."shop_id"
   AND shop."user_id" = $1
   AND shop."status" = 'ACTIVE'::"ShopStatus"
   AND shop."platform" = 'OZON'::"Platform"
  JOIN "extension_hosted_ai_image_plan_bindings" binding
    ON binding."plan_id" = $9
   AND binding."owner_user_id" = $1
   AND binding."device_session_id" = $3
   AND binding."shop_id" = $4
   AND binding."listing_workflow_id" = $5
   AND binding."source_capture_snapshot_id" = $6
   AND binding."draft_revision" = $7
   AND binding."draft_version" = $8
  JOIN "ai_media_plans" plan
    ON plan."id" = binding."plan_id"
   AND plan."owner_user_id" = binding."owner_user_id"
  JOIN "ai_media_plan_versions" version
    ON version."id" = $10
   AND version."plan_id" = plan."id"
   AND version."owner_user_id" = plan."owner_user_id"
  JOIN "ai_media_suites" suite
    ON suite."id" = $11
   AND suite."owner_user_id" = $1
   AND suite."plan_id" = plan."id"
   AND suite."plan_version_id" = version."id"
  JOIN "ai_media_suite_slots" suite_slot
    ON suite_slot."suite_id" = suite."id"
   AND suite_slot."owner_user_id" = suite."owner_user_id"
  LEFT JOIN "ai_media_workflows" child
    ON child."id" = suite_slot."child_workflow_id"
   AND child."owner_user_id" = suite_slot."owner_user_id"
  LEFT JOIN "ai_image_jobs" job
    ON job."workflow_id" = child."id"
   AND job."owner_user_id" = child."owner_user_id"
   AND job."workflow_attempt" = child."current_attempt"
  LEFT JOIN "ai_cost_reservations" reservation
    ON reservation."job_id" = job."id"
   AND reservation."owner_user_id" = job."owner_user_id"
  LEFT JOIN LATERAL (
    SELECT exact_settlement.*
    FROM "ai_cost_settlements" exact_settlement
    WHERE exact_settlement."reservation_id" = reservation."id"
      AND exact_settlement."owner_user_id" = reservation."owner_user_id"
      AND exact_settlement."kind" IN (
        'CHARGE'::"AiCostSettlementKind",
        'RECONCILED_CHARGE'::"AiCostSettlementKind"
      )
    ORDER BY exact_settlement."created_at" DESC, exact_settlement."id" DESC
    LIMIT 1
  ) settlement ON TRUE
  LEFT JOIN "media_assets" asset
    ON asset."id" = child."selected_output_asset_id"
   AND asset."owner_user_id" = child."owner_user_id"
  WHERE actor_account."id" = $2
    AND actor_account."status" = 'ACTIVE'::"UserStatus"
  ORDER BY suite_slot."ordinal" ASC, suite_slot."id" ASC
  FOR UPDATE OF actor_account, session, requested_grant, shop, binding, plan, version,
    suite, suite_slot`;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function nullableText(value: unknown): string | null {
  return value == null ? null : String(value);
}

function integer(value: unknown): number {
  return Number(value);
}

function nullableInteger(value: unknown): number | null {
  return value == null ? null : Number(value);
}

function nullableDate(value: unknown): Date | null {
  return value == null ? null : new Date(value as string | number | Date);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => text(item)) : [];
}

function sameSortedStrings(left: readonly string[], right: readonly string[]): boolean {
  const sort = (values: readonly string[]) => [...values].sort((first, second) => (
    first < second ? -1 : first > second ? 1 : 0
  ));
  const sortedLeft = sort(left);
  const sortedRight = sort(right);
  return sortedLeft.length === sortedRight.length
    && sortedLeft.every((value, index) => value === sortedRight[index]);
}

function canonical(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  const item = record(value);
  if (!item) return value;
  return Object.fromEntries(
    Object.keys(item)
      .sort()
      .filter((key) => item[key] !== undefined)
      .map((key) => [key, canonical(item[key])]),
  );
}

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function frozenPlanIdentity(value: unknown): {
  sourceSubjectId: string;
  snapshotId: string;
  contextType: string;
  contextId: string;
  skuKeys: string[];
  candidateMediaKeys: string[];
} | null {
  const snapshot = record(value);
  const source = record(snapshot?.source);
  const context = record(snapshot?.context);
  const skus = Array.isArray(snapshot?.skus) ? snapshot.skus : null;
  const candidates = Array.isArray(snapshot?.candidates) ? snapshot.candidates : null;
  if (!source || !context || !skus || !candidates
    || typeof source.subjectId !== 'string'
    || typeof source.snapshotId !== 'string'
    || typeof context.type !== 'string'
    || typeof context.id !== 'string') return null;
  const skuKeys = skus.flatMap((item) => {
    const valueRecord = record(item);
    return typeof valueRecord?.skuKey === 'string' ? [valueRecord.skuKey] : [];
  }).sort();
  const candidateMediaKeys = candidates.flatMap((item) => {
    const valueRecord = record(item);
    return typeof valueRecord?.id === 'string' ? [valueRecord.id] : [];
  }).sort();
  if (skuKeys.length !== skus.length
    || candidateMediaKeys.length !== candidates.length
    || new Set(skuKeys).size !== skuKeys.length
    || new Set(candidateMediaKeys).size !== candidateMediaKeys.length) return null;
  return {
    sourceSubjectId: source.subjectId,
    snapshotId: source.snapshotId,
    contextType: context.type,
    contextId: context.id,
    skuKeys,
    candidateMediaKeys,
  };
}

function frozenPlanSlots(value: unknown) {
  const payload = record(value);
  const slots = Array.isArray(payload?.slots) ? payload.slots : null;
  const groups = Array.isArray(payload?.compatibilityGroups)
    ? payload.compatibilityGroups
    : null;
  if (!slots || !groups || slots.length < 1 || slots.length > MAX_ASSIGNMENTS) return null;
  const groupMembers = new Map<string, string[]>();
  for (const rawGroup of groups) {
    const group = record(rawGroup);
    if (typeof group?.groupKey !== 'string' || !Array.isArray(group.skuKeys)) return null;
    const skuKeys = group.skuKeys.flatMap((item) => typeof item === 'string' ? [item] : []).sort();
    if (skuKeys.length !== group.skuKeys.length
      || skuKeys.length < 1
      || new Set(skuKeys).size !== skuKeys.length
      || groupMembers.has(group.groupKey)) return null;
    groupMembers.set(group.groupKey, skuKeys);
  }
  const result = slots.flatMap((item, ordinal) => {
    const slot = record(item);
    const ownership = record(slot?.ownership);
    const slotKey = nullableText(slot?.slotKey);
    const ownershipLevel = nullableText(ownership?.level);
    const ownershipKey = nullableText(ownership?.key);
    if (!slotKey || !ownershipLevel || !ownershipKey) return [];
    const skuKeys = ownershipLevel === 'sku'
      ? [ownershipKey]
      : groupMembers.get(ownershipKey);
    if (!skuKeys || !['sku', 'compatibility_group'].includes(ownershipLevel)) return [];
    return [{
      ordinal,
      slotKey,
      ownershipLevel,
      ownershipKey,
      compatibilityGroupKey: ownershipLevel === 'compatibility_group' ? ownershipKey : null,
      skuKeys,
    }];
  });
  if (result.length !== slots.length
    || new Set(result.map((item) => item.slotKey)).size !== result.length) return null;
  return result;
}

function bindingPayload(row: Record<string, unknown>) {
  return {
    ownerUserId: text(row.bindingOwnerUserId),
    snapshotId: text(row.bindingSnapshotId),
    supplyGoodsId: text(row.bindingSupplyGoodsId),
    shopId: text(row.bindingShopId),
    listingWorkflowId: text(row.bindingListingWorkflowId),
    draftRevision: integer(row.bindingDraftRevision),
    draftVersion: integer(row.bindingDraftVersion),
    selectedSkuHash: text(row.bindingSelectedSkuHash),
    candidateMediaHash: text(row.bindingCandidateMediaHash),
  };
}

function exactBindingFromRow(
  row: Record<string, unknown>,
  input: AssignHostedSuiteOutputToListingDraftInput,
  draft: HostedSuiteListingDraftAssignmentAuthority['draft'],
  frozen: NonNullable<ReturnType<typeof frozenPlanIdentity>>,
) {
  const authority = bindingPayload(row);
  const authorityHash = hash(authority);
  const value = {
    planId: text(row.bindingPlanId),
    deviceSessionId: text(row.bindingDeviceSessionId),
    ...authority,
    authorityHash,
  };
  if (value.planId !== input.planId
    || authority.ownerUserId !== input.ownerUserId
    || value.deviceSessionId !== input.deviceSessionId
    || authority.shopId !== input.shopId
    || authority.listingWorkflowId !== input.listingWorkflowId
    || authority.snapshotId !== input.sourceCaptureSnapshotId
    || authority.draftRevision !== input.expectedDraftRevision
    || authority.draftVersion !== input.expectedDraftVersion
    || authority.supplyGoodsId !== draft.supplyGoodsId
    || frozen.snapshotId !== authority.snapshotId
    || frozen.contextType !== 'collect'
    || frozen.contextId !== authority.supplyGoodsId
    || authority.selectedSkuHash !== hash(frozen.skuKeys)
    || authority.candidateMediaHash !== hash(frozen.candidateMediaKeys)
    || text(row.bindingAuthorityHash) !== authorityHash
    || text(row.bindingHash) !== hash(value)) return null;
  return {
    ownerUserId: authority.ownerUserId,
    deviceSessionId: value.deviceSessionId,
    shopId: authority.shopId,
    listingWorkflowId: authority.listingWorkflowId,
    draftRevision: authority.draftRevision,
    draftVersion: authority.draftVersion,
    sourceCaptureSnapshotId: authority.snapshotId,
    selectedSkuKeys: frozen.skuKeys,
  };
}

function nullableChild(row: Record<string, unknown>) {
  if (row.childWorkflowId == null) return null;
  return {
    id: text(row.childWorkflowId),
    ownerUserId: text(row.childOwnerUserId),
    actorUserId: nullableText(row.childActorUserId),
    status: text(row.childStatus),
    reviewStatus: text(row.childReviewStatus),
    revision: integer(row.childRevision),
    currentAttempt: integer(row.childCurrentAttempt),
    operation: text(row.childOperation),
    contextType: text(row.childContextType),
    contextId: text(row.childContextId),
    contextSkuKey: nullableText(row.childContextSkuKey),
    contextSlotKey: nullableText(row.childContextSlotKey),
    selectedOutputAssetId: nullableText(row.childSelectedOutputAssetId),
    reviewedByOwnerUserId: nullableText(row.childReviewedByUserId),
    reviewedAt: nullableDate(row.childReviewedAt),
    inputSourceCaptureSnapshotIds: stringArray(row.childInputSnapshotIds),
  };
}

function nullableJob(row: Record<string, unknown>) {
  if (row.jobId == null) return null;
  return {
    id: text(row.jobId),
    ownerUserId: text(row.jobOwnerUserId),
    actorUserId: nullableText(row.jobActorUserId),
    workflowId: nullableText(row.jobWorkflowId),
    workflowAttempt: nullableInteger(row.jobWorkflowAttempt),
    executionMode: text(row.jobExecutionMode),
    status: text(row.jobStatus),
    operation: text(row.jobOperation),
    provider: text(row.jobProvider),
    model: text(row.jobModel),
    requestFingerprint: nullableText(row.jobRequestFingerprint),
    actualCostMinor: nullableInteger(row.jobActualCostMinor),
    billedUnits: integer(row.jobBilledUnits),
    appliedAt: nullableDate(row.jobAppliedAt),
  };
}

function nullableReservation(row: Record<string, unknown>) {
  if (row.reservationId == null) return null;
  return {
    id: text(row.reservationId),
    ownerUserId: text(row.reservationOwnerUserId),
    actorUserId: text(row.reservationActorUserId),
    workflowId: nullableText(row.reservationWorkflowId),
    jobId: text(row.reservationJobId),
    status: text(row.reservationStatus),
    provider: text(row.reservationProvider),
    model: text(row.reservationModel),
    operation: text(row.reservationOperation),
    requestFingerprint: text(row.reservationRequestFingerprint),
    settledAt: nullableDate(row.reservationSettledAt),
  };
}

function nullableSettlement(row: Record<string, unknown>) {
  if (row.settlementId == null) return null;
  return {
    id: text(row.settlementId),
    reservationId: text(row.settlementReservationId),
    ownerUserId: text(row.settlementOwnerUserId),
    actorUserId: text(row.settlementActorUserId),
    kind: text(row.settlementKind),
    requestFingerprint: text(row.settlementRequestFingerprint),
    actualCostMinor: nullableInteger(row.settlementActualCostMinor),
    billedUnits: integer(row.settlementBilledUnits),
  };
}

function nullableAsset(row: Record<string, unknown>) {
  if (row.assetId == null) return null;
  return {
    id: text(row.assetId),
    ownerUserId: text(row.assetOwnerUserId),
    aiImageJobId: nullableText(row.assetJobId),
    kind: text(row.assetKind),
    sourceCaptureSnapshotId: nullableText(row.assetSnapshotId),
    storageBackend: text(row.assetStorageBackend),
    storageKey: nullableText(row.assetStorageKey),
    mimeType: text(row.assetMimeType),
    sizeBytes: integer(row.assetSizeBytes),
    width: nullableInteger(row.assetWidth),
    height: nullableInteger(row.assetHeight),
    sha256: nullableText(row.assetSha256),
    metadata: record(row.assetMetadata) as HostedSuiteListingDraftOutputAuthority['metadata'],
  };
}

function authorityFromRows(
  rawRows: unknown[],
  input: AssignHostedSuiteOutputToListingDraftInput,
  draft: HostedSuiteListingDraftAssignmentAuthority['draft'],
): HostedSuiteListingDraftAssignmentAuthority | null {
  if (rawRows.length < 1 || rawRows.length > MAX_ASSIGNMENTS) return null;
  const rows = rawRows.map(record);
  if (rows.some((row) => !row)) return null;
  const exactRows = rows as Record<string, unknown>[];
  const first = exactRows[0]!;
  const frozen = frozenPlanIdentity(first.planVersionInputSnapshot);
  const planSlots = frozenPlanSlots(first.planVersionPayload);
  if (!frozen || !planSlots
    || frozen.sourceSubjectId !== text(first.planVersionSourceSubjectId)) return null;
  const listingBinding = exactBindingFromRow(first, input, draft, frozen);
  if (!listingBinding) return null;

  const commonIdentity = hash({
    actorId: first.actorId,
    sessionId: first.deviceSessionId,
    shopId: first.shopId,
    bindingHash: first.bindingHash,
    planId: first.planId,
    planRevision: first.planRevision,
    versionId: first.planVersionId,
    versionPayload: first.planVersionPayload,
    suiteId: first.suiteId,
    suiteRevision: first.suiteRevision,
    suiteStatus: first.suiteStatus,
    suiteCompletedAt: first.suiteCompletedAt,
  });
  if (exactRows.some((row) => hash({
    actorId: row.actorId,
    sessionId: row.deviceSessionId,
    shopId: row.shopId,
    bindingHash: row.bindingHash,
    planId: row.planId,
    planRevision: row.planRevision,
    versionId: row.planVersionId,
    versionPayload: row.planVersionPayload,
    suiteId: row.suiteId,
    suiteRevision: row.suiteRevision,
    suiteStatus: row.suiteStatus,
    suiteCompletedAt: row.suiteCompletedAt,
  }) !== commonIdentity)) return null;

  const planSlotsByKey = new Map(planSlots.map((slot) => [slot.slotKey, slot]));
  const slots = exactRows.map((row) => {
    const slotKey = text(row.suiteSlotKey);
    const planSlot = planSlotsByKey.get(slotKey);
    if (!planSlot) return null;
    return {
      planSlot,
      suiteSlot: {
        id: text(row.suiteSlotId),
        suiteId: text(row.suiteSlotSuiteId),
        ownerUserId: text(row.suiteSlotOwnerUserId),
        ordinal: integer(row.suiteSlotOrdinal),
        slotKey,
        ownershipLevel: text(row.suiteSlotOwnershipLevel),
        ownershipKey: text(row.suiteSlotOwnershipKey),
        compatibilityGroupKey: nullableText(row.suiteSlotCompatibilityGroupKey),
        status: text(row.suiteSlotStatus),
        attempt: integer(row.suiteSlotAttempt),
        revision: integer(row.suiteSlotRevision),
        childWorkflowId: nullableText(row.suiteSlotChildWorkflowId),
      },
      childWorkflow: nullableChild(row),
      currentJob: nullableJob(row),
      costReservation: nullableReservation(row),
      costSettlement: nullableSettlement(row),
      outputAsset: nullableAsset(row),
    } satisfies HostedSuiteListingDraftAssignmentSlotAuthority;
  });
  if (slots.some((slot) => !slot)) return null;
  const orderedSlots = (slots as HostedSuiteListingDraftAssignmentSlotAuthority[])
    .sort((left, right) => left.suiteSlot.ordinal - right.suiteSlot.ordinal);
  if (new Set(orderedSlots.map((slot) => slot.suiteSlot.id)).size !== orderedSlots.length) return null;

  return {
    actor: {
      id: text(first.actorId),
      ownerUserId: nullableText(first.actorParentId) || text(first.actorId),
      active: text(first.actorStatus) === 'ACTIVE',
    },
    deviceSession: {
      id: text(first.deviceSessionId),
      deviceId: text(first.deviceId),
      ownerUserId: text(first.deviceOwnerUserId),
      actorUserId: text(first.deviceActorUserId),
      revokedAt: nullableDate(first.deviceRevokedAt),
      expiresAt: new Date(first.deviceExpiresAt as string | number | Date),
      scopes: stringArray(first.deviceScopes),
      shopIds: stringArray(first.deviceShopIds),
    },
    shop: {
      id: text(first.shopId),
      ownerUserId: text(first.shopOwnerUserId),
      active: text(first.shopStatus) === 'ACTIVE',
    },
    draft,
    plan: {
      id: text(first.planId),
      ownerUserId: text(first.planOwnerUserId),
      actorUserId: text(first.planActorUserId),
      revision: integer(first.planRevision),
      contextType: text(first.planContextType),
      contextId: text(first.planContextId),
      currentVersionId: nullableText(first.planCurrentVersionId),
      approvedVersionId: nullableText(first.planApprovedVersionId),
      reviewStatus: text(first.planReviewStatus),
      staleAt: nullableDate(first.planStaleAt),
      listingBinding,
    },
    planVersion: {
      id: text(first.planVersionId),
      planId: text(first.planVersionPlanId),
      ownerUserId: text(first.planVersionOwnerUserId),
      sourceSubjectId: text(first.planVersionSourceSubjectId),
      sourceCaptureSnapshotId: text(first.planVersionSnapshotId),
      sourceCaptureHash: text(first.planVersionSourceHash),
    },
    suite: {
      id: text(first.suiteId),
      ownerUserId: text(first.suiteOwnerUserId),
      actorUserId: text(first.suiteActorUserId),
      planId: text(first.suitePlanId),
      planVersionId: text(first.suitePlanVersionId),
      sourceSubjectId: text(first.suiteSourceSubjectId),
      sourceCaptureSnapshotId: text(first.suiteSnapshotId),
      sourceCaptureHash: text(first.suiteSourceHash),
      contextType: text(first.suiteContextType),
      contextId: text(first.suiteContextId),
      status: text(first.suiteStatus),
      revision: integer(first.suiteRevision),
      provider: text(first.suiteProvider),
      model: text(first.suiteModel),
      itemCount: integer(first.suiteItemCount),
      completedAt: nullableDate(first.suiteCompletedAt),
    },
    slots: orderedSlots,
  };
}

function ledgerRecord(value: unknown): HostedSuiteListingDraftAssignmentRecord {
  const row = record(value);
  if (!row || text(row.executionMode) !== 'ERP_HOSTED') {
    throw new HostedSuiteListingDraftAssignmentPrismaError(
      'Hosted listing assignment ledger row has an invalid execution mode',
    );
  }
  const createdAt = new Date(row.createdAt as string | number | Date);
  const assignmentScope = text(row.assignmentScope);
  const result: HostedSuiteListingDraftAssignmentRecord = {
    contractVersion: text(row.contractVersion) as HostedSuiteListingDraftAssignmentRecord['contractVersion'],
    batchId: text(row.batchId),
    batchItemOrdinal: integer(row.batchItemOrdinal),
    assignmentId: text(row.assignmentId),
    idempotencyKey: text(row.idempotencyKey),
    requestHash: text(row.requestHash),
    authorityHash: text(row.authorityHash),
    ownerUserId: text(row.ownerUserId),
    actorUserId: text(row.actorUserId),
    deviceSessionId: text(row.deviceSessionId),
    shopId: text(row.shopId),
    listingWorkflowId: text(row.listingWorkflowId),
    sourceDraftRevision: integer(row.sourceDraftRevision),
    sourceDraftVersion: integer(row.sourceDraftVersion),
    boundDraftRevision: integer(row.boundDraftRevision),
    boundDraftVersion: integer(row.boundDraftVersion),
    sourceCaptureSnapshotId: text(row.sourceCaptureSnapshotId),
    assignmentScope: assignmentScope as HostedSuiteListingDraftAssignmentRecord['assignmentScope'],
    skuKey: text(row.skuKey),
    slotKey: text(row.slotKey),
    assignmentOrdinal: integer(row.assignmentOrdinal),
    assetId: text(row.assetId),
    assetSha256: text(row.assetSha256),
    assignmentSha256: text(row.assignmentSha256),
    planId: text(row.planId),
    planVersionId: text(row.planVersionId),
    planRevision: integer(row.planRevision),
    suiteId: text(row.suiteId),
    suiteSlotId: text(row.suiteSlotId),
    childWorkflowId: text(row.childWorkflowId),
    jobId: text(row.jobId),
    reservationId: text(row.reservationId),
    settlementId: text(row.settlementId),
    createdAt,
  };
  if (result.contractVersion !== HOSTED_SUITE_LISTING_DRAFT_ASSIGNMENT_VERSION
    || !['SKU', 'PRODUCT'].includes(assignmentScope)
    || !Number.isSafeInteger(result.batchItemOrdinal)
    || result.batchItemOrdinal < 0
    || !Number.isSafeInteger(result.assignmentOrdinal)
    || result.assignmentOrdinal < 0
    || !Number.isFinite(createdAt.getTime())
    || !SHA256_PATTERN.test(result.requestHash)
    || !SHA256_PATTERN.test(result.authorityHash)
    || !SHA256_PATTERN.test(result.assetSha256)
    || !SHA256_PATTERN.test(result.assignmentSha256)) {
    throw new HostedSuiteListingDraftAssignmentPrismaError(
      'Hosted listing assignment ledger row is invalid',
    );
  }
  return result;
}

function sameImmutableRecord(
  left: HostedSuiteListingDraftAssignmentRecord,
  right: HostedSuiteListingDraftAssignmentRecord,
): boolean {
  return (Object.keys(right) as Array<keyof HostedSuiteListingDraftAssignmentRecord>)
    .every((key) => key === 'createdAt'
      ? left.createdAt.getTime() === right.createdAt.getTime()
      : left[key] === right[key]);
}

function batchFromRecords(records: HostedSuiteListingDraftAssignmentRecord[]) {
  if (records.length < 1 || records.length > MAX_ASSIGNMENTS) {
    throw new HostedSuiteListingDraftAssignmentPrismaError(
      'Hosted listing assignment replay has an invalid item count',
    );
  }
  const ordered = [...records].sort((left, right) => left.batchItemOrdinal - right.batchItemOrdinal);
  const first = ordered[0]!;
  if (ordered.some((item, index) => item.batchItemOrdinal !== index
    || item.batchId !== first.batchId
    || item.requestHash !== first.requestHash
    || item.ownerUserId !== first.ownerUserId
    || item.idempotencyKey !== first.idempotencyKey
    || item.sourceDraftRevision !== first.sourceDraftRevision
    || item.sourceDraftVersion !== first.sourceDraftVersion
    || item.boundDraftRevision !== first.boundDraftRevision
    || item.boundDraftVersion !== first.boundDraftVersion
    || item.createdAt.getTime() !== first.createdAt.getTime())) {
    throw new HostedSuiteListingDraftAssignmentPrismaError(
      'Hosted listing assignment replay rows do not form one immutable batch',
    );
  }
  return {
    batchId: first.batchId,
    requestHash: first.requestHash,
    ownerUserId: first.ownerUserId,
    idempotencyKey: first.idempotencyKey,
    records: ordered,
  } satisfies HostedSuiteListingDraftAssignmentBatchRecord;
}

function sameBatch(
  left: HostedSuiteListingDraftAssignmentBatchRecord,
  records: HostedSuiteListingDraftAssignmentRecord[],
) {
  const right = batchFromRecords(records);
  return left.batchId === right.batchId
    && left.requestHash === right.requestHash
    && left.ownerUserId === right.ownerUserId
    && left.idempotencyKey === right.idempotencyKey
    && left.records.length === right.records.length
    && left.records.every((record, index) => sameImmutableRecord(record, right.records[index]!));
}

async function findReplayInTransaction(
  tx: HostedSuiteListingDraftAssignmentPrismaTransaction,
  input: { ownerUserId: string; idempotencyKey: string },
): Promise<HostedSuiteListingDraftAssignmentBatchRecord | null> {
  const rows = await tx.$queryRawUnsafe<unknown[]>(
    `SELECT ${LEDGER_COLUMNS}
     FROM "extension_hosted_ai_image_listing_assignments"
     WHERE "owner_user_id" = $1
       AND "idempotency_key" = $2
     ORDER BY "batch_item_ordinal" ASC, "assignment_id" ASC
     LIMIT 501
     FOR UPDATE`,
    input.ownerUserId,
    input.idempotencyKey,
  );
  if (rows.length === 0) return null;
  if (rows.length > MAX_ASSIGNMENTS) {
    throw new HostedSuiteListingDraftAssignmentPrismaError(
      'Hosted listing assignment idempotency lookup exceeded the batch limit',
    );
  }
  return batchFromRecords(rows.map(ledgerRecord));
}

async function loadAuthorityInTransaction(
  tx: HostedSuiteListingDraftAssignmentPrismaTransaction,
  input: AssignHostedSuiteOutputToListingDraftInput,
): Promise<HostedSuiteListingDraftAssignmentAuthority | null> {
  const draft = await lockCurrentSourceListingDraft(tx, {
    draftId: input.listingWorkflowId,
    ownerUserId: input.ownerUserId,
  });
  if (!draft) return null;
  const rows = await tx.$queryRawUnsafe<unknown[]>(
    AUTHORITY_SQL,
    input.ownerUserId,
    input.actorUserId,
    input.deviceSessionId,
    input.shopId,
    input.listingWorkflowId,
    input.sourceCaptureSnapshotId,
    input.expectedDraftRevision,
    input.expectedDraftVersion,
    input.planId,
    input.planVersionId,
    input.suiteId,
  );
  return authorityFromRows(rows, input, draft);
}

function authorityInputFromCommit(
  input: HostedSuiteListingDraftAssignmentCommitInput,
): AssignHostedSuiteOutputToListingDraftInput {
  const { expected } = input;
  return {
    ownerUserId: expected.ownerUserId,
    actorUserId: expected.actorUserId,
    deviceSessionId: expected.deviceSessionId,
    shopId: expected.shopId,
    listingWorkflowId: expected.listingWorkflowId,
    expectedDraftRevision: expected.draftRevision,
    expectedDraftVersion: expected.draftVersion,
    sourceCaptureSnapshotId: expected.sourceCaptureSnapshotId,
    assignmentStartOrdinal: expected.assignmentStartOrdinal,
    planId: expected.planId,
    planVersionId: expected.planVersionId,
    expectedPlanRevision: expected.planRevision,
    suiteId: expected.suiteId,
    expectedSuiteRevision: expected.suiteRevision,
    idempotencyKey: input.idempotencyKey,
    items: expected.items.map((item) => ({
      skuKey: item.skuKey,
      slotKey: item.slotKey,
      suiteSlotId: item.suiteSlotId,
      expectedSuiteSlotRevision: item.suiteSlotRevision,
      childWorkflowId: item.childWorkflowId,
      expectedChildWorkflowRevision: item.childWorkflowRevision,
      outputAssetId: item.outputAssetId,
    })),
  };
}

function authorityStillCurrent(
  authority: HostedSuiteListingDraftAssignmentAuthority,
  input: HostedSuiteListingDraftAssignmentCommitInput,
): boolean {
  const { expected, appliedAt } = input;
  const approved = authority.slots.filter((slot) => slot.childWorkflow?.reviewStatus === 'APPROVED');
  const assignments = Array.isArray(authority.draft.media?.assignments)
    ? authority.draft.media.assignments
    : [];
  const common = authority.actor.id === expected.actorUserId
    && authority.actor.ownerUserId === expected.ownerUserId
    && authority.actor.active
    && authority.deviceSession.id === expected.deviceSessionId
    && authority.deviceSession.ownerUserId === expected.ownerUserId
    && authority.deviceSession.actorUserId === expected.actorUserId
    && authority.deviceSession.revokedAt === null
    && authority.deviceSession.expiresAt.getTime() > appliedAt.getTime()
    && authority.deviceSession.scopes.includes('listing:write')
    && authority.deviceSession.shopIds.includes(expected.shopId)
    && authority.shop.id === expected.shopId
    && authority.shop.ownerUserId === expected.ownerUserId
    && authority.shop.active
    && authority.draft.id === expected.listingWorkflowId
    && authority.draft.ownerUserId === expected.ownerUserId
    && authority.draft.shopId === expected.shopId
    && authority.draft.revision === expected.draftRevision
    && authority.draft.draftVersion === expected.draftVersion
    && authority.draft.sourceCaptureSnapshotId === expected.sourceCaptureSnapshotId
    && authority.draft.sourceCaptureHash === expected.sourceCaptureHash
    && assignments.length === expected.assignmentStartOrdinal
    && authority.plan.id === expected.planId
    && authority.plan.ownerUserId === expected.ownerUserId
    && authority.plan.actorUserId === expected.actorUserId
    && authority.plan.revision === expected.planRevision
    && authority.plan.currentVersionId === expected.planVersionId
    && authority.plan.approvedVersionId === expected.planVersionId
    && authority.plan.reviewStatus === 'APPROVED'
    && authority.plan.staleAt === null
    && authority.plan.listingBinding.deviceSessionId === expected.deviceSessionId
    && authority.plan.listingBinding.draftRevision === expected.draftRevision
    && authority.plan.listingBinding.draftVersion === expected.draftVersion
    && authority.planVersion.id === expected.planVersionId
    && authority.planVersion.planId === expected.planId
    && authority.planVersion.ownerUserId === expected.ownerUserId
    && authority.planVersion.sourceCaptureHash === expected.sourceCaptureHash
    && authority.suite.id === expected.suiteId
    && authority.suite.ownerUserId === expected.ownerUserId
    && authority.suite.actorUserId === expected.actorUserId
    && authority.suite.revision === expected.suiteRevision
    && ['SUCCEEDED', 'PARTIAL_FAILURE'].includes(authority.suite.status)
    && authority.suite.itemCount === authority.slots.length
    && approved.length === expected.items.length;
  if (!common) return false;
  return expected.items.every((item, index) => {
    const slot = approved[index];
    if (!slot) return false;
    const { planSlot, suiteSlot, childWorkflow, currentJob, costReservation, costSettlement,
      outputAsset } = slot;
    const scopeCurrent = item.assignmentScope === 'SKU'
      ? planSlot.ownershipLevel === 'sku' && planSlot.ownershipKey === item.skuKey
      : planSlot.ownershipLevel === 'compatibility_group'
        && planSlot.skuKeys.includes(item.skuKey)
        && sameSortedStrings(planSlot.skuKeys, sourceListingEditorSkuKeysForDraft(authority.draft));
    return scopeCurrent
      && planSlot.ordinal === item.planSlotOrdinal
      && suiteSlot.ordinal === item.planSlotOrdinal
      && suiteSlot.id === item.suiteSlotId
      && suiteSlot.slotKey === item.slotKey
      && suiteSlot.status === 'SUCCEEDED'
      && suiteSlot.revision === item.suiteSlotRevision
      && suiteSlot.childWorkflowId === item.childWorkflowId
      && childWorkflow?.id === item.childWorkflowId
      && childWorkflow.ownerUserId === expected.ownerUserId
      && childWorkflow.actorUserId === expected.actorUserId
      && childWorkflow.status === 'SUCCEEDED'
      && childWorkflow.reviewStatus === 'APPROVED'
      && childWorkflow.revision === item.childWorkflowRevision
      && childWorkflow.currentAttempt === item.childWorkflowAttempt
      && childWorkflow.selectedOutputAssetId === item.outputAssetId
      && childWorkflow.reviewedByOwnerUserId === expected.ownerUserId
      && childWorkflow.reviewedAt !== null
      && childWorkflow.reviewedAt.getTime() <= appliedAt.getTime()
      && currentJob?.id === item.jobId
      && currentJob.ownerUserId === expected.ownerUserId
      && currentJob.actorUserId === expected.actorUserId
      && currentJob.workflowId === item.childWorkflowId
      && currentJob.workflowAttempt === item.childWorkflowAttempt
      && currentJob.executionMode === 'ERP_HOSTED'
      && currentJob.status === 'SUCCEEDED'
      && currentJob.requestFingerprint === item.requestFingerprint
      && currentJob.actualCostMinor === item.actualCostMinor
      && currentJob.billedUnits === item.billedUnits
      && currentJob.appliedAt === null
      && costReservation?.id === item.reservationId
      && costReservation.status === 'SETTLED'
      && costReservation.jobId === item.jobId
      && costReservation.requestFingerprint === item.requestFingerprint
      && costSettlement?.id === item.settlementId
      && ['CHARGE', 'RECONCILED_CHARGE'].includes(costSettlement.kind)
      && costSettlement.requestFingerprint === item.requestFingerprint
      && costSettlement.actualCostMinor === item.actualCostMinor
      && costSettlement.billedUnits === item.billedUnits
      && outputAsset?.id === item.outputAssetId
      && outputAsset.ownerUserId === expected.ownerUserId
      && outputAsset.aiImageJobId === item.jobId
      && outputAsset.kind === 'AI_GENERATED'
      && outputAsset.sourceCaptureSnapshotId === expected.sourceCaptureSnapshotId
      && outputAsset.sha256 === item.assetSha256
      && !assignments.some((assignment) => assignment.slotKey === item.slotKey)
      && !assignments.some((assignment) => assignment.assetId === item.outputAssetId);
  });
}

function recordMatchesCommit(input: HostedSuiteListingDraftAssignmentCommitInput): boolean {
  const { expected, records } = input;
  if (records.length !== expected.items.length || records.length < 1) return false;
  return records.every((stored, index) => {
    const item = expected.items[index];
    return item !== undefined
      && stored.contractVersion === HOSTED_SUITE_LISTING_DRAFT_ASSIGNMENT_VERSION
      && stored.batchId === input.batchId
      && stored.batchItemOrdinal === index
      && stored.idempotencyKey === input.idempotencyKey
      && stored.requestHash === input.requestHash
      && Number.isFinite(stored.createdAt.getTime())
      && stored.createdAt.getTime() === input.appliedAt.getTime()
      && stored.ownerUserId === expected.ownerUserId
      && stored.actorUserId === expected.actorUserId
      && stored.deviceSessionId === expected.deviceSessionId
      && stored.shopId === expected.shopId
      && stored.listingWorkflowId === expected.listingWorkflowId
      && stored.sourceDraftRevision === expected.draftRevision
      && stored.sourceDraftVersion === expected.draftVersion
      && stored.boundDraftRevision === expected.draftRevision + 1
      && stored.boundDraftVersion === expected.draftVersion + 1
      && stored.sourceCaptureSnapshotId === expected.sourceCaptureSnapshotId
      && stored.assignmentScope === item.assignmentScope
      && stored.skuKey === item.skuKey
      && stored.slotKey === item.slotKey
      && stored.assignmentOrdinal === item.assignmentOrdinal
      && stored.assetId === item.outputAssetId
      && stored.assetSha256 === item.assetSha256
      && stored.planId === expected.planId
      && stored.planVersionId === expected.planVersionId
      && stored.planRevision === expected.planRevision
      && stored.suiteId === expected.suiteId
      && stored.suiteSlotId === item.suiteSlotId
      && stored.childWorkflowId === item.childWorkflowId
      && stored.jobId === item.jobId
      && stored.reservationId === item.reservationId
      && stored.settlementId === item.settlementId;
  });
}

function ledgerValues(row: HostedSuiteListingDraftAssignmentRecord): unknown[] {
  return [
    row.assignmentId,
    row.contractVersion,
    'ERP_HOSTED',
    row.batchId,
    row.batchItemOrdinal,
    row.idempotencyKey,
    row.requestHash,
    row.authorityHash,
    row.ownerUserId,
    row.actorUserId,
    row.deviceSessionId,
    row.shopId,
    row.listingWorkflowId,
    row.sourceDraftRevision,
    row.sourceDraftVersion,
    row.boundDraftRevision,
    row.boundDraftVersion,
    row.sourceCaptureSnapshotId,
    row.assignmentScope,
    row.skuKey,
    row.slotKey,
    row.assignmentOrdinal,
    row.assetId,
    row.assetSha256,
    row.assignmentSha256,
    row.planId,
    row.planVersionId,
    row.planRevision,
    row.suiteId,
    row.suiteSlotId,
    row.childWorkflowId,
    row.jobId,
    row.reservationId,
    row.settlementId,
    row.createdAt,
  ];
}

async function insertLedgerBatch(
  tx: HostedSuiteListingDraftAssignmentPrismaTransaction,
  input: HostedSuiteListingDraftAssignmentCommitInput,
): Promise<HostedSuiteListingDraftAssignmentRecord[]> {
  const values = input.records.flatMap(ledgerValues);
  const width = ledgerValues(input.records[0]!).length;
  const placeholders = input.records.map((_record, rowIndex) => (
    `(${Array.from({ length: width }, (_value, columnIndex) => (
      `$${rowIndex * width + columnIndex + 1}`
    )).join(', ')})`
  )).join(',\n');
  const rows = await tx.$queryRawUnsafe<unknown[]>(
    `INSERT INTO "extension_hosted_ai_image_listing_assignments"
      ("assignment_id", "contract_version", "execution_mode", "batch_id",
       "batch_item_ordinal", "idempotency_key", "request_hash", "authority_hash",
       "owner_user_id", "actor_user_id", "device_session_id", "shop_id",
       "listing_workflow_id", "source_draft_revision", "source_draft_version",
       "bound_draft_revision", "bound_draft_version", "source_capture_snapshot_id",
       "assignment_scope", "sku_key", "slot_key", "assignment_ordinal", "asset_id",
       "asset_sha256", "assignment_sha256", "plan_id", "plan_version_id",
       "plan_revision", "suite_id", "suite_slot_id", "child_workflow_id", "job_id",
       "reservation_id", "settlement_id", "created_at")
     VALUES ${placeholders}
     ON CONFLICT DO NOTHING
     RETURNING ${LEDGER_COLUMNS}`,
    ...values,
  );
  return rows.map(ledgerRecord).sort((left, right) => (
    left.batchItemOrdinal - right.batchItemOrdinal
  ));
}

function draftCasConflict(error: unknown): boolean {
  return error instanceof OzonListingDraftRepositoryError
    && ['NOT_FOUND', 'VERSION_CONFLICT'].includes(error.code);
}

async function rollbackSavepoint(tx: HostedSuiteListingDraftAssignmentPrismaTransaction) {
  await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`);
  await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${SAVEPOINT}`);
}

async function markJobsApplied(
  tx: HostedSuiteListingDraftAssignmentPrismaTransaction,
  input: HostedSuiteListingDraftAssignmentCommitInput,
) {
  const expectedJobs = input.expected.items.map((item) => ({
    id: item.jobId,
    ownerUserId: input.expected.ownerUserId,
    actorUserId: input.expected.actorUserId,
    workflowId: item.childWorkflowId,
    workflowAttempt: item.childWorkflowAttempt,
    requestFingerprint: item.requestFingerprint,
    actualCostMinor: item.actualCostMinor,
    billedUnits: item.billedUnits,
  }));
  const changed = await tx.$queryRawUnsafe<Array<{ id: string }>>(
    `WITH expected AS (
       SELECT *
       FROM jsonb_to_recordset($1::jsonb) AS item(
         "id" text,
         "ownerUserId" text,
         "actorUserId" text,
         "workflowId" text,
         "workflowAttempt" integer,
         "requestFingerprint" text,
         "actualCostMinor" integer,
         "billedUnits" integer
       )
     )
     UPDATE "ai_image_jobs" AS job
     SET "applied_mode" = $2,
         "apply_target_type" = $3,
         "apply_target_id" = $4,
         "applied_at" = $5,
         "updated_at" = $5
     FROM expected
     WHERE job."id" = expected."id"
       AND job."owner_user_id" = expected."ownerUserId"
       AND job."actor_user_id" = expected."actorUserId"
       AND job."workflow_id" = expected."workflowId"
       AND job."workflow_attempt" = expected."workflowAttempt"
       AND job."execution_mode" = 'ERP_HOSTED'
       AND job."status" = 'SUCCEEDED'::"AiImageJobStatus"
       AND job."request_fingerprint" = expected."requestFingerprint"
       AND job."actual_cost_cents" = expected."actualCostMinor"
       AND job."billed_units" = expected."billedUnits"
       AND job."applied_at" IS NULL
     RETURNING job."id"`,
    JSON.stringify(expectedJobs),
    'append',
    'listing-draft',
    input.expected.listingWorkflowId,
    input.appliedAt,
  );
  const changedIds = new Set(changed.map((row) => text(row.id)));
  return changed.length === expectedJobs.length
    && expectedJobs.every((job) => changedIds.has(job.id));
}

async function commitInTransaction(
  tx: HostedSuiteListingDraftAssignmentPrismaTransaction,
  input: HostedSuiteListingDraftAssignmentCommitInput,
): Promise<HostedSuiteListingDraftAssignmentCommitResult> {
  const existing = await findReplayInTransaction(tx, {
    ownerUserId: input.expected.ownerUserId,
    idempotencyKey: input.idempotencyKey,
  });
  if (existing) {
    return sameBatch(existing, input.records)
      ? { kind: 'replayed', batch: existing }
      : { kind: 'idempotency-conflict' };
  }
  if (!recordMatchesCommit(input)) return { kind: 'cas-conflict' };

  const authority = await loadAuthorityInTransaction(tx, authorityInputFromCommit(input));
  if (!authority || !authorityStillCurrent(authority, input)) return { kind: 'cas-conflict' };

  await tx.$executeRawUnsafe(`SAVEPOINT ${SAVEPOINT}`);
  let savepointOpen = true;
  try {
    const inserted = await insertLedgerBatch(tx, input);
    if (inserted.length !== input.records.length
      || !inserted.every((record, index) => sameImmutableRecord(record, input.records[index]!))) {
      await rollbackSavepoint(tx);
      savepointOpen = false;
      const winner = await findReplayInTransaction(tx, {
        ownerUserId: input.expected.ownerUserId,
        idempotencyKey: input.idempotencyKey,
      });
      if (!winner) return { kind: 'cas-conflict' };
      return sameBatch(winner, input.records)
        ? { kind: 'replayed', batch: winner }
        : { kind: 'idempotency-conflict' };
    }

    let persisted;
    try {
      persisted = await applySourceListingDraftCasInTransaction(tx, {
        draftId: input.expected.listingWorkflowId,
        ownerUserId: input.expected.ownerUserId,
        actorUserId: input.expected.actorUserId,
        expectedRevision: input.expected.draftRevision,
        next: input.nextDraft,
      }, input.appliedAt);
    } catch (error) {
      if (!draftCasConflict(error)) throw error;
      await rollbackSavepoint(tx);
      savepointOpen = false;
      return { kind: 'cas-conflict' };
    }
    if (persisted.revision !== input.expected.draftRevision + 1
      || persisted.draftVersion !== input.expected.draftVersion + 1
      || !await markJobsApplied(tx, input)) {
      await rollbackSavepoint(tx);
      savepointOpen = false;
      return { kind: 'cas-conflict' };
    }

    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${SAVEPOINT}`);
    savepointOpen = false;
    return {
      kind: 'committed',
      batch: batchFromRecords(inserted),
    };
  } catch (error) {
    if (savepointOpen) await rollbackSavepoint(tx);
    throw error;
  }
}

function transactionAdapter(
  tx: HostedSuiteListingDraftAssignmentPrismaTransaction,
): HostedSuiteListingDraftAssignmentTransaction {
  return {
    findReplay(input) {
      return findReplayInTransaction(tx, input);
    },
    loadAuthority(input) {
      return loadAuthorityInTransaction(tx, input);
    },
    commit(input) {
      return commitInTransaction(tx, input);
    },
  };
}

export function createPrismaHostedSuiteListingDraftAssignmentRepository(
  client: HostedSuiteListingDraftAssignmentPrismaClient,
): HostedSuiteListingDraftAssignmentRepository {
  return {
    transaction(operation) {
      return runAiMediaSerializableTransaction(client, async (rawTransaction) => (
        operation(transactionAdapter(
          rawTransaction as HostedSuiteListingDraftAssignmentPrismaTransaction,
        ))
      ));
    },
  };
}
import { sourceListingEditorSkuKeysForDraft } from './source-listing-sku-copies.js';

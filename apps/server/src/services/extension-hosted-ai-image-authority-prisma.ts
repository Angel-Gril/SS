import { createHash } from 'node:crypto';
import {
  SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
  verifySourceProductCaptureV2Submission,
  type SourceProductCaptureV2,
} from 'shared';
import {
  isExtensionHostedAiImageActiveDraftStage,
  type ExtensionHostedAiImagePlanAuthority,
} from './extension-hosted-ai-image-plan.js';
import type {
  ExtensionHostedCandidatePreviewAuthority,
  ExtensionHostedCandidatePreviewBinding,
} from './extension-hosted-ai-image-suite-candidate-preview.js';
import {
  AI_IMAGE_SUITE_OUTPUT_HEIGHT,
  AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_INPUT_BYTES,
  AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
  AI_IMAGE_SUITE_OUTPUT_WIDTH,
} from './ai-image-suite-output-normalizer.js';
import { capturedSourceSkuAliases } from './source-listing-sku-identity.js';

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const MAX_IDENTIFIER_LENGTH = 1_024;
const MAX_SELECTED_SKUS = 50;
const MAX_CANDIDATE_MEDIA = 25;

const PLAN_AUTHORITY_SQL = `
SELECT
  w."id" AS "listingWorkflowId",
  w."owner_user_id" AS "workflowOwnerUserId",
  w."shop_id" AS "workflowShopId",
  w."source_subject_id" AS "workflowSourceSubjectId",
  w."current_source_capture_snapshot_id" AS "workflowSnapshotId",
  w."supply_goods_id" AS "workflowSupplyGoodsId",
  w."selected_sku_keys" AS "workflowSelectedSkuKeys",
  w."current_revision" AS "workflowRevision",
  w."current_draft_version" AS "workflowDraftVersion",
  w."stage" AS "workflowStage",
  w."status"::text AS "workflowStatus",
  d."owner_user_id" AS "draftOwnerUserId",
  d."shop_id" AS "draftShopId",
  d."source_capture_snapshot_id" AS "draftSnapshotId",
  d."supply_goods_id" AS "draftSupplyGoodsId",
  d."selected_sku_keys" AS "draftSelectedSkuKeys",
  d."revision" AS "draftRevision",
  d."draft_version" AS "draftVersion",
  d."stage" AS "draftStage",
  d."status"::text AS "draftStatus",
  subject."owner_user_id" AS "subjectOwnerUserId",
  subject."legacy_supply_goods_id" AS "subjectSupplyGoodsId",
  goods."user_id" AS "goodsOwnerUserId",
  shop."user_id" AS "shopOwnerUserId",
  shop."status"::text AS "shopStatus",
  shop."platform"::text AS "shopPlatform",
  snapshot."subject_id" AS "snapshotSubjectId",
  snapshot."capture_hash" AS "snapshotCaptureHash",
  snapshot."payload_bytes" AS "snapshotPayloadBytes",
  snapshot."payload" AS "snapshotPayload",
  latest."id" AS "latestSnapshotId"
FROM "source_listing_workflows" w
JOIN "source_listing_draft_versions" d
  ON d."workflow_id" = w."id"
 AND d."owner_user_id" = w."owner_user_id"
 AND d."revision" = w."current_revision"
 AND d."draft_version" = w."current_draft_version"
JOIN "source_capture_subjects" subject
  ON subject."id" = w."source_subject_id"
 AND subject."owner_user_id" = w."owner_user_id"
JOIN "source_capture_snapshots" snapshot
  ON snapshot."id" = w."current_source_capture_snapshot_id"
 AND snapshot."id" = d."source_capture_snapshot_id"
 AND snapshot."subject_id" = w."source_subject_id"
JOIN "supply_goods" goods
  ON goods."id" = w."supply_goods_id"
 AND goods."user_id" = w."owner_user_id"
JOIN "shops" shop
  ON shop."id" = w."shop_id"
 AND shop."user_id" = w."owner_user_id"
JOIN LATERAL (
  SELECT candidate."id"
  FROM "source_capture_snapshots" candidate
  WHERE candidate."subject_id" = w."source_subject_id"
  ORDER BY candidate."version" DESC, candidate."created_at" DESC, candidate."id" DESC
  LIMIT 1
) latest ON TRUE
WHERE w."owner_user_id" = $1
  AND w."id" = $2
LIMIT 2`;

const PLAN_BINDING_SQL = `
SELECT
  b."plan_id" AS "planId",
  b."owner_user_id" AS "ownerUserId",
  b."device_session_id" AS "deviceSessionId",
  b."shop_id" AS "shopId",
  b."listing_workflow_id" AS "listingWorkflowId",
  b."source_capture_snapshot_id" AS "snapshotId",
  b."supply_goods_id" AS "supplyGoodsId",
  b."draft_revision" AS "draftRevision",
  b."draft_version" AS "draftVersion",
  b."selected_sku_hash" AS "selectedSkuHash",
  b."candidate_media_hash" AS "candidateMediaHash",
  b."authority_hash" AS "authorityHash",
  b."binding_hash" AS "bindingHash"
FROM "extension_hosted_ai_image_plan_bindings" b
WHERE b."owner_user_id" = $1
  AND b."device_session_id" = $2
  AND b."listing_workflow_id" = $3
  AND b."draft_revision" = $4
  AND b."draft_version" = $5
  AND b."source_capture_snapshot_id" = $6
  AND b."supply_goods_id" = $7
  AND b."shop_id" = $8
  AND b."plan_id" = $9
LIMIT 2`;

const CANDIDATE_AUTHORITY_SQL = `
SELECT
  b."plan_id" AS "bindingPlanId",
  b."owner_user_id" AS "bindingOwnerUserId",
  b."device_session_id" AS "bindingDeviceSessionId",
  b."shop_id" AS "bindingShopId",
  b."listing_workflow_id" AS "bindingListingWorkflowId",
  b."source_capture_snapshot_id" AS "bindingSnapshotId",
  b."supply_goods_id" AS "bindingSupplyGoodsId",
  b."draft_revision" AS "bindingDraftRevision",
  b."draft_version" AS "bindingDraftVersion",
  b."selected_sku_hash" AS "bindingSelectedSkuHash",
  b."candidate_media_hash" AS "bindingCandidateMediaHash",
  b."authority_hash" AS "bindingAuthorityHash",
  b."binding_hash" AS "bindingHash",
  listing."current_revision" AS "currentDraftRevision",
  listing."current_draft_version" AS "currentDraftVersion",
  listing."current_source_capture_snapshot_id" AS "currentSnapshotId",
  listing."shop_id" AS "currentShopId",
  listing."supply_goods_id" AS "currentSupplyGoodsId",
  listing."source_subject_id" AS "currentSourceSubjectId",
  listing."status"::text AS "listingStatus",
  listing."stage" AS "listingStage",
  draft."owner_user_id" AS "draftOwnerUserId",
  draft."shop_id" AS "draftShopId",
  draft."source_capture_snapshot_id" AS "draftSnapshotId",
  draft."supply_goods_id" AS "draftSupplyGoodsId",
  draft."revision" AS "draftRevision",
  draft."draft_version" AS "draftVersion",
  draft."status"::text AS "draftStatus",
  draft."stage" AS "draftStage",
  snapshot."capture_hash" AS "currentSourceCaptureHash",
  latest."id" AS "latestSnapshotId",
  plan."id" AS "planId",
  plan."owner_user_id" AS "planOwnerUserId",
  plan."source_subject_id" AS "planSourceSubjectId",
  plan."context_type" AS "planContextType",
  plan."context_id" AS "planContextId",
  plan."revision" AS "planRevision",
  plan."review_status"::text AS "planReviewStatus",
  plan."stale_at" AS "planStaleAt",
  plan."current_version_id" AS "planCurrentVersionId",
  plan."approved_version_id" AS "planApprovedVersionId",
  version."id" AS "planVersionId",
  version."plan_id" AS "planVersionPlanId",
  version."owner_user_id" AS "planVersionOwnerUserId",
  version."source_subject_id" AS "planVersionSourceSubjectId",
  version."source_capture_snapshot_id" AS "planVersionSnapshotId",
  version."source_capture_hash" AS "planVersionSourceHash",
  version."selected_sku_hash" AS "planVersionSelectedSkuHash",
  version."input_asset_set_hash" AS "planVersionCandidateMediaHash",
  suite."id" AS "suiteId",
  suite."owner_user_id" AS "suiteOwnerUserId",
  suite."plan_id" AS "suitePlanId",
  suite."plan_version_id" AS "suitePlanVersionId",
  suite."source_subject_id" AS "suiteSourceSubjectId",
  suite."source_capture_snapshot_id" AS "suiteSnapshotId",
  suite."source_capture_hash" AS "suiteSourceHash",
  suite."context_type" AS "suiteContextType",
  suite."context_id" AS "suiteContextId",
  suite."status"::text AS "suiteStatus",
  suite."revision" AS "suiteRevision",
  slot."id" AS "slotId",
  slot."suite_id" AS "slotSuiteId",
  slot."owner_user_id" AS "slotOwnerUserId",
  slot."slot_key" AS "slotKey",
  slot."ownership_level" AS "slotOwnershipLevel",
  slot."ownership_key" AS "slotOwnershipKey",
  slot."status"::text AS "slotStatus",
  slot."attempt" AS "slotAttempt",
  slot."revision" AS "slotRevision",
  slot."child_workflow_id" AS "slotWorkflowId",
  workflow."id" AS "workflowId",
  workflow."owner_user_id" AS "workflowOwnerUserId",
  workflow."status"::text AS "workflowStatus",
  workflow."review_status"::text AS "workflowReviewStatus",
  workflow."revision" AS "workflowRevision",
  workflow."current_attempt" AS "workflowCurrentAttempt",
  workflow."context_type" AS "workflowContextType",
  workflow."context_id" AS "workflowContextId",
  workflow."context_sku_key" AS "workflowSkuKey",
  workflow."context_slot_key" AS "workflowSlotKey",
  workflow."selected_output_asset_id" AS "workflowSelectedOutputAssetId",
  job."id" AS "jobId",
  job."owner_user_id" AS "jobOwnerUserId",
  job."workflow_id" AS "jobWorkflowId",
  job."workflow_attempt" AS "jobWorkflowAttempt",
  job."execution_mode" AS "jobExecutionMode",
  job."status"::text AS "jobStatus",
  job."actual_cost_cents" AS "jobActualCostCents",
  job."billed_units" AS "jobBilledUnits",
  reservation."status"::text AS "reservationStatus",
  (
    suite."provider" <> 'fake'
    AND job."provider" <> 'fake'
    AND job."provider" = suite."provider"
    AND job."model" = suite."model"
  ) AS "paidHosted",
  (
    reservation."status" = 'SETTLED'::"AiCostReservationStatus"
    AND reservation."settled_at" IS NOT NULL
    AND reservation."request_fingerprint" = job."request_fingerprint"
    AND reservation."provider" = job."provider"
    AND reservation."model" = job."model"
    AND reservation."operation" = job."operation"
    AND EXISTS (
      SELECT 1
      FROM "ai_cost_settlements" settlement
      WHERE settlement."reservation_id" = reservation."id"
        AND settlement."owner_user_id" = reservation."owner_user_id"
        AND settlement."kind" IN (
          'CHARGE'::"AiCostSettlementKind",
          'RECONCILED_CHARGE'::"AiCostSettlementKind"
        )
        AND settlement."request_fingerprint" = reservation."request_fingerprint"
        AND settlement."actual_cost_minor" = job."actual_cost_cents"
        AND settlement."billed_units" = job."billed_units"
    )
  ) AS "settledCostEvidence",
  output."id" AS "outputId",
  output."owner_user_id" AS "outputOwnerUserId",
  output."ai_image_job_id" AS "outputJobId",
  output."kind"::text AS "outputKind",
  output."source_capture_snapshot_id" AS "outputSnapshotId",
  output."storage_backend" AS "outputStorageBackend",
  output."storage_key" AS "outputStorageKey",
  output."mime_type" AS "outputMimeType",
  output."size_bytes" AS "outputSizeBytes",
  output."width" AS "outputWidth",
  output."height" AS "outputHeight",
  output."sha256" AS "outputSha256",
  output."metadata" AS "outputMetadata"
FROM "extension_hosted_ai_image_plan_bindings" b
JOIN "source_listing_workflows" listing
  ON listing."id" = b."listing_workflow_id"
 AND listing."owner_user_id" = b."owner_user_id"
JOIN "source_listing_draft_versions" draft
  ON draft."workflow_id" = listing."id"
 AND draft."owner_user_id" = listing."owner_user_id"
 AND draft."revision" = listing."current_revision"
 AND draft."draft_version" = listing."current_draft_version"
JOIN "source_capture_snapshots" snapshot
  ON snapshot."id" = listing."current_source_capture_snapshot_id"
 AND snapshot."id" = draft."source_capture_snapshot_id"
 AND snapshot."subject_id" = listing."source_subject_id"
JOIN LATERAL (
  SELECT candidate."id"
  FROM "source_capture_snapshots" candidate
  WHERE candidate."subject_id" = listing."source_subject_id"
  ORDER BY candidate."version" DESC, candidate."created_at" DESC, candidate."id" DESC
  LIMIT 1
) latest ON TRUE
JOIN "ai_media_plans" plan
  ON plan."id" = b."plan_id"
 AND plan."owner_user_id" = b."owner_user_id"
JOIN "ai_media_plan_versions" version
  ON version."id" = plan."current_version_id"
 AND version."plan_id" = plan."id"
 AND version."owner_user_id" = plan."owner_user_id"
JOIN "ai_media_suites" suite
  ON suite."id" = $12
 AND suite."owner_user_id" = plan."owner_user_id"
 AND suite."plan_id" = plan."id"
 AND suite."plan_version_id" = version."id"
JOIN "ai_media_suite_slots" slot
  ON slot."id" = $14
 AND slot."suite_id" = suite."id"
 AND slot."owner_user_id" = suite."owner_user_id"
JOIN "ai_media_workflows" workflow
  ON workflow."id" = slot."child_workflow_id"
 AND workflow."owner_user_id" = slot."owner_user_id"
JOIN "ai_image_jobs" job
  ON job."workflow_id" = workflow."id"
 AND job."workflow_attempt" = workflow."current_attempt"
 AND job."owner_user_id" = workflow."owner_user_id"
JOIN "ai_cost_reservations" reservation
  ON reservation."job_id" = job."id"
 AND reservation."owner_user_id" = job."owner_user_id"
JOIN "media_assets" output
  ON output."id" = $18
 AND output."owner_user_id" = job."owner_user_id"
 AND output."ai_image_job_id" = job."id"
WHERE b."owner_user_id" = $1
  AND b."device_session_id" = $2
  AND b."listing_workflow_id" = $3
  AND b."draft_revision" = $4
  AND b."draft_version" = $5
  AND b."source_capture_snapshot_id" = $6
  AND b."supply_goods_id" = $7
  AND b."shop_id" = $8
  AND b."plan_id" = $9
  AND plan."current_version_id" = $10
  AND plan."approved_version_id" = $10
  AND plan."revision" = $11
  AND suite."revision" = $13
  AND slot."revision" = $15
  AND workflow."id" = $16
  AND workflow."revision" = $17
LIMIT 2`;

export interface ExtensionHostedAiImageAuthorityPrismaClient {
  $queryRawUnsafe<T = unknown>(query: string, ...values: unknown[]): Promise<T>;
}

interface StoredPlanBinding {
  planId: string;
  ownerUserId: string;
  deviceSessionId: string;
  shopId: string;
  listingWorkflowId: string;
  snapshotId: string;
  supplyGoodsId: string;
  draftRevision: number;
  draftVersion: number;
  selectedSkuHash: string;
  candidateMediaHash: string;
  authorityHash: string;
  bindingHash: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactText(value: unknown, maximum = MAX_IDENTIFIER_LENGTH): string | null {
  if (typeof value !== 'string'
    || !value
    || value !== value.trim()
    || value !== value.normalize('NFKC')
    || value.length > maximum
    || value.includes('\0')) return null;
  return value;
}

function exactInteger(value: unknown, minimum = 1): number | null {
  return Number.isSafeInteger(value) && Number(value) >= minimum ? Number(value) : null;
}

function exactHash(value: unknown): string | null {
  return typeof value === 'string' && SHA256_PATTERN.test(value) ? value : null;
}

function exactStringArray(value: unknown, maximum: number): string[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > maximum) return null;
  const values = value.map((item) => exactText(item, 500));
  if (values.some((item) => item === null)) return null;
  const result = values as string[];
  return new Set(result).size === result.length ? result : null;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  const item = record(value);
  if (!item) return value;
  return Object.fromEntries(Object.keys(item).sort().map((key) => [key, canonical(item[key])]));
}

function valueHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function normalizeRows(value: unknown): Record<string, unknown>[] | null {
  if (!Array.isArray(value) || value.length !== 1) return null;
  const row = record(value[0]);
  return row ? [row] : null;
}

function storedBinding(value: unknown): StoredPlanBinding | null {
  const row = record(value);
  if (!row) return null;
  const result = {
    planId: exactText(row.planId, 200),
    ownerUserId: exactText(row.ownerUserId, 200),
    deviceSessionId: exactText(row.deviceSessionId, 200),
    shopId: exactText(row.shopId, 200),
    listingWorkflowId: exactText(row.listingWorkflowId, 200),
    snapshotId: exactText(row.snapshotId, 200),
    supplyGoodsId: exactText(row.supplyGoodsId, 200),
    draftRevision: exactInteger(row.draftRevision),
    draftVersion: exactInteger(row.draftVersion),
    selectedSkuHash: exactHash(row.selectedSkuHash),
    candidateMediaHash: exactHash(row.candidateMediaHash),
    authorityHash: exactHash(row.authorityHash),
    bindingHash: exactHash(row.bindingHash),
  };
  if (Object.values(result).some((item) => item === null)) return null;
  const binding = result as StoredPlanBinding;
  const authorityIdentity = {
    ownerUserId: binding.ownerUserId,
    snapshotId: binding.snapshotId,
    supplyGoodsId: binding.supplyGoodsId,
    shopId: binding.shopId,
    listingWorkflowId: binding.listingWorkflowId,
    draftRevision: binding.draftRevision,
    draftVersion: binding.draftVersion,
    selectedSkuHash: binding.selectedSkuHash,
    candidateMediaHash: binding.candidateMediaHash,
  };
  if (valueHash(authorityIdentity) !== binding.authorityHash) return null;
  const { bindingHash, ...identity } = binding;
  return valueHash(identity) === bindingHash ? binding : null;
}

function bindingMatchesInput(
  stored: StoredPlanBinding,
  input: {
    ownerUserId: string;
    deviceSessionId: string;
    binding: ExtensionHostedCandidatePreviewBinding;
  },
): boolean {
  const binding = input.binding;
  return stored.ownerUserId === input.ownerUserId
    && stored.deviceSessionId === input.deviceSessionId
    && stored.shopId === binding.shopId
    && stored.listingWorkflowId === binding.listingWorkflowId
    && stored.snapshotId === binding.snapshotId
    && stored.supplyGoodsId === binding.supplyGoodsId
    && stored.draftRevision === binding.draftRevision
    && stored.draftVersion === binding.draftVersion
    && stored.planId === binding.planId;
}

function capturedSkuKeys(capture: SourceProductCaptureV2): string[] | null {
  if (!Array.isArray(capture.skus)) return null;
  if (capture.skus.length === 0) return [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY];
  const aliases = capturedSourceSkuAliases(capture);
  const keys = capture.skus.map((sku) => {
    if (typeof sku?.key !== 'string') return null;
    const normalized = exactText(sku.key.normalize('NFKC').trim(), 500);
    return normalized && aliases.get(normalized) === normalized ? normalized : null;
  });
  if (keys.some((key) => key === null || key === SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY)) return null;
  const result = keys as string[];
  return new Set(result).size === result.length ? result : null;
}

function eligibleMediaKeys(
  capture: SourceProductCaptureV2,
  selectedSkuKeys: readonly string[],
): string[] | null {
  if (!Array.isArray(capture.media)) return null;
  const aliases = capturedSourceSkuAliases(capture);
  const selected = new Set(selectedSkuKeys);
  const seen = new Set<string>();
  const eligible: string[] = [];
  for (const media of capture.media) {
    const key = exactText(media?.key, 500);
    if (!key || seen.has(key) || !Array.isArray(media.skuKeys)) return null;
    seen.add(key);
    const mediaSkuKeys = media.skuKeys.map((skuKey) => {
      if (typeof skuKey !== 'string') return null;
      const normalized = exactText(skuKey.normalize('NFKC').trim(), 500);
      const canonical = normalized ? aliases.get(normalized) : null;
      return canonical ? exactText(canonical, 500) : null;
    });
    if (mediaSkuKeys.some((skuKey) => skuKey === null)) return null;
    if (media.kind === 'image'
      && media.disposition === 'accepted'
      && typeof media.url === 'string'
      && media.url.length > 0
      && ((media.role !== 'sku' && mediaSkuKeys.length === 0)
        || (mediaSkuKeys as string[]).some((skuKey) => selected.has(skuKey)))
      && eligible.length < MAX_CANDIDATE_MEDIA) eligible.push(key);
  }
  return eligible;
}

async function planAuthorityFromRow(
  row: Record<string, unknown>,
  input: { ownerUserId: string; listingWorkflowId: string },
): Promise<ExtensionHostedAiImagePlanAuthority | null> {
  const ownerUserId = exactText(row.workflowOwnerUserId, 200);
  const listingWorkflowId = exactText(row.listingWorkflowId, 200);
  const shopId = exactText(row.workflowShopId, 200);
  const sourceSubjectId = exactText(row.workflowSourceSubjectId, 200);
  const snapshotId = exactText(row.workflowSnapshotId, 200);
  const supplyGoodsId = exactText(row.workflowSupplyGoodsId, 200);
  const draftRevision = exactInteger(row.workflowRevision);
  const draftVersion = exactInteger(row.workflowDraftVersion);
  const selectedSkuKeys = exactStringArray(row.workflowSelectedSkuKeys, MAX_SELECTED_SKUS);
  const captureHash = exactHash(row.snapshotCaptureHash);
  const payloadBytes = exactInteger(row.snapshotPayloadBytes);
  const draftStage = row.draftStage;
  if (!ownerUserId || !listingWorkflowId || !shopId || !sourceSubjectId || !snapshotId
    || !supplyGoodsId || !draftRevision || !draftVersion || !selectedSkuKeys
    || !captureHash || !payloadBytes
    || ownerUserId !== input.ownerUserId
    || listingWorkflowId !== input.listingWorkflowId
    || row.workflowStatus !== 'ACTIVE'
    || row.draftStatus !== 'ACTIVE'
    || !isExtensionHostedAiImageActiveDraftStage(draftStage)
    || row.workflowStage !== draftStage
    || row.shopStatus !== 'ACTIVE'
    || row.shopPlatform !== 'OZON'
    || row.draftOwnerUserId !== ownerUserId
    || row.subjectOwnerUserId !== ownerUserId
    || row.goodsOwnerUserId !== ownerUserId
    || row.shopOwnerUserId !== ownerUserId
    || row.draftShopId !== shopId
    || row.draftSnapshotId !== snapshotId
    || row.snapshotSubjectId !== sourceSubjectId
    || row.latestSnapshotId !== snapshotId
    || row.subjectSupplyGoodsId !== supplyGoodsId
    || row.draftSupplyGoodsId !== supplyGoodsId
    || row.draftRevision !== draftRevision
    || row.draftVersion !== draftVersion) return null;

  const draftSelectedSkuKeys = exactStringArray(row.draftSelectedSkuKeys, MAX_SELECTED_SKUS);
  if (!draftSelectedSkuKeys || !sameStrings(selectedSkuKeys, draftSelectedSkuKeys)) return null;

  let verified: Awaited<ReturnType<typeof verifySourceProductCaptureV2Submission>>;
  try {
    verified = await verifySourceProductCaptureV2Submission({
      capture: row.snapshotPayload as SourceProductCaptureV2,
      captureHash,
      payloadBytes,
    });
  } catch {
    return null;
  }
  if (!verified.valid) return null;
  const capture = row.snapshotPayload as SourceProductCaptureV2;
  const captured = capturedSkuKeys(capture);
  if (!captured || selectedSkuKeys.some((key) => !captured.includes(key))) return null;
  const candidateMediaKeys = eligibleMediaKeys(capture, selectedSkuKeys);
  if (!candidateMediaKeys) return null;

  return {
    ownerUserId,
    sourceSubjectId,
    sourceCaptureCurrent: true,
    workflowStatus: 'ACTIVE',
    draftStage,
    snapshotId,
    supplyGoodsId,
    shopId,
    listingWorkflowId,
    draftRevision,
    draftVersion,
    selectedSkuKeys,
    capturedSkuKeys: captured,
    candidateMediaKeys,
  };
}

function graphText(row: Record<string, unknown>, key: string, maximum = 200): string | null {
  return exactText(row[key], maximum);
}

function candidateAuthorityFromRow(
  row: Record<string, unknown>,
  stored: StoredPlanBinding,
  input: {
    ownerUserId: string;
    deviceSessionId: string;
    binding: ExtensionHostedCandidatePreviewBinding;
  },
): ExtensionHostedCandidatePreviewAuthority | null {
  const binding = input.binding;
  const planId = graphText(row, 'planId');
  const planVersionId = graphText(row, 'planVersionId');
  const suiteId = graphText(row, 'suiteId');
  const slotId = graphText(row, 'slotId');
  const workflowId = graphText(row, 'workflowId');
  const jobId = graphText(row, 'jobId');
  const outputId = graphText(row, 'outputId');
  const sourceSubjectId = graphText(row, 'currentSourceSubjectId');
  const sourceCaptureHash = exactHash(row.currentSourceCaptureHash);
  const slotKey = graphText(row, 'slotKey', 1_024);
  const slotOwnershipLevel = graphText(row, 'slotOwnershipLevel', 30);
  const slotOwnershipKey = graphText(row, 'slotOwnershipKey', 500);
  const selectedOutputAssetId = row.workflowSelectedOutputAssetId === null
    ? null
    : graphText(row, 'workflowSelectedOutputAssetId');
  const planRevision = exactInteger(row.planRevision);
  const suiteRevision = exactInteger(row.suiteRevision);
  const slotRevision = exactInteger(row.slotRevision);
  const workflowRevision = exactInteger(row.workflowRevision);
  const slotAttempt = exactInteger(row.slotAttempt);
  const workflowAttempt = exactInteger(row.workflowCurrentAttempt);
  const jobAttempt = exactInteger(row.jobWorkflowAttempt);
  const actualCostCents = exactInteger(row.jobActualCostCents, 0);
  const billedUnits = exactInteger(row.jobBilledUnits);
  const sizeBytes = exactInteger(row.outputSizeBytes);
  const width = exactInteger(row.outputWidth);
  const height = exactInteger(row.outputHeight);
  const storageKey = graphText(row, 'outputStorageKey', 2_000);
  const outputSha256 = exactHash(row.outputSha256);
  const metadata = record(row.outputMetadata);
  if (!planId || !planVersionId || !suiteId || !slotId || !workflowId || !jobId || !outputId
    || !sourceSubjectId || !sourceCaptureHash || !slotKey
    || !slotOwnershipLevel || !slotOwnershipKey
    || (row.workflowSelectedOutputAssetId !== null && !selectedOutputAssetId)
    || !planRevision || !suiteRevision || !slotRevision || !workflowRevision
    || !slotAttempt || !workflowAttempt || !jobAttempt || actualCostCents === null
    || !billedUnits || !sizeBytes || !width || !height || !storageKey || !outputSha256 || !metadata
    || row.bindingPlanId !== stored.planId
    || row.bindingOwnerUserId !== stored.ownerUserId
    || row.bindingDeviceSessionId !== stored.deviceSessionId
    || row.bindingShopId !== stored.shopId
    || row.bindingListingWorkflowId !== stored.listingWorkflowId
    || row.bindingSnapshotId !== stored.snapshotId
    || row.bindingSupplyGoodsId !== stored.supplyGoodsId
    || row.bindingDraftRevision !== stored.draftRevision
    || row.bindingDraftVersion !== stored.draftVersion
    || row.bindingSelectedSkuHash !== stored.selectedSkuHash
    || row.bindingCandidateMediaHash !== stored.candidateMediaHash
    || row.bindingAuthorityHash !== stored.authorityHash
    || row.bindingHash !== stored.bindingHash
    || row.currentDraftRevision !== stored.draftRevision
    || row.currentDraftVersion !== stored.draftVersion
    || row.currentSnapshotId !== stored.snapshotId
    || row.currentShopId !== stored.shopId
    || row.currentSupplyGoodsId !== stored.supplyGoodsId
    || row.listingStatus !== 'ACTIVE'
    || !isExtensionHostedAiImageActiveDraftStage(row.listingStage)
    || row.draftOwnerUserId !== stored.ownerUserId
    || row.draftShopId !== stored.shopId
    || row.draftSnapshotId !== stored.snapshotId
    || row.draftSupplyGoodsId !== stored.supplyGoodsId
    || row.draftRevision !== stored.draftRevision
    || row.draftVersion !== stored.draftVersion
    || row.draftStatus !== 'ACTIVE'
    || row.draftStage !== row.listingStage
    || row.latestSnapshotId !== stored.snapshotId
    || planId !== binding.planId
    || row.planOwnerUserId !== stored.ownerUserId
    || row.planSourceSubjectId !== sourceSubjectId
    || row.planContextType !== 'collect'
    || row.planContextId !== stored.supplyGoodsId
    || planRevision !== binding.planRevision
    || row.planReviewStatus !== 'APPROVED'
    || row.planStaleAt !== null
    || row.planCurrentVersionId !== binding.planVersionId
    || row.planApprovedVersionId !== binding.planVersionId
    || planVersionId !== binding.planVersionId
    || row.planVersionPlanId !== planId
    || row.planVersionOwnerUserId !== stored.ownerUserId
    || row.planVersionSourceSubjectId !== sourceSubjectId
    || row.planVersionSnapshotId !== stored.snapshotId
    || row.planVersionSourceHash !== sourceCaptureHash
    || row.planVersionSelectedSkuHash !== stored.selectedSkuHash
    || row.planVersionCandidateMediaHash !== stored.candidateMediaHash
    || suiteId !== binding.suiteId
    || row.suiteOwnerUserId !== stored.ownerUserId
    || row.suitePlanId !== planId
    || row.suitePlanVersionId !== planVersionId
    || row.suiteSourceSubjectId !== sourceSubjectId
    || row.suiteSnapshotId !== stored.snapshotId
    || row.suiteSourceHash !== sourceCaptureHash
    || row.suiteContextType !== 'collect'
    || row.suiteContextId !== stored.supplyGoodsId
    || !['SUCCEEDED', 'PARTIAL_FAILURE'].includes(String(row.suiteStatus))
    || suiteRevision !== binding.suiteRevision
    || slotId !== binding.slotId
    || row.slotSuiteId !== suiteId
    || row.slotOwnerUserId !== stored.ownerUserId
    || row.slotStatus !== 'SUCCEEDED'
    || slotRevision !== binding.slotRevision
    || row.slotWorkflowId !== binding.workflowId
    || workflowId !== binding.workflowId
    || row.workflowOwnerUserId !== stored.ownerUserId
    || row.workflowStatus !== 'SUCCEEDED'
    || !['PENDING', 'APPROVED'].includes(String(row.workflowReviewStatus))
    || workflowRevision !== binding.workflowRevision
    || workflowAttempt !== slotAttempt
    || row.workflowContextType !== 'collect'
    || row.workflowContextId !== stored.supplyGoodsId
    || row.workflowSlotKey !== slotKey
    || (slotOwnershipLevel === 'sku' && row.workflowSkuKey !== slotOwnershipKey)
    || (row.workflowReviewStatus === 'APPROVED' && selectedOutputAssetId !== outputId)
    || row.jobOwnerUserId !== stored.ownerUserId
    || row.jobWorkflowId !== workflowId
    || jobAttempt !== workflowAttempt
    || row.jobExecutionMode !== 'ERP_HOSTED'
    || row.jobStatus !== 'SUCCEEDED'
    || billedUnits !== 1
    || row.reservationStatus !== 'SETTLED'
    || row.paidHosted !== true
    || row.settledCostEvidence !== true
    || outputId !== binding.outputAssetId
    || row.outputOwnerUserId !== stored.ownerUserId
    || row.outputJobId !== jobId
    || row.outputKind !== 'AI_GENERATED'
    || row.outputSnapshotId !== stored.snapshotId
    || !['local', 'oss'].includes(String(row.outputStorageBackend))
    || row.outputMimeType !== 'image/png'
    || sizeBytes > AI_IMAGE_SUITE_OUTPUT_NORMALIZER_MAX_INPUT_BYTES
    || width !== AI_IMAGE_SUITE_OUTPUT_WIDTH
    || height !== AI_IMAGE_SUITE_OUTPUT_HEIGHT
    || metadata.version !== 'ai-image-suite-output/v1'
    || metadata.normalizerVersion !== AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION
    || metadata.suiteId !== suiteId
    || metadata.slotId !== slotId
    || metadata.attempt !== slotAttempt) return null;

  const databaseBinding: ExtensionHostedCandidatePreviewBinding = {
    snapshotId: stored.snapshotId,
    supplyGoodsId: stored.supplyGoodsId,
    shopId: stored.shopId,
    listingWorkflowId: stored.listingWorkflowId,
    draftRevision: stored.draftRevision,
    draftVersion: stored.draftVersion,
    planId,
    planVersionId,
    planRevision,
    suiteId,
    suiteRevision,
    slotId,
    slotRevision,
    workflowId,
    workflowRevision,
    outputAssetId: outputId,
  };
  return {
    ownerUserId: stored.ownerUserId,
    binding: databaseBinding,
    plan: {
      id: planId,
      versionId: planVersionId,
      revision: planRevision,
      reviewStatus: 'APPROVED',
      staleAt: null,
      currentVersionId: planVersionId,
      approvedVersionId: planVersionId,
    },
    suite: {
      id: suiteId,
      revision: suiteRevision,
      status: String(row.suiteStatus),
      planId,
      planVersionId,
      sourceCaptureSnapshotId: stored.snapshotId,
      contextType: 'collect',
      contextId: stored.supplyGoodsId,
    },
    slot: {
      id: slotId,
      revision: slotRevision,
      status: 'SUCCEEDED',
      suiteId,
      attempt: slotAttempt,
      childWorkflowId: workflowId,
    },
    workflow: {
      id: workflowId,
      revision: workflowRevision,
      status: 'SUCCEEDED',
      reviewStatus: String(row.workflowReviewStatus),
      currentAttempt: workflowAttempt,
      contextType: 'collect',
      contextId: stored.supplyGoodsId,
      selectedOutputAssetId,
    },
    job: {
      id: jobId,
      workflowId,
      workflowAttempt: jobAttempt,
      executionMode: 'ERP_HOSTED',
      status: 'SUCCEEDED',
      actualCostCents,
      billedUnits,
      costReservationStatus: 'SETTLED',
    },
    output: {
      id: outputId,
      ownerUserId: stored.ownerUserId,
      aiImageJobId: jobId,
      kind: 'AI_GENERATED',
      sourceCaptureSnapshotId: stored.snapshotId,
      storageBackend: String(row.outputStorageBackend),
      storageKey,
      mimeType: 'image/png',
      sizeBytes,
      width,
      height,
      sha256: outputSha256,
      metadata: {
        version: 'ai-image-suite-output/v1',
        normalizerVersion: AI_IMAGE_SUITE_OUTPUT_NORMALIZER_VERSION,
        suiteId,
        slotId,
        attempt: slotAttempt,
      },
    },
  };
}

function validPlanInput(input: { ownerUserId: string; listingWorkflowId: string }): boolean {
  return Boolean(exactText(input?.ownerUserId, 200) && exactText(input?.listingWorkflowId, 200));
}

function validCandidateInput(input: {
  ownerUserId: string;
  deviceSessionId: string;
  binding: ExtensionHostedCandidatePreviewBinding;
}): boolean {
  const binding = input?.binding;
  return Boolean(exactText(input?.ownerUserId, 200)
    && exactText(input?.deviceSessionId, 200)
    && binding
    && exactText(binding.snapshotId, 200)
    && exactText(binding.supplyGoodsId, 200)
    && exactText(binding.shopId, 200)
    && exactText(binding.listingWorkflowId, 200)
    && exactInteger(binding.draftRevision)
    && exactInteger(binding.draftVersion)
    && exactText(binding.planId, 200)
    && exactText(binding.planVersionId, 200)
    && exactInteger(binding.planRevision)
    && exactText(binding.suiteId, 200)
    && exactInteger(binding.suiteRevision)
    && exactText(binding.slotId, 200)
    && exactInteger(binding.slotRevision)
    && exactText(binding.workflowId, 200)
    && exactInteger(binding.workflowRevision)
    && exactText(binding.outputAssetId, 200));
}

export function createPrismaExtensionHostedAiImageAuthorityLoader(
  client: ExtensionHostedAiImageAuthorityPrismaClient,
) {
  return {
    async loadPlanAuthority(input: {
      ownerUserId: string;
      listingWorkflowId: string;
    }): Promise<ExtensionHostedAiImagePlanAuthority | null> {
      if (!validPlanInput(input)) return null;
      const result = await client.$queryRawUnsafe<unknown[]>(
        PLAN_AUTHORITY_SQL,
        input.ownerUserId,
        input.listingWorkflowId,
      );
      const rows = normalizeRows(result);
      return rows ? planAuthorityFromRow(rows[0]!, input) : null;
    },

    async loadCandidateAuthority(input: {
      ownerUserId: string;
      deviceSessionId: string;
      binding: ExtensionHostedCandidatePreviewBinding;
    }): Promise<ExtensionHostedCandidatePreviewAuthority | null> {
      if (!validCandidateInput(input)) return null;
      const binding = input.binding;
      const values = [
        input.ownerUserId,
        input.deviceSessionId,
        binding.listingWorkflowId,
        binding.draftRevision,
        binding.draftVersion,
        binding.snapshotId,
        binding.supplyGoodsId,
        binding.shopId,
        binding.planId,
      ] as const;
      const bindingResult = await client.$queryRawUnsafe<unknown[]>(PLAN_BINDING_SQL, ...values);
      const bindingRows = normalizeRows(bindingResult);
      const persisted = bindingRows ? storedBinding(bindingRows[0]) : null;
      if (!persisted || !bindingMatchesInput(persisted, input)) return null;

      const graphResult = await client.$queryRawUnsafe<unknown[]>(
        CANDIDATE_AUTHORITY_SQL,
        ...values,
        binding.planVersionId,
        binding.planRevision,
        binding.suiteId,
        binding.suiteRevision,
        binding.slotId,
        binding.slotRevision,
        binding.workflowId,
        binding.workflowRevision,
        binding.outputAssetId,
      );
      const graphRows = normalizeRows(graphResult);
      return graphRows ? candidateAuthorityFromRow(graphRows[0]!, persisted, input) : null;
    },
  };
}

export type PrismaExtensionHostedAiImageAuthorityLoader = ReturnType<
  typeof createPrismaExtensionHostedAiImageAuthorityLoader
>;

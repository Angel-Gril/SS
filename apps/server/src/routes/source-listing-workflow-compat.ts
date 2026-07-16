import {
  SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
  SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS,
} from 'shared';
import type { SourceListingWorkflowRolloutStage, SourceWorkflowFeatureFlagEvaluator } from '../services/source-workflow-feature-flags.js';
import { prisma } from '../lib/prisma.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createPrismaSourceListingWorkflowRepository } from '../services/source-listing-workflow-prisma.js';
import { createPrismaSourceListingWorkflowContextResolver } from '../services/source-listing-workflow-context.js';

export interface LegacySourceListingDraftPointer {
  supplyGoodsId: string;
  draftId: string;
  draftVersion: number;
  revision: number;
  selectedSkuKeys?: string[];
}

export interface LegacySourceListingDraftFailure {
  supplyGoodsId: string;
  errorCode: string;
}

export interface LegacySourceListingWorkflowAdapter {
  prepare(input: {
    ownerUserId: string;
    actorUserId: string;
    shopId: string;
    supplyGoodsIds: string[];
  }): Promise<{
    drafts: LegacySourceListingDraftPointer[];
    failures: LegacySourceListingDraftFailure[];
  }>;
}

export type LegacySourceListingCompatibilityAction = 'legacy';

export interface LegacySourceListingCompatibilityResult {
  action: LegacySourceListingCompatibilityAction;
  stage: 'off' | SourceListingWorkflowRolloutStage;
  rolloutRevision: string;
  legacyFallback: boolean;
  requestedSupplyGoodsIds: string[];
  drafts: LegacySourceListingDraftPointer[];
  failures: LegacySourceListingDraftFailure[];
}

function uniqueIds(values: string[]): string[] {
  return [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))];
}

function completePreparationCoverage(
  requestedSupplyGoodsIds: string[],
  prepared: Awaited<ReturnType<LegacySourceListingWorkflowAdapter['prepare']>>,
): Awaited<ReturnType<LegacySourceListingWorkflowAdapter['prepare']>> {
  const draftsByGoodsId = new Map<string, LegacySourceListingDraftPointer[]>();
  const failuresByGoodsId = new Map<string, LegacySourceListingDraftFailure[]>();
  const requested = new Set(requestedSupplyGoodsIds);
  for (const draft of prepared.drafts) {
    if (!requested.has(draft.supplyGoodsId)) continue;
    draftsByGoodsId.set(draft.supplyGoodsId, [
      ...(draftsByGoodsId.get(draft.supplyGoodsId) || []),
      draft,
    ]);
  }
  for (const failure of prepared.failures) {
    if (!requested.has(failure.supplyGoodsId)) continue;
    failuresByGoodsId.set(failure.supplyGoodsId, [
      ...(failuresByGoodsId.get(failure.supplyGoodsId) || []),
      failure,
    ]);
  }

  const drafts: LegacySourceListingDraftPointer[] = [];
  const failures: LegacySourceListingDraftFailure[] = [];
  for (const supplyGoodsId of requestedSupplyGoodsIds) {
    const matchingDrafts = draftsByGoodsId.get(supplyGoodsId) || [];
    const matchingFailures = failuresByGoodsId.get(supplyGoodsId) || [];
    if (matchingDrafts.length === 1 && matchingFailures.length === 0) {
      drafts.push(matchingDrafts[0]!);
      continue;
    }
    if (matchingDrafts.length === 0 && matchingFailures.length > 0) {
      failures.push(matchingFailures[0]!);
      continue;
    }
    failures.push({
      supplyGoodsId,
      errorCode: matchingDrafts.length === 0
        ? 'SOURCE_LISTING_SHADOW_WRITE_INCOMPLETE'
        : 'SOURCE_LISTING_SHADOW_WRITE_AMBIGUOUS',
    });
  }
  return { drafts, failures };
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).normalize('NFKC').trim()
    : '';
}

export function resolveLegacyProjectionSkuKeys(input: {
  payload: unknown;
  sku: unknown;
  variants: unknown;
}): string[] {
  const payload = input.payload;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
  const record = payload as Record<string, unknown>;
  const capture = record.capture && typeof record.capture === 'object' && !Array.isArray(record.capture)
    ? record.capture as Record<string, unknown>
    : record;
  if (!Array.isArray(capture.skus)) return [];
  if (capture.skus.length === 0) return [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY];
  const canonical = capture.skus.flatMap((raw) => {
    const row = recordValue(raw);
    const key = text(row.key);
    if (!key) return [];
    return [{ key, aliases: [key, text(row.sourceSkuId)].filter(Boolean) }];
  });
  const aliases = new Set<string>();
  const baseSku = text(input.sku);
  if (baseSku) aliases.add(baseSku);
  const variants = Array.isArray(input.variants) ? input.variants : [];
  for (const raw of variants) {
    const row = recordValue(raw);
    for (const value of [row.key, row.skuKey, row.sourceSkuId, row.sku, row.id]) {
      const alias = text(value);
      if (alias) aliases.add(alias);
    }
  }
  if (!aliases.size) {
    return [...new Set(canonical.map((row) => row.key))].sort();
  }
  return [...new Set(canonical
    .filter((row) => row.aliases.some((alias) => aliases.has(alias)))
    .map((row) => row.key))]
    .sort();
}

export function createPrismaLegacySourceListingWorkflowAdapter() {
  const service = createSourceListingWorkflowService({
    repository: createPrismaSourceListingWorkflowRepository({ client: prisma as never }),
  });
  const context = createPrismaSourceListingWorkflowContextResolver({ client: prisma });
  return {
    async prepare(input: {
      ownerUserId: string;
      actorUserId: string;
      shopId: string;
      supplyGoodsIds: string[];
    }) {
      const drafts: LegacySourceListingDraftPointer[] = [];
      const failures: LegacySourceListingDraftFailure[] = [];
      for (const supplyGoodsId of uniqueIds(input.supplyGoodsIds)) {
        try {
          const rows = await prisma.$queryRawUnsafe<Array<{
            payload: unknown;
            sku: unknown;
            variants: unknown;
          }>>(
            `SELECT sn."payload", g."sku", g."variants"
             FROM "supply_goods" g
             JOIN "source_capture_subjects" s
               ON s."legacy_supply_goods_id" = g."id" AND s."owner_user_id" = g."user_id"
             JOIN LATERAL (
               SELECT "payload" FROM "source_capture_snapshots"
               WHERE "subject_id" = s."id" ORDER BY "version" DESC LIMIT 1
             ) sn ON TRUE
             WHERE g."id" = $1 AND g."user_id" = $2
             LIMIT 1`,
            supplyGoodsId,
            input.ownerUserId,
          );
          const selectedSkuKeys = resolveLegacyProjectionSkuKeys({
            payload: rows[0]?.payload,
            sku: rows[0]?.sku,
            variants: rows[0]?.variants,
          });
          if (selectedSkuKeys.length > SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS) {
            throw Object.assign(new Error(
              `Source snapshot projection exceeds ${SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS} SKU keys`,
            ), {
              code: 'SOURCE_LISTING_SKU_LIMIT_EXCEEDED',
            });
          }
          if (!selectedSkuKeys.length) throw Object.assign(new Error('Source snapshot has no SKU keys'), { code: 'SOURCE_LISTING_SKU_INVALID' });
          const owned = await context.assertOwnedTarget({
            ownerUserId: input.ownerUserId,
            shopId: input.shopId,
            supplyGoodsId,
            selectedSkuKeys,
          });
          const draft = await service.createDraft({
            ownerUserId: input.ownerUserId,
            actorUserId: input.actorUserId,
            shopId: owned.shopId,
            supplyGoodsId: owned.supplyGoodsId,
            sourceCaptureSnapshotId: owned.sourceCaptureSnapshotId,
            sourceCaptureHash: owned.sourceCaptureHash,
            selectedSkuKeys: owned.selectedSkuKeys,
          });
          drafts.push({
            supplyGoodsId,
            draftId: draft.id,
            draftVersion: draft.draftVersion,
            revision: draft.revision,
            selectedSkuKeys: [...(draft.selectedSkuKeys || owned.selectedSkuKeys)],
          });
        } catch (error) {
          failures.push({
            supplyGoodsId,
            errorCode: String((error as { code?: string })?.code || 'SOURCE_LISTING_SHADOW_WRITE_FAILED'),
          });
        }
      }
      return { drafts, failures };
    },
  } satisfies LegacySourceListingWorkflowAdapter;
}

let defaultAdapter: LegacySourceListingWorkflowAdapter | null = null;

export function getDefaultLegacySourceListingWorkflowAdapter(): LegacySourceListingWorkflowAdapter {
  defaultAdapter ||= createPrismaLegacySourceListingWorkflowAdapter();
  return defaultAdapter;
}

export async function resolveLegacySourceListingCompatibility(input: {
  featureFlags: SourceWorkflowFeatureFlagEvaluator;
  adapter: LegacySourceListingWorkflowAdapter;
  ownerUserId: string;
  actorUserId: string;
  shopId: string;
  platform: string;
  supplyGoodsIds: string[];
  legacyFallback?: boolean;
}): Promise<LegacySourceListingCompatibilityResult> {
  const supplyGoodsIds = uniqueIds(input.supplyGoodsIds);
  const decision = await input.featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', {
    ownerUserId: input.ownerUserId,
    shopId: input.shopId,
    platform: input.platform,
  });
  if (!decision.enabled) {
    return {
      action: 'legacy', stage: 'off', rolloutRevision: decision.revision,
      legacyFallback: false,
      requestedSupplyGoodsIds: supplyGoodsIds,
      drafts: [],
      failures: decision.legacyAllowed
        ? []
        : supplyGoodsIds.length
          ? supplyGoodsIds.map((supplyGoodsId) => ({
            supplyGoodsId,
            errorCode: 'SOURCE_LISTING_WORKFLOW_POLICY_UNAVAILABLE',
          }))
          : [{
            supplyGoodsId: '',
            errorCode: 'SOURCE_LISTING_WORKFLOW_POLICY_UNAVAILABLE',
          }],
    };
  }
  const stage = decision.listingStage || 'v2_only';
  let prepared: Awaited<ReturnType<LegacySourceListingWorkflowAdapter['prepare']>> = {
    drafts: [],
    failures: [],
  };
  if (supplyGoodsIds.length) {
    try {
      prepared = await input.adapter.prepare({
        ownerUserId: input.ownerUserId,
        actorUserId: input.actorUserId,
        shopId: input.shopId,
        supplyGoodsIds,
      });
    } catch (error) {
      const errorCode = String((error as { code?: string })?.code || 'SOURCE_LISTING_SHADOW_WRITE_FAILED');
      prepared = {
        drafts: [],
        failures: supplyGoodsIds.map((supplyGoodsId) => ({ supplyGoodsId, errorCode })),
      };
    }
  }
  prepared = completePreparationCoverage(supplyGoodsIds, prepared);
  return {
    action: 'legacy', stage, rolloutRevision: decision.revision,
    legacyFallback: input.legacyFallback === true,
    requestedSupplyGoodsIds: supplyGoodsIds,
    ...prepared,
  };
}

export function sourceListingCompatibilityMetadata(
  result: LegacySourceListingCompatibilityResult,
) {
  const requested = new Set(result.requestedSupplyGoodsIds);
  const preparedGoodsIds = new Set(result.drafts
    .map((draft) => draft.supplyGoodsId)
    .filter((supplyGoodsId) => requested.has(supplyGoodsId)));
  const failedGoodsIds = new Set(result.failures
    .map((failure) => failure.supplyGoodsId)
    .filter((supplyGoodsId) => requested.has(supplyGoodsId)));
  const accountedGoodsIds = new Set([...preparedGoodsIds, ...failedGoodsIds]);
  const coverage = {
    requested: requested.size,
    prepared: preparedGoodsIds.size,
    failed: failedGoodsIds.size,
    complete: accountedGoodsIds.size === requested.size,
  };
  const workflowPrepared = requested.size > 0
    && preparedGoodsIds.size === requested.size
    && failedGoodsIds.size === 0;
  const draftWriteStatus = result.stage === 'off'
    ? 'disabled'
    : workflowPrepared
      ? 'ready'
      : result.failures.length || result.drafts.length
        ? 'partial'
        : 'pending_evidence';
  return {
    stage: result.stage,
    rolloutRevision: result.rolloutRevision,
    readAuthority: result.action,
    publishPayloadSource: result.action,
    legacyWriter: true,
    draftWriteStatus,
    workflowPrepared,
    coverage,
    legacyFallback: result.legacyFallback,
    draftIds: result.drafts.map((draft) => draft.draftId),
    drafts: result.drafts,
    failures: result.failures,
  };
}

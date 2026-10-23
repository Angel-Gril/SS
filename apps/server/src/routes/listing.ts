import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient, type OzonImportInfo, type OzonProductInfo } from '../services/ozon-client.js';
import { getListingTaskRefreshSettings } from '../services/listing-task-refresh.js';
import { enqueueProductSyncAfterPublish } from '../services/post-publish-sync.js';
import { collectOzonImportReviewIssues, summarizeOzonImportItems } from '../services/ozon-import-status.js';
import { resolveImageUrls } from '../services/ozon-image-resolver.js';
import { resolveOzonProductImages } from '../services/product-sync-metadata.js';
import { planFallbackPictureUploads, recordPictureUploadDiagnostic } from './collect.js';
import { randomOfferIdFrom } from '../lib/randomize.js';
import {
  assertLegacySourceOzonPublishAllowed,
  sourceWorkflowFeatureFlags,
  SourceWorkflowLegacyPublishError,
  type SourceWorkflowFeatureFlagEvaluator,
} from '../services/source-workflow-feature-flags.js';
import {
  getDefaultLegacySourceListingWorkflowAdapter,
  resolveLegacySourceListingCompatibility,
  sourceListingCompatibilityMetadata,
  type LegacySourceListingCompatibilityResult,
  type LegacySourceListingWorkflowAdapter,
} from './source-listing-workflow-compat.js';
import {
  assertSourceListingDraftIdentity,
  normalizeSourceListingDraftIdentityRefs,
  type SourceListingDraftIdentityRef,
  SourceListingDraftIdentityError,
} from '../services/source-listing-draft-identity.js';
import type {
  OzonPublisherEntrypointRolloutDecision,
  OzonPublisherEntrypointRolloutService,
  OzonPublisherWriterEntrypoint,
} from '../services/ozon-publisher-entrypoint-rollout.js';
import type { OzonPublisherEntrypointParityObserver } from '../services/ozon-publisher-entrypoint-parity-shadow.js';
import type { createSourceCaptureService } from '../services/source-capture.js';
import {
  BROWSER_ONE_CLICK_MAX_ITEMS,
  BROWSER_ONE_CLICK_V2_HANDOFF_VERSION,
  parseBrowserOneClickReviewHandoff,
} from '../services/browser-one-click-review-handoff.js';

export interface ListingRoutesOptions {
  featureFlags?: SourceWorkflowFeatureFlagEvaluator;
  sourceListingWorkflowAdapter?: LegacySourceListingWorkflowAdapter;
  sourceCaptureService?: ReturnType<typeof createSourceCaptureService>;
  publisherRollout?: OzonPublisherEntrypointRolloutService;
  publisherParityObserver?: OzonPublisherEntrypointParityObserver;
  publisherParityTimeoutMs?: number;
}

export interface BrowserOneClickListingHandlersOptions {
  featureFlags: SourceWorkflowFeatureFlagEvaluator;
  sourceListingWorkflowAdapter: LegacySourceListingWorkflowAdapter;
  sourceCaptureService?: ReturnType<typeof createSourceCaptureService>;
  publisherRollout?: OzonPublisherEntrypointRolloutService;
}

function browserOneClickRolloutContext(
  actor: BrowserOneClickActor,
  shop: { id: string; platform: unknown },
) {
  return {
    ownerUserId: actor.ownerUserId,
    shopId: shop.id,
    platform: String(shop.platform || ''),
    deviceSessionId: actor.deviceSessionId || null,
  };
}

async function evaluateBrowserOneClickRollout(
  options: BrowserOneClickListingHandlersOptions,
  actor: BrowserOneClickActor,
  shop: { id: string; platform: unknown },
) {
  return options.publisherRollout?.evaluateWrite({
    writerEntrypoint: 'COLLECT_PUBLISH_OZON',
    originChannel: 'BROWSER_ONE_CLICK',
    context: browserOneClickRolloutContext(actor, shop),
  }) || null;
}

function browserOneClickV2Handoff(input: {
  rollout: OzonPublisherEntrypointRolloutDecision | null;
  listingRolloutRevision: string;
  drafts: Array<Record<string, any>>;
  failures: Array<Record<string, any>>;
}) {
  return {
    contractVersion: BROWSER_ONE_CLICK_V2_HANDOFF_VERSION,
    state: 'REVIEW_REQUIRED' as const,
    rollout: input.rollout ? {
      authority: input.rollout.authority,
      effectiveStage: input.rollout.effectiveStage,
      rolloutRevision: input.rollout.rolloutRevision,
      gateStateVersion: input.rollout.gateStateVersion,
      evidenceHash: input.rollout.evidenceHash,
    } : null,
    listingRolloutRevision: input.listingRolloutRevision,
    drafts: input.drafts,
    failures: input.failures.map((failure) => ({
      supplyGoodsId: String(failure.supplyGoodsId || ''),
      errorCode: String(failure.errorCode || 'UNKNOWN'),
    })),
  };
}


function sameRolloutDecision(
  initial: OzonPublisherEntrypointRolloutDecision,
  current: OzonPublisherEntrypointRolloutDecision,
): boolean {
  return initial.authority === current.authority
    && initial.effectiveStage === current.effectiveStage
    && initial.rolloutRevision === current.rolloutRevision
    && initial.gateStateVersion === current.gateStateVersion
    && initial.evidenceHash === current.evidenceHash;
}

function sendPublisherRolloutBlocked(
  reply: FastifyReply,
  decision: OzonPublisherEntrypointRolloutDecision,
) {
  return reply.status(503).send({
    code: 0,
    errorCode: decision.authority === 'V2'
      ? 'ozon_publisher_entrypoint_v2_adapter_unavailable'
      : 'ozon_publisher_entrypoint_blocked',
    msg: decision.authority === 'V2'
      ? '该 Ozon 发布入口尚未接入 V2 多草稿执行适配器'
      : 'Ozon 发布入口当前不可用',
    rolloutRevision: decision.rolloutRevision,
    rolloutReason: decision.reason,
  });
}

function sendLegacyDraftPublisherRequired(
  reply: FastifyReply,
  rolloutRevision: string,
) {
  return reply.status(409).send({
    code: 0,
    errorCode: 'source_listing_v2_publisher_required',
    terminal: true,
    msg: '来源商品草稿只能通过不可变 V2 发布器提交；当前兼容入口不会从请求载荷发布',
    rolloutRevision,
  });
}

export interface BrowserOneClickActor {
  ownerUserId: string;
  actorUserId: string;
  role?: string;
  isSubAccount?: boolean;
  allowedShopIds?: readonly string[];
  deviceSessionId?: string;
}

function accountBrowserOneClickActor(request: FastifyRequest): BrowserOneClickActor {
  const user = (request as any).user || {};
  return {
    ownerUserId: String(user.userId || ''),
    actorUserId: String(user.actorUserId || user.userId || ''),
    role: typeof user.role === 'string' ? user.role : undefined,
    isSubAccount: user.isSubAccount === true,
  };
}

function sourcePublishActorAllowed(
  request: FastifyRequest,
  suppliedActor?: BrowserOneClickActor,
): boolean {
  const user = (request as any).user || {};
  const actor = suppliedActor || accountBrowserOneClickActor(request);
  const actorUserId = actor.actorUserId;
  const ownerUserId = actor.ownerUserId;
  return Boolean(ownerUserId)
    && actorUserId === ownerUserId
    && actor.isSubAccount !== true
    && actor.role !== 'STAFF'
    && user.disabled !== true;
}

function rejectBrowserOneClickActor(
  request: FastifyRequest,
  reply: FastifyReply,
  actor: BrowserOneClickActor,
): boolean {
  if (sourcePublishActorAllowed(request, actor)) return false;
  reply.status(403).send({
    code: 0,
    errorCode: 'source_publish_owner_required',
    msg: '仅店铺所有者可创建 Ozon 审核草稿',
  });
  return true;
}

async function evaluateBrowserOneClickWorkflow(input: {
  featureFlags: SourceWorkflowFeatureFlagEvaluator;
  actor: BrowserOneClickActor;
  shop: { id: string; platform: unknown };
}) {
  const context = {
    ownerUserId: input.actor.ownerUserId,
    shopId: input.shop.id,
    deviceSessionId: input.actor.deviceSessionId || null,
    platform: String(input.shop.platform || ''),
  };
  const [capture, listing] = await Promise.all([
    input.featureFlags.evaluate('SOURCE_CAPTURE_V2', context),
    input.featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', context),
  ]);
  const captureReady = capture.enabled
    && ['shadow_write', 'dual_read', 'v2_only'].includes(String(capture.captureStage || ''));
  const listingReady = listing.enabled
    && ['dual_read', 'v2_only'].includes(String(listing.listingStage || ''));
  return {
    capture,
    listing,
    ready: captureReady && listingReady,
  };
}

function browserOneClickWorkflowUnavailable(
  reply: FastifyReply,
  workflow: Awaited<ReturnType<typeof evaluateBrowserOneClickWorkflow>>,
) {
  const unavailable = [workflow.capture, workflow.listing].some((decision) => (
    ['policy_invalid', 'context_invalid', 'config_unavailable'].includes(decision.reason)
  ));
  return reply.status(unavailable ? 503 : 409).send({
    code: 0,
    errorCode: unavailable
      ? 'source_workflow_rollout_unavailable'
      : 'browser_one_click_review_workflow_required',
    msg: unavailable
      ? '来源商品审核策略暂不可用，请稍后重试'
      : '浏览器一键上架已改为 ERP 草稿审核流程，当前店铺尚未开放该流程',
    captureRolloutRevision: workflow.capture.revision,
    listingRolloutRevision: workflow.listing.revision,
  });
}

async function enforceLegacySourceOzonPublish(
  request: FastifyRequest,
  reply: FastifyReply,
  shop: { id: string; userId?: string; platform: unknown },
  featureFlags: SourceWorkflowFeatureFlagEvaluator,
  suppliedActor?: BrowserOneClickActor,
): Promise<boolean> {
  if (!sourcePublishActorAllowed(request, suppliedActor)) {
    reply.status(403).send({
      code: 0,
      errorCode: 'source_publish_owner_required',
      msg: '仅店铺所有者可提交 Ozon 发布任务',
    });
    return true;
  }
  const ownerUserId = String(
    shop.userId || suppliedActor?.ownerUserId || (request as any).user?.userId || '',
  );
  try {
    await assertLegacySourceOzonPublishAllowed(featureFlags, {
      ownerUserId,
      shopId: shop.id,
      platform: String(shop.platform || ''),
      deviceSessionId: suppliedActor?.deviceSessionId || null,
    });
    return false;
  } catch (caught) {
    if (!(caught instanceof SourceWorkflowLegacyPublishError)) throw caught;
    reply.status(caught.statusCode).send({
      code: 0,
      errorCode: caught.code,
      msg: caught.message,
      rolloutRevision: caught.decision.revision,
    });
    return true;
  }
}

const batchListSchema = z.object({
  shopId: z.string().min(1),
  draftRefs: z.array(z.record(z.any())).optional(),
  items: z.array(z.object({
    supplyGoodsId: z.string().trim().min(1).optional(),
    skuKey: z.string().trim().min(1).optional(),
    offerId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    categoryId: z.coerce.number().int().positive(),
    typeId: z.coerce.number().int().positive(),
    price: z.coerce.number().positive(),
    oldPrice: z.coerce.number().optional(),
    currency: z.string().default('CNY'),
    stock: z.coerce.number().int().min(0).default(0),
    images: z.array(z.string().url()).min(1),
    weight: z.coerce.number().int().positive(),
    height: z.coerce.number().int().positive().default(100),
    depth: z.coerce.number().int().positive().default(100),
    width: z.coerce.number().int().positive().default(100),
    attributes: z.array(z.object({
      id: z.number(),
      value: z.string(),
    })).optional(),
  })).min(1).max(100),
});

const directOzonImportBySkuSchema = z.object({
  shopId: z.string().min(1),
  draftRefs: z.array(z.record(z.any())).optional(),
  source: z.string().optional(),
  entry: z.string().optional(),
  mode: z.string().optional(),
  items: z.array(z.object({
    sku: z.coerce.number().int().positive(),
    supplyGoodsId: z.string().trim().min(1).optional(),
    offerId: z.string().trim().min(1).optional(),
    title: z.string().trim().optional(),
    price: z.coerce.number().positive().optional(),
    oldPrice: z.coerce.number().positive().optional(),
    currency: z.string().trim().default('CNY'),
    sourceUrl: z.string().trim().optional(),
    imageUrls: z.array(z.string().trim()).optional(),
    brand: z.string().trim().optional(),
    categoryPath: z.string().trim().optional(),
    salesSchema: z.string().trim().optional(),
    weightGrams: z.coerce.number().optional().nullable(),
    dimensionsText: z.string().trim().optional(),
    commissionRate: z.coerce.number().optional().nullable(),
    logisticsFeeCny: z.coerce.number().optional().nullable(),
    costCny: z.coerce.number().optional().nullable(),
    profitCny: z.coerce.number().optional().nullable(),
    profitMarginPct: z.coerce.number().optional().nullable(),
    soldCount: z.coerce.number().optional().nullable(),
    soldSum: z.coerce.number().optional().nullable(),
    returnCancelRate: z.coerce.number().optional().nullable(),
    nullableRedemptionRate: z.coerce.number().optional().nullable(),
    sellerCount: z.coerce.number().optional().nullable(),
    minFollowPriceRub: z.coerce.number().optional().nullable(),
    maxFollowPriceRub: z.coerce.number().optional().nullable(),
    sellerNames: z.array(z.string().trim()).optional(),
    ozonMetrics: z.record(z.any()).optional(),
  })).min(1).max(1000),
});

const browserOneClickJobSchema = z.object({
  shopId: z.string().min(1),
  clientRequestId: z.string().trim().min(16).max(200).regex(/^[A-Za-z0-9_-]+$/u).optional(),
  entry: z.string().trim().optional(),
  mode: z.string().trim().optional(),
  sourceSkus: z.array(z.union([z.string(), z.number()])).max(BROWSER_ONE_CLICK_MAX_ITEMS).optional(),
  productUrls: z.array(z.string().trim()).max(BROWSER_ONE_CLICK_MAX_ITEMS).optional(),
  rows: z.array(z.record(z.any())).max(BROWSER_ONE_CLICK_MAX_ITEMS).optional(),
  itemCount: z.coerce.number().int().positive().max(BROWSER_ONE_CLICK_MAX_ITEMS).optional(),
  watermark: z.record(z.any()).optional().nullable(),
  publish: z.record(z.any()).optional(),
  markupPct: z.coerce.number().optional(),
  followBrand: z.boolean().optional(),
  randomOfferId: z.boolean().optional(),
  categoryId: z.coerce.number().optional(),
  typeId: z.coerce.number().optional(),
  costs: z.record(z.any()).optional(),
  prices: z.record(z.any()).optional(),
  fxRate: z.coerce.number().optional(),
  commissionRate: z.coerce.number().optional(),
  logisticsFeeCny: z.coerce.number().optional(),
  deferStart: z.boolean().optional(),
  legacyWorkflowFallback: z.boolean().optional(),
});

const browserOneClickJobPatchSchema = z.object({
  status: z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED']).optional(),
  payload: z.record(z.any()).optional(),
  result: z.any().optional(),
  errorMessage: z.string().trim().optional().nullable(),
});

const browserOneClickEvidencePatchSchema = z.object({
  stage: z.enum(['collecting', 'submitted', 'collect_failed']).optional(),
  browserPayloadBatch: z.boolean().optional(),
  browserPayloadReady: z.boolean().optional(),
  browserPayloadBatchAt: z.string().max(100).optional(),
  browserPayloadComplete: z.boolean().optional(),
  browserPayloadReadyAt: z.string().max(100).optional(),
  browserPayloadStream: z.record(z.any()).optional(),
  browserPayloadRetrying: z.boolean().optional(),
  browserPayloadRetryAt: z.string().max(100).optional(),
  browserPayloadLastError: z.string().max(260).optional(),
  rows: z.array(z.record(z.any())).max(BROWSER_ONE_CLICK_MAX_ITEMS).optional(),
}).strict();

const BROWSER_ONE_CLICK_STAGE_STALE_MS = 15 * 60 * 1000;
const OZON_MARKING_CODE_REQUIRED_ATTR_ID = 23536;

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(',')}}`;
}

function rowSku(row: Record<string, any>): string {
  return String(row.sku || row.productId || '').trim();
}

const BROWSER_ONE_CLICK_ROW_IDENTITY_KEYS = new Set([
  'supplyGoodsId',
  'browserOneClickSkuGoodsIds',
  'sourceListingDraftRefs',
  'snapshotId',
  'draftId',
  'taskId',
]);

function browserOneClickEvidenceRow(value: unknown): Record<string, any> {
  return Object.fromEntries(Object.entries(objectRecord(value))
    .filter(([key]) => !BROWSER_ONE_CLICK_ROW_IDENTITY_KEYS.has(key)));
}

function mergeRowsBySku(existingRows: Record<string, any>[], nextRows: Record<string, any>[]): Record<string, any>[] {
  const bySku = new Map<string, Record<string, any>>();
  for (const value of existingRows) {
    const row = browserOneClickEvidenceRow(value);
    const sku = rowSku(row);
    if (sku) bySku.set(sku, row);
  }
  for (const value of nextRows) {
    const row = browserOneClickEvidenceRow(value);
    const sku = rowSku(row);
    if (sku) bySku.set(sku, row);
  }
  return Array.from(bySku.values());
}

function uniqueStrings(values: unknown[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function browserOneClickProductUrl(
  payload: Record<string, any>,
  sku: string,
  row: Record<string, any>,
): string {
  const sourceSkus = stringList(payload.sourceSkus);
  const productUrls = Array.isArray(payload.productUrls)
    ? payload.productUrls.map((url) => String(url || '').trim())
    : [];
  const index = sourceSkus.indexOf(sku);
  return String(row.sourceUrl || (index >= 0 ? productUrls[index] : '') || '').trim();
}

function positiveNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function browserOneClickExpectedSkus(payload: Record<string, any>): string[] {
  return uniqueStrings(stringList(payload.sourceSkus));
}

function browserOneClickRowBySku(rows: Record<string, any>[]) {
  const bySku = new Map<string, Record<string, any>>();
  const duplicates = new Set<string>();
  for (const row of rows) {
    const sku = rowSku(row);
    if (!sku) continue;
    if (bySku.has(sku)) duplicates.add(sku);
    bySku.set(sku, row);
  }
  return { bySku, duplicates: [...duplicates] };
}

function browserOneClickCaptureItem(
  sku: string,
  row: Record<string, any>,
  payload: Record<string, any>,
): Record<string, unknown> {
  const publish = objectRecord(payload.publish);
  const sourceUrl = browserOneClickProductUrl(payload, sku, row)
    || `https://www.ozon.ru/product/${encodeURIComponent(sku)}/`;
  const images = Array.isArray(row.images)
    ? row.images
    : [row.image, row.img, row.picture];
  const cnyPrice = positiveNumber(objectRecord(publish.costs)[sku])
    ?? positiveNumber(row.costCny)
    ?? positiveNumber(row.priceCny)
    ?? (String(row.currency || '').trim().toUpperCase() === 'CNY'
      ? positiveNumber(row.price) : null);
  const candidateVariants = Array.isArray(row.variants) ? row.variants.map(objectRecord) : [];
  const selectedVariant = candidateVariants.find((variant) => [
    variant.sku,
    variant.skuId,
    variant.sourceSkuId,
    variant.productId,
    variant.id,
  ].some((value) => String(value || '').trim() === sku)) || objectRecord(row.selectedSku);
  const variants = [{
    ...selectedVariant,
    sku,
    price: cnyPrice,
    stock: Number.isFinite(Number(selectedVariant.stock ?? row.stock))
      ? Math.max(0, Math.floor(Number(selectedVariant.stock ?? row.stock)))
      : null,
    attrs: objectRecord(selectedVariant.attrs || selectedVariant.attributes
      || row.selectedSku?.attrs || row.attrs || row.attributes),
  }];
  return {
    ...row,
    sourcePlatform: 'ozon',
    sourceProductId: sku,
    sourceUrl,
    sku,
    title: String(row.title || row.name || `Ozon SKU ${sku}`).trim(),
    sourceTitleRaw: String(row.title || row.name || `Ozon SKU ${sku}`).trim(),
    images: images.map((image) => String(image || '').trim()).filter(Boolean),
    variants,
    currency: cnyPrice == null
      ? String(row.currency || row.pagePriceCurrency || row.priceCurrency || 'RUB').trim().toUpperCase()
      : 'CNY',
    price: cnyPrice,
    sourceCategoryId: row.sourceCategoryId ?? row.categoryId ?? row.descriptionCategoryId,
    categoryName: row.categoryName ?? row.categoryPath,
    weightG: row.weightG ?? row.weightGrams ?? row.grossWeightGrams ?? row.weight,
    lengthMm: row.lengthMm ?? row.depth ?? row.length,
    widthMm: row.widthMm ?? row.width,
    heightMm: row.heightMm ?? row.height,
  };
}

const BROWSER_ONE_CLICK_EVIDENCE_PAYLOAD_KEYS = new Set([
  'stage',
  'browserPayloadBatch',
  'browserPayloadReady',
  'browserPayloadBatchAt',
  'browserPayloadComplete',
  'browserPayloadReadyAt',
  'browserPayloadStream',
  'browserPayloadRetrying',
  'browserPayloadRetryAt',
  'browserPayloadLastError',
  'rows',
]);

function browserOneClickEvidencePayload(value: unknown): Record<string, any> {
  const payload = objectRecord(value);
  return Object.fromEntries(Object.entries(payload)
    .filter(([key]) => BROWSER_ONE_CLICK_EVIDENCE_PAYLOAD_KEYS.has(key)));
}

function browserOneClickPatchBoundaryError(
  data: z.infer<typeof browserOneClickJobPatchSchema>,
): 'forbidden' | 'too_many_items' | null {
  if (data.status === 'PENDING' || data.status === 'SUCCESS' || 'result' in data) {
    return 'forbidden';
  }
  const payload = objectRecord(data.payload);
  if (Array.isArray(payload.rows) && payload.rows.length > BROWSER_ONE_CLICK_MAX_ITEMS) {
    return 'too_many_items';
  }
  return browserOneClickEvidencePatchSchema.safeParse(payload).success ? null : 'forbidden';
}

function browserOneClickPayloadRevision(payload: Record<string, any>): number | null {
  const revision = Number(payload.browserPayloadRevision);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

export interface BrowserOneClickListingJobReceipt {
  jobId: string;
  status: string;
  stage: string;
  browserPayloadRevision: number | null;
  acceptedSkus: string[];
  acceptedRowHashes: Record<string, string>;
  handoff?: NonNullable<ReturnType<typeof parseBrowserOneClickReviewHandoff>>;
}

function browserOneClickListingJobReceipt(job: {
  id: string;
  status: string;
  payload: unknown;
}): BrowserOneClickListingJobReceipt {
  const payload = objectRecord(job.payload);
  const acceptedSkus = uniqueStrings(
    (Array.isArray(payload.rows) ? payload.rows : [])
      .map((row) => rowSku(objectRecord(row))),
  );
  const acceptedRowHashes = Object.fromEntries(
    (Array.isArray(payload.rows) ? payload.rows : [])
      .map((value) => browserOneClickEvidenceRow(value))
      .map((row) => {
        const sku = rowSku(row);
        return sku
          ? [sku, createHash('sha256').update(canonicalJson(row)).digest('hex')]
          : null;
      })
      .filter((entry): entry is [string, string] => Boolean(entry)),
  );
  const handoff = parseBrowserOneClickReviewHandoff(
    payload.browserOneClickPublishHandoff,
  );
  return {
    jobId: job.id,
    status: String(job.status || ''),
    stage: String(payload.stage || 'unknown').trim(),
    browserPayloadRevision: browserOneClickPayloadRevision(payload),
    acceptedSkus,
    acceptedRowHashes,
    ...(handoff ? { handoff } : {}),
  };
}

async function persistBrowserOneClickPayload(input: {
  job: { id: string; status: string; finishedAt?: Date | null };
  expectedRevision: number;
  payload: Record<string, any>;
  status: 'RUNNING' | 'FAILED';
  errorMessage: string | null;
  finishedAt?: Date;
}) {
  const payload = {
    ...input.payload,
    browserPayloadRevision: input.expectedRevision + 1,
  };
  const updated = await prisma.syncJob.updateMany({
    where: {
      id: input.job.id,
      status: input.job.status as any,
      payload: {
        path: ['browserPayloadRevision'],
        equals: input.expectedRevision,
      } as any,
    },
    data: {
      status: input.status,
      payload: inputJson(payload),
      errorMessage: input.errorMessage,
      ...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
    },
  });
  if (!updated || updated.count !== 1) return null;
  return {
    id: input.job.id,
    status: input.status,
    finishedAt: input.finishedAt || input.job.finishedAt || null,
    payload,
  };
}

async function persistBrowserOneClickTerminalFailure(input: {
  job: { id: string; status: string; finishedAt?: Date | null };
  previousPayload: Record<string, any>;
  errorCode: string;
  errorMessage: string;
  stage: 'collect_failed' | 'review_handoff_failed';
}) {
  const failedAt = new Date();
  const expectedRevision = browserOneClickPayloadRevision(input.previousPayload);
  const payload = {
    ...input.previousPayload,
    stage: input.stage,
    browserOneClickTerminalFailure: {
      errorCode: input.errorCode,
      failedAt: failedAt.toISOString(),
    },
    publishOutcome: {
      state: 'FAILED',
      doNotRetry: true,
      reason: input.errorCode,
      observedAt: failedAt.toISOString(),
    },
    ...(input.stage === 'review_handoff_failed' ? {
      browserOneClickReviewFailure: {
        errorCode: input.errorCode,
        failures: [{ errorCode: input.errorCode }],
        missingSkus: [],
        unknownSkus: [],
        duplicateSkus: [],
      },
    } : {}),
  };
  if (expectedRevision != null) {
    return persistBrowserOneClickPayload({
      job: input.job,
      expectedRevision,
      payload,
      status: 'FAILED',
      errorMessage: input.errorMessage,
      finishedAt: failedAt,
    });
  }

  const terminalPayload = { ...payload, browserPayloadRevision: 0 };
  const updated = await prisma.syncJob.updateMany({
    where: {
      id: input.job.id,
      status: input.job.status as any,
      payload: { equals: inputJson(input.previousPayload) } as any,
    },
    data: {
      status: 'FAILED',
      payload: inputJson(terminalPayload),
      errorMessage: input.errorMessage,
      finishedAt: failedAt,
    },
  });
  if (!updated || updated.count !== 1) return null;
  return {
    id: input.job.id,
    status: 'FAILED' as const,
    finishedAt: failedAt,
    payload: terminalPayload,
  };
}

async function sendBrowserOneClickTerminalFailure(input: {
  reply: FastifyReply;
  job: { id: string; status: string; finishedAt?: Date | null };
  previousPayload: Record<string, any>;
  errorCode: string;
  message: string;
  stage: 'collect_failed' | 'review_handoff_failed';
  statusCode: 404 | 409;
}) {
  const updated = await persistBrowserOneClickTerminalFailure({
    job: input.job,
    previousPayload: input.previousPayload,
    errorCode: input.errorCode,
    errorMessage: `${input.errorCode}: ${input.message}`.slice(0, 260),
    stage: input.stage,
  });
  if (!updated) {
    return input.reply.status(409).send({
      code: 0,
      errorCode: 'browser_payload_conflict',
      terminal: false,
      msg: '任务状态已被另一个请求更新，请重试以读取最新状态',
    });
  }
  return input.reply.status(input.statusCode).send({
    code: 0,
    errorCode: input.errorCode,
    terminal: true,
    msg: input.message,
    data: browserOneClickListingJobReceipt(updated),
  });
}


function importErrorMessage(error: unknown): string {
  const anyError = error as any;
  const code = String(anyError?.code || anyError?.cause?.code || '').trim();
  const message = String(anyError?.message || error || '未知错误').trim();
  return code && !message.includes(code) ? `${message} (${code})` : message;
}

interface RefreshListingProductPushJobOptions {
  ozonApiTimeoutMs?: number;
}

function positiveInt(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : fallback;
}

async function resolveListingOzonApiTimeoutMs(options: RefreshListingProductPushJobOptions): Promise<number> {
  const explicit = positiveInt(options.ozonApiTimeoutMs, 0);
  if (explicit > 0) return explicit;
  const settings = await getListingTaskRefreshSettings();
  return positiveInt(settings.ozonApiTimeoutMs, 20000);
}
export function extractListingOfferIds(payload: unknown): string[] {
  const data = objectRecord(payload);
  const fromOfferIds = Array.isArray(data.offerIds) ? data.offerIds : [];
  const fromItems = Array.isArray(data.items)
    ? data.items.map((item: any) => item?.offer_id || item?.offerId)
    : [];
  const fromImages = data.offerImageLists && typeof data.offerImageLists === 'object' && !Array.isArray(data.offerImageLists)
    ? Object.keys(data.offerImageLists)
    : [];
  return uniqueStrings([...fromOfferIds, ...fromItems, ...fromImages]);
}

function isOzonMarkingCodeAutoCorrectedError(error: unknown): boolean {
  const row = objectRecord(error);
  const code = String(row.code || '').trim().toLowerCase();
  if (code !== 'marking_auto_corrected') return false;
  const attributeId = Number(row.attribute_id || row.attributeId || 0);
  return attributeId === OZON_MARKING_CODE_REQUIRED_ATTR_ID;
}

export function buildOzonMarkingCodeRepairItems(
  importItems: Array<{ offer_id?: unknown; errors?: unknown[] }> | null | undefined,
  alreadySubmittedOfferIds: unknown[] = [],
): Array<{ offer_id: string; attributes: { id: number; values: { value: string }[] }[] }> {
  const skipped = new Set(uniqueStrings(alreadySubmittedOfferIds));
  const seen = new Set<string>();
  const out: Array<{ offer_id: string; attributes: { id: number; values: { value: string }[] }[] }> = [];
  for (const item of Array.isArray(importItems) ? importItems : []) {
    const offerId = String(item?.offer_id || '').trim();
    if (!offerId || skipped.has(offerId) || seen.has(offerId)) continue;
    const errors = Array.isArray(item?.errors) ? item.errors : [];
    if (!errors.some(isOzonMarkingCodeAutoCorrectedError)) continue;
    seen.add(offerId);
    out.push({
      offer_id: offerId,
      attributes: [{
        id: OZON_MARKING_CODE_REQUIRED_ATTR_ID,
        values: [{ value: 'false' }],
      }],
    });
  }
  return out;
}

export function buildImportInfoFromProductInfoFallback(payload: unknown, products: OzonProductInfo[]): OzonImportInfo | null {
  const offerIds = extractListingOfferIds(payload);
  if (!offerIds.length) return null;

  const productByOfferId = new Map<string, OzonProductInfo>();
  for (const product of products || []) {
    const offerId = String((product as any)?.offer_id || '').trim();
    if (offerId) productByOfferId.set(offerId, product);
  }

  const items = offerIds.map((offerId) => {
    const product = productByOfferId.get(offerId);
    const productId = Number((product as any)?.id || (product as any)?.product_id || 0);
    return {
      offer_id: offerId,
      product_id: Number.isFinite(productId) ? productId : 0,
      status: productId > 0 ? 'imported' : 'pending',
      errors: [],
    };
  });

  return { total: items.length, items };
}

async function getImportInfoWithProductFallback(client: OzonClient, taskId: number, payload: unknown): Promise<{
  info: OzonImportInfo | null;
  source: 'import-info' | 'product-info-fallback' | 'unavailable';
  errorMessage: string | null;
}> {
  try {
    return { info: await client.getImportInfo(taskId), source: 'import-info', errorMessage: null };
  } catch (error) {
    const errorMessage = importErrorMessage(error);
    const offerIds = extractListingOfferIds(payload);
    if (!offerIds.length) return { info: null, source: 'unavailable', errorMessage };

    try {
      const products = await client.getProductInfoByOfferId(offerIds);
      const fallbackInfo = buildImportInfoFromProductInfoFallback(payload, products);
      return { info: fallbackInfo, source: 'product-info-fallback', errorMessage };
    } catch (fallbackError) {
      return {
        info: null,
        source: 'unavailable',
        errorMessage: `${errorMessage}; offer_id 兜底查询也失败: ${importErrorMessage(fallbackError)}`,
      };
    }
  }
}

function isBrowserOneClickStageStale(data: Record<string, any>): boolean {
  const stage = String(data.stage || '').trim();
  if (!['preparing_browser_data', 'collecting', 'collected', 'watermarking', 'watermarked', 'publishing'].includes(stage)) return false;
  const updatedAt = new Date(String(data.updatedAt || data.submittedAt || ''));
  if (!Number.isFinite(updatedAt.getTime())) return false;
  return Date.now() - updatedAt.getTime() > BROWSER_ONE_CLICK_STAGE_STALE_MS;
}

function missingTaskIdMessage(payload: unknown): string {
  const data = objectRecord(payload);
  if (data.source === 'browser-one-click-listing') {
    const stage = String(data.stage || '').trim();
    if (isBrowserOneClickStageStale(data)) return 'ERP 后台队列执行可能已中断；请稍后刷新队列状态，确认未重复上架后再重新提交';
    if (stage === 'collecting') return 'ERP 后台队列正在写入临时采集商品，请稍后刷新';
    if (stage === 'preparing_browser_data') return '浏览器扩展正在补全商品数据，完成后会自动进入 ERP 后台队列';
    if (stage === 'collected') return 'ERP 后台队列已写入临时采集商品，正在准备打水印/提交上架';
    if (stage === 'watermarking') return 'ERP 后台队列正在打水印，请稍后刷新';
    if (stage === 'watermarked') return 'ERP 后台队列已完成打水印，正在提交到 Ozon';
    if (stage === 'publishing') return 'ERP 后台队列正在提交到 Ozon，请稍后刷新';
    if (stage === 'collect_failed') return 'ERP 后台队列写入临时采集商品失败，请重新提交';
    if (stage === 'watermark_failed') return 'ERP 后台队列打水印失败，请检查水印模板后重新提交';
    if (stage === 'publish_failed') return '提交到 Ozon 失败，请查看错误信息后重新提交';
    return '任务还未进入 Ozon 提交阶段，请稍后刷新；如果长期停留，说明 ERP 后台队列执行中断，请重新提交';
  }
  return '任务缺少 taskId';
}

function buildDirectImportBySkuTitle(input: { title?: string; sku: number }): string {
  const title = String(input.title || '').trim();
  return title ? title.slice(0, 500) : `Ozon SKU ${input.sku}`;
}

function buildDirectImportBySkuPrice(input: { price?: number; oldPrice?: number }): { price: string; oldPrice: string } {
  const price = Number.isFinite(input.price) && Number(input.price) > 0 ? Number(input.price) : 100;
  const oldPrice = Number.isFinite(input.oldPrice) && Number(input.oldPrice) >= price
    ? Number(input.oldPrice)
    : Math.ceil(price * 1.2);
  return {
    price: String(Math.round(price * 100) / 100),
    oldPrice: String(Math.round(oldPrice * 100) / 100),
  };
}

export function isPictureUploadRepairJob(payload: Record<string, any>): boolean {
  if (payload.source === 'collect-publish-fallback' || payload.mode === 'follow-by-sku') return true;
  if (payload.source !== 'collect-publish') return false;
  const offerImageLists = payload.offerImageLists && typeof payload.offerImageLists === 'object' && !Array.isArray(payload.offerImageLists)
    ? payload.offerImageLists as Record<string, unknown>
    : {};
  const offerImages = payload.offerImages && typeof payload.offerImages === 'object' && !Array.isArray(payload.offerImages)
    ? payload.offerImages as Record<string, unknown>
    : {};
  return Object.keys(offerImageLists).length > 0 || Object.keys(offerImages).length > 0;
}

function mergePictureUploadDiagnostics(existingInput: unknown, next: any[]): any[] {
  const existing = Array.isArray(existingInput) ? existingInput as any[] : [];
  if (!next.length) return existing;
  const nextOfferIds = new Set(next.map((entry) => String(entry?.offerId || '')).filter(Boolean));
  return [
    ...existing.filter((entry) => !nextOfferIds.has(String(entry?.offerId || ''))),
    ...next,
  ];
}

function summarizePictureUploadDiagnostics(diagnosticsInput: unknown, pendingCount: number): {
  status: 'pending' | 'success' | 'failed' | 'partial_pending' | 'partial_failed';
  failedCount: number;
  skippedCount: number;
  pendingCount: number;
  errorMessage: string | null;
} {
  const diagnostics = Array.isArray(diagnosticsInput) ? diagnosticsInput as any[] : [];
  const failedCount = diagnostics.filter((entry) => entry?.status === 'failed').length;
  const skippedCount = diagnostics.filter((entry) => entry?.status === 'skipped').length;
  const blockedCount = failedCount + skippedCount;
  if (pendingCount > 0) {
    return {
      status: blockedCount > 0 ? 'partial_pending' : 'pending',
      failedCount,
      skippedCount,
      pendingCount,
      errorMessage: blockedCount > 0
        ? `图片补传进行中：已阻塞 ${blockedCount} 个，待补传 ${pendingCount} 个`
        : `图片补传等待 OZON 生成 product_id：剩余 ${pendingCount} 个`,
    };
  }
  if (failedCount || skippedCount) {
    return {
      status: 'partial_failed',
      failedCount,
      skippedCount,
      pendingCount,
      errorMessage: `图片补传未完成：失败 ${failedCount} 个，缺图 ${skippedCount} 个`,
    };
  }
  return {
    status: 'success',
    failedCount,
    skippedCount,
    pendingCount,
    errorMessage: null,
  };
}

type PictureActivationClient = Pick<OzonClient, 'getProductInfoList' | 'getProductInfoAttributes'>;

function getImportProductRefs(importItems: any[]): Array<{ productId: string; offerId: string }> {
  const seen = new Set<string>();
  const refs: Array<{ productId: string; offerId: string }> = [];
  for (const item of importItems) {
    const productId = String(item?.product_id || item?.productId || '').trim();
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);
    refs.push({
      productId,
      offerId: String(item?.offer_id || item?.offerId || '').trim(),
    });
  }
  return refs;
}

export async function findPictureActivationPendingItems(
  client: PictureActivationClient,
  shopId: string,
  importItems: any[],
): Promise<any[]> {
  const refs = getImportProductRefs(importItems);
  const productIds = importItems
    .map((item) => String(item?.product_id || item?.productId || '').trim())
    .filter(Boolean);
  if (!productIds.length) return [];

  const numericProductIds = refs
    .map((ref) => Number(ref.productId))
    .filter((productId) => Number.isFinite(productId) && productId > 0);

  if (numericProductIds.length) {
    try {
      const liveDetails = await client.getProductInfoList(numericProductIds);
      const attributesByProductId = new Map<string, any>();
      try {
        const attributes = await client.getProductInfoAttributes({
          product_id: numericProductIds.map(String),
          limit: Math.min(numericProductIds.length, 100),
        });
        for (const item of attributes) attributesByProductId.set(String(item.id), item);
      } catch {
        // Product info already carries primary_image/images; attributes are only an extra source.
      }
      const detailsByProductId = new Map(liveDetails.map((item) => [String(item.id), item]));
      return refs
        .map((ref) => {
          const info = detailsByProductId.get(ref.productId);
          const images = info ? resolveOzonProductImages(info, attributesByProductId.get(ref.productId)) : [];
          if (images.length > 0) return null;
          return {
            offerId: ref.offerId || String(info?.offer_id || '').trim(),
            productId: ref.productId,
            reason: 'Ozon 商品详情暂未返回图片',
          };
        })
        .filter(Boolean);
    } catch {
      // Fall back to the last local sync snapshot if Ozon detail lookup is temporarily unavailable.
    }
  }

  const products = await prisma.product.findMany({
    where: {
      shopId,
      platformProductId: { in: productIds },
    },
    select: {
      platformProductId: true,
      offerId: true,
      images: true,
    },
  });
  const byProductId = new Map(products.map((product) => [String(product.platformProductId), product]));

  return importItems
    .map((item) => {
      const productId = String(item?.product_id || item?.productId || '').trim();
      if (!productId) return null;
      const product = byProductId.get(productId);
      if (!product) return null;
      const images = Array.isArray(product.images) ? product.images : [];
      if (images.length > 0) return null;
      return {
        offerId: String(item?.offer_id || item?.offerId || product.offerId || '').trim(),
        productId,
        reason: 'Ozon 商品详情暂未返回图片',
      };
    })
    .filter(Boolean);
}

export async function refreshListingProductPushJob(
  id: string,
  userId?: string,
  options: RefreshListingProductPushJobOptions = {},
): Promise<{
  code: 1 | 0;
  msg: string;
  statusCode?: number;
  data?: {
    id: string;
    status: string;
    finishedAt: Date | null;
    payload: unknown;
  };
}> {
  const job = await prisma.syncJob.findFirst({
    where: { id, type: 'PRODUCT_PUSH' },
    include: { shop: true },
  });
  if (!job || (userId && job.shop.userId !== userId)) {
    return { code: 0, msg: '任务不存在', statusCode: 404 };
  }

  const taskId = (job.payload as any)?.taskId;
  if (!taskId) {
    return { code: 0, msg: missingTaskIdMessage(job.payload) };
  }

  const payload = (job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload))
    ? job.payload as Record<string, any>
    : {};
  const ozonApiTimeoutMs = await resolveListingOzonApiTimeoutMs(options);
  const client = new OzonClient({
    clientId: job.shop.clientId!,
    apiKey: decrypt(job.shop.apiKeyEncrypted),
    maxRetries: 0,
    timeoutMs: ozonApiTimeoutMs,
  });

  try {
    const importLookup = await getImportInfoWithProductFallback(client, Number(taskId), payload);
    const checkedAt = new Date().toISOString();
    if (!importLookup.info) {
      const updated = await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: job.status,
          payload: {
            ...payload,
            ozonImportInfoSource: importLookup.source,
            lastImportInfoError: importLookup.errorMessage,
            lastImportInfoCheckedAt: checkedAt,
          },
        },
      });
      return {
        code: 1,
        msg: 'Ozon import 状态暂时无法读取，任务继续等待自动重试',
        data: {
          id: updated.id,
          status: updated.status,
          finishedAt: updated.finishedAt,
          payload: updated.payload,
        },
      };
    }

    const info = importLookup.info;
    const { total, failed, allDone } = summarizeOzonImportItems(info.items);
    const reviewIssues = collectOzonImportReviewIssues(info.items || []);
    const reviewIssueMessage = reviewIssues[0]?.messages?.[0] || null;
    let nextPayload: Record<string, any> = {
      ...payload,
      itemCount: total,
      failedCount: failed,
      items: info.items,
      ozonReviewStatus: reviewIssues.length ? 'needs_correction' : 'ok',
      ozonReviewIssueCount: reviewIssues.length,
      ozonReviewIssues: reviewIssues.length ? reviewIssues : null,
      ozonImportInfoSource: importLookup.source,
      lastImportInfoError: importLookup.errorMessage,
      lastImportInfoCheckedAt: checkedAt,
    };
    let pictureErrorMessage: string | null = null;

    if (importLookup.source === 'import-info') {
      const previousRepair = objectRecord(payload.ozonMarkingCodeRepair);
      const alreadySubmittedOfferIds = String(previousRepair.status || '') === 'submitted'
        ? (Array.isArray(previousRepair.offerIds) ? previousRepair.offerIds : [])
        : [];
      const markingRepairItems = buildOzonMarkingCodeRepairItems(info.items, alreadySubmittedOfferIds);
      if (markingRepairItems.length) {
        try {
          const repairResult = await client.updateProductAttributes(markingRepairItems);
          nextPayload = {
            ...nextPayload,
            ozonMarkingCodeRepair: {
              status: 'submitted',
              offerIds: markingRepairItems.map((item) => item.offer_id),
              taskId: Number((repairResult as any)?.result?.task_id) || null,
              updatedAt: checkedAt,
            },
          };
        } catch (error: any) {
          nextPayload = {
            ...nextPayload,
            ozonMarkingCodeRepair: {
              status: 'failed',
              offerIds: markingRepairItems.map((item) => item.offer_id),
              error: String(error?.message || error || 'unknown').slice(0, 300),
              updatedAt: checkedAt,
            },
          };
        }
      }
    }

    if (isPictureUploadRepairJob(payload)) {
      const traces = Array.isArray(payload.variantTrace) ? payload.variantTrace as any[] : [];
      const sourceItemIds = Array.from(new Set(
        traces
          .map((trace) => String(trace?.sourceItemId || '').trim())
          .filter(Boolean),
      ));
      const sourceItems = sourceItemIds.length
        ? await prisma.supplyGoods.findMany({
          where: {
            id: { in: sourceItemIds },
            userId: job.shop.userId,
          },
        })
        : [];
      const plan = planFallbackPictureUploads(payload, info.items, sourceItems);
      const pictureDiagnostics: any[] = [];

      for (const skipped of plan.skipped) {
        recordPictureUploadDiagnostic(pictureDiagnostics, {
          offerId: skipped.offerId,
          productId: skipped.productId,
          status: 'skipped',
          rawImages: skipped.rawImages,
          message: skipped.message,
        });
      }

      for (const operation of plan.operations) {
        try {
          const resolvedImages = await resolveImageUrls(operation.rawImages, job.shopId, job.shop.userId);
          const pictureTask = await client.importProductPictures({ offer_id: operation.offerId, images: resolvedImages });
          await client.waitForImportTask(pictureTask.task_id);
          recordPictureUploadDiagnostic(pictureDiagnostics, {
            offerId: operation.offerId,
            productId: operation.productId,
            status: 'uploaded',
            rawImages: operation.rawImages,
            resolvedImages,
          });
        } catch (e: any) {
          recordPictureUploadDiagnostic(pictureDiagnostics, {
            offerId: operation.offerId,
            productId: operation.productId,
            status: 'failed',
            rawImages: operation.rawImages,
            error: e,
          });
        }
      }

      const mergedDiagnostics = mergePictureUploadDiagnostics(payload.pictureUploads, pictureDiagnostics);
      const pictureSummary = summarizePictureUploadDiagnostics(mergedDiagnostics, plan.pendingCount);
      pictureErrorMessage = pictureSummary.errorMessage;
      nextPayload = {
        ...nextPayload,
        offerImageLists: Object.keys(plan.offerImageLists).length ? plan.offerImageLists : payload.offerImageLists ?? null,
        pictureUploads: mergedDiagnostics.length ? mergedDiagnostics : null,
        pictureUploadStatus: pictureSummary.status,
        pictureUploadFailedCount: pictureSummary.failedCount,
        pictureUploadSkippedCount: pictureSummary.skippedCount,
        pictureUploadPendingCount: pictureSummary.pendingCount,
        pictureUploadError: pictureSummary.errorMessage,
      };
    }

    const pictureStatus = String(nextPayload.pictureUploadStatus || '').toLowerCase();
    const canCheckPictureActivation = allDone
      && failed < total
      && pictureStatus !== 'failed'
      && pictureStatus !== 'partial_failed'
      && pictureStatus !== 'pending';
    if (canCheckPictureActivation) {
      const pendingActivation = await findPictureActivationPendingItems(client, job.shopId, info.items || []);
      nextPayload = {
        ...nextPayload,
        pictureActivationPendingCount: pendingActivation.length,
        pictureActivationPending: pendingActivation.length ? pendingActivation : null,
      };
    }

    const newStatus = allDone ? (failed > 0 ? 'FAILED' : 'SUCCESS') : 'RUNNING';
    const finalStatus = pictureErrorMessage
      ? (
        allDone
        && nextPayload.pictureUploadStatus !== 'pending'
        && nextPayload.pictureUploadStatus !== 'partial_pending'
        && (nextPayload.pictureUploadStatus === 'failed' || nextPayload.pictureUploadStatus === 'partial_failed')
          ? 'FAILED'
          : 'RUNNING'
      )
      : newStatus;
    const errorMessage = pictureErrorMessage
      || (reviewIssueMessage ? `Ozon 返回 ${failed} 个商品需更正：${reviewIssueMessage}` : null)
      || (failed > 0 ? `${failed} 个商品上架失败` : null);

    const updated = await prisma.syncJob.update({
      where: { id: job.id },
      data: {
        status: finalStatus,
        finishedAt: allDone && finalStatus !== 'RUNNING' ? new Date() : null,
        payload: nextPayload,
        errorMessage,
      },
    });

    return {
      code: 1,
      msg: 'ok',
      data: {
        id: updated.id,
        status: updated.status,
        finishedAt: updated.finishedAt,
        payload: updated.payload,
      },
    };
  } catch (e: any) {
    return { code: 0, msg: `刷新失败: ${e.message}` };
  }
}

function browserOneClickActorShopAllowed(
  actor: BrowserOneClickActor,
  shopId: string,
): boolean {
  return !actor.allowedShopIds || actor.allowedShopIds.includes(shopId);
}

function browserOneClickActorOwnsJob(
  actor: BrowserOneClickActor,
  job: { shop: { id: string; userId: string }; payload: unknown },
): boolean {
  if (job.shop.userId !== actor.ownerUserId) return false;
  const boundSessionId = String(
    objectRecord(job.payload).extensionDeviceSessionId || '',
  ).trim();
  return actor.deviceSessionId
    ? boundSessionId === actor.deviceSessionId
    : !boundSessionId;
}

export async function createBrowserOneClickListingJobForActor(
  request: FastifyRequest,
  reply: FastifyReply,
  actor: BrowserOneClickActor,
  options: BrowserOneClickListingHandlersOptions,
) {
  const parsed = browserOneClickJobSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      code: 0,
      msg: parsed.error.issues[0]?.message ?? '参数错误',
    });
  }
  if (actor.deviceSessionId && !parsed.data.clientRequestId) {
    return reply.status(400).send({
      code: 0,
      errorCode: 'browser_one_click_idempotency_key_required',
      terminal: true,
      msg: '设备创建一键上架任务必须提供幂等请求键',
    });
  }
  if (actor.deviceSessionId && parsed.data.rows?.length) {
    return reply.status(400).send({
      code: 0,
      errorCode: 'browser_one_click_initial_rows_forbidden',
      terminal: true,
      msg: '设备必须在任务创建后逐批补全商品证据',
    });
  }
  const { shopId } = parsed.data;
  if (!browserOneClickActorShopAllowed(actor, shopId)) {
    return reply.status(404).send({
      code: 0,
      errorCode: 'device_shop_not_found',
      msg: '店铺未授权给该设备',
    });
  }
  const shop = await prisma.shop.findFirst({
    where: { id: shopId, userId: actor.ownerUserId },
  });
  if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
  if (shop.platform !== 'OZON') {
    return reply.send({ code: 0, msg: '暂只支持 OZON 一键上架任务' });
  }
  if (rejectBrowserOneClickActor(request, reply, actor)) return reply;
  if (!options.sourceCaptureService) {
    return reply.status(503).send({
      code: 0,
      errorCode: 'source_capture_adapter_unavailable',
      msg: 'ERP 来源商品捕获服务暂不可用',
    });
  }
  const workflow = await evaluateBrowserOneClickWorkflow({
    featureFlags: options.featureFlags,
    actor,
    shop,
  });
  if (!workflow.ready) return browserOneClickWorkflowUnavailable(reply, workflow);
  const initialRollout = await evaluateBrowserOneClickRollout(options, actor, shop);

  const sourceSkus = (parsed.data.sourceSkus || [])
    .map((sku) => String(sku ?? '').trim());
  const productUrls = (parsed.data.productUrls || [])
    .map((url) => String(url || '').trim());
  if (!sourceSkus.length
    || sourceSkus.some((sku) => !sku)
    || new Set(sourceSkus).size !== sourceSkus.length) {
    return reply.status(400).send({
      code: 0,
      errorCode: 'browser_one_click_expected_skus_invalid',
      msg: '一键上架必须提供唯一且非空的 SKU 列表',
    });
  }
  if (productUrls.length > 0 && productUrls.length !== sourceSkus.length) {
    return reply.status(400).send({
      code: 0,
      errorCode: 'browser_one_click_product_urls_mismatch',
      msg: '商品链接数量必须与 SKU 列表一致，或完全省略链接列表',
    });
  }
  if (parsed.data.itemCount !== undefined && parsed.data.itemCount !== sourceSkus.length) {
    return reply.status(400).send({
      code: 0,
      errorCode: 'browser_one_click_item_count_mismatch',
      msg: '商品数量与 SKU 列表不一致',
    });
  }
  const rows = Array.isArray(parsed.data.rows)
    ? parsed.data.rows.map(browserOneClickEvidenceRow)
    : [];
  const publish = {
    ...objectRecord(parsed.data.publish),
    ...(parsed.data.markupPct !== undefined ? { markupPct: parsed.data.markupPct } : {}),
    ...(parsed.data.followBrand !== undefined ? { followBrand: parsed.data.followBrand } : {}),
    ...(parsed.data.randomOfferId !== undefined ? { randomOfferId: parsed.data.randomOfferId } : {}),
    ...(parsed.data.categoryId !== undefined ? { categoryId: parsed.data.categoryId } : {}),
    ...(parsed.data.typeId !== undefined ? { typeId: parsed.data.typeId } : {}),
    ...(parsed.data.costs !== undefined ? { costs: parsed.data.costs } : {}),
    ...(parsed.data.prices !== undefined ? { prices: parsed.data.prices } : {}),
    ...(parsed.data.fxRate !== undefined ? { fxRate: parsed.data.fxRate } : {}),
    ...(parsed.data.commissionRate !== undefined
      ? { commissionRate: parsed.data.commissionRate } : {}),
    ...(parsed.data.logisticsFeeCny !== undefined
      ? { logisticsFeeCny: parsed.data.logisticsFeeCny } : {}),
  };
  const itemCount = parsed.data.itemCount || sourceSkus.length || 1;
  const browserOneClickRequestFingerprint = createHash('sha256').update(canonicalJson({
    ownerUserId: actor.ownerUserId,
    deviceSessionId: actor.deviceSessionId || null,
    shopId,
    entry: parsed.data.entry || 'extension-workbench',
    mode: parsed.data.mode || 'clone',
    sourceSkus,
    productUrls,
    rows,
    itemCount,
    publish,
    watermark: parsed.data.watermark || null,
    deferStart: true,
  })).digest('hex');
  const payload: Record<string, any> = {
    source: 'browser-one-click-listing',
    ...(parsed.data.clientRequestId ? { clientRequestId: parsed.data.clientRequestId } : {}),
    ...(parsed.data.clientRequestId
      ? { browserOneClickRequestFingerprint }
      : {}),
    browserOneClickOwnerUserId: actor.ownerUserId,
    stage: 'preparing_browser_data',
    entry: parsed.data.entry || 'extension-workbench',
    mode: parsed.data.mode || 'clone',
    itemCount,
    sourceSkus,
    productUrls,
    rows,
    publish,
    browserPayloadReady: false,
    browserPayloadComplete: false,
    browserPayloadRevision: 0,
    submittedAt: new Date().toISOString(),
    browserOneClickWorkflow: {
      captureStage: workflow.capture.captureStage,
      captureRolloutRevision: workflow.capture.revision,
      listingStage: workflow.listing.listingStage,
      listingRolloutRevision: workflow.listing.revision,
      publisherObservation: initialRollout ? {
        authority: initialRollout.authority,
        effectiveStage: initialRollout.effectiveStage,
        rolloutRevision: initialRollout.rolloutRevision,
        gateStateVersion: initialRollout.gateStateVersion,
        evidenceHash: initialRollout.evidenceHash,
      } : null,
    },
    ...(actor.deviceSessionId
      ? { extensionDeviceSessionId: actor.deviceSessionId }
      : {}),
  };
  if (parsed.data.watermark) payload.watermark = parsed.data.watermark;

  const createJob = async (client: typeof prisma) => {
    if (parsed.data.clientRequestId) {
      const existing = await client.syncJob.findFirst({
        where: {
          type: 'PRODUCT_PUSH',
          shop: { userId: actor.ownerUserId },
          payload: { path: ['clientRequestId'], equals: parsed.data.clientRequestId } as any,
        },
        select: { id: true, payload: true, status: true },
      });
      const existingPayload = objectRecord(existing?.payload);
      if (existing
        && existingPayload.browserOneClickOwnerUserId === actor.ownerUserId
        && existingPayload.browserOneClickRequestFingerprint === browserOneClickRequestFingerprint
        && String(existingPayload.extensionDeviceSessionId || '') === String(actor.deviceSessionId || '')) {
        return { ...existing, idempotent: true };
      }
      if (existing) {
        return null;
      }
    }
    const created = await client.syncJob.create({
      data: {
        shopId,
        type: 'PRODUCT_PUSH',
        status: 'RUNNING',
        startedAt: new Date(),
        payload,
      },
      select: { id: true, payload: true, status: true },
    });
    return { ...created, idempotent: false };
  };
  let job: { id: string; idempotent: boolean } | null = null;
  if (parsed.data.clientRequestId) {
    if (typeof (prisma as any).$transaction !== 'function') {
      return reply.status(503).send({
        code: 0,
        errorCode: 'browser_one_click_idempotency_unavailable',
        terminal: false,
        msg: 'ERP 暂时无法保证任务幂等创建，请稍后重试',
      });
    }
    try {
      job = await (prisma as any).$transaction(async (tx: typeof prisma) => {
        if (typeof (tx as any).$queryRaw !== 'function') {
          throw Object.assign(new Error('Browser one-click idempotency lock is unavailable'), {
            code: 'browser_one_click_idempotency_unavailable',
          });
        }
        await (tx as any).$queryRaw(
          Prisma.sql`SELECT 1 AS "locked" FROM pg_advisory_xact_lock(hashtextextended(${`${actor.ownerUserId}:${parsed.data.clientRequestId}`}, 0))`,
        );
        return createJob(tx);
      });
    } catch (error: any) {
      if (error?.code === 'browser_one_click_idempotency_unavailable') {
        return reply.status(503).send({
          code: 0,
          errorCode: 'browser_one_click_idempotency_unavailable',
          terminal: false,
          msg: 'ERP 暂时无法保证任务幂等创建，请稍后重试',
        });
      }
      throw error;
    }
  } else {
    job = await createJob(prisma);
  }
  if (!job) {
    return reply.status(409).send({
      code: 0,
      errorCode: 'browser_one_click_idempotency_conflict',
      terminal: true,
      msg: '请求键已被其他店铺或设备占用，请重新发起任务',
    });
  }
  return reply.send({
    code: 1,
    msg: job.idempotent
      ? '已恢复已有浏览器一键上架任务，浏览器正在补全商品数据'
      : '上架任务已提交到 ERP 上架日志，浏览器正在补全商品数据',
    data: {
      jobId: job.id,
      queued: false,
      deferred: true,
      idempotent: job.idempotent,
    },
  });
}

export async function readBrowserOneClickListingJobForActor(
  request: FastifyRequest,
  reply: FastifyReply,
  actor: BrowserOneClickActor,
) {
  const { id } = request.params as { id: string };
  if (!actor.deviceSessionId || !actor.allowedShopIds?.length) {
    return reply.status(404).send({ code: 0, msg: '任务不存在' });
  }
  const job = await prisma.syncJob.findFirst({
    where: {
      id,
      type: 'PRODUCT_PUSH',
      shopId: { in: [...actor.allowedShopIds] },
      shop: { userId: actor.ownerUserId },
      AND: [
        {
          payload: {
            path: ['source'],
            equals: 'browser-one-click-listing',
          } as any,
        },
        {
          payload: {
            path: ['extensionDeviceSessionId'],
            equals: actor.deviceSessionId,
          } as any,
        },
      ],
    },
    include: { shop: { select: { id: true, userId: true, platform: true } } },
  });
  if (!job
    || !browserOneClickActorOwnsJob(actor, job)
    || !browserOneClickActorShopAllowed(actor, job.shop.id)) {
    return reply.status(404).send({ code: 0, msg: '任务不存在' });
  }
  const payload = objectRecord(job.payload);
  if (payload.source !== 'browser-one-click-listing'
    && payload.browserOneClickJob !== true) {
    return reply.status(404).send({ code: 0, msg: '任务不存在' });
  }
  return reply.send({
    code: 1,
    msg: 'ok',
    data: browserOneClickListingJobReceipt(job),
  });
}

export async function patchBrowserOneClickListingJobForActor(
  request: FastifyRequest,
  reply: FastifyReply,
  actor: BrowserOneClickActor,
  options: BrowserOneClickListingHandlersOptions,
) {
  const { id } = request.params as { id: string };
  const parsed = browserOneClickJobPatchSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      code: 0,
      msg: parsed.error.issues[0]?.message ?? '参数错误',
    });
  }
  const job = await prisma.syncJob.findFirst({
    where: { id, type: 'PRODUCT_PUSH' },
    include: { shop: { select: { id: true, userId: true, platform: true } } },
  });
  if (!job || !browserOneClickActorOwnsJob(actor, job)) {
    return reply.status(404).send({ code: 0, msg: '任务不存在' });
  }
  const previousPayload = objectRecord(job.payload);
  if (previousPayload.source !== 'browser-one-click-listing'
    && previousPayload.browserOneClickJob !== true) {
    return reply.status(404).send({ code: 0, msg: '任务不存在' });
  }
  if (!browserOneClickActorShopAllowed(actor, job.shop.id)) {
    return sendBrowserOneClickTerminalFailure({
      reply,
      job,
      previousPayload,
      errorCode: 'device_authority_changed',
      message: '设备的店铺授权已变更，请重新授权后再试',
      stage: 'collect_failed',
      statusCode: 404,
    });
  }
  if (rejectBrowserOneClickActor(request, reply, actor)) return reply;

  const authoritativeHandoff = parseBrowserOneClickReviewHandoff(
    previousPayload.browserOneClickPublishHandoff,
  );
  if ((previousPayload.browserOneClickPublishHandoff || previousPayload.stage === 'review_required')
    && !authoritativeHandoff) {
    return sendBrowserOneClickTerminalFailure({
      reply,
      job,
      previousPayload,
      errorCode: 'browser_one_click_handoff_invalid',
      message: 'ERP 审核草稿交接数据无效，任务已停止且不会接受浏览器更新',
      stage: 'review_handoff_failed',
      statusCode: 409,
    });
  }
  const patchBoundaryError = browserOneClickPatchBoundaryError(parsed.data);
  if (patchBoundaryError) {
    const errorCode = patchBoundaryError === 'too_many_items'
      ? 'browser_one_click_item_limit_exceeded'
      : actor.deviceSessionId
        ? 'device_publish_state_forbidden'
        : 'browser_one_click_patch_forbidden';
    const message = patchBoundaryError === 'too_many_items'
      ? `每个一键上架任务最多包含 ${BROWSER_ONE_CLICK_MAX_ITEMS} 个商品`
      : '浏览器只能补全商品证据，发布终态、结果和审核交接由 ERP 服务端写入';
    if (actor.deviceSessionId) {
      return sendBrowserOneClickTerminalFailure({
        reply,
        job,
        previousPayload,
        errorCode,
        message,
        stage: 'collect_failed',
        statusCode: 409,
      });
    }
    return reply.status(400).send({
      code: 0,
      errorCode,
      terminal: false,
      msg: message,
    });
  }
  if (authoritativeHandoff
    || previousPayload.stage === 'review_handoff_failed'
    || job.status === 'FAILED'
    || job.status === 'SUCCESS') {
    return reply.send({
      code: 1,
      msg: '任务已完成浏览器数据交接，忽略迟到更新',
      data: browserOneClickListingJobReceipt(job),
    });
  }
  if (actor.deviceSessionId) {
    if (previousPayload.browserQueueStartedAt) {
      return reply.send({
        code: 1,
        msg: 'ok',
        data: browserOneClickListingJobReceipt(job),
      });
    }
  }

  if (previousPayload.browserQueueStartedAt
    || objectRecord(previousPayload.publishOutcome).doNotRetry === true) {
    return reply.send({
      code: 1,
      msg: '任务已进入终态，忽略迟到更新',
      data: browserOneClickListingJobReceipt(job),
    });
  }
  const previousRevision = browserOneClickPayloadRevision(previousPayload);
  if (previousRevision == null) {
    return sendBrowserOneClickTerminalFailure({
      reply,
      job,
      previousPayload,
      errorCode: 'browser_payload_revision_required',
      message: '旧版一键上架任务缺少并发版本，任务已停止且不会自动重试',
      stage: 'review_handoff_failed',
      statusCode: 409,
    });
  }

  const nextStatus = parsed.data.status || job.status;
  const patchPayload = browserOneClickEvidencePayload(parsed.data.payload);
  const shouldFinalizeDeferredJob = previousPayload.source === 'browser-one-click-listing'
    && patchPayload.browserPayloadReady === true
    && patchPayload.browserPayloadComplete === true
    && nextStatus !== 'FAILED';
  const previousRows = Array.isArray(previousPayload.rows)
    ? previousPayload.rows.map(browserOneClickEvidenceRow) : [];
  const patchRows = Array.isArray(patchPayload.rows)
    ? patchPayload.rows.map(browserOneClickEvidenceRow) : [];
  const mergedRows = patchRows.length ? mergeRowsBySku(previousRows, patchRows) : previousRows;
  if (mergedRows.length > BROWSER_ONE_CLICK_MAX_ITEMS) {
    if (actor.deviceSessionId) {
      return sendBrowserOneClickTerminalFailure({
        reply,
        job,
        previousPayload,
        errorCode: 'browser_one_click_item_limit_exceeded',
        message: `每个一键上架任务最多包含 ${BROWSER_ONE_CLICK_MAX_ITEMS} 个商品`,
        stage: 'collect_failed',
        statusCode: 409,
      });
    }
    return reply.status(400).send({
      code: 0,
      errorCode: 'browser_one_click_item_limit_exceeded',
      terminal: false,
      msg: `每个一键上架任务最多包含 ${BROWSER_ONE_CLICK_MAX_ITEMS} 个商品`,
    });
  }
  let mergedSupplyGoodsIds = uniqueStrings(
    Array.isArray(previousPayload.supplyGoodsIds) ? previousPayload.supplyGoodsIds : [],
  );
  let mergedSkuGoodsIds = { ...objectRecord(previousPayload.browserOneClickSkuGoodsIds) };
  let sourceListingCompatibility: LegacySourceListingCompatibilityResult | null = null;
  const basePayload: Record<string, any> = {
    ...previousPayload,
    ...patchPayload,
    ...(actor.deviceSessionId
      ? { extensionDeviceSessionId: actor.deviceSessionId }
      : {}),
    ...(mergedRows.length ? { rows: mergedRows } : {}),
    ...(mergedSupplyGoodsIds.length
      ? { supplyGoodsIds: mergedSupplyGoodsIds, collected: mergedSupplyGoodsIds.length }
      : {}),
    ...(Object.keys(mergedSkuGoodsIds).length
      ? { browserOneClickSkuGoodsIds: mergedSkuGoodsIds }
      : {}),
    ...(sourceListingCompatibility ? {
      sourceListingWorkflow: sourceListingCompatibilityMetadata(sourceListingCompatibility),
    } : {}),
  };
  if (!shouldFinalizeDeferredJob) {
    const effectiveStatus = nextStatus === 'FAILED' ? 'FAILED' : 'RUNNING';
    const payload = {
      ...basePayload,
      stage: effectiveStatus === 'FAILED'
        ? String(patchPayload.stage || 'collect_failed')
        : 'collecting',
      browserPayloadReady: false,
      browserPayloadComplete: false,
    };
    const finishedAt = effectiveStatus === 'FAILED' ? new Date() : undefined;
    const updated = await persistBrowserOneClickPayload({
      job,
      expectedRevision: previousRevision,
      payload,
      status: effectiveStatus,
      errorMessage: effectiveStatus === 'FAILED'
        ? String(parsed.data.errorMessage || '浏览器补全商品数据失败').slice(0, 260)
        : null,
      ...(finishedAt ? { finishedAt } : {}),
    });
    if (!updated) {
      return reply.status(409).send({
        code: 0,
        errorCode: 'browser_payload_conflict',
        terminal: false,
        msg: '商品数据已被另一个批次更新，请重试当前批次',
      });
    }
    return reply.send({ code: 1, msg: 'ok', data: browserOneClickListingJobReceipt(updated) });
  }

  const workflow = await evaluateBrowserOneClickWorkflow({
    featureFlags: options.featureFlags,
    actor,
    shop: job.shop,
  });
  const currentRollout = await evaluateBrowserOneClickRollout(options, actor, job.shop);
  const expectedSkus = browserOneClickExpectedSkus(basePayload);
  const rowsBySku = browserOneClickRowBySku(mergedRows);
  const unknownSkus = [...rowsBySku.bySku.keys()].filter((sku) => !expectedSkus.includes(sku));
  const missingSkus = expectedSkus.filter((sku) => !rowsBySku.bySku.has(sku));
  const streamErrors = Array.isArray(objectRecord(basePayload.browserPayloadStream).errors)
    ? objectRecord(basePayload.browserPayloadStream).errors
    : [];
  let handoffErrorCode = '';
  if (!options.sourceCaptureService) handoffErrorCode = 'SOURCE_CAPTURE_ADAPTER_UNAVAILABLE';
  else if (!workflow.ready) handoffErrorCode = 'SOURCE_LISTING_WORKFLOW_NOT_INTERACTIVE';
  else if (!expectedSkus.length) handoffErrorCode = 'BROWSER_ONE_CLICK_EXPECTED_SKUS_REQUIRED';
  else if (missingSkus.length) handoffErrorCode = 'BROWSER_ONE_CLICK_SKU_COVERAGE_INCOMPLETE';
  else if (unknownSkus.length) handoffErrorCode = 'BROWSER_ONE_CLICK_SKU_UNKNOWN';
  else if (rowsBySku.duplicates.length) handoffErrorCode = 'BROWSER_ONE_CLICK_SKU_DUPLICATE';
  else if (streamErrors.length || Number(objectRecord(basePayload.browserPayloadIngest).failed || 0) > 0) {
    handoffErrorCode = 'BROWSER_ONE_CLICK_CAPTURE_PARTIAL_FAILURE';
  }

  const captureResults = new Map<string, Awaited<ReturnType<NonNullable<typeof options.sourceCaptureService>['ingestLegacy']>>>();
  const captureFailures: Array<{ sku: string; supplyGoodsId: string; errorCode: string }> = [];
  if (!handoffErrorCode && options.sourceCaptureService) {
    for (const sku of expectedSkus) {
      const supplyGoodsId = String(mergedSkuGoodsIds[sku] || '').trim();
      const row = rowsBySku.bySku.get(sku)!;
      try {
        const item = browserOneClickCaptureItem(sku, row, basePayload);
        let stableSupplyGoodsId = supplyGoodsId;
        if (!stableSupplyGoodsId) {
          const projection = await options.sourceCaptureService.ensureLegacyProjection({
            trusted: {
              ownerUserId: actor.ownerUserId,
              actorUserId: actor.actorUserId,
              rolloutRevision: workflow.capture.revision,
              rolloutStage: workflow.capture.captureStage as 'shadow_write' | 'dual_read' | 'v2_only',
              ingestChannel: 'LEGACY_ADAPTER',
            },
            item,
          });
          stableSupplyGoodsId = projection.supplyGoodsId;
        }
        const capture = await options.sourceCaptureService.ingestLegacy({
          trusted: {
            ownerUserId: actor.ownerUserId,
            actorUserId: actor.actorUserId,
            rolloutRevision: workflow.capture.revision,
            rolloutStage: workflow.capture.captureStage as 'shadow_write' | 'dual_read' | 'v2_only',
            ingestChannel: 'LEGACY_ADAPTER',
          },
          item,
          supplyGoodsId: stableSupplyGoodsId,
        });
        if (capture.supplyGoodsId !== stableSupplyGoodsId) {
          captureFailures.push({ sku, supplyGoodsId: stableSupplyGoodsId, errorCode: 'BROWSER_ONE_CLICK_GOODS_MAPPING_MISMATCH' });
        } else {
          mergedSkuGoodsIds = { ...mergedSkuGoodsIds, [sku]: stableSupplyGoodsId };
          mergedSupplyGoodsIds = uniqueStrings([...mergedSupplyGoodsIds, stableSupplyGoodsId]);
          captureResults.set(sku, capture);
        }
      } catch (error) {
        captureFailures.push({
          sku,
          supplyGoodsId,
          errorCode: String((error as { code?: string })?.code || 'SOURCE_CAPTURE_LEGACY_INGEST_FAILED'),
        });
      }
    }
  }

  if (!handoffErrorCode && captureFailures.length === 0) {
    sourceListingCompatibility = await resolveLegacySourceListingCompatibility({
      featureFlags: options.featureFlags,
      adapter: options.sourceListingWorkflowAdapter,
      ownerUserId: actor.ownerUserId,
      actorUserId: actor.actorUserId,
      shopId: job.shop.id,
      platform: String(job.shop.platform || ''),
      deviceSessionId: actor.deviceSessionId || null,
      supplyGoodsIds: expectedSkus.map((sku) => captureResults.get(sku)!.supplyGoodsId),
    });
  }

  const draftsByGoodsId = new Map((sourceListingCompatibility?.drafts || [])
    .map((draft) => [draft.supplyGoodsId, draft] as const));
  const draftFailures = sourceListingCompatibility?.failures || [];
  const draftRefs = expectedSkus.flatMap((sku) => {
    const capture = captureResults.get(sku);
    if (!capture) return [];
    const draft = draftsByGoodsId.get(capture.supplyGoodsId);
    if (!draft || draft.snapshotId !== capture.snapshotId || !draft.selectedSkuKeys?.length) return [];
    const selectedSkuKey = draft.selectedSkuKeys.find(
      (key) => key === sku || key === `legacy-${sku}`,
    );
    return selectedSkuKey ? [{
      supplyGoodsId: capture.supplyGoodsId,
      snapshotId: capture.snapshotId,
      draftId: draft.draftId,
      draftVersion: draft.draftVersion,
      revision: draft.revision,
      skuKey: selectedSkuKey,
      sourceSku: sku,
    }] : [];
  });
  if (!handoffErrorCode && captureFailures.length) handoffErrorCode = captureFailures[0]!.errorCode;
  if (!handoffErrorCode && sourceListingCompatibility?.stage !== 'dual_read'
    && sourceListingCompatibility?.stage !== 'v2_only') {
    handoffErrorCode = 'SOURCE_LISTING_WORKFLOW_NOT_INTERACTIVE';
  }
  if (!handoffErrorCode && (draftFailures.length || draftRefs.length !== expectedSkus.length)) {
    handoffErrorCode = draftFailures[0]?.errorCode || 'SOURCE_LISTING_DRAFT_COVERAGE_INCOMPLETE';
  }
  if (!handoffErrorCode && new Set(draftRefs.map((draft) => draft.supplyGoodsId)).size !== draftRefs.length) {
    handoffErrorCode = 'SOURCE_LISTING_DRAFT_COVERAGE_AMBIGUOUS';
  }

  if (handoffErrorCode) {
    const failures = [
      ...captureFailures.map((failure) => ({
        supplyGoodsId: failure.supplyGoodsId,
        sku: failure.sku,
        errorCode: failure.errorCode,
      })),
      ...draftFailures,
    ];
    if (!failures.length) failures.push({ supplyGoodsId: '', errorCode: handoffErrorCode });
    const failedPayload = {
      ...basePayload,
      stage: 'review_handoff_failed',
      browserPayloadReady: true,
      browserPayloadComplete: true,
      browserOneClickReviewFailure: {
        errorCode: handoffErrorCode,
        failures,
        missingSkus,
        unknownSkus,
        duplicateSkus: rowsBySku.duplicates,
      },
      sourceListingWorkflow: sourceListingCompatibility
        ? sourceListingCompatibilityMetadata(sourceListingCompatibility)
        : null,
      sourceListingDraftRefs: [],
    };
    const updated = await persistBrowserOneClickPayload({
      job,
      expectedRevision: previousRevision,
      payload: failedPayload,
      status: 'FAILED',
      errorMessage: `ERP 审核草稿交接失败: ${handoffErrorCode}`,
      finishedAt: new Date(),
    });
    if (!updated) {
      return reply.status(409).send({
        code: 0,
        errorCode: 'browser_payload_conflict',
        terminal: false,
        msg: '商品数据已被另一个批次更新，请重新完成最终交接',
      });
    }
    return reply.status(409).send({
      code: 0,
      errorCode: handoffErrorCode,
      terminal: true,
      msg: '商品数据未能完整生成 ERP 审核草稿，任务已停止且不会发布',
      data: browserOneClickListingJobReceipt(updated),
    });
  }

  const handoff = browserOneClickV2Handoff({
    rollout: currentRollout,
    listingRolloutRevision: workflow.listing.revision,
    drafts: draftRefs,
    failures: [],
  });
  const payload = {
    ...basePayload,
    supplyGoodsIds: mergedSupplyGoodsIds,
    browserOneClickSkuGoodsIds: mergedSkuGoodsIds,
    collected: mergedSupplyGoodsIds.length,
    stage: 'review_required',
    browserPayloadReady: true,
    browserPayloadComplete: true,
    browserOneClickPublishHandoff: handoff,
    sourceListingWorkflow: sourceListingCompatibilityMetadata(sourceListingCompatibility!),
    sourceListingDraftRefs: draftRefs,
  };
  const updated = await persistBrowserOneClickPayload({
    job,
    expectedRevision: previousRevision,
    payload,
    status: 'RUNNING',
    errorMessage: null,
  });
  if (!updated) {
    return reply.status(409).send({
      code: 0,
      errorCode: 'browser_payload_conflict',
      terminal: false,
      msg: '商品数据已被另一个批次更新，请重新完成最终交接',
    });
  }
  return reply.send({
    code: 1,
    msg: '商品数据已提交，需在 ERP 草稿工作台完成审核后发布',
    data: browserOneClickListingJobReceipt(updated),
  });
}

export async function listingRoutes(app: FastifyInstance, options: ListingRoutesOptions = {}) {
  const featureFlags = options.featureFlags || sourceWorkflowFeatureFlags;
  const sourceListingWorkflowAdapter = options.sourceListingWorkflowAdapter
    || getDefaultLegacySourceListingWorkflowAdapter();
  const publisherRollout = options.publisherRollout;
  const sourceCaptureService = options.sourceCaptureService;
  const publisherParityObserver = options.publisherParityObserver;
  const publisherParityTimeoutMs = options.publisherParityTimeoutMs ?? 2_000;

  const evaluatePublisherRollout = (
    writerEntrypoint: OzonPublisherWriterEntrypoint,
    userId: string,
    shop: { id: string; platform: unknown },
  ) => publisherRollout?.evaluateWrite({
    writerEntrypoint,
    originChannel: 'DIRECT',
    context: {
      ownerUserId: userId,
      shopId: shop.id,
      platform: String(shop.platform || ''),
    },
  });

  const observePublisherParity = async (input: {
    decision: OzonPublisherEntrypointRolloutDecision;
    entrypoint: 'LISTING_BATCH' | 'LISTING_IMPORT_BY_SKU';
    userId: string;
    shopId: string;
    endpoint: '/v3/product/import' | '/v1/product/import-by-sku';
    items: unknown[];
    refs: SourceListingDraftIdentityRef[];
    itemTrace?: Array<{ ordinal: number; supplyGoodsId: string; sourceSkuAlias?: string }>;
  }) => {
    if (!input.decision.observeParity || !publisherParityObserver || input.refs.length === 0) return;
    const observation = publisherParityObserver.observe({
      ownerUserId: input.userId,
      shopId: input.shopId,
      rolloutRevision: input.decision.rolloutRevision,
      entrypoint: input.entrypoint,
      legacy: {
        endpoint: input.endpoint,
        payload: { items: input.items },
        ...(input.itemTrace ? { itemTrace: input.itemTrace } : {}),
      },
      drafts: input.refs.map(({ supplyGoodsId, draftId, draftVersion, revision }) => ({
        supplyGoodsId, draftId, draftVersion, revision,
      })),
    });
    await Promise.race<void>([
      observation.then(() => undefined, () => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, publisherParityTimeoutMs)),
    ]);
  };
  app.addHook('preHandler', authenticate);

  app.post('/batch', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = batchListSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { shopId, items } = parsed.data;

    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }
    if (shop.platform !== 'OZON') {
      return reply.send({ code: 0, msg: '暂只支持 OZON 批量上架' });
    }
    if (shop.status !== 'ACTIVE') {
      return reply.send({ code: 0, msg: '店铺状态异常，请先测试连接' });
    }
    if (!sourcePublishActorAllowed(request)) {
      return reply.status(403).send({
        code: 0,
        errorCode: 'source_publish_owner_required',
        msg: '仅店铺所有者可提交 Ozon 发布任务',
      });
    }
    const initialRollout = await evaluatePublisherRollout('LISTING_BATCH', userId, shop);
    if (initialRollout?.authority === 'BLOCKED' || initialRollout?.authority === 'V2') {
      return sendPublisherRolloutBlocked(reply, initialRollout);
    }
    if (!initialRollout && await enforceLegacySourceOzonPublish(request, reply, shop, featureFlags)) return;

    const compatibility = await resolveLegacySourceListingCompatibility({
      featureFlags,
      adapter: sourceListingWorkflowAdapter,
      ownerUserId: userId,
      actorUserId: String((request as any).user?.actorUserId || userId),
      shopId,
      platform: String(shop.platform || ''),
      supplyGoodsIds: items.map((item) => item.supplyGoodsId || '').filter(Boolean),
    });
    let draftRefs: SourceListingDraftIdentityRef[] = [];
    if (compatibility.stage !== 'off'
      || initialRollout?.observeParity
      || parsed.data.draftRefs !== undefined) {
      try {
        draftRefs = normalizeSourceListingDraftIdentityRefs(parsed.data.draftRefs);
        if (compatibility.stage !== 'off' || initialRollout?.observeParity) {
          const prepared = compatibility.drafts.map((draft) => ({
            supplyGoodsId: draft.supplyGoodsId,
            draftId: draft.draftId,
            draftVersion: draft.draftVersion,
            revision: draft.revision,
            selectedSkuKeys: draft.selectedSkuKeys || [],
          }));
          assertSourceListingDraftIdentity({ refs: draftRefs, prepared });
        }
      } catch (caught) {
        if (!(caught instanceof SourceListingDraftIdentityError)) throw caught;
        return reply.status(caught.statusCode).send({
          code: 0, errorCode: caught.code, msg: caught.message,
          rolloutRevision: compatibility.rolloutRevision,
        });
      }
    }

    const ozonItems = items.map((item) => ({
      offer_id: item.offerId,
      name: item.title,
      description: item.description || '',
      description_category_id: item.categoryId,
      type_id: item.typeId,
      currency_code: item.currency,
      price: String(item.price),
      old_price: String(item.oldPrice && item.oldPrice >= item.price ? item.oldPrice : Math.ceil(item.price * 1.2)),
      vat: '0',
      dimension_unit: 'mm',
      weight_unit: 'g',
      weight: item.weight,
      height: item.height,
      depth: item.depth,
      width: item.width,
      images: item.images,
      attributes: item.attributes?.map((a) => ({
        id: a.id,
        values: [{ value: a.value }],
      })) || [],
    }));

    if (initialRollout) {
      if (compatibility.rolloutRevision !== initialRollout.rolloutRevision) {
        return reply.status(409).send({
          code: 0,
          errorCode: 'ozon_publisher_rollout_revision_mismatch',
          msg: '发布策略版本已变化，请刷新后重试',
          rolloutRevision: initialRollout.rolloutRevision,
        });
      }
      await observePublisherParity({
        decision: initialRollout,
        entrypoint: 'LISTING_BATCH',
        userId,
        shopId,
        endpoint: '/v3/product/import',
        items: ozonItems,
        refs: draftRefs,
        itemTrace: items.map((item, ordinal) => ({
          ordinal,
          supplyGoodsId: item.supplyGoodsId || '',
          sourceSkuAlias: item.skuKey,
        })),
      });
      const currentRollout = await evaluatePublisherRollout('LISTING_BATCH', userId, shop);
      if (!currentRollout || !sameRolloutDecision(initialRollout, currentRollout)) {
        return reply.status(409).send({
          code: 0,
          errorCode: 'ozon_publisher_rollout_decision_changed',
          msg: '发布策略已变化，请重试',
        });
      }
      if (currentRollout.authority !== 'LEGACY') return sendPublisherRolloutBlocked(reply, currentRollout);
      if (draftRefs.length > 0) {
        const currentCompatibility = await resolveLegacySourceListingCompatibility({
          featureFlags,
          adapter: sourceListingWorkflowAdapter,
          ownerUserId: userId,
          actorUserId: String((request as any).user?.actorUserId || userId),
          shopId,
          platform: String(shop.platform || ''),
          supplyGoodsIds: items.map((item) => item.supplyGoodsId || '').filter(Boolean),
        });
        try {
          assertSourceListingDraftIdentity({
            refs: draftRefs,
            prepared: currentCompatibility.drafts.map((draft) => ({
              supplyGoodsId: draft.supplyGoodsId,
              draftId: draft.draftId,
              draftVersion: draft.draftVersion,
              revision: draft.revision,
              selectedSkuKeys: draft.selectedSkuKeys || [],
            })),
          });
        } catch (caught) {
          if (!(caught instanceof SourceListingDraftIdentityError)) throw caught;
          return reply.status(caught.statusCode).send({
            code: 0, errorCode: caught.code, msg: caught.message,
            rolloutRevision: currentCompatibility.rolloutRevision,
          });
        }
        return sendLegacyDraftPublisherRequired(
          reply,
          currentCompatibility.rolloutRevision,
        );
      }
    }

    if (draftRefs.length > 0) {
      return sendLegacyDraftPublisherRequired(reply, compatibility.rolloutRevision);
    }

    const client = new OzonClient({
      clientId: shop.clientId!,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });
    try {
      const result = await client.request<{ result: { task_id: number } }>(
        '/v3/product/import',
        { body: { items: ozonItems } },
      );

      await prisma.syncJob.create({
        data: {
          shopId,
          type: 'PRODUCT_PUSH',
          status: 'RUNNING',
          startedAt: new Date(),
          payload: {
            taskId: result.result.task_id,
            itemCount: items.length,
            draftRefs: parsed.data.draftRefs || null,
            sourceListingCompatibility: sourceListingCompatibilityMetadata(compatibility) as any,
          },
        },
      });
      void enqueueProductSyncAfterPublish(shopId, 'listing-batch');

      return reply.send({
        code: 1,
        msg: `已提交 ${items.length} 个商品到 OZON`,
        data: { taskId: result.result.task_id },
      });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `上架失败: ${e.message}` });
    }
  });

  app.post('/ozon/import-by-sku', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = directOzonImportBySkuSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { shopId, items } = parsed.data;
    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }
    if (shop.platform !== 'OZON') {
      return reply.send({ code: 0, msg: '暂只支持 OZON 直接上架' });
    }
    if (shop.status !== 'ACTIVE') {
      return reply.send({ code: 0, msg: '店铺状态异常，请先测试连接' });
    }
    if (!shop.clientId || !shop.apiKeyEncrypted) {
      return reply.send({ code: 0, msg: '店铺 API 配置不完整' });
    }
    if (!sourcePublishActorAllowed(request)) {
      return reply.status(403).send({
        code: 0,
        errorCode: 'source_publish_owner_required',
        msg: '仅店铺所有者可提交 Ozon 发布任务',
      });
    }
    const initialRollout = await evaluatePublisherRollout('LISTING_IMPORT_BY_SKU', userId, shop);
    if (initialRollout?.authority === 'BLOCKED' || initialRollout?.authority === 'V2') {
      return sendPublisherRolloutBlocked(reply, initialRollout);
    }
    if (!initialRollout && await enforceLegacySourceOzonPublish(request, reply, shop, featureFlags)) return;

    const compatibility = await resolveLegacySourceListingCompatibility({
      featureFlags,
      adapter: sourceListingWorkflowAdapter,
      ownerUserId: userId,
      actorUserId: String((request as any).user?.actorUserId || userId),
      shopId,
      platform: String(shop.platform || ''),
      supplyGoodsIds: items.map((item) => item.supplyGoodsId || '').filter(Boolean),
    });
    let draftRefs: SourceListingDraftIdentityRef[] = [];
    if (compatibility.stage !== 'off'
      || initialRollout?.observeParity
      || parsed.data.draftRefs !== undefined) {
      try {
        draftRefs = normalizeSourceListingDraftIdentityRefs(parsed.data.draftRefs);
        if (compatibility.stage !== 'off' || initialRollout?.observeParity) {
          const prepared = compatibility.drafts.map((draft) => ({
            supplyGoodsId: draft.supplyGoodsId,
            draftId: draft.draftId,
            draftVersion: draft.draftVersion,
            revision: draft.revision,
            selectedSkuKeys: draft.selectedSkuKeys || [],
          }));
          assertSourceListingDraftIdentity({ refs: draftRefs, prepared });
        }
      } catch (caught) {
        if (!(caught instanceof SourceListingDraftIdentityError)) throw caught;
        return reply.status(caught.statusCode).send({
          code: 0, errorCode: caught.code, msg: caught.message,
          rolloutRevision: compatibility.rolloutRevision,
        });
      }
    }

    const seenOfferIds = new Set<string>();
    const ozonItems = items.map((item) => {
      const sourceSku = String(item.sku);
      let offerId = String(item.offerId || '').trim() || randomOfferIdFrom(sourceSku);
      while (seenOfferIds.has(offerId)) offerId = randomOfferIdFrom(sourceSku);
      seenOfferIds.add(offerId);

      const price = buildDirectImportBySkuPrice({ price: item.price, oldPrice: item.oldPrice });
      return {
        sku: item.sku,
        name: buildDirectImportBySkuTitle({ title: item.title, sku: item.sku }),
        offer_id: offerId,
        price: price.price,
        old_price: price.oldPrice,
        currency_code: item.currency || 'CNY',
        vat: '0',
      };
    });

    if (initialRollout) {
      if (compatibility.rolloutRevision !== initialRollout.rolloutRevision) {
        return reply.status(409).send({
          code: 0,
          errorCode: 'ozon_publisher_rollout_revision_mismatch',
          msg: '发布策略版本已变化，请刷新后重试',
          rolloutRevision: initialRollout.rolloutRevision,
        });
      }
      await observePublisherParity({
        decision: initialRollout,
        entrypoint: 'LISTING_IMPORT_BY_SKU',
        userId,
        shopId,
        endpoint: '/v1/product/import-by-sku',
        items: ozonItems,
        refs: draftRefs,
        itemTrace: items.map((item, ordinal) => ({
          ordinal,
          supplyGoodsId: item.supplyGoodsId || '',
          sourceSkuAlias: String(item.sku),
        })),
      });
      const currentRollout = await evaluatePublisherRollout('LISTING_IMPORT_BY_SKU', userId, shop);
      if (!currentRollout || !sameRolloutDecision(initialRollout, currentRollout)) {
        return reply.status(409).send({
          code: 0,
          errorCode: 'ozon_publisher_rollout_decision_changed',
          msg: '发布策略已变化，请重试',
        });
      }
      if (currentRollout.authority !== 'LEGACY') return sendPublisherRolloutBlocked(reply, currentRollout);
      if (draftRefs.length > 0) {
        const currentCompatibility = await resolveLegacySourceListingCompatibility({
          featureFlags,
          adapter: sourceListingWorkflowAdapter,
          ownerUserId: userId,
          actorUserId: String((request as any).user?.actorUserId || userId),
          shopId,
          platform: String(shop.platform || ''),
          supplyGoodsIds: items.map((item) => item.supplyGoodsId || '').filter(Boolean),
        });
        try {
          assertSourceListingDraftIdentity({
            refs: draftRefs,
            prepared: currentCompatibility.drafts.map((draft) => ({
              supplyGoodsId: draft.supplyGoodsId,
              draftId: draft.draftId,
              draftVersion: draft.draftVersion,
              revision: draft.revision,
              selectedSkuKeys: draft.selectedSkuKeys || [],
            })),
          });
        } catch (caught) {
          if (!(caught instanceof SourceListingDraftIdentityError)) throw caught;
          return reply.status(caught.statusCode).send({
            code: 0, errorCode: caught.code, msg: caught.message,
            rolloutRevision: currentCompatibility.rolloutRevision,
          });
        }
        return sendLegacyDraftPublisherRequired(
          reply,
          currentCompatibility.rolloutRevision,
        );
      }
    }

    if (draftRefs.length > 0) {
      return sendLegacyDraftPublisherRequired(reply, compatibility.rolloutRevision);
    }

    const client = new OzonClient({
      clientId: shop.clientId,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });
    try {
      const result = await client.importBySku(ozonItems);
      const taskId = result.result.task_id;
      const unmatched = result.result.unmatched_sku_list || [];
      const job = await prisma.syncJob.create({
        data: {
          shopId,
          type: 'PRODUCT_PUSH',
          status: 'RUNNING',
          startedAt: new Date(),
          payload: {
            taskId,
            itemCount: ozonItems.length,
            source: parsed.data.source || 'backend-sku-follow',
            entry: parsed.data.entry || 'extension-workbench',
            mode: parsed.data.mode || 'follow-by-sku',
            sourceSkus: items.map((item) => String(item.sku)),
            draftRefs: parsed.data.draftRefs || null,
            sourceListingCompatibility: sourceListingCompatibilityMetadata(compatibility) as any,
            offerIds: ozonItems.map((item) => item.offer_id),
            unmatched,
            inputItems: items.map((item) => ({
              sku: String(item.sku),
              title: item.title || null,
              price: item.price ?? null,
              sourceUrl: item.sourceUrl || null,
              imageUrls: item.imageUrls || null,
              brand: item.brand || null,
              categoryPath: item.categoryPath || null,
              salesSchema: item.salesSchema || null,
              weightGrams: item.weightGrams ?? null,
              dimensionsText: item.dimensionsText || null,
              commissionRate: item.commissionRate ?? null,
              logisticsFeeCny: item.logisticsFeeCny ?? null,
              costCny: item.costCny ?? null,
              profitCny: item.profitCny ?? null,
              profitMarginPct: item.profitMarginPct ?? null,
              soldCount: item.soldCount ?? null,
              soldSum: item.soldSum ?? null,
              returnCancelRate: item.returnCancelRate ?? null,
              nullableRedemptionRate: item.nullableRedemptionRate ?? null,
              sellerCount: item.sellerCount ?? null,
              minFollowPriceRub: item.minFollowPriceRub ?? null,
              maxFollowPriceRub: item.maxFollowPriceRub ?? null,
              sellerNames: item.sellerNames || [],
              ozonMetrics: item.ozonMetrics || null,
            })),
          },
        },
        select: { id: true },
      });

      void enqueueProductSyncAfterPublish(shopId, 'backend-sku-follow');

      return reply.send({
        code: 1,
        msg: `已提交 ${ozonItems.length} 个 SKU 到 OZON`,
        data: {
          taskId,
          jobId: job.id,
          count: ozonItems.length,
          unmatched,
          offerIds: ozonItems.map((item) => item.offer_id),
        },
      });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `快速上架失败: ${e.message?.slice(0, 300) || '未知错误'}` });
    }
  });

  app.post('/browser-one-click-jobs', async (request, reply) => {
    return createBrowserOneClickListingJobForActor(
      request,
      reply,
      accountBrowserOneClickActor(request),
      { featureFlags, sourceListingWorkflowAdapter, sourceCaptureService, publisherRollout },
    );
  });

  app.patch('/browser-one-click-jobs/:id', async (request, reply) => {
    return patchBrowserOneClickListingJobForActor(
      request,
      reply,
      accountBrowserOneClickActor(request),
      { featureFlags, sourceListingWorkflowAdapter, sourceCaptureService, publisherRollout },
    );
  });

  app.get('/tasks', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { shopId?: string; offset?: string; limit?: string };

    const userShops = await prisma.shop.findMany({
      where: { userId },
      select: { id: true },
    });
    const shopIds = userShops.map((s) => s.id);

    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));

    const where: Record<string, unknown> = {
      shopId: query.shopId && shopIds.includes(query.shopId) ? query.shopId : { in: shopIds },
      type: 'PRODUCT_PUSH',
    };

    const [total, rows] = await Promise.all([
      prisma.syncJob.count({ where: where as any }),
      prisma.syncJob.findMany({
        where: where as any,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { shop: { select: { name: true, platform: true } } },
      }),
    ]);

    return {
      code: 1,
      msg: 'ok',
      data: { total, rows },
    };
  });

  app.get('/tasks/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const job = await prisma.syncJob.findFirst({
      where: { id, type: 'PRODUCT_PUSH' },
      include: { shop: { select: { userId: true, name: true, platform: true } } },
    });
    if (!job || job.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '任务不存在' });
    }

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        id: job.id,
        status: job.status,
        startedAt: job.startedAt,
        finishedAt: job.finishedAt,
        error: job.errorMessage,
        payload: job.payload,
        shopName: job.shop.name,
        platform: job.shop.platform,
      },
    });
  });

  app.post('/tasks/:id/refresh', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const result = await refreshListingProductPushJob(id, userId);
    if (result.statusCode) return reply.status(result.statusCode).send(result);
    return reply.send(result);
  });
  app.get('/categories', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as { shopId: string };

    if (!query.shopId) {
      return reply.status(400).send({ code: 0, msg: '请指定店铺' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: query.shopId, userId } });
    if (!shop || shop.platform !== 'OZON') {
      return reply.status(404).send({ code: 0, msg: '店铺不存在或非 OZON 平台' });
    }

    const client = new OzonClient({
      clientId: shop.clientId!,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });

    try {
      const categories = await client.getDescriptionCategoryTree();
      return reply.send({ code: 1, msg: 'ok', data: categories });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `获取分类失败: ${e.message}` });
    }
  });

  app.get('/category-attributes', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as { shopId: string; categoryId: string; typeId: string };

    if (!query.shopId || !query.categoryId || !query.typeId) {
      return reply.status(400).send({ code: 0, msg: '请指定店铺、分类ID和类型ID' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: query.shopId, userId } });
    if (!shop || shop.platform !== 'OZON') {
      return reply.status(404).send({ code: 0, msg: '店铺不存在或非 OZON 平台' });
    }

    const client = new OzonClient({
      clientId: shop.clientId!,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });

    try {
      const attributes = await client.getDescriptionCategoryAttributes({
        description_category_id: Number(query.categoryId),
        type_id: Number(query.typeId),
      });
      return reply.send({ code: 1, msg: 'ok', data: attributes });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `获取属性失败: ${e.message}` });
    }
  });
}

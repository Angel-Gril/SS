import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
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
import { addBrowserOneClickListingJob, appendBrowserOneClickListingRows } from '../workers/browser-one-click-listing.js';
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

export interface ListingRoutesOptions {
  featureFlags?: SourceWorkflowFeatureFlagEvaluator;
  sourceListingWorkflowAdapter?: LegacySourceListingWorkflowAdapter;
  publisherRollout?: OzonPublisherEntrypointRolloutService;
  publisherParityObserver?: OzonPublisherEntrypointParityObserver;
  publisherParityTimeoutMs?: number;
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

function sourcePublishActorAllowed(request: FastifyRequest): boolean {
  const user = (request as any).user || {};
  const actorUserId = String(user.actorUserId || user.userId || '');
  const ownerUserId = String(user.userId || '');
  return Boolean(ownerUserId)
    && actorUserId === ownerUserId
    && user.isSubAccount !== true
    && user.role !== 'STAFF';
}

async function enforceLegacySourceOzonPublish(
  request: FastifyRequest,
  reply: FastifyReply,
  shop: { id: string; userId?: string; platform: unknown },
  featureFlags: SourceWorkflowFeatureFlagEvaluator,
): Promise<boolean> {
  if (!sourcePublishActorAllowed(request)) {
    reply.status(403).send({
      code: 0,
      errorCode: 'source_publish_owner_required',
      msg: '仅店铺所有者可提交 Ozon 发布任务',
    });
    return true;
  }
  const ownerUserId = String(shop.userId || (request as any).user?.userId || '');
  try {
    await assertLegacySourceOzonPublishAllowed(featureFlags, {
      ownerUserId,
      shopId: shop.id,
      platform: String(shop.platform || ''),
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
  entry: z.string().trim().optional(),
  mode: z.string().trim().optional(),
  sourceSkus: z.array(z.union([z.string(), z.number()])).optional(),
  productUrls: z.array(z.string().trim()).optional(),
  rows: z.array(z.record(z.any())).optional(),
  itemCount: z.coerce.number().int().positive().optional(),
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

const BROWSER_ONE_CLICK_STAGE_STALE_MS = 15 * 60 * 1000;
const OZON_MARKING_CODE_REQUIRED_ATTR_ID = 23536;

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function rowSku(row: Record<string, any>): string {
  return String(row.sku || row.productId || '').trim();
}

function mergeRowsBySku(existingRows: Record<string, any>[], nextRows: Record<string, any>[]): Record<string, any>[] {
  const bySku = new Map<string, Record<string, any>>();
  for (const row of existingRows) {
    const sku = rowSku(row);
    if (sku) bySku.set(sku, row);
  }
  for (const row of nextRows) {
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

function positiveNumber(value: unknown): number | null {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function hasImage(row: Record<string, any>): boolean {
  const images = Array.isArray(row.images) ? row.images : [row.image, row.img, row.picture];
  return images.some((image) => String(image || '').trim());
}

function rowHasPublishCategory(row: Record<string, any>, publish: Record<string, any>): boolean {
  const categoryId = positiveNumber(publish.categoryId)
    ?? positiveNumber(row.descriptionCategoryId)
    ?? positiveNumber(row.description_category_id)
    ?? positiveNumber(row.categoryId)
    ?? positiveNumber(row.category3Id);
  const typeId = positiveNumber(publish.typeId)
    ?? positiveNumber(row.typeId)
    ?? positiveNumber(row.descriptionTypeId)
    ?? positiveNumber(row.description_type_id);
  return !!(categoryId && typeId);
}

function hasRecoverableBrowserPayloadRows(payload: Record<string, any>): boolean {
  const sourceSkus = stringList(payload.sourceSkus);
  if (!sourceSkus.length) return false;
  const rows = Array.isArray(payload.rows) ? payload.rows.map(objectRecord) : [];
  const rowEntries: Array<[string, Record<string, any>]> = [];
  for (const row of rows) {
    const sku = rowSku(row);
    if (sku) rowEntries.push([sku, row]);
  }
  const rowBySku = new Map<string, Record<string, any>>(rowEntries);
  const publish = objectRecord(payload.publish);
  return sourceSkus.every((sku) => {
    const row = rowBySku.get(sku);
    if (!row) return false;
    const title = String(row.title || row.name || '').trim();
    return !!title && hasImage(row) && rowHasPublishCategory(row, publish);
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
          await client.importProductPictures({ product_id: operation.productId, images: resolvedImages });
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

export async function listingRoutes(app: FastifyInstance, options: ListingRoutesOptions = {}) {
  const featureFlags = options.featureFlags || sourceWorkflowFeatureFlags;
  const sourceListingWorkflowAdapter = options.sourceListingWorkflowAdapter
    || getDefaultLegacySourceListingWorkflowAdapter();
  const publisherRollout = options.publisherRollout;
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
    if (compatibility.stage !== 'off' || initialRollout?.observeParity) {
      try {
        draftRefs = normalizeSourceListingDraftIdentityRefs(parsed.data.draftRefs);
        const prepared = compatibility.drafts.map((draft) => ({
          supplyGoodsId: draft.supplyGoodsId,
          draftId: draft.draftId,
          draftVersion: draft.draftVersion,
          revision: draft.revision,
          selectedSkuKeys: draft.selectedSkuKeys || [],
        }));
        assertSourceListingDraftIdentity({ refs: draftRefs, prepared });
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
      }
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
    if (compatibility.stage !== 'off' || initialRollout?.observeParity) {
      try {
        draftRefs = normalizeSourceListingDraftIdentityRefs(parsed.data.draftRefs);
        const prepared = compatibility.drafts.map((draft) => ({
          supplyGoodsId: draft.supplyGoodsId,
          draftId: draft.draftId,
          draftVersion: draft.draftVersion,
          revision: draft.revision,
          selectedSkuKeys: draft.selectedSkuKeys || [],
        }));
        assertSourceListingDraftIdentity({ refs: draftRefs, prepared });
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
      }
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
    const { userId } = (request as any).user;
    const parsed = browserOneClickJobSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { shopId } = parsed.data;
    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }
    if (shop.platform !== 'OZON') {
      return reply.send({ code: 0, msg: '暂只支持 OZON 一键上架任务' });
    }
    if (await enforceLegacySourceOzonPublish(request, reply, shop, featureFlags)) return;

    const sourceSkus = (parsed.data.sourceSkus || [])
      .map((sku) => String(sku || '').trim())
      .filter(Boolean);
    const productUrls = (parsed.data.productUrls || [])
      .map((url) => String(url || '').trim())
      .filter(Boolean);
    const rows = Array.isArray(parsed.data.rows) ? parsed.data.rows : [];
    const sourceListingCompatibility = await resolveLegacySourceListingCompatibility({
      featureFlags,
      adapter: sourceListingWorkflowAdapter,
      ownerUserId: userId,
      actorUserId: String((request as any).user?.actorUserId || userId),
      shopId,
      platform: String(shop.platform || ''),
      supplyGoodsIds: uniqueStrings(rows.flatMap((row) => [
        row.supplyGoodsId,
        row.goodsId,
      ])),
      legacyFallback: parsed.data.legacyWorkflowFallback,
    });
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
      ...(parsed.data.commissionRate !== undefined ? { commissionRate: parsed.data.commissionRate } : {}),
      ...(parsed.data.logisticsFeeCny !== undefined ? { logisticsFeeCny: parsed.data.logisticsFeeCny } : {}),
    };
    const itemCount = parsed.data.itemCount || sourceSkus.length || 1;
    const deferStart = parsed.data.deferStart === true;
    const draftRefs = sourceListingCompatibility.drafts.flatMap((draft) => {
      const row = rows.find((candidate) => (
        String(candidate.supplyGoodsId || candidate.goodsId || '').trim() === draft.supplyGoodsId
      ));
      const skuKey = row ? rowSku(row) : '';
      return skuKey && draft.selectedSkuKeys?.includes(skuKey) ? [{
        supplyGoodsId: draft.supplyGoodsId,
        draftId: draft.draftId,
        draftVersion: draft.draftVersion,
        revision: draft.revision,
        skuKey,
      }] : [];
    });
    const payload: Record<string, any> = {
      source: 'browser-one-click-listing',
      stage: deferStart ? 'preparing_browser_data' : 'submitted',
      entry: parsed.data.entry || 'extension-workbench',
      mode: parsed.data.mode || 'clone',
      itemCount,
      sourceSkus,
      productUrls,
      rows,
      publish,
      browserPayloadReady: !deferStart,
      submittedAt: new Date().toISOString(),
      sourceListingWorkflow: sourceListingCompatibilityMetadata(sourceListingCompatibility),
      sourceListingDraftRefs: draftRefs,
    };
    if (parsed.data.watermark) payload.watermark = parsed.data.watermark;

    const job = await prisma.syncJob.create({
      data: {
        shopId,
        type: 'PRODUCT_PUSH',
        status: 'RUNNING',
        startedAt: new Date(),
        payload,
      },
      select: { id: true },
    });
    if (!deferStart) {
      await addBrowserOneClickListingJob(job.id);
    }

    return reply.send({
      code: 1,
      msg: deferStart
        ? '上架任务已提交到 ERP 上架日志，浏览器正在补全商品数据'
        : '上架任务已提交到 ERP 上架日志，后台队列正在执行',
      data: { jobId: job.id, queued: !deferStart, deferred: deferStart },
    });
  });

  app.patch('/browser-one-click-jobs/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const parsed = browserOneClickJobPatchSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const job = await prisma.syncJob.findFirst({
      where: { id, type: 'PRODUCT_PUSH' },
      include: { shop: { select: { id: true, userId: true, platform: true } } },
    });
    if (!job || job.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '任务不存在' });
    }

    const nextStatus = parsed.data.status || job.status;
    const previousPayload = objectRecord(job.payload);
    const patchPayload = objectRecord(parsed.data.payload);
    let ingestResult: Awaited<ReturnType<typeof appendBrowserOneClickListingRows>> | null = null;
    if (
      previousPayload.source === 'browser-one-click-listing'
      && patchPayload.browserPayloadBatch === true
      && Array.isArray(patchPayload.rows)
      && patchPayload.rows.length
      && nextStatus !== 'FAILED'
    ) {
      ingestResult = await appendBrowserOneClickListingRows(job.id, patchPayload.rows.map(objectRecord));
    }
    const shouldStartDeferredJob = previousPayload.source === 'browser-one-click-listing'
      && previousPayload.browserPayloadReady === false
      && patchPayload.browserPayloadReady === true
      && nextStatus !== 'FAILED';
    const previousRows = Array.isArray(previousPayload.rows) ? previousPayload.rows.map(objectRecord) : [];
    const patchRows = Array.isArray(patchPayload.rows) ? patchPayload.rows.map(objectRecord) : [];
    const mergedRows = ingestResult ? ingestResult.rows : (patchRows.length ? mergeRowsBySku(previousRows, patchRows) : previousRows);
    const mergedSupplyGoodsIds = ingestResult
      ? ingestResult.supplyGoodsIds
      : uniqueStrings([...(Array.isArray(previousPayload.supplyGoodsIds) ? previousPayload.supplyGoodsIds : []), ...(Array.isArray(patchPayload.supplyGoodsIds) ? patchPayload.supplyGoodsIds : [])]);
    const mergedSkuGoodsIds = ingestResult
      ? ingestResult.skuGoodsIds
      : { ...objectRecord(previousPayload.browserOneClickSkuGoodsIds), ...objectRecord(patchPayload.browserOneClickSkuGoodsIds) };
    let sourceListingCompatibility: LegacySourceListingCompatibilityResult | null = null;
    if (previousPayload.source === 'browser-one-click-listing'
      && (mergedSupplyGoodsIds.length || shouldStartDeferredJob || (nextStatus === 'FAILED' && mergedRows.length))) {
      sourceListingCompatibility = await resolveLegacySourceListingCompatibility({
        featureFlags,
        adapter: sourceListingWorkflowAdapter,
        ownerUserId: userId,
        actorUserId: String((request as any).user?.actorUserId || userId),
        shopId: job.shop.id,
        platform: String(job.shop.platform || ''),
        supplyGoodsIds: mergedSupplyGoodsIds,
        legacyFallback: patchPayload.legacyWorkflowFallback === true
          || objectRecord(previousPayload.sourceListingWorkflow).legacyFallback === true,
      });
    }
    const basePayload = {
      ...previousPayload,
      ...patchPayload,
      ...(mergedRows.length ? { rows: mergedRows } : {}),
      ...(mergedSupplyGoodsIds.length ? { supplyGoodsIds: mergedSupplyGoodsIds, collected: mergedSupplyGoodsIds.length } : {}),
      ...(Object.keys(mergedSkuGoodsIds).length ? { browserOneClickSkuGoodsIds: mergedSkuGoodsIds } : {}),
      ...(ingestResult ? {
        browserPayloadIngest: {
          accepted: ingestResult.accepted,
          failed: ingestResult.failed,
          errors: ingestResult.errors,
          updatedAt: new Date().toISOString(),
        },
      } : {}),
      ...(sourceListingCompatibility ? {
        sourceListingWorkflow: sourceListingCompatibilityMetadata(sourceListingCompatibility),
      } : {}),
    };
    const failureMessage = String(parsed.data.errorMessage || previousPayload.browserPayloadLastError || '浏览器补全商品数据失败').slice(0, 260);
    const shouldRecoverBrowserPayloadFailure = previousPayload.source === 'browser-one-click-listing'
      && nextStatus === 'FAILED'
      && String(patchPayload.stage || '').trim() === 'collect_failed'
      && !previousPayload.taskId
      && hasRecoverableBrowserPayloadRows(basePayload);
    const requestedQueueTransition = shouldStartDeferredJob || shouldRecoverBrowserPayloadFailure;
    const shouldQueueBackendJob = requestedQueueTransition;
    if (shouldQueueBackendJob && !previousPayload.taskId) {
      if (await enforceLegacySourceOzonPublish(request, reply, job.shop, featureFlags)) return;
    }
    const payload = {
      ...basePayload,
      ...(shouldRecoverBrowserPayloadFailure ? {
        stage: 'submitted',
        browserPayloadReady: true,
        browserPayloadComplete: false,
        browserPayloadRetrying: false,
        browserPayloadRecoveredFromFailure: true,
        browserPayloadLastError: failureMessage,
      } : {}),
      ...(shouldQueueBackendJob ? { browserQueueStartedAt: new Date().toISOString() } : {}),
    };
    const effectiveStatus = shouldRecoverBrowserPayloadFailure ? 'RUNNING' : nextStatus;
    const updateData: Record<string, any> = {
      status: effectiveStatus,
      payload,
    };
    if ('result' in parsed.data) updateData.result = parsed.data.result ?? null;
    if (shouldRecoverBrowserPayloadFailure) {
      updateData.errorMessage = '浏览器补全商品数据暂时中断，ERP 已接管继续执行: ' + failureMessage;
    } else if ('errorMessage' in parsed.data) {
      updateData.errorMessage = parsed.data.errorMessage || null;
    }
    if (effectiveStatus === 'SUCCESS' || effectiveStatus === 'FAILED') updateData.finishedAt = new Date();

    const updated = await prisma.syncJob.update({
      where: { id: job.id },
      data: updateData,
      select: {
        id: true,
        status: true,
        finishedAt: true,
        payload: true,
      },
    });
    if (shouldQueueBackendJob) {
      await addBrowserOneClickListingJob(job.id);
    }

    return reply.send({
      code: 1,
      msg: 'ok',
      data: updated,
    });
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

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient } from '../services/ozon-client.js';
import { enqueueProductSyncAfterPublish } from '../services/post-publish-sync.js';
import { summarizeOzonImportItems } from '../services/ozon-import-status.js';
import { resolveImageUrls } from '../services/ozon-image-resolver.js';
import { resolveOzonProductImages } from '../services/product-sync-metadata.js';
import { planFallbackPictureUploads, recordPictureUploadDiagnostic } from './collect.js';
import { randomOfferIdFrom } from '../lib/randomize.js';
import { addBrowserOneClickListingJob } from '../workers/browser-one-click-listing.js';

const batchListSchema = z.object({
  shopId: z.string().min(1),
  items: z.array(z.object({
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
  source: z.string().optional(),
  entry: z.string().optional(),
  mode: z.string().optional(),
  items: z.array(z.object({
    sku: z.coerce.number().int().positive(),
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
});

const browserOneClickJobPatchSchema = z.object({
  status: z.enum(['PENDING', 'RUNNING', 'SUCCESS', 'FAILED']).optional(),
  payload: z.record(z.any()).optional(),
  result: z.any().optional(),
  errorMessage: z.string().trim().optional().nullable(),
});

const BROWSER_ONE_CLICK_STAGE_STALE_MS = 15 * 60 * 1000;

function objectRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function isBrowserOneClickStageStale(data: Record<string, any>): boolean {
  const stage = String(data.stage || '').trim();
  if (!['collecting', 'collected', 'watermarking', 'watermarked', 'publishing'].includes(stage)) return false;
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

export async function refreshListingProductPushJob(id: string, userId?: string): Promise<{
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

  const client = new OzonClient({
    clientId: job.shop.clientId!,
    apiKey: decrypt(job.shop.apiKeyEncrypted),
  });

  try {
    const info = await client.getImportInfo(Number(taskId));
    const { total, failed, allDone } = summarizeOzonImportItems(info.items);
    const payload = (job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload))
      ? job.payload as Record<string, any>
      : {};
    let nextPayload: Record<string, any> = {
      ...payload,
      itemCount: total,
      failedCount: failed,
      items: info.items,
    };
    let pictureErrorMessage: string | null = null;

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

    const newStatus = allDone ? (failed === total ? 'FAILED' : 'SUCCESS') : 'RUNNING';
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
    const errorMessage = pictureErrorMessage || (failed > 0 ? `${failed} 个商品上架失败` : null);

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

export async function listingRoutes(app: FastifyInstance) {
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

    const client = new OzonClient({
      clientId: shop.clientId!,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });

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
          payload: { taskId: result.result.task_id, itemCount: items.length },
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

    const client = new OzonClient({
      clientId: shop.clientId,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });

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

    const sourceSkus = (parsed.data.sourceSkus || [])
      .map((sku) => String(sku || '').trim())
      .filter(Boolean);
    const productUrls = (parsed.data.productUrls || [])
      .map((url) => String(url || '').trim())
      .filter(Boolean);
    const rows = Array.isArray(parsed.data.rows) ? parsed.data.rows : [];
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
    const payload: Record<string, any> = {
      source: 'browser-one-click-listing',
      stage: 'submitted',
      entry: parsed.data.entry || 'extension-workbench',
      mode: parsed.data.mode || 'clone',
      itemCount,
      sourceSkus,
      productUrls,
      rows,
      publish,
      submittedAt: new Date().toISOString(),
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
    await addBrowserOneClickListingJob(job.id);

    return reply.send({
      code: 1,
      msg: '上架任务已提交到 ERP 上架日志，后台队列正在执行',
      data: { jobId: job.id, queued: true },
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
      include: { shop: { select: { userId: true } } },
    });
    if (!job || job.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '任务不存在' });
    }

    const nextStatus = parsed.data.status || job.status;
    const payload = {
      ...objectRecord(job.payload),
      ...objectRecord(parsed.data.payload),
    };
    const updateData: Record<string, any> = {
      status: nextStatus,
      payload,
    };
    if ('result' in parsed.data) updateData.result = parsed.data.result ?? null;
    if ('errorMessage' in parsed.data) updateData.errorMessage = parsed.data.errorMessage || null;
    if (nextStatus === 'SUCCESS' || nextStatus === 'FAILED') updateData.finishedAt = new Date();

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

    const job = await prisma.syncJob.findFirst({
      where: { id, type: 'PRODUCT_PUSH' },
      include: { shop: true },
    });
    if (!job || job.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '任务不存在' });
    }

    const taskId = (job.payload as any)?.taskId;
    if (!taskId) {
      return reply.send({ code: 0, msg: missingTaskIdMessage(job.payload) });
    }

    const client = new OzonClient({
      clientId: job.shop.clientId!,
      apiKey: decrypt(job.shop.apiKeyEncrypted),
    });

    try {
      const info = await client.getImportInfo(Number(taskId));
      const { total, failed, allDone } = summarizeOzonImportItems(info.items);
      const payload = (job.payload && typeof job.payload === 'object' && !Array.isArray(job.payload))
        ? job.payload as Record<string, any>
        : {};
      let nextPayload: Record<string, any> = {
        ...payload,
        itemCount: total,
        failedCount: failed,
        items: info.items,
      };
      let pictureErrorMessage: string | null = null;

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

      const newStatus = allDone ? (failed === total ? 'FAILED' : 'SUCCESS') : 'RUNNING';
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
      const errorMessage = pictureErrorMessage || (failed > 0 ? `${failed} 个商品上架失败` : null);

      const updated = await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: finalStatus,
          finishedAt: allDone && finalStatus !== 'RUNNING' ? new Date() : null,
          payload: nextPayload,
          errorMessage,
        },
      });

      return reply.send({
        code: 1,
        msg: 'ok',
        data: {
          id: updated.id,
          status: updated.status,
          finishedAt: updated.finishedAt,
          payload: updated.payload,
        },
      });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `刷新失败: ${e.message}` });
    }
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

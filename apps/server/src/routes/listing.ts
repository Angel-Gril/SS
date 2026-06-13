import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient } from '../services/ozon-client.js';
import { enqueueProductSyncAfterPublish } from '../services/post-publish-sync.js';
import { summarizeOzonImportItems } from '../services/ozon-import-status.js';
import { resolveImageUrls } from '../services/ozon-image-resolver.js';
import { planFallbackPictureUploads, recordPictureUploadDiagnostic } from './collect.js';

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

function isFallbackPictureUploadJob(payload: Record<string, any>): boolean {
  return payload.source === 'collect-publish-fallback' || payload.mode === 'follow-by-sku';
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
  status: 'pending' | 'success' | 'failed';
  failedCount: number;
  skippedCount: number;
  pendingCount: number;
  errorMessage: string | null;
} {
  const diagnostics = Array.isArray(diagnosticsInput) ? diagnosticsInput as any[] : [];
  const failedCount = diagnostics.filter((entry) => entry?.status === 'failed').length;
  const skippedCount = diagnostics.filter((entry) => entry?.status === 'skipped').length;
  if (failedCount || skippedCount) {
    return {
      status: 'failed',
      failedCount,
      skippedCount,
      pendingCount,
      errorMessage: `图片补传未完成：失败 ${failedCount} 个，缺图 ${skippedCount} 个`,
    };
  }
  if (pendingCount > 0) {
    return {
      status: 'pending',
      failedCount,
      skippedCount,
      pendingCount,
      errorMessage: `图片补传等待 OZON 生成 product_id：剩余 ${pendingCount} 个`,
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
      return reply.send({ code: 0, msg: '任务缺少 taskId' });
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

      if (isFallbackPictureUploadJob(payload)) {
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

      const newStatus = allDone ? (failed === total ? 'FAILED' : 'SUCCESS') : 'RUNNING';
      const finalStatus = pictureErrorMessage
        ? (allDone && nextPayload.pictureUploadStatus === 'failed' ? 'FAILED' : 'RUNNING')
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

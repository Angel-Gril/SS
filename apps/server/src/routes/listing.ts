import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient } from '../services/ozon-client.js';

const batchListSchema = z.object({
  shopId: z.string().min(1),
  source: z.enum(['1688-listing', 'manual-batch']).optional(),
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
    sourceTrace: z.record(z.unknown()).optional(),
  })).min(1).max(100),
});

const listingTaskEntrySchema = z.enum(['1688-listing', 'listing-page', 'collect-page', 'manual-batch']);
const DOMESTIC_SUPPLY_SOURCE_PLATFORMS = new Set(['1688', 'taobao', 'tmall', 'jd', 'pinduoduo', 'pdd']);

type ListingImportItem = {
  offer_id?: string | null;
  product_id?: number | string | null;
  status?: string | null;
  errors?: Array<{
    code?: string | null;
    state?: string | null;
    level?: string | null;
    description?: string | null;
    field?: string | null;
  }> | null;
};

type ListingResultStatus = 'submitted' | 'pending' | 'imported' | 'partial_failed' | 'failed';

function traceText(source: Record<string, unknown>, key: string) {
  return String(source[key] || '').trim();
}

function traceSourcePlatform(source: Record<string, unknown>) {
  const sourcePlatform = traceText(source, 'sourcePlatform').toLowerCase();
  return DOMESTIC_SUPPLY_SOURCE_PLATFORMS.has(sourcePlatform) ? sourcePlatform : '';
}

function safeMetadata(metadata: unknown) {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? { ...(metadata as Record<string, any>) }
    : {};
}

function normalizeImportStatus(status: unknown) {
  return String(status || '').trim().toLowerCase();
}

function isImportedStatus(status: unknown) {
  return normalizeImportStatus(status) === 'imported';
}

function isFailedStatus(status: unknown) {
  return normalizeImportStatus(status) === 'failed';
}

function isPendingStatus(status: unknown) {
  const normalized = normalizeImportStatus(status);
  return normalized !== 'imported' && normalized !== 'failed';
}

export function getListingResultStatus(importItems: ListingImportItem[]): ListingResultStatus {
  const imported = importItems.filter((item) => isImportedStatus(item.status)).length;
  const failed = importItems.filter((item) => isFailedStatus(item.status)).length;
  const pending = importItems.filter((item) => isPendingStatus(item.status)).length;

  if (pending > 0) return 'pending';
  if (failed > 0 && imported > 0) return 'partial_failed';
  if (failed > 0) return 'failed';
  if (imported > 0) return 'imported';
  return 'submitted';
}

function compactImportErrors(errors: ListingImportItem['errors']) {
  if (!Array.isArray(errors)) return [];
  return errors.slice(0, 5).map((error) => ({
    code: String(error?.code || '').slice(0, 120),
    state: String(error?.state || '').slice(0, 120),
    level: String(error?.level || '').slice(0, 120),
    field: String(error?.field || '').slice(0, 120),
    description: String(error?.description || '').replace(/\s+/g, ' ').slice(0, 500),
  }));
}

function compactImportResultItem(source: Record<string, unknown>, importItem: ListingImportItem | undefined) {
  return {
    offerId: traceText(source, 'offerId'),
    productId: importItem?.product_id != null ? String(importItem.product_id) : null,
    status: normalizeImportStatus(importItem?.status) || 'pending',
    sourcePlatform: traceSourcePlatform(source) || null,
    sourceProductId: traceText(source, 'sourceProductId') || null,
    sourceSkuId: traceText(source, 'sourceSkuId') || null,
    ozonSku: traceText(source, 'ozonSku') || null,
    ozonProductId: traceText(source, 'ozonProductId') || null,
    ozonOfferId: traceText(source, 'ozonOfferId') || null,
    errors: compactImportErrors(importItem?.errors),
  };
}

function prioritizeStoredResultItems(items: Array<ReturnType<typeof compactImportResultItem>>) {
  return items
    .map((item, index) => ({
      item,
      index,
      rank: isFailedStatus(item.status) ? 0 : isPendingStatus(item.status) ? 1 : 2,
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, 100)
    .map(({ item }) => item);
}

export function buildAlibaba1688ListingResultUpdates(params: {
  payload: unknown;
  importItems: ListingImportItem[];
  taskId: number;
  listingJobId: string;
  shopId: string;
  refreshedAt: string;
}) {
  const payload = safeMetadata(params.payload);
  const listingSources = Array.isArray(payload.listingSources)
    ? payload.listingSources.filter((source): source is Record<string, unknown> => (
      !!source && typeof source === 'object' && !Array.isArray(source)
    ))
    : [];
  const importByOfferId = new Map(
    params.importItems
      .map((item) => [String(item.offer_id || '').trim(), item] as const)
      .filter(([offerId]) => !!offerId),
  );
  const grouped = new Map<string, Record<string, unknown>[]>();

  for (const source of listingSources) {
    const supplyGoodsId = traceText(source, 'supplyGoodsId');
    const offerId = traceText(source, 'offerId');
    if (!supplyGoodsId || !offerId) continue;
    const sources = grouped.get(supplyGoodsId) || [];
    sources.push(source);
    grouped.set(supplyGoodsId, sources);
  }

  return Array.from(grouped.entries()).map(([supplyGoodsId, sources]) => {
    const allResultItems = sources
      .map((source) => compactImportResultItem(source, importByOfferId.get(traceText(source, 'offerId'))));
    const importedCount = allResultItems.filter((item) => isImportedStatus(item.status)).length;
    const failedCount = allResultItems.filter((item) => isFailedStatus(item.status)).length;
    const pendingCount = allResultItems.filter((item) => isPendingStatus(item.status)).length;
    const offerIds = Array.from(new Set(allResultItems.map((item) => item.offerId).filter(Boolean)));
    const resultStatus = getListingResultStatus(allResultItems);

    return {
      supplyGoodsId,
      taskId: params.taskId,
      listingJobId: params.listingJobId,
      shopId: params.shopId,
      refreshedAt: params.refreshedAt,
      resultStatus,
      importedCount,
      failedCount,
      pendingCount,
      offerIds,
      resultItems: prioritizeStoredResultItems(allResultItems),
    };
  });
}

export function applyAlibaba1688ListingResultMetadata(
  metadata: unknown,
  update: ReturnType<typeof buildAlibaba1688ListingResultUpdates>[number],
) {
  const meta = safeMetadata(metadata);
  const history = Array.isArray(meta.listingTasks) ? meta.listingTasks : [];
  const taskResult = {
    taskId: update.taskId,
    listingJobId: update.listingJobId,
    shopId: update.shopId,
    offerIds: update.offerIds,
    refreshedAt: update.refreshedAt,
    resultStatus: update.resultStatus,
    importedCount: update.importedCount,
    failedCount: update.failedCount,
    pendingCount: update.pendingCount,
    resultItems: update.resultItems,
  };
  const hasExistingTask = history.some((task: any) => Number(task?.taskId) === update.taskId);
  const listingTasks = hasExistingTask
    ? history.map((task: any) => (
      Number(task?.taskId) === update.taskId ? { ...task, ...taskResult } : task
    ))
    : [taskResult, ...history];

  return {
    ...meta,
    listingStatus: update.resultStatus,
    lastListingTaskId: update.taskId,
    lastListingJobId: update.listingJobId,
    lastListingShopId: update.shopId,
    lastListingOfferIds: update.offerIds,
    lastListingRefreshedAt: update.refreshedAt,
    lastListingResultStatus: update.resultStatus,
    lastListingFailedCount: update.failedCount,
    lastListingImportedCount: update.importedCount,
    lastListingPendingCount: update.pendingCount,
    lastListingResultItems: update.resultItems,
    listingTasks: listingTasks.slice(0, 10),
  };
}

export function appendListingTaskHistory(
  metadata: unknown,
  task: {
    taskId: number;
    listingJobId: string;
    shopId: string;
    offerIds: string[];
    submittedAt: string;
  },
) {
  const meta = safeMetadata(metadata);
  const history = Array.isArray(meta.listingTasks) ? meta.listingTasks : [];
  return {
    ...meta,
    listingStatus: 'submitted',
    lastListingTaskId: task.taskId,
    lastListingJobId: task.listingJobId,
    lastListingShopId: task.shopId,
    lastListingOfferIds: task.offerIds,
    lastListingSubmittedAt: task.submittedAt,
    lastListingResultStatus: 'submitted',
    lastListingFailedCount: 0,
    lastListingImportedCount: 0,
    lastListingPendingCount: 0,
    lastListingRefreshedAt: null,
    lastListingResultItems: [],
    listingTasks: [task, ...history].slice(0, 10),
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

    const { shopId, items, source = 'manual-batch' } = parsed.data;

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
      const listingSources = items.flatMap((item) => (
        item.sourceTrace ? [{ ...(item.sourceTrace as Record<string, unknown>), offerId: item.offerId }] : []
      ));
      const traceValues = (key: string) => Array.from(new Set(
        listingSources
          .map((source) => key === 'sourcePlatform' ? traceSourcePlatform(source) : traceText(source, key))
          .filter(Boolean),
      ));
      const sourceSkus = traceValues('sourceSkuId');
      const sourcePlatforms = traceValues('sourcePlatform');
      const ozonSkus = traceValues('ozonSku');
      const ozonProductIds = traceValues('ozonProductId');
      const ozonOfferIds = traceValues('ozonOfferId');
      const offerIds = items.map((item) => item.offerId);
      const offerImages = Object.fromEntries(
        items
          .map((item) => [item.offerId, item.images[0]] as const)
          .filter((entry): entry is readonly [string, string] => !!entry[1]),
      );

      const syncJob = await prisma.syncJob.create({
        data: {
          shopId,
          type: 'PRODUCT_PUSH',
          status: 'RUNNING',
          startedAt: new Date(),
          payload: {
            taskId: result.result.task_id,
            itemCount: items.length,
            entry: source,
            mode: source === '1688-listing' ? '1688' : 'batch',
            sourceSkus,
            sourcePlatforms,
            ozonSkus,
            ozonProductIds,
            ozonOfferIds,
            offerIds,
            offerImages,
            listingSources,
          } as any,
        },
      });
      if (source === '1688-listing') {
        const submittedAt = new Date().toISOString();
        const sourcesBySupplyGoodsId = new Map<string, Record<string, unknown>[]>();
        for (const trace of listingSources) {
          const supplyGoodsId = traceText(trace, 'supplyGoodsId');
          if (!supplyGoodsId) continue;
          const list = sourcesBySupplyGoodsId.get(supplyGoodsId) || [];
          list.push(trace);
          sourcesBySupplyGoodsId.set(supplyGoodsId, list);
        }

        const supplyGoodsIds = Array.from(sourcesBySupplyGoodsId.keys());
        if (supplyGoodsIds.length) {
          const goods = await prisma.supplyGoods.findMany({
            where: { id: { in: supplyGoodsIds }, userId },
            select: { id: true, metadata: true },
          });
          await Promise.all(goods.map((item) => {
            const traces = sourcesBySupplyGoodsId.get(item.id) || [];
            const itemOfferIds = Array.from(new Set(
              traces.map((trace) => traceText(trace, 'offerId')).filter(Boolean),
            ));
            return prisma.supplyGoods.update({
              where: { id: item.id },
              data: {
                status: 'listed',
                metadata: appendListingTaskHistory(item.metadata, {
                  taskId: result.result.task_id,
                  listingJobId: syncJob.id,
                  shopId,
                  offerIds: itemOfferIds,
                  submittedAt,
                }) as any,
              },
            });
          }));
        }
      }

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
    const query = request.query as { shopId?: string; offset?: string; limit?: string; entry?: string };

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
    const entry = listingTaskEntrySchema.safeParse(query.entry);
    if (entry.success) {
      where.payload = { path: ['entry'], equals: entry.data };
    }

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
      const total = info.items.length;
      const failed = info.items.filter((i) => isFailedStatus(i.status)).length;
      const imported = info.items.filter((i) => isImportedStatus(i.status)).length;
      const pending = info.items.filter((i) => isPendingStatus(i.status)).length;
      const allDone = pending === 0;

      const newStatus = allDone ? (total > 0 && failed === total ? 'FAILED' : 'SUCCESS') : 'RUNNING';
      const refreshedAt = new Date().toISOString();
      const nextPayload = {
        ...(job.payload as any),
        itemCount: total,
        failedCount: failed,
        importedCount: imported,
        pendingCount: pending,
        resultStatus: getListingResultStatus(info.items),
        lastRefreshedAt: refreshedAt,
        items: info.items,
      };

      const updated = await prisma.syncJob.update({
        where: { id: job.id },
        data: {
          status: newStatus,
          finishedAt: allDone ? new Date() : null,
          payload: nextPayload,
          errorMessage: failed > 0 ? `${failed} 个商品上架失败` : null,
        },
      });
      if ((job.payload as any)?.entry === '1688-listing') {
        const resultUpdates = buildAlibaba1688ListingResultUpdates({
          payload: nextPayload,
          importItems: info.items,
          taskId: Number(taskId),
          listingJobId: job.id,
          shopId: job.shopId,
          refreshedAt,
        });

        if (resultUpdates.length) {
          const supplyGoodsIds = resultUpdates.map((item) => item.supplyGoodsId);
          const resultBySupplyGoodsId = new Map(resultUpdates.map((item) => [item.supplyGoodsId, item] as const));
          const goods = await prisma.supplyGoods.findMany({
            where: { id: { in: supplyGoodsIds }, userId },
            select: { id: true, metadata: true },
          });

          await Promise.all(goods.map((item) => {
            const resultUpdate = resultBySupplyGoodsId.get(item.id);
            if (!resultUpdate) return null;
            return prisma.supplyGoods.update({
              where: { id: item.id },
              data: {
                status: resultUpdate.resultStatus === 'failed' ? 'listing_failed' : 'listed',
                metadata: applyAlibaba1688ListingResultMetadata(item.metadata, resultUpdate) as any,
              },
            });
          }));
        }
      }

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

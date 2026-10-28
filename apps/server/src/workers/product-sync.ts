import { Queue, Worker } from 'bullmq';
import type { Prisma } from '@prisma/client';
import { redisDisabled } from '../lib/redis.js';
import { connection } from '../lib/bullmq-connection.js';
import { registerWorker } from '../lib/worker-registry.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient } from '../services/ozon-client.js';
import {
  buildProductSyncMeta,
  getProductSyncCategory,
  mergeProductOzonPriceMeta,
  normalizeOzonSku,
  resolveOzonPackageWeightG,
  resolveOzonProductImages,
  resolveOzonSalesCommissionPercent,
} from '../services/product-sync-metadata.js';
import type { ProductSyncJobOptions } from '../services/post-publish-sync.js';
import { getMissingPlatformProductIds, parseOzonDate } from '../services/product-sync-state.js';
import { upsertSyncedOzonProduct } from '../services/product-sync-upsert.js';

const QUEUE_NAME = 'product-sync';

export const productSyncQueue: Queue | null = redisDisabled ? null : new Queue(QUEUE_NAME, { connection });

export async function addProductSyncJob(shopId: string, options: ProductSyncJobOptions = {}) {
  const syncJobId = options.syncJobId || await createPendingSyncJob(shopId, options);
  if (redisDisabled) {
    // Redis 不在时直接同步执行，避免前端转圈
    const run = () => {
      runProductSyncInline(shopId, syncJobId).catch((e) => {
        console.error(`[ProductSync inline] shop ${shopId} failed:`, e.message);
      });
    };
    if (options.delayMs && options.delayMs > 0) setTimeout(run, options.delayMs);
    else run();
    return { id: 'inline-' + Date.now(), syncJobId };
  }
  try {
    const job = await productSyncQueue!.add('sync', { shopId, syncJobId }, {
      delay: options.delayMs,
      jobId: options.jobId,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 20,
    });
    return { id: job.id, syncJobId };
  } catch (e: any) {
    await markSyncJobFailed(syncJobId, e);
    throw e;
  }
}

async function runProductSyncInline(shopId: string, syncJobId?: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.status !== 'ACTIVE') {
    throw new Error(`Shop ${shopId} not found or inactive`);
  }
  const runId = syncJobId || await createPendingSyncJob(shopId, {});
  await markSyncJobRunning(runId);
  try {
    const totalSynced = await syncProductsCore(shopId, shop);
    await prisma.syncJob.update({
      where: { id: runId },
      data: { status: 'SUCCESS', finishedAt: new Date(), result: { totalSynced } },
    });
  } catch (e: any) {
    await markSyncJobFailed(runId, e);
    throw e;
  }
}

async function syncProductsCore(shopId: string, shop: any): Promise<number> {
  const client = new OzonClient({
    clientId: shop.clientId!,
    apiKey: decrypt(shop.apiKeyEncrypted),
  });

  let lastId = '';
  let totalSynced = 0;
  const batchSize = 100;
  const syncStartedAt = new Date();
  const syncedPlatformProductIds = new Set<string>();

  while (true) {
    const list = await client.getProductList({ last_id: lastId || undefined, limit: batchSize });
    if (!list.items.length) break;

    const productIds = list.items.map((i) => i.product_id);
    const details = await client.getProductInfoList(productIds);
    const attributesByProductId = new Map<string, any>();
    try {
      const attributes = await client.getProductInfoAttributes({
        product_id: productIds.map(String),
        limit: productIds.length,
      });
      for (const item of attributes) {
        attributesByProductId.set(String(item.id), item);
      }
    } catch (e: any) {
      console.warn(`[ProductSync] Product attribute image sync failed for shop ${shopId}:`, e.message?.slice(0, 200));
    }
    const stockDetailsByProductId = new Map<string, any[]>();
    try {
      const stockDetails = await client.getProductStocks(productIds);
      for (const item of stockDetails) {
        stockDetailsByProductId.set(String(item.product_id), item.stocks || []);
      }
    } catch (e: any) {
      console.warn(`[ProductSync] Warehouse stock detail sync failed for shop ${shopId}:`, e.message?.slice(0, 200));
    }

    for (const info of details) {
      syncedPlatformProductIds.add(String(info.id));
      const warehouseStocks = stockDetailsByProductId.get(String(info.id)) || [];
      const totalStock = warehouseStocks.length
        ? warehouseStocks.reduce((sum, s) => sum + (Number(s.present) || 0) + (Number(s.reserved) || 0), 0)
        : info.stocks?.stocks?.reduce((sum, s) => sum + s.present, 0) ?? 0;
      const modelId = info.model_info?.model_id ? String(info.model_info.model_id) : null;
      const productAttributes = attributesByProductId.get(String(info.id));
      const description = info.description || productAttributes?.attributes?.find((attribute: { id: number }) => attribute.id === 4191)?.values?.map((value: { value?: string }) => value.value || '').filter(Boolean).join('\n') || null;
      const images = resolveOzonProductImages(info, productAttributes);
      const weight = resolveOzonPackageWeightG(productAttributes);
      const ozonSku = normalizeOzonSku(info.sku);
      const syncMeta = buildProductSyncMeta({
        ...info,
        description_category_id: info.description_category_id || productAttributes?.description_category_id,
        type_id: info.type_id || productAttributes?.type_id,
      }, warehouseStocks);
      const syncCategory = getProductSyncCategory(syncMeta);
      const platformProductId = String(info.id);
      await upsertSyncedOzonProduct({
        product: prisma.product,
        shopId,
        platformProductId,
        offerId: info.offer_id,
        create: {
          shopId,
          platformProductId,
          sku: ozonSku,
          offerId: info.offer_id,
          title: info.name,
          description: description || '',
          attributes: productAttributes?.attributes ?? undefined,
          categoryId: syncCategory ? String(syncCategory.descriptionCategoryId) : null,
          price: info.price ? parseFloat(info.price) : null,
          oldPrice: info.old_price ? parseFloat(info.old_price) : null,
          currency: info.currency_code || 'RUB',
          stock: totalStock,
          weight,
          images,
          modelId,
          status: info.statuses?.status || null,
          visibility: info.is_archived ? 'ARCHIVED' : info.stocks?.has_stock ? 'VISIBLE' : 'HIDDEN',
          variants: syncMeta as any,
          syncStatus: 'SYNCED',
          ozonCreatedAt: parseOzonDate(info.created_at),
          ozonUpdatedAt: parseOzonDate(info.updated_at),
          lastOzonSyncAt: syncStartedAt,
        },
        update: {
          sku: ozonSku,
          title: info.name,
          description: description ?? undefined,
          attributes: productAttributes?.attributes ?? undefined,
          categoryId: syncCategory ? String(syncCategory.descriptionCategoryId) : undefined,
          price: info.price ? parseFloat(info.price) : null,
          oldPrice: info.old_price ? parseFloat(info.old_price) : null,
          currency: info.currency_code || 'RUB',
          stock: totalStock,
          weight: weight ?? undefined,
          images,
          modelId,
          status: info.statuses?.status || null,
          visibility: info.is_archived ? 'ARCHIVED' : info.stocks?.has_stock ? 'VISIBLE' : 'HIDDEN',
          variants: syncMeta as any,
          syncStatus: 'SYNCED',
          ozonCreatedAt: parseOzonDate(info.created_at),
          ozonUpdatedAt: parseOzonDate(info.updated_at),
          lastOzonSyncAt: syncStartedAt,
        },
      });
      totalSynced++;
    }

    lastId = list.last_id;
    if (list.items.length < batchSize) break;
    await sleep(1000);
  }

  const localProducts = await prisma.product.findMany({
    where: { shopId, platformProductId: { not: null } },
    select: { platformProductId: true },
  });
  const missingPlatformProductIds = getMissingPlatformProductIds(
    localProducts.map((p) => p.platformProductId),
    syncedPlatformProductIds,
  );
  if (missingPlatformProductIds.length) {
    await prisma.product.updateMany({
      where: { shopId, platformProductId: { in: missingPlatformProductIds } },
      data: {
        visibility: 'MISSING',
        syncStatus: 'MISSING',
        status: 'missing',
        stock: 0,
        lastOzonSyncAt: syncStartedAt,
      },
    });
  }

  await prisma.shop.update({
    where: { id: shopId },
    data: { lastSyncAt: new Date() },
  });

  // Sync commission rates after product sync
  try {
    const allProducts = await prisma.product.findMany({
      where: { shopId, platformProductId: { in: Array.from(syncedPlatformProductIds) } },
      select: { id: true, platformProductId: true, variants: true },
    });
    const allProductIds = allProducts.map((p) => Number(p.platformProductId));
    const priceBatchSize = 1000;
    for (let i = 0; i < allProductIds.length; i += priceBatchSize) {
      const batch = allProductIds.slice(i, i + priceBatchSize);
      const priceItems = await client.getProductPrices(batch);
      for (const item of priceItems) {
        const product = allProducts.find((p) => Number(p.platformProductId) === item.product_id);
        if (!product) continue;
        const commissionRate = resolveOzonSalesCommissionPercent(item);
        const minPriceValue = Number(item.price?.min_price);
        const minPrice = Number.isFinite(minPriceValue) && minPriceValue > 0 ? minPriceValue : null;
        await prisma.product.update({
          where: { id: product.id },
          data: {
            commissionRate: commissionRate != null ? commissionRate : undefined,
            minPrice: minPrice != null ? minPrice : undefined,
            variants: mergeProductOzonPriceMeta(product.variants, item) as Prisma.InputJsonValue,
          },
        });
      }
      await sleep(500);
    }
  } catch (e: any) {
    console.error(`[ProductSync] Commission sync error for shop ${shopId}:`, e.message);
  }

  return totalSynced;
}

export function startProductSyncWorker() {
  if (redisDisabled) return null;
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { shopId, syncJobId } = job.data;
      const shop = await prisma.shop.findUnique({ where: { id: shopId } });
      if (!shop || shop.status !== 'ACTIVE') {
        throw new Error(`Shop ${shopId} not found or inactive`);
      }
      const runId = syncJobId || await createPendingSyncJob(shopId, {});
      await markSyncJobRunning(runId);
      const totalSynced = await syncProductsCore(shopId, shop);
      await prisma.syncJob.update({
        where: { id: runId },
        data: { status: 'SUCCESS', finishedAt: new Date(), result: { totalSynced } },
      });
      return { totalSynced };
    },
    {
      connection,
      concurrency: 2,
      limiter: { max: 1, duration: 2000 },
    },
  );

  worker.on('failed', async (job, err) => {
    if (job) {
      if (job.data.syncJobId) {
        await markSyncJobFailed(job.data.syncJobId, err);
      } else {
        await prisma.syncJob.updateMany({
          where: { shopId: job.data.shopId, type: 'PRODUCT_PULL', status: 'RUNNING' },
          data: { status: 'FAILED', finishedAt: new Date(), errorMessage: err.message },
        });
      }
    }
    console.error(`[ProductSync] Job ${job?.id} failed:`, err.message);
  });

  worker.on('completed', (job, result) => {
    console.log(`[ProductSync] Job ${job.id} completed:`, result);
  });

  registerWorker(worker);
  return worker;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildSyncPayload(options: ProductSyncJobOptions): Record<string, unknown> | undefined {
  const payload: Record<string, unknown> = {};
  if (options.trigger) payload.trigger = options.trigger;
  if (options.eventType) payload.eventType = options.eventType;
  if (options.eventKey) payload.eventKey = options.eventKey;
  if (options.payload && Object.keys(options.payload).length) payload.notification = options.payload;
  return Object.keys(payload).length ? payload : undefined;
}

async function createPendingSyncJob(shopId: string, options: ProductSyncJobOptions): Promise<string> {
  const syncJob = await prisma.syncJob.create({
    data: {
      shopId,
      type: 'PRODUCT_PULL',
      status: 'PENDING',
      payload: buildSyncPayload(options) as any,
    },
  });
  return syncJob.id;
}

async function markSyncJobRunning(syncJobId: string) {
  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: { status: 'RUNNING', startedAt: new Date(), errorMessage: null },
  });
}

async function markSyncJobFailed(syncJobId: string, error: Error & { message?: string }) {
  await prisma.syncJob.update({
    where: { id: syncJobId },
    data: { status: 'FAILED', finishedAt: new Date(), errorMessage: error.message || '同步失败' },
  });
}

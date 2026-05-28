import { Queue, Worker } from 'bullmq';
import { redis, redisDisabled } from '../lib/redis.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient } from '../services/ozon-client.js';

const QUEUE_NAME = 'product-sync';

const connection = { host: '127.0.0.1', port: 6379 };

export const productSyncQueue: Queue | null = redisDisabled ? null : new Queue(QUEUE_NAME, { connection });

export async function addProductSyncJob(shopId: string) {
  if (redisDisabled) {
    // Redis 不在时直接同步执行，避免前端转圈
    runProductSyncInline(shopId).catch((e) => {
      console.error(`[ProductSync inline] shop ${shopId} failed:`, e.message);
    });
    return { id: 'inline-' + Date.now() };
  }
  return productSyncQueue!.add('sync', { shopId }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 20,
  });
}

async function runProductSyncInline(shopId: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.status !== 'ACTIVE') {
    throw new Error(`Shop ${shopId} not found or inactive`);
  }
  await prisma.syncJob.create({
    data: { shopId, type: 'PRODUCT_PULL', status: 'RUNNING', startedAt: new Date() },
  });
  try {
    const totalSynced = await syncProductsCore(shopId, shop);
    await prisma.syncJob.updateMany({
      where: { shopId, type: 'PRODUCT_PULL', status: 'RUNNING' },
      data: { status: 'SUCCESS', finishedAt: new Date(), result: { totalSynced } },
    });
  } catch (e: any) {
    await prisma.syncJob.updateMany({
      where: { shopId, type: 'PRODUCT_PULL', status: 'RUNNING' },
      data: { status: 'FAILED', finishedAt: new Date(), errorMessage: e.message },
    });
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

  while (true) {
    const list = await client.getProductList({ last_id: lastId || undefined, limit: batchSize });
    if (!list.items.length) break;

    const productIds = list.items.map((i) => i.product_id);
    const details = await client.getProductInfoList(productIds);

    for (const info of details) {
      const totalStock = info.stocks?.stocks?.reduce((sum, s) => sum + s.present, 0) ?? 0;
      const modelId = info.model_info?.model_id ? String(info.model_info.model_id) : null;
      await prisma.product.upsert({
        where: { shopId_platformProductId: { shopId, platformProductId: String(info.id) } },
        create: {
          shopId,
          platformProductId: String(info.id),
          sku: String(info.sku),
          offerId: info.offer_id,
          title: info.name,
          description: info.description || '',
          price: info.price ? parseFloat(info.price) : null,
          oldPrice: info.old_price ? parseFloat(info.old_price) : null,
          currency: info.currency_code || 'RUB',
          stock: totalStock,
          images: info.images || [],
          modelId,
          status: info.statuses?.status || null,
          visibility: info.is_archived ? 'ARCHIVED' : info.stocks?.has_stock ? 'VISIBLE' : 'HIDDEN',
          syncStatus: 'SYNCED',
        },
        update: {
          title: info.name,
          description: info.description || undefined,
          price: info.price ? parseFloat(info.price) : null,
          oldPrice: info.old_price ? parseFloat(info.old_price) : null,
          currency: info.currency_code || 'RUB',
          stock: totalStock,
          images: info.images || [],
          modelId,
          status: info.statuses?.status || null,
          visibility: info.is_archived ? 'ARCHIVED' : info.stocks?.has_stock ? 'VISIBLE' : 'HIDDEN',
          syncStatus: 'SYNCED',
        },
      });
      totalSynced++;
    }

    lastId = list.last_id;
    if (list.items.length < batchSize) break;
    await sleep(1000);
  }

  await prisma.shop.update({
    where: { id: shopId },
    data: { lastSyncAt: new Date() },
  });

  // Sync commission rates after product sync
  try {
    const allProducts = await prisma.product.findMany({
      where: { shopId, platformProductId: { not: null } },
      select: { id: true, platformProductId: true },
    });
    const allProductIds = allProducts.map((p) => Number(p.platformProductId));
    const priceBatchSize = 1000;
    for (let i = 0; i < allProductIds.length; i += priceBatchSize) {
      const batch = allProductIds.slice(i, i + priceBatchSize);
      const priceItems = await client.getProductPrices(batch);
      for (const item of priceItems) {
        const product = allProducts.find((p) => Number(p.platformProductId) === item.product_id);
        if (!product) continue;
        const fbsCommission = item.commissions?.find((c) => c.sale_schema === 'fbs' || c.sale_schema === 'FBS');
        const commission = fbsCommission || item.commissions?.[0];
        const commissionRate = commission?.percent ?? null;
        const minPrice = item.price?.min_price ? parseFloat(item.price.min_price) : null;
        await prisma.product.update({
          where: { id: product.id },
          data: {
            commissionRate: commissionRate != null ? commissionRate : undefined,
            minPrice: minPrice != null ? minPrice : undefined,
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
      const { shopId } = job.data;
      const shop = await prisma.shop.findUnique({ where: { id: shopId } });
      if (!shop || shop.status !== 'ACTIVE') {
        throw new Error(`Shop ${shopId} not found or inactive`);
      }
      await prisma.syncJob.create({
        data: { shopId, type: 'PRODUCT_PULL', status: 'RUNNING', startedAt: new Date() },
      });
      const totalSynced = await syncProductsCore(shopId, shop);
      await prisma.syncJob.updateMany({
        where: { shopId, type: 'PRODUCT_PULL', status: 'RUNNING' },
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
      await prisma.syncJob.updateMany({
        where: { shopId: job.data.shopId, type: 'PRODUCT_PULL', status: 'RUNNING' },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: err.message },
      });
    }
    console.error(`[ProductSync] Job ${job?.id} failed:`, err.message);
  });

  worker.on('completed', (job, result) => {
    console.log(`[ProductSync] Job ${job.id} completed:`, result);
  });

  return worker;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

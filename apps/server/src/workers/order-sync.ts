import { Queue, Worker } from 'bullmq';
import { redisDisabled } from '../lib/redis.js';
import { connection } from '../lib/bullmq-connection.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient, type OzonPosting } from '../services/ozon-client.js';
import { createNotification } from '../routes/notification.js';
import { describeSubstatus } from '../lib/ozon-substatus.js';
import { getRate } from '../services/exchange-rate.js';

const QUEUE_NAME = 'order-sync';

export const orderSyncQueue: Queue | null = redisDisabled ? null : new Queue(QUEUE_NAME, { connection });

export async function addOrderSyncJob(shopId: string, since?: string) {
  const sinceDate = since || new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  if (redisDisabled) {
    runOrderSyncInline(shopId, sinceDate).catch((e) => {
      console.error(`[OrderSync inline] shop ${shopId} failed:`, e.message);
    });
    return { id: 'inline-' + Date.now() };
  }
  return orderSyncQueue!.add(
    'sync',
    { shopId, since: sinceDate },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 20,
    },
  );
}

async function runOrderSyncInline(shopId: string, since: string) {
  const shop = await prisma.shop.findUnique({
    where: { id: shopId },
    include: { user: { include: { account: true } } },
  });
  if (!shop || shop.status !== 'ACTIVE') {
    throw new Error(`Shop ${shopId} not found or inactive`);
  }
  await prisma.syncJob.create({
    data: { shopId, type: 'ORDER_PULL', status: 'RUNNING', startedAt: new Date() },
  });
  try {
    const result = await syncOrdersCore(shopId, since, shop);
    await prisma.syncJob.updateMany({
      where: { shopId, type: 'ORDER_PULL', status: 'RUNNING' },
      data: { status: 'SUCCESS', finishedAt: new Date(), result },
    });
  } catch (e: any) {
    await prisma.syncJob.updateMany({
      where: { shopId, type: 'ORDER_PULL', status: 'RUNNING' },
      data: { status: 'FAILED', finishedAt: new Date(), errorMessage: e.message },
    });
    throw e;
  }
}

async function syncOrdersCore(shopId: string, since: string, shop: any) {
  const isSolo = shop.user.tenantType === 'solo';
  let soloFee = 0;
  if (isSolo) {
    const shopConfig = await prisma.shopBillingConfig.findUnique({ where: { shopId } });
    if (shopConfig?.isActive) {
      soloFee = Number(shopConfig.perOrderFee);
    } else if (shop.user.perOrderFee != null) {
      soloFee = Number(shop.user.perOrderFee);
    }
  }

  if (isSolo && soloFee > 0 && shop.user.account) {
    const balance = Number(shop.user.account.balance);
    if (balance <= 0) {
      await createNotification(shop.userId, {
        type: 'balance_warning',
        title: '余额不足，同步已暂停',
        content: `账户余额为 ¥${balance.toFixed(2)}，订单同步已暂停。请充值后重新同步。`,
        link: '/finance',
      });
      throw new Error(`SoloSeller ${shop.userId} balance depleted (${balance}), sync paused`);
    }
    if (balance < soloFee * 5) {
      await createNotification(shop.userId, {
        type: 'balance_warning',
        title: '余额即将不足',
        content: `账户余额 ¥${balance.toFixed(2)}，预计仅够 ${Math.floor(balance / soloFee)} 单服务费，请及时充值。`,
        link: '/finance',
      });
    }
  }

  const client = new OzonClient({
    clientId: shop.clientId!,
    apiKey: decrypt(shop.apiKeyEncrypted),
  });

  // 🚀 性能优化：预加载汇率缓存，避免每个订单都查询数据库
  const orderDate = new Date();
  const rateCache = new Map<string, number>();
  const currencies = ['USD', 'CNY', 'RUB', 'EUR', 'KZT', 'BYN'];

  console.log('[OrderSync] 预加载汇率缓存...');
  for (const currency of currencies) {
    const { rate } = await getRate(currency, orderDate);
    rateCache.set(currency, rate);
  }
  const rubToCny = rateCache.get('RUB')!;
  console.log('[OrderSync] 汇率缓存加载完成:', Object.fromEntries(rateCache));

  let offset = 0;
  let totalSynced = 0;
  let soloFeeTotal = 0;
  const limit = 50;
  const toDate = new Date().toISOString();

  while (true) {
    const result = await client.getPostingsList({
      dir: 'DESC',
      filter: { since, to: toDate },
      limit,
      offset,
      with: { analytics_data: false, financial_data: false },
    });

    if (!result.postings.length) break;

    for (const posting of result.postings) {
      const enrichedProducts = await enrichItemsWithImages(shopId, posting.products);
      const intlTracking = posting.tracking_number || null;

      // OZON 订单价格货币：根据店铺平台确定
      // OZON 平台订单成交价使用 RUB（卢布），不是合同货币 CNY
      const orderCurrency = shop.platform === 'OZON' ? 'RUB' : 'CNY';

      // 🚀 性能优化：使用缓存的汇率，而不是每次都查询数据库
      const calculateTotalAmount = () => {
        let total = 0;
        for (const p of posting.products) {
          const price = parseFloat(p.price);
          const currencyCode = (p as any).currency_code?.toUpperCase() || 'RUB';

          if (currencyCode === 'RUB') {
            total += price * p.quantity;
          } else {
            // 使用缓存的汇率
            const rateToCny = rateCache.get(currencyCode) || 1;
            const priceInCny = price * rateToCny;
            const priceInRub = priceInCny / rubToCny;
            total += priceInRub * p.quantity;
          }
        }
        return Math.round(total * 100) / 100;
      };

      const upserted = await prisma.order.upsert({
        where: {
          shopId_platformOrderId: {
            shopId,
            platformOrderId: String(posting.order_id),
          },
        },
        create: {
          shopId,
          platformOrderId: String(posting.order_id),
          postingNumber: posting.posting_number,
          status: posting.status,
          subStatus: posting.substatus || null,
          trackingNumber: intlTracking,
          internationalTrackingNumber: intlTracking,
          items: enrichedProducts,
          totalAmount: calculateTotalAmount(),
          currency: orderCurrency,
          inProcessAt: posting.in_process_at ? new Date(posting.in_process_at) : null,
          shipmentDate: posting.shipment_date ? new Date(posting.shipment_date) : null,
          deliveringDate: posting.delivering_date ? new Date(posting.delivering_date) : null,
          createdAt: posting.in_process_at ? new Date(posting.in_process_at) : new Date(),
        },
        update: {
          status: posting.status,
          subStatus: posting.substatus || null,
          trackingNumber: intlTracking ?? undefined,
          internationalTrackingNumber: intlTracking ?? undefined,
          items: enrichedProducts,
          totalAmount: calculateTotalAmount(),
          inProcessAt: posting.in_process_at ? new Date(posting.in_process_at) : null,
          shipmentDate: posting.shipment_date ? new Date(posting.shipment_date) : null,
          deliveringDate: posting.delivering_date ? new Date(posting.delivering_date) : null,
          createdAt: posting.in_process_at ? new Date(posting.in_process_at) : undefined,
        },
      });
      totalSynced++;

      await recordTrackingEvent(upserted.id, posting);

      if (isSolo && soloFee > 0 && !upserted.soloFeeBilledAt && shop.user.account) {
        const account = shop.user.account;
        await prisma.$transaction(async (tx) => {
          const acct = await tx.userAccount.update({
            where: { id: account.id },
            data: { balance: { decrement: soloFee } },
          });
          await tx.transaction.create({
            data: {
              accountId: account.id,
              type: 'consume',
              amount: -soloFee,
              balanceAfter: acct.balance,
              orderId: upserted.id,
              module: 'solo_fee',
              description: `SoloSeller 服务费 - 订单 ${posting.posting_number}`,
            },
          });
          await tx.order.update({
            where: { id: upserted.id },
            data: { soloFee, soloFeeBilledAt: new Date() },
          });
        });
        soloFeeTotal += soloFee;
      }
    }

    offset += limit;
    if (!result.has_next) break;
    await sleep(1000);
  }

  await prisma.shop.update({
    where: { id: shopId },
    data: { lastSyncAt: new Date() },
  });

  return { totalSynced, soloFeeTotal };
}

export function startOrderSyncWorker() {
  if (redisDisabled) return null;
  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      const { shopId, since } = job.data;
      const shop = await prisma.shop.findUnique({
        where: { id: shopId },
        include: { user: { include: { account: true } } },
      });
      if (!shop || shop.status !== 'ACTIVE') {
        throw new Error(`Shop ${shopId} not found or inactive`);
      }
      await prisma.syncJob.create({
        data: { shopId, type: 'ORDER_PULL', status: 'RUNNING', startedAt: new Date() },
      });
      const result = await syncOrdersCore(shopId, since, shop);
      await prisma.syncJob.updateMany({
        where: { shopId, type: 'ORDER_PULL', status: 'RUNNING' },
        data: { status: 'SUCCESS', finishedAt: new Date(), result },
      });
      return result;
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
        where: { shopId: job.data.shopId, type: 'ORDER_PULL', status: 'RUNNING' },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: err.message },
      });
    }
    console.error(`[OrderSync] Job ${job?.id} failed:`, err.message);
  });

  worker.on('completed', (job, result) => {
    console.log(`[OrderSync] Job ${job.id} completed:`, result);
  });

  return worker;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function recordTrackingEvent(orderId: string, posting: OzonPosting) {
  const sub = posting.substatus;
  if (!sub) return;
  const meta = describeSubstatus(sub);
  const occurredAt =
    posting.delivered_at ? new Date(posting.delivered_at)
    : posting.delivering_date ? new Date(posting.delivering_date)
    : posting.shipment_date ? new Date(posting.shipment_date)
    : posting.in_process_at ? new Date(posting.in_process_at)
    : new Date();

  try {
    await prisma.orderTrackingEvent.upsert({
      where: { orderId_substatus: { orderId, substatus: sub } },
      create: {
        orderId,
        substatus: sub,
        statusText: meta.text,
        source: 'ozon',
        occurredAt,
      },
      update: { statusText: meta.text },
    });
  } catch (e: any) {
    console.warn(`[OrderSync] tracking event upsert failed for ${orderId}:`, e.message);
  }
}

async function enrichItemsWithImages(
  shopId: string,
  products: { sku: number; name: string; quantity: number; offer_id: string; price: string }[],
) {
  if (!products.length) return products;

  const offerIds = Array.from(new Set(products.map((p) => p.offer_id).filter(Boolean)));
  const skus = Array.from(new Set(products.map((p) => String(p.sku)).filter(Boolean)));

  const [byOffer, bySku] = await Promise.all([
    offerIds.length
      ? prisma.product.findMany({
          where: { shopId, offerId: { in: offerIds } },
          select: { offerId: true, images: true },
        })
      : Promise.resolve([]),
    skus.length
      ? prisma.product.findMany({
          where: { shopId, sku: { in: skus } },
          select: { sku: true, images: true },
        })
      : Promise.resolve([]),
  ]);

  const offerMap = new Map<string, string>();
  for (const p of byOffer) {
    const url = pickFirstImage(p.images);
    if (p.offerId && url) offerMap.set(p.offerId, url);
  }
  const skuMap = new Map<string, string>();
  for (const p of bySku) {
    const url = pickFirstImage(p.images);
    if (p.sku && url) skuMap.set(p.sku, url);
  }

  return products.map((p) => {
    const image = offerMap.get(p.offer_id) || skuMap.get(String(p.sku)) || null;
    return image ? { ...p, image } : p;
  });
}

function pickFirstImage(raw: unknown): string | null {
  if (Array.isArray(raw)) {
    const first = raw.find((x) => typeof x === 'string' && x.trim());
    return typeof first === 'string' ? first : null;
  }
  if (raw && typeof raw === 'object') {
    const arr = (raw as any).images || (raw as any).primary_image;
    if (Array.isArray(arr)) {
      const first = arr.find((x) => typeof x === 'string' && x.trim());
      return typeof first === 'string' ? first : null;
    }
  }
  return null;
}

import { Queue, Worker } from 'bullmq';
import { redisDisabled } from '../lib/redis.js';
import { connection } from '../lib/bullmq-connection.js';
import { registerWorker } from '../lib/worker-registry.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient, OzonFinanceOperation } from '../services/ozon-client.js';
import { convertAmountToCny } from '../services/exchange-rate.js';

const QUEUE_NAME = 'finance-sync';

export const financeSyncQueue: Queue | null = redisDisabled ? null : new Queue(QUEUE_NAME, { connection });

// operation_type -> category 映射
const CATEGORY_MAP: Record<string, string> = {
  MarketplaceMarketingActionCostItem: 'ad_click',
  MarketplaceServiceItemAdvertisementForOrder: 'ad_cpa',
  MarketplaceServiceItemReviewsBonus: 'ad_review',
  MarketplaceServiceItemQuickReview: 'ad_quick',
  MarketplaceServiceItemPremium: 'ad_premium',
  MarketplaceServiceItemBrandPromotion: 'ad_brand',
  OperationMarketplaceSaleCommission: 'commission',
  MarketplaceServiceItemDelivToCustomer: 'shipping_last',
  MarketplaceServiceItemDirectFlowTrans: 'shipping_intl',
  MarketplaceServiceItemReturnFlowTrans: 'shipping_intl',
  MarketplaceServiceItemDelivToCustomerPost: 'shipping_post',
  MarketplaceServiceItemFulfillment: 'fee_settle',
  OperationItemReturn: 'refund_partial',
  MarketplaceServiceItemReturnPartGoodsCustomer: 'refund_partial',
  MarketplaceServiceItemDisputeCompensation: 'dispute',
  MarketplaceServiceItemCancelledIndexPenalty: 'penalty_index',
  MarketplaceServiceItemPickupFail: 'penalty_pickfail',
  MarketplaceServiceItemOther: 'service_other',
};

function classifyOperation(op: OzonFinanceOperation): string {
  const mapped = CATEGORY_MAP[op.operation_type];
  if (mapped) return mapped;
  const name = op.operation_type.toLowerCase();
  if (name.includes('commission') || name.includes('sale_commission')) return 'commission';
  if (name.includes('advert') || name.includes('marketing')) return 'ad_click';
  if (name.includes('delivery') || name.includes('deliv')) return 'shipping_last';
  if (name.includes('penalty') || name.includes('cancel')) return 'penalty_index';
  if (name.includes('return') || name.includes('refund')) return 'refund_partial';
  return 'other';
}

export async function addFinanceSyncJob(shopId: string, days = 30) {
  const from = new Date(Date.now() - days * 24 * 3600 * 1000).toISOString();
  const to = new Date().toISOString();
  if (redisDisabled) {
    syncFinanceCore(shopId, from, to).catch((e) =>
      console.error(`[FinanceSync inline] shop ${shopId} failed:`, e.message),
    );
    return { id: 'inline-' + Date.now() };
  }
  return financeSyncQueue!.add('sync', { shopId, from, to }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 20,
  });
}

async function syncFinanceCore(shopId: string, from: string, to: string) {
  const shop = await prisma.shop.findUnique({ where: { id: shopId } });
  if (!shop || shop.status !== 'ACTIVE') throw new Error(`Shop ${shopId} not found or inactive`);

  const client = new OzonClient({
    clientId: shop.clientId!,
    apiKey: decrypt(shop.apiKeyEncrypted),
  });

  let page = 1;
  let totalStored = 0;

  while (true) {
    const res = await client.getFinanceTransactionList({ from, to, page, page_size: 1000 });
    const ops = res.result.operations;
    if (!ops.length) break;

    for (const op of ops) {
      const category = classifyOperation(op);
      const opDate = new Date(op.operation_date);
      const { amountCny, rate } = await convertAmountToCny(op.amount, 'RUB', opDate);

      await prisma.ozonFinanceTransaction.upsert({
        where: {
          shopId_operationId: { shopId, operationId: String(op.operation_id) },
        },
        create: {
          shopId,
          operationId: String(op.operation_id),
          operationType: op.operation_type,
          operationTypeName: op.operation_type_name || null,
          category,
          postingNumber: op.posting?.posting_number || null,
          orderId: op.posting?.order_id ? String(op.posting.order_id) : null,
          amount: op.amount,
          currency: 'RUB',
          amountCny,
          exchangeRate: rate,
          operationDate: opDate,
          raw: op as any,
        },
        update: {
          operationType: op.operation_type,
          operationTypeName: op.operation_type_name || null,
          category,
          amount: op.amount,
          amountCny,
          exchangeRate: rate,
        },
      });
      totalStored++;
    }

    if (page >= res.result.page_count) break;
    page++;
    await sleep(1500);
  }

  console.log(`[FinanceSync] Shop ${shop.name}: stored ${totalStored} transactions`);
  return { totalStored };
}

export function startFinanceSyncWorker() {
  if (redisDisabled) return null;

  // 每天 01:00 UTC 自动同步所有活跃店铺最近 30 天
  financeSyncQueue!.upsertJobScheduler(
    'daily-finance-sync-all',
    { pattern: '0 1 * * *' },
    { name: 'sync-all-shops' },
  ).catch((err) => console.error('[FinanceSync] Failed to register scheduler:', err.message));

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === 'sync-all-shops') {
        const shops = await prisma.shop.findMany({
          where: { status: 'ACTIVE', platform: 'OZON' },
          select: { id: true },
        });
        let total = 0;
        for (const shop of shops) {
          const from = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
          const to = new Date().toISOString();
          const r = await syncFinanceCore(shop.id, from, to);
          total += r.totalStored;
          await sleep(2000);
        }
        return { shopsProcessed: shops.length, totalStored: total };
      }
      const { shopId, from, to } = job.data;
      return syncFinanceCore(shopId, from, to);
    },
    { connection, concurrency: 1 },
  );

  worker.on('failed', (job, err) => {
    console.error(`[FinanceSync] Job ${job?.id} failed:`, err.message);
  });

  registerWorker(worker);
  return worker;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

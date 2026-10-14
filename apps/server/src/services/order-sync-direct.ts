import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient } from './ozon-client.js';
import { describeSubstatus, resolveOzonTrackingEventTime } from '../lib/ozon-substatus.js';
import { getRate } from './exchange-rate.js';

export interface DirectSyncResult {
  created: number;
  updated: number;
}

export class DirectSyncError extends Error {
  constructor(message: string, public readonly partial: DirectSyncResult) {
    super(message);
  }
}

function buildTimeChunks(sinceIso: string, toIso: string): { since: string; to: string }[] {
  const MS_30_DAYS = 30 * 24 * 3600 * 1000;
  const startTime = new Date(sinceIso).getTime();
  const endTime = new Date(toIso).getTime();
  const chunks: { since: string; to: string }[] = [];
  let chunkStart = startTime;
  while (chunkStart < endTime) {
    const chunkEnd = Math.min(chunkStart + MS_30_DAYS, endTime);
    chunks.push({
      since: new Date(chunkStart).toISOString(),
      to: new Date(chunkEnd).toISOString(),
    });
    chunkStart = chunkEnd;
  }
  return chunks;
}

async function fetchOfferImages(
  client: OzonClient,
  postings: Array<{ products: Array<{ offer_id: string }> }>,
): Promise<Map<string, string>> {
  const imageMap = new Map<string, string>();
  const allOfferIds = [...new Set(postings.flatMap((p) => p.products.map((prod) => prod.offer_id)))];
  if (!allOfferIds.length) return imageMap;
  try {
    const batchSize = 100;
    for (let i = 0; i < allOfferIds.length; i += batchSize) {
      const batch = allOfferIds.slice(i, i + batchSize);
      const infos = await client.getProductInfoByOfferId(batch);
      for (const info of infos) {
        const img = info.primary_image || info.images?.[0];
        if (img) imageMap.set(info.offer_id, img);
      }
    }
  } catch {
    // non-critical: proceed without images
  }
  return imageMap;
}

async function calculateTotalAmountRub(
  products: Array<{ price: string; quantity: number; currency_code?: string }>,
  orderDate: Date,
): Promise<number> {
  let total = 0;
  for (const p of products) {
    const price = parseFloat(p.price);
    const currencyCode = (p.currency_code || 'RUB').toUpperCase();
    if (currencyCode === 'RUB') {
      total += price * p.quantity;
    } else {
      const { rate: rateToCny } = await getRate(currencyCode, orderDate);
      const priceInCny = price * rateToCny;
      const { rate: rubToCny } = await getRate('RUB', orderDate);
      const priceInRub = priceInCny / rubToCny;
      total += priceInRub * p.quantity;
    }
  }
  return Math.round(total * 100) / 100;
}

function pickShippingInfo(posting: any): any {
  if (!posting.customer?.address && !posting.delivery_method) return undefined;
  return {
    ...(posting.customer?.address || {}),
    deliveryMethod: posting.delivery_method?.name,
    warehouse: posting.delivery_method?.warehouse,
    tplProvider: posting.delivery_method?.tpl_provider,
  };
}

async function recordTrackingEvent(orderId: string, posting: any): Promise<void> {
  if (!posting.substatus) return;
  const meta = describeSubstatus(posting.substatus);
  const occurredAt = resolveOzonTrackingEventTime(posting);
  try {
    await prisma.orderTrackingEvent.upsert({
      where: { orderId_substatus: { orderId, substatus: posting.substatus } },
      create: { orderId, substatus: posting.substatus, statusText: meta.text, source: 'ozon', occurredAt },
      update: { statusText: meta.text, ...(meta.phase === 'created' && posting.in_process_at ? { occurredAt } : {}) },
    });
  } catch {
    // non-critical
  }
}

export async function syncOrdersDirect(
  shopId: string,
  userId: string,
  since?: string,
): Promise<DirectSyncResult> {
  const shop = await prisma.shop.findFirst({ where: { id: shopId, userId } });
  if (!shop) throw new Error('店铺不存在');
  if (shop.status !== 'ACTIVE') throw new Error('店铺状态异常，请先测试连接');

  const client = new OzonClient({
    clientId: shop.clientId!,
    apiKey: decrypt(shop.apiKeyEncrypted),
  });

  const requestedSince = since || new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const finalTo = new Date().toISOString();
  const timeChunks = buildTimeChunks(requestedSince, finalTo);
  const limit = 50;
  let created = 0;
  let updated = 0;

  try {
    for (const chunk of timeChunks) {
      let offset = 0;
      while (true) {
        const result = await client.getPostingsList({
          dir: 'DESC',
          filter: { since: chunk.since, to: chunk.to },
          limit,
          offset,
          with: { analytics_data: false, financial_data: false, addressee: true },
        });
        if (!result.postings.length) break;

        const imageMap = await fetchOfferImages(client, result.postings);

        for (const posting of result.postings) {
          const itemsWithImages = posting.products.map((p) => ({
            ...p,
            image: imageMap.get(p.offer_id) || null,
          }));

          const existing = await prisma.order.findUnique({
            where: { shopId_platformOrderId: { shopId: shop.id, platformOrderId: String(posting.order_id) } },
          });

          const intlTracking = posting.tracking_number || null;
          const orderDate = posting.in_process_at ? new Date(posting.in_process_at) : new Date();
          const totalAmount = await calculateTotalAmountRub(posting.products, orderDate);
          const shippingInfo = pickShippingInfo(posting);

          const upserted = await prisma.order.upsert({
            where: { shopId_platformOrderId: { shopId: shop.id, platformOrderId: String(posting.order_id) } },
            create: {
              shopId: shop.id,
              platformOrderId: String(posting.order_id),
              postingNumber: posting.posting_number,
              status: posting.status,
              subStatus: posting.substatus || null,
              trackingNumber: intlTracking,
              internationalTrackingNumber: intlTracking,
              items: itemsWithImages,
              totalAmount,
              currency: 'RUB',
              buyerInfo: posting.addressee ? { name: posting.addressee.name, phone: posting.addressee.phone } : undefined,
              shippingInfo,
              inProcessAt: posting.in_process_at ? new Date(posting.in_process_at) : null,
              shipmentDate: posting.shipment_date ? new Date(posting.shipment_date) : null,
              deliveringDate: posting.delivering_date ? new Date(posting.delivering_date) : null,
              deliveredAt: posting.delivered_at ? new Date(posting.delivered_at) : null,
              createdAt: posting.in_process_at ? new Date(posting.in_process_at) : new Date(),
            },
            update: {
              status: posting.status,
              subStatus: posting.substatus || null,
              trackingNumber: intlTracking ?? undefined,
              internationalTrackingNumber: intlTracking ?? undefined,
              items: itemsWithImages,
              totalAmount,
              buyerInfo: posting.addressee ? { name: posting.addressee.name, phone: posting.addressee.phone } : undefined,
              shippingInfo,
              inProcessAt: posting.in_process_at ? new Date(posting.in_process_at) : null,
              shipmentDate: posting.shipment_date ? new Date(posting.shipment_date) : null,
              deliveringDate: posting.delivering_date ? new Date(posting.delivering_date) : null,
              deliveredAt: posting.delivered_at ? new Date(posting.delivered_at) : null,
              createdAt: posting.in_process_at ? new Date(posting.in_process_at) : undefined,
            },
          });

          await recordTrackingEvent(upserted.id, posting);

          if (existing) updated++;
          else created++;
        }

        offset += limit;
        if (!result.has_next) break;
      }
    }

    await prisma.shop.update({
      where: { id: shop.id },
      data: { lastSyncAt: new Date() },
    });

    return { created, updated };
  } catch (e: any) {
    throw new DirectSyncError(e.message || '未知错误', { created, updated });
  }
}

export function humanizeSyncError(message: string): string {
  if (message.includes('fetch') || message.includes('ECONNREFUSED')) return '网络连接失败，请检查服务器是否能访问 OZON API';
  if (message.includes('401') || message.includes('403')) return 'API 密钥无效或已过期，请重新配置店铺';
  if (message.includes('timeout') || message.includes('ETIMEDOUT')) return '请求超时，请稍后重试';
  return message;
}

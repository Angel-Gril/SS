import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { YandexMarketClient } from './yandex-market-client.js';
import { readYandexBusiness } from './yandex-market-catalog.js';
import { normalizeYandexOrder, yandexOrderDateWindows, type YandexOrder } from './yandex-order-contract.js';

export type YandexOrderSyncResult = { created: number; updated: number; windows: number; orders: number };

export async function syncYandexOrders(shop: { id: string; userId: string; clientId: string | null; apiKeyEncrypted: string; status: string; config: unknown }, since?: string): Promise<YandexOrderSyncResult> {
  if (shop.status !== 'ACTIVE' || !shop.clientId) throw new Error('Yandex 店铺状态异常，请先测试连接');
  const client = new YandexMarketClient({ apiKey: decrypt(shop.apiKeyEncrypted) });
  const businessId = await readYandexBusiness(shop, client);
  const settings = await client.getBusinessSettings(businessId);
  const from = since || new Date(Date.now() - 90 * 86400000).toISOString();
  const windows = yandexOrderDateWindows(from);
  const orders: YandexOrder[] = []; const seen = new Set<string>();
  for (const window of windows) {
    let pageToken: string | undefined; const pageSeen = new Set<string>();
    for (let page = 0; page < 200; page += 1) {
      const result = await client.getBusinessOrders(businessId, shop.clientId, window, pageToken);
      for (const order of result.orders) if (!seen.has(String(order.orderId))) { seen.add(String(order.orderId)); orders.push(order); }
      if (!result.nextPageToken) break;
      if (page === 199 || orders.length > 5000) throw new Error('Yandex 订单超过本轮读取上限，未保存不完整快照');
      if (pageSeen.has(result.nextPageToken)) throw new Error('Yandex 订单分页未推进');
      pageSeen.add(result.nextPageToken); pageToken = result.nextPageToken;
    }
  }
  if (orders.length > 5000) throw new Error('Yandex 订单超过本轮读取上限');
  const prepared = orders.map(raw => ({ raw, data: normalizeYandexOrder(raw, settings.currency) }));
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`yandex-order-sync:${shop.id}`}, 0))`;
    const current = await tx.shop.findFirst({ where: { id: shop.id, userId: shop.userId, platform: 'YANDEX', status: 'ACTIVE', clientId: shop.clientId, apiKeyEncrypted: shop.apiKeyEncrypted } });
    if (!current) throw new Error('Yandex 店铺状态或凭据已变化，同步未保存');
    let created = 0; let updated = 0;
    for (const { raw, data } of prepared) {
    const existing = await tx.order.findUnique({ where: { shopId_platformOrderId: { shopId: shop.id, platformOrderId: data.platformOrderId } }, select: { id: true, shippingInfo: true } });
    const previous = (existing?.shippingInfo as { yandexMarket?: { updateDate?: string } } | null)?.yandexMarket?.updateDate;
    if (previous && (!raw.updateDate || Date.parse(previous) > Date.parse(raw.updateDate))) continue;
    const order = await tx.order.upsert({
      where: { shopId_platformOrderId: { shopId: shop.id, platformOrderId: data.platformOrderId } },
      create: { shopId: shop.id, ...data, shippingInfo: data.shippingInfo as any, items: data.items as any },
      update: { ...data, shippingInfo: data.shippingInfo as any, items: data.items as any },
    });
    await tx.orderTrackingEvent.upsert({
      where: { orderId_substatus: { orderId: order.id, substatus: data.subStatus } },
      create: { orderId: order.id, substatus: data.subStatus, statusText: `Yandex ${raw.status} / ${raw.substatus}`, source: 'yandex', occurredAt: raw.updateDate ? new Date(raw.updateDate) : new Date(raw.creationDate) },
      update: { statusText: `Yandex ${raw.status} / ${raw.substatus}`, occurredAt: raw.updateDate ? new Date(raw.updateDate) : new Date(raw.creationDate) },
    });
    if (existing) updated += 1; else created += 1;
    }
    await tx.shop.update({ where: { id: shop.id }, data: { lastSyncAt: new Date() } });
    return { created, updated };
  }, { timeout: 120000, isolationLevel: 'Serializable' });
  return { ...result, windows: windows.length, orders: orders.length };
}

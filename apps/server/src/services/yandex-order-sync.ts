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
  const from = since || new Date(Date.now() - 90 * 86400000).toISOString();
  const windows = yandexOrderDateWindows(from);
  const orders: YandexOrder[] = []; const seen = new Set<string>();
  for (const window of windows) {
    let pageToken: string | undefined; const pageSeen = new Set<string>();
    for (let page = 0; page < 200; page += 1) {
      const result = await client.getBusinessOrders(businessId, shop.clientId, window, pageToken);
      for (const order of result.orders) if (!seen.has(String(order.orderId))) { seen.add(String(order.orderId)); orders.push(order); }
      if (!result.nextPageToken) break;
      if (pageSeen.has(result.nextPageToken)) throw new Error('Yandex 订单分页未推进');
      pageSeen.add(result.nextPageToken); pageToken = result.nextPageToken;
    }
  }
  const prepared = orders.map(raw => ({ raw, data: normalizeYandexOrder(raw, 'RUB') }));
  const result = await prisma.$transaction(async tx => {
    let created = 0; let updated = 0;
    for (const { raw, data } of prepared) {
    const existing = await tx.order.findUnique({ where: { shopId_platformOrderId: { shopId: shop.id, platformOrderId: data.platformOrderId } }, select: { id: true } });
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
  });
  return { ...result, windows: windows.length, orders: orders.length };
}

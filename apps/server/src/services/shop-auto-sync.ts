import { prisma } from '../lib/prisma.js';
import { getStrictConfigSnapshot } from '../config/system-config-schema.js';

export const SHOP_AUTO_SYNC_CONFIG_KEYS = ['sync_auto_orders_enabled', 'sync_auto_orders_interval_minutes', 'sync_auto_products_enabled', 'sync_auto_products_interval_minutes'] as const;

/** Scheduling owns cadence only; the existing platform workers own reading and storage. */
export async function dispatchShopAutoSync(options: { now?: Date; afterShopId?: string } = {}): Promise<{ queued: number; failed: number; lastShopId: string | null }> {
  const now = options.now ?? new Date();
  const config = await getStrictConfigSnapshot(SHOP_AUTO_SYNC_CONFIG_KEYS);
  const streams = [
    { type: 'ORDER_PULL' as const, enabled: config.sync_auto_orders_enabled, intervalMs: config.sync_auto_orders_interval_minutes * 60000 },
    { type: 'PRODUCT_PULL' as const, enabled: config.sync_auto_products_enabled, intervalMs: config.sync_auto_products_interval_minutes * 60000 },
  ].filter(stream => stream.enabled);
  if (!streams.length) return { queued: 0, failed: 0, lastShopId: null };
  // Keyset pagination gives every shop a turn without scanning unbounded tenant data.
  const shops = await prisma.shop.findMany({ where: { status: 'ACTIVE', platform: { in: ['OZON', 'YANDEX'] }, user: { status: 'ACTIVE' }, ...(options.afterShopId ? { id: { gt: options.afterShopId } } : {}) }, select: { id: true }, orderBy: { id: 'asc' }, take: 100 });
  if (!shops.length) return { queued: 0, failed: 0, lastShopId: null };
  const recent = await prisma.syncJob.findMany({ where: { shopId: { in: shops.map(shop => shop.id) }, type: { in: streams.map(stream => stream.type) }, OR: [{ status: { in: ['PENDING', 'RUNNING'] } }, { createdAt: { gte: new Date(now.getTime() - 2 * 86400000) } }, { finishedAt: { gte: new Date(now.getTime() - 86400000) } }] },
    distinct: ['shopId', 'type', 'status'], orderBy: { createdAt: 'desc' }, select: { shopId: true, type: true, status: true, createdAt: true, finishedAt: true } });
  let queued = 0, failed = 0;
  for (const shop of shops) for (const stream of streams) {
    const history = recent.filter(job => job.shopId === shop.id && job.type === stream.type);
    if (history.some(job => job.status === 'RUNNING')) continue;
    // Re-enqueueing a PENDING reservation uses its stable queue ID, so lost enqueue acknowledgements recover safely.
    if (!history.some(job => job.status === 'PENDING') && history.some(job => (job.finishedAt ?? job.createdAt).getTime() > now.getTime() - stream.intervalMs)) continue;
    try {
      const settings = { trigger: 'scheduled', automaticIntervalMs: stream.intervalMs };
      if (stream.type === 'ORDER_PULL') { const { addOrderSyncJob } = await import('../workers/order-sync.js'); await addOrderSyncJob(shop.id, undefined, settings); }
      else { const { addProductSyncJob } = await import('../workers/product-sync.js'); await addProductSyncJob(shop.id, settings); }
      queued++;
    } catch { failed++; }
  }
  return { queued, failed, lastShopId: shops.length === 100 ? shops.at(-1)!.id : null };
}

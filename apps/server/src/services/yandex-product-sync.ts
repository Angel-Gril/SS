import type { YandexMarketClient } from './yandex-market-client.js';
import { z } from 'zod';

const detail = z.object({ offerId: z.string(), name: z.string().min(1).max(500), description: z.string().max(100000).nullish(),
  pictures: z.array(z.string().url()).max(100).nullish(), marketCategoryId: z.number().int().positive().nullish(), parameterValues: z.array(z.record(z.unknown())).max(1000).nullish(),
});

export function projectYandexProduct(row: Record<string, any>) {
  const { variants, ...rest } = row;
  const meta = variants?.yandexMarket;
  const statuses: Record<string, string> = { PUBLISHED: '可销售', CHECKING: '审核中', DISABLED_BY_PARTNER: '已隐藏', REJECTED_BY_MARKET: '平台拒绝', DISABLED_AUTOMATICALLY: '需修正错误', CREATING_CARD: '正在建卡', NO_CARD: '缺少卡片', NO_STOCKS: '无可售库存', ARCHIVED: '已归档', READY_FOR_PUBLICATION: '店铺接入中' };
  return { ...rest, price: row.price?.toString() ?? null, oldPrice: row.oldPrice?.toString() ?? null, commissionRate: null, minPrice: null,
    platformStatusName: statuses[row.status] ?? row.status, platformSyncedAt: meta?.syncedAt ?? null, platformStockKnown: meta?.stockKnown === true };
}

/** Build the full bounded campaign snapshot before any database writes. */
export async function collectYandexProducts(client: YandexMarketClient, businessId: string, campaignId: string) {
  const settings = await client.getBusinessSettings(businessId);
  const warehouses = await client.getShopWarehouses(businessId, campaignId);
  if (warehouses.length > 20) throw new Error('Yandex 本轮最多同步20个仓库');
  const rows: Array<{
    platformProductId: string; offerId: string; sku: string; title: string; description: string | null; categoryId: string | null;
    price: number | null; oldPrice: number | null; currency: string; stock?: number; images: string[]; attributes: unknown;
    status: string; visibility: string; syncStatus: string; variants: Record<string, any>;
  }> = [];
  const seenTokens = new Set<string>(), seenIds = new Set<string>();
  let pageToken: string | undefined;
  for (let page = 0; page < 50; page++) {
    const listing = await client.getCampaignOffers(campaignId, { limit: 100, ...(pageToken ? { pageToken } : {}) });
    const ids = listing.offers.map(offer => offer.offerId);
    if (ids.some(id => seenIds.has(id)) || new Set(ids).size !== ids.length) throw new Error('Yandex 商品分页未推进');
    ids.forEach(id => seenIds.add(id));
    if (ids.length) {
      const mappings = await client.getOfferMappings(businessId, { offerIds: ids });
      const details = mappings.offerMappings.map(value => detail.parse(value.offer));
      if (details.length !== ids.length || details.some(value => !ids.includes(value.offerId)) || new Set(details.map(d => d.offerId)).size !== ids.length) throw new Error('Yandex 商品详情与店铺列表不匹配');
      const stockPages = settings.warehouseModel === 'CAMPAIGN'
        ? await client.getStocks(businessId, campaignId, 'CAMPAIGN', ids)
        : (await Promise.all(warehouses.map(warehouse => client.getStocks(businessId, campaignId, 'WAREHOUSE', ids, warehouse.id)))).flat();
      for (const offer of listing.offers) {
        const d = details.find(value => value.offerId === offer.offerId)!;
        const stockRows = stockPages.flatMap(w => w.offers.filter(o => o.offerId === offer.offerId).map(o => ({ warehouseId: w.warehouseId, stocks: o.stocks, updatedAt: o.updatedAt ?? null })));
        const counted = new Map<string, number | undefined>();
        for (const warehouse of stockRows) {
          const group = warehouses.find(w => w.id === warehouse.warehouseId)?.groupInfo?.id;
          const key = group ? `group:${group}` : `warehouse:${warehouse.warehouseId}`;
          const available = warehouse.stocks.find(s => s.type === 'AVAILABLE')?.count;
          const fit = warehouse.stocks.find(s => s.type === 'FIT')?.count;
          const freeze = warehouse.stocks.find(s => s.type === 'FREEZE')?.count;
          const count = available ?? (fit === 0 ? 0 : fit !== undefined && freeze !== undefined && fit >= freeze ? fit - freeze : undefined);
          if (counted.has(key) && counted.get(key) !== count) throw new Error('Yandex 同一仓库组返回不同库存');
          counted.set(key, count);
        }
        const stockKnown = stockRows.length > 0 && [...counted.values()].every(count => count !== undefined);
        const stock = stockKnown ? [...counted.values()].reduce<number>((sum, count) => sum + count!, 0) : undefined;
        if (stock !== undefined && stock > 2000000000) throw new Error('Yandex 总库存超过限制');
        const p = offer.campaignPrice ?? offer.basicPrice;
        const currency = p?.currencyId ?? settings.currency;
        rows.push({ platformProductId: offer.offerId, offerId: offer.offerId, sku: offer.offerId, title: d.name, description: d.description ?? null,
          categoryId: d.marketCategoryId ? String(d.marketCategoryId) : null, images: d.pictures ?? [], attributes: d.parameterValues ?? [],
          price: p?.value ?? null, oldPrice: p?.discountBase ?? null, currency: currency === 'RUR' ? 'RUB' : currency,
          stock,
          status: offer.status, visibility: offer.status === 'ARCHIVED' ? 'ARCHIVED' : 'VISIBLE', syncStatus: 'SYNCED',
          variants: { yandexMarket: { businessId, campaignId, syncedAt: new Date().toISOString(), stockKnown, stocks: stockRows, stockMode: settings.warehouseModel } },
        });
      }
    }
    if (!listing.nextPageToken) return rows;
    if (seenTokens.has(listing.nextPageToken)) throw new Error('Yandex 商品分页未推进');
    seenTokens.add(listing.nextPageToken); pageToken = listing.nextPageToken;
  }
  throw new Error('Yandex 商品超过本轮5000条同步上限，未写入不完整快照');
}

export async function syncYandexProducts(shop: { id: string; userId: string; clientId: string | null; apiKeyEncrypted: string; status: string; config: unknown }) {
  const { prisma } = await import('../lib/prisma.js');
  const { decrypt } = await import('../lib/crypto.js');
  const { YandexMarketClient } = await import('./yandex-market-client.js');
  const { readYandexBusiness } = await import('./yandex-market-catalog.js');
  const client = new YandexMarketClient({ apiKey: decrypt(shop.apiKeyEncrypted) });
  const businessId = await readYandexBusiness(shop, client);
  const rows = await collectYandexProducts(client, businessId, shop.clientId!);
  await prisma.$transaction(async tx => {
    const current = await tx.shop.findFirst({ where: { id: shop.id, userId: shop.userId, platform: 'YANDEX', status: 'ACTIVE', clientId: shop.clientId, apiKeyEncrypted: shop.apiKeyEncrypted } });
    if (!current) throw new Error('Yandex 店铺状态或凭据已变化，同步未保存');
    for (const row of rows) await tx.product.upsert({ where: { shopId_platformProductId: { shopId: shop.id, platformProductId: row.platformProductId } },
      create: { ...row, attributes: row.attributes as any, shopId: shop.id, stock: row.stock ?? 0 }, update: { ...row, attributes: row.attributes as any } });
    await tx.product.updateMany({ where: { shopId: shop.id, platformProductId: { notIn: rows.map(row => row.platformProductId) } }, data: { visibility: 'MISSING', syncStatus: 'MISSING' } });
    await tx.shop.update({ where: { id: shop.id }, data: { lastSyncAt: new Date() } });
  }, { timeout: 120000, isolationLevel: 'Serializable' });
  return rows.length;
}

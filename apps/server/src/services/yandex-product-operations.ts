import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { readYandexBusiness, yandexUpdateAccepted } from './yandex-market-catalog.js';
import { YandexMarketApiError, type YandexMarketClient } from './yandex-market-client.js';

export const yandexProductCommand = z.object({
  action: z.enum(['PRICE', 'STOCK', 'HIDE', 'SHOW']), productIds: z.array(z.string().min(1).max(100)).min(1).max(100).refine(ids => new Set(ids).size === ids.length),
  confirm: z.literal(true), idempotencyKey: z.string().min(16).max(200),
  price: z.string().regex(/^\d+(?:\.\d{1,2})?$/u).optional(), oldPrice: z.string().regex(/^\d+(?:\.\d{1,2})?$/u).optional(),
  stock: z.number().int().min(0).max(2000000000).optional(), warehouseId: z.number().int().positive().safe().optional(), allowBusinessPrice: z.boolean().default(false), allowWarehouseGroup: z.boolean().default(false),
}).strict().superRefine((c, ctx) => {
  if (c.action === 'PRICE' && (!c.price || Number(c.price) <= 0 || Number(c.price) > 100000000 || (c.oldPrice && (Number(c.oldPrice) < Number(c.price) || Number(c.oldPrice) > 100000000)))) ctx.addIssue({ code: 'custom', message: '售价必须为正数，划线价不能低于售价' });
  if (c.action === 'STOCK' && (c.stock === undefined || !c.warehouseId)) ctx.addIssue({ code: 'custom', message: '库存修改必须选择仓库并填写非负整数' });
});

type Input = { shop: { id: string; status: string; clientId: string | null; config: unknown }; client: Pick<YandexMarketClient, 'getCampaign' | 'getBusinessSettings' | 'getShopWarehouses' | 'getCampaignOffers' | 'getStocks' | 'updateProductPrices' | 'updateProductStocks' | 'setProductHidden'>; ownerUserId: string; actorUserId: string; body: unknown };

/** Existing Yandex journal, with a tagged direct-management payload and no catalogue publication. */
export async function executeYandexProductOperation(input: Input) {
  const { shop, client, ownerUserId, actorUserId } = input;
  const command = yandexProductCommand.parse(input.body);
  const requestHash = createHash('sha256').update(JSON.stringify({ kind: 'PRODUCT_MANAGEMENT', shopId: shop.id, command })).digest('hex');
  const lookup = { ownerUserId_idempotencyKey: { ownerUserId, idempotencyKey: command.idempotencyKey } };
  const replay = (row: { id: string; state: string; requestHash: string }) => {
    if (row.requestHash !== requestHash) throw new Error('幂等键已用于不同操作');
    return { id: row.id, state: row.state, replayed: true };
  };
  const existing = await prisma.yandexOfferPublishOperation.findUnique({ where: lookup });
  if (existing) {
    const original = replay(existing);
    // UNKNOWN can be reconciled by observation; a read failure or mismatch keeps it locked.
    if (existing.state === 'UNKNOWN') try {
      const payload = existing.requestPayload as { offerIds?: string[]; settings?: { onlyDefaultPrice: boolean; warehouseModel: 'CAMPAIGN' | 'WAREHOUSE' } };
      if (payload.offerIds?.length && payload.settings) {
        const businessId = await readYandexBusiness(shop, client);
        if (businessId !== existing.businessId) return original;
        const read = await client.getCampaignOffers(shop.clientId!, { offerIds: payload.offerIds });
        let matches = false;
        if (command.action === 'PRICE') matches = payload.offerIds.every(id => {
          const o = read.offers.find(o => o.offerId === id), p = payload.settings!.onlyDefaultPrice ? o?.basicPrice : o?.campaignPrice;
          return p?.value === Number(command.price) && (!command.oldPrice || p.discountBase === Number(command.oldPrice));
        });
        else if (command.action === 'HIDE') matches = payload.offerIds.every(id => read.offers.find(o => o.offerId === id)?.status === 'DISABLED_BY_PARTNER');
        else if (command.action === 'SHOW') matches = payload.offerIds.every(id => {
          const status = read.offers.find(o => o.offerId === id)?.status;
          return status !== undefined && status !== 'DISABLED_BY_PARTNER';
        });
        else if (command.action === 'STOCK') {
          const readStocks = await client.getStocks(businessId, shop.clientId!, payload.settings.warehouseModel, payload.offerIds, command.warehouseId);
          const warehouse = readStocks.find(w => w.warehouseId === command.warehouseId);
          matches = payload.offerIds.every(id => warehouse?.offers.find(o => o.offerId === id)?.stocks.find(s => s.type === 'AVAILABLE')?.count === command.stock);
        }
        if (matches) {
          await prisma.yandexOfferPublishOperation.update({ where: { id: existing.id }, data: { state: 'SUCCEEDED', response: { kind: 'READBACK_RECONCILIATION', observedAt: new Date().toISOString(), matchedCurrentState: true }, errorMessage: null } });
          return { ...original, state: 'SUCCEEDED', reconciled: true };
        }
      }
    } catch { /* Preserve original UNKNOWN when observation is inconclusive. */ }
    return original;
  }
  const products = await prisma.product.findMany({ where: { id: { in: command.productIds }, shopId: shop.id }, select: { id: true, offerId: true, currency: true } });
  if (products.length !== command.productIds.length || products.some(p => !p.offerId)) throw new Error('部分商品不存在或不属于当前店铺');
  const businessId = await readYandexBusiness(shop, client);
  const current = await client.getCampaignOffers(shop.clientId!, { offerIds: products.map(p => p.offerId!) });
  if (products.some(p => !current.offers.some(o => o.offerId === p.offerId))) throw new Error('商品已不在当前 Yandex 店铺，请先同步');
  const settings = await client.getBusinessSettings(businessId);
  if (command.action === 'PRICE' && settings.onlyDefaultPrice && !command.allowBusinessPrice) throw new Error('此柜台只能设置所有店铺通用价格，请明确确认影响范围');
  if (command.action === 'STOCK') {
    const warehouses = await client.getShopWarehouses(businessId, shop.clientId!);
    if (!warehouses.some(w => w.id === command.warehouseId && String(w.campaignId) === shop.clientId)) throw new Error('仓库不属于当前 Yandex 店铺');
    if (warehouses.find(w => w.id === command.warehouseId)?.groupInfo && !command.allowWarehouseGroup) throw new Error('此仓库属于共享仓库组，修改会影响组内仓库，请明确确认');
    if (settings.warehouseModel === 'CAMPAIGN' && warehouses.length !== 1) throw new Error('当前店铺仓库映射存在歧义，不能自动修改库存');
  }
  const operation = await prisma.$transaction(async tx => {
    // Serialize overlapping writes by business, including prices shared by several campaigns.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`yandex-products:${ownerUserId}:${businessId}`}, 0))`;
    const previous = await tx.yandexOfferPublishOperation.findUnique({ where: lookup });
    if (previous) return { replay: replay(previous) };
    const unresolved = await tx.yandexOfferPublishOperation.findFirst({ where: { ownerUserId, businessId, state: { in: ['SUBMITTING', 'UNKNOWN'] }, OR: products.map(p => ({ requestPayload: { path: ['offerIds'], array_contains: [p.offerId!] } })) }, select: { id: true } });
    if (unresolved) throw new Error('这些商品存在结果未确认的操作，请先核对原请求');
    return { row: await tx.yandexOfferPublishOperation.create({ data: { id: randomUUID(), ownerUserId, actorUserId, shopId: shop.id, sourceShopId: shop.id, businessId,
      idempotencyKey: command.idempotencyKey, requestHash, state: 'SUBMITTING', requestPayload: { kind: 'PRODUCT_MANAGEMENT', command, settings, productIds: command.productIds, offerIds: products.map(p => p.offerId!) } } }) };
  });
  if (operation.replay) return operation.replay;
  const row = operation.row!;
  try {
    const response = command.action === 'PRICE'
      ? await client.updateProductPrices(businessId, shop.clientId!, settings.onlyDefaultPrice ? 'BUSINESS' : 'CAMPAIGN', products.map(p => ({ offerId: p.offerId!, price: { value: Number(command.price), currencyId: settings.currency, ...(command.oldPrice ? { discountBase: Number(command.oldPrice) } : {}) } })))
      : command.action === 'STOCK'
        ? await client.updateProductStocks(businessId, shop.clientId!, settings.warehouseModel, products.map(p => ({ offerId: p.offerId!, count: command.stock! })), command.warehouseId!)
        : await client.setProductHidden(shop.clientId!, products.map(p => p.offerId!), command.action === 'HIDE');
    const state = yandexUpdateAccepted(response) ? 'SUCCEEDED' : 'REJECTED';
    await prisma.yandexOfferPublishOperation.update({ where: { id: row.id }, data: { state, response: response as any } });
    return { id: row.id, state, replayed: false };
  } catch (error) {
    const rejected = error instanceof YandexMarketApiError && error.status >= 400 && error.status < 500;
    const state = rejected ? 'REJECTED' : 'UNKNOWN';
    try {
      await prisma.yandexOfferPublishOperation.update({ where: { id: row.id }, data: { state, errorMessage: rejected ? error.message : '平台结果未确认，请核对原请求，不要重新提交' } });
    } catch {
      // The durable SUBMITTING reservation still prevents a second write.
      console.error('[Yandex product operation] outcome persistence unavailable', { operationId: row.id });
      return { id: row.id, state: 'UNKNOWN', replayed: false };
    }
    return { id: row.id, state, replayed: false };
  }
}

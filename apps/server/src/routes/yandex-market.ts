import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { decrypt } from '../lib/crypto.js';
import { prisma } from '../lib/prisma.js';
import { YandexMarketApiError, YandexMarketClient } from '../services/yandex-market-client.js';
import { buildYandexOfferDraft } from '../services/yandex-market-offer-draft.js';

const shopIdSchema = z.string().min(1).max(100);
const draftPreviewSchema = z.object({ sourceShopId: z.string().min(1).max(100), productIds: z.array(z.string().min(1).max(100)).min(1).max(50) }).strict();
const publishSchema = draftPreviewSchema.extend({ confirm: z.literal(true), idempotencyKey: z.string().trim().min(16).max(200) }).strict();

async function ownedYandexShop(request: FastifyRequest, reply: FastifyReply) {
  const auth = (request as any).user as { tokenUse?: string } | undefined;
  if (!auth || auth.tokenUse !== 'account_session') {
    await reply.status(403).send({ code: 0, msg: '仅允许网页登录会话访问 Yandex Market 店铺' });
    return null;
  }
  const userId = String((request as any).user?.userId || '').trim();
  const shopId = shopIdSchema.parse((request.params as { shopId?: unknown }).shopId);
  const shop = await prisma.shop.findFirst({ where: { id: shopId, userId, platform: 'YANDEX', status: { not: 'DISABLED' } } });
  if (!shop) {
    await reply.status(404).send({ code: 0, msg: 'Yandex Market 店铺不存在' });
    return null;
  }
  if (!shop.apiKeyEncrypted) {
    await reply.status(400).send({ code: 0, msg: 'Yandex Market Api-Key 未配置' });
    return null;
  }
  return { shop, client: new YandexMarketClient({ apiKey: decrypt(shop.apiKeyEncrypted) }) };
}

export async function yandexMarketRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', authenticate);
  app.get('/:shopId/campaigns', async (request, reply) => {
    const context = await ownedYandexShop(request, reply); if (!context) return;
    try {
      const result = await context.client.getCampaigns();
      return reply.send({ code: 1, msg: 'ok', data: result });
    } catch (error) {
      const status = error instanceof YandexMarketApiError ? (error.status >= 400 && error.status < 500 ? error.status : 502) : 502;
      return reply.status(status).send({ code: 0, msg: error instanceof Error ? error.message : '暂时无法读取 Yandex Market 店铺' });
    }
  });

  app.get('/:shopId/campaign', async (request, reply) => {
    const context = await ownedYandexShop(request, reply); if (!context) return;
    const campaignId = String(context.shop.clientId || '').trim();
    if (!/^\d+$/u.test(campaignId)) return reply.status(400).send({ code: 0, msg: '店铺未配置有效的 Yandex campaign ID' });
    try {
      const campaign = await context.client.getCampaign(campaignId);
      return reply.send({ code: 1, msg: 'ok', data: campaign });
    } catch (error) {
      const status = error instanceof YandexMarketApiError ? (error.status >= 400 && error.status < 500 ? error.status : 502) : 502;
      return reply.status(status).send({ code: 0, msg: error instanceof Error ? error.message : '暂时无法读取 Yandex Market 店铺' });
    }
  });

  app.post('/:shopId/test', async (request, reply) => {
    const context = await ownedYandexShop(request, reply); if (!context) return;
    const campaignId = String(context.shop.clientId || '').trim();
    if (!/^\d+$/u.test(campaignId)) return reply.status(400).send({ code: 0, msg: '请把 Yandex campaign ID 填入店铺 Client ID 字段' });
    try {
      const campaign = await context.client.test(campaignId);
      const currentConfig = context.shop.config && typeof context.shop.config === 'object' && !Array.isArray(context.shop.config) ? context.shop.config as Record<string, unknown> : {};
      await prisma.shop.update({ where: { id: context.shop.id }, data: { status: 'ACTIVE', errorMessage: null, config: {
        ...currentConfig,
        yandexMarket: {
          campaignId: campaign.id,
          businessId: campaign.business?.id || null,
          placementType: campaign.placementType || null,
          apiAvailability: campaign.apiAvailability || null,
          checkedAt: new Date().toISOString(),
        },
      } } });
      return reply.send({ code: 1, msg: 'Yandex Market 连接成功', data: campaign });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Yandex Market 连接失败';
      await prisma.shop.update({ where: { id: context.shop.id }, data: { status: 'ERROR', errorMessage: message.slice(0, 500) } });
      const status = error instanceof YandexMarketApiError ? (error.status >= 400 && error.status < 500 ? error.status : 502) : 502;
      return reply.status(status).send({ code: 0, msg: `Yandex Market 连接失败: ${message}` });
    }
  });

  app.post('/:shopId/drafts/preview', async (request, reply) => {
    const context = await ownedYandexShop(request, reply); if (!context) return;
    const parsed = draftPreviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: '请提供最多50个 ERP 商品 ID' });
    const userId = String((request as any).user.userId);
    const source = await prisma.shop.findFirst({ where: { id: parsed.data.sourceShopId, userId, platform: 'OZON', status: 'ACTIVE' }, select: { id: true } });
    if (!source) return reply.status(404).send({ code: 0, msg: '来源 Ozon 店铺不存在或不属于当前账号' });
    const products = await prisma.product.findMany({ where: { id: { in: parsed.data.productIds }, shopId: source.id }, select: {
      id: true, platformProductId: true, sku: true, offerId: true, title: true, description: true, categoryId: true,
      price: true, currency: true, stock: true, images: true, attributes: true, variants: true,
    } });
    const drafts = products.map(product => buildYandexOfferDraft({ ...product, price: product.price?.toString() ?? null }));
    return reply.send({ code: 1, msg: '已生成 Yandex 商品草稿预览；尚未写入 Yandex', data: {
      targetShopId: context.shop.id, sourceShopId: source.id, requested: parsed.data.productIds.length, found: products.length,
      readyCount: drafts.filter(draft => draft.ready).length, blockedCount: drafts.filter(draft => !draft.ready).length, drafts,
    } });
  });

  app.post('/:shopId/offers/publish', async (request, reply) => {
    const context = await ownedYandexShop(request, reply); if (!context) return;
    if (process.env.YANDEX_MARKET_PUBLISH_ENABLED !== 'true') return reply.status(403).send({ code: 0, msg: 'Yandex 商品发布尚未启用，请先完成生产发布授权和配置' });
    const parsed = publishSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: '发布必须包含 confirm=true、幂等键和商品列表' });
    const ownerUserId = String((request as any).user.userId);
    const source = await prisma.shop.findFirst({ where: { id: parsed.data.sourceShopId, userId: ownerUserId, platform: 'OZON', status: 'ACTIVE' }, select: { id: true } });
    if (!source) return reply.status(404).send({ code: 0, msg: '来源 Ozon 店铺不存在或不属于当前账号' });
    const config = context.shop.config && typeof context.shop.config === 'object' && !Array.isArray(context.shop.config) ? context.shop.config as Record<string, unknown> : {};
    const yandexConfig = config.yandexMarket && typeof config.yandexMarket === 'object' && !Array.isArray(config.yandexMarket) ? config.yandexMarket as Record<string, unknown> : {};
    const businessId = String(yandexConfig.businessId || '').trim();
    if (!/^\d+$/u.test(businessId)) return reply.status(409).send({ code: 0, msg: '请先成功测试 Yandex 店铺以取得 business ID' });
    const products = await prisma.product.findMany({ where: { id: { in: parsed.data.productIds }, shopId: source.id }, select: {
      id: true, platformProductId: true, sku: true, offerId: true, title: true, description: true, categoryId: true,
      price: true, currency: true, stock: true, images: true, attributes: true, variants: true,
    } });
    const drafts = products.map(product => buildYandexOfferDraft({ ...product, price: product.price?.toString() ?? null }));
    if (products.length !== parsed.data.productIds.length) return reply.status(404).send({ code: 0, msg: '部分商品不存在或不属于来源店铺' });
    const blocked = drafts.filter(draft => !draft.ready);
    if (blocked.length) return reply.status(422).send({ code: 0, msg: '商品草稿仍缺少 Yandex 必填字段，请先完成预览修正', data: { blocked: blocked.map(draft => ({ sourceProductId: draft.sourceProductId, missingFields: draft.missingFields })) } });
    const offerMappings = drafts.map(draft => ({ offer: {
      offerId: draft.offer.offerId, name: draft.offer.name, description: draft.offer.description,
      marketCategoryId: draft.offer.marketCategoryId!, pictures: draft.offer.pictures,
      vendor: draft.offer.vendor!, barcodes: draft.offer.barcodes,
    } }));
    const requestPayload = { businessId, sourceShopId: source.id, targetShopId: context.shop.id, offerMappings };
    const requestHash = createHash('sha256').update(JSON.stringify(requestPayload)).digest('hex');
    const existing = await prisma.yandexOfferPublishOperation.findUnique({ where: { ownerUserId_idempotencyKey: { ownerUserId, idempotencyKey: parsed.data.idempotencyKey } } });
    if (existing) {
      if (existing.requestHash !== requestHash) return reply.status(409).send({ code: 0, msg: '幂等键已用于不同的 Yandex 发布请求' });
      return reply.send({ code: 1, msg: 'replayed', data: { id: existing.id, state: existing.state, response: existing.response, replayed: true } });
    }
    let operation;
    try {
      operation = await prisma.yandexOfferPublishOperation.create({ data: {
        id: randomUUID(), ownerUserId, actorUserId: String((request as any).user.actorUserId || ownerUserId), shopId: context.shop.id,
        sourceShopId: source.id, businessId, idempotencyKey: parsed.data.idempotencyKey, requestHash, requestPayload, state: 'SUBMITTING',
      } });
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error;
      const replay = await prisma.yandexOfferPublishOperation.findUnique({ where: { ownerUserId_idempotencyKey: { ownerUserId, idempotencyKey: parsed.data.idempotencyKey } } });
      if (replay?.requestHash === requestHash) return reply.send({ code: 1, msg: 'replayed', data: { id: replay.id, state: replay.state, response: replay.response, replayed: true } });
      return reply.status(409).send({ code: 0, msg: 'Yandex 发布幂等键冲突' });
    }
    try {
      const raw = await context.client.updateOfferMappings(businessId, offerMappings);
      const response = z.object({ status: z.enum(['OK', 'ERROR']) }).passthrough().parse(raw);
      const state = response.status === 'OK' ? 'SUCCEEDED' : 'REJECTED';
      const updated = await prisma.yandexOfferPublishOperation.update({ where: { id: operation.id }, data: { state, response: raw as any, errorMessage: response.status === 'OK' ? null : 'Yandex 返回 ERROR，请查看响应明细' } });
      return reply.send({ code: state === 'SUCCEEDED' ? 1 : 0, msg: state === 'SUCCEEDED' ? 'Yandex 商品目录更新已提交' : 'Yandex 拒绝商品目录更新', data: { id: updated.id, state, response: updated.response, replayed: false } });
    } catch (error) {
      const definite = error instanceof YandexMarketApiError && error.status >= 400 && error.status < 500;
      const message = definite ? error.message : 'Yandex 处理结果未知，请先读取操作记录，不要重复提交';
      const updated = await prisma.yandexOfferPublishOperation.update({ where: { id: operation.id }, data: { state: definite ? 'REJECTED' : 'UNKNOWN', errorMessage: message } });
      return reply.status(definite ? 502 : 202).send({ code: 0, msg: message, data: { id: updated.id, state: updated.state, replayed: false } });
    }
  });

  app.get('/:shopId/offers/publish-operations', async (request, reply) => {
    const context = await ownedYandexShop(request, reply); if (!context) return;
    const limit = Math.min(100, Math.max(1, Number((request.query as { limit?: string }).limit || 50) || 50));
    const rows = await prisma.yandexOfferPublishOperation.findMany({ where: { shopId: context.shop.id, ownerUserId: String((request as any).user.userId) }, orderBy: { createdAt: 'desc' }, take: limit, select: { id: true, sourceShopId: true, businessId: true, idempotencyKey: true, state: true, response: true, errorMessage: true, createdAt: true, updatedAt: true } });
    return reply.send({ code: 1, msg: 'ok', data: rows });
  });
}

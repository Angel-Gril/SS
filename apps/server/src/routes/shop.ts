import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import {
  getOzonWarehouseCoordinates,
  normalizeOzonWarehouseAddressEvidence,
  OzonClient,
} from '../services/ozon-client.js';
import {
  buildProductStatusCounts,
  getProductSyncCategory,
  getOzonPriceIndexSnapshot,
  getOzonStatusDisplay,
  getWarehouseStock,
  matchesProductListComputedFilters,
  matchesProductStatusFilter,
  normalizeOzonSku,
  resolveProductProfitSnapshot,
  type ProductProfitFilter,
  type ProductStatusFilter,
  type WarehouseStockMode,
} from '../services/product-sync-metadata.js';
import {
  normalizePromotionActions,
  normalizePromotionProducts,
  summarizePromotionDeactivateResult,
} from '../services/product-promotions.js';
import { getOzonCdnStorageBackend } from '../services/image-storage.js';
import {
  parseOzonVideoProbeDataUrl,
  probeOzonVideoUpload,
} from '../services/ozon-video-upload-probe.js';
import {
  invalidateShopLogisticsForCredentialChange,
  deliveryMethodLogisticsScopeChanged,
  invalidateWarehouseLogisticsScope,
  warehouseLogisticsScopeChanged,
  retireShopLogisticsScope,
} from '../services/logistics-scope-invalidation.js';
import {
  buildShopAnalyticsGraphsSnapshot,
  buildShopAnalyticsSummarySnapshot,
  ShopAnalyticsPayloadError,
} from '../services/shop-analytics-snapshot.js';

const createShopSchema = z.object({
  platform: z.enum(['OZON', 'YANDEX', 'KASPI', 'WILDBERRIES']),
  name: z.string().min(1).max(100),
  clientId: z.string().min(1),
  apiKey: z.string().min(1),
  apiSecret: z.string().optional(),
});

const updateShopSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  clientId: z.string().min(1).optional(),
  apiKey: z.string().min(1).optional(),
  apiSecret: z.string().optional(),
});

const promotionProductsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

const deactivatePromotionProductsSchema = z.object({
  productIds: z.array(z.coerce.number().int().positive()).min(1).max(100),
});

const OZON_VIDEO_PROBE_BODY_LIMIT = 12 * 1024 * 1024;
const extensionConfigReadRouteOptions = {
  config: {
    rateLimit: false,
  },
};

function ozonVideoProbeRouteOptions() {
  return {
    bodyLimit: OZON_VIDEO_PROBE_BODY_LIMIT,
    config: {
      rateLimit: {
        max: 3,
        timeWindow: '1 minute',
        groupId: 'ozon-video-probe',
        keyGenerator: (request: FastifyRequest) => request.ip,
        errorResponseBuilder: (_request: FastifyRequest, context: { statusCode: number }) => ({
          statusCode: context.statusCode,
          code: 0,
          msg: '视频探针请求过于频繁，请稍后再试',
        }),
      },
    },
    preHandler: [requireOzonVideoProbeAdminSession],
  };
}

async function requireOzonVideoProbeAdminSession(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const user = (request as any).user;
  if (!user || user.role !== 'ADMIN' || user.isSuperAdmin !== true) {
    return reply.status(403).send({ code: 0, msg: '需要超级管理员权限' });
  }
  if (user.tokenUse === 'account_session' && user.isSubAccount !== true) return;
  return reply.status(403).send({
    code: 0,
    errorCode: 'ozon_video_probe_account_session_required',
    msg: '视频探针仅允许超级管理员网页登录会话',
  });
}

function positiveInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.trunc(num);
}

function categoryCatalogKey(categoryId: number, typeId: number): string {
  return `${categoryId}:${typeId}`;
}

function formatCategoryCatalogLabel(row: {
  displayPathZh?: string | null;
  displayPathRu?: string | null;
  categoryNameZh?: string | null;
  categoryNameRu?: string | null;
  typeNameZh?: string | null;
  typeNameRu?: string | null;
}): string | null {
  const direct = String(row.displayPathZh || row.displayPathRu || '').trim();
  if (direct) return direct;
  const parts = [
    row.categoryNameZh || row.categoryNameRu,
    row.typeNameZh || row.typeNameRu,
  ].map((value) => String(value || '').trim()).filter(Boolean);
  return parts.length ? parts.join(' > ') : null;
}

function parseOptionalFiniteNumber(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

const PRODUCT_STATUS_FILTERS: ProductStatusFilter[] = ['current', 'archived', 'missing', 'all'];
const PRODUCT_PROFIT_FILTERS: ProductProfitFilter[] = ['all', 'unprofitable', 'medium', 'profitable', 'very_profitable', 'unknown'];

function productStatusWhere(statusFilter: ProductStatusFilter): Record<string, unknown> | null {
  if (statusFilter === 'all') return null;
  if (statusFilter === 'current') {
    return {
      NOT: [
        { visibility: { in: ['ARCHIVED', 'archived', 'MISSING', 'missing'] } },
        { syncStatus: { in: ['MISSING', 'missing'] } },
      ],
    };
  }
  if (statusFilter === 'archived') {
    return { visibility: { in: ['ARCHIVED', 'archived'] } };
  }
  return {
    OR: [
      { visibility: { in: ['MISSING', 'missing'] } },
      { syncStatus: { in: ['MISSING', 'missing'] } },
    ],
  };
}

function appendProductAndFilter(where: Record<string, unknown>, filter: Record<string, unknown> | null): Record<string, unknown> {
  if (!filter) return where;
  const existing = Array.isArray(where.AND) ? where.AND as Record<string, unknown>[] : [];
  return { ...where, AND: [...existing, filter] };
}

async function countProductStatusTabs(baseWhere: Record<string, unknown>) {
  const [current, archived, missing, all] = await Promise.all([
    prisma.product.count({ where: appendProductAndFilter(baseWhere, productStatusWhere('current')) as any }),
    prisma.product.count({ where: appendProductAndFilter(baseWhere, productStatusWhere('archived')) as any }),
    prisma.product.count({ where: appendProductAndFilter(baseWhere, productStatusWhere('missing')) as any }),
    prisma.product.count({ where: baseWhere as any }),
  ]);
  return { current, archived, missing, all };
}

type ProductBuyerCost = {
  priceCny: string;
  sourcePlatform: string | null;
  profitCny: string | null;
  marginPct: string | null;
};

async function fetchProductBuyerCosts(userId: string, platformProductIds: string[]): Promise<Map<string, ProductBuyerCost>> {
  const uniqueProductIds = Array.from(new Set(platformProductIds.map((id) => String(id || '').trim()).filter(Boolean)));
  const buyerCostByProductId = new Map<string, ProductBuyerCost>();
  if (!uniqueProductIds.length) return buyerCostByProductId;

  const quoteRows = await prisma.sourceQuote.findMany({
    where: {
      userId,
      ozonProductId: { in: uniqueProductIds },
      costCny: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      ozonProductId: true,
      costCny: true,
      sourcePlatform: true,
      profitCny: true,
      marginPct: true,
    },
  });
  for (const quote of quoteRows) {
    const productId = String(quote.ozonProductId || '').trim();
    if (!productId || buyerCostByProductId.has(productId) || !quote.costCny) continue;
    buyerCostByProductId.set(productId, {
      priceCny: quote.costCny.toString(),
      sourcePlatform: quote.sourcePlatform || null,
      profitCny: quote.profitCny?.toString() ?? null,
      marginPct: quote.marginPct?.toString() ?? null,
    });
  }

  const missingProductIds = uniqueProductIds.filter((productId) => !buyerCostByProductId.has(productId));
  if (!missingProductIds.length) return buyerCostByProductId;

  const candidateRows = await prisma.sourceCandidate.findMany({
    where: {
      userId,
      ozonProductId: { in: missingProductIds },
      sourceTotalCost: { not: null },
    },
    orderBy: { updatedAt: 'desc' },
    select: {
      ozonProductId: true,
      sourceTotalCost: true,
      sourcePlatform: true,
    },
  });
  for (const candidate of candidateRows) {
    const productId = String(candidate.ozonProductId || '').trim();
    if (!productId || buyerCostByProductId.has(productId) || !candidate.sourceTotalCost) continue;
    buyerCostByProductId.set(productId, {
      priceCny: candidate.sourceTotalCost.toString(),
      sourcePlatform: candidate.sourcePlatform || null,
      profitCny: null,
      marginPct: null,
    });
  }

  return buyerCostByProductId;
}

function enrichProductBuyerCost<T extends { platformProductId?: unknown }>(
  row: T,
  buyerCostByProductId: Map<string, ProductBuyerCost>,
): T & { buyerPriceCny?: string | null; buyerSourcePlatform?: string | null; profitCny?: string | null; profitMarginPct?: string | null } {
  const buyerCost = row.platformProductId ? buyerCostByProductId.get(String(row.platformProductId)) : null;
  return {
    ...row,
    buyerPriceCny: buyerCost?.priceCny ?? null,
    buyerSourcePlatform: buyerCost?.sourcePlatform ?? null,
    profitCny: buyerCost?.profitCny ?? null,
    profitMarginPct: buyerCost?.marginPct ?? null,
  };
}

export async function shopRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', extensionConfigReadRouteOptions, async (request) => {
    const { userId } = (request as any).user;
    const shops = await prisma.shop.findMany({
      where: { userId, status: { not: 'DISABLED' } },
      select: {
        id: true,
        platform: true,
        name: true,
        clientId: true,
        status: true,
        balance: true,
        lastSyncAt: true,
        errorMessage: true,
        createdAt: true,
        _count: { select: { products: true, orders: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      code: 1,
      msg: 'ok',
      data: shops.map((s) => ({
        ...s,
        balance: s.balance.toString(),
        productCount: s._count.products,
        orderCount: s._count.orders,
      })),
    };
  });

  app.post('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = createShopSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { platform, name, clientId, apiKey, apiSecret } = parsed.data;

    const shop = await prisma.shop.create({
      data: {
        userId,
        platform,
        name,
        clientId,
        apiKeyEncrypted: encrypt(apiKey),
        apiSecretEncrypted: apiSecret ? encrypt(apiSecret) : null,
      },
    });

    return reply.status(201).send({
      code: 1,
      msg: '店铺添加成功',
      data: { id: shop.id, platform: shop.platform, name: shop.name, status: shop.status },
    });
  });

  app.post('/:id/test', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }

    if (shop.platform !== 'OZON') {
      return reply.send({ code: 0, msg: '暂只支持 OZON 连接测试' });
    }

    const client = new OzonClient({
      clientId: shop.clientId!,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });

    const result = await client.testConnection();
    if (result.success) {
      await prisma.shop.update({
        where: { id },
        data: { status: 'ACTIVE', errorMessage: null },
      });
      return reply.send({ code: 1, msg: '连接成功', data: { name: result.name } });
    }

    await prisma.shop.update({
      where: { id },
      data: { status: 'ERROR', errorMessage: result.error },
    });
    return reply.send({ code: 0, msg: `连接失败: ${result.error}` });
  });

  app.put('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const parsed = updateShopSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }

    const credentialChanged =
      (parsed.data.clientId !== undefined && parsed.data.clientId !== shop.clientId) ||
      parsed.data.apiKey !== undefined ||
      parsed.data.apiSecret !== undefined;
    const data: Record<string, unknown> = {};
    if (parsed.data.name) data.name = parsed.data.name;
    if (parsed.data.clientId) data.clientId = parsed.data.clientId;
    if (parsed.data.apiKey) data.apiKeyEncrypted = encrypt(parsed.data.apiKey);
    if (parsed.data.apiSecret !== undefined)
      data.apiSecretEncrypted = parsed.data.apiSecret ? encrypt(parsed.data.apiSecret) : null;

    if (credentialChanged) {
      data.status = 'ERROR';
      data.errorMessage = '店铺凭证已更新，请重新测试连接';
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.shop.update({ where: { id }, data });
        await invalidateShopLogisticsForCredentialChange(tx, { tenantId: userId, shopId: id, now });
      }, { isolationLevel: 'Serializable' });
    } else {
      await prisma.shop.update({ where: { id }, data });
    }
    return reply.send({ code: 1, msg: '更新成功' });
  });

  app.get('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        id: shop.id,
        platform: shop.platform,
        name: shop.name,
        clientId: shop.clientId,
        apiKeyConfigured: Boolean(shop.apiKeyEncrypted),
        apiSecretConfigured: Boolean(shop.apiSecretEncrypted),
        status: shop.status,
        createdAt: shop.createdAt,
      },
    });
  });

  app.delete('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) {
      return reply.send({ code: 0, msg: '店铺不存在' });
    }

    try {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        await tx.shop.update({
          where: { id },
          data: { status: 'DISABLED', errorMessage: '店铺已停用' },
        });
        await retireShopLogisticsScope(tx, { tenantId: userId, shopId: id, now });
      }, { isolationLevel: 'Serializable' });
      return reply.send({ code: 1, msg: '店铺已停用，设备授权与物流规则分发已撤销' });
    } catch (e: any) {
      console.error('[Shop Delete Error]', e);
      return reply.send({ code: 0, msg: `删除失败: ${e.message?.slice(0, 300) || '数据库错误'}` });
    }
  });

  // Sync warehouses from OZON to local DB
  app.post('/:id/sync-warehouses', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }
    if (shop.platform !== 'OZON') {
      return reply.send({ code: 0, msg: '暂只支持 OZON 仓库同步' });
    }
    if (shop.status !== 'ACTIVE') {
      return reply.send({ code: 0, msg: '请先测试连接确保店铺状态正常' });
    }

    const client = new OzonClient({
      clientId: shop.clientId!,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });

    try {
      // OZON /v2/delivery-method/list 限制 limit ∈ (0, 100]，分页拉取
      async function fetchAllDeliveryMethods() {
        const all: any[] = [];
        let offset = 0;
        const pageSize = 50;
        for (let i = 0; i < 20; i++) {
          const page = await client.listDeliveryMethods({ limit: pageSize, offset });
          all.push(...page);
          if (page.length < pageSize) break;
          offset += pageSize;
        }
        return all;
      }
      const [warehouses, deliveryMethods] = await Promise.all([
        client.getWarehouseList(),
        fetchAllDeliveryMethods(),
      ]);

      const upserted = [];
      for (const wh of warehouses) {
        const fm = wh.first_mile_type;
        const coordinates = getOzonWarehouseCoordinates(wh);
        const normalizedAddress = normalizeOzonWarehouseAddressEvidence(
          wh,
          String(wh.warehouse_id),
        );
        const normalizedAddressData = normalizedAddress === undefined
          ? {}
          : normalizedAddress === null
            ? { countryCode: null, city: null, zipCode: null }
            : normalizedAddress;
        const warehouseWhere = {
          shopId_platformWarehouseId: {
            shopId: id,
            platformWarehouseId: String(wh.warehouse_id),
          },
        };
        const warehouseData = {
          name: wh.name,
          type: wh.warehouse_type || (wh.is_rfbs ? 'RFBS' : 'FBS'),
          status: wh.status,
          isRfbs: wh.is_rfbs ?? false,
          isKgt: wh.is_kgt ?? false,
          firstMileType: fm?.first_mile_type || null,
          dropOffPointId: fm?.dropoff_point_id || null,
          dropOffTimeslotId: fm?.dropoff_timeslot_id || null,
          workingDays: wh.working_days as any,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          ...normalizedAddressData,
          phone: wh.phone || null,
          rawData: wh as any,
        };
        const whMethods = deliveryMethods.filter(
          (dm) => String(dm.warehouse_id) === String(wh.warehouse_id),
        );
        const record = await prisma.$transaction(async (tx) => {
          const previousWarehouse = await tx.warehouse.findUnique({
            where: warehouseWhere,
            select: {
              id: true, platformWarehouseId: true, name: true, status: true, type: true,
              countryCode: true, city: true, street: true, zipCode: true,
              latitude: true, longitude: true, firstMileType: true, dropOffPointId: true,
              isRfbs: true, isKgt: true,
            },
          });
          const current = await tx.warehouse.upsert({
            where: warehouseWhere,
            update: warehouseData,
            create: {
              shopId: id,
              platformWarehouseId: String(wh.warehouse_id),
              ...warehouseData,
            },
          });
          const existingMethods = await tx.shopDeliveryMethod.findMany({
            where: { warehouseId: current.id },
            select: { platformMethodId: true, status: true },
          });
          let methodScopeChanged = false;

          for (const dm of whMethods) {
            const deliveryMethodWhere = {
              warehouseId_platformMethodId: {
                warehouseId: current.id,
                platformMethodId: dm.id,
              },
            };
            const deliveryMethodData = {
              name: dm.name,
              status: dm.status,
              providerId: dm.provider_id,
              providerName: dm.provider_name || null,
              tplDropoffPointId: dm.tpl_dropoff_point_id != null
                ? String(dm.tpl_dropoff_point_id)
                : (dm.tpl_dropoff_point?.code ? String(dm.tpl_dropoff_point.code) : null),
              cutoff: dm.cutoff || null,
              slaCutIn: dm.sla_cut_in || null,
              tplIntegrationType: dm.tpl_integration_type || null,
              dropOffPointAddress: dm.tpl_dropoff_point?.address || null,
              dropOffPointName: dm.tpl_dropoff_point?.name || null,
              rawData: dm as any,
            };
            const previousMethod = await tx.shopDeliveryMethod.findUnique({
              where: deliveryMethodWhere,
              select: {
                name: true,
                status: true,
                providerId: true,
                providerName: true,
                tplDropoffPointId: true,
                cutoff: true,
                slaCutIn: true,
                tplIntegrationType: true,
                dropOffPointAddress: true,
                dropOffPointName: true,
              },
            });
            await tx.shopDeliveryMethod.upsert({
              where: deliveryMethodWhere,
              update: deliveryMethodData,
              create: {
                warehouseId: current.id,
                platformMethodId: dm.id,
                ...deliveryMethodData,
              },
            });
            methodScopeChanged ||= Boolean(
              previousMethod &&
              deliveryMethodLogisticsScopeChanged(previousMethod, deliveryMethodData),
            );
          }

          const returnedMethodIds = new Set(whMethods.map((dm) => Number(dm.id)));
          const missingMethodIds = existingMethods
            .filter((method) =>
              !returnedMethodIds.has(method.platformMethodId) &&
              String(method.status || '').trim().toLowerCase() !== 'missing')
            .map((method) => method.platformMethodId);
          if (missingMethodIds.length > 0) {
            await tx.shopDeliveryMethod.updateMany({
              where: {
                warehouseId: current.id,
                platformMethodId: { in: missingMethodIds },
              },
              data: { status: 'missing' },
            });
            methodScopeChanged = true;
          }

          const originScopeChanged = Boolean(
            previousWarehouse &&
            warehouseLogisticsScopeChanged(
              { ...warehouseData, ...previousWarehouse },
              { ...previousWarehouse, ...warehouseData },
            ),
          );
          if (originScopeChanged || methodScopeChanged) {
            await invalidateWarehouseLogisticsScope(tx, {
              tenantId: userId,
              shopId: id,
              warehouseId: current.id,
              invalidateOriginBinding: originScopeChanged,
              now: new Date(),
            });
          }
          return current;
        }, { isolationLevel: 'Serializable' });
        upserted.push(record);
      }

      return reply.send({
        code: 1,
        msg: `成功同步 ${upserted.length} 个仓库、${deliveryMethods.length} 个物流方式`,
        data: upserted,
      });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `仓库同步失败: ${e.message}` });
    }
  });

  // List warehouses from local DB
  app.get('/:id/warehouses', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }

    const warehouses = await prisma.warehouse.findMany({
      where: { shopId: id },
      include: { deliveryMethods: true },
      orderBy: { createdAt: 'asc' },
    });

    return reply.send({ code: 1, msg: 'ok', data: warehouses });
  });

  // 编辑仓库并推送到 OZON
  app.patch('/:id/warehouses/:warehouseId/push', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id, warehouseId } = request.params as { id: string; warehouseId: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });

    const wh = await prisma.warehouse.findFirst({ where: { id: warehouseId, shopId: id } });
    if (!wh) return reply.status(404).send({ code: 0, msg: '仓库不存在' });
    if (!wh.platformWarehouseId) return reply.status(400).send({ code: 0, msg: '仓库缺少平台 ID' });

    const body = request.body as { name?: string; phone?: string; latitude?: number; longitude?: number };
    const client = new OzonClient({ clientId: shop.clientId!, apiKey: decrypt(shop.apiKeyEncrypted) });

    try {
      const payload: any = {
        warehouse_id: Number(wh.platformWarehouseId),
      };
      if (body.name) payload.name = body.name;
      if (body.phone) payload.phone = body.phone;
      if (body.latitude != null && body.longitude != null) {
        payload.address_coordinates = { latitude: body.latitude, longitude: body.longitude };
      }

      const warehouseData = {
        name: body.name ?? wh.name,
        phone: body.phone ?? wh.phone,
        latitude: body.latitude ?? wh.latitude,
        longitude: body.longitude ?? wh.longitude,
      };
      const scopeChanged = warehouseLogisticsScopeChanged(
        wh,
        { ...wh, ...warehouseData },
      );
      if (scopeChanged) {
        await prisma.$transaction(async (tx) => {
          await invalidateWarehouseLogisticsScope(tx, {
            tenantId: userId,
            shopId: id,
            warehouseId,
            invalidateOriginBinding: true,
            now: new Date(),
          });
        }, { isolationLevel: 'Serializable' });
      }

      const result = await client.updateWarehouseErfbs(payload);
      await prisma.warehouse.update({ where: { id: warehouseId }, data: warehouseData });

      return reply.send({ code: 1, msg: '已推送到 OZON', data: { operationId: result.operation_id } });
    } catch (e: any) {
      return reply.status(502).send({ code: 0, msg: `推送失败: ${e.message}` });
    }
  });

  // 更新仓库的物流方式并推送到 OZON
  app.patch('/:id/warehouses/:warehouseId/delivery-method/push', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id, warehouseId } = request.params as { id: string; warehouseId: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });

    const wh = await prisma.warehouse.findFirst({ where: { id: warehouseId, shopId: id } });
    if (!wh) return reply.status(404).send({ code: 0, msg: '仓库不存在' });
    if (!wh.platformWarehouseId) return reply.status(400).send({ code: 0, msg: '仓库缺少平台 ID' });

    const body = request.body as { delivery_method: any };
    if (!body?.delivery_method) return reply.status(400).send({ code: 0, msg: '缺少 delivery_method' });

    const client = new OzonClient({ clientId: shop.clientId!, apiKey: decrypt(shop.apiKeyEncrypted) });

    try {
      const isRfbs = wh.isRfbs || wh.type === 'RFBS';
      const payload = { warehouse_id: Number(wh.platformWarehouseId), delivery_method: body.delivery_method };
      await prisma.$transaction(async (tx) => {
        await invalidateWarehouseLogisticsScope(tx, {
          tenantId: userId,
          shopId: id,
          warehouseId,
          invalidateOriginBinding: false,
          now: new Date(),
        });
      }, { isolationLevel: 'Serializable' });

      const result = isRfbs
        ? await client.updateAggregatorDeliveryMethod(payload)
        : await client.updateNonIntegratedDeliveryMethod(payload);

      return reply.send({ code: 1, msg: '物流方式已推送到 OZON', data: { operationId: result.operation_id } });
    } catch (e: any) {
      return reply.status(502).send({ code: 0, msg: `推送失败: ${e.message}` });
    }
  });

  // 获取 OZON 代收点列表（旧接口，PVZ/官方取货点）
  app.get('/:id/delivery-points', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    if (!shop.clientId) return reply.status(400).send({ code: 0, msg: '店铺未配置凭证' });

    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
    try {
      const points = await client.listDeliveryPoints();
      return reply.send({ code: 1, msg: 'ok', data: points });
    } catch (e: any) {
      return reply.status(502).send({ code: 0, msg: `获取代收点失败: ${e.message}` });
    }
  });

  // 搜索 FBS drop-off 点（创建仓库时按地址搜索）
  app.post('/:id/drop-off-points/search', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as {
      address?: string;
      coordinates?: { latitude: number; longitude: number };
      types?: string[];
      warehouseId?: number;
    };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    if (!shop.clientId) return reply.status(400).send({ code: 0, msg: '店铺未配置凭证' });

    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
    try {
      const points = await client.searchFbsDropOffPoints({
        address: body?.address,
        coordinates: body?.coordinates,
        types: body?.types,
        warehouseId: body?.warehouseId,
      });
      return reply.send({ code: 1, msg: 'ok', data: points });
    } catch (e: any) {
      return reply.status(502).send({ code: 0, msg: `搜索代收点失败: ${e.message}` });
    }
  });

  // 搜索 FBS 退货点
  app.post('/:id/return-points/search', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as {
      address?: string;
      coordinates?: { latitude: number; longitude: number };
      countryCode?: string;
      types?: string[];
      limit?: number;
      lastId?: number;
      selectedDropoffPointId?: number;
    };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    if (!shop.clientId) return reply.status(400).send({ code: 0, msg: '店铺未配置凭证' });

    const client = new OzonClient({ clientId: shop.clientId, apiKey: decrypt(shop.apiKeyEncrypted) });
    try {
      const points = await client.listFbsReturnPoints(body || {});
      return reply.send({ code: 1, msg: 'ok', data: points });
    } catch (e: any) {
      return reply.status(502).send({ code: 0, msg: `搜索退货点失败: ${e.message}` });
    }
  });

  // 用户应用模板创建/更新 OZON 仓库
  app.post('/:id/warehouses/apply-template', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as {
      templateId: string;
      // 用户私有字段
      name: string;
      phone: string;
      countryCode: string;
      city: string;
      street: string;
      zipCode: string;
      building: string;
      block?: string;
      latitude: number;
      longitude: number;
      returnRecipient?: string;
      returnPhone?: string;
      // 已有仓库 ID（更新时传）
      warehouseId?: string;
    };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    if (shop.platform !== 'OZON') return reply.send({ code: 0, msg: '暂只支持 OZON' });
    if (shop.status !== 'ACTIVE') return reply.send({ code: 0, msg: '请先测试连接' });

    const tpl = await prisma.warehouseTemplate.findUnique({ where: { id: body.templateId } });
    if (!tpl) return reply.status(404).send({ code: 0, msg: '模板不存在' });

    const client = new OzonClient({ clientId: shop.clientId!, apiKey: decrypt(shop.apiKeyEncrypted) });

    // 构造工作日时段（用模板的 from-to 应用到所有勾选的工作日）
    const workingDaysList = (tpl.workingDays as string[]) || [];
    const workingDays = workingDaysList.map((day) => ({
      day,
      from: tpl.workingHourFrom,
      to: tpl.workingHourTo,
    }));
    const holidays = (tpl.holidays as Array<{ day: string; from?: string; to?: string }>) || [];

    const payload: any = {
      name: body.name,
      phone: body.phone,
      address_coordinates: { latitude: body.latitude, longitude: body.longitude },
      timetable_warehouse: {
        working_days: workingDays,
        holidays: holidays.map((h) => ({ day: h.day, from: h.from || '00:00', to: h.to || '23:59' })),
      },
    };

    if (tpl.warehouseType === 'fbs') {
      // 标准 FBS（自送/第三方）
      payload.is_auto_assembly = (tpl.warehouseOptions as any)?.is_auto_assembly ?? false;
      payload.delivery_method = {
        return_settings: {
          return_method: tpl.returnMethod || 'COURIER',
          post_office_zipcode: tpl.returnZipCode || body.zipCode,
        },
      };
    } else {
      // aggregator / Ozon Partners
      payload.first_mile_type = tpl.firstMileType;
      if (tpl.dropOffPointId) payload.drop_off_point_id = Number(tpl.dropOffPointId);
      payload.cut_in_time = tpl.cutInTime;
      payload.timeslot_id = tpl.timeslotId;
      if (tpl.returnPointId) payload.return_point_id = Number(tpl.returnPointId);
      payload.is_kgt = tpl.isKgt;
      payload.options = tpl.warehouseOptions || {};
      payload.working_days = workingDaysList;
    }

    try {
      let opResult;
      let warehouseRecord;
      if (body.warehouseId) {
        const existing = await prisma.warehouse.findFirst({ where: { id: body.warehouseId, shopId: id } });
        if (!existing?.platformWarehouseId) return reply.status(400).send({ code: 0, msg: '仓库平台 ID 缺失' });
        const warehouseData = {
          name: body.name,
          phone: body.phone,
          countryCode: body.countryCode,
          city: body.city,
          street: body.street,
          zipCode: body.zipCode,
          building: body.building,
          block: body.block,
          latitude: body.latitude,
          longitude: body.longitude,
          templateId: tpl.id,
          returnRecipient: body.returnRecipient,
          returnPhone: body.returnPhone,
        };
        const scopeChanged = warehouseLogisticsScopeChanged(existing, { ...existing, ...warehouseData });
        if (scopeChanged) {
          await prisma.$transaction(async (tx) => {
            await invalidateWarehouseLogisticsScope(tx, {
              tenantId: userId,
              shopId: id,
              warehouseId: body.warehouseId!,
              invalidateOriginBinding: true,
              now: new Date(),
            });
          }, { isolationLevel: 'Serializable' });
        }
        opResult = await client.updateFbsWarehouse({ ...payload, warehouse_id: Number(existing.platformWarehouseId) });
        warehouseRecord = await prisma.warehouse.update({
          where: { id: body.warehouseId },
          data: warehouseData,
        });
      } else {
        opResult = await client.createFbsWarehouse(payload);
        warehouseRecord = await prisma.warehouse.create({
          data: {
            shopId: id,
            name: body.name,
            type: tpl.warehouseType === 'fbs' ? 'FBS' : 'RFBS',
            status: 'pending',
            phone: body.phone,
            countryCode: body.countryCode,
            city: body.city,
            street: body.street,
            zipCode: body.zipCode,
            building: body.building,
            block: body.block,
            latitude: body.latitude,
            longitude: body.longitude,
            templateId: tpl.id,
            returnRecipient: body.returnRecipient,
            returnPhone: body.returnPhone,
            workingDays: tpl.workingDays as any,
            warehouseOptions: tpl.warehouseOptions as any,
            firstMileType: tpl.firstMileType,
            dropOffPointId: tpl.dropOffPointId,
            isKgt: tpl.isKgt,
          },
        });
      }
      return reply.send({ code: 1, msg: '已提交到 OZON', data: { warehouse: warehouseRecord, operationId: opResult.operation_id } });
    } catch (e: any) {
      return reply.status(502).send({ code: 0, msg: `推送失败: ${e.message}` });
    }
  });

  app.post('/:id/sync-products', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }

    if (shop.platform !== 'OZON') {
      return reply.send({ code: 0, msg: '暂只支持 OZON 商品同步' });
    }

    if (shop.status !== 'ACTIVE') {
      return reply.send({ code: 0, msg: '请先测试连接确保店铺状态正常' });
    }

    const { addProductSyncJob } = await import('../workers/product-sync.js');
    const job = await addProductSyncJob(shop.id);

    return reply.send({
      code: 1,
      msg: '同步任务已创建',
      data: { jobId: job.id },
    });
  });

  app.get('/:id/promotions/actions', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    if (shop.platform !== 'OZON') return reply.send({ code: 0, msg: '暂只支持 OZON 促销活动' });
    if (shop.status !== 'ACTIVE') return reply.send({ code: 0, msg: '请先测试连接确保店铺状态正常' });

    try {
      const client = new OzonClient({ clientId: shop.clientId!, apiKey: decrypt(shop.apiKeyEncrypted) });
      const raw = await client.getPromotionActions();
      return reply.send({ code: 1, msg: 'ok', data: { actions: normalizePromotionActions(raw) } });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `OZON 促销活动读取失败: ${e.message}` });
    }
  });

  app.get('/:id/promotions/actions/:actionId/products', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id, actionId } = request.params as { id: string; actionId: string };
    const parsed = promotionProductsQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const numericActionId = Number(actionId);
    if (!Number.isInteger(numericActionId) || numericActionId <= 0) {
      return reply.status(400).send({ code: 0, msg: '活动 ID 无效' });
    }

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    if (shop.platform !== 'OZON') return reply.send({ code: 0, msg: '暂只支持 OZON 促销活动' });
    if (shop.status !== 'ACTIVE') return reply.send({ code: 0, msg: '请先测试连接确保店铺状态正常' });

    try {
      const client = new OzonClient({ clientId: shop.clientId!, apiKey: decrypt(shop.apiKeyEncrypted) });
      const raw = await client.getPromotionProducts(numericActionId, {
        limit: parsed.data.limit,
        offset: parsed.data.offset,
      });
      const preliminary = normalizePromotionProducts(raw);
      const localProducts = preliminary.products.length
        ? await prisma.product.findMany({
          where: {
            shopId: shop.id,
            platformProductId: { in: preliminary.products.map((product) => String(product.productId)) },
          },
          select: { platformProductId: true, title: true, offerId: true, images: true },
        })
        : [];
      const localByProductId = new Map(localProducts.map((product) => [String(product.platformProductId), product]));
      return reply.send({
        code: 1,
        msg: 'ok',
        data: normalizePromotionProducts(raw, localByProductId),
      });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `OZON 活动商品读取失败: ${e.message}` });
    }
  });

  app.post('/:id/promotions/actions/:actionId/deactivate-products', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id, actionId } = request.params as { id: string; actionId: string };
    const parsed = deactivatePromotionProductsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const numericActionId = Number(actionId);
    if (!Number.isInteger(numericActionId) || numericActionId <= 0) {
      return reply.status(400).send({ code: 0, msg: '活动 ID 无效' });
    }

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    if (shop.platform !== 'OZON') return reply.send({ code: 0, msg: '暂只支持 OZON 促销活动' });
    if (shop.status !== 'ACTIVE') return reply.send({ code: 0, msg: '请先测试连接确保店铺状态正常' });

    try {
      const client = new OzonClient({ clientId: shop.clientId!, apiKey: decrypt(shop.apiKeyEncrypted) });
      const raw = await client.deactivatePromotionProducts(numericActionId, parsed.data.productIds);
      const summary = summarizePromotionDeactivateResult(raw, parsed.data.productIds);
      if (summary.successCount > 0) {
        const { addProductSyncJob } = await import('../workers/product-sync.js');
        await addProductSyncJob(shop.id, {
          jobId: `post-promotion-deactivate-${shop.id}-${numericActionId}-${Date.now()}`,
          delayMs: 5000,
        }).catch((error: any) => {
          console.warn(`[promotions] failed to queue product sync for shop=${shop.id}:`, error?.message || error);
        });
      }
      return reply.send({
        code: summary.failureCount && !summary.successCount ? 0 : 1,
        msg: summary.failureCount
          ? `已移出 ${summary.successCount} 件，${summary.failureCount} 件失败`
          : `已移出 ${summary.successCount} 件商品`,
        data: summary,
      });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `OZON 移出促销活动失败: ${e.message}` });
    }
  });

  // 接收扩展推送的分析数据
  app.post('/:id/analytics', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });

    let snapshotData;
    try {
      snapshotData = buildShopAnalyticsSummarySnapshot(request.body);
    } catch (error) {
      if (!(error instanceof ShopAnalyticsPayloadError)) throw error;
      return reply.status(400).send({ code: 0, msg: '无分析数据' });
    }

    const snapshot = await prisma.shopAnalyticsSnapshot.create({
      data: {
        shopId: id,
        ...snapshotData,
      },
    });

    return reply.send({
      code: 1,
      msg: `已保存 ${snapshotData.productCount} 条分析数据`,
      data: { id: snapshot.id, productCount: snapshotData.productCount },
    });
  });

  // 获取店铺分析数据
  app.get('/:id/analytics', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });

    // 获取最新的非 graphs 类型快照（what_to_sell 数据）
    // 注意：data 可能是原始数组（旧格式）或 { type: 'what_to_sell', items: [...] }（新格式）
    // Prisma JSON path 对数组做 NOT 过滤不可靠，改用应用层过滤
    const allSnapshots = await prisma.shopAnalyticsSnapshot.findMany({
      where: { shopId: id },
      orderBy: { syncedAt: 'desc' },
      take: 50,
    });

    const nonGraphSnapshots = allSnapshots.filter((s) => {
      const d = s.data as any;
      if (!d) return false;
      if (Array.isArray(d)) return true;
      if (typeof d === 'object' && d.type === 'graphs') return false;
      return true;
    });

    const latest = nonGraphSnapshots[0] || null;

    // 获取历史快照列表（最近10次，排除 graphs 类型）
    const history = nonGraphSnapshots.slice(0, 10).map((h) => ({
      id: h.id,
      period: h.period,
      productCount: h.productCount,
      totalSales: h.totalSales?.toString() ?? null,
      totalOrders: h.totalOrders,
      syncedAt: h.syncedAt,
    }));

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        latest: latest
          ? {
              ...latest,
              totalSales: latest.totalSales?.toString() ?? null,
            }
          : null,
        history,
      },
    });
  });

  // 接收 graphs-old 的时间序列 + SKU 表格数据（支持 V3 格式）
  app.post('/:id/analytics-graphs', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });

    let built;
    try {
      built = buildShopAnalyticsGraphsSnapshot(request.body);
    } catch (error) {
      if (!(error instanceof ShopAnalyticsPayloadError)) throw error;
      return reply.status(400).send({ code: 0, msg: '无分析数据' });
    }

    const snapshot = await prisma.shopAnalyticsSnapshot.create({
      data: {
        shopId: id,
        ...built.snapshot,
      },
    });

    return reply.send({
      code: 1,
      msg: `已保存 V${built.responseVersion} 数据: ${built.snapshot.productCount} 条SKU`,
      data: { id: snapshot.id },
    });
  });

  // 获取 graphs 数据（供前端图表展示）
  app.get('/:id/analytics-graphs', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });

    const latest = await prisma.shopAnalyticsSnapshot.findFirst({
      where: {
        shopId: id,
        data: { path: ['type'], equals: 'graphs' },
      },
      orderBy: { syncedAt: 'desc' },
    });

    if (!latest) {
      return reply.send({ code: 1, msg: 'ok', data: null });
    }

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        ...latest,
        totalSales: latest.totalSales?.toString() ?? null,
      },
    });
  });

  app.get('/:id/products', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const query = request.query as {
      offset?: string;
      limit?: string;
      search?: string;
      warehouseId?: string;
      warehouseInStock?: string;
      warehouseStockMode?: string;
      priceMin?: string;
      priceMax?: string;
      weightMin?: string;
      weightMax?: string;
      stockMin?: string;
      stockMax?: string;
      statusFilter?: string;
      profitFilter?: string;
      ozonPriceIndexFilter?: string;
    };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }

    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
    const search = query.search?.trim();
    const warehouseId = query.warehouseId && /^\d+$/.test(query.warehouseId) ? query.warehouseId : null;
    const requestedWarehouseStockMode = ['all', 'in_stock', 'out_of_stock'].includes(query.warehouseStockMode || '')
      ? query.warehouseStockMode as WarehouseStockMode
      : 'all';
    const warehouseStockMode: WarehouseStockMode = warehouseId
      ? (query.warehouseInStock === '1' ? 'in_stock' : requestedWarehouseStockMode)
      : 'all';
    const profitFilter = PRODUCT_PROFIT_FILTERS.includes(query.profitFilter as ProductProfitFilter)
      ? query.profitFilter as ProductProfitFilter
      : 'all';
    const ozonPriceIndexFilter = PRODUCT_PROFIT_FILTERS.includes(query.ozonPriceIndexFilter as ProductProfitFilter)
      ? query.ozonPriceIndexFilter as ProductProfitFilter
      : 'all';
    const computedFilters = {
      priceMin: parseOptionalFiniteNumber(query.priceMin),
      priceMax: parseOptionalFiniteNumber(query.priceMax),
      weightMin: parseOptionalFiniteNumber(query.weightMin),
      weightMax: parseOptionalFiniteNumber(query.weightMax),
      stockMin: parseOptionalFiniteNumber(query.stockMin),
      stockMax: parseOptionalFiniteNumber(query.stockMax),
      warehouseId,
      warehouseStockMode,
      profitFilter,
      ozonPriceIndexFilter,
    };
    const hasComputedFilters = Object.entries(computedFilters).some(([key, value]) => (
      key === 'warehouseStockMode' || key === 'profitFilter' || key === 'ozonPriceIndexFilter'
        ? value !== 'all'
        : key !== 'warehouseId' && value != null
    ));
    const statusFilter = PRODUCT_STATUS_FILTERS.includes(query.statusFilter as ProductStatusFilter)
      ? query.statusFilter! as ProductStatusFilter
      : 'current';

    const andFilters: Record<string, unknown>[] = [];
    if (search) {
      andFilters.push({ OR: [
        { title: { contains: search, mode: 'insensitive' } },
        { sku: { contains: search, mode: 'insensitive' } },
        { offerId: { contains: search, mode: 'insensitive' } },
      ] });
    }
    const baseWhere: Record<string, unknown> = { shopId: id };
    if (andFilters.length) baseWhere.AND = andFilters;
    const where = appendProductAndFilter(baseWhere, productStatusWhere(statusFilter));

    const productSelect = {
      id: true,
      platformProductId: true,
      sku: true,
      offerId: true,
      title: true,
      price: true,
      oldPrice: true,
      currency: true,
      stock: true,
      weight: true,
      images: true,
      status: true,
      visibility: true,
      syncStatus: true,
      categoryId: true,
      commissionRate: true,
      minPrice: true,
      variants: true,
      ozonCreatedAt: true,
      ozonUpdatedAt: true,
      lastOzonSyncAt: true,
      createdAt: true,
      updatedAt: true,
    };
    const productOrderBy = [
      { ozonCreatedAt: { sort: 'desc' as const, nulls: 'last' as const } },
      { createdAt: 'desc' as const },
    ];

    let total: number;
    let rows: any[];
    let statusCounts: { current: number; archived: number; missing: number; all: number };
    let buyerCostByProductId = new Map<string, ProductBuyerCost>();
    if (hasComputedFilters) {
      const allRows = await prisma.product.findMany({
        where: baseWhere as any,
        orderBy: productOrderBy,
        select: productSelect,
      });
      if (profitFilter !== 'all') {
        buyerCostByProductId = await fetchProductBuyerCosts(
          userId,
          allRows.map((row) => String(row.platformProductId || '').trim()).filter(Boolean),
        );
      }
      const filterRows = profitFilter === 'all'
        ? allRows
        : allRows.map((row) => enrichProductBuyerCost(row, buyerCostByProductId));
      const filtered = filterRows.filter((row) => matchesProductListComputedFilters(row, computedFilters));
      statusCounts = buildProductStatusCounts(filtered);
      const statusRows = filtered.filter((row) => matchesProductStatusFilter(row, statusFilter));
      total = statusCounts[statusFilter];
      rows = statusRows.slice(offset, offset + limit);
    } else {
      [statusCounts, rows] = await Promise.all([
        countProductStatusTabs(baseWhere),
        prisma.product.findMany({
          where: where as any,
          skip: offset,
          take: limit,
          orderBy: productOrderBy,
          select: productSelect,
        }),
      ]);
      total = statusCounts[statusFilter];
    }

    const categoryPairs = rows.map((row) => {
      const syncCategory = getProductSyncCategory(row.variants);
      const descriptionCategoryId = positiveInt(row.categoryId) ?? syncCategory?.descriptionCategoryId ?? null;
      const typeId = syncCategory?.typeId ?? null;
      return descriptionCategoryId && typeId ? { descriptionCategoryId, typeId } : null;
    }).filter((row): row is { descriptionCategoryId: number; typeId: number } => !!row);
    const uniqueCategoryPairs = Array.from(
      new Map(categoryPairs.map((row) => [categoryCatalogKey(row.descriptionCategoryId, row.typeId), row])).values(),
    );
    const categoryCatalogRows = uniqueCategoryPairs.length
      ? await prisma.ozonCategoryCatalog.findMany({
        where: {
          shopId: id,
          language: 'DEFAULT',
          OR: uniqueCategoryPairs.map((row) => ({
            descriptionCategoryId: row.descriptionCategoryId,
            typeId: row.typeId,
          })),
        },
        select: {
          descriptionCategoryId: true,
          typeId: true,
          displayPathZh: true,
          displayPathRu: true,
          categoryNameZh: true,
          categoryNameRu: true,
          typeNameZh: true,
          typeNameRu: true,
        },
      })
      : [];
    const categoryCatalogByKey = new Map(
      categoryCatalogRows.map((row) => [categoryCatalogKey(row.descriptionCategoryId, row.typeId), formatCategoryCatalogLabel(row)]),
    );
    const platformProductIds = rows
      .map((row) => String(row.platformProductId || '').trim())
      .filter((value) => value);
    const missingBuyerCostIds = platformProductIds.filter((productId) => !buyerCostByProductId.has(productId));
    if (missingBuyerCostIds.length) {
      const pageBuyerCosts = await fetchProductBuyerCosts(userId, missingBuyerCostIds);
      for (const [productId, cost] of pageBuyerCosts) {
        buyerCostByProductId.set(productId, cost);
      }
    }

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        total,
        rows: rows.map((r) => {
          const { variants, ...rest } = r;
          const statusDisplay = getOzonStatusDisplay(variants, r.status);
          const ozonPrice = getOzonPriceIndexSnapshot(variants);
          const warehouseStock = warehouseId ? getWarehouseStock(variants, warehouseId) : null;
          const syncCategory = getProductSyncCategory(variants);
          const descriptionCategoryId = positiveInt(r.categoryId) ?? syncCategory?.descriptionCategoryId ?? null;
          const typeId = syncCategory?.typeId ?? null;
          const categoryLabel = descriptionCategoryId && typeId
            ? categoryCatalogByKey.get(categoryCatalogKey(descriptionCategoryId, typeId)) || null
            : null;
          const buyerCost = r.platformProductId ? buyerCostByProductId.get(String(r.platformProductId)) : null;
          const profit = resolveProductProfitSnapshot({
            ...r,
            buyerPriceCny: buyerCost?.priceCny ?? null,
            profitCny: buyerCost?.profitCny ?? null,
            profitMarginPct: buyerCost?.marginPct ?? null,
          });
          return {
            ...rest,
            sku: normalizeOzonSku(r.sku),
            categoryId: descriptionCategoryId != null ? String(descriptionCategoryId) : null,
            categoryTypeId: typeId != null ? String(typeId) : null,
            categoryLabel,
            price: r.price?.toString() ?? null,
            oldPrice: r.oldPrice?.toString() ?? null,
            commissionRate: r.commissionRate?.toString() ?? null,
            minPrice: r.minPrice?.toString() ?? null,
            buyerPriceCny: buyerCost?.priceCny ?? null,
            buyerSourcePlatform: buyerCost?.sourcePlatform ?? null,
            profitCny: profit.profitCny != null ? profit.profitCny.toFixed(2) : null,
            profitMarginPct: profit.marginPct != null ? profit.marginPct.toFixed(2) : null,
            profitTier: profit.tier,
            ozonStatusName: statusDisplay.name,
            ozonStatusDescription: statusDisplay.description,
            ozonModerateStatus: statusDisplay.moderateStatus,
            ozonStatusTone: statusDisplay.tone,
            ozonPriceIndexTier: ozonPrice?.tier ?? 'unknown',
            ozonPriceIndexColor: ozonPrice?.color ?? 'unknown',
            marketingPrice: ozonPrice?.marketingPrice != null ? ozonPrice.marketingPrice.toFixed(2) : null,
            competitorMinPrice: ozonPrice?.competitorMinPrice != null ? ozonPrice.competitorMinPrice.toFixed(2) : null,
            competitorCurrency: ozonPrice?.competitorCurrency ?? null,
            warehouseStock,
          };
        }),
        lastSyncAt: shop.lastSyncAt,
        statusFilter,
        statusCounts,
      },
    });
  });

  // ─── OZON CDN 认证（cookie + companyId）按店铺存储 ───
  app.put('/:id/ozon-cdn-auth', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as { cookie?: string; companyId?: string | number };

    if (!body?.cookie && body?.companyId == null) {
      return reply.status(400).send({ code: 0, msg: '缺少 cookie 或 companyId' });
    }

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });

    const existingConfig = (shop.config as any) || {};
    const newConfig: any = { ...existingConfig };
    if (body.cookie) newConfig.ozonCdnCookie = body.cookie;
    if (body.companyId != null) newConfig.ozonCompanyId = String(body.companyId);
    newConfig.ozonCdnUpdatedAt = new Date().toISOString();

    await prisma.shop.update({ where: { id }, data: { config: newConfig } });
    return reply.send({
      code: 1,
      msg: '已保存',
      data: {
        hasCookie: !!newConfig.ozonCdnCookie,
        companyId: newConfig.ozonCompanyId || null,
        updatedAt: newConfig.ozonCdnUpdatedAt,
      },
    });
  });

  app.get('/:id/ozon-cdn-auth', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    const config = (shop.config as any) || {};
    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        hasCookie: !!config.ozonCdnCookie,
        companyId: config.ozonCompanyId || null,
        updatedAt: config.ozonCdnUpdatedAt || null,
      },
    });
  });

  app.post('/:id/ozon-video-probe', ozonVideoProbeRouteOptions(), async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = (request.body || {}) as { dataUrl?: string; filename?: string };

    const shop = await prisma.shop.findFirst({ where: { id, userId, status: { not: 'DISABLED' } } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    if (shop.platform !== 'OZON') {
      return reply.status(400).send({ code: 0, msg: '视频探针仅支持 OZON 店铺' });
    }

    let payload: ReturnType<typeof parseOzonVideoProbeDataUrl> | null = null;
    if (body.dataUrl) {
      try {
        payload = parseOzonVideoProbeDataUrl(body.dataUrl, body.filename);
      } catch (e: any) {
        return reply.status(400).send({ code: 0, msg: e?.message || '视频探针文件格式错误' });
      }
    }

    try {
      const backend = await getOzonCdnStorageBackend(id);
      const result = await probeOzonVideoUpload({
        backend,
        ownerId: userId,
        ...(payload ? {
          buffer: payload.buffer,
          filename: payload.filename,
          mimeType: payload.mimeType,
        } : {}),
      });
      return reply.send({
        code: 1,
        msg: result.ok ? '视频探针完成：可自动挂载商品视频' : '视频探针完成：暂不可自动挂载商品视频',
        data: result,
      });
    } catch (e: any) {
      const msg = e?.message || '视频探针初始化失败';
      const status = /cookie|company_id|登录态|未同步/i.test(String(msg)) ? 400 : 500;
      return reply.status(status).send({ code: 0, msg });
    }
  });
}

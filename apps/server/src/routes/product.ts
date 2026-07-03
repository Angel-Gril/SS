import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient } from '../services/ozon-client.js';
import { calculateBatchPrice } from '../services/product-pricing.js';
import { getProductMutationBlockReason, resolveOzonBatchUpdateResults } from '../services/product-operations.js';
import {
  buildProductSyncMeta,
  getProductSyncCategory,
  resolveOzonProductImages,
  resolveOzonSalesCommissionPercent,
} from '../services/product-sync-metadata.js';

const updatePriceSchema = z.object({
  price: z.string().min(1),
  oldPrice: z.string().optional(),
  minPrice: z.string().optional(),
});

const updateStockSchema = z.object({
  stock: z.number().int().min(0),
  warehouseId: z.number().int().positive().optional(),
});

const batchPriceSchema = z.object({
  items: z.array(z.object({
    productId: z.string(),
    price: z.string().min(1),
    oldPrice: z.string().optional(),
    minPrice: z.string().optional(),
  })).min(1).max(100).optional(),
  productIds: z.array(z.string()).min(1).max(100).optional(),
  mode: z.enum(['set', 'multiply', 'discount', 'increase']).optional(),
  value: z.coerce.number().optional(),
}).refine((data) => {
  if (data.items?.length) return true;
  return !!data.productIds?.length && !!data.mode && data.value !== undefined;
}, '请提供价格数据');

const batchStockSchema = z.object({
  items: z.array(z.object({
    productId: z.string(),
    stock: z.number().int().min(0),
  })).min(1).max(100),
  warehouseId: z.number().int().positive('请选择有效仓库'),
});

const archiveSchema = z.object({
  productIds: z.array(z.string()).min(1).max(100),
  archive: z.boolean(),
});

export async function productRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.put('/:id/price', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const parsed = updatePriceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const product = await prisma.product.findFirst({
      where: { id },
      include: { shop: { select: { id: true, userId: true, platform: true, clientId: true, apiKeyEncrypted: true } } },
    });
    if (!product || product.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '商品不存在' });
    }
    if (product.shop.platform !== 'OZON') {
      return reply.send({ code: 0, msg: '暂只支持 OZON 商品价格修改' });
    }
    const blockReason = getProductMutationBlockReason(product);
    if (blockReason) {
      return reply.send({ code: 0, msg: blockReason });
    }

    const client = new OzonClient({
      clientId: product.shop.clientId!,
      apiKey: decrypt(product.shop.apiKeyEncrypted),
    });

    const { price, oldPrice, minPrice } = parsed.data;
    const platformId = Number(product.platformProductId);

    try {
      const result = await client.updatePrices([{
        product_id: platformId,
        price,
        old_price: oldPrice || price,
        min_price: minPrice,
        currency_code: product.currency || 'CNY',
      }]);
      const updateResult = resolveOzonBatchUpdateResults(result, 1);
      if (updateResult.errors.length) {
        return reply.send({ code: 0, msg: `OZON 拒绝更新价格: ${updateResult.errors[0]!.message}` });
      }
    } catch (e: any) {
      return reply.send({ code: 0, msg: `OZON 价格同步失败: ${e.message}` });
    }

    await prisma.product.update({
      where: { id },
      data: {
        price: parseFloat(price),
        oldPrice: oldPrice ? parseFloat(oldPrice) : null,
        minPrice: minPrice ? parseFloat(minPrice) : null,
      },
    });

    return reply.send({ code: 1, msg: '价格更新成功，已同步到 OZON' });
  });

  app.put('/:id/stock', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const parsed = updateStockSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const product = await prisma.product.findFirst({
      where: { id },
      include: { shop: { select: { id: true, userId: true, platform: true, clientId: true, apiKeyEncrypted: true } } },
    });
    if (!product || product.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '商品不存在' });
    }
    if (product.shop.platform !== 'OZON') {
      return reply.send({ code: 0, msg: '暂只支持 OZON 库存修改' });
    }
    const blockReason = getProductMutationBlockReason(product, { requireOfferId: true });
    if (blockReason) {
      return reply.send({ code: 0, msg: blockReason });
    }

    const client = new OzonClient({
      clientId: product.shop.clientId!,
      apiKey: decrypt(product.shop.apiKeyEncrypted),
    });

    const { stock } = parsed.data;
    let warehouseId = parsed.data.warehouseId;

    // Auto-detect warehouse if not provided
    if (!warehouseId) {
      // Try to find an active warehouse from local DB (accept multiple valid statuses)
      let warehouse = await prisma.warehouse.findFirst({
        where: { shopId: product.shop.id, status: { in: ['created', 'working', 'active'] } },
        orderBy: { createdAt: 'asc' },
      });

      // If no warehouse in DB, try syncing from OZON
      if (!warehouse) {
        try {
          const ozonWarehouses = await client.getWarehouseList();
          for (const wh of ozonWarehouses) {
            await prisma.warehouse.upsert({
              where: {
                shopId_platformWarehouseId: {
                  shopId: product.shop.id,
                  platformWarehouseId: String(wh.warehouse_id),
                },
              },
              update: {
                name: wh.name,
                type: wh.warehouse_type || (wh.is_rfbs ? 'RFBS' : 'FBS'),
                status: wh.status,
              },
              create: {
                shopId: product.shop.id,
                platformWarehouseId: String(wh.warehouse_id),
                name: wh.name,
                type: wh.warehouse_type || (wh.is_rfbs ? 'RFBS' : 'FBS'),
                status: wh.status,
              },
            });
          }
          warehouse = await prisma.warehouse.findFirst({
            where: { shopId: product.shop.id, status: { in: ['created', 'working', 'active'] } },
            orderBy: { createdAt: 'asc' },
          });
        } catch {
          // Sync failed, continue to check if we have any warehouse at all
        }
      }

      if (!warehouse || !warehouse.platformWarehouseId) {
        return reply.send({ code: 0, msg: '该店铺暂无可用仓库，请先在仓库管理中同步仓库' });
      }

      warehouseId = Number(warehouse.platformWarehouseId);
    }

    const platformId = Number(product.platformProductId);

    try {
      const result = await client.updateStock([{
        offer_id: product.offerId!,
        product_id: platformId,
        stock,
        warehouse_id: warehouseId,
      }]);
      const updateResult = resolveOzonBatchUpdateResults(result, 1);
      if (updateResult.errors.length) {
        const errors = (result as any)?.result?.filter((r: any) => r.errors?.length);
        const errCode = errors?.[0]?.errors?.[0]?.code || '';
        if (errCode === 'TOO_MANY_REQUESTS') {
          return reply.send({ code: 0, msg: '库存更新过于频繁，请等待30秒后重试' });
        }
        if (errCode === 'WAREHOUSE_WRONG_STATUS') {
          // Refresh warehouse list and retry with a different valid warehouse
          try {
            const ozonWarehouses = await client.getWarehouseList();
            for (const wh of ozonWarehouses) {
              await prisma.warehouse.upsert({
                where: {
                  shopId_platformWarehouseId: {
                    shopId: product.shop.id,
                    platformWarehouseId: String(wh.warehouse_id),
                  },
                },
                update: { name: wh.name, type: wh.warehouse_type || (wh.is_rfbs ? 'RFBS' : 'FBS'), status: wh.status },
                create: { shopId: product.shop.id, platformWarehouseId: String(wh.warehouse_id), name: wh.name, type: wh.warehouse_type || (wh.is_rfbs ? 'RFBS' : 'FBS'), status: wh.status },
              });
            }
            const freshWarehouse = await prisma.warehouse.findFirst({
              where: { shopId: product.shop.id, status: { in: ['created', 'working', 'active'] }, platformWarehouseId: { not: String(warehouseId) } },
              orderBy: { createdAt: 'asc' },
            });
            if (freshWarehouse) {
              const retryResult = await client.updateStock([{
                offer_id: product.offerId!,
                product_id: platformId,
                stock,
                warehouse_id: Number(freshWarehouse.platformWarehouseId),
              }]);
              const retryErrors = (retryResult as any)?.result?.filter((r: any) => r.errors?.length);
              if (!retryErrors?.length) {
                await prisma.product.update({ where: { id }, data: { stock } });
                return reply.send({ code: 1, msg: '库存更新成功（已自动切换仓库）' });
              }
            }
          } catch { /* retry failed, fall through to error */ }
          return reply.send({ code: 0, msg: '仓库状态异常，已尝试自动切换但未找到可用仓库。请在 OZON 卖家后台确认仓库状态' });
        }
        return reply.send({ code: 0, msg: `OZON 拒绝更新库存: ${updateResult.errors[0]!.message}` });
      }
    } catch (e: any) {
      const errMsg = e.message || '未知错误';
      const hint = errMsg.includes('warehouse') || errMsg.includes('Warehouse')
        ? '仓库配置异常，请在仓库管理中重新同步仓库'
        : errMsg.includes('401') || errMsg.includes('403')
        ? 'API 密钥无效或已过期'
        : errMsg.includes('offer_id')
        ? '商品 offer_id 不匹配，请重新同步商品'
        : errMsg;
      return reply.send({ code: 0, msg: `OZON 库存同步失败: ${hint}` });
    }

    await prisma.product.update({ where: { id }, data: { stock } });

    return reply.send({ code: 1, msg: '库存更新成功，已同步到 OZON' });
  });

  app.post('/batch-price', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = batchPriceSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const requestedIds = parsed.data.items?.map((i) => i.productId) ?? parsed.data.productIds ?? [];
    const products = await prisma.product.findMany({
      where: { id: { in: requestedIds } },
      include: { shop: { select: { id: true, userId: true, platform: true, clientId: true, apiKeyEncrypted: true } } },
    });

    const owned = products.filter((p) => p.shop.userId === userId && p.shop.platform === 'OZON');
    if (owned.length === 0) {
      return reply.send({ code: 0, msg: '没有可操作的商品' });
    }
    const blocked = owned
      .map((product) => ({ product, reason: getProductMutationBlockReason(product) }))
      .filter((item) => item.reason);
    if (blocked.length) {
      return reply.send({ code: 0, msg: `有 ${blocked.length} 件商品不可改价：${blocked[0]!.reason}` });
    }

    const shopGroups = new Map<string, typeof owned>();
    for (const p of owned) {
      const group = shopGroups.get(p.shop.id) || [];
      group.push(p);
      shopGroups.set(p.shop.id, group);
    }

    let updated = 0;
    const failures: { productId: string; offerId: string | null; error: string }[] = [];
    for (const [, group] of shopGroups) {
      const shop = group[0]!.shop;
      const client = new OzonClient({
        clientId: shop.clientId!,
        apiKey: decrypt(shop.apiKeyEncrypted),
      });

      const prepared = group.map((p) => {
        const item = parsed.data.items?.find((i) => i.productId === p.id);
        const price = item?.price ?? calculateBatchPrice(p.price?.toString() ?? null, {
          mode: parsed.data.mode || 'set',
          value: parsed.data.value ?? 0,
        });
        if (!price) return null;
        return {
          product: p,
          price,
          oldPrice: item?.oldPrice || price,
          minPrice: item?.minPrice,
        };
      }).filter((item): item is NonNullable<typeof item> => item !== null);

      if (!prepared.length) continue;

      const priceItems = prepared.map(({ product, price, oldPrice, minPrice }) => {
        return {
          product_id: Number(product.platformProductId),
          price,
          old_price: oldPrice,
          min_price: minPrice,
          currency_code: product.currency || 'CNY',
        };
      });

      let updateResult;
      try {
        updateResult = resolveOzonBatchUpdateResults(await client.updatePrices(priceItems), prepared.length);
      } catch (e: any) {
        return reply.send({ code: 0, msg: `OZON 价格同步失败: ${e.message}` });
      }

      for (const error of updateResult.errors) {
        const failed = prepared[error.index];
        if (failed) failures.push({ productId: failed.product.id, offerId: failed.product.offerId, error: error.message });
      }

      for (const index of updateResult.successfulIndexes) {
        const { product, price, oldPrice, minPrice } = prepared[index]!;
        await prisma.product.update({
          where: { id: product.id },
          data: {
            price: parseFloat(price),
            oldPrice: oldPrice ? parseFloat(oldPrice) : null,
            ...(minPrice !== undefined ? { minPrice: minPrice ? parseFloat(minPrice) : null } : {}),
          },
        });
        updated++;
      }
    }

    if (!updated) {
      const reason = failures[0]?.error || '没有可计算新价格的商品，请确认选中商品已有当前价格';
      return reply.send({ code: 0, msg: reason });
    }

    return reply.send({
      code: 1,
      msg: failures.length ? `成功更新 ${updated} 件商品价格，${failures.length} 件被 OZON 拒绝` : `成功更新 ${updated} 件商品价格`,
      data: failures.length ? { failures: failures.slice(0, 20) } : undefined,
    });
  });

  app.post('/batch-stock', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = batchStockSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: parsed.data.items.map((i) => i.productId) } },
      include: { shop: { select: { id: true, userId: true, platform: true, clientId: true, apiKeyEncrypted: true } } },
    });

    const owned = products.filter((p) => p.shop.userId === userId && p.shop.platform === 'OZON');
    if (owned.length === 0) {
      return reply.send({ code: 0, msg: '没有可操作的商品' });
    }
    const blocked = owned
      .map((product) => ({ product, reason: getProductMutationBlockReason(product, { requireOfferId: true }) }))
      .filter((item) => item.reason);
    if (blocked.length) {
      return reply.send({ code: 0, msg: `有 ${blocked.length} 件商品不可改库存：${blocked[0]!.reason}` });
    }

    const shopGroups = new Map<string, typeof owned>();
    for (const p of owned) {
      const group = shopGroups.get(p.shop.id) || [];
      group.push(p);
      shopGroups.set(p.shop.id, group);
    }

    let updated = 0;
    const failures: { productId: string; offerId: string | null; error: string }[] = [];
    for (const [, group] of shopGroups) {
      const shop = group[0]!.shop;
      const client = new OzonClient({
        clientId: shop.clientId!,
        apiKey: decrypt(shop.apiKeyEncrypted),
      });

      const stockItems = group.map((p) => {
        const item = parsed.data.items.find((i) => i.productId === p.id)!;
        return {
          offer_id: p.offerId!,
          product_id: Number(p.platformProductId),
          stock: item.stock,
          warehouse_id: parsed.data.warehouseId,
        };
      });

      try {
        const result = await client.updateStock(stockItems);
        const updateResult = resolveOzonBatchUpdateResults(result, stockItems.length);
        for (const error of updateResult.errors) {
          const failed = group[error.index];
          if (failed) failures.push({ productId: failed.id, offerId: failed.offerId, error: error.message });
        }
        for (const index of updateResult.successfulIndexes) {
          const p = group[index]!;
          const item = parsed.data.items.find((i) => i.productId === p.id)!;
          await prisma.product.update({ where: { id: p.id }, data: { stock: item.stock } });
          updated++;
        }
      } catch (e: any) {
        const errMsg = e?.message ? String(e.message) : '未知错误';
        const hint = errMsg.includes('warehouse') || errMsg.includes('Warehouse')
          ? '仓库配置异常，请在仓库管理中重新同步仓库'
          : errMsg.includes('401') || errMsg.includes('403')
          ? 'API 密钥无效或已过期'
          : errMsg;
        return reply.send({ code: 0, msg: `OZON 库存同步失败: ${hint}` });
      }
    }

    if (!updated) {
      return reply.send({ code: 0, msg: failures[0]?.error || '没有商品库存更新成功' });
    }

    return reply.send({
      code: 1,
      msg: failures.length ? `成功更新 ${updated} 件商品库存，${failures.length} 件被 OZON 拒绝` : `成功更新 ${updated} 件商品库存`,
      data: failures.length ? { failures: failures.slice(0, 20) } : undefined,
    });
  });

  app.post('/archive', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = archiveSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const products = await prisma.product.findMany({
      where: { id: { in: parsed.data.productIds } },
      include: { shop: { select: { id: true, userId: true, platform: true, clientId: true, apiKeyEncrypted: true } } },
    });

    const owned = products.filter((p) => p.shop.userId === userId && p.shop.platform === 'OZON');
    if (owned.length === 0) {
      return reply.send({ code: 0, msg: '没有可操作的商品' });
    }

    const shopGroups = new Map<string, typeof owned>();
    for (const p of owned) {
      const group = shopGroups.get(p.shop.id) || [];
      group.push(p);
      shopGroups.set(p.shop.id, group);
    }

    for (const [, group] of shopGroups) {
      const shop = group[0]!.shop;
      const client = new OzonClient({
        clientId: shop.clientId!,
        apiKey: decrypt(shop.apiKeyEncrypted),
      });

      const ids = group.map((p) => Number(p.platformProductId));
      if (parsed.data.archive) {
        await client.archiveProducts(ids);
      } else {
        await client.unarchiveProducts(ids);
      }
    }

    const status = parsed.data.archive ? 'ARCHIVED' : 'VISIBLE';
    await prisma.product.updateMany({
      where: { id: { in: owned.map((p) => p.id) } },
      data: { visibility: status, syncStatus: 'SYNCED' },
    });

    return reply.send({
      code: 1,
      msg: `成功${parsed.data.archive ? '下架' : '上架'} ${owned.length} 件商品`,
    });
  });

  app.get('/warehouses/:shopId', async (request, reply) => {
    const { userId } = (request as any).user;
    const { shopId } = request.params as { shopId: string };

    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId } });
    if (!shop) {
      return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    }
    if (shop.platform !== 'OZON') {
      return reply.send({ code: 0, msg: '暂只支持 OZON' });
    }

    const client = new OzonClient({
      clientId: shop.clientId!,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });

    try {
      const warehouses = await client.getWarehouseList();
      if (!warehouses || warehouses.length === 0) {
        return reply.send({ code: 1, msg: '该店铺暂无 FBS 仓库，请在 OZON 后台配置仓库', data: [] });
      }
      return reply.send({ code: 1, msg: 'ok', data: warehouses });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `获取仓库列表失败: ${e.message}` });
    }
  });

  app.get('/:id/detail', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const product = await prisma.product.findFirst({
      where: { id },
      include: { shop: { select: { id: true, userId: true, platform: true, clientId: true, apiKeyEncrypted: true, name: true } } },
    });
    if (!product || product.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '商品不存在' });
    }

    let platformData = null;
    if (product.shop.platform === 'OZON' && product.platformProductId) {
      try {
        const client = new OzonClient({
          clientId: product.shop.clientId!,
          apiKey: decrypt(product.shop.apiKeyEncrypted),
        });
        const items = await client.getProductInfoList([Number(product.platformProductId)]);
        if (items.length > 0) platformData = items[0];
      } catch {}
    }

    // Query related orders by matching offer_id or sku in items JSON
    let relatedOrders: any[] = [];
    try {
      const userShops = await prisma.shop.findMany({ where: { userId }, select: { id: true } });
      const shopIds = userShops.map((s) => s.id);
      const allOrders = await prisma.order.findMany({
        where: { shopId: { in: shopIds }, items: { not: 'null' } } as any,
        orderBy: { createdAt: 'desc' },
        select: { id: true, platformOrderId: true, postingNumber: true, status: true, totalAmount: true, currency: true, items: true, inProcessAt: true },
        take: 200,
      });
      const offerId = product.offerId;
      const sku = product.sku;
      for (const order of allOrders) {
        if (relatedOrders.length >= 10) break;
        const orderItems = order.items as any[];
        if (!Array.isArray(orderItems)) continue;
        const matched = orderItems.some((item: any) =>
          (offerId && (item.offer_id === offerId || item.offerId === offerId)) ||
          (sku && item.sku === sku)
        );
        if (matched) {
          relatedOrders.push({
            id: order.id,
            platformOrderId: order.platformOrderId,
            postingNumber: order.postingNumber,
            status: order.status,
            totalAmount: order.totalAmount?.toString() ?? null,
            currency: order.currency,
            inProcessAt: order.inProcessAt,
          });
        }
      }
    } catch {}

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        ...product,
        shop: { id: product.shop.id, name: product.shop.name, platform: product.shop.platform },
        price: product.price?.toString() ?? null,
        oldPrice: product.oldPrice?.toString() ?? null,
        shopName: product.shop.name,
        platform: product.shop.platform,
        platformData,
        relatedOrders,
      },
    });
  });

  app.post('/sync-commissions', async (request, reply) => {
    const { userId } = (request as any).user;

    const shops = await prisma.shop.findMany({
      where: { userId, platform: 'OZON', status: 'ACTIVE' },
      select: { id: true, clientId: true, apiKeyEncrypted: true },
    });

    if (shops.length === 0) {
      return reply.send({ code: 0, msg: '没有可用的 OZON 店铺' });
    }

    let totalUpdated = 0;

    for (const shop of shops) {
      const products = await prisma.product.findMany({
        where: { shopId: shop.id, platformProductId: { not: null } },
        select: { id: true, platformProductId: true },
      });

      if (products.length === 0) continue;

      const client = new OzonClient({
        clientId: shop.clientId!,
        apiKey: decrypt(shop.apiKeyEncrypted),
      });

      const productIds = products.map((p) => Number(p.platformProductId));
      const batchSize = 1000;

      for (let i = 0; i < productIds.length; i += batchSize) {
        const batch = productIds.slice(i, i + batchSize);
        try {
          const priceItems = await client.getProductPrices(batch);
          for (const item of priceItems) {
            const product = products.find((p) => Number(p.platformProductId) === item.product_id);
            if (!product) continue;

            const commissionRate = resolveOzonSalesCommissionPercent(item);
            const minPriceValue = Number(item.price?.min_price);
            const minPrice = Number.isFinite(minPriceValue) && minPriceValue > 0 ? minPriceValue : null;

            await prisma.product.update({
              where: { id: product.id },
              data: {
                commissionRate: commissionRate != null ? commissionRate : undefined,
                minPrice: minPrice != null ? minPrice : undefined,
              },
            });
            totalUpdated++;
          }
        } catch (e: any) {
          console.error(`[SyncCommissions] Error for shop ${shop.id}:`, e.message);
        }
      }
    }

    return reply.send({
      code: 1,
      msg: `成功更新 ${totalUpdated} 件商品佣金数据`,
      data: { updated: totalUpdated },
    });
  });

  app.get('/stock-diff', async (request, reply) => {
    const { userId } = (request as any).user;
    const { shopId } = request.query as { shopId: string };

    if (!shopId) return reply.status(400).send({ code: 0, msg: '请指定店铺' });

    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId } });
    if (!shop || shop.platform !== 'OZON') {
      return reply.status(404).send({ code: 0, msg: '店铺不存在或非 OZON 平台' });
    }

    const products = await prisma.product.findMany({
      where: {
        shopId,
        platformProductId: { not: null },
        NOT: [
          { visibility: { in: ['ARCHIVED', 'archived', 'MISSING', 'missing'] } },
          { syncStatus: { in: ['MISSING', 'missing'] } },
        ],
      },
      select: { id: true, title: true, offerId: true, platformProductId: true, stock: true, sku: true },
    });

    if (products.length === 0) {
      return reply.send({ code: 1, msg: 'ok', data: { diffs: [], total: 0 } });
    }

    const client = new OzonClient({
      clientId: shop.clientId!,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });

    const productIds = products.map((p) => Number(p.platformProductId));
    const batchSize = 100;
    const platformInfos: any[] = [];
    for (let i = 0; i < productIds.length; i += batchSize) {
      const batch = productIds.slice(i, i + batchSize);
      const infos = await client.getProductInfoList(batch);
      platformInfos.push(...infos);
    }

    const platformMap = new Map(platformInfos.map((info) => [String(info.id), info]));

    const diffs: any[] = [];
    for (const p of products) {
      const info = platformMap.get(p.platformProductId!);
      if (!info) continue;
      const platformStock = info.stocks?.stocks?.reduce(
        (sum: number, s: any) => sum + (s.present || 0), 0,
      ) ?? 0;
      const localStock = p.stock ?? 0;
      if (localStock !== platformStock) {
        diffs.push({
          id: p.id,
          title: p.title,
          offerId: p.offerId,
          sku: p.sku,
          localStock,
          platformStock,
          diff: localStock - platformStock,
        });
      }
    }

    return reply.send({
      code: 1,
      msg: 'ok',
      data: { diffs, total: diffs.length, checked: products.length },
    });
  });

  app.post('/stock-sync-all', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { shopId: string; warehouseId: number; productIds?: string[] };

    if (!body.shopId || !body.warehouseId) {
      return reply.status(400).send({ code: 0, msg: '请指定店铺和仓库' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: body.shopId, userId } });
    if (!shop || shop.platform !== 'OZON') {
      return reply.status(404).send({ code: 0, msg: '店铺不存在或非 OZON 平台' });
    }

    const where: Record<string, unknown> = {
      shopId: body.shopId,
      platformProductId: { not: null },
      offerId: { not: null },
      NOT: [
        { visibility: { in: ['ARCHIVED', 'archived', 'MISSING', 'missing'] } },
        { syncStatus: { in: ['MISSING', 'missing'] } },
      ],
    };
    if (body.productIds?.length) {
      where.id = { in: body.productIds };
    }

    const products = await prisma.product.findMany({
      where: where as any,
      select: { id: true, offerId: true, platformProductId: true, stock: true },
    });

    if (products.length === 0) {
      return reply.send({ code: 0, msg: '没有可同步的商品' });
    }

    const client = new OzonClient({
      clientId: shop.clientId!,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });

    const batchSize = 100;
    let synced = 0;
    const failures: { offerId: string; productId: string; error: string }[] = [];
    for (let i = 0; i < products.length; i += batchSize) {
      const batch = products.slice(i, i + batchSize);
      const stockItems = batch.map((p) => ({
        offer_id: p.offerId!,
        product_id: Number(p.platformProductId),
        stock: p.stock ?? 0,
        warehouse_id: body.warehouseId,
      }));
      try {
        const res = await client.updateStock(stockItems);
        const result = (res as any)?.result as any[] | undefined;
        if (Array.isArray(result)) {
          result.forEach((r, idx) => {
            if (r?.errors?.length) {
              const p = batch[idx]!;
              failures.push({
                offerId: p.offerId!,
                productId: p.platformProductId!,
                error: JSON.stringify(r.errors).slice(0, 200),
              });
            }
          });
        }
        synced += batch.length - (result?.filter((r: any) => r?.errors?.length).length ?? 0);
      } catch (e: any) {
        for (const p of batch) {
          failures.push({
            offerId: p.offerId!,
            productId: p.platformProductId!,
            error: e.message?.slice(0, 200) || 'unknown',
          });
        }
      }
      if (i + batchSize < products.length) {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }

    return reply.send({
      code: 1,
      msg: `成功推送 ${synced}/${products.length} 件商品库存到 OZON${failures.length ? `，${failures.length} 件失败` : ''}`,
      data: { synced, total: products.length, failures: failures.slice(0, 50) },
    });
  });

  app.get('/:id/variants', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const product = await prisma.product.findFirst({
      where: { id },
      include: { shop: { select: { userId: true } } },
    });
    if (!product || product.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '商品不存在' });
    }
    if (!product.modelId) {
      return reply.send({ code: 1, msg: '该商品无变体信息（model_id 为空，请先同步商品）', data: { variants: [], modelId: null } });
    }

    const variants = await prisma.product.findMany({
      where: { shopId: product.shopId, modelId: product.modelId },
      select: {
        id: true,
        platformProductId: true,
        offerId: true,
        title: true,
        price: true,
        oldPrice: true,
        currency: true,
        stock: true,
        images: true,
        sku: true,
        status: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        modelId: product.modelId,
        count: variants.length,
        variants: variants.map((v) => ({
          ...v,
          price: v.price?.toString() ?? null,
          oldPrice: v.oldPrice?.toString() ?? null,
        })),
      },
    });
  });

  // ─── 从 OZON 实时拉取属性并存本地 ───
  app.post('/:id/refresh-attributes', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const product = await prisma.product.findFirst({
      where: { id },
      include: { shop: { select: { userId: true, clientId: true, apiKeyEncrypted: true } } },
    });
    if (!product || product.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '商品不存在' });
    }
    if (!product.platformProductId) {
      return reply.status(400).send({ code: 0, msg: '商品缺少 platform_product_id' });
    }

    const client = new OzonClient({ clientId: product.shop.clientId!, apiKey: decrypt(product.shop.apiKeyEncrypted) });
    const attrs = await client.getProductInfoAttributes({ product_id: [product.platformProductId] });
    const found = attrs.find((a) => String(a.id) === product.platformProductId);

    if (!found) {
      return reply.status(404).send({ code: 0, msg: 'OZON 未返回该商品属性' });
    }

    const infos = await client.getProductInfoList([Number(product.platformProductId)]);
    const info = infos[0];

    const updateData: any = {
      attributes: found.attributes as any,
      images: resolveOzonProductImages(info || {}, found) as any,
    };
    const syncMeta = buildProductSyncMeta({
      statuses: (product.variants as any)?.ozonStatus,
      description_category_id: info?.description_category_id || found.description_category_id,
      type_id: info?.type_id || found.type_id,
    }, (product.variants as any)?.ozonStocks || []);
    const syncCategory = getProductSyncCategory(syncMeta);
    updateData.variants = { ...((product.variants as any) || {}), ozonCategory: syncMeta.ozonCategory };
    if (syncCategory) updateData.categoryId = String(syncCategory.descriptionCategoryId);
    if (info) {
      if (info.name) updateData.title = info.name;
      if (info.description) updateData.description = info.description;
    }

    await prisma.product.update({ where: { id }, data: updateData });

    return reply.send({
      code: 1,
      msg: '已从 OZON 拉取最新属性',
      data: {
        attributes: found.attributes,
        images: found.images,
        title: updateData.title,
        description: updateData.description,
        ozonUpdatedAt: info?.updated_at,
      },
    });
  });

  // ─── 本地文件上传（接收 base64，上传到存储后端） ───
  app.post('/upload-file', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { file: string; filename: string; shopId?: string };
    if (!body?.file || !body?.filename) {
      return reply.status(400).send({ code: 0, msg: '缺少 file 或 filename' });
    }

    const base64Match = body.file.match(/^data:[^;]+;base64,(.+)$/);
    const buffer = base64Match
      ? Buffer.from(base64Match[1]!, 'base64')
      : Buffer.from(body.file, 'base64');

    if (buffer.length > 20 * 1024 * 1024) {
      return reply.status(413).send({ code: 0, msg: '文件超出 20MB 限制' });
    }

    const { getStorageBackend } = await import('../services/image-storage.js');
    try {
      const backend = await getStorageBackend(body.shopId);
      const result = await backend.uploadBuffer(buffer, body.filename, undefined, { category: 'raw', ownerId: userId });
      return reply.send({ code: 1, msg: 'ok', data: result });
    } catch (e: any) {
      return reply.status(500).send({ code: 0, msg: `上传失败: ${e.message}` });
    }
  });

  // ─── 商品编辑：更新属性（标题/描述/自定义属性） ───
  // OZON 把 name (id=4180) 和 description (id=4191) 作为 attribute 存储，
  // 所以 title/description 也走 /v1/product/attributes/update，无需 import 整个商品
  app.put('/:id/attributes', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as {
      title?: string;
      description?: string;
      attributes?: { id: number; values: { value: string }[] }[];
    };

    const hasAttrs = Array.isArray(body?.attributes) && body.attributes.length > 0;
    const hasTitle = typeof body?.title === 'string' && body.title.length > 0;
    const hasDesc = typeof body?.description === 'string';
    if (!hasAttrs && !hasTitle && !hasDesc) {
      return reply.status(400).send({ code: 0, msg: '请提供 title/description/attributes 至少一项' });
    }

    const product = await prisma.product.findFirst({
      where: { id },
      include: { shop: { select: { userId: true, clientId: true, apiKeyEncrypted: true } } },
    });
    if (!product || product.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '商品不存在' });
    }
    if (!product.offerId) {
      return reply.status(400).send({ code: 0, msg: '商品缺少 offer_id，无法更新属性' });
    }

    // 合并 title/description 到 attributes
    const merged: { id: number; values: { value: string }[] }[] = [];
    if (hasAttrs) {
      // 过滤掉 4180/4191，避免与 title/description 冲突
      for (const a of body.attributes!) {
        if (a.id !== 4180 && a.id !== 4191) merged.push(a);
      }
    }
    if (hasTitle) {
      merged.push({ id: 4180, values: [{ value: body.title! }] });
    }
    if (hasDesc) {
      merged.push({ id: 4191, values: [{ value: body.description! }] });
    }

    const client = new OzonClient({ clientId: product.shop.clientId!, apiKey: decrypt(product.shop.apiKeyEncrypted) });
    let ozonResult;
    try {
      ozonResult = await client.updateProductAttributes([{
        offer_id: product.offerId,
        attributes: merged,
      }]);
    } catch (e: any) {
      return reply.status(500).send({ code: 0, msg: `OZON 提交失败: ${e.message}` });
    }

    // 同步本地：merged 已包含 4180/4191，直接覆盖本地 attributes JSON
    const updateData: any = { attributes: merged as any };
    if (hasTitle) updateData.title = body.title;
    if (hasDesc) updateData.description = body.description;

    await prisma.product.update({ where: { id }, data: updateData });

    return reply.send({
      code: 1,
      msg: '已提交到 OZON（标题/描述/属性）',
      data: ozonResult,
    });
  });

  // ─── 商品编辑：更新/替换图片 ───
  app.post('/:id/images', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as { images: string[]; colorImage?: string };

    if (!Array.isArray(body?.images) || body.images.length === 0) {
      return reply.status(400).send({ code: 0, msg: '缺少 images 数组' });
    }

    const product = await prisma.product.findFirst({
      where: { id },
      include: { shop: { select: { userId: true, clientId: true, apiKeyEncrypted: true } } },
    });
    if (!product || product.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '商品不存在' });
    }
    if (!product.platformProductId) {
      return reply.status(400).send({ code: 0, msg: '商品缺少 platform_product_id' });
    }

    // 先 resolve 本地路径为公网 URL
    const { getStorageBackend } = await import('../services/image-storage.js');
    let resolvedImages = body.images;
    const hasLocal = body.images.some((img) => img.startsWith('/watermarked/') || img.startsWith('/uploads/'));
    if (hasLocal) {
      let backend: Awaited<ReturnType<typeof getStorageBackend>> | null = null;
      try { backend = await getStorageBackend(); } catch {}
      if (backend) {
        const { readFile } = await import('fs/promises');
        const { join } = await import('path');
        resolvedImages = [];
        for (const img of body.images) {
          if (img.startsWith('/watermarked/') || img.startsWith('/uploads/')) {
            try {
              const localPath = join(process.cwd(), 'public', img.replace(/^\//, ''));
              const buf = await readFile(localPath);
              const filename = img.split('/').pop() || 'img.jpg';
              const category = img.startsWith('/watermarked/') ? 'watermarked' : 'raw';
              const result = await backend.uploadBuffer(buf, filename, undefined, { category, ownerId: userId });
              resolvedImages.push(result.url);
            } catch { resolvedImages.push(img); }
          } else {
            resolvedImages.push(img);
          }
        }
      }
    }

    const client = new OzonClient({ clientId: product.shop.clientId!, apiKey: decrypt(product.shop.apiKeyEncrypted) });
    const result = await client.importProductPictures({
      product_id: Number(product.platformProductId),
      images: resolvedImages,
      color_image: body.colorImage,
    });

    // 同步更新本地 images JSON
    await prisma.product.update({
      where: { id },
      data: { images: resolvedImages as any },
    });

    return reply.send({ code: 1, msg: '图片更新已提交', data: result });
  });

  // ─── 商品编辑：批量加水印后替换图片 ───
  app.post('/:id/watermark-and-replace', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as {
      config: {
        type: 'text' | 'image';
        text?: string;
        imageUrl?: string;
        position: string;
        opacity: number;
        fontSize?: number;
        fontColor?: string;
        scale?: number;
      };
    };

    if (!body?.config) {
      return reply.status(400).send({ code: 0, msg: '缺少水印配置' });
    }

    const product = await prisma.product.findFirst({
      where: { id },
      include: { shop: { select: { id: true, userId: true, clientId: true, apiKeyEncrypted: true } } },
    });
    if (!product || product.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '商品不存在' });
    }
    if (!product.platformProductId) {
      return reply.status(400).send({ code: 0, msg: '商品缺少 platform_product_id' });
    }

    const images = Array.isArray(product.images) ? (product.images as string[]) : [];
    if (!images.length) {
      return reply.status(400).send({ code: 0, msg: '商品无图片可处理' });
    }

    const { processItemWatermarks } = await import('../services/watermark.js');
    const { getStorageBackend } = await import('../services/image-storage.js');

    const wmResult = await processItemWatermarks(images, product.id, body.config as any);
    if (wmResult.failed === images.length) {
      return reply.status(500).send({ code: 0, msg: '所有图片水印处理均失败' });
    }

    // 上传水印图到存储后端 —— 失败必须明确返回，不能静默吞错让 OZON 拿到无效 URL
    let uploadedUrls: string[];
    try {
      const backend = await getStorageBackend(product.shop.id);
      const { readFile } = await import('fs/promises');
      const { join } = await import('path');
      const resolved: string[] = [];
      for (const img of wmResult.watermarkedImages) {
        if (img.startsWith('/watermarked/')) {
          const localPath = join(process.cwd(), 'public', img.replace(/^\//, ''));
          const buf = await readFile(localPath);
          const filename = img.split('/').pop() || 'img.jpg';
          const result = await backend.uploadBuffer(buf, filename, undefined, { category: 'watermarked', ownerId: userId });
          resolved.push(result.url);
        } else {
          resolved.push(img);
        }
      }
      uploadedUrls = resolved;
    } catch (e: any) {
      return reply.status(500).send({ code: 0, msg: `图片上传失败: ${e.message?.slice(0, 300) || '未知错误'}` });
    }

    // 调用 OZON API 替换图片
    const client = new OzonClient({ clientId: product.shop.clientId!, apiKey: decrypt(product.shop.apiKeyEncrypted) });
    let ozonResult;
    try {
      ozonResult = await client.importProductPictures({
        product_id: Number(product.platformProductId),
        images: uploadedUrls,
      });
    } catch (e: any) {
      return reply.status(500).send({ code: 0, msg: `OZON 图片替换失败: ${e.message?.slice(0, 300) || '未知错误'}` });
    }

    await prisma.product.update({ where: { id }, data: { images: uploadedUrls as any } });

    return reply.send({
      code: 1,
      msg: `已处理 ${uploadedUrls.length} 张图片并提交 OZON 替换${wmResult.failed ? `（${wmResult.failed} 张水印失败已用原图）` : ''}`,
      data: { failed: wmResult.failed, ozonResult },
    });
  });
}

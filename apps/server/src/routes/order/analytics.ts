import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { OzonClient } from '../../services/ozon-client.js';
import { ORDER_FULFILLMENT_PIPELINE, resolveOrderFulfillmentStage, resolveOrderFulfillmentStatus } from 'shared/order-fulfillment-stage';
import { buildOrderListScope } from '../../services/order-list-scope.js';

export async function orderAnalyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);
  const queryDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, '日期参数无效');

  app.get('/stats', async (request) => {
    const { userId } = (request as any).user;
    const query = z.object({ platform: z.enum(['OZON', 'YANDEX', 'KASPI', 'WILDBERRIES']).optional() }).parse(request.query);
    const userShops = await prisma.shop.findMany({
      where: { userId, status: { not: 'DISABLED' } },
      select: { id: true },
    });
    let shopIds = userShops.map((s) => s.id);
    if (query.platform && shopIds.length > 0) {
      const platformShops = await prisma.shop.findMany({
        where: { id: { in: shopIds }, platform: query.platform },
        select: { id: true },
      });
      shopIds = platformShops.map((shop) => shop.id);
    }

    if (shopIds.length === 0) {
      return {
        code: 1,
        msg: 'ok',
        data: {
          total: 0,
          byStatus: {},
          todayOrders: 0,
          todayRevenue: '0',
        },
      };
    }

    const total = await prisma.order.count({ where: { shopId: { in: shopIds } } });

    const statuses = ['awaiting_packaging', 'awaiting_deliver', 'delivering', 'delivered', 'cancelled'];
    const byStatus: Record<string, number> = {};
    for (const status of statuses) {
      byStatus[status] = await prisma.order.count({
        where: { shopId: { in: shopIds }, status },
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayOrders = await prisma.order.count({
      where: { shopId: { in: shopIds }, createdAt: { gte: today } },
    });

    const todayRevenue = await prisma.order.aggregate({
      where: { shopId: { in: shopIds }, createdAt: { gte: today } },
      _sum: { totalAmount: true },
    });

    return {
      code: 1,
      msg: 'ok',
      data: {
        total,
        byStatus,
        todayOrders,
        todayRevenue: todayRevenue._sum.totalAmount?.toString() ?? '0',
      },
    };
  });

  app.get('/stats-by-shop', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { startDate?: string; endDate?: string };

    const userShops = await prisma.shop.findMany({
      where: { userId, status: { not: 'DISABLED' } },
      select: { id: true, name: true, platform: true, balance: true },
      orderBy: { createdAt: 'asc' },
    });
    if (!userShops.length) {
      return { code: 1, msg: 'ok', data: { rows: [], summary: null } };
    }

    const dateFilter: Record<string, Date> = {};
    if (query.startDate) dateFilter.gte = new Date(query.startDate);
    if (query.endDate) dateFilter.lte = new Date(query.endDate);
    const dateWhere = Object.keys(dateFilter).length ? { createdAt: dateFilter } : {};

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rows = await Promise.all(userShops.map(async (shop) => {
      const baseWhere = { shopId: shop.id, ...dateWhere };
      const [total, awaitingPack, awaitingDeliver, delivering, delivered, cancelled, todayOrders, revAgg, todayRev] = await Promise.all([
        prisma.order.count({ where: baseWhere }),
        prisma.order.count({ where: { ...baseWhere, status: 'awaiting_packaging' } }),
        prisma.order.count({ where: { ...baseWhere, status: 'awaiting_deliver' } }),
        prisma.order.count({ where: { ...baseWhere, status: 'delivering' } }),
        prisma.order.count({ where: { ...baseWhere, status: 'delivered' } }),
        prisma.order.count({ where: { ...baseWhere, status: 'cancelled' } }),
        prisma.order.count({ where: { shopId: shop.id, createdAt: { gte: today } } }),
        prisma.order.aggregate({ where: baseWhere, _sum: { totalAmount: true } }),
        prisma.order.aggregate({ where: { shopId: shop.id, createdAt: { gte: today } }, _sum: { totalAmount: true } }),
      ]);
      return {
        shopId: shop.id, shopName: shop.name, platform: shop.platform, balance: shop.balance.toString(),
        total, awaitingPack, awaitingDeliver, delivering, delivered, cancelled, todayOrders,
        totalRevenue: revAgg._sum.totalAmount?.toString() ?? '0',
        todayRevenue: todayRev._sum.totalAmount?.toString() ?? '0',
      };
    }));

    const summary = rows.reduce((acc, r) => {
      acc.total += r.total; acc.delivered += r.delivered; acc.cancelled += r.cancelled;
      acc.todayOrders += r.todayOrders; acc.totalRevenue += Number(r.totalRevenue); acc.todayRevenue += Number(r.todayRevenue);
      return acc;
    }, { total: 0, delivered: 0, cancelled: 0, todayOrders: 0, totalRevenue: 0, todayRevenue: 0 });

    return { code: 1, msg: 'ok', data: { rows, summary: { ...summary, totalRevenue: summary.totalRevenue.toFixed(2), todayRevenue: summary.todayRevenue.toFixed(2), shopCount: rows.length } } };
  });

  app.get('/pipeline', async (request, reply) => {
    const { userId } = (request as any).user;
    const querySchema = z.object({ platform: z.enum(['OZON', 'YANDEX', 'KASPI', 'WILDBERRIES']).optional(), shopId: z.string().optional(), status: z.string().optional(), subStatus: z.string().min(1).max(120).optional(), search: z.string().optional(), searchField: z.enum(['all', 'posting', 'tracking', 'sku', 'product', 'purchase']).optional(), purchaseState: z.enum(['linked', 'unlinked']).optional(), shippingMethod: z.string().min(1).max(120).optional(), hasTracking: z.enum(['yes', 'no']).optional(), serviceTagId: z.string().optional(), userColorTagId: z.string().optional(), startDate: queryDateSchema.optional(), endDate: queryDateSchema.optional(), shipmentUrgency: z.enum(['overdue', 'today', 'tomorrow', 'within3d']).optional(), limit: z.coerce.number().int().min(1).max(200).optional(), offset: z.coerce.number().int().min(0).optional() }).superRefine((value, context) => {
      if (value.startDate && value.endDate && new Date(value.startDate) > new Date(value.endDate)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: '结束日期不能早于开始日期' });
    });
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    const query = parsed.data;
    if (query.startDate && (!/^\d{4}-\d{2}-\d{2}$/u.test(query.startDate) || Number.isNaN(new Date(`${query.startDate}T00:00:00.000Z`).getTime()))) return reply.status(400).send({ code: 0, msg: '日期参数无效' });
    if (query.endDate && (!/^\d{4}-\d{2}-\d{2}$/u.test(query.endDate) || Number.isNaN(new Date(`${query.endDate}T00:00:00.000Z`).getTime()))) return reply.status(400).send({ code: 0, msg: '日期参数无效' });
    if (query.startDate && query.endDate && query.startDate > query.endDate) return reply.status(400).send({ code: 0, msg: '结束日期不能早于开始日期' });
    const rawLimit = (query as any).limit, rawOffset = (query as any).offset;
    if (rawLimit !== undefined && (!/^\d+$/u.test(String(rawLimit)) || Number(rawLimit) < 1 || Number(rawLimit) > 200)) return reply.status(400).send({ code: 0, msg: 'limit 参数无效' });
    if (rawOffset !== undefined && (!/^\d+$/u.test(String(rawOffset)))) return reply.status(400).send({ code: 0, msg: 'offset 参数无效' });
    const userShops = await prisma.shop.findMany({ where: { userId, status: { not: 'DISABLED' } }, select: { id: true } });
    const shopIds = userShops.map((s) => s.id);
    let scopedShopIds = query.shopId ? (shopIds.includes(query.shopId) ? [query.shopId] : []) : shopIds;
    if (query.platform && scopedShopIds.length > 0) {
      const platformShops = await prisma.shop.findMany({ where: { id: { in: scopedShopIds }, platform: query.platform }, select: { id: true } });
      scopedShopIds = platformShops.map((shop) => shop.id);
    }
    if (scopedShopIds.length === 0) return { code: 1, msg: 'ok', data: { total: 0, stages: ORDER_FULFILLMENT_PIPELINE.map(stage => ({ ...stage, count: 0, children: stage.children.map(child => ({ ...child, count: 0 })) })) } };
    let where: Record<string, unknown>;
    try { where = await buildOrderListScope(prisma as never, scopedShopIds, query); }
    catch (error) { return reply.status(400).send({ code: 0, msg: error instanceof Error ? error.message : '参数错误' }); }

    const orders = await prisma.order.findMany({
      where: where as any,
      select: {
        id: true,
        status: true,
        subStatus: true,
        domesticTrackingNumber: true,
        domesticStatus: true,
        internationalTrackingNumber: true,
        internationalStatus: true,
        trackingNumber: true,
        inProcessAt: true,
        shipmentDate: true,
        deliveringDate: true,
        deliveredAt: true,
        inspectionStatus: true,
        shop: { select: { platform: true } },
      },
    });
    const orderIds = orders.map((order) => order.id);
    const warehouseLogs = orderIds.length > 0
      ? await prisma.warehouseLog.findMany({
          where: { orderId: { in: orderIds }, operationType: { in: ['scan_in', 'scan_out', 'label_print', 'stock_ready'] } },
          orderBy: { createdAt: 'desc' },
          select: { orderId: true, operationType: true, createdAt: true },
        })
      : [];
    const latestWarehouseLogByOrder = new Map<string, { scanInAt?: Date; scanOutAt?: Date; labelPrintedAt?: Date; stockPreparedAt?: Date }>();
    for (const log of warehouseLogs) {
      const current = latestWarehouseLogByOrder.get(log.orderId) || {};
      if (log.operationType === 'scan_in' && !current.scanInAt) current.scanInAt = log.createdAt;
      if (log.operationType === 'scan_out' && !current.scanOutAt) current.scanOutAt = log.createdAt;
      if (log.operationType === 'label_print' && !current.labelPrintedAt) current.labelPrintedAt = log.createdAt;
      if (log.operationType === 'stock_ready' && !current.stockPreparedAt) current.stockPreparedAt = log.createdAt;
      latestWarehouseLogByOrder.set(log.orderId, current);
    }
    const counts = new Map(ORDER_FULFILLMENT_PIPELINE.map(stage => [stage.key, { count: 0, children: new Map(stage.children.map(child => [child.key, 0])) }]));
    const now = new Date();
    for (const order of orders) {
      const logs = latestWarehouseLogByOrder.get(order.id);
      const stage = resolveOrderFulfillmentStage({
        ...order,
        warehouseScanInAt: logs?.scanInAt ?? null,
        warehouseScanOutAt: logs?.scanOutAt ?? null,
        labelPrintedAt: logs?.labelPrintedAt ?? null,
        stockPreparedAt: logs?.stockPreparedAt ?? null,
      }, now);
      const bucket = counts.get(stage.key)!; bucket.count += 1;
      const child = resolveOrderFulfillmentStatus({ ...order, warehouseScanInAt: logs?.scanInAt ?? null, warehouseScanOutAt: logs?.scanOutAt ?? null, stockPreparedAt: logs?.stockPreparedAt ?? null });
      if (child && bucket.children.has(child)) bucket.children.set(child, bucket.children.get(child)! + 1);
    }

    return { code: 1, msg: 'ok', data: { total: orders.length, stages: ORDER_FULFILLMENT_PIPELINE.map(stage => ({ ...stage, count: counts.get(stage.key)!.count, children: stage.children.map(child => ({ ...child, count: counts.get(stage.key)!.children.get(child.key) ?? 0 })) })) } };
  });

  app.get('/analytics/trend', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { days?: string; shopId?: string };
    const days = parseInt(query.days || '30', 10);

    const userShops = await prisma.shop.findMany({ where: { userId, status: { not: 'DISABLED' } }, select: { id: true } });
    const shopIds = query.shopId ? [query.shopId] : userShops.map((s) => s.id);

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: { shopId: { in: shopIds }, createdAt: { gte: startDate } },
      select: { createdAt: true, totalAmount: true, status: true },
    });

    const dailyMap = new Map<string, { orders: number; revenue: number; cancelled: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      dailyMap.set(d.toISOString().slice(0, 10), { orders: 0, revenue: 0, cancelled: 0 });
    }
    for (const order of orders) {
      const key = order.createdAt.toISOString().slice(0, 10);
      const entry = dailyMap.get(key);
      if (entry) {
        entry.orders++;
        if (order.status === 'cancelled') entry.cancelled++;
        else entry.revenue += Number(order.totalAmount || 0);
      }
    }

    return { code: 1, msg: 'ok', data: { trend: Array.from(dailyMap.entries()).map(([date, data]) => ({ date, ...data })) } };
  });

  app.get('/analytics/shops', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { days?: string };
    const days = parseInt(query.days || '30', 10);
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const userShops = await prisma.shop.findMany({ where: { userId, status: { not: 'DISABLED' } }, select: { id: true, name: true, platform: true } });
    const shopStats = await Promise.all(
      userShops.map(async (shop) => {
        const [orderCount, revenue, delivered, cancelled] = await Promise.all([
          prisma.order.count({ where: { shopId: shop.id, createdAt: { gte: startDate } } }),
          prisma.order.aggregate({ where: { shopId: shop.id, createdAt: { gte: startDate }, status: { not: 'cancelled' } }, _sum: { totalAmount: true } }),
          prisma.order.count({ where: { shopId: shop.id, createdAt: { gte: startDate }, status: 'delivered' } }),
          prisma.order.count({ where: { shopId: shop.id, createdAt: { gte: startDate }, status: 'cancelled' } }),
        ]);
        return { shopId: shop.id, shopName: shop.name, platform: shop.platform, orderCount, revenue: revenue._sum.totalAmount?.toString() ?? '0', delivered, cancelled };
      }),
    );
    return { code: 1, msg: 'ok', data: { shops: shopStats } };
  });

  app.get('/cancel-reasons', async (request, reply) => {
    const { userId } = (request as any).user;
    const { shopId } = request.query as { shopId?: string };
    if (!shopId) return reply.status(400).send({ code: 0, msg: '请指定店铺' });

    const shop = await prisma.shop.findFirst({ where: { id: shopId, userId } });
    if (!shop || shop.platform !== 'OZON') return reply.status(404).send({ code: 0, msg: '店铺不存在或非 OZON 平台' });

    const client = new OzonClient({ clientId: shop.clientId!, apiKey: decrypt(shop.apiKeyEncrypted) });
    try {
      const reasons = await client.getCancelReasons();
      return reply.send({ code: 1, msg: 'ok', data: reasons.filter((r) => r.is_available_for_cancellation) });
    } catch (e: any) {
      return reply.send({ code: 0, msg: `获取取消原因失败: ${e.message}` });
    }
  });

  app.get('/analytics/account-stats', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as { yearMonth?: string };
    const yearMonth = query.yearMonth || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) return reply.status(400).send({ code: 0, msg: 'yearMonth 格式应为 YYYY-MM' });

    const stats = await prisma.accountMonthlyStat.findMany({ where: { userId, yearMonth } });
    const accountSummary = stats.find((s) => !s.shopId);
    const shopDetails = stats.filter((s) => s.shopId);
    const shopIds = shopDetails.map((s) => s.shopId!);
    const shops = shopIds.length ? await prisma.shop.findMany({ where: { id: { in: shopIds } }, select: { id: true, name: true, platform: true } }) : [];
    const shopMap = new Map(shops.map((s) => [s.id, s]));

    return reply.send({ code: 1, msg: 'ok', data: {
      yearMonth,
      accountSummary: accountSummary ? { metrics: accountSummary.metrics, computedAt: accountSummary.computedAt } : null,
      shops: shopDetails.map((s) => ({ shopId: s.shopId, shopName: shopMap.get(s.shopId!)?.name ?? '未知', platform: shopMap.get(s.shopId!)?.platform ?? 'OZON', metrics: s.metrics, computedAt: s.computedAt })),
    } });
  });

  app.post('/analytics/recompute', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { yearMonth?: string };
    const yearMonth = body?.yearMonth || new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) return reply.status(400).send({ code: 0, msg: 'yearMonth 格式应为 YYYY-MM' });

    const { aggregateMonthlyStats } = await import('../../services/monthly-stats.js');
    const { recomputeMonthSnapshots } = await import('../../services/order-cost.js');
    const shops = await prisma.shop.findMany({ where: { userId, status: 'ACTIVE' }, select: { id: true } });

    (async () => {
      for (const shop of shops) await recomputeMonthSnapshots(shop.id, yearMonth);
      await aggregateMonthlyStats(userId, yearMonth);
    })().catch((e) => console.error('[Recompute]', e.message));

    return reply.send({ code: 1, msg: '重算任务已提交', data: { yearMonth, shopCount: shops.length } });
  });

  app.post('/analytics/finance-sync', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { shopId?: string; days?: number };
    const shops = body?.shopId
      ? await prisma.shop.findMany({ where: { id: body.shopId, userId }, select: { id: true, name: true } })
      : await prisma.shop.findMany({ where: { userId, status: 'ACTIVE' }, select: { id: true, name: true } });
    if (!shops.length) return reply.status(404).send({ code: 0, msg: '未找到活跃店铺' });

    const { addFinanceSyncJob } = await import('../../workers/finance-sync.js');
    for (const shop of shops) await addFinanceSyncJob(shop.id, body?.days ?? 30);
    return reply.send({ code: 1, msg: '同步任务已提交', data: { shops: shops.map((s) => s.name) } });
  });
}

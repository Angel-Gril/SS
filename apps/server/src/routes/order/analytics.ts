import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../lib/auth.js';
import { prisma } from '../../lib/prisma.js';
import { decrypt } from '../../lib/crypto.js';
import { OzonClient } from '../../services/ozon-client.js';
import { resolveOrderFulfillmentStage, type FulfillmentStageKey } from 'shared/order-fulfillment-stage';

export async function orderAnalyticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/stats', async (request) => {
    const { userId } = (request as any).user;
    const userShops = await prisma.shop.findMany({
      where: { userId },
      select: { id: true },
    });
    const shopIds = userShops.map((s) => s.id);

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
      where: { userId },
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

  // PLACEHOLDER_PIPELINE

  app.get('/pipeline', async (request) => {
    const { userId } = (request as any).user;
    const userShops = await prisma.shop.findMany({ where: { userId }, select: { id: true } });
    const shopIds = userShops.map((s) => s.id);
    if (shopIds.length === 0) return { code: 1, msg: 'ok', data: { stages: [] } };

    const orders = await prisma.order.findMany({
      where: { shopId: { in: shopIds } },
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
      },
    });
    const orderIds = orders.map((order) => order.id);
    const warehouseLogs = orderIds.length > 0
      ? await prisma.warehouseLog.findMany({
          where: { orderId: { in: orderIds }, operationType: { in: ['scan_in', 'scan_out', 'label_print'] } },
          orderBy: { createdAt: 'desc' },
          select: { orderId: true, operationType: true, createdAt: true },
        })
      : [];
    const latestWarehouseLogByOrder = new Map<string, { scanInAt?: Date; scanOutAt?: Date; labelPrintedAt?: Date }>();
    for (const log of warehouseLogs) {
      const current = latestWarehouseLogByOrder.get(log.orderId) || {};
      if (log.operationType === 'scan_in' && !current.scanInAt) current.scanInAt = log.createdAt;
      if (log.operationType === 'scan_out' && !current.scanOutAt) current.scanOutAt = log.createdAt;
      if (log.operationType === 'label_print' && !current.labelPrintedAt) current.labelPrintedAt = log.createdAt;
      latestWarehouseLogByOrder.set(log.orderId, current);
    }
    const counts: Record<FulfillmentStageKey, number> = {
      purchased: 0,
      domestic_transit: 0,
      received: 0,
      warehouse_processing: 0,
      delivering: 0,
      delivered: 0,
      abnormal: 0,
    };
    const now = new Date();
    for (const order of orders) {
      const logs = latestWarehouseLogByOrder.get(order.id);
      const stage = resolveOrderFulfillmentStage({
        ...order,
        warehouseScanInAt: logs?.scanInAt ?? null,
        warehouseScanOutAt: logs?.scanOutAt ?? null,
        labelPrintedAt: logs?.labelPrintedAt ?? null,
      }, now);
      counts[stage.key] += 1;
    }

    return { code: 1, msg: 'ok', data: { stages: [
      { key: 'purchased', label: '采购备货', count: counts.purchased },
      { key: 'domestic_transit', label: '国内在途', count: counts.domestic_transit },
      { key: 'received', label: '到仓入库', count: counts.received },
      { key: 'warehouse_processing', label: '仓库处理', count: counts.warehouse_processing },
      { key: 'delivering', label: '出库发运', count: counts.delivering },
      { key: 'abnormal', label: '异常', count: counts.abnormal },
    ] } };
  });

  app.get('/analytics/trend', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { days?: string; shopId?: string };
    const days = parseInt(query.days || '30', 10);

    const userShops = await prisma.shop.findMany({ where: { userId }, select: { id: true } });
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

    const userShops = await prisma.shop.findMany({ where: { userId }, select: { id: true, name: true, platform: true } });
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

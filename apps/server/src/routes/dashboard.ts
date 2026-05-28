import type { FastifyInstance } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/stats', async (request) => {
    const { userId } = (request as any).user;
    const userShops = await prisma.shop.findMany({
      where: { userId },
      select: { id: true },
    });
    const shopIds = userShops.map((s) => s.id);

    const shopCount = shopIds.length;
    const productCount = shopIds.length > 0
      ? await prisma.product.count({ where: { shopId: { in: shopIds } } })
      : 0;

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const orderCount = shopIds.length > 0
      ? await prisma.order.count({ where: { shopId: { in: shopIds } } })
      : 0;

    const pendingOrders = shopIds.length > 0
      ? await prisma.order.count({
          where: { shopId: { in: shopIds }, status: { in: ['awaiting_packaging', 'awaiting_deliver'] } },
        })
      : 0;

    const todayRevenue = shopIds.length > 0
      ? await prisma.order.aggregate({
          where: { shopId: { in: shopIds }, createdAt: { gte: today } },
          _sum: { totalAmount: true },
        })
      : { _sum: { totalAmount: null } };

    return {
      code: 1,
      msg: 'ok',
      data: {
        shopCount,
        productCount,
        orderCount,
        pendingOrders,
        todayRevenue: todayRevenue._sum.totalAmount?.toString() ?? '0',
      },
    };
  });

  app.get('/order-trend', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { days?: string };
    const days = Math.min(90, Math.max(7, Number(query.days) || 14));

    const userShops = await prisma.shop.findMany({
      where: { userId },
      select: { id: true },
    });
    const shopIds = userShops.map((s) => s.id);

    if (shopIds.length === 0) {
      return { code: 1, msg: 'ok', data: [] };
    }

    const since = new Date();
    since.setDate(since.getDate() - days);
    since.setHours(0, 0, 0, 0);

    const orders = await prisma.order.findMany({
      where: { shopId: { in: shopIds }, createdAt: { gte: since } },
      select: { createdAt: true, totalAmount: true },
    });

    const dayMap: Record<string, { count: number; revenue: number }> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(since);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      dayMap[key] = { count: 0, revenue: 0 };
    }

    for (const order of orders) {
      const key = order.createdAt.toISOString().slice(0, 10);
      if (dayMap[key]) {
        dayMap[key].count++;
        dayMap[key].revenue += Number(order.totalAmount ?? 0);
      }
    }

    const trend = Object.entries(dayMap).map(([date, val]) => ({
      date,
      orders: val.count,
      revenue: Math.round(val.revenue * 100) / 100,
    }));

    return { code: 1, msg: 'ok', data: trend };
  });
}

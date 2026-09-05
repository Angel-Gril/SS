import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const rechargeSchema = z.object({
  amount: z.coerce.number().positive('充值金额必须大于 0').max(100000),
  description: z.string().optional(),
});

export async function financeRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/balance', async (request) => {
    const { userId } = (request as any).user;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });
    return { code: 1, msg: 'ok', data: { balance: user?.balance.toString() ?? '0' } };
  });

  app.post('/recharge', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = rechargeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { amount, description } = parsed.data;

    const result = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user) throw new Error('用户不存在');

      const balanceBefore = user.balance;
      const balanceAfter = balanceBefore.add(amount);

      await tx.user.update({
        where: { id: userId },
        data: { balance: balanceAfter },
      });

      const log = await tx.balanceLog.create({
        data: {
          userId,
          type: 'RECHARGE',
          amount,
          balanceBefore,
          balanceAfter,
          description: description || '手动充值',
        },
      });

      return { balance: balanceAfter.toString(), logId: log.id };
    });

    return reply.send({ code: 1, msg: '充值成功', data: result });
  });

  app.get('/logs', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { offset?: string; limit?: string; type?: string };

    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 20));

    const where: Record<string, unknown> = { userId };
    if (query.type) where.type = query.type;

    const [total, rows] = await Promise.all([
      prisma.balanceLog.count({ where: where as any }),
      prisma.balanceLog.findMany({
        where: where as any,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          amount: true,
          balanceBefore: true,
          balanceAfter: true,
          description: true,
          metadata: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      code: 1,
      msg: 'ok',
      data: {
        total,
        rows: rows.map((r) => ({
          ...r,
          amount: r.amount.toString(),
          balanceBefore: r.balanceBefore.toString(),
          balanceAfter: r.balanceAfter.toString(),
        })),
      },
    };
  });

  app.get('/stats', async (request) => {
    const { userId } = (request as any).user;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { balance: true },
    });

    const totalRecharge = await prisma.balanceLog.aggregate({
      where: { userId, type: 'RECHARGE' },
      _sum: { amount: true },
    });

    const totalConsume = await prisma.balanceLog.aggregate({
      where: { userId, type: 'CONSUME' },
      _sum: { amount: true },
    });

    const recentLogs = await prisma.balanceLog.findMany({
      where: { userId },
      take: 5,
      orderBy: { createdAt: 'desc' },
      select: { type: true, amount: true, description: true, createdAt: true },
    });

    return {
      code: 1,
      msg: 'ok',
      data: {
        balance: user?.balance.toString() ?? '0',
        totalRecharge: totalRecharge._sum.amount?.toString() ?? '0',
        totalConsume: totalConsume._sum.amount?.toString() ?? '0',
        recentLogs: recentLogs.map((l) => ({ ...l, amount: l.amount.toString() })),
      },
    };
  });

  app.get('/profit', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as {
      shopId?: string;
      startDate?: string;
      endDate?: string;
      commissionRate?: string;
      exchangeRate?: string;
      shippingCost?: string;
    };

    const userShops = await prisma.shop.findMany({ where: { userId }, select: { id: true, name: true, config: true } });
    const shopIds = query.shopId ? [query.shopId] : userShops.map((s) => s.id);

    const startDate = query.startDate ? new Date(query.startDate) : new Date(Date.now() - 30 * 24 * 3600 * 1000);
    const endDate = query.endDate ? new Date(query.endDate) : new Date();

    const commissionRate = Number(query.commissionRate) || 0.15;
    const exchangeRate = Number(query.exchangeRate) || 0.078;
    const defaultShipping = Number(query.shippingCost) || 0;

    const orders = await prisma.order.findMany({
      where: {
        shopId: { in: shopIds },
        status: { notIn: ['cancelled'] },
        createdAt: { gte: startDate, lte: endDate },
      },
      select: {
        id: true,
        postingNumber: true,
        totalAmount: true,
        currency: true,
        items: true,
        createdAt: true,
        shop: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });

    const supplyGoods = await prisma.supplyGoods.findMany({
      where: { userId },
      select: { sku: true, purchasePrice: true },
    });
    const costMap = new Map(supplyGoods.filter((s) => s.sku && s.purchasePrice).map((s) => [s.sku!, Number(s.purchasePrice)]));

    let totalRevenue = 0;
    let totalCost = 0;
    let totalCommission = 0;
    let totalShipping = 0;

    const rows = orders.map((order) => {
      const revenue = Number(order.totalAmount || 0);
      const revenueCny = revenue * exchangeRate;
      const commission = revenue * commissionRate * exchangeRate;

      let purchaseCost = 0;
      if (Array.isArray(order.items)) {
        for (const item of order.items as any[]) {
          const sku = item.offer_id || item.sku || '';
          const unitCost = costMap.get(sku) || 0;
          purchaseCost += unitCost * (item.quantity || 1);
        }
      }

      const shipping = defaultShipping;
      const totalCostItem = purchaseCost + commission + shipping;
      const profit = revenueCny - totalCostItem;
      const margin = revenueCny > 0 ? profit / revenueCny : 0;

      totalRevenue += revenueCny;
      totalCost += totalCostItem;
      totalCommission += commission;
      totalShipping += shipping;

      return {
        id: order.id,
        postingNumber: order.postingNumber,
        shopName: order.shop.name,
        revenue: revenueCny.toFixed(2),
        purchaseCost: purchaseCost.toFixed(2),
        commission: commission.toFixed(2),
        shipping: shipping.toFixed(2),
        profit: profit.toFixed(2),
        margin: (margin * 100).toFixed(1),
        createdAt: order.createdAt,
      };
    });

    const totalProfit = totalRevenue - totalCost;
    const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    return {
      code: 1,
      msg: 'ok',
      data: {
        summary: {
          totalRevenue: totalRevenue.toFixed(2),
          totalCost: totalCost.toFixed(2),
          totalCommission: totalCommission.toFixed(2),
          totalShipping: totalShipping.toFixed(2),
          totalProfit: totalProfit.toFixed(2),
          avgMargin: avgMargin.toFixed(1),
          orderCount: rows.length,
        },
        rows,
      },
    };
  });
}

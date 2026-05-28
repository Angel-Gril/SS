import type { FastifyInstance } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

function escapeCsv(value: string | null | undefined): string {
  if (value == null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function exportRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/orders', async (request, reply) => {
    const { userId, role } = (request as any).user;
    const query = request.query as { shopId?: string; startDate?: string; endDate?: string };
    const where: Record<string, unknown> = {};

    if (role !== 'ADMIN') {
      const userShops = await prisma.shop.findMany({ where: { userId }, select: { id: true } });
      const shopIds = userShops.map((s) => s.id);
      if (query.shopId) {
        if (!shopIds.includes(query.shopId)) {
          return reply.status(403).send({ code: 0, msg: '无权导出该店铺数据' });
        }
        where.shopId = query.shopId;
      } else {
        where.shopId = { in: shopIds };
      }
    } else if (query.shopId) {
      where.shopId = query.shopId;
    }

    if (query.startDate) where.createdAt = { ...(where.createdAt as any || {}), gte: new Date(query.startDate) };
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setDate(end.getDate() + 1);
      where.createdAt = { ...(where.createdAt as any || {}), lt: end };
    }

    const orders = await prisma.order.findMany({
      where: where as any,
      include: { shop: { select: { name: true, platform: true } } },
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const header = ['订单号', '发货单号', '店铺', '平台', '状态', '金额', '币种', '物流单号', '物流方式', '创建时间'];
    const rows = orders.map((o) => [
      escapeCsv(o.platformOrderId),
      escapeCsv(o.postingNumber),
      escapeCsv(o.shop.name),
      escapeCsv(o.shop.platform),
      escapeCsv(o.status),
      escapeCsv(o.totalAmount?.toString()),
      escapeCsv(o.currency),
      escapeCsv(o.trackingNumber),
      escapeCsv(o.shippingMethod),
      escapeCsv(o.createdAt.toISOString().slice(0, 19).replace('T', ' ')),
    ].join(','));

    const csv = '﻿' + [header.join(','), ...rows].join('\r\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="orders_${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(csv);
  });

  app.get('/transactions', async (request, reply) => {
    const { userId, role } = (request as any).user;
    const query = request.query as { startDate?: string; endDate?: string };

    const where: Record<string, unknown> = {};
    if (role !== 'ADMIN') {
      const account = await prisma.userAccount.findUnique({ where: { userId } });
      if (!account) {
        reply.header('Content-Type', 'text/csv; charset=utf-8');
        reply.header('Content-Disposition', 'attachment; filename="transactions.csv"');
        return reply.send('﻿类型,金额,余额,关联订单,说明,时间\r\n');
      }
      where.accountId = account.id;
    }

    if (query.startDate) where.createdAt = { ...(where.createdAt as any || {}), gte: new Date(query.startDate) };
    if (query.endDate) {
      const end = new Date(query.endDate);
      end.setDate(end.getDate() + 1);
      where.createdAt = { ...(where.createdAt as any || {}), lt: end };
    }

    const transactions = await prisma.transaction.findMany({
      where: where as any,
      orderBy: { createdAt: 'desc' },
      take: 10000,
    });

    const typeLabels: Record<string, string> = {
      recharge: '充值', deduct_service: '服务费', deduct_shipping: '快递费',
      refund: '退款', adjustment: '调整',
    };

    const header = ['类型', '金额', '余额', '关联订单', '说明', '时间'];
    const rows = transactions.map((t) => [
      escapeCsv(typeLabels[t.type] || t.type),
      escapeCsv(t.amount.toString()),
      escapeCsv(t.balanceAfter.toString()),
      escapeCsv(t.orderId),
      escapeCsv(t.description),
      escapeCsv(t.createdAt.toISOString().slice(0, 19).replace('T', ' ')),
    ].join(','));

    const csv = '﻿' + [header.join(','), ...rows].join('\r\n');
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', `attachment; filename="transactions_${new Date().toISOString().slice(0, 10)}.csv"`);
    return reply.send(csv);
  });
}

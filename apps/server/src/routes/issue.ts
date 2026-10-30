import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { platformShopScopeSchema, restrictOwnedShopIds } from '../services/platform-shop-scope.js';

const createSchema = z.object({
  shopId: z.string().min(1),
  orderId: z.string().optional(),
  postingNumber: z.string().optional(),
  trackingNumber: z.string().optional(),
  type: z.enum(['lost', 'damaged', 'delayed', 'wrong_item', 'refused', 'other']),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
});

const updateSchema = z.object({
  status: z.enum(['open', 'processing', 'resolved', 'closed']).optional(),
  resolution: z.string().optional(),
});

export async function issueRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const query = request.query as { platform?: string; shopId?: string; status?: string; type?: string; search?: string; offset?: string; limit?: string };

    const parsed = platformShopScopeSchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: '平台或店铺参数无效' });
    const { platform } = parsed.data;
    const userShops = await prisma.shop.findMany({ where: { userId, status: { not: 'DISABLED' }, ...(platform ? { platform } : {}) }, select: { id: true } });
    const shopIds = userShops.map((s) => s.id);
    if (shopIds.length === 0) return { code: 1, msg: 'ok', data: { total: 0, rows: [] } };

    const where: Record<string, unknown> = {
      shopId: { in: restrictOwnedShopIds(shopIds, parsed.data.shopId) },
    };
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.search) {
      where.OR = [
        { title: { contains: query.search, mode: 'insensitive' } },
        { postingNumber: { contains: query.search, mode: 'insensitive' } },
        { trackingNumber: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));

    const [total, rows] = await Promise.all([
      prisma.expressIssue.count({ where: where as any }),
      prisma.expressIssue.findMany({
        where: where as any,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: { shop: { select: { name: true, platform: true } } },
      }),
    ]);

    return { code: 1, msg: 'ok', data: { total, rows } };
  });

  app.get('/stats', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = platformShopScopeSchema.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: '平台或店铺参数无效' });
    const scope = parsed.data;
    const userShops = await prisma.shop.findMany({ where: { userId, status: { not: 'DISABLED' }, ...(scope.platform ? { platform: scope.platform } : {}) }, select: { id: true } });
    const shopIds = restrictOwnedShopIds(userShops.map((s) => s.id), scope.shopId);
    if (shopIds.length === 0) return { code: 1, msg: 'ok', data: { total: 0, byStatus: {}, byType: {} } };

    const total = await prisma.expressIssue.count({ where: { shopId: { in: shopIds } } });
    const statusGroups = await prisma.expressIssue.groupBy({
      by: ['status'], where: { shopId: { in: shopIds } }, _count: { _all: true },
    });
    const typeGroups = await prisma.expressIssue.groupBy({
      by: ['type'], where: { shopId: { in: shopIds } }, _count: { _all: true },
    });

    const byStatus: Record<string, number> = {};
    for (const g of statusGroups) byStatus[g.status] = g._count._all;
    const byType: Record<string, number> = {};
    for (const g of typeGroups) byType[g.type] = g._count._all;

    return { code: 1, msg: 'ok', data: { total, byStatus, byType } };
  });

  app.post('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });

    const shop = await prisma.shop.findFirst({ where: { id: parsed.data.shopId, userId } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });

    const issue = await prisma.expressIssue.create({ data: parsed.data });
    return reply.send({ code: 1, msg: '异常件已创建', data: issue });
  });

  app.put('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: '参数错误' });

    const issue = await prisma.expressIssue.findUnique({
      where: { id },
      include: { shop: { select: { userId: true } } },
    });
    if (!issue || issue.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '异常件不存在' });
    }

    const data: Record<string, unknown> = {};
    if (parsed.data.status) data.status = parsed.data.status;
    if (parsed.data.resolution !== undefined) data.resolution = parsed.data.resolution;
    if (parsed.data.status === 'resolved' || parsed.data.status === 'closed') {
      data.resolvedAt = new Date();
    }

    const updated = await prisma.expressIssue.update({ where: { id }, data });
    return reply.send({ code: 1, msg: '已更新', data: updated });
  });

  app.delete('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const issue = await prisma.expressIssue.findUnique({
      where: { id },
      include: { shop: { select: { userId: true } } },
    });
    if (!issue || issue.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '异常件不存在' });
    }

    await prisma.expressIssue.delete({ where: { id } });
    return reply.send({ code: 1, msg: '已删除' });
  });

  app.post('/:id/close', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as { resolution?: string };

    const issue = await prisma.expressIssue.findUnique({
      where: { id },
      include: { shop: { select: { userId: true } } },
    });
    if (!issue || issue.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '异常件不存在' });
    }
    if (issue.status === 'closed') {
      return reply.status(400).send({ code: 0, msg: '该记录已关闭' });
    }

    const updated = await prisma.expressIssue.update({
      where: { id },
      data: {
        status: 'closed',
        resolution: body.resolution || issue.resolution || null,
        resolvedAt: new Date(),
      },
    });
    return reply.send({ code: 1, msg: '已关闭', data: updated });
  });
}

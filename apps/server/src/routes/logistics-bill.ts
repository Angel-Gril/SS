import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const createSchema = z.object({
  shopId: z.string().min(1),
  orderId: z.string().optional(),
  trackingNumber: z.string().min(1, '物流单号不能为空'),
  weight: z.coerce.number().int().min(0).optional(),
  fee: z.coerce.number().min(0),
  country: z.string().optional(),
  shippingMethod: z.string().optional(),
  remark: z.string().optional(),
});

const querySchema = z.object({
  shopId: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

export async function logisticsBillRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request) => {
    const { userId, role } = (request as any).user;
    const query = querySchema.parse(request.query);

    const userShops = await prisma.shop.findMany({ where: { userId }, select: { id: true } });
    const shopIds = role === 'ADMIN' ? undefined : userShops.map((s) => s.id);

    const where: Record<string, unknown> = {};
    if (shopIds) where.shopId = { in: shopIds };
    if (query.shopId) where.shopId = query.shopId;
    if (query.status) where.status = query.status;
    if (query.search) where.trackingNumber = { contains: query.search, mode: 'insensitive' };

    const [total, rows] = await Promise.all([
      prisma.logisticsBill.count({ where: where as any }),
      prisma.logisticsBill.findMany({
        where: where as any,
        skip: query.offset,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    return {
      code: 1,
      msg: 'ok',
      data: { total, rows: rows.map((r) => ({ ...r, fee: r.fee.toString() })) },
    };
  });

  app.post('/', async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'ADMIN') return reply.status(403).send({ code: 0, msg: '无权操作' });

    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });

    const bill = await prisma.logisticsBill.create({ data: parsed.data as any });
    return reply.send({ code: 1, msg: '创建成功', data: { ...bill, fee: bill.fee.toString() } });
  });

  app.put('/:id', async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'ADMIN') return reply.status(403).send({ code: 0, msg: '无权操作' });

    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;

    const data: Record<string, unknown> = {};
    if (body.weight != null) data.weight = Number(body.weight);
    if (body.fee != null) data.fee = Number(body.fee);
    if (body.country) data.country = body.country as string;
    if (body.shippingMethod) data.shippingMethod = body.shippingMethod as string;
    if (body.remark !== undefined) data.remark = body.remark as string;

    const bill = await prisma.logisticsBill.update({ where: { id }, data });
    return reply.send({ code: 1, msg: '更新成功', data: { ...bill, fee: bill.fee.toString() } });
  });

  app.delete('/:id', async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'ADMIN') return reply.status(403).send({ code: 0, msg: '无权操作' });

    const { id } = request.params as { id: string };
    await prisma.logisticsBill.delete({ where: { id } });
    return reply.send({ code: 1, msg: '删除成功' });
  });

  // 按店铺汇总
  app.get('/summary', async (request) => {
    const { userId, role } = (request as any).user;
    const userShops = await prisma.shop.findMany({
      where: role === 'ADMIN' ? {} : { userId },
      select: { id: true, name: true, platform: true },
    });

    const results = await Promise.all(
      userShops.map(async (shop) => {
        const agg = await prisma.logisticsBill.aggregate({
          where: { shopId: shop.id },
          _sum: { fee: true },
          _count: true,
        });
        const pending = await prisma.logisticsBill.aggregate({
          where: { shopId: shop.id, status: 'pending' },
          _sum: { fee: true },
          _count: true,
        });
        return {
          shopId: shop.id,
          shopName: shop.name,
          platform: shop.platform,
          totalCount: agg._count,
          totalFee: agg._sum.fee?.toString() ?? '0',
          pendingCount: pending._count,
          pendingFee: pending._sum.fee?.toString() ?? '0',
        };
      }),
    );

    return { code: 1, msg: 'ok', data: results };
  });

  // 批量结算
  app.post('/settle', async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'ADMIN') return reply.status(403).send({ code: 0, msg: '无权操作' });

    const { ids } = request.body as { ids: string[] };
    if (!ids?.length) return reply.status(400).send({ code: 0, msg: '请选择账单' });

    await prisma.logisticsBill.updateMany({
      where: { id: { in: ids }, status: 'pending' },
      data: { status: 'settled', settledAt: new Date() },
    });

    return reply.send({ code: 1, msg: `已结算 ${ids.length} 条` });
  });
}

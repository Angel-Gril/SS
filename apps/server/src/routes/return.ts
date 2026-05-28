import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { decrypt } from '../lib/crypto.js';
import { OzonClient } from '../services/ozon-client.js';

const querySchema = z.object({
  shopId: z.string().optional(),
  status: z.string().optional(),
  search: z.string().optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(200).default(20),
});

const manualReturnSchema = z.object({
  shopId: z.string().min(1),
  postingNumber: z.string().optional(),
  reason: z.string().min(1, '请填写退件原因'),
  reasonCode: z.string().optional(),
  product: z.any().optional(),
  quantity: z.number().int().min(1).default(1),
  amount: z.string().optional(),
  currency: z.string().default('CNY'),
});

const reviewSchema = z.object({
  action: z.enum(['approve', 'reject']),
  resolution: z.string().optional(),
});

export async function returnRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request) => {
    const { userId } = (request as any).user;
    const query = querySchema.parse(request.query);

    const userShops = await prisma.shop.findMany({
      where: { userId },
      select: { id: true },
    });
    const shopIds = userShops.map((s) => s.id);

    if (shopIds.length === 0) {
      return { code: 1, msg: 'ok', data: { total: 0, rows: [] } };
    }

    const where: Record<string, unknown> = {
      shopId: query.shopId && shopIds.includes(query.shopId)
        ? query.shopId
        : { in: shopIds },
    };

    if (query.status) where.status = query.status;
    if (query.search) {
      where.OR = [
        { postingNumber: { contains: query.search, mode: 'insensitive' } },
        { platformReturnId: { contains: query.search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.return.count({ where: where as any }),
      prisma.return.findMany({
        where: where as any,
        skip: query.offset,
        take: query.limit,
        orderBy: { createdAt: 'desc' },
        include: { shop: { select: { name: true, platform: true } } },
      }),
    ]);

    return {
      code: 1,
      msg: 'ok',
      data: {
        total,
        rows: rows.map((r) => ({
          ...r,
          amount: r.amount?.toString() ?? null,
        })),
      },
    };
  });

  app.get('/stats', async (request) => {
    const { userId } = (request as any).user;
    const userShops = await prisma.shop.findMany({ where: { userId }, select: { id: true } });
    const shopIds = userShops.map((s) => s.id);

    if (shopIds.length === 0) {
      return { code: 1, msg: 'ok', data: { total: 0, byStatus: {} } };
    }

    const total = await prisma.return.count({ where: { shopId: { in: shopIds } } });
    const grouped = await prisma.return.groupBy({
      by: ['status'],
      where: { shopId: { in: shopIds } },
      _count: { _all: true },
    });
    const byStatus: Record<string, number> = {};
    for (const g of grouped) byStatus[g.status] = g._count._all;

    return { code: 1, msg: 'ok', data: { total, byStatus } };
  });

  app.post('/sync', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { shopId?: string; since?: string };

    if (!body.shopId) {
      return reply.status(400).send({ code: 0, msg: '请指定店铺' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: body.shopId, userId } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });
    if (shop.platform !== 'OZON') return reply.send({ code: 0, msg: '暂只支持 OZON 退货同步' });
    if (shop.status !== 'ACTIVE') return reply.send({ code: 0, msg: '店铺状态异常，请先测试连接' });

    const job = await prisma.syncJob.create({
      data: { shopId: shop.id, type: 'RETURN_PULL', status: 'RUNNING', startedAt: new Date() },
    });

    const client = new OzonClient({
      clientId: shop.clientId!,
      apiKey: decrypt(shop.apiKeyEncrypted),
    });

    try {
      const since = body.since
        ? new Date(body.since).toISOString()
        : new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

      let lastId = 0;
      let total = 0;
      let pages = 0;

      while (pages < 20) {
        const res = await client.getReturnsList({
          filter: { since, to: new Date().toISOString() },
          last_id: lastId,
          limit: 100,
        });
        if (!res.returns || res.returns.length === 0) break;

        for (const item of res.returns) {
          if (!item.id) continue;
          const platformReturnId = String(item.id);
          await prisma.return.upsert({
            where: { shopId_platformReturnId: { shopId: shop.id, platformReturnId } },
            create: {
              shopId: shop.id,
              platformReturnId,
              postingNumber: item.posting?.posting_number ?? null,
              status: item.visual_status?.system_name || 'unknown',
              reason: item.return_reason_name ?? null,
              product: item.product as any,
              quantity: item.product?.quantity ?? 1,
              amount: item.product?.price?.price ? item.product.price.price : null,
              currency: item.product?.price?.currency_code || 'RUB',
              returnedToWarehouse: !!item.moved_to_warehouse,
              acceptedAt: item.arrived_moment ? new Date(item.arrived_moment) : null,
              returnedAt: item.return_date ? new Date(item.return_date) : null,
              raw: item as any,
            },
            update: {
              status: item.visual_status?.system_name || 'unknown',
              reason: item.return_reason_name ?? null,
              product: item.product as any,
              quantity: item.product?.quantity ?? 1,
              amount: item.product?.price?.price ? item.product.price.price : null,
              currency: item.product?.price?.currency_code || 'RUB',
              returnedToWarehouse: !!item.moved_to_warehouse,
              acceptedAt: item.arrived_moment ? new Date(item.arrived_moment) : null,
              returnedAt: item.return_date ? new Date(item.return_date) : null,
              raw: item as any,
            },
          });
          total++;
        }

        if (!res.has_next) break;
        lastId = res.last_id;
        pages++;
      }

      await prisma.syncJob.update({
        where: { id: job.id },
        data: { status: 'SUCCESS', finishedAt: new Date(), payload: { count: total } },
      });

      return reply.send({ code: 1, msg: `已同步 ${total} 条退货记录`, data: { count: total } });
    } catch (e: any) {
      await prisma.syncJob.update({
        where: { id: job.id },
        data: { status: 'FAILED', finishedAt: new Date(), errorMessage: e.message },
      });
      return reply.send({ code: 0, msg: `同步失败: ${e.message}` });
    }
  });

  app.get('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const item = await prisma.return.findUnique({
      where: { id },
      include: { shop: { select: { userId: true, name: true, platform: true } } },
    });
    if (!item || item.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '退货记录不存在' });
    }
    return reply.send({
      code: 1,
      msg: 'ok',
      data: { ...item, amount: item.amount?.toString() ?? null },
    });
  });

  // 手动提交退件申请
  app.post('/apply', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = manualReturnSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const shop = await prisma.shop.findFirst({ where: { id: parsed.data.shopId, userId } });
    if (!shop) return reply.status(404).send({ code: 0, msg: '店铺不存在' });

    const platformReturnId = `MANUAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const returnRecord = await prisma.return.create({
      data: {
        shopId: parsed.data.shopId,
        platformReturnId,
        postingNumber: parsed.data.postingNumber || null,
        status: 'pending_review',
        reason: parsed.data.reason,
        reasonCode: parsed.data.reasonCode || null,
        product: parsed.data.product || null,
        quantity: parsed.data.quantity,
        amount: parsed.data.amount || null,
        currency: parsed.data.currency,
        raw: { manual: true, appliedBy: userId },
      },
    });

    return reply.send({
      code: 1,
      msg: '退件申请已提交，等待审核',
      data: { ...returnRecord, amount: returnRecord.amount?.toString() ?? null },
    });
  });

  // 管理员审核退件
  app.post('/:id/review', async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'ADMIN') return reply.status(403).send({ code: 0, msg: '无权操作' });

    const { id } = request.params as { id: string };
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: '参数错误' });

    const item = await prisma.return.findUnique({ where: { id } });
    if (!item) return reply.status(404).send({ code: 0, msg: '退货记录不存在' });
    if (item.status !== 'pending_review') {
      return reply.status(400).send({ code: 0, msg: '该记录不在待审核状态' });
    }

    const { action, resolution } = parsed.data;
    const newStatus = action === 'approve' ? 'approved' : 'rejected';
    const rawData = (item.raw as Record<string, unknown>) || {};

    const updated = await prisma.return.update({
      where: { id },
      data: {
        status: newStatus,
        raw: { ...rawData, reviewedAt: new Date().toISOString(), resolution: resolution || null },
        acceptedAt: action === 'approve' ? new Date() : undefined,
      },
    });

    return reply.send({
      code: 1,
      msg: action === 'approve' ? '已批准退件' : '已拒绝退件',
      data: { ...updated, amount: updated.amount?.toString() ?? null },
    });
  });
}

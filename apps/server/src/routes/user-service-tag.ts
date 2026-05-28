import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const createTagSchema = z.object({
  name: z.string().min(1).max(20),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, '颜色必须为 #RRGGBB 格式'),
  description: z.string().max(100).optional(),
  sortOrder: z.coerce.number().int().default(0),
});

const updateTagSchema = createTagSchema.partial();

const setOrderTagsSchema = z.object({
  tagIds: z.array(z.string()),
});

export async function userServiceTagRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const list = await prisma.userServiceTag.findMany({
      where: { userId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return reply.send({ code: 1, msg: 'ok', data: list });
  });

  app.post('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { customColorEnabled: true } });
    if (!user?.customColorEnabled) {
      return reply.status(403).send({ code: 0, msg: '当前账号未开通自定义颜色权限' });
    }
    const parsed = createTagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const tag = await prisma.userServiceTag.create({
      data: { userId, ...parsed.data },
    });
    return reply.send({ code: 1, msg: '已创建', data: tag });
  });

  app.put('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const parsed = updateTagSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const tag = await prisma.userServiceTag.findUnique({ where: { id } });
    if (!tag || tag.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '标签不存在' });
    }
    const updated = await prisma.userServiceTag.update({ where: { id }, data: parsed.data });
    return reply.send({ code: 1, msg: '已更新', data: updated });
  });

  app.delete('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const tag = await prisma.userServiceTag.findUnique({ where: { id } });
    if (!tag || tag.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '标签不存在' });
    }
    await prisma.userServiceTag.delete({ where: { id } });
    return reply.send({ code: 1, msg: '已删除' });
  });

  app.put('/orders/:orderId', async (request, reply) => {
    const { userId } = (request as any).user;
    const { orderId } = request.params as { orderId: string };
    const parsed = setOrderTagsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { shop: { select: { userId: true } } },
    });
    if (!order || order.shop.userId !== userId) {
      return reply.status(404).send({ code: 0, msg: '订单不存在' });
    }
    if (parsed.data.tagIds.length > 0) {
      const owned = await prisma.userServiceTag.count({
        where: { id: { in: parsed.data.tagIds }, userId },
      });
      if (owned !== parsed.data.tagIds.length) {
        return reply.status(400).send({ code: 0, msg: '存在非法标签 ID' });
      }
    }
    await prisma.order.update({
      where: { id: orderId },
      data: { userColorTags: parsed.data.tagIds },
    });
    return reply.send({ code: 1, msg: '已保存' });
  });
}

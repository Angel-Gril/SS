import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const createSchema = z.object({
  name: z.string().min(1, '模板名称不能为空'),
  type: z.enum(['text', 'image']).default('text'),
  text: z.string().optional(),
  imageUrl: z.string().optional(),
  position: z.enum(['bottom-right', 'center', 'tile', 'top-left', 'top-right', 'bottom-left']).default('bottom-right'),
  opacity: z.coerce.number().int().min(0).max(100).default(50),
  fontSize: z.coerce.number().int().min(8).max(200).optional(),
  fontColor: z.string().optional(),
  scale: z.coerce.number().int().min(5).max(100).optional(),
  isDefault: z.boolean().default(false),
  shopId: z.string().optional().nullable(),
});

const updateSchema = createSchema.partial();

export async function watermarkTemplateRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const { shopId } = request.query as { shopId?: string };
    const where: any = { userId };
    if (shopId) where.OR = [{ shopId }, { shopId: null }];
    const list = await prisma.watermarkTemplate.findMany({ where, orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }] });
    return reply.send({ code: 1, msg: 'ok', data: list });
  });

  app.get('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const tpl = await prisma.watermarkTemplate.findFirst({ where: { id, userId } });
    if (!tpl) return reply.status(404).send({ code: 0, msg: '模板不存在' });
    return reply.send({ code: 1, msg: 'ok', data: tpl });
  });

  app.post('/', async (request, reply) => {
    const { userId } = (request as any).user;
    const parsed = createSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    if (parsed.data.isDefault) {
      await prisma.watermarkTemplate.updateMany({
        where: { userId, isDefault: true, shopId: parsed.data.shopId ?? null },
        data: { isDefault: false },
      });
    }
    const tpl = await prisma.watermarkTemplate.create({
      data: { ...parsed.data, userId, shopId: parsed.data.shopId ?? null },
    });
    return reply.send({ code: 1, msg: '创建成功', data: tpl });
  });

  app.put('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const existing = await prisma.watermarkTemplate.findFirst({ where: { id, userId } });
    if (!existing) return reply.status(404).send({ code: 0, msg: '模板不存在' });
    if (parsed.data.isDefault) {
      await prisma.watermarkTemplate.updateMany({
        where: { userId, isDefault: true, id: { not: id }, shopId: parsed.data.shopId ?? existing.shopId },
        data: { isDefault: false },
      });
    }
    const tpl = await prisma.watermarkTemplate.update({ where: { id }, data: parsed.data as any });
    return reply.send({ code: 1, msg: '更新成功', data: tpl });
  });

  app.delete('/:id', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const existing = await prisma.watermarkTemplate.findFirst({ where: { id, userId } });
    if (!existing) return reply.status(404).send({ code: 0, msg: '模板不存在' });
    await prisma.watermarkTemplate.delete({ where: { id } });
    return reply.send({ code: 1, msg: '已删除' });
  });
}

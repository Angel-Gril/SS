import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate, requireRole } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const createSchema = z.object({
  city: z.string().min(1),
  province: z.string().optional(),
  type: z.enum(['collect', 'dispatch']),
  name: z.string().min(1),
  address: z.string().min(1),
  contact: z.string().optional(),
  phone: z.string().optional(),
  workingHours: z.string().optional(),
  note: z.string().optional(),
  isActive: z.boolean().default(true),
  sortOrder: z.coerce.number().int().default(0),
});

const updateSchema = createSchema.partial();

export async function ozonPickupPointRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // 用户列表：所有登录用户均可查看；可按 city / type / isActive 过滤
  app.get('/', async (request, reply) => {
    const { city, type, includeInactive } = request.query as {
      city?: string; type?: string; includeInactive?: string;
    };
    const where: any = {};
    if (!includeInactive) where.isActive = true;
    if (type) where.type = type;
    if (city) where.city = { contains: city, mode: 'insensitive' };

    const list = await prisma.ozonPickupPoint.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { city: 'asc' }, { createdAt: 'desc' }],
    });
    return reply.send({ code: 1, msg: 'ok', data: list });
  });

  // 以下仅超管可操作
  app.register(async (admin) => {
    admin.addHook('preHandler', requireRole('ADMIN'));

    admin.post('/', async (request, reply) => {
      const parsed = createSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
      }
      const item = await prisma.ozonPickupPoint.create({ data: parsed.data });
      return reply.send({ code: 1, msg: '已创建', data: item });
    });

    admin.put('/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      const parsed = updateSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
      }
      const item = await prisma.ozonPickupPoint.update({ where: { id }, data: parsed.data });
      return reply.send({ code: 1, msg: '已更新', data: item });
    });

    admin.delete('/:id', async (request, reply) => {
      const { id } = request.params as { id: string };
      await prisma.ozonPickupPoint.delete({ where: { id } });
      return reply.send({ code: 1, msg: '已删除' });
    });
  });
}

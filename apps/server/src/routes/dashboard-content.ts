import type { FastifyInstance } from 'fastify';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { authenticate, requireRole } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const blockTypeSchema = z.enum([
  'BANNER',
  'QUICK_LINKS',
  'STEP_GROUP',
  'TUTORIALS',
  'UPDATE_CARD',
  'SUPPORT_LINKS',
  'CHECKLIST',
]);

const dashboardContentSchema = z.object({
  key: z.string().min(2).max(80).regex(/^[a-z0-9][a-z0-9_-]*$/, 'key 只能包含小写字母、数字、下划线和短横线'),
  type: blockTypeSchema,
  title: z.string().min(1).max(160),
  subtitle: z.string().max(240).optional().nullable(),
  content: z.record(z.string(), z.unknown()).default({}),
  targetRole: z.enum(['ALL', 'USER', 'ADMIN', 'STAFF']).default('ALL'),
  enabled: z.boolean().default(true),
  sortOrder: z.coerce.number().int().min(-10000).max(10000).default(0),
  publishedAt: z.string().datetime().optional().nullable(),
  expiresAt: z.string().datetime().optional().nullable(),
});

const updateDashboardContentSchema = dashboardContentSchema.partial();

function visibleDashboardContentWhere(role: string, now: Date, type?: string) {
  return {
    enabled: true,
    ...(type ? { type } : {}),
    targetRole: { in: ['ALL', role] as any[] },
    OR: [
      { publishedAt: null },
      { publishedAt: { lte: now } },
    ],
    AND: [
      {
        OR: [
          { expiresAt: null },
          { expiresAt: { gt: now } },
        ],
      },
    ],
  };
}

function toDate(value?: string | null) {
  return value ? new Date(value) : null;
}

function mapBlock(block: any) {
  return {
    id: block.id,
    key: block.key,
    type: block.type,
    title: block.title,
    subtitle: block.subtitle,
    content: block.content,
    targetRole: block.targetRole,
    enabled: block.enabled,
    sortOrder: block.sortOrder,
    publishedAt: block.publishedAt,
    expiresAt: block.expiresAt,
    createdAt: block.createdAt,
    updatedAt: block.updatedAt,
  };
}

export async function dashboardContentRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request, reply) => {
    const { role } = (request as any).user;
    const query = request.query as { type?: string };
    const parsedType = query.type ? blockTypeSchema.safeParse(query.type) : null;
    if (query.type && !parsedType?.success) {
      return reply.status(400).send({ code: 0, msg: '内容类型无效' });
    }

    const now = new Date();
    const items = await prisma.dashboardContentBlock.findMany({
      where: visibleDashboardContentWhere(role || 'USER', now, parsedType?.data),
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
    });

    return reply.send({ code: 1, msg: 'ok', data: { items: items.map(mapBlock) } });
  });

  app.get('/admin/list', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const query = request.query as { page?: string; pageSize?: string; type?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 30));
    const parsedType = query.type ? blockTypeSchema.safeParse(query.type) : null;
    if (query.type && !parsedType?.success) {
      return reply.status(400).send({ code: 0, msg: '内容类型无效' });
    }

    const where = parsedType?.data ? { type: parsedType.data } : {};
    const [total, items] = await Promise.all([
      prisma.dashboardContentBlock.count({ where }),
      prisma.dashboardContentBlock.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return reply.send({ code: 1, msg: 'ok', data: { items: items.map(mapBlock), total, page, pageSize } });
  });

  app.post('/admin/create', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const parsed = dashboardContentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { userId } = (request as any).user;
    const data = parsed.data;
    const block = await prisma.dashboardContentBlock.create({
      data: {
        key: data.key,
        type: data.type,
        title: data.title,
        subtitle: data.subtitle || null,
        content: data.content as Prisma.InputJsonValue,
        targetRole: data.targetRole,
        enabled: data.enabled,
        sortOrder: data.sortOrder,
        publishedAt: toDate(data.publishedAt),
        expiresAt: toDate(data.expiresAt),
        createdBy: userId,
      },
    });

    return reply.status(201).send({ code: 1, msg: '已创建', data: mapBlock(block) });
  });

  app.patch('/admin/:id', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateDashboardContentSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const data = parsed.data;
    const updateData: Prisma.DashboardContentBlockUpdateInput = {};
    if (data.key !== undefined) updateData.key = data.key;
    if (data.type !== undefined) updateData.type = data.type;
    if (data.title !== undefined) updateData.title = data.title;
    if (data.subtitle !== undefined) updateData.subtitle = data.subtitle || null;
    if (data.content !== undefined) updateData.content = data.content as Prisma.InputJsonValue;
    if (data.targetRole !== undefined) updateData.targetRole = data.targetRole;
    if (data.enabled !== undefined) updateData.enabled = data.enabled;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    if (data.publishedAt !== undefined) updateData.publishedAt = toDate(data.publishedAt);
    if (data.expiresAt !== undefined) updateData.expiresAt = toDate(data.expiresAt);

    const block = await prisma.dashboardContentBlock.update({
      where: { id },
      data: updateData,
    });

    return reply.send({ code: 1, msg: '已更新', data: mapBlock(block) });
  });

  app.delete('/admin/:id', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.dashboardContentBlock.delete({ where: { id } });
    return reply.send({ code: 1, msg: '已删除' });
  });
}

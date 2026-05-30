import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireRole } from '../lib/auth.js';
import { z } from 'zod';

const createAnnouncementSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  type: z.enum(['NOTICE', 'UPDATE', 'ALERT']).default('NOTICE'),
  priority: z.enum(['NORMAL', 'IMPORTANT', 'CRITICAL']).default('NORMAL'),
  targetRole: z.enum(['ALL', 'USER', 'ADMIN', 'STAFF']).default('ALL'),
  attachments: z.array(z.object({
    name: z.string().min(1).max(120),
    url: z.string().url().refine((value) => {
      try {
        const protocol = new URL(value).protocol;
        return protocol === 'http:' || protocol === 'https:';
      } catch {
        return false;
      }
    }, '附件链接必须是 http(s) URL'),
    size: z.number().int().nonnegative().max(20 * 1024 * 1024).optional(),
    mime: z.string().max(120).optional(),
  })).max(10).optional(),
  forcePopup: z.boolean().default(false),
  publishedAt: z.string().datetime().optional(),
  expiresAt: z.string().datetime().optional(),
});

const updateAnnouncementSchema = createAnnouncementSchema.partial();

function visibleAnnouncementWhere(role: string, now: Date) {
  return {
    publishedAt: { not: null, lte: now },
    OR: [
      { expiresAt: null },
      { expiresAt: { gt: now } },
    ],
    targetRole: { in: ['ALL', role] as any[] },
  };
}

export async function announcementRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // 用户：获取与自己角色匹配的已发布公告
  app.get('/list', async (request, reply) => {
    const { role, userId } = (request as any).user;
    const now = new Date();

    const announcements = await prisma.announcement.findMany({
      where: {
        ...visibleAnnouncementWhere(role, now),
      },
      orderBy: { publishedAt: 'desc' },
      take: 50,
      include: {
        reads: { where: { userId }, select: { readAt: true } },
      },
    });

    const data = announcements.map((a) => ({
      id: a.id,
      title: a.title,
      content: a.content,
      type: a.type,
      priority: a.priority,
      attachments: a.attachments,
      forcePopup: a.forcePopup,
      publishedAt: a.publishedAt,
      isRead: a.reads.length > 0,
    }));

    return reply.send({ code: 1, data });
  });

  // 用户：未读数
  app.get('/unread-count', async (request, reply) => {
    const { role, userId } = (request as any).user;
    const now = new Date();

    const count = await prisma.announcement.count({
      where: {
        ...visibleAnnouncementWhere(role, now),
        reads: { none: { userId } },
      },
    });

    return reply.send({ code: 1, data: { count } });
  });

  // 用户：需要强制弹窗的未读公告
  app.get('/force-popup', async (request, reply) => {
    const { role, userId } = (request as any).user;
    const now = new Date();

    const popups = await prisma.announcement.findMany({
      where: {
        ...visibleAnnouncementWhere(role, now),
        forcePopup: true,
        reads: { none: { userId } },
      },
      orderBy: { priority: 'desc' },
      take: 5,
    });

    return reply.send({ code: 1, data: popups });
  });

  // 用户：标记已读
  app.post('/:id/read', async (request, reply) => {
    const { role, userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const now = new Date();

    const announcement = await prisma.announcement.findFirst({
      where: {
        id,
        ...visibleAnnouncementWhere(role, now),
      },
      select: { id: true },
    });
    if (!announcement) {
      return reply.status(404).send({ code: 0, msg: '公告不存在或不可访问' });
    }

    await prisma.announcementRead.upsert({
      where: { announcementId_userId: { announcementId: id, userId } },
      create: { announcementId: id, userId },
      update: {},
    });

    return reply.send({ code: 1, msg: 'ok' });
  });

  // 管理员：创建公告
  app.post('/admin/create', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const parsed = createAnnouncementSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { userId } = (request as any).user;
    const data = parsed.data;

    const announcement = await prisma.announcement.create({
      data: {
        title: data.title,
        content: data.content,
        type: data.type,
        priority: data.priority,
        targetRole: data.targetRole,
        attachments: data.attachments || undefined,
        forcePopup: data.forcePopup,
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : new Date(),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        createdBy: userId,
      },
    });

    return reply.status(201).send({ code: 1, data: announcement });
  });

  // 管理员：更新公告
  app.patch('/admin/:id', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = updateAnnouncementSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const data = parsed.data;
    const announcement = await prisma.announcement.update({
      where: { id },
      data: {
        ...data,
        publishedAt: data.publishedAt ? new Date(data.publishedAt) : undefined,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      },
    });

    return reply.send({ code: 1, data: announcement });
  });

  // 管理员：删除公告
  app.delete('/admin/:id', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    await prisma.announcement.delete({ where: { id } });
    return reply.send({ code: 1, msg: '已删除' });
  });

  // 管理员：列出所有公告（含草稿）
  app.get('/admin/list', { preHandler: [requireRole('ADMIN')] }, async (request, reply) => {
    const query = request.query as { page?: string; pageSize?: string };
    const page = Math.max(1, Number(query.page) || 1);
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));

    const [total, items] = await Promise.all([
      prisma.announcement.count(),
      prisma.announcement.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          creator: { select: { nickname: true } },
          _count: { select: { reads: true } },
        },
      }),
    ]);

    return reply.send({ code: 1, data: { items, total, page, pageSize } });
  });
}

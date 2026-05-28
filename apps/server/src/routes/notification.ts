import type { FastifyInstance } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export async function notificationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { read?: string; type?: string; offset?: string; limit?: string };

    const where: Record<string, unknown> = { userId };
    if (query.read === 'true') where.read = true;
    if (query.read === 'false') where.read = false;
    if (query.type) where.type = query.type;

    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 20));

    const [total, rows, unreadCount] = await Promise.all([
      prisma.notification.count({ where: where as any }),
      prisma.notification.findMany({
        where: where as any,
        skip: offset,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where: { userId, read: false } }),
    ]);

    return { code: 1, msg: 'ok', data: { total, rows, unreadCount } };
  });

  app.get('/unread-count', async (request) => {
    const { userId } = (request as any).user;
    const count = await prisma.notification.count({ where: { userId, read: false } });
    return { code: 1, msg: 'ok', data: { count } };
  });

  app.put('/:id/read', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };

    const notif = await prisma.notification.findFirst({ where: { id, userId } });
    if (!notif) return reply.status(404).send({ code: 0, msg: '通知不存在' });

    await prisma.notification.update({ where: { id }, data: { read: true } });
    return reply.send({ code: 1, msg: 'ok' });
  });

  app.post('/read-all', async (request) => {
    const { userId } = (request as any).user;
    await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true } });
    return { code: 1, msg: '已全部标为已读' };
  });

  app.delete('/clear-read', async (request) => {
    const { userId } = (request as any).user;
    await prisma.notification.deleteMany({ where: { userId, read: true } });
    return { code: 1, msg: '已清除已读通知' };
  });
}

export async function createNotification(userId: string, data: {
  type: string;
  title: string;
  content?: string;
  link?: string;
}) {
  return prisma.notification.create({
    data: { userId, ...data },
  });
}

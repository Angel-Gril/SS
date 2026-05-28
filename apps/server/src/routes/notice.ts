import type { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../lib/auth.js';

export async function noticeRoutes(app: FastifyInstance) {
  app.get('/', async (request) => {
    const query = request.query as { offset?: string; limit?: string };
    const offset = Math.max(0, Number(query.offset) || 0);
    const limit = Math.min(50, Math.max(1, Number(query.limit) || 10));

    const [total, rows] = await Promise.all([
      prisma.notice.count(),
      prisma.notice.findMany({
        skip: offset,
        take: limit,
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }],
        select: {
          id: true,
          title: true,
          content: true,
          level: true,
          pinned: true,
          publishedAt: true,
        },
      }),
    ]);

    return { code: 1, msg: 'ok', data: { total, rows } };
  });

  app.get('/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const notice = await prisma.notice.findUnique({ where: { id } });
    if (!notice) {
      return reply.status(404).send({ code: 0, msg: '公告不存在' });
    }
    return { code: 1, msg: 'ok', data: notice };
  });
}

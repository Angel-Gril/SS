import type { FastifyInstance } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export async function searchRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/', async (request) => {
    const { userId } = (request as any).user;
    const { q } = request.query as { q?: string };

    if (!q || q.trim().length < 2) {
      return { code: 1, msg: 'ok', data: { orders: [], products: [] } };
    }

    const keyword = q.trim();
    const userShops = await prisma.shop.findMany({ where: { userId }, select: { id: true } });
    const shopIds = userShops.map((s) => s.id);

    const [orders, products] = await Promise.all([
      prisma.order.findMany({
        where: {
          shopId: { in: shopIds },
          OR: [
            { postingNumber: { contains: keyword, mode: 'insensitive' } },
            { platformOrderId: { contains: keyword, mode: 'insensitive' } },
            { domesticTrackingNumber: { contains: keyword, mode: 'insensitive' } },
            { internationalTrackingNumber: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          postingNumber: true,
          platformOrderId: true,
          status: true,
          totalAmount: true,
          currency: true,
          createdAt: true,
          shop: { select: { name: true } },
        },
        take: 10,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.product.findMany({
        where: {
          shopId: { in: shopIds },
          OR: [
            { sku: { contains: keyword, mode: 'insensitive' } },
            { offerId: { contains: keyword, mode: 'insensitive' } },
            { title: { contains: keyword, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          sku: true,
          offerId: true,
          title: true,
          price: true,
          currency: true,
          stock: true,
          images: true,
          shop: { select: { name: true } },
        },
        take: 10,
        orderBy: { updatedAt: 'desc' },
      }),
    ]);

    return {
      code: 1,
      msg: 'ok',
      data: {
        orders: orders.map((o) => ({
          ...o,
          totalAmount: o.totalAmount?.toString() ?? null,
        })),
        products: products.map((p) => ({
          ...p,
          price: p.price?.toString() ?? null,
        })),
      },
    };
  });
}

import type { FastifyInstance } from 'fastify';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

export async function logisticsRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // 接收扩展推送的菜鸟包裹数据
  app.post('/cainiao-packages', async (request, reply) => {
    const { userId } = (request as any).user;
    const body = request.body as { packages: any[] };

    if (!body?.packages?.length) {
      return reply.status(400).send({ code: 0, msg: '无包裹数据' });
    }

    let saved = 0;
    for (const pkg of body.packages.slice(0, 200)) {
      if (!pkg.trackingNumber || pkg.trackingNumber.length < 8) continue;
      try {
        await prisma.cainiaoPackage.upsert({
          where: { userId_trackingNumber: { userId, trackingNumber: pkg.trackingNumber } },
          create: {
            userId,
            trackingNumber: pkg.trackingNumber,
            carrier: pkg.carrier || null,
            carrierCode: pkg.carrierCode || null,
            status: pkg.status || null,
            statusDesc: pkg.statusDesc || null,
            updateTime: pkg.updateTime || null,
            sender: pkg.sender || null,
            receiver: pkg.receiver || null,
          },
          update: {
            carrier: pkg.carrier || undefined,
            carrierCode: pkg.carrierCode || undefined,
            status: pkg.status || undefined,
            statusDesc: pkg.statusDesc || undefined,
            updateTime: pkg.updateTime || undefined,
          },
        });
        saved++;
      } catch {
        // skip individual package errors
      }
    }

    return reply.send({ code: 1, msg: `已同步 ${saved} 个包裹`, data: { saved } });
  });

  // 获取未绑定的包裹列表（供前端下拉选择）
  app.get('/cainiao-packages', async (request) => {
    const { userId } = (request as any).user;
    const query = request.query as { bound?: string };

    const where: Record<string, unknown> = { userId };
    if (query.bound === 'false') where.boundToOrderId = null;

    const packages = await prisma.cainiaoPackage.findMany({
      where: where as any,
      orderBy: { syncedAt: 'desc' },
      take: 100,
    });

    return { code: 1, msg: 'ok', data: packages };
  });

  // 绑定包裹到订单
  app.post('/cainiao-packages/:id/bind', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const body = request.body as { orderId: string };

    if (!body?.orderId) {
      return reply.status(400).send({ code: 0, msg: '请指定订单' });
    }

    const pkg = await prisma.cainiaoPackage.findFirst({ where: { id, userId } });
    if (!pkg) return reply.status(404).send({ code: 0, msg: '包裹不存在' });

    // 更新包裹绑定状态
    await prisma.cainiaoPackage.update({
      where: { id },
      data: { boundToOrderId: body.orderId },
    });

    // 同时更新订单的国内物流信息
    await prisma.order.update({
      where: { id: body.orderId },
      data: {
        domesticTrackingNumber: pkg.trackingNumber,
        domesticCarrier: pkg.carrier || '未知',
        domesticStatus: 'shipped',
      },
    });

    return reply.send({ code: 1, msg: '绑定成功' });
  });
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { createNotification } from './notification.js';

const inviteSchema = z.object({
  clientUserId: z.string().min(1),
  feeOverride: z.coerce.number().min(0).optional(),
});

export async function providerRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // --- 管理员：开通/关闭代理 ---

  app.post('/admin/enable', async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'ADMIN') return reply.status(403).send({ code: 0, msg: '无权限' });
    const { userId, providerFee, platformFee } = request.body as { userId: string; providerFee?: number; platformFee?: number };
    if (!userId) return reply.status(400).send({ code: 0, msg: '缺少 userId' });
    await prisma.user.update({
      where: { id: userId },
      data: {
        isTransitProvider: true,
        providerFee: providerFee ?? 2,
        platformFee: platformFee ?? 0.5,
      },
    });
    return reply.send({ code: 1, msg: '已开通代理权限' });
  });

  app.post('/admin/disable', async (request, reply) => {
    const { role } = (request as any).user;
    if (role !== 'ADMIN') return reply.status(403).send({ code: 0, msg: '无权限' });
    const { userId } = request.body as { userId: string };
    if (!userId) return reply.status(400).send({ code: 0, msg: '缺少 userId' });
    await prisma.user.update({
      where: { id: userId },
      data: { isTransitProvider: false },
    });
    return reply.send({ code: 1, msg: '已关闭代理权限' });
  });

  // --- 代理：子用户管理 ---

  app.get('/clients', async (request, reply) => {
    const { userId } = (request as any).user;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { isTransitProvider: true } });
    if (!user?.isTransitProvider) return reply.status(403).send({ code: 0, msg: '非代理用户' });

    const clients = await prisma.providerClient.findMany({
      where: { providerId: userId },
      orderBy: { createdAt: 'desc' },
    });
    const clientIds = clients.map((c) => c.clientId);
    const users = await prisma.user.findMany({
      where: { id: { in: clientIds } },
      select: { id: true, phone: true, nickname: true, status: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    return reply.send({
      code: 1,
      msg: 'ok',
      data: clients.map((c) => ({
        ...c,
        feeOverride: c.feeOverride?.toString() ?? null,
        client: userMap.get(c.clientId) || null,
      })),
    });
  });

  app.post('/clients/invite', async (request, reply) => {
    const { userId } = (request as any).user;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { isTransitProvider: true } });
    if (!user?.isTransitProvider) return reply.status(403).send({ code: 0, msg: '非代理用户' });

    const parsed = inviteSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });

    const target = await prisma.user.findUnique({ where: { id: parsed.data.clientUserId } });
    if (!target) return reply.status(404).send({ code: 0, msg: '目标用户不存在' });

    const existing = await prisma.providerClient.findUnique({
      where: { providerId_clientId: { providerId: userId, clientId: parsed.data.clientUserId } },
    });
    if (existing) return reply.status(400).send({ code: 0, msg: '已存在关联关系' });

    await prisma.providerClient.create({
      data: {
        providerId: userId,
        clientId: parsed.data.clientUserId,
        status: 'pending',
        feeOverride: parsed.data.feeOverride ?? null,
      },
    });

    await createNotification(parsed.data.clientUserId, {
      type: 'provider_invite',
      title: '收到代理邀请',
      content: `用户邀请您加入其代理网络，确认后您的订单将由代理打包发货`,
      link: '/provider-invites',
    });

    return reply.send({ code: 1, msg: '邀请已发送' });
  });

  app.get('/invites', async (request, reply) => {
    const { userId } = (request as any).user;
    const invites = await prisma.providerClient.findMany({
      where: { clientId: userId, status: 'pending' },
      orderBy: { createdAt: 'desc' },
    });
    const providerIds = invites.map((i) => i.providerId);
    const providers = await prisma.user.findMany({
      where: { id: { in: providerIds } },
      select: { id: true, phone: true, nickname: true, accountCode: true, providerFee: true },
    });
    const providerMap = new Map(providers.map((p) => [p.id, p]));
    return reply.send({
      code: 1,
      msg: 'ok',
      data: invites.map((i) => ({
        id: i.id,
        providerId: i.providerId,
        feeOverride: i.feeOverride?.toString() ?? null,
        createdAt: i.createdAt,
        provider: providerMap.get(i.providerId)
          ? {
              ...providerMap.get(i.providerId)!,
              providerFee: providerMap.get(i.providerId)!.providerFee?.toString() ?? null,
            }
          : null,
      })),
    });
  });

  app.post('/clients/:id/accept', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const rel = await prisma.providerClient.findUnique({ where: { id } });
    if (!rel || rel.clientId !== userId) return reply.status(404).send({ code: 0, msg: '邀请不存在' });
    if (rel.status !== 'pending') return reply.status(400).send({ code: 0, msg: '邀请已处理' });
    await prisma.providerClient.update({ where: { id }, data: { status: 'active' } });
    return reply.send({ code: 1, msg: '已接受' });
  });

  app.post('/clients/:id/reject', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const rel = await prisma.providerClient.findUnique({ where: { id } });
    if (!rel || rel.clientId !== userId) return reply.status(404).send({ code: 0, msg: '邀请不存在' });
    if (rel.status !== 'pending') return reply.status(400).send({ code: 0, msg: '邀请已处理' });
    await prisma.providerClient.update({ where: { id }, data: { status: 'rejected' } });
    return reply.send({ code: 1, msg: '已拒绝' });
  });

  app.put('/clients/:id/fee', async (request, reply) => {
    const { userId } = (request as any).user;
    const { id } = request.params as { id: string };
    const { feeOverride } = request.body as { feeOverride: number | null };
    const rel = await prisma.providerClient.findUnique({ where: { id } });
    if (!rel || rel.providerId !== userId) return reply.status(404).send({ code: 0, msg: '关系不存在' });
    await prisma.providerClient.update({ where: { id }, data: { feeOverride } });
    return reply.send({ code: 1, msg: '费率已更新' });
  });

  // --- 代理仓库端：查看子用户订单 ---

  app.get('/warehouse/orders', async (request, reply) => {
    const { userId } = (request as any).user;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { isTransitProvider: true } });
    if (!user?.isTransitProvider) return reply.status(403).send({ code: 0, msg: '非代理用户' });

    const clients = await prisma.providerClient.findMany({
      where: { providerId: userId, status: 'active' },
      select: { clientId: true },
    });
    const clientIds = [userId, ...clients.map((c) => c.clientId)];

    const { status, limit, offset } = request.query as { status?: string; limit?: string; offset?: string };
    const shops = await prisma.shop.findMany({
      where: { userId: { in: clientIds } },
      select: { id: true },
    });
    const shopIds = shops.map((s) => s.id);

    const where: any = { shopId: { in: shopIds } };
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit || '50'),
        skip: parseInt(offset || '0'),
        include: { shop: { select: { name: true, userId: true } } },
      }),
      prisma.order.count({ where }),
    ]);

    return reply.send({ code: 1, msg: 'ok', data: { total, rows: orders } });
  });

  // --- 代理三层计费（在订单入库时触发） ---

  app.post('/warehouse/bill-order', async (request, reply) => {
    const { userId } = (request as any).user;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { isTransitProvider: true, providerFee: true, platformFee: true, account: true },
    });
    if (!user?.isTransitProvider) return reply.status(403).send({ code: 0, msg: '非代理用户' });

    const { orderId } = request.body as { orderId: string };
    if (!orderId) return reply.status(400).send({ code: 0, msg: '缺少 orderId' });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { shop: { include: { user: { include: { account: true } } } } },
    });
    if (!order) return reply.status(404).send({ code: 0, msg: '订单不存在' });

    const clientUserId = order.shop.userId;
    const rel = await prisma.providerClient.findFirst({
      where: { providerId: userId, clientId: clientUserId, status: 'active' },
    });
    if (!rel && clientUserId !== userId) {
      return reply.status(403).send({ code: 0, msg: '该订单用户非您的子用户' });
    }

    const clientFee = Number(rel?.feeOverride ?? user.providerFee ?? 2);
    const platformCut = Number(user.platformFee ?? 0.5);
    const clientAccount = order.shop.user.account;
    const providerAccount = user.account;

    if (!clientAccount || !providerAccount) {
      return reply.status(400).send({ code: 0, msg: '账户未初始化' });
    }

    await prisma.$transaction(async (tx) => {
      const updatedClient = await tx.userAccount.update({
        where: { id: clientAccount.id },
        data: { balance: { decrement: clientFee } },
      });
      await tx.transaction.create({
        data: {
          accountId: clientAccount.id,
          type: 'consume',
          amount: -clientFee,
          balanceAfter: updatedClient.balance,
          orderId,
          module: 'provider_fee',
          description: `代理服务费 - 订单 ${order.postingNumber}`,
        },
      });

      const providerIncome = clientFee - platformCut;
      const updatedProvider = await tx.userAccount.update({
        where: { id: providerAccount.id },
        data: { balance: { increment: providerIncome } },
      });
      await tx.transaction.create({
        data: {
          accountId: providerAccount.id,
          type: 'recharge',
          amount: providerIncome,
          balanceAfter: updatedProvider.balance,
          orderId,
          module: 'provider_income',
          description: `代理收入 - 订单 ${order.postingNumber}（扣平台费 ¥${platformCut}）`,
        },
      });
    });

    return reply.send({
      code: 1,
      msg: '三层计费完成',
      data: { clientFee, platformCut, providerIncome: clientFee - platformCut },
    });
  });
}

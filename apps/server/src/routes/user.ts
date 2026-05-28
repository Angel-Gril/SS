import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';

const switchPortalSchema = z.object({
  portal: z.enum(['user', 'warehouse']),
});

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  app.get('/me', async (request) => {
    const { actorUserId, effectiveUserId, isSubAccount, parentId, accountCode } = (request as any).user;

    // 个人字段（手机号/昵称/头像）取实际登录账号；能力字段（perOrderFee/isTransitProvider 等）取数据归属账号（即父账号）
    const [actor, owner] = await Promise.all([
      prisma.user.findUnique({
        where: { id: actorUserId },
        select: {
          id: true,
          phone: true,
          nickname: true,
          avatar: true,
          role: true,
          status: true,
          accountCode: true,
          createdAt: true,
          lastLoginAt: true,
        },
      }),
      prisma.user.findUnique({
        where: { id: effectiveUserId },
        select: {
          balance: true,
          tenantType: true,
          perOrderFee: true,
          customColorEnabled: true,
          canPublishAddress: true,
          isTransitProvider: true,
          activePortal: true,
          accountCode: true,
          nickname: true,
          _count: { select: { shops: true } },
        },
      }),
    ]);

    if (!actor || !owner) {
      return { code: 0, msg: '用户不存在' };
    }

    return {
      code: 1,
      msg: 'ok',
      data: {
        // 个人身份
        id: actor.id,
        phone: actor.phone,
        nickname: actor.nickname,
        avatar: actor.avatar,
        role: actor.role,
        status: actor.status,
        accountCode: actor.accountCode,
        createdAt: actor.createdAt,
        lastLoginAt: actor.lastLoginAt,
        // 子账号标记
        isSubAccount,
        parentAccountCode: isSubAccount ? owner.accountCode : null,
        parentNickname: isSubAccount ? owner.nickname : null,
        // 能力 / 计费 / 余额（取父账号）
        balance: owner.balance.toString(),
        tenantType: owner.tenantType,
        perOrderFee: owner.perOrderFee?.toString() ?? null,
        customColorEnabled: owner.customColorEnabled,
        canPublishAddress: owner.canPublishAddress,
        isTransitProvider: owner.isTransitProvider,
        activePortal: owner.activePortal,
        shopCount: owner._count.shops,
      },
    };
  });

  app.post('/switch-portal', async (request, reply) => {
    // 视图切换是账户级别（父账号），二级账号也会影响父账号的视图
    // 如果不希望二级账号能切换，前端应隐藏入口；后端这里依然走 effective
    const { userId } = (request as any).user;
    const parsed = switchPortalSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }
    const user = await prisma.user.update({
      where: { id: userId },
      data: { activePortal: parsed.data.portal },
      select: { activePortal: true, tenantType: true, role: true },
    });
    return reply.send({ code: 1, msg: '已切换', data: user });
  });

  app.get('/shops', async (request) => {
    const { userId } = (request as any).user;
    const shops = await prisma.shop.findMany({
      where: { userId },
      select: {
        id: true,
        platform: true,
        name: true,
        status: true,
        balance: true,
        lastSyncAt: true,
        createdAt: true,
        _count: { select: { products: true, orders: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      code: 1,
      msg: 'ok',
      data: shops.map((s) => ({
        ...s,
        balance: s.balance.toString(),
        productCount: s._count.products,
        orderCount: s._count.orders,
      })),
    };
  });
}

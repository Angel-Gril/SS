import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { changePasswordSchema, updateProfileSchema } from 'shared';
import { authenticate, clearAuthCookie, removeAllSessions } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { sendEmail } from '../lib/email/index.js';

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
          email: true,
          nickname: true,
          avatar: true,
          role: true,
          status: true,
          isSuperAdmin: true,
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
        email: actor.email,
        nickname: actor.nickname,
        avatar: actor.avatar,
        role: actor.role,
        status: actor.status,
        isSuperAdmin: actor.role === 'ADMIN' && actor.isSuperAdmin,
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

  app.patch('/profile', async (request, reply) => {
    const { actorUserId } = (request as any).user;
    const parsed = updateProfileSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const data: { email?: string | null; nickname?: string } = {};
    if ('email' in parsed.data) data.email = parsed.data.email ?? null;
    if (parsed.data.nickname !== undefined) data.nickname = parsed.data.nickname;

    try {
      const user = await prisma.user.update({
        where: { id: actorUserId },
        data,
        select: {
          id: true,
          phone: true,
          email: true,
          nickname: true,
          avatar: true,
        },
      });

      return reply.send({ code: 1, msg: '资料已保存', data: user });
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return reply.status(409).send({ code: 0, msg: '该邮箱已被其他账号使用' });
      }
      throw error;
    }
  });

  app.post('/test-email', async (request, reply) => {
    const { actorUserId } = (request as any).user;
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: {
        id: true,
        email: true,
        nickname: true,
        status: true,
      },
    });

    if (!user || user.status === 'SUSPENDED') {
      return reply.status(403).send({ code: 0, msg: '账号不可用' });
    }
    if (!user.email) {
      return reply.status(400).send({ code: 0, msg: '请先填写通知邮箱' });
    }

    try {
      const result = await sendEmail({
        to: user.email,
        subject: 'SS ERP 测试邮件',
        text: `这是一封 SS ERP 测试邮件。${user.nickname ? `账号：${user.nickname}。` : ''}如果您收到本邮件，说明通知邮箱可以正常接收系统邮件。`,
        html: [
          '<!doctype html>',
          '<html><body style="font-family:Arial,sans-serif;color:#172033;line-height:1.6">',
          '<h2 style="margin:0 0 12px">SS ERP 测试邮件</h2>',
          '<p>如果您收到本邮件，说明通知邮箱可以正常接收系统邮件。</p>',
          '<p style="color:#64748b;font-size:12px;margin-top:24px">SS ERP 系统通知</p>',
          '</body></html>',
        ].join(''),
      });

      if (!result.ok) {
        return reply.status(502).send({ code: 0, msg: result.err || '测试邮件发送失败' });
      }
      return reply.send({ code: 1, msg: '测试邮件已发送', data: { bizId: result.bizId ?? null } });
    } catch (error: any) {
      return reply.status(502).send({ code: 0, msg: error?.message || '测试邮件发送失败' });
    }
  });

  app.get('/onboarding-status', async (request) => {
    const { userId } = (request as any).user;
    const [shopCount, orderCount, warehouseCount] = await Promise.all([
      prisma.shop.count({ where: { userId } }),
      prisma.order.count({ where: { shop: { userId } } }),
      prisma.warehouse.count({ where: { shop: { userId } } }),
    ]);

    const hasShop = shopCount > 0;
    const hasOrder = orderCount > 0;
    const hasWarehouse = warehouseCount > 0;
    const nextStep = !hasShop
      ? 'add-shop'
      : !hasOrder
        ? 'sync-orders'
        : !hasWarehouse
          ? 'configure-warehouse'
          : null;

    return {
      code: 1,
      msg: 'ok',
      data: {
        hasShop,
        hasOrder,
        hasWarehouse,
        completed: nextStep === null,
        nextStep,
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

  app.post('/change-password', async (request, reply) => {
    const { actorUserId } = (request as any).user;
    const parsed = changePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { id: true, passwordHash: true, status: true },
    });
    if (!user || user.status === 'SUSPENDED') {
      return reply.status(403).send({ code: 0, msg: '账号不可用' });
    }

    const valid = await bcrypt.compare(parsed.data.oldPassword, user.passwordHash);
    if (!valid) {
      return reply.status(400).send({ code: 0, msg: '原密码错误' });
    }

    const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
    await prisma.user.update({
      where: { id: actorUserId },
      data: { passwordHash },
    });
    await removeAllSessions(actorUserId);
    clearAuthCookie(reply);

    return reply.send({ code: 1, msg: '密码已修改，请重新登录' });
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

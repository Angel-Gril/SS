import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { authenticate } from '../lib/auth.js';
import { prisma } from '../lib/prisma.js';
import { generateAccountCode } from '../lib/account-code.js';

const createInviteSchema = z.object({
  phone: z.string().min(11, '手机号格式不正确').max(11),
  password: z.string().min(6, '密码至少6位'),
  nickname: z.string().optional(),
});

export async function inviteRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authenticate);

  // GET /api/invite/info — 获取裂变信息
  app.get('/info', async (request, reply) => {
    // 裂变信息看的是「实际登录账号」是否能裂变，必须用 actorUserId
    const { actorUserId } = (request as any).user;
    const user = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { canInvite: true, inviteLimit: true, inviteCount: true, parentId: true, accountCode: true },
    });

    if (!user) {
      return reply.status(404).send({ code: 0, msg: '用户不存在' });
    }

    // 二级子账号永远不能裂变，前端据此隐藏入口
    const effectiveCanInvite = !user.parentId && user.canInvite;

    return reply.send({
      code: 1,
      msg: 'ok',
      data: {
        canInvite: effectiveCanInvite,
        inviteLimit: user.inviteLimit,
        inviteCount: user.inviteCount,
        remaining: effectiveCanInvite ? user.inviteLimit - user.inviteCount : 0,
        accountCode: user.accountCode,
        isSubAccount: !!user.parentId,
      },
    });
  });

  // POST /api/invite/create — 创建裂变账号
  app.post('/create', async (request, reply) => {
    // 裂变操作必须基于「实际登录账号」判断权限和归属
    const { actorUserId } = (request as any).user;

    const currentUser = await prisma.user.findUnique({
      where: { id: actorUserId },
      select: { canInvite: true, inviteLimit: true, inviteCount: true, parentId: true },
    });

    if (!currentUser) {
      return reply.status(404).send({ code: 0, msg: '用户不存在' });
    }

    // 二级子账号不允许再次裂变（防止子账号被误开 canInvite 后穿透）
    if (currentUser.parentId) {
      return reply.status(403).send({ code: 0, msg: '二级子账号无法再次裂变' });
    }

    if (!currentUser.canInvite) {
      return reply.status(403).send({ code: 0, msg: '您没有裂变权限' });
    }

    if (currentUser.inviteCount >= currentUser.inviteLimit) {
      return reply.status(400).send({ code: 0, msg: `已达裂变上限 (${currentUser.inviteLimit})` });
    }

    const parsed = createInviteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.errors[0]?.message ?? '参数错误' });
    }

    const { phone, password, nickname } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return reply.status(409).send({ code: 0, msg: '该手机号已注册' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // 此时 actorUserId 必为根账号（前面已校验 parentId 必须为 null）
    // 用统一的 generateAccountCode（按现有兄弟最大值 +1，避免删除回填后冲突）
    const accountCode = await generateAccountCode(actorUserId);

    const newUser = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          phone,
          passwordHash,
          nickname: nickname || `用户${phone.slice(-4)}`,
          role: 'USER',
          canInvite: false,
          parentId: actorUserId,
          accountCode,
        },
      });

      await tx.user.update({
        where: { id: actorUserId },
        data: { inviteCount: { increment: 1 } },
      });

      return user;
    });

    return reply.send({
      code: 1,
      msg: '裂变账号创建成功',
      data: {
        id: newUser.id,
        phone: newUser.phone,
        nickname: newUser.nickname,
        accountCode: newUser.accountCode,
        role: newUser.role,
      },
    });
  });

  // GET /api/invite/list — 我裂变的账号列表
  app.get('/list', async (request, reply) => {
    const { userId } = (request as any).user;

    const invitedUsers = await prisma.user.findMany({
      where: { parentId: userId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        phone: true,
        nickname: true,
        accountCode: true,
        role: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });

    return reply.send({ code: 1, msg: 'ok', data: invitedUsers });
  });
}

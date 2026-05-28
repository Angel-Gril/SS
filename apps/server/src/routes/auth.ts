import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { registerSchema, loginSchema } from 'shared';
import { prisma } from '../lib/prisma.js';
import { signToken, storeSession, removeSession, authenticate } from '../lib/auth.js';
import { generateAccountCode } from '../lib/account-code.js';

export async function authRoutes(app: FastifyInstance) {
  app.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { phone, password, nickname } = parsed.data;

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return reply.status(409).send({ code: 0, msg: '该手机号已注册' });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const accountCode = await generateAccountCode(null);
    const user = await prisma.user.create({
      data: { phone, passwordHash, nickname: nickname || `用户${phone.slice(-4)}`, accountCode },
    });

    const token = signToken({ userId: user.id, role: user.role });
    await storeSession(user.id, token);

    return reply.status(201).send({
      code: 1,
      msg: '注册成功',
      data: {
        user: {
          id: user.id,
          phone: user.phone,
          nickname: user.nickname,
          avatar: user.avatar,
          role: user.role,
          status: user.status,
          balance: user.balance.toString(),
        },
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      },
    });
  });

  app.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { phone, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return reply.status(401).send({ code: 0, msg: '手机号或密码错误' });
    }

    if (user.status === 'SUSPENDED') {
      return reply.status(403).send({ code: 0, msg: '账号已被禁用' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ code: 0, msg: '手机号或密码错误' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const token = signToken({ userId: user.id, role: user.role });
    await storeSession(user.id, token);

    return reply.send({
      code: 1,
      msg: '登录成功',
      data: {
        user: {
          id: user.id,
          phone: user.phone,
          nickname: user.nickname,
          avatar: user.avatar,
          role: user.role,
          status: user.status,
          balance: user.balance.toString(),
        },
        token,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
      },
    });
  });

  app.post('/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const token = request.headers.authorization!.slice(7);
    const user = (request as any).user;
    // session key 按实际登录账号 ID 存的（见 authenticate）
    await removeSession(user.actorUserId, token);
    return reply.send({ code: 1, msg: '已退出' });
  });

  app.post('/extension-token', { preHandler: [authenticate] }, async (request, reply) => {
    // 扩展 token 是给当前实际登录账号的（子账号要走自己），不能用 effectiveUserId
    const { actorUserId, role } = (request as any).user;
    const extensionToken = signToken({ userId: actorUserId, role }, '30d');
    await storeSession(actorUserId, extensionToken, 30 * 24 * 3600);
    return reply.send({
      code: 1,
      msg: '扩展Token已生成（30天有效）',
      data: { token: extensionToken, expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() },
    });
  });
}

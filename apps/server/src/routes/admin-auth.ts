import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../lib/prisma.js';
import { signToken, storeSession, setAuthCookie, authenticate, requireRole } from '../lib/auth.js';
import { verifyHumanChallenge } from '../lib/human-challenge.js';

const ADMIN_SESSION_TTL_SECONDS = 24 * 60 * 60;

const adminLoginSchema = z.object({
  phone: z.string().min(11).max(11),
  password: z.string().min(6),
  humanChallengeToken: z.string().optional(),
});

export async function adminAuthRoutes(app: FastifyInstance) {
  await app.register(import('@fastify/rate-limit'), {
    global: false,
  });

  app.post('/login', {
    config: {
      rateLimit: {
        max: 5,
        timeWindow: '1 minute',
        keyGenerator: (request) => request.ip,
        errorResponseBuilder: (_request, context) => ({
          statusCode: context.statusCode,
          code: 0,
          msg: '登录尝试过于频繁，请稍后再试',
        }),
      },
    },
  }, async (request, reply) => {
    const parsed = adminLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }
    const humanChallengeToken = parsed.data.humanChallengeToken;
    if (!await verifyHumanChallenge({
      action: 'admin_login',
      token: humanChallengeToken || '',
      ip: request.ip,
    })) {
      return reply.status(403).send({ code: 0, msg: '请完成人机验证' });
    }


    const { phone, password } = parsed.data;

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user || user.role !== 'ADMIN') {
      return reply.status(401).send({ code: 0, msg: '账号或密码错误' });
    }

    if (user.status === 'SUSPENDED') {
      return reply.status(403).send({ code: 0, msg: '账号已被禁用' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ code: 0, msg: '账号或密码错误' });
    }

    const token = signToken({ userId: user.id, role: user.role, authVersion: user.authVersion }, '24h');
    await storeSession(user.id, token, ADMIN_SESSION_TTL_SECONDS);
    setAuthCookie(reply, token, ADMIN_SESSION_TTL_SECONDS);

    return reply.send({
      code: 1,
      data: {
        token,
        expiresAt: new Date(Date.now() + ADMIN_SESSION_TTL_SECONDS * 1000).toISOString(),
        user: { id: user.id, phone: user.phone, nickname: user.nickname, role: user.role },
      },
    });
  });

  app.get('/me', { preHandler: [authenticate, requireRole('ADMIN')] }, async (request, reply) => {
    const user = (request as any).user;
    return reply.send({
      code: 1,
      data: { userId: user.userId, role: user.role },
    });
  });
}

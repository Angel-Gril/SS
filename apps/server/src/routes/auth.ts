import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { registerSchema, loginSchema, sendSmsCodeSchema } from 'shared';
import { prisma } from '../lib/prisma.js';
import { signToken, storeSession, removeSession, authenticate, extractToken, setAuthCookie, clearAuthCookie } from '../lib/auth.js';
import { generateAccountCode } from '../lib/account-code.js';
import { verifyTurnstile, sendSmsCode, verifySmsCode } from '../lib/captcha.js';
import {
  getPublicAuthChallengeConfig,
  isSmsRegistrationChallengeEnabled,
} from '../lib/auth-challenge-config.js';

const authRateLimitConfig = {
  rateLimit: {
    max: 10,
    timeWindow: '1 minute',
    keyGenerator: (request: FastifyRequest) => request.ip,
    errorResponseBuilder: (_request: FastifyRequest, context: { statusCode: number }) => ({
      statusCode: context.statusCode,
      code: 0,
      msg: '请求过于频繁，请稍后再试',
    }),
  },
};

export async function authRoutes(app: FastifyInstance) {
  // auth 专用频控只挂到敏感 POST 路由，避免 challenge-config 消耗登录尝试桶。
  await app.register(import('@fastify/rate-limit'), {
    global: false,
  });

  app.get('/challenge-config', async (_request, reply) => {
    const config = await getPublicAuthChallengeConfig();
    return reply.send({ code: 1, msg: 'ok', data: config });
  });

  // 发送短信验证码（注册前调用）
  app.post('/sms-code', { config: authRateLimitConfig }, async (request, reply) => {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (adminCount === 0) {
      return reply.status(403).send({ code: 0, msg: '系统尚未初始化，请先创建管理员账号' });
    }

    const parsed = sendSmsCodeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { phone, turnstileToken } = parsed.data;
    if (!await isSmsRegistrationChallengeEnabled()) {
      return reply.send({ code: 1, msg: '当前无需短信验证码' });
    }

    if (!await verifyTurnstile(turnstileToken || '', request.ip)) {
      return reply.status(403).send({ code: 0, msg: '人机验证失败，请重试' });
    }

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return reply.status(409).send({ code: 0, msg: '该手机号已注册' });
    }

    const result = await sendSmsCode(phone);
    return reply.send({ code: result.ok ? 1 : 0, msg: result.msg });
  });

  app.post('/register', { config: authRateLimitConfig }, async (request, reply) => {
    const adminCount = await prisma.user.count({ where: { role: 'ADMIN' } });
    if (adminCount === 0) {
      return reply.status(403).send({ code: 0, msg: '系统尚未初始化，请先创建管理员账号' });
    }

    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { phone, password, nickname, smsCode } = parsed.data;

    if (await isSmsRegistrationChallengeEnabled() && (!smsCode || !await verifySmsCode(phone, smsCode))) {
      return reply.status(400).send({ code: 0, msg: '验证码错误或已过期' });
    }

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
    setAuthCookie(reply, token);

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
      },
    });
  });

  app.post('/login', { config: authRateLimitConfig }, async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { phone, password, turnstileToken } = parsed.data;

    const { redis } = await import('../lib/redis.js');
    const failKey = `login:fail:${request.ip}`;
    const failCount = Number(await redis.get(failKey) || '0');

    if (!await verifyTurnstile(turnstileToken || '', request.ip)) {
      const hint = failCount >= 5 ? '登录失败次数过多，' : '';
      return reply.status(403).send({ code: 0, msg: `${hint}请完成人机验证` });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      await redis.incr(failKey);
      await redis.expire(failKey, 3600);
      return reply.status(401).send({ code: 0, msg: '手机号或密码错误' });
    }

    if (user.status === 'SUSPENDED') {
      return reply.status(403).send({ code: 0, msg: '账号已被禁用' });
    }

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      await redis.incr(failKey);
      await redis.expire(failKey, 3600);
      return reply.status(401).send({ code: 0, msg: '手机号或密码错误' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    // 登录成功，清除失败计数
    await redis.del(failKey);

    const token = signToken({ userId: user.id, role: user.role });
    await storeSession(user.id, token);
    setAuthCookie(reply, token);

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
      },
    });
  });

  app.post('/logout', { preHandler: [authenticate] }, async (request, reply) => {
    const user = (request as any).user;
    const token = extractToken(request);
    if (token) await removeSession(user.actorUserId, token);
    clearAuthCookie(reply);
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

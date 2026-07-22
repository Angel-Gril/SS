import type { FastifyInstance, FastifyRequest } from 'fastify';
import bcrypt from 'bcryptjs';
import { getLegalProfile, registerSchema, loginSchema, smsLoginSchema, resetPasswordWithSmsSchema, sendSmsCodeSchema } from 'shared';
import { prisma } from '../lib/prisma.js';
import { signToken, signLegacyExtensionToken, storeSession, removeSession, removeAllSessions, authenticate, extractToken, setAuthCookie, clearAuthCookie, clearAuthContextCache } from '../lib/auth.js';
import { generateAccountCode } from '../lib/account-code.js';
import { sendSmsCode, verifySmsCode } from '../lib/captcha.js';
import {
  getPublicAuthChallengeConfig,
  isSmsLoginChallengeEnabled,
  isSmsRegistrationChallengeEnabled,
} from '../lib/auth-challenge-config.js';
import { getPublicHumanChallengeConfig, issueHumanChallenge, verifyHumanChallenge, type HumanChallengeAction } from '../lib/human-challenge.js';
import { isLegacyExtensionTokenIssuanceEnabled } from '../lib/extension-device-auth.js';
import { revokeExtensionDeviceSessionsForUserInTransaction } from '../services/extension-device-session-prisma.js';

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
const REMEMBER_ME_TTL_SECONDS = 7 * 24 * 60 * 60;

export async function authRoutes(app: FastifyInstance) {
  // auth 专用频控只挂到敏感 POST 路由，避免 challenge-config 消耗登录尝试桶。
  await app.register(import('@fastify/rate-limit'), {
    global: false,
  });

  app.get('/challenge-config', async (_request, reply) => {
    const config = await getPublicAuthChallengeConfig();
    return reply.send({ code: 1, msg: 'ok', data: { ...config, ...await getPublicHumanChallengeConfig() } });
  });

  app.get('/human-challenge', async (request, reply) => {
    const action = (request.query as { action?: string }).action as HumanChallengeAction;
    try {
      return reply.send({ code: 1, msg: 'ok', data: await issueHumanChallenge(action) });
    } catch {
      return reply.status(400).send({ code: 0, msg: '不支持的人机验证场景' });
    }
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

    const { phone, turnstileToken, humanChallengeToken } = parsed.data;
    if (!await isSmsRegistrationChallengeEnabled()) {
      return reply.send({ code: 1, msg: '当前无需短信验证码' });
    }

    if (!await verifyHumanChallenge({ action: 'register_sms', token: humanChallengeToken || turnstileToken || '', ip: request.ip })) {
      return reply.status(403).send({ code: 0, msg: '人机验证失败，请重试' });
    }

    const existing = await prisma.user.findUnique({ where: { phone } });
    if (existing) {
      return reply.status(409).send({ code: 0, msg: '该手机号已注册' });
    }

    const result = await sendSmsCode(phone, 'register', { ip: request.ip });
    return reply.send({
      code: result.ok ? 1 : 0,
      msg: result.msg,
      ...(!result.ok ? { errorCode: result.errorCode } : {}),
    });
  });

  app.post('/password-reset/sms-code', { config: authRateLimitConfig }, async (request, reply) => {
    const parsed = sendSmsCodeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { phone, turnstileToken, humanChallengeToken } = parsed.data;
    if (!await verifyHumanChallenge({ action: 'password_reset_sms', token: humanChallengeToken || turnstileToken || '', ip: request.ip })) {
      return reply.status(403).send({ code: 0, msg: '人机验证失败，请重试' });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (user && user.status !== 'SUSPENDED') {
      await sendSmsCode(phone, 'password-reset', { ip: request.ip });
    }
    return reply.send({ code: 1, msg: '如果该手机号已注册，验证码将发送至该手机' });
  });

  app.post('/sms-login-code', { config: authRateLimitConfig }, async (request, reply) => {
    const parsed = sendSmsCodeSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    if (!await isSmsLoginChallengeEnabled()) {
      return reply.status(403).send({ code: 0, msg: '短信验证码登录未启用' });
    }

    const { phone, turnstileToken, humanChallengeToken } = parsed.data;
    if (!await verifyHumanChallenge({ action: 'sms_login', token: humanChallengeToken || turnstileToken || '', ip: request.ip })) {
      return reply.status(403).send({ code: 0, msg: '人机验证失败，请重试' });
    }

    // Keep the response identical for unknown, suspended, and active numbers.
    const user = await prisma.user.findUnique({ where: { phone }, select: { status: true } });
    if (user && user.status !== 'SUSPENDED') {
      const result = await sendSmsCode(phone, 'sms-login', { ip: request.ip });
      if (!result.ok) request.log.warn('SMS login code delivery failed');
    }
    return reply.send({ code: 1, msg: '如果该手机号已注册，验证码将发送至该手机' });
  });

  app.post('/password-reset', { config: authRateLimitConfig }, async (request, reply) => {
    const parsed = resetPasswordWithSmsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    const { phone, smsCode, newPassword } = parsed.data;
    if (!await verifySmsCode(phone, smsCode, 'password-reset')) {
      return reply.status(400).send({ code: 0, msg: '验证码错误或已过期' });
    }

    const user = await prisma.user.findUnique({ where: { phone } });
    if (!user) {
      return reply.status(400).send({ code: 0, msg: '验证码错误或已过期' });
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { passwordHash, authVersion: { increment: 1 } },
      });
      await revokeExtensionDeviceSessionsForUserInTransaction(tx, user.id, 'PASSWORD_RESET');
    }, { isolationLevel: 'Serializable' });
    clearAuthContextCache(user.id);
    await removeAllSessions(user.id).catch(() => {
      request.log.warn({ userId: user.id }, 'Password reset could not purge cached web sessions');
    });
    clearAuthCookie(reply);
    return reply.send({ code: 1, msg: '密码已重置，请重新登录' });
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
    const legalProfile = getLegalProfile(process.env.LEGAL_PROFILE);
    const userAgent = typeof request.headers['user-agent'] === 'string'
      ? request.headers['user-agent'].slice(0, 500)
      : null;
    const user = await prisma.user.create({
      data: {
        phone,
        passwordHash,
        nickname: nickname || ('用户' + phone.slice(-4)),
        accountCode,
        legalAcceptances: {
          create: {
            profile: legalProfile.id,
            termsVersion: legalProfile.termsVersion,
            privacyVersion: legalProfile.privacyVersion,
            source: 'register',
            ipAddress: request.ip,
            userAgent,
          },
        },
      },
    });

    const token = signToken({ userId: user.id, role: user.role, authVersion: user.authVersion });
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

    const { phone, password, rememberMe = false, turnstileToken, humanChallengeToken } = parsed.data;

    const { redis } = await import('../lib/redis.js');
    const failKey = `login:fail:${request.ip}`;
    const failCount = Number(await redis.get(failKey) || '0');

    if (!await verifyHumanChallenge({ action: 'login', token: humanChallengeToken || turnstileToken || '', ip: request.ip })) {
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

    const sessionTtlSeconds = rememberMe ? REMEMBER_ME_TTL_SECONDS : undefined;
    const token = signToken({ userId: user.id, role: user.role, authVersion: user.authVersion }, rememberMe ? '7d' : undefined);
    await storeSession(user.id, token, sessionTtlSeconds);
    setAuthCookie(reply, token, sessionTtlSeconds);

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

  app.post('/sms-login', { config: authRateLimitConfig }, async (request, reply) => {
    const parsed = smsLoginSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ code: 0, msg: parsed.error.issues[0]?.message ?? '参数错误' });
    }

    if (!await isSmsLoginChallengeEnabled()) {
      return reply.status(403).send({ code: 0, msg: '短信验证码登录未启用' });
    }

    const { phone, smsCode, rememberMe = false, turnstileToken, humanChallengeToken } = parsed.data;
    if (!await verifyHumanChallenge({ action: 'sms_login', token: humanChallengeToken || turnstileToken || '', ip: request.ip })) {
      return reply.status(403).send({ code: 0, msg: '人机验证失败，请重试' });
    }

    const validCode = await verifySmsCode(phone, smsCode, 'sms-login');
    const user = await prisma.user.findUnique({ where: { phone } });
    if (!validCode || !user) {
      return reply.status(401).send({ code: 0, msg: '手机号或验证码错误' });
    }
    if (user.status === 'SUSPENDED') {
      return reply.status(403).send({ code: 0, msg: '账号已被禁用' });
    }

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    const sessionTtlSeconds = rememberMe ? REMEMBER_ME_TTL_SECONDS : undefined;
    const token = signToken({ userId: user.id, role: user.role, authVersion: user.authVersion }, rememberMe ? '7d' : undefined);
    await storeSession(user.id, token, sessionTtlSeconds);
    setAuthCookie(reply, token, sessionTtlSeconds);

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
    if (!isLegacyExtensionTokenIssuanceEnabled()) {
      return reply.status(410).send({
        code: 0,
        errorCode: 'legacy_extension_token_disabled',
        msg: '旧版扩展 Token 已停用，请使用设备配对',
      });
    }
    // 扩展 token 是给当前实际登录账号的（子账号要走自己），不能用 effectiveUserId
    const { actorUserId, role, authVersion } = (request as any).user;
    const extensionToken = signLegacyExtensionToken({ userId: actorUserId, role, authVersion }, '30d');
    await storeSession(actorUserId, extensionToken, 30 * 24 * 3600);
    return reply.send({
      code: 1,
      msg: '扩展Token已生成（30天有效）',
      data: { token: extensionToken, expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString() },
    });
  });
}

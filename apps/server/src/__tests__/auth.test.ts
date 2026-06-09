import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import bcrypt from 'bcryptjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { signToken, verifyToken } from '../lib/auth.js';
import { authRoutes } from '../routes/auth.js';

const prismaMock = vi.hoisted(() => ({
  user: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
}));

const captchaMock = vi.hoisted(() => ({
  sendSmsCode: vi.fn(),
  verifySmsCode: vi.fn(),
  verifyTurnstile: vi.fn(),
}));

const runtimeConfigMock = vi.hoisted(() => ({
  requiresAuthChallenges: vi.fn(),
}));

const redisMock = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  incr: vi.fn(),
  expire: vi.fn(),
  del: vi.fn(),
  scan: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({ prisma: prismaMock }));
vi.mock('../lib/captcha.js', () => captchaMock);
vi.mock('../adapters/runtime-config.js', () => runtimeConfigMock);
vi.mock('../lib/redis.js', () => ({ redis: redisMock }));

async function buildAuthApp() {
  const app = Fastify({ logger: false });
  await app.register(cookie);
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.user.count.mockResolvedValue(1);
  runtimeConfigMock.requiresAuthChallenges.mockReturnValue(true);
  captchaMock.verifyTurnstile.mockResolvedValue(true);
  captchaMock.sendSmsCode.mockResolvedValue({ ok: true, msg: '验证码已发送' });
    captchaMock.verifySmsCode.mockResolvedValue(true);
  redisMock.get.mockResolvedValue(null);
  redisMock.set.mockResolvedValue('OK');
  redisMock.incr.mockResolvedValue(1);
  redisMock.expire.mockResolvedValue(1);
  redisMock.del.mockResolvedValue(1);
  redisMock.scan.mockResolvedValue(['0', []]);
  prismaMock.user.findMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('auth token', () => {
  it('should sign and verify JWT token', () => {
    const payload = { userId: 'user-123', role: 'USER' };
    const token = signToken(payload);

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');

    const decoded = verifyToken(token);
    expect(decoded.userId).toBe('user-123');
    expect(decoded.role).toBe('USER');
  });

  it('should reject invalid token', () => {
    expect(() => verifyToken('invalid.token.here')).toThrow();
  });

  it('should reject expired token', () => {
    const payload = { userId: 'user-123', role: 'USER' };
    const token = signToken(payload, '1ms');

    return new Promise((resolve) => {
      setTimeout(() => {
        expect(() => verifyToken(token)).toThrow();
        resolve(undefined);
      }, 100);
    });
  });

  it('should handle custom expiry', () => {
    const payload = { userId: 'user-123', role: 'ADMIN' };
    const token = signToken(payload, '30d');

    const decoded = verifyToken(token);
    expect(decoded.userId).toBe('user-123');
    expect(decoded.role).toBe('ADMIN');
  });
});

describe('auth password reset', () => {
  it('sends reset sms code only for registered users', async () => {
    const app = await buildAuthApp();
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', phone: '13800138000' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password/sms-code',
      payload: { phone: '13800138000', turnstileToken: 'turnstile-ok' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, msg: '如果手机号已注册，验证码将发送至该号码' });
    expect(captchaMock.verifyTurnstile).toHaveBeenCalledWith('turnstile-ok', '127.0.0.1');
    expect(captchaMock.sendSmsCode).toHaveBeenCalledWith('13800138000');
    await app.close();
  });

  it('does not disclose unknown phones when requesting reset sms code', async () => {
    const app = await buildAuthApp();
    prismaMock.user.findUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password/sms-code',
      payload: { phone: '13800138000', turnstileToken: 'turnstile-ok' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, msg: '如果手机号已注册，验证码将发送至该号码' });
    expect(captchaMock.sendSmsCode).not.toHaveBeenCalled();
    await app.close();
  });

  it('does not disclose sms provider failures during reset sms request', async () => {
    const app = await buildAuthApp();
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', phone: '13800138000', status: 'ACTIVE' });
    captchaMock.sendSmsCode.mockResolvedValue({ ok: false, msg: '验证码发送失败，请稍后重试' });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password/sms-code',
      payload: { phone: '13800138000', turnstileToken: 'turnstile-ok' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, msg: '如果手机号已注册，验证码将发送至该号码' });
    expect(captchaMock.sendSmsCode).toHaveBeenCalledWith('13800138000');
    await app.close();
  });

  it('resets password after sms verification', async () => {
    const app = await buildAuthApp();
    const oldPasswordHash = await bcrypt.hash('OldPass123', 4);
    prismaMock.user.findUnique.mockResolvedValue({
      id: 'user-1',
      phone: '13800138000',
      passwordHash: oldPasswordHash,
      status: 'ACTIVE',
    });
    redisMock.scan.mockResolvedValue(['0', ['session:user-1:aaaa', 'session:user-1:bbbb']]);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: {
        phone: '13800138000',
        smsCode: '123456',
        newPassword: 'NewPass123',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ code: 1, msg: '密码已重置，请重新登录' });
    expect(captchaMock.verifySmsCode).toHaveBeenCalledWith('13800138000', '123456', { allowLocalBypass: false });
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { passwordHash: expect.any(String) },
    });
    expect(redisMock.scan).toHaveBeenCalledWith('0', 'MATCH', 'session:user-1:*', 'COUNT', 100);
    expect(redisMock.del).toHaveBeenCalledWith('session:user-1:aaaa', 'session:user-1:bbbb');
    const updateArgs = prismaMock.user.update.mock.calls[0]?.[0];
    expect(updateArgs).toBeDefined();
    const nextHash = updateArgs!.data.passwordHash;
    await expect(bcrypt.compare('NewPass123', nextHash)).resolves.toBe(true);
    await expect(bcrypt.compare('OldPass123', nextHash)).resolves.toBe(false);
    await app.close();
  });

  it('requires sms code even in local mode', async () => {
    const app = await buildAuthApp();
    runtimeConfigMock.requiresAuthChallenges.mockReturnValue(false);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: {
        phone: '13800138000',
        newPassword: 'NewPass123',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 0, msg: '请输入 6 位验证码' });
    expect(captchaMock.verifySmsCode).not.toHaveBeenCalled();
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects reset when sms verification fails', async () => {
    const app = await buildAuthApp();
    captchaMock.verifySmsCode.mockResolvedValue(false);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: {
        phone: '13800138000',
        smsCode: '000000',
        newPassword: 'NewPass123',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 0, msg: '验证码错误或已过期' });
    expect(prismaMock.user.update).not.toHaveBeenCalled();
    await app.close();
  });
});

describe('auth registration legal consent', () => {
  it('rejects registration without terms and privacy consent', async () => {
    const app = await buildAuthApp();
    prismaMock.user.findUnique.mockResolvedValue(null);

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        phone: '13800138000',
        password: 'Passw0rd123',
        smsCode: '123456',
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ code: 0, msg: '请先阅读并同意用户服务协议和隐私政策' });
    expect(prismaMock.user.create).not.toHaveBeenCalled();
    await app.close();
  });

  it('records terms and privacy consent timestamps when registering', async () => {
    const app = await buildAuthApp();
    prismaMock.user.findUnique.mockResolvedValue(null);
    prismaMock.user.create.mockResolvedValue({
      id: 'user-1',
      phone: '13800138000',
      nickname: '用户8000',
      avatar: null,
      role: 'USER',
      status: 'ACTIVE',
      balance: { toString: () => '0' },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        phone: '13800138000',
        password: 'Passw0rd123',
        smsCode: '123456',
        termsAccepted: true,
        privacyAccepted: true,
      },
    });

    expect(response.statusCode).toBe(201);
    expect(prismaMock.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        phone: '13800138000',
        termsAcceptedAt: expect.any(Date),
        privacyAcceptedAt: expect.any(Date),
      }),
    });
    const created = prismaMock.user.create.mock.calls[0]?.[0].data;
    expect(created?.termsAcceptedAt).toBe(created?.privacyAcceptedAt);
    await app.close();
  });
});

import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authRoutes } from '../routes/auth.js';

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  userUpdate: vi.fn(),
  verifyTurnstile: vi.fn(async () => true),
  verifyHumanChallenge: vi.fn(async () => true),
  sendSmsCode: vi.fn(async () => ({ ok: true, msg: '验证码已发送' })),
  verifySmsCode: vi.fn(async () => true),
  signToken: vi.fn(() => 'signed-token'),
  storeSession: vi.fn(),
  setAuthCookie: vi.fn(),
  removeAllSessions: vi.fn(async () => undefined),
  clearAuthContextCache: vi.fn(),
  revokeExtensionDeviceSessionsForUser: vi.fn(),
  revokeExtensionDeviceSessionsForUserInTransaction: vi.fn(),
  transaction: vi.fn(),
  comparePassword: vi.fn(async () => true),
  hashPassword: vi.fn(async () => 'new-password-hash'),
}));

vi.mock('bcryptjs', () => ({
  default: {
    compare: mocks.comparePassword,
    hash: mocks.hashPassword,
  },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    systemConfig: { findUnique: vi.fn(async () => null) },
    user: {
      count: vi.fn(async () => 1),
      findUnique: mocks.userFindUnique,
      create: vi.fn(),
      update: mocks.userUpdate,
    },
    $transaction: mocks.transaction,
  },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: vi.fn(async () => null),
    incr: vi.fn(async () => 1),
    expire: vi.fn(async () => 1),
    del: vi.fn(async () => 1),
  },
}));

vi.mock('../lib/account-code.js', () => ({
  generateAccountCode: vi.fn(async () => 'SS000001'),
}));

vi.mock('../lib/captcha.js', () => ({
  verifyTurnstile: mocks.verifyTurnstile,
  sendSmsCode: mocks.sendSmsCode,
  verifySmsCode: mocks.verifySmsCode,
}));

vi.mock('../lib/human-challenge.js', () => ({
  verifyHumanChallenge: mocks.verifyHumanChallenge,
  getPublicHumanChallengeConfig: vi.fn(async () => ({ provider: 'cloudflare-turnstile', turnstileSiteKey: 'site-key' })),
  issueHumanChallenge: vi.fn(),
}));

vi.mock('../lib/auth-challenge-config.js', () => ({
  getPublicAuthChallengeConfig: vi.fn(async () => ({
    runtimeMode: 'cloud',
    smsRegisterEnabled: true,
    smsLoginEnabled: true,
    turnstileEnabled: true,
    turnstileSiteKey: 'site-key',
    smsRateLimitSeconds: 60,
  })),
  isSmsRegistrationChallengeEnabled: vi.fn(async () => true),
  isSmsLoginChallengeEnabled: vi.fn(async () => true),
}));

vi.mock('../lib/auth.js', () => ({
  signToken: mocks.signToken,
  storeSession: mocks.storeSession,
  removeSession: vi.fn(),
  removeAllSessions: mocks.removeAllSessions,
  authenticate: vi.fn(),
  extractToken: vi.fn(),
  setAuthCookie: mocks.setAuthCookie,
  clearAuthCookie: vi.fn(),
  clearAuthContextCache: mocks.clearAuthContextCache,
}));
vi.mock('../services/extension-device-session-prisma.js', () => ({
  revokeExtensionDeviceSessionsForUser: mocks.revokeExtensionDeviceSessionsForUser,
  revokeExtensionDeviceSessionsForUserInTransaction:
    mocks.revokeExtensionDeviceSessionsForUserInTransaction,
}));

const activeUser = {
  id: 'user-1',
  phone: '19200000000',
  passwordHash: 'old-password-hash',
  nickname: '测试用户',
  avatar: null,
  role: 'USER',
  authVersion: 0,
  status: 'ACTIVE',
  balance: { toString: () => '0' },
};

async function buildApp() {
  const app = Fastify();
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
  return app;
}

describe('authentication session choices', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue(activeUser);
    mocks.userUpdate.mockResolvedValue(activeUser);
    mocks.verifyTurnstile.mockResolvedValue(true);
    mocks.verifyHumanChallenge.mockResolvedValue(true);
    mocks.verifySmsCode.mockResolvedValue(true);
    mocks.comparePassword.mockResolvedValue(true);
    mocks.transaction.mockImplementation(async (operation: (tx: unknown) => Promise<unknown>) =>
      operation({ user: { update: mocks.userUpdate } }),
    );
  });

  it('uses a persistent seven-day cookie only when rememberMe is selected', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { phone: activeUser.phone, password: 'secure123', rememberMe: true },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.signToken).toHaveBeenCalledWith({ userId: activeUser.id, role: activeUser.role, authVersion: 0 }, '7d');
      expect(mocks.storeSession).toHaveBeenCalledWith(activeUser.id, 'signed-token', 604800);
      expect(mocks.setAuthCookie.mock.calls[0]?.[2]).toBe(604800);
    } finally {
      await app.close();
    }
  });

  it('uses a browser-session cookie when rememberMe is not selected', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { phone: activeUser.phone, password: 'secure123', rememberMe: false },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.setAuthCookie.mock.calls[0]?.[2]).toBeUndefined();
    } finally {
      await app.close();
    }
  });
});

describe('SMS password reset', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue(activeUser);
    mocks.userUpdate.mockResolvedValue(activeUser);
    mocks.verifyTurnstile.mockResolvedValue(true);
    mocks.verifyHumanChallenge.mockResolvedValue(true);
    mocks.verifySmsCode.mockResolvedValue(true);
  });

  it('sends a purpose-scoped password reset code after Turnstile verification', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/password-reset/sms-code',
        payload: { phone: activeUser.phone, turnstileToken: 'turnstile-token' },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.verifyHumanChallenge).toHaveBeenCalledWith({ action: 'password_reset_sms', token: 'turnstile-token', ip: expect.any(String) });
      expect(mocks.sendSmsCode).toHaveBeenCalledWith(activeUser.phone, 'password-reset');
    } finally {
      await app.close();
    }
  });

  it('does not reveal whether a phone number is registered', async () => {
    mocks.userFindUnique
      .mockResolvedValueOnce(activeUser)
      .mockResolvedValueOnce(null);
    const app = await buildApp();
    try {
      const registeredResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/password-reset/sms-code',
        payload: { phone: activeUser.phone, turnstileToken: 'turnstile-token' },
      });
      const unknownResponse = await app.inject({
        method: 'POST',
        url: '/api/auth/password-reset/sms-code',
        payload: { phone: '19300000000', turnstileToken: 'turnstile-token' },
      });

      expect(registeredResponse.statusCode).toBe(200);
      expect(unknownResponse.statusCode).toBe(200);
      expect(registeredResponse.json()).toEqual(unknownResponse.json());
    } finally {
      await app.close();
    }
  });

  it('changes the password and revokes every existing session after a valid code', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/password-reset',
        payload: {
          phone: activeUser.phone,
          smsCode: '123456',
          newPassword: 'newSecure123',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.verifySmsCode).toHaveBeenCalledWith(activeUser.phone, '123456', 'password-reset');
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.userUpdate).toHaveBeenCalledWith({
        where: { id: activeUser.id },
        data: {
          passwordHash: 'new-password-hash',
          authVersion: { increment: 1 },
        },
      });
      expect(mocks.removeAllSessions).toHaveBeenCalledWith(activeUser.id);
      expect(mocks.revokeExtensionDeviceSessionsForUserInTransaction).toHaveBeenCalledWith(
        expect.anything(), activeUser.id, 'PASSWORD_RESET',
      );
      expect(mocks.revokeExtensionDeviceSessionsForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('does not change the password when the reset code is invalid', async () => {
    mocks.verifySmsCode.mockResolvedValue(false);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/password-reset',
        payload: {
          phone: activeUser.phone,
          smsCode: '000000',
          newPassword: 'newSecure123',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(mocks.userUpdate).not.toHaveBeenCalled();
      expect(mocks.removeAllSessions).not.toHaveBeenCalled();
      expect(mocks.revokeExtensionDeviceSessionsForUser).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

describe('SMS login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.userFindUnique.mockResolvedValue(activeUser);
    mocks.userUpdate.mockResolvedValue(activeUser);
    mocks.verifyHumanChallenge.mockResolvedValue(true);
    mocks.verifySmsCode.mockResolvedValue(true);
    mocks.sendSmsCode.mockResolvedValue({ ok: true, msg: '验证码已发送' });
    mocks.signToken.mockReturnValue('signed-token');
  });

  it('keeps the SMS login code response identical for known and unknown phones', async () => {
    mocks.userFindUnique
      .mockResolvedValueOnce(activeUser)
      .mockResolvedValueOnce(null);
    const app = await buildApp();
    try {
      const known = await app.inject({
        method: 'POST',
        url: '/api/auth/sms-login-code',
        payload: { phone: activeUser.phone, humanChallengeToken: 'challenge-token' },
      });
      const unknown = await app.inject({
        method: 'POST',
        url: '/api/auth/sms-login-code',
        payload: { phone: '19300000000', humanChallengeToken: 'challenge-token' },
      });

      expect(known.statusCode).toBe(200);
      expect(unknown.statusCode).toBe(200);
      expect(known.json()).toEqual(unknown.json());
      expect(mocks.verifyHumanChallenge).toHaveBeenCalledWith({
        action: 'sms_login', token: 'challenge-token', ip: expect.any(String),
      });
      expect(mocks.sendSmsCode).toHaveBeenCalledWith(activeUser.phone, 'sms-login');
    } finally {
      await app.close();
    }
  });

  it('creates the same persistent session as password login after a valid code', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sms-login',
        payload: {
          phone: activeUser.phone,
          smsCode: '123456',
          rememberMe: true,
          humanChallengeToken: 'challenge-token',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.verifyHumanChallenge).toHaveBeenCalledWith({
        action: 'sms_login', token: 'challenge-token', ip: expect.any(String),
      });
      expect(mocks.verifySmsCode).toHaveBeenCalledWith(activeUser.phone, '123456', 'sms-login');
      expect(mocks.userUpdate).toHaveBeenCalledWith({
        where: { id: activeUser.id },
        data: { lastLoginAt: expect.any(Date) },
      });
      expect(mocks.signToken).toHaveBeenCalledWith(
        { userId: activeUser.id, role: activeUser.role, authVersion: activeUser.authVersion },
        '7d',
      );
      expect(mocks.storeSession).toHaveBeenCalledWith(activeUser.id, 'signed-token', 604800);
      expect(mocks.setAuthCookie.mock.calls[0]?.[2]).toBe(604800);
    } finally {
      await app.close();
    }
  });

  it('does not create a session for an invalid code', async () => {
    mocks.verifySmsCode.mockResolvedValue(false);
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/sms-login',
        payload: {
          phone: activeUser.phone,
          smsCode: '000000',
          humanChallengeToken: 'challenge-token',
        },
      });

      expect(response.statusCode).toBe(401);
      expect(mocks.storeSession).not.toHaveBeenCalled();
      expect(mocks.setAuthCookie).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

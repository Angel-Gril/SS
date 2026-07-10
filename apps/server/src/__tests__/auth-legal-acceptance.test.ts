import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authRoutes } from '../routes/auth.js';

const mocks = vi.hoisted(() => ({
  userCreate: vi.fn(),
  setAuthCookie: vi.fn(),
  storeSession: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      count: vi.fn(async () => 1),
      findUnique: vi.fn(async () => null),
      create: mocks.userCreate,
      update: vi.fn(),
    },
    systemConfig: {
      findUnique: vi.fn(async () => null),
    },
  },
}));

vi.mock('../lib/account-code.js', () => ({
  generateAccountCode: vi.fn(async () => 'SS000001'),
}));

vi.mock('../lib/captcha.js', () => ({
  verifyTurnstile: vi.fn(async () => true),
  sendSmsCode: vi.fn(async () => ({ ok: true, msg: '验证码已发送' })),
  verifySmsCode: vi.fn(async () => true),
}));

vi.mock('../lib/auth-challenge-config.js', () => ({
  getPublicAuthChallengeConfig: vi.fn(async () => ({
    runtimeMode: 'local',
    smsRegisterEnabled: false,
    turnstileEnabled: false,
    turnstileSiteKey: '',
    smsRateLimitSeconds: 60,
  })),
  isSmsRegistrationChallengeEnabled: vi.fn(async () => false),
}));

vi.mock('../lib/auth.js', () => ({
  signToken: vi.fn(() => 'signed-token'),
  storeSession: mocks.storeSession,
  removeSession: vi.fn(),
  authenticate: vi.fn(),
  extractToken: vi.fn(),
  setAuthCookie: mocks.setAuthCookie,
  clearAuthCookie: vi.fn(),
}));

async function buildApp() {
  const app = Fastify();
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
  return app;
}

describe('registration legal acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('LEGAL_PROFILE', 'cloud-cn');
    mocks.userCreate.mockResolvedValue({
      id: 'user-1',
      phone: '19200000000',
      nickname: '测试用户',
      avatar: null,
      role: 'USER',
      status: 'ACTIVE',
      balance: { toString: () => '0' },
    });
  });

  it('stores the active legal profile and document versions with the new user', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/register',
        headers: { 'user-agent': 'vitest' },
        payload: {
          phone: '19200000000',
          password: 'secure123',
          nickname: '测试用户',
          legalAccepted: true,
        },
      });

      expect(response.statusCode).toBe(201);
      expect(mocks.userCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          legalAcceptances: {
            create: expect.objectContaining({
              profile: 'cloud-cn',
              termsVersion: '2026-07-10-cn',
              privacyVersion: '2026-07-10-cn',
              source: 'register',
              ipAddress: expect.any(String),
              userAgent: 'vitest',
            }),
          },
        }),
      }));
    } finally {
      await app.close();
    }
  });
});

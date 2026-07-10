import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupRoutes } from '../routes/setup.js';

const mocks = vi.hoisted(() => ({
  userCreate: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async () => null),
      create: mocks.userCreate,
    },
  },
}));

vi.mock('../lib/account-code.js', () => ({
  nextSuperAdminCode: vi.fn(async () => 'SS000000'),
}));

async function buildApp() {
  const app = Fastify();
  await app.register(setupRoutes, { prefix: '/api/setup' });
  await app.ready();
  return app;
}

describe('setup legal acceptance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('LEGAL_PROFILE', 'cloud-cn');
    vi.stubEnv('SETUP_TOKEN', '');
    mocks.userCreate.mockResolvedValue({
      id: 'admin-1',
      phone: '19200000000',
      nickname: '系统管理员',
      role: 'ADMIN',
      isSuperAdmin: true,
      accountCode: 'SS000000',
    });
  });

  it('rejects first-admin setup without explicit legal acceptance', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/setup/init',
        payload: {
          phone: '19200000000',
          password: 'secure123',
          nickname: '系统管理员',
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        code: 0,
        msg: expect.stringContaining('用户协议'),
      });
    } finally {
      await app.close();
    }
  });

  it('stores setup acceptance against the active legal profile', async () => {
    const app = await buildApp();

    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/setup/init',
        headers: { 'user-agent': 'vitest-setup' },
        payload: {
          phone: '19200000000',
          password: 'secure123',
          nickname: '系统管理员',
          legalAccepted: true,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mocks.userCreate).toHaveBeenCalledWith(expect.objectContaining({
        data: expect.objectContaining({
          legalAcceptances: {
            create: expect.objectContaining({
              profile: 'cloud-cn',
              termsVersion: '2026-07-10-cn',
              privacyVersion: '2026-07-10-cn',
              source: 'setup',
              ipAddress: expect.any(String),
              userAgent: 'vitest-setup',
            }),
          },
        }),
      }));
    } finally {
      await app.close();
    }
  });
});

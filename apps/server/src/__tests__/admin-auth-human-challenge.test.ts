import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminAuthRoutes } from '../routes/admin-auth.js';

const mocks = vi.hoisted(() => ({
  verifyHumanChallenge: vi.fn(async () => false),
  userFindUnique: vi.fn(),
}));

vi.mock('../lib/human-challenge.js', () => ({
  verifyHumanChallenge: mocks.verifyHumanChallenge,
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: { user: { findUnique: mocks.userFindUnique } },
}));

vi.mock('../lib/auth.js', () => ({
  signToken: vi.fn(),
  storeSession: vi.fn(),
  setAuthCookie: vi.fn(),
  authenticate: vi.fn(),
  requireRole: vi.fn(() => vi.fn()),
}));

async function buildApp() {
  const app = Fastify();
  await app.register(adminAuthRoutes, { prefix: '/api/admin/auth' });
  await app.ready();
  return app;
}

describe('admin auth human challenge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyHumanChallenge.mockResolvedValue(false);
  });

  it('requires an admin_login challenge before looking up the administrator', async () => {
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/auth/login',
        payload: {
          phone: '19200000000',
          password: 'secure123',
          humanChallengeToken: 'proof-token',
        },
      });

      expect(response.statusCode).toBe(403);
      expect(mocks.verifyHumanChallenge).toHaveBeenCalledWith({
        action: 'admin_login',
        token: 'proof-token',
        ip: expect.any(String),
      });
      expect(mocks.userFindUnique).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

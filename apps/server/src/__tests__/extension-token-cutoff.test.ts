import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { authRoutes } from '../routes/auth.js';

const mocks = vi.hoisted(() => ({
  signToken: vi.fn(() => 'legacy-extension-token'),
  storeSession: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  signToken: mocks.signToken,
  storeSession: mocks.storeSession,
  removeSession: vi.fn(),
  removeAllSessions: vi.fn(),
  extractToken: vi.fn(),
  setAuthCookie: vi.fn(),
  clearAuthCookie: vi.fn(),
  authenticate: vi.fn(async (request: any) => {
    request.user = {
      userId: 'user-1',
      actorUserId: 'user-1',
      effectiveUserId: 'user-1',
      role: 'USER',
      isSubAccount: false,
    };
  }),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: {
      count: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      create: vi.fn(),
    },
  },
}));

async function buildApp() {
  const app = Fastify();
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
  return app;
}

describe('legacy extension-token cutoff', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns 410 without signing or storing a token after cutoff', async () => {
    vi.stubEnv('AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS', 'false');
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'POST', url: '/api/auth/extension-token' });

      expect(response.statusCode).toBe(410);
      expect(response.json()).toMatchObject({
        code: 0,
        errorCode: 'legacy_extension_token_disabled',
      });
      expect(mocks.signToken).not.toHaveBeenCalled();
      expect(mocks.storeSession).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  it('keeps issuance available while the migration flag is explicitly true', async () => {
    vi.stubEnv('AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS', 'true');
    const app = await buildApp();
    try {
      const response = await app.inject({ method: 'POST', url: '/api/auth/extension-token' });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, data: { token: 'legacy-extension-token' } });
      expect(mocks.signToken).toHaveBeenCalledOnce();
      expect(mocks.storeSession).toHaveBeenCalledOnce();
    } finally {
      await app.close();
    }
  });
});

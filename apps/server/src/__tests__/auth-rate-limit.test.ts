import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { authRoutes } from '../routes/auth.js';

const mocks = vi.hoisted(() => ({
  systemConfigFindUnique: vi.fn(async (_input: { where: { key: string } }) => (
    null as { key: string; value: string } | null
  )),
  redisGet: vi.fn(async () => null),
  redisIncr: vi.fn(async () => 1),
  redisExpire: vi.fn(async () => 1),
  redisDel: vi.fn(async () => 1),
  redisSet: vi.fn(async () => 'OK'),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    systemConfig: {
      findUnique: mocks.systemConfigFindUnique,
    },
    user: {
      count: vi.fn(async () => 1),
      findUnique: vi.fn(async () => null),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    get: mocks.redisGet,
    incr: mocks.redisIncr,
    expire: mocks.redisExpire,
    del: mocks.redisDel,
    set: mocks.redisSet,
    exists: vi.fn(async () => 1),
    disconnect: vi.fn(),
  },
}));

async function buildApp() {
  const app = Fastify();
  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.ready();
  return app;
}

describe('authRoutes rate limiting', () => {
  it('reports the effective human challenge provider through legacy fields', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('HUMAN_CHALLENGE_PROVIDER', 'builtin-pow');
    mocks.systemConfigFindUnique.mockImplementation(async ({ where }) => (
      where.key === 'feature_turnstile_login'
        ? { key: where.key, value: 'true' }
        : null
    ));
    const app = await buildApp();

    try {
      const response = await app.inject({ method: 'GET', url: '/api/auth/challenge-config' });

      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({
        humanChallengeProvider: 'builtin-pow',
        turnstileEnabled: false,
        turnstileSiteKey: '',
      });
    } finally {
      await app.close();
      mocks.systemConfigFindUnique.mockResolvedValue(null);
      vi.unstubAllEnvs();
    }
  });

  it('does not let challenge-config requests consume the login rate limit', async () => {
    const app = await buildApp();

    try {
      for (let i = 0; i < 10; i += 1) {
        const response = await app.inject({ method: 'GET', url: '/api/auth/challenge-config' });
        expect(response.statusCode).toBe(200);
      }

      const login = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { phone: '19200000000', password: '' },
      });

      expect(login.statusCode).toBe(400);
    } finally {
      await app.close();
    }
  });

  it('still rate limits repeated login requests', async () => {
    const app = await buildApp();

    try {
      for (let i = 0; i < 10; i += 1) {
        const response = await app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { phone: '19200000000', password: '' },
        });
        expect(response.statusCode).toBe(400);
      }

      const response = await app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { phone: '19200000000', password: '' },
      });

      expect(response.statusCode).toBe(429);
      expect(response.json()).toMatchObject({ code: 0, msg: '请求过于频繁，请稍后再试' });
    } finally {
      await app.close();
    }
  });
});

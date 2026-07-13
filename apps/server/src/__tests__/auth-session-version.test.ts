import Fastify from 'fastify';
import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { authenticate, clearAuthContextCache, signToken, verifyToken } from '../lib/auth.js';

const testAuth = vi.hoisted(() => {
  const secret = 'auth-version-test-secret-0123456789';
  process.env.JWT_SECRET = secret;
  process.env.NODE_ENV = 'test';
  process.env.SS_ERP_DEPLOYMENT_ID = 'local-dev';
  process.env.AUTH_JWT_ISSUER = 'ss-erp-local';
  process.env.EXTENSION_AUTH_MODE = 'compat';
  process.env.AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS = 'true';
  return { secret };
});

const mocks = vi.hoisted(() => ({
  userFindUnique: vi.fn(),
  redisExists: vi.fn(async () => 1),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
  },
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    exists: mocks.redisExists,
    set: vi.fn(),
    del: vi.fn(),
    scan: vi.fn(),
  },
}));

async function buildApp() {
  const app = Fastify();
  app.get('/protected', { preHandler: authenticate }, async () => ({ code: 1 }));
  await app.ready();
  return app;
}

function rawAccountToken(authVersion?: unknown) {
  const payload: Record<string, unknown> = {
    userId: 'user-1',
    role: 'USER',
    typ: 'account',
    tokenUse: 'account_session',
    deploymentId: 'local-dev',
  };
  if (authVersion !== undefined) payload.authVersion = authVersion;
  return jwt.sign(payload, testAuth.secret, {
    algorithm: 'HS256',
    issuer: 'ss-erp-local',
    audience: 'ss-erp-account:local-dev',
    expiresIn: '5m',
  });
}

describe('account authentication version', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuthContextCache('user-1');
    mocks.redisExists.mockResolvedValue(1);
  });

  it.each([null, -1, 1.5])('rejects invalid auth version claim %s', (authVersion) => {
    expect(() => verifyToken(rawAccountToken(authVersion))).toThrow('Invalid account token');
  });

  it('accepts a typed pre-version token only while the live auth version remains zero', async () => {
    const token = rawAccountToken();
    mocks.userFindUnique.mockResolvedValue({
      id: 'user-1', parentId: null, accountCode: null, status: 'ACTIVE',
      isSuperAdmin: false, role: 'USER', authVersion: 0,
    });
    const app = await buildApp();
    try {
      const accepted = await app.inject({
        method: 'GET', url: '/protected', headers: { authorization: `Bearer ${token}` },
      });
      expect(accepted.statusCode).toBe(200);

      mocks.userFindUnique.mockResolvedValue({
        id: 'user-1', parentId: null, accountCode: null, status: 'ACTIVE',
        isSuperAdmin: false, role: 'USER', authVersion: 1,
      });
      const rejected = await app.inject({
        method: 'GET', url: '/protected', headers: { authorization: `Bearer ${token}` },
      });
      expect(rejected.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('rejects an otherwise valid account token after the user auth version advances', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'user-1',
      parentId: null,
      accountCode: null,
      status: 'ACTIVE',
      isSuperAdmin: false,
      role: 'USER',
      authVersion: 2,
    });
    const token = signToken({ userId: 'user-1', role: 'USER', authVersion: 1 });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });

  it('accepts a token whose auth version matches the live user', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'user-1',
      parentId: null,
      accountCode: null,
      status: 'ACTIVE',
      isSuperAdmin: false,
      role: 'USER',
      authVersion: 2,
    });
    const token = signToken({ userId: 'user-1', role: 'USER', authVersion: 2 });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('rejects a staff token immediately when its parent account is suspended', async () => {
    mocks.userFindUnique.mockResolvedValue({
      id: 'staff-1',
      parentId: 'parent-1',
      parent: { status: 'SUSPENDED' },
      accountCode: null,
      status: 'ACTIVE',
      isSuperAdmin: false,
      role: 'STAFF',
      authVersion: 0,
    });
    const token = signToken({ userId: 'staff-1', role: 'STAFF', authVersion: 0 });
    const app = await buildApp();
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/protected',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await app.close();
    }
  });
});

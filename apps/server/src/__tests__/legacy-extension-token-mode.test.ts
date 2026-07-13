import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/redis.js', () => ({
  redis: { exists: vi.fn(), set: vi.fn(), del: vi.fn(), scan: vi.fn() },
}));
vi.mock('../lib/prisma.js', () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

const ACCOUNT_SECRET = 'account-jwt-secret-for-legacy-cutoff-tests';
const DEVICE_SECRET = 'device-jwt-secret-for-legacy-cutoff-tests';
const DEPLOYMENT_ID = 'cutoff-test';
const ISSUER = 'ss-erp-cutoff-test';
const AUDIENCE = `ss-erp-account:${DEPLOYMENT_ID}`;

function stubEnvironment(overrides: Record<string, string | undefined> = {}) {
  const values = {
    NODE_ENV: 'test',
    JWT_SECRET: ACCOUNT_SECRET,
    SS_ERP_DEPLOYMENT_ID: DEPLOYMENT_ID,
    AUTH_JWT_ISSUER: ISSUER,
    EXTENSION_DEVICE_JWT_SECRET: DEVICE_SECRET,
    LOGISTICS_DISTRIBUTION_ENABLED: 'true',
    AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS: 'true',
    EXTENSION_AUTH_MODE: 'compat',
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
}

function accountToken(
  tokenUse: 'account_session' | 'legacy_extension',
  expiresIn: jwt.SignOptions['expiresIn'],
) {
  return jwt.sign({
    userId: 'user-1', role: 'USER', typ: 'account', tokenUse,
    deploymentId: DEPLOYMENT_ID,
  }, ACCOUNT_SECRET, {
    algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, expiresIn,
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('staged legacy extension token cutoff', () => {
  it('uses separate typed tokens for web sessions and legacy extensions', async () => {
    stubEnvironment();
    const auth = await import('../lib/auth.js');

    const web = jwt.decode(auth.signToken({ userId: 'user-1', role: 'USER' }, '7d')) as jwt.JwtPayload;
    const legacyToken = auth.signLegacyExtensionToken({ userId: 'user-1', role: 'USER' }, '30d');
    const legacy = jwt.decode(legacyToken) as jwt.JwtPayload;

    expect(web).toMatchObject({ typ: 'account', tokenUse: 'account_session' });
    expect(legacy).toMatchObject({ typ: 'account', tokenUse: 'legacy_extension' });
    expect(auth.verifyToken(legacyToken)).toMatchObject({ userId: 'user-1', role: 'USER' });
  });

  it('issues and verifies legacy-extension tokens only in compat mode with acceptance enabled', async () => {
    stubEnvironment({ AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS: 'false' });
    const cutoffAuth = await import('../lib/auth.js');
    expect(() => cutoffAuth.signLegacyExtensionToken({ userId: 'user-1', role: 'USER' }, '30d')).toThrow();
    expect(() => cutoffAuth.verifyToken(accountToken('legacy_extension', '30d'))).toThrow();

    vi.resetModules();
    stubEnvironment({ EXTENSION_AUTH_MODE: 'device-only', AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS: 'false' });
    const deviceOnlyAuth = await import('../lib/auth.js');
    expect(() => deviceOnlyAuth.signLegacyExtensionToken({ userId: 'user-1', role: 'USER' }, '30d')).toThrow();
    expect(() => deviceOnlyAuth.verifyToken(accountToken('legacy_extension', '30d'))).toThrow();
  });

  it('rejects untyped and outstanding thirty-day account-session tokens after cutoff', async () => {
    stubEnvironment({ AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS: 'false' });
    const { verifyToken } = await import('../lib/auth.js');
    const untyped = jwt.sign({ userId: 'user-1', role: 'USER' }, ACCOUNT_SECRET, {
      algorithm: 'HS256', expiresIn: '5m',
    });

    expect(() => verifyToken(untyped)).toThrow();
    expect(() => verifyToken(accountToken('account_session', '30d'))).toThrow();
  });

  it('keeps seven-day typed web sessions valid after cutoff', async () => {
    stubEnvironment({ AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS: 'false' });
    const { verifyToken } = await import('../lib/auth.js');

    expect(verifyToken(accountToken('account_session', '7d')))
      .toMatchObject({ userId: 'user-1', role: 'USER' });
  });

  it('requires issued-at and expiration claims on every typed account token', async () => {
    stubEnvironment({ AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS: 'false' });
    const { verifyToken } = await import('../lib/auth.js');
    const now = Math.floor(Date.now() / 1000);
    const withoutIssuedAt = jwt.sign({
      userId: 'user-1', role: 'USER', typ: 'account', tokenUse: 'account_session',
      deploymentId: DEPLOYMENT_ID, exp: now + 300,
    }, ACCOUNT_SECRET, {
      algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE, noTimestamp: true,
    });
    const withoutExpiration = jwt.sign({
      userId: 'user-1', role: 'USER', typ: 'account', tokenUse: 'account_session',
      deploymentId: DEPLOYMENT_ID,
    }, ACCOUNT_SECRET, {
      algorithm: 'HS256', issuer: ISSUER, audience: AUDIENCE,
    });

    expect(() => verifyToken(withoutIssuedAt)).toThrow();
    expect(() => verifyToken(withoutExpiration)).toThrow();
  });
});

describe('extension auth deployment mode', () => {
  it('defaults to compat and rejects unknown modes', async () => {
    const auth = await import('../lib/extension-device-auth.js');
    expect(auth.resolveExtensionAuthMode({})).toBe('compat');
    expect(auth.resolveExtensionAuthMode({ EXTENSION_AUTH_MODE: 'device-only' })).toBe('device-only');
    expect(() => auth.resolveExtensionAuthMode({ EXTENSION_AUTH_MODE: 'legacy' })).toThrow();
  });

  it('allows device-only startup only with cutoff and valid distribution device auth', async () => {
    const auth = await import('../lib/extension-device-auth.js');
    const valid = {
      NODE_ENV: 'test', JWT_SECRET: ACCOUNT_SECRET,
      SS_ERP_DEPLOYMENT_ID: DEPLOYMENT_ID, AUTH_JWT_ISSUER: ISSUER,
      EXTENSION_DEVICE_JWT_SECRET: DEVICE_SECRET,
      EXTENSION_AUTH_MODE: 'device-only',
      AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS: 'false',
      LOGISTICS_DISTRIBUTION_ENABLED: 'true',
    };

    expect(() => auth.validateExtensionDeviceAuthEnvironment(valid)).not.toThrow();
    expect(() => auth.validateExtensionDeviceAuthEnvironment({
      ...valid, AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS: 'true',
    })).toThrow();
    expect(() => auth.validateExtensionDeviceAuthEnvironment({
      ...valid, LOGISTICS_DISTRIBUTION_ENABLED: 'false',
    })).toThrow();
    expect(() => auth.validateExtensionDeviceAuthEnvironment({
      ...valid, EXTENSION_DEVICE_JWT_SECRET: undefined,
    })).toThrow();
  });

  it('maps and documents EXTENSION_AUTH_MODE at bootstrap', () => {
    const bootstrap = readFileSync(new URL('../bootstrap-config.ts', import.meta.url), 'utf8');
    const envExample = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8');

    expect(bootstrap).toMatch(/cfg\.extensionAuthMode[\s\S]*EXTENSION_AUTH_MODE/);
    expect(envExample).toMatch(/^EXTENSION_AUTH_MODE="compat"/m);
  });
});

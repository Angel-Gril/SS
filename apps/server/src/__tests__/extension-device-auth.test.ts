import { readFileSync } from 'node:fs';
import jwt from 'jsonwebtoken';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  redisExists: vi.fn(async () => 1),
  userFindUnique: vi.fn(async () => ({
    id: 'user-1',
    parentId: null,
    accountCode: 'ACCOUNT-1',
    status: 'ACTIVE',
    isSuperAdmin: false,
    role: 'USER',
  })),
}));

vi.mock('../lib/redis.js', () => ({
  redis: {
    exists: mocks.redisExists,
    set: vi.fn(),
    del: vi.fn(),
    scan: vi.fn(),
  },
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    user: { findUnique: mocks.userFindUnique },
  },
}));

const ACCOUNT_SECRET = 'account-jwt-secret-for-device-auth-tests';
const DEVICE_SECRET = 'device-jwt-secret-for-device-auth-tests';
const DEPLOYMENT_ID = 'test-deployment';
const ISSUER = 'ss-erp-test';

function stubAccountEnvironment(legacyEnabled: boolean) {
  vi.stubEnv('NODE_ENV', 'test');
  vi.stubEnv('JWT_SECRET', ACCOUNT_SECRET);
  vi.stubEnv('SS_ERP_DEPLOYMENT_ID', DEPLOYMENT_ID);
  vi.stubEnv('AUTH_JWT_ISSUER', ISSUER);
  vi.stubEnv('AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS', legacyEnabled ? 'true' : 'false');
}

function deviceEnvironment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: 'test',
    LOGISTICS_DISTRIBUTION_ENABLED: 'true',
    JWT_SECRET: ACCOUNT_SECRET,
    SS_ERP_DEPLOYMENT_ID: DEPLOYMENT_ID,
    AUTH_JWT_ISSUER: ISSUER,
    EXTENSION_DEVICE_JWT_SECRET: DEVICE_SECRET,
    ...overrides,
  };
}

function rawDeviceClaims(overrides: Record<string, unknown> = {}) {
  return {
    typ: 'extension_device',
    tokenUse: 'access',
    deploymentId: DEPLOYMENT_ID,
    sid: 'device-session-1',
    deviceId: 'device-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    scopes: ['logistics:discover', 'logistics:read', 'logistics:ack'],
    ...overrides,
  };
}

function signRawDeviceToken(
  claims: Record<string, unknown> = rawDeviceClaims(),
  options: jwt.SignOptions = {},
) {
  return jwt.sign(claims, DEVICE_SECRET, {
    algorithm: 'HS256',
    issuer: ISSUER,
    audience: `ss-erp-extension:${DEPLOYMENT_ID}`,
    subject: 'device-session-1',
    jwtid: 'access-token-1',
    expiresIn: '5m',
    ...options,
  });
}

function replyRecorder() {
  const reply = {
    statusCode: 200,
    payload: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
  return reply;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('account and extension-device token boundary', () => {
  it('signs new account sessions with an account-only type, issuer, and audience', async () => {
    stubAccountEnvironment(true);
    const { signToken } = await import('../lib/auth.js');

    const token = signToken({ userId: 'user-1', role: 'USER' }, '5m');
    const decoded = jwt.decode(token) as jwt.JwtPayload;

    expect(decoded.typ).toBe('account');
    expect(decoded.tokenUse).toBe('account_session');
    expect(decoded.deploymentId).toBe(DEPLOYMENT_ID);
    expect(decoded.iss).toBe(ISSUER);
    expect(decoded.aud).toBe(`ss-erp-account:${DEPLOYMENT_ID}`);
  });

  it('rejects a device-shaped JWT in ordinary account middleware even when signed by the account key', async () => {
    stubAccountEnvironment(true);
    const { authenticate } = await import('../lib/auth.js');
    const token = jwt.sign({
      userId: 'user-1',
      role: 'USER',
      ...rawDeviceClaims(),
    }, ACCOUNT_SECRET, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: `ss-erp-account:${DEPLOYMENT_ID}`,
      expiresIn: '5m',
    });
    const request = {
      cookies: {},
      headers: { authorization: `Bearer ${token}` },
    } as any;
    const reply = replyRecorder();

    await authenticate(request, reply as any);

    expect(reply.statusCode).toBe(401);
    expect((request as any).user).toBeUndefined();
    expect(mocks.redisExists).not.toHaveBeenCalled();
  });

  it('accepts an untyped legacy account JWT only while the migration flag is enabled', async () => {
    stubAccountEnvironment(true);
    const { verifyToken } = await import('../lib/auth.js');
    const legacy = jwt.sign({ userId: 'user-1', role: 'USER' }, ACCOUNT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '5m',
    });

    expect(verifyToken(legacy)).toMatchObject({ userId: 'user-1', role: 'USER' });
  });

  it('rejects an untyped legacy account JWT after the migration flag is disabled', async () => {
    stubAccountEnvironment(false);
    const { verifyToken } = await import('../lib/auth.js');
    const legacy = jwt.sign({ userId: 'user-1', role: 'USER' }, ACCOUNT_SECRET, {
      algorithm: 'HS256',
      expiresIn: '5m',
    });

    expect(() => verifyToken(legacy)).toThrow();
  });

  it('recognizes only explicit legacy issuance flag values', async () => {
    const auth = await import('../lib/extension-device-auth.js');

    expect(auth.isLegacyExtensionTokenIssuanceEnabled({ AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS: 'true' })).toBe(true);
    expect(auth.isLegacyExtensionTokenIssuanceEnabled({ AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS: 'false' })).toBe(false);
  });

  it('rejects a malformed legacy migration flag instead of silently enabling it', async () => {
    const auth = await import('../lib/extension-device-auth.js');

    expect(() => auth.isLegacyExtensionTokenIssuanceEnabled(deviceEnvironment({
      AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS: 'yes',
    }))).toThrow();
  });
});

describe('extension-device access JWT validation', () => {
  it('accepts a correctly scoped device token', async () => {
    const auth = await import('../lib/extension-device-auth.js');
    const config = auth.resolveExtensionDeviceAuthConfig(deviceEnvironment());
    const token = signRawDeviceToken();

    expect(auth.verifyExtensionDeviceAccessTokenCryptographically(token, config, ['logistics:read'])).toMatchObject({
      typ: 'extension_device',
      tokenUse: 'access',
      sid: 'device-session-1',
      jti: 'access-token-1',
      scopes: expect.arrayContaining(['logistics:read']),
    });
  });

  it('rejects a device access token without an expiration', async () => {
    const auth = await import('../lib/extension-device-auth.js');
    const config = auth.resolveExtensionDeviceAuthConfig(deviceEnvironment());
    const token = jwt.sign(rawDeviceClaims(), DEVICE_SECRET, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: `ss-erp-extension:${DEPLOYMENT_ID}`,
      subject: 'device-session-1',
      jwtid: 'access-token-1',
    });

    expect(() => auth.verifyExtensionDeviceAccessTokenCryptographically(token, config)).toThrow();
  });

  it('rejects a device access token without an issued-at time', async () => {
    const auth = await import('../lib/extension-device-auth.js');
    const config = auth.resolveExtensionDeviceAuthConfig(deviceEnvironment());
    const now = Math.floor(Date.now() / 1000);
    const token = jwt.sign({ ...rawDeviceClaims(), exp: now + 300 }, DEVICE_SECRET, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: `ss-erp-extension:${DEPLOYMENT_ID}`,
      subject: 'device-session-1',
      jwtid: 'access-token-1',
      noTimestamp: true,
    });

    expect(() => auth.verifyExtensionDeviceAccessTokenCryptographically(token, config)).toThrow();
  });

  it('rejects a device access token whose lifetime exceeds fifteen minutes', async () => {
    const auth = await import('../lib/extension-device-auth.js');
    const config = auth.resolveExtensionDeviceAuthConfig(deviceEnvironment());
    const token = signRawDeviceToken(rawDeviceClaims(), { expiresIn: '16m' });

    expect(() => auth.verifyExtensionDeviceAccessTokenCryptographically(token, config)).toThrow();
  });

  it('rejects a real account token at the device boundary', async () => {
    stubAccountEnvironment(true);
    const accountAuth = await import('../lib/auth.js');
    const deviceAuth = await import('../lib/extension-device-auth.js');
    const config = deviceAuth.resolveExtensionDeviceAuthConfig(deviceEnvironment());
    const token = accountAuth.signToken({ userId: 'user-1', role: 'USER' }, '5m');

    expect(() => deviceAuth.verifyExtensionDeviceAccessTokenCryptographically(token, config))
      .toThrow();
  });

  it.each([
    ['algorithm', () => signRawDeviceToken(rawDeviceClaims(), { algorithm: 'HS512' })],
    ['issuer', () => signRawDeviceToken(rawDeviceClaims(), { issuer: 'wrong-issuer' })],
    ['audience', () => signRawDeviceToken(rawDeviceClaims(), { audience: 'wrong-audience' })],
    ['deployment', () => signRawDeviceToken(rawDeviceClaims({ deploymentId: 'other-deployment' }))],
    ['type', () => signRawDeviceToken(rawDeviceClaims({ typ: 'account' }))],
    ['token use', () => signRawDeviceToken(rawDeviceClaims({ tokenUse: 'refresh' }))],
    ['session id', () => signRawDeviceToken(rawDeviceClaims({ sid: '' }))],
    ['token id', () => jwt.sign(rawDeviceClaims(), DEVICE_SECRET, {
      algorithm: 'HS256',
      issuer: ISSUER,
      audience: `ss-erp-extension:${DEPLOYMENT_ID}`,
      subject: 'device-session-1',
      expiresIn: '5m',
    })],
  ])('rejects a token with the wrong %s', async (_label, buildToken) => {
    const auth = await import('../lib/extension-device-auth.js');
    const config = auth.resolveExtensionDeviceAuthConfig(deviceEnvironment());

    expect(() => auth.verifyExtensionDeviceAccessTokenCryptographically(buildToken(), config)).toThrow();
  });

  it('rejects a token that lacks a required scope', async () => {
    const auth = await import('../lib/extension-device-auth.js');
    const config = auth.resolveExtensionDeviceAuthConfig(deviceEnvironment());
    const token = signRawDeviceToken(rawDeviceClaims({ scopes: ['logistics:read'] }));

    expect(() => auth.verifyExtensionDeviceAccessTokenCryptographically(token, config, ['logistics:ack']))
      .toThrowError(expect.objectContaining({ statusCode: 403, code: 'insufficient_scope' }));
  });

  it('reads device credentials only from Bearer and ignores a device token in the account cookie', async () => {
    const auth = await import('../lib/extension-device-auth.js');
    const config = auth.resolveExtensionDeviceAuthConfig(deviceEnvironment());
    const middleware = auth.authenticateExtensionDeviceTokenCryptographically({ config, requiredScopes: ['logistics:read'] });
    const cookieOnlyRequest = {
      cookies: { sserp_token: signRawDeviceToken() },
      headers: {},
    } as any;
    const cookieReply = replyRecorder();

    await middleware(cookieOnlyRequest, cookieReply as any);

    expect(cookieReply.statusCode).toBe(401);
    expect(cookieOnlyRequest.device).toBeUndefined();

    const bearerRequest = {
      cookies: { sserp_token: 'account-cookie-must-be-ignored' },
      headers: { authorization: `Bearer ${signRawDeviceToken()}` },
    } as any;
    const bearerReply = replyRecorder();

    await middleware(bearerRequest, bearerReply as any);

    expect(bearerReply.statusCode).toBe(200);
    expect(bearerRequest.device).toMatchObject({
      sessionId: 'device-session-1',
      tokenId: 'access-token-1',
      deviceId: 'device-1',
    });
  });
});

describe('extension-device production startup configuration', () => {
  it.each([
    ['SS_ERP_DEPLOYMENT_ID', { SS_ERP_DEPLOYMENT_ID: undefined }],
    ['AUTH_JWT_ISSUER', { AUTH_JWT_ISSUER: undefined }],
    ['EXTENSION_DEVICE_JWT_SECRET', { EXTENSION_DEVICE_JWT_SECRET: undefined }],
  ])('rejects production startup when %s is missing', async (_name, missing) => {
    const auth = await import('../lib/extension-device-auth.js');

    expect(() => auth.validateExtensionDeviceAuthEnvironment(deviceEnvironment({
      NODE_ENV: 'production',
      ...missing,
    }))).toThrow();
  });

  it('does not require device credentials in production while logistics distribution is disabled', async () => {
    const auth = await import('../lib/extension-device-auth.js');

    expect(() => auth.validateExtensionDeviceAuthEnvironment(deviceEnvironment({
      NODE_ENV: 'production',
      LOGISTICS_DISTRIBUTION_ENABLED: 'false',
      SS_ERP_DEPLOYMENT_ID: undefined,
      AUTH_JWT_ISSUER: undefined,
      EXTENSION_DEVICE_JWT_SECRET: undefined,
    }))).not.toThrow();
  });

  it('fails closed when the logistics distribution flag is malformed', async () => {
    const auth = await import('../lib/extension-device-auth.js');

    expect(() => auth.validateExtensionDeviceAuthEnvironment(deviceEnvironment({
      LOGISTICS_DISTRIBUTION_ENABLED: 'yes',
    }))).toThrow();
  });

  it.each([
    ['development deployment id', { SS_ERP_DEPLOYMENT_ID: 'local-dev' }],
    ['development issuer', { AUTH_JWT_ISSUER: 'ss-erp-local' }],
    ['malformed deployment id', { SS_ERP_DEPLOYMENT_ID: 'bad deployment/id' }],
    ['malformed issuer', { AUTH_JWT_ISSUER: 'bad issuer value' }],
    ['reused account secret', { EXTENSION_DEVICE_JWT_SECRET: ACCOUNT_SECRET }],
    ['short device secret', { EXTENSION_DEVICE_JWT_SECRET: 'too-short' }],
  ])('rejects production startup with %s', async (_label, invalid) => {
    const auth = await import('../lib/extension-device-auth.js');

    expect(() => auth.validateExtensionDeviceAuthEnvironment(deviceEnvironment({
      NODE_ENV: 'production',
      ...invalid,
    }))).toThrow();
  });

  it('is invoked by the server bootstrap before production startup completes', () => {
    const bootstrap = readFileSync(new URL('../bootstrap-config.ts', import.meta.url), 'utf8');

    expect(bootstrap).toContain('validateExtensionDeviceAuthEnvironment');
    expect(bootstrap).toMatch(/cfg\.deploymentId[\s\S]*SS_ERP_DEPLOYMENT_ID/);
    expect(bootstrap).toMatch(/cfg\.authJwtIssuer[\s\S]*AUTH_JWT_ISSUER/);
    expect(bootstrap).toMatch(/cfg\.extensionDeviceJwtSecret[\s\S]*EXTENSION_DEVICE_JWT_SECRET/);
    expect(bootstrap).toMatch(/cfg\.logisticsDistributionEnabled[\s\S]*LOGISTICS_DISTRIBUTION_ENABLED/);
  });
});

  it('documents the device auth boundary and legacy cutoff flag in the environment example', () => {
    const envExample = readFileSync(new URL('../../../../.env.example', import.meta.url), 'utf8');

    expect(envExample).toMatch(/^SS_ERP_DEPLOYMENT_ID=/m);
    expect(envExample).toMatch(/^AUTH_JWT_ISSUER=/m);
    expect(envExample).toMatch(/^EXTENSION_DEVICE_JWT_SECRET=/m);
    expect(envExample).toMatch(/^AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS=/m);
    expect(envExample).toMatch(/^LOGISTICS_DISTRIBUTION_ENABLED=/m);
  });

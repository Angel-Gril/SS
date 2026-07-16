import jwt from 'jsonwebtoken';
import { describe, expect, it, vi } from 'vitest';
import {
  authenticateExtensionDevice,
  issueExtensionDeviceAccessToken,
  resolveExtensionDeviceAuthConfig,
} from '../lib/extension-device-auth.js';

const NOW = new Date('2026-07-12T08:00:00.000Z');
const config = resolveExtensionDeviceAuthConfig({
  NODE_ENV: 'test',
  SS_ERP_DEPLOYMENT_ID: 'test-deployment',
  AUTH_JWT_ISSUER: 'ss-erp-test',
  EXTENSION_DEVICE_JWT_SECRET: 'device-live-auth-secret-0123456789',
});

function accessToken(overrides: Record<string, unknown> = {}) {
  if (!Object.keys(overrides).length) {
    return issueExtensionDeviceAccessToken({
      sessionId: 'session-1',
      tokenId: 'jti-1',
      deviceId: 'device-1',
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      scopes: ['logistics:discover', 'logistics:read'],
    }, config);
  }
  return jwt.sign({
    typ: 'extension_device',
    tokenUse: 'access',
    deploymentId: 'test-deployment',
    sid: 'session-1',
    deviceId: 'device-1',
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    scopes: ['logistics:discover', 'logistics:read'],
    ...overrides,
  }, config.secret, {
    algorithm: 'HS256',
    issuer: config.issuer,
    audience: config.audience,
    subject: 'session-1',
    jwtid: 'jti-1',
    expiresIn: '5m',
  });
}

function authorization(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'session-1',
    status: 'ACTIVE',
    expiresAt: new Date(NOW.getTime() + 3600_000),
    currentJti: 'jti-1',
    deploymentId: 'test-deployment',
    deviceId: 'device-1',
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    scopes: ['logistics:discover', 'logistics:read'],
    ownerStatus: 'ACTIVE',
    actorStatus: 'ACTIVE',
    ownerRole: 'USER',
    actorRole: 'USER',
    actorParentId: null,
    shopGrants: [{ shopId: 'shop-1', status: 'ACTIVE' }],
    ...overrides,
  };
}

function request(token = accessToken(), shopId = 'shop-1') {
  return {
    headers: { authorization: `Bearer ${token}` },
    cookies: {},
    params: { shopId },
  } as any;
}

function replyRecorder() {
  return {
    statusCode: 200,
    payload: undefined as any,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.payload = payload;
      return this;
    },
  };
}

describe('live extension-device authorization', () => {
  it('accepts a token only after matching the live session and active shop grant', async () => {
    const loadAuthorization = vi.fn(async () => authorization());
    const middleware = authenticateExtensionDevice({
      config,
      requiredScopes: ['logistics:read'],
      loadAuthorization,
      shopIdFromRequest: (req: any) => req.params.shopId,
      now: () => NOW,
    });
    const req = request();
    const reply = replyRecorder();

    await middleware(req, reply as any);

    expect(reply.statusCode).toBe(200);
    expect(loadAuthorization).toHaveBeenCalledWith('session-1');
    expect(req.device).toMatchObject({
      sessionId: 'session-1',
      tokenId: 'jti-1',
      ownerUserId: 'owner-1',
      allowedShopIds: ['shop-1'],
    });
  });

  it.each([
    ['current token id', { currentJti: 'newer-jti' }],
    ['session status', { status: 'REVOKED' }],
    ['session expiry', { expiresAt: new Date(NOW.getTime() - 1) }],
    ['owner status', { ownerStatus: 'SUSPENDED' }],
    ['actor status', { actorStatus: 'SUSPENDED' }],
    ['owner role', { ownerRole: 'STAFF' }],
    ['actor role', { actorRole: 'STAFF' }],
    ['actor parent', { actorParentId: 'another-owner' }],
  ])('rejects a stale device when live %s no longer matches', async (_label, changed) => {
    const middleware = authenticateExtensionDevice({
      config,
      requiredScopes: ['logistics:read'],
      loadAuthorization: async () => authorization(changed),
      now: () => NOW,
    });
    const req = request();
    const reply = replyRecorder();

    await middleware(req, reply as any);

    expect(reply.statusCode).toBe(401);
    expect(req.device).toBeUndefined();
  });

  it('rejects claim and database identity mismatches', async () => {
    const middleware = authenticateExtensionDevice({
      config,
      loadAuthorization: async () => authorization({ deviceId: 'other-device' }),
      now: () => NOW,
    });
    const req = request();
    const reply = replyRecorder();

    await middleware(req, reply as any);

    expect(reply.statusCode).toBe(401);
  });

  it('returns 404 for a never-granted shop and 410 for a revoked known grant', async () => {
    const unknownMiddleware = authenticateExtensionDevice({
      config,
      loadAuthorization: async () => authorization({ shopGrants: [] }),
      shopIdFromRequest: (req: any) => req.params.shopId,
      now: () => NOW,
    });
    const unknownReply = replyRecorder();
    await unknownMiddleware(request(), unknownReply as any);
    expect(unknownReply.statusCode).toBe(404);
    expect(unknownReply.payload).toMatchObject({ errorCode: 'device_shop_not_found' });

    const revokedMiddleware = authenticateExtensionDevice({
      config,
      loadAuthorization: async () => authorization({
        shopGrants: [{ shopId: 'shop-1', status: 'REVOKED' }],
      }),
      shopIdFromRequest: (req: any) => req.params.shopId,
      now: () => NOW,
    });
    const revokedReply = replyRecorder();
    await revokedMiddleware(request(), revokedReply as any);
    expect(revokedReply.statusCode).toBe(410);
    expect(revokedReply.payload).toMatchObject({ errorCode: 'device_shop_revoked' });
  });

  it('requires every scope in both the token and current server session', async () => {
    const middleware = authenticateExtensionDevice({
      config,
      requiredScopes: ['logistics:receipt'],
      loadAuthorization: async () => authorization({ scopes: ['logistics:receipt'] }),
      now: () => NOW,
    });
    const req = request();
    const reply = replyRecorder();

    await middleware(req, reply as any);

    expect(reply.statusCode).toBe(403);
    expect(reply.payload).toMatchObject({ errorCode: 'insufficient_scope' });
  });
});

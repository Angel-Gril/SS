import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { extensionDeviceClaimRateLimitKey, extensionDeviceRoutes } from '../routes/extension-device.js';
import { ExtensionDeviceSessionError } from '../services/extension-device-session.js';

const NOW = new Date('2026-07-12T08:00:00.000Z');

function dependencies(options: { staff?: boolean; rootStaff?: boolean } = {}) {
  const session = {
    id: 'session-1',
    deploymentId: 'test-deployment',
    deviceId: 'device-1',
    actorUserId: 'owner-1',
    ownerUserId: 'owner-1',
    scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt'],
    currentJti: 'jti-1',
    expiresAt: new Date(NOW.getTime() + 86_400_000),
  };
  const sessionService = {
    createPairingCode: vi.fn(async () => ({
      id: 'pairing-1',
      code: 'p'.repeat(22),
      expiresAt: new Date(NOW.getTime() + 600_000),
      deploymentId: 'test-deployment',
      shopIds: ['shop-1'],
    })),
    claimPairingCode: vi.fn(async () => ({
      session,
      accessToken: 'device-access-token',
      refreshToken: 'device-refresh-token',
    })),
    refresh: vi.fn(async () => ({
      session,
      accessToken: 'next-device-access-token',
      refreshToken: 'next-device-refresh-token',
    })),
  };
  const managementRepository = {
    cancelPairingCode: vi.fn(async () => true),
    listSessions: vi.fn(async () => [{
      id: 'session-1',
      deviceId: 'device-1',
      deviceLabel: 'Chrome Xiamen',
      status: 'ACTIVE',
      shopIds: ['shop-1'],
      scopes: ['logistics:read'],
      expiresAt: new Date(NOW.getTime() + 86_400_000),
      lastSeenAt: NOW,
      createdAt: NOW,
    }]),
    revokeSession: vi.fn(async () => true),
  };
  const authenticateAccount = vi.fn(async (request: FastifyRequest) => {
    (request as any).user = {
      userId: 'owner-1',
      actorUserId: options.staff ? 'staff-1' : 'owner-1',
      parentId: options.staff ? 'owner-1' : null,
      role: options.staff || options.rootStaff ? 'STAFF' : 'USER',
    };
  });
  return { sessionService, managementRepository, authenticateAccount };
}

async function buildApp(options: { staff?: boolean; rootStaff?: boolean } = {}) {
  const deps = dependencies(options);
  const app = Fastify();
  await app.register(extensionDeviceRoutes, deps as any);
  return { app, ...deps };
}

describe('extension device routes', () => {
  it('keeps the Fastify claim bucket keyed only by IP when device IDs change', () => {
    const first = extensionDeviceClaimRateLimitKey({ ip: '127.0.0.1', body: { deviceId: 'device-a' } } as any);
    const second = extensionDeviceClaimRateLimitKey({ ip: '127.0.0.1', body: { deviceId: 'device-b' } } as any);
    expect(first).toBe('127.0.0.1');
    expect(second).toBe(first);
  });

  it('lets a tenant owner create a shop-scoped pairing code', async () => {
    const { app, sessionService } = await buildApp();
    const response = await app.inject({
      method: 'POST',
      url: '/pairing-codes',
      payload: {
        shopIds: ['shop-1', 'shop-1'],
        scopes: ['listing:review', 'listing:publish'],
        deviceLabel: 'Chrome Xiamen',
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json().data).toMatchObject({
      code: 'p'.repeat(22),
      deploymentId: 'test-deployment',
      shopIds: ['shop-1'],
    });
    expect(sessionService.createPairingCode).toHaveBeenCalledWith({
      actorUserId: 'owner-1',
      ownerUserId: 'owner-1',
      actorParentId: null,
      actorRole: 'USER',
      shopIds: ['shop-1', 'shop-1'],
      scopes: ['listing:review', 'listing:publish'],
      deviceLabel: 'Chrome Xiamen',
    });
  });

  it('requires the owner to select at least one allowlisted device scope', async () => {
    const { app, sessionService } = await buildApp();

    const missing = await app.inject({
      method: 'POST',
      url: '/pairing-codes',
      payload: { shopIds: ['shop-1'] },
    });
    const unknown = await app.inject({
      method: 'POST',
      url: '/pairing-codes',
      payload: { shopIds: ['shop-1'], scopes: ['root:shell'] },
    });

    expect(missing.statusCode).toBe(400);
    expect(unknown.statusCode).toBe(400);
    expect(sessionService.createPairingCode).not.toHaveBeenCalled();
  });

  it('fails closed when staff attempt to create their own pairing authority', async () => {
    const { app, sessionService } = await buildApp({ staff: true });
    sessionService.createPairingCode.mockRejectedValueOnce(
      new ExtensionDeviceSessionError('pairing_owner_required', 403, 'owner required'),
    );

    const response = await app.inject({
      method: 'POST',
      url: '/pairing-codes',
      payload: { shopIds: ['shop-1'], scopes: ['listing:review'] },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ errorCode: 'pairing_owner_required' });
  });

  it('rejects a root STAFF account even when actor and owner ids match', async () => {
    const { app, sessionService } = await buildApp({ rootStaff: true });

    const response = await app.inject({
      method: 'POST',
      url: '/pairing-codes',
      payload: { shopIds: ['shop-1'], scopes: ['listing:review'] },
    });

    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ errorCode: 'pairing_owner_required' });
    expect(sessionService.createPairingCode).not.toHaveBeenCalled();
  });

  it('claims once and rotates refresh credentials without account middleware', async () => {
    const { app, sessionService, authenticateAccount } = await buildApp();
    const claim = await app.inject({
      method: 'POST',
      url: '/pairing-claims',
      payload: {
        code: 'p'.repeat(22),
        deviceId: 'device-1',
        deviceLabel: 'Chrome Xiamen',
        deploymentId: 'test-deployment',
      },
    });
    const refresh = await app.inject({
      method: 'POST',
      url: '/refresh',
      payload: { refreshToken: 'r'.repeat(43) },
    });

    expect(claim.statusCode).toBe(201);
    expect(claim.json().data).toMatchObject({
      accessToken: 'device-access-token',
      refreshToken: 'device-refresh-token',
    });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().data).toMatchObject({
      accessToken: 'next-device-access-token',
      refreshToken: 'next-device-refresh-token',
    });
    expect(sessionService.claimPairingCode).toHaveBeenCalledTimes(1);
    expect(sessionService.refresh).toHaveBeenCalledTimes(1);
    expect(authenticateAccount).not.toHaveBeenCalled();
  });

  it('lists, cancels, and revokes only through owner-scoped repository operations', async () => {
    const { app, managementRepository, authenticateAccount } = await buildApp();
    const listed = await app.inject({ method: 'GET', url: '/sessions' });
    const canceled = await app.inject({ method: 'DELETE', url: '/pairing-codes/pairing-1' });
    const revoked = await app.inject({ method: 'DELETE', url: '/sessions/session-1' });

    expect(listed.statusCode).toBe(200);
    expect(listed.json().data).toHaveLength(1);
    expect(canceled.statusCode).toBe(200);
    expect(revoked.statusCode).toBe(200);
    expect(managementRepository.listSessions).toHaveBeenCalledWith('owner-1');
    expect(managementRepository.cancelPairingCode).toHaveBeenCalledWith({
      pairingCodeId: 'pairing-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
    });
    expect(managementRepository.revokeSession).toHaveBeenCalledWith({
      sessionId: 'session-1', ownerUserId: 'owner-1', actorUserId: 'owner-1', reason: 'OWNER_REVOKED',
    });
    expect(authenticateAccount).toHaveBeenCalledTimes(3);
  });

  it('returns 404 for hidden owner-scoped resources and 400 for malformed credentials', async () => {
    const { app, managementRepository } = await buildApp();
    managementRepository.revokeSession.mockResolvedValueOnce(false);

    const hidden = await app.inject({ method: 'DELETE', url: '/sessions/other-session' });
    const malformedClaim = await app.inject({
      method: 'POST',
      url: '/pairing-claims',
      payload: { code: 'short', deviceId: '', deploymentId: '' },
    });
    const malformedRefresh = await app.inject({
      method: 'POST',
      url: '/refresh',
      payload: { refreshToken: 'short' },
    });

    expect(hidden.statusCode).toBe(404);
    expect(malformedClaim.statusCode).toBe(400);
    expect(malformedRefresh.statusCode).toBe(400);
  });

  it('denies staff listing, canceling, or revoking owner device records', async () => {
    const { app, managementRepository } = await buildApp({ staff: true });
    const listed = await app.inject({ method: 'GET', url: '/sessions' });
    const canceled = await app.inject({ method: 'DELETE', url: '/pairing-codes/pairing-1' });
    const revoked = await app.inject({ method: 'DELETE', url: '/sessions/session-1' });

    expect([listed.statusCode, canceled.statusCode, revoked.statusCode]).toEqual([403, 403, 403]);
    expect(managementRepository.listSessions).not.toHaveBeenCalled();
    expect(managementRepository.cancelPairingCode).not.toHaveBeenCalled();
    expect(managementRepository.revokeSession).not.toHaveBeenCalled();
  });

  it('lists only shops granted to the authenticated device', async () => {
    const deps = dependencies();
    const authenticateDevice = vi.fn(async (request: FastifyRequest) => {
      (request as any).device = {
        ownerUserId: 'owner-1',
        actorUserId: 'owner-1',
        allowedShopIds: ['shop-1', 'shop-2'],
      };
    });
    const listAuthorizedShops = vi.fn(async (input: { ownerUserId: string; shopIds: string[] }) => [{
      id: input.shopIds[0]!,
      platform: 'OZON',
      name: 'BINI',
      status: 'ACTIVE',
    }]);
    const app = Fastify();
    await app.register(extensionDeviceRoutes, {
      ...deps,
      authenticateDevice,
      shopRepository: { listAuthorizedShops },
    } as any);

    const response = await app.inject({ method: 'GET', url: '/shops' });

    expect(response.statusCode).toBe(200);
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.json()).toMatchObject({
      code: 1,
      data: [{ id: 'shop-1', platform: 'OZON', name: 'BINI' }],
    });
    expect(response.json().data[0]).not.toHaveProperty('balance');
    expect(response.json().data[0]).not.toHaveProperty('productCount');
    expect(listAuthorizedShops).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      shopIds: ['shop-1', 'shop-2'],
    });
  });

  it('rejects a malformed device context on the shop read surface', async () => {
    const deps = dependencies();
    const authenticateDevice = vi.fn(async (request: FastifyRequest) => {
      (request as any).device = { ownerUserId: 'owner-1', actorUserId: 'staff-1', allowedShopIds: ['shop-1'] };
    });
    const listAuthorizedShops = vi.fn(async () => []);
    const app = Fastify();
    await app.register(extensionDeviceRoutes, {
      ...deps,
      authenticateDevice,
      shopRepository: { listAuthorizedShops },
    } as any);

    const response = await app.inject({ method: 'GET', url: '/shops' });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({ errorCode: 'invalid_device_context' });
    expect(listAuthorizedShops).not.toHaveBeenCalled();
  });
});

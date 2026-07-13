import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExtensionDeviceSessionRepository } from '../services/extension-device-session.js';

const ACCOUNT_SECRET = 'account-jwt-secret-for-device-session-tests';
const DEVICE_SECRET = 'device-jwt-secret-for-device-session-tests';
const NOW = new Date('2026-07-12T08:00:00.000Z');

function authEnvironment() {
  return {
    NODE_ENV: 'test',
    LOGISTICS_DISTRIBUTION_ENABLED: 'true',
    JWT_SECRET: ACCOUNT_SECRET,
    SS_ERP_DEPLOYMENT_ID: 'test-deployment',
    AUTH_JWT_ISSUER: 'ss-erp-test',
    EXTENSION_DEVICE_JWT_SECRET: DEVICE_SECRET,
  };
}

function repository(overrides: Record<string, unknown> = {}) {
  return {
    countOutstandingPairingCodes: vi.fn(async () => 0),
    shopsBelongToOwner: vi.fn(async () => true),
    createPairingCode: vi.fn(async (input: any) => ({ kind: 'created' as const, id: 'pairing-1', ...input })),
    consumePairingClaimAttemptBudget: vi.fn(async () => true),
    claimPairingCodeAtomically: vi.fn(async (input: any) => ({
      kind: 'claimed' as const,
      session: {
        id: input.sessionId,
        deploymentId: 'test-deployment',
        deviceId: input.deviceId,
        actorUserId: 'owner-1',
        ownerUserId: 'owner-1',
        scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt', 'logistics:capture'],
        currentJti: input.currentJti,
        expiresAt: input.sessionExpiresAt,
      },
    })),
    rotateRefreshCredentialOrRevokeReuse: vi.fn(async (input: any): ReturnType<ExtensionDeviceSessionRepository['rotateRefreshCredentialOrRevokeReuse']> => ({
      kind: 'rotated' as const,
      session: {
        id: 'session-1',
        deploymentId: 'test-deployment',
        deviceId: 'device-1',
        actorUserId: 'owner-1',
        ownerUserId: 'owner-1',
        scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt', 'logistics:capture'],
        currentJti: input.nextJti,
        expiresAt: new Date(NOW.getTime() + 30 * 24 * 3600 * 1000),
      },
    })),
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe('extension device session service', () => {
  it('creates a short-lived 128-bit pairing code while persisting only its digest', async () => {
    const module = await import('../services/extension-device-session.js');
    const auth = await import('../lib/extension-device-auth.js');
    const repo = repository();
    const service = module.createExtensionDeviceSessionService({
      repository: repo,
      authConfig: auth.resolveExtensionDeviceAuthConfig(authEnvironment()),
      now: () => NOW,
    });

    const result = await service.createPairingCode({
      actorUserId: 'owner-1',
      ownerUserId: 'owner-1',
      actorParentId: null,
      shopIds: ['shop-1'],
      deviceLabel: 'Chrome Xiamen',
    });

    expect(result.code).toMatch(/^[A-Za-z0-9_-]{22,}$/);
    expect(result.expiresAt.getTime() - NOW.getTime()).toBeLessThanOrEqual(10 * 60 * 1000);
    expect(repo.createPairingCode).toHaveBeenCalledWith(expect.objectContaining({
      codeDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      deploymentId: 'test-deployment',
      actorUserId: 'owner-1',
      ownerUserId: 'owner-1',
      shopIds: ['shop-1'],
      scopes: ['logistics:discover', 'logistics:read', 'logistics:receipt', 'logistics:capture'],
    }));
    expect(JSON.stringify(repo.createPairingCode.mock.calls[0]?.[0])).not.toContain(result.code);
  });

  it('denies staff self-grants and enforces the outstanding pairing cap', async () => {
    const module = await import('../services/extension-device-session.js');
    const auth = await import('../lib/extension-device-auth.js');
    const cappedRepo = repository({ countOutstandingPairingCodes: vi.fn(async () => 5) });
    const service = module.createExtensionDeviceSessionService({
      repository: cappedRepo,
      authConfig: auth.resolveExtensionDeviceAuthConfig(authEnvironment()),
      now: () => NOW,
    });

    await expect(service.createPairingCode({
      actorUserId: 'staff-1',
      ownerUserId: 'owner-1',
      actorParentId: 'owner-1',
      shopIds: ['shop-1'],
    })).rejects.toMatchObject({ code: 'pairing_owner_required', statusCode: 403 });

    await expect(service.createPairingCode({
      actorUserId: 'owner-1',
      ownerUserId: 'owner-1',
      actorParentId: null,
      shopIds: ['shop-1'],
    })).rejects.toMatchObject({ code: 'pairing_limit_reached', statusCode: 429 });
  });


  it('enforces the pairing cap again inside the atomic create operation', async () => {
    const module = await import('../services/extension-device-session.js');
    const auth = await import('../lib/extension-device-auth.js');
    const repo = repository({
      createPairingCode: vi.fn(async () => ({ kind: 'limit' as const })),
    });
    const service = module.createExtensionDeviceSessionService({
      repository: repo,
      authConfig: auth.resolveExtensionDeviceAuthConfig(authEnvironment()),
      now: () => NOW,
    });

    await expect(service.createPairingCode({
      actorUserId: 'owner-1',
      ownerUserId: 'owner-1',
      actorParentId: null,
      shopIds: ['shop-1'],
    })).rejects.toMatchObject({ code: 'pairing_limit_reached', statusCode: 429 });
  });
  it('claims a pairing once and returns a 256-bit refresh credential without persisting plaintext', async () => {
    const module = await import('../services/extension-device-session.js');
    const auth = await import('../lib/extension-device-auth.js');
    const repo = repository();
    const authConfig = auth.resolveExtensionDeviceAuthConfig(authEnvironment());
    const service = module.createExtensionDeviceSessionService({ repository: repo, authConfig, now: () => NOW });
    const pairing = await service.createPairingCode({
      actorUserId: 'owner-1',
      ownerUserId: 'owner-1',
      actorParentId: null,
      shopIds: ['shop-1'],
    });

    const result = await service.claimPairingCode({
      code: pairing.code,
      deviceId: 'device-1',
      deviceLabel: 'Chrome Xiamen',
      deploymentId: 'test-deployment',
    });

    expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{43,}$/);
    const claimInput = repo.claimPairingCodeAtomically.mock.calls[0]?.[0];
    expect(claimInput).toMatchObject({
      codeDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      refreshDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      deviceId: 'device-1',
      deploymentId: 'test-deployment',
    });
    expect(JSON.stringify(claimInput)).not.toContain(pairing.code);
    expect(JSON.stringify(claimInput)).not.toContain(result.refreshToken);
    expect(auth.verifyExtensionDeviceAccessTokenCryptographically(
      result.accessToken,
      authConfig,
      ['logistics:read'],
    )).toMatchObject({ sid: result.session.id, deviceId: 'device-1' });
  });

  it('rotates refresh credentials and reports old-token reuse as a revoked family', async () => {
    const module = await import('../services/extension-device-session.js');
    const auth = await import('../lib/extension-device-auth.js');
    const repo = repository();
    const service = module.createExtensionDeviceSessionService({
      repository: repo,
      authConfig: auth.resolveExtensionDeviceAuthConfig(authEnvironment()),
      now: () => NOW,
    });

    const rotated = await service.refresh({ refreshToken: 'r'.repeat(43) });
    expect(rotated.refreshToken).not.toBe('r'.repeat(43));
    expect(repo.rotateRefreshCredentialOrRevokeReuse).toHaveBeenCalledWith(expect.objectContaining({
      refreshDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      nextRefreshDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      nextJti: expect.any(String),
    }));

    repo.rotateRefreshCredentialOrRevokeReuse.mockResolvedValueOnce({ kind: 'reuse_revoked' as const });
    await expect(service.refresh({ refreshToken: 'r'.repeat(43) }))
      .rejects.toMatchObject({ code: 'refresh_reuse_detected', statusCode: 401 });
  });


  it('checks a device and code-digest attempt budget without exposing the pairing code', async () => {
    const module = await import('../services/extension-device-session.js');
    const auth = await import('../lib/extension-device-auth.js');
    const repo = repository({
      consumePairingClaimAttemptBudget: vi.fn(async () => false),
    });
    const service = module.createExtensionDeviceSessionService({
      repository: repo,
      authConfig: auth.resolveExtensionDeviceAuthConfig(authEnvironment()),
      now: () => NOW,
    });
    const code = 'a'.repeat(22);

    await expect(service.claimPairingCode({
      code,
      deviceId: 'device-1',
      deploymentId: 'test-deployment',
    })).rejects.toMatchObject({ code: 'pairing_claim_rate_limited', statusCode: 429 });

    expect(repo.consumePairingClaimAttemptBudget).toHaveBeenCalledWith({
      codeDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      deviceId: 'device-1',
      now: NOW,
    });
    expect(JSON.stringify(repo.consumePairingClaimAttemptBudget.mock.calls)).not.toContain(code);
    expect(repo.claimPairingCodeAtomically).not.toHaveBeenCalled();
  });
  it('fails closed for a wrong deployment and an invalid one-time code', async () => {
    const module = await import('../services/extension-device-session.js');
    const auth = await import('../lib/extension-device-auth.js');
    const repo = repository({
      claimPairingCodeAtomically: vi.fn(async () => ({ kind: 'invalid' as const })),
    });
    const service = module.createExtensionDeviceSessionService({
      repository: repo,
      authConfig: auth.resolveExtensionDeviceAuthConfig(authEnvironment()),
      now: () => NOW,
    });

    await expect(service.claimPairingCode({
      code: 'a'.repeat(22),
      deviceId: 'device-1',
      deploymentId: 'other-deployment',
    })).rejects.toMatchObject({ code: 'wrong_deployment', statusCode: 400 });

    await expect(service.claimPairingCode({
      code: 'a'.repeat(22),
      deviceId: 'device-1',
      deploymentId: 'test-deployment',
    })).rejects.toMatchObject({ code: 'invalid_pairing_code', statusCode: 400 });
  });

  it('exports only the fixed public device revocation reason codes', async () => {
    const module = await import('../services/extension-device-session.js');
    expect(module.EXTENSION_DEVICE_REVOCATION_REASONS).toEqual([
      'PAIRING_APPROVED',
      'OWNER_REVOKED',
      'PASSWORD_RESET',
      'ACCOUNT_SUSPENDED',
      'ACTOR_UNLINKED',
      'SHOP_TRANSFERRED',
      'AUTHORIZATION_INVALID',
      'SESSION_EXPIRED',
      'REFRESH_REUSE_DETECTED',
      'ASSIGNMENT_REVOKED',
      'ASSIGNMENT_RETIRED',
      'SHOP_UNLINKED',
      'WAREHOUSE_RETIRED',
      'SCOPE_REVOKED',
    ]);
  });
});

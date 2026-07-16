import Fastify, { type FastifyRequest } from 'fastify';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { extensionSourceCaptureRoutes } from '../routes/extension-source-captures.js';
import { hashExtensionCommandRequest } from '../services/extension-command-grants.js';

const captureHash = 'a'.repeat(64);

function submission() {
  return {
    capture: {
      captureVersion: 'source-product-capture-v2',
      platform: '1688',
      sourceIdentity: { productId: '1000000000236' },
    },
    captureHash,
    payloadBytes: 20480,
  };
}

function dependencies(options: {
  rollout?: Record<string, unknown>;
  device?: Record<string, unknown> | null;
  ingest?: Record<string, unknown>;
} = {}) {
  const device = options.device === undefined ? {
    sessionId: 'session-1',
    tokenId: 'jti-1',
    ownerUserId: 'owner-1',
    actorUserId: 'owner-1',
    scopes: ['capture:write'],
    allowedShopIds: [],
  } : options.device;
  const authenticateDevice = vi.fn(async (request: FastifyRequest) => {
    if (device) (request as any).device = device;
  });
  const evaluate = vi.fn(async () => options.rollout || ({
    enabled: true,
    legacyAllowed: true,
    captureStage: 'shadow_write',
    reason: 'pilot_match',
    revision: 'capture-shadow-1',
  }));
  const ingest = vi.fn(async () => options.ingest || ({
    kind: 'created',
    subjectId: 'subject-1',
    snapshotId: 'snapshot-1',
    snapshotVersion: 1,
    supplyGoodsId: 'goods-1',
    captureHash,
    profile: { version: 'source-product-profile-v1', hash: 'b'.repeat(64) },
  }));
  return {
    authenticateDevice,
    featureFlags: { evaluate },
    service: { ingest },
    evaluate,
    ingest,
  };
}

async function buildApp(options: Parameters<typeof dependencies>[0] = {}) {
  const deps = dependencies(options);
  const app = Fastify();
  await app.register(extensionSourceCaptureRoutes, deps as never);
  await app.ready();
  return { app, ...deps };
}

function headers() {
  return {
    'x-ss-erp-command-grant': 'g'.repeat(43),
    'x-ss-erp-idempotency-key': `source-capture:${captureHash}`,
  };
}

describe('extension source capture routes', () => {
  it('registers inside the live device boundary with capture:write and dedicated secret redaction', () => {
    const index = readFileSync(new URL('../index.ts', import.meta.url), 'utf8');
    const deviceBoundary = index.indexOf('if (isExtensionDeviceAuthEnabled())');
    const registration = index.indexOf('await app.register(extensionSourceCaptureRoutes');
    const collectRegistration = index.indexOf('await app.register(collectRoutes');

    expect(registration).toBeGreaterThan(deviceBoundary);
    expect(registration).toBeLessThan(collectRegistration);
    expect(index.slice(registration, registration + 700)).toContain("requiredScopes: ['capture:write']");
    expect(index).toContain("'req.headers.x-ss-erp-command-grant'");
  });

  it('admits a V2 capture only from trusted device identity and current rollout context', async () => {
    const { app, evaluate, ingest } = await buildApp();
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/source-captures/v2',
        headers: headers(),
        payload: submission(),
      });

      expect(response.statusCode).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(response.json()).toMatchObject({
        code: 1,
        data: { snapshotId: 'snapshot-1', snapshotVersion: 1, replay: false },
      });
      expect(evaluate).toHaveBeenCalledWith('SOURCE_CAPTURE_V2', {
        ownerUserId: 'owner-1',
        deviceSessionId: 'session-1',
        platform: '1688',
      });
      const command = {
        schemaVersion: 'source-product-capture-v2',
        platform: '1688',
        sourceProductId: '1000000000236',
        captureHash,
        payloadBytes: 20480,
      };
      expect(ingest).toHaveBeenCalledWith({
        trusted: {
          ownerUserId: 'owner-1',
          actorUserId: 'owner-1',
          deviceSessionId: 'session-1',
          tokenId: 'jti-1',
          rolloutRevision: 'capture-shadow-1',
          rolloutStage: 'shadow_write',
          ingestChannel: 'EXTENSION_DEVICE',
        },
        submission: submission(),
        grant: {
          token: 'g'.repeat(43),
          idempotencyKey: `source-capture:${captureHash}`,
          requestHash: hashExtensionCommandRequest({
            operation: 'SOURCE_CAPTURE',
            shopId: null,
            workflowId: null,
            draftVersion: null,
            command,
          }),
        },
      });
    } finally {
      await app.close();
    }
  });

  it('returns 200 for an exact hash replay', async () => {
    const { app } = await buildApp({ ingest: {
      kind: 'replay',
      subjectId: 'subject-1',
      snapshotId: 'snapshot-1',
      snapshotVersion: 1,
      supplyGoodsId: 'goods-1',
      captureHash,
      profile: {},
    } });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/source-captures/v2',
        headers: headers(),
        payload: submission(),
      });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ data: { replay: true, snapshotId: 'snapshot-1' } });
    } finally {
      await app.close();
    }
  });

  it('rejects missing trusted device context or command headers before persistence', async () => {
    const missingDevice = await buildApp({ device: null });
    const deviceResponse = await missingDevice.app.inject({
      method: 'POST',
      url: '/source-captures/v2',
      headers: headers(),
      payload: submission(),
    });
    expect(deviceResponse.statusCode).toBe(401);
    expect(missingDevice.ingest).not.toHaveBeenCalled();
    await missingDevice.app.close();

    const missingGrant = await buildApp();
    const grantResponse = await missingGrant.app.inject({
      method: 'POST',
      url: '/source-captures/v2',
      payload: submission(),
    });
    expect(grantResponse.statusCode).toBe(401);
    expect(grantResponse.json()).toMatchObject({ errorCode: 'command_grant_required' });
    expect(missingGrant.evaluate).not.toHaveBeenCalled();
    expect(missingGrant.ingest).not.toHaveBeenCalled();
    await missingGrant.app.close();
  });

  it.each([
    [{ enabled: false, legacyAllowed: true, captureStage: 'off', reason: 'pilot_miss', revision: 'pilot-1' }, 409, 'source_capture_v2_disabled'],
    [{ enabled: false, legacyAllowed: false, captureStage: null, reason: 'config_unavailable', revision: 'unavailable' }, 503, 'source_workflow_rollout_unavailable'],
  ] as const)('fails safely for the current rollout decision', async (rollout, status, errorCode) => {
    const { app, ingest } = await buildApp({ rollout });
    try {
      const response = await app.inject({
        method: 'POST',
        url: '/source-captures/v2',
        headers: headers(),
        payload: submission(),
      });
      expect(response.statusCode).toBe(status);
      expect(response.json()).toMatchObject({ code: 0, errorCode });
      expect(ingest).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });
});

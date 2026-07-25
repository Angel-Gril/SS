import { describe, expect, it, vi } from 'vitest';
import { assertAiImageWorkbenchPublicPayload } from 'shared';
import {
  EXTENSION_BYOK_POLICY_VERSION,
  EXTENSION_BYOK_READINESS_VERSION,
  createExtensionByokPolicyEvaluator,
  parseExtensionByokPolicy,
} from '../services/extension-byok-policy.js';

const context = {
  ownerUserId: 'owner-1',
  shopId: 'shop-1',
  deviceSessionId: 'device-session-1',
  providerOrigin: 'https://images.example.com',
  operation: 'TEXT_TO_IMAGE' as const,
};

function policy(overrides: Record<string, unknown> = {}) {
  return {
    contractVersion: EXTENSION_BYOK_POLICY_VERSION,
    revision: 7,
    mode: 'pilot',
    generationEnabled: true,
    ingestEnabled: false,
    publishEnabled: true,
    ownerUserIds: ['owner-1'],
    shopIds: ['shop-1'],
    deviceSessionIds: ['device-session-1'],
    allowedOrigins: ['https://images.example.com'],
    allowedOperations: ['TEXT_TO_IMAGE'],
    maxConcurrency: 2,
    ...overrides,
  };
}

describe('extension BYOK policy', () => {
  it('fails closed when configuration is missing or unavailable', async () => {
    const missing = createExtensionByokPolicyEvaluator({ loadPolicy: async () => null });
    await expect(missing.evaluate(context)).resolves.toMatchObject({
      contractVersion: EXTENSION_BYOK_READINESS_VERSION,
      policyRevision: null,
      maxConcurrency: 1,
      capabilities: {
        generation: { enabled: false, ready: false, reasonCode: 'POLICY_UNAVAILABLE' },
        ingest: { enabled: false, ready: false, reasonCode: 'POLICY_UNAVAILABLE' },
        publish: { enabled: false, ready: false, reasonCode: 'POLICY_UNAVAILABLE' },
      },
    });

    const loadPolicy = vi.fn(async () => { throw new Error('database unavailable'); });
    const unavailable = createExtensionByokPolicyEvaluator({ loadPolicy });
    await expect(unavailable.evaluate(context)).resolves.toMatchObject({
      policyRevision: null,
      capabilities: {
        generation: { ready: false, reasonCode: 'POLICY_UNAVAILABLE' },
        ingest: { ready: false, reasonCode: 'POLICY_UNAVAILABLE' },
        publish: { ready: false, reasonCode: 'POLICY_UNAVAILABLE' },
      },
    });
  });

  it('keeps generation, ingest, and publish independently default-off', async () => {
    const evaluator = createExtensionByokPolicyEvaluator({
      loadPolicy: async () => policy({
        mode: 'off',
        generationEnabled: false,
        ingestEnabled: false,
        publishEnabled: false,
      }),
    });
    await expect(evaluator.evaluate(context)).resolves.toMatchObject({
      policyRevision: 7,
      mode: 'off',
      capabilities: {
        generation: { enabled: false, ready: false, reasonCode: 'POLICY_DISABLED' },
        ingest: { enabled: false, ready: false, reasonCode: 'POLICY_DISABLED' },
        publish: { enabled: false, ready: false, reasonCode: 'POLICY_DISABLED' },
      },
    });
  });

  it('binds a pilot decision to exact owner, shop, device, origin, operation, and revision', async () => {
    const evaluator = createExtensionByokPolicyEvaluator({ loadPolicy: async () => policy() });
    const decision = await evaluator.evaluate(context);
    expect(decision).toEqual({
      contractVersion: EXTENSION_BYOK_READINESS_VERSION,
      policyRevision: 7,
      mode: 'pilot',
      context,
      maxConcurrency: 2,
      capabilities: {
        generation: { enabled: true, ready: true, reasonCode: 'READY' },
        ingest: { enabled: false, ready: false, reasonCode: 'INGEST_DISABLED' },
        publish: { enabled: true, ready: true, reasonCode: 'READY' },
      },
    });
    expect(assertAiImageWorkbenchPublicPayload(decision)).toBe(decision);
    expect(JSON.stringify(decision)).not.toMatch(/api.?key|authorization|secret|token/iu);
  });

  it.each([
    ['owner', { ownerUserId: 'owner-2' }, 'OWNER_NOT_ALLOWED'],
    ['shop', { shopId: 'shop-2' }, 'SHOP_NOT_ALLOWED'],
    ['device', { deviceSessionId: 'device-session-2' }, 'DEVICE_NOT_ALLOWED'],
    ['origin', { providerOrigin: 'https://other.example.com' }, 'ORIGIN_NOT_ALLOWED'],
    ['operation', { operation: 'INPAINT' }, 'OPERATION_NOT_ALLOWED'],
  ] as const)('fails closed when the %s binding changes', async (_label, changed, reasonCode) => {
    const evaluator = createExtensionByokPolicyEvaluator({ loadPolicy: async () => policy() });
    await expect(evaluator.evaluate({ ...context, ...changed } as typeof context)).resolves
      .toMatchObject({
        capabilities: {
          generation: { ready: false, reasonCode },
          ingest: { ready: false, reasonCode },
          publish: { ready: false, reasonCode },
        },
      });
  });

  it('allows global rollout without pilot lists but still requires origin and operation', async () => {
    const evaluator = createExtensionByokPolicyEvaluator({
      loadPolicy: async () => policy({
        mode: 'global',
        ownerUserIds: [],
        shopIds: [],
        deviceSessionIds: [],
      }),
    });
    await expect(evaluator.evaluate(context)).resolves.toMatchObject({
      capabilities: {
        generation: { ready: true },
        ingest: { ready: false, reasonCode: 'INGEST_DISABLED' },
        publish: { ready: true },
      },
    });
  });

  it.each([
    policy({ maxConcurrency: 0 }),
    policy({ allowedOrigins: ['http://images.example.com'] }),
    policy({ allowedOrigins: ['https://[2606:4700:4700::1111]'] }),
    policy({ allowedOperations: ['UNKNOWN'] }),
    policy({ apiKey: 'must-not-be-accepted' }),
    policy({ mode: 'pilot', deviceSessionIds: [] }),
  ])('rejects an invalid or secret-bearing policy snapshot', (value) => {
    expect(() => parseExtensionByokPolicy(value)).toThrowError(
      expect.objectContaining({ code: 'EXTENSION_BYOK_POLICY_INVALID' }),
    );
  });
});

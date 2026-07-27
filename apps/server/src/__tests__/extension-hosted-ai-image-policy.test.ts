import { describe, expect, it, vi } from 'vitest';
import {
  createExtensionHostedAiImagePolicyEvaluator,
} from '../services/extension-hosted-ai-image-policy.js';

const identity = Object.freeze({
  ownerUserId: 'owner-1',
  shopId: 'shop-1',
  deviceSessionId: 'device-session-1',
});

function dispatchAuthorization(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    reasonCode: 'tenant_allowed',
    reason: 'AI image suite dispatch is authorized',
    ...overrides,
  };
}

function workbenchDecision(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    legacyAllowed: false,
    captureStage: null,
    reason: 'pilot_match',
    revision: 'source-rollout-7',
    ...overrides,
  };
}

function dependencies() {
  return {
    loadHostedFeatureEnabled: vi.fn(async () => true as unknown),
    loadDispatchAuthorization: vi.fn(async (): Promise<unknown> => dispatchAuthorization()),
    featureFlags: {
      evaluate: vi.fn(async (): Promise<unknown> => workbenchDecision()),
    },
  };
}

describe('extension hosted AI image policy', () => {
  it('enables only the exact owner, shop, and device after every constituent allows it', async () => {
    const options = dependencies();
    const evaluate = createExtensionHostedAiImagePolicyEvaluator(options);

    const decision = await evaluate(identity);

    expect(decision).toEqual({
      enabled: true,
      revision: expect.any(Number),
      ...identity,
    });
    expect(Number.isSafeInteger(decision.revision)).toBe(true);
    expect(decision.revision).toBeGreaterThan(0);
    expect(options.loadDispatchAuthorization).toHaveBeenCalledWith('owner-1');
    expect(options.featureFlags.evaluate).toHaveBeenCalledWith(
      'SOURCE_LISTING_EXTENSION_WORKBENCH',
      identity,
    );
  });

  it.each([
    ['hosted feature', { hosted: false }],
    ['suite dispatch', { dispatch: dispatchAuthorization({ enabled: false, reasonCode: 'suite_off' }) }],
    ['workbench rollout', { workbench: workbenchDecision({ enabled: false, reason: 'pilot_miss' }) }],
  ])('fails closed when the %s constituent is disabled', async (_label, override) => {
    const options = dependencies();
    if ('hosted' in override) options.loadHostedFeatureEnabled.mockResolvedValue(override.hosted);
    if ('dispatch' in override) {
      options.loadDispatchAuthorization.mockResolvedValue(override.dispatch);
    }
    if ('workbench' in override) {
      options.featureFlags.evaluate.mockResolvedValue(override.workbench);
    }

    const evaluate = createExtensionHostedAiImagePolicyEvaluator(options);

    await expect(evaluate(identity)).resolves.toMatchObject({
      enabled: false,
      revision: expect.any(Number),
      ...identity,
    });
  });

  it.each(['hosted', 'dispatch', 'workbench'] as const)(
    'never rejects and fails closed when the %s loader throws',
    async (failedLoader) => {
      const options = dependencies();
      if (failedLoader === 'hosted') {
        options.loadHostedFeatureEnabled.mockRejectedValue(new Error('config unavailable'));
      } else if (failedLoader === 'dispatch') {
        options.loadDispatchAuthorization.mockRejectedValue(new Error('authorization unavailable'));
      } else {
        options.featureFlags.evaluate.mockRejectedValue(new Error('rollout unavailable'));
      }
      const evaluate = createExtensionHostedAiImagePolicyEvaluator(options);

      await expect(evaluate(identity)).resolves.toMatchObject({
        enabled: false,
        revision: expect.any(Number),
        ...identity,
      });
    },
  );

  it.each([
    null,
    { ...identity, ownerUserId: '' },
    { ...identity, ownerUserId: ' owner-1' },
    { ...identity, shopId: 'shop-1\n' },
    { ...identity, deviceSessionId: 'd'.repeat(201) },
    { ...identity, deviceSessionId: 7 },
  ])('rejects invalid identity without consulting policy loaders', async (input) => {
    const options = dependencies();
    const evaluate = createExtensionHostedAiImagePolicyEvaluator(options);

    const decision = await evaluate(input as typeof identity);

    expect(decision).toEqual({
      enabled: false,
      revision: expect.any(Number),
      ownerUserId: '',
      shopId: '',
      deviceSessionId: '',
    });
    expect(Number.isSafeInteger(decision.revision)).toBe(true);
    expect(decision.revision).toBeGreaterThan(0);
    expect(options.loadHostedFeatureEnabled).not.toHaveBeenCalled();
    expect(options.loadDispatchAuthorization).not.toHaveBeenCalled();
    expect(options.featureFlags.evaluate).not.toHaveBeenCalled();
  });

  it('does not reject when identity property access throws', async () => {
    const options = dependencies();
    const evaluate = createExtensionHostedAiImagePolicyEvaluator(options);
    const hostileIdentity = new Proxy({}, {
      get() {
        throw new Error('property access failed');
      },
    });

    await expect(evaluate(hostileIdentity as typeof identity)).resolves.toMatchObject({
      enabled: false,
      revision: expect.any(Number),
      ownerUserId: '',
      shopId: '',
      deviceSessionId: '',
    });
    expect(options.loadHostedFeatureEnabled).not.toHaveBeenCalled();
  });

  it.each([
    ['non-boolean hosted flag', { hosted: 'true' }],
    ['incomplete dispatch decision', { dispatch: { enabled: true, reasonCode: 'tenant_allowed' } }],
    [
      'contradictory workbench decision',
      { workbench: workbenchDecision({ enabled: true, reason: 'pilot_miss' }) },
    ],
    ['invalid workbench revision', { workbench: workbenchDecision({ revision: '' }) }],
  ])('fails closed for a %s', async (_label, override) => {
    const options = dependencies();
    if ('hosted' in override) options.loadHostedFeatureEnabled.mockResolvedValue(override.hosted);
    if ('dispatch' in override) {
      options.loadDispatchAuthorization.mockResolvedValue(override.dispatch);
    }
    if ('workbench' in override) {
      options.featureFlags.evaluate.mockResolvedValue(override.workbench);
    }
    const evaluate = createExtensionHostedAiImagePolicyEvaluator(options);

    await expect(evaluate(identity)).resolves.toMatchObject({ enabled: false, ...identity });
  });

  it('derives a stable positive revision from non-secret constituent state', async () => {
    const firstOptions = dependencies();
    const secondOptions = dependencies();
    const first = await createExtensionHostedAiImagePolicyEvaluator(firstOptions)(identity);
    const repeated = await createExtensionHostedAiImagePolicyEvaluator(secondOptions)(identity);

    expect(repeated.revision).toBe(first.revision);

    const changedOptions = dependencies();
    changedOptions.featureFlags.evaluate.mockResolvedValue(workbenchDecision({
      revision: 'sensitive-admin-note-must-not-be-returned',
    }));
    const changed = await createExtensionHostedAiImagePolicyEvaluator(changedOptions)(identity);

    expect(changed.revision).not.toBe(first.revision);
    expect(JSON.stringify(changed)).not.toContain('sensitive-admin-note-must-not-be-returned');

    const changedReasonOptions = dependencies();
    changedReasonOptions.featureFlags.evaluate.mockResolvedValue(workbenchDecision({
      reason: 'global',
    }));
    const changedReason = await createExtensionHostedAiImagePolicyEvaluator(
      changedReasonOptions,
    )(identity);
    expect(changedReason.revision).not.toBe(first.revision);
  });
});

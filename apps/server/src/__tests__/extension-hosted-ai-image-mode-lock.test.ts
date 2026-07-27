import { describe, expect, it, vi } from 'vitest';
import {
  ExtensionHostedAiImageModeLockError,
  createExtensionHostedAiImageModeLockService,
} from '../services/extension-hosted-ai-image-mode-lock.js';
import type { ExtensionHostedAiImagePlanAuthority } from '../services/extension-hosted-ai-image-plan.js';

const binding = Object.freeze({
  snapshotId: 'snapshot-1',
  supplyGoodsId: 'goods-1',
  shopId: 'shop-1',
  listingWorkflowId: 'listing-1',
  draftRevision: 11,
  draftVersion: 7,
});

const identity = Object.freeze({
  ownerUserId: 'owner-1',
  actorUserId: 'owner-1',
  deviceSessionId: 'device-session-1',
});

function authority(overrides: Record<string, unknown> = {}): ExtensionHostedAiImagePlanAuthority {
  return {
    ownerUserId: 'owner-1',
    sourceSubjectId: 'subject-1',
    sourceCaptureCurrent: true,
    workflowStatus: 'ACTIVE',
    draftStage: 'MEDIA_REVIEW',
    selectedSkuKeys: ['sku-1'],
    capturedSkuKeys: ['sku-1'],
    candidateMediaKeys: ['media-1'],
    ...binding,
    ...overrides,
  } as ExtensionHostedAiImagePlanAuthority;
}

function policy(enabled: boolean, overrides: Record<string, unknown> = {}) {
  return {
    enabled,
    revision: 17,
    ownerUserId: 'owner-1',
    shopId: 'shop-1',
    deviceSessionId: 'device-session-1',
    ...overrides,
  };
}

function dependencies() {
  return {
    loadAuthority: vi.fn(async (): Promise<ExtensionHostedAiImagePlanAuthority | null> => authority()),
    hasHostedSuite: vi.fn(async (): Promise<unknown> => false),
    evaluatePolicy: vi.fn(async () => policy(true)),
  };
}

describe('extension hosted AI image mode lock service', () => {
  it.each([
    [false, false, 'NO_SUITE', false],
    [true, false, 'NO_SUITE', true],
    [false, true, 'HAS_SUITE', false],
    [true, true, 'HAS_SUITE', true],
  ] as const)(
    'separates hosted policy %s from persisted suite %s',
    async (hostedEnabled, hasSuite, state, expectedHostedEnabled) => {
      const options = dependencies();
      options.evaluatePolicy.mockResolvedValue(policy(hostedEnabled));
      options.hasHostedSuite.mockResolvedValue(hasSuite);
      const service = createExtensionHostedAiImageModeLockService(options);

      await expect(service.get({ identity, binding })).resolves.toEqual({
        contractVersion: 'extension-hosted-ai-image-mode-lock/v1',
        context: binding,
        state,
        hostedExecutionEnabled: expectedHostedEnabled,
      });
      expect(options.loadAuthority).toHaveBeenCalledWith({
        ownerUserId: 'owner-1',
        listingWorkflowId: 'listing-1',
      });
      expect(options.hasHostedSuite).toHaveBeenCalledWith({
        ownerUserId: 'owner-1',
        binding,
      });
    },
  );

  it('does not confuse a disabled hosted policy with unknown suite state', async () => {
    const options = dependencies();
    options.evaluatePolicy.mockResolvedValue(policy(false));
    options.hasHostedSuite.mockResolvedValue(false);
    const service = createExtensionHostedAiImageModeLockService(options);

    const result = await service.get({ identity, binding });

    expect(result).toMatchObject({ state: 'NO_SUITE', hostedExecutionEnabled: false });
  });

  it.each([
    ['missing authority', null, 'HOSTED_AI_IMAGE_MODE_LOCK_CONTEXT_NOT_FOUND', 404],
    [
      'stale draft',
      authority({ draftVersion: 8 }),
      'HOSTED_AI_IMAGE_MODE_LOCK_CONTEXT_STALE',
      409,
    ],
    [
      'wrong owner',
      authority({ ownerUserId: 'owner-2' }),
      'HOSTED_AI_IMAGE_MODE_LOCK_FORBIDDEN',
      403,
    ],
  ] as const)('rejects %s before reading suite state', async (_label, loaded, code, statusCode) => {
    const options = dependencies();
    options.loadAuthority.mockResolvedValue(loaded);
    const service = createExtensionHostedAiImageModeLockService(options);

    await expect(service.get({ identity, binding })).rejects.toMatchObject({ code, statusCode });
    expect(options.hasHostedSuite).not.toHaveBeenCalled();
  });

  it.each(['authority', 'policy', 'suite'] as const)(
    'returns an unavailable domain error when the %s loader rejects',
    async (loader) => {
      const options = dependencies();
      if (loader === 'authority') options.loadAuthority.mockRejectedValue(new Error('database down'));
      if (loader === 'policy') options.evaluatePolicy.mockRejectedValue(new Error('config down'));
      if (loader === 'suite') options.hasHostedSuite.mockRejectedValue(new Error('database down'));
      const service = createExtensionHostedAiImageModeLockService(options);

      await expect(service.get({ identity, binding })).rejects.toMatchObject({
        code: 'HOSTED_AI_IMAGE_MODE_LOCK_UNAVAILABLE',
        statusCode: 503,
      });
    },
  );

  it.each([
    ['invalid suite result', { suite: false }],
    ['missing suite result', null],
    ['numeric suite result', 0],
  ])('fails closed for %s', async (_label, value) => {
    const options = dependencies();
    options.hasHostedSuite.mockResolvedValue(value);
    const service = createExtensionHostedAiImageModeLockService(options);

    await expect(service.get({ identity, binding })).rejects.toBeInstanceOf(
      ExtensionHostedAiImageModeLockError,
    );
    await expect(service.get({ identity, binding })).rejects.toMatchObject({
      code: 'HOSTED_AI_IMAGE_MODE_LOCK_UNAVAILABLE',
      statusCode: 503,
    });
  });

  it('requires an owner-bound identity before consulting authority', async () => {
    const options = dependencies();
    const service = createExtensionHostedAiImageModeLockService(options);

    await expect(service.get({
      identity: { ...identity, actorUserId: 'operator-1' },
      binding,
    })).rejects.toMatchObject({
      code: 'HOSTED_AI_IMAGE_MODE_LOCK_FORBIDDEN',
      statusCode: 403,
    });
    expect(options.loadAuthority).not.toHaveBeenCalled();
    expect(options.hasHostedSuite).not.toHaveBeenCalled();
    expect(options.evaluatePolicy).not.toHaveBeenCalled();
  });
});

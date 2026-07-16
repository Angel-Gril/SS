import { describe, expect, it, vi } from 'vitest';
import { SystemConfigSchema } from '../config/system-config-schema.js';
import {
  createSourceWorkflowFeatureFlagEvaluator,
  SOURCE_WORKFLOW_FEATURES,
} from '../services/source-workflow-feature-flags.js';

function snapshots(values: Record<string, unknown>) {
  return vi.fn(async (key: string) => ({
    master: values[key],
    policy: values.source_workflow_rollout_policy,
  }));
}

const context = {
  ownerUserId: 'owner-1',
  shopId: 'shop-1',
  deviceSessionId: 'session-1',
  platform: 'OZON',
};

describe('source workflow feature flags', () => {
  it('declares independent defaults for every rollout boundary', () => {
    for (const feature of SOURCE_WORKFLOW_FEATURES) {
      expect(SystemConfigSchema[feature.configKey].parse(undefined)).toBe(false);
    }
    expect(SystemConfigSchema.source_workflow_rollout_policy.parse(undefined)).toBe('{}');
  });

  it('keeps the legacy path available while a feature master is off', async () => {
    const loadSnapshot = snapshots({ feature_source_ozon_publisher_v2: false });
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({ loadSnapshot });

    await expect(evaluator.evaluate('SOURCE_OZON_PUBLISHER_V2', context)).resolves.toMatchObject({
      enabled: false,
      legacyAllowed: true,
      reason: 'master_off',
    });
    expect(loadSnapshot).toHaveBeenCalledWith('feature_source_ozon_publisher_v2');
  });

  it('enables a global rollout and disables the legacy path', async () => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        feature_source_ozon_publisher_v2: true,
        source_workflow_rollout_policy: JSON.stringify({
          revision: 'policy-7',
          features: { SOURCE_OZON_PUBLISHER_V2: { mode: 'global' } },
        }),
      }),
    });

    await expect(evaluator.evaluate('SOURCE_OZON_PUBLISHER_V2', context)).resolves.toEqual({
      enabled: true,
      legacyAllowed: false,
      captureStage: null,
      reason: 'global',
      revision: 'policy-7',
    });
  });

  it.each([
    ['shadow_write', true],
    ['dual_read', true],
    ['v2_only', false],
  ] as const)('supports the %s capture migration stage without changing publisher semantics', async (
    stage,
    legacyAllowed,
  ) => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        feature_source_capture_v2: true,
        source_workflow_rollout_policy: JSON.stringify({
          revision: `capture-${stage}`,
          features: { SOURCE_CAPTURE_V2: { mode: 'global', stage } },
        }),
      }),
    });

    await expect(evaluator.evaluate('SOURCE_CAPTURE_V2', {
      ownerUserId: 'owner-1',
      deviceSessionId: 'session-1',
      platform: '1688',
    })).resolves.toEqual({
      enabled: true,
      legacyAllowed,
      captureStage: stage,
      reason: 'global',
      revision: `capture-${stage}`,
    });
  });

  it('reports the listing workflow as off while its master is disabled', async () => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({ feature_source_listing_workflow: false }),
    });

    await expect(evaluator.evaluate('SOURCE_LISTING_WORKFLOW', {
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      platform: 'OZON',
    })).resolves.toMatchObject({
      enabled: false,
      legacyAllowed: true,
      captureStage: null,
      listingStage: 'off',
      reason: 'master_off',
    });
  });

  it('keeps a listing pilot miss on the legacy path with the workflow stage off', async () => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        feature_source_listing_workflow: true,
        source_workflow_rollout_policy: JSON.stringify({
          revision: 'listing-pilot-1',
          features: {
            SOURCE_LISTING_WORKFLOW: {
              mode: 'pilot',
              shopIds: ['shop-2'],
              platforms: ['OZON'],
            },
          },
        }),
      }),
    });

    await expect(evaluator.evaluate('SOURCE_LISTING_WORKFLOW', {
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      platform: 'OZON',
    })).resolves.toMatchObject({
      enabled: false,
      legacyAllowed: true,
      captureStage: null,
      listingStage: 'off',
      reason: 'pilot_miss',
      revision: 'listing-pilot-1',
    });
  });

  it.each([
    ['shadow_write', true],
    ['dual_read', true],
    ['v2_only', false],
  ] as const)('supports the %s listing workflow migration stage', async (
    listingStage,
    legacyAllowed,
  ) => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        feature_source_listing_workflow: true,
        source_workflow_rollout_policy: JSON.stringify({
          revision: `listing-${listingStage}`,
          features: { SOURCE_LISTING_WORKFLOW: { mode: 'global', listingStage } },
        }),
      }),
    });

    await expect(evaluator.evaluate('SOURCE_LISTING_WORKFLOW', {
      ownerUserId: 'owner-1',
      shopId: 'shop-1',
      platform: 'OZON',
    })).resolves.toEqual({
      enabled: true,
      legacyAllowed,
      captureStage: null,
      listingStage,
      reason: 'global',
      revision: `listing-${listingStage}`,
    });
  });

  it.each([
    ['capture stage on listing workflow', 'SOURCE_LISTING_WORKFLOW', { mode: 'global', stage: 'shadow_write' }],
    ['listing stage on publisher', 'SOURCE_OZON_PUBLISHER_V2', { mode: 'global', listingStage: 'shadow_write' }],
    ['listing stage on capture', 'SOURCE_CAPTURE_V2', { mode: 'global', listingStage: 'shadow_write' }],
  ] as const)('rejects %s', async (_label, feature, rule) => {
    const featureKey = SOURCE_WORKFLOW_FEATURES.find((row) => row.name === feature)!.configKey;
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        [featureKey]: true,
        source_workflow_rollout_policy: JSON.stringify({
          revision: 'wrong-stage-owner',
          features: { [feature]: rule },
        }),
      }),
    });

    await expect(evaluator.evaluate(feature, context)).resolves.toMatchObject({
      enabled: false,
      legacyAllowed: false,
      captureStage: null,
      reason: 'policy_invalid',
    });
  });

  it('rejects capture migration stages on non-capture features', async () => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        feature_source_ozon_publisher_v2: true,
        source_workflow_rollout_policy: JSON.stringify({
          revision: 'wrong-stage-owner',
          features: {
            SOURCE_OZON_PUBLISHER_V2: { mode: 'global', stage: 'shadow_write' },
          },
        }),
      }),
    });

    await expect(evaluator.evaluate('SOURCE_OZON_PUBLISHER_V2', context)).resolves.toMatchObject({
      enabled: false,
      legacyAllowed: false,
      captureStage: null,
      reason: 'policy_invalid',
    });
  });

  it('keeps Ozon mapping reads and writes on independent rollout boundaries', async () => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        feature_source_ozon_mapping_v2_read: true,
        feature_source_ozon_mapping_v2_write: false,
        source_workflow_rollout_policy: JSON.stringify({
          revision: 'mapping-shadow-1',
          features: {
            SOURCE_OZON_MAPPING_V2_READ: { mode: 'global' },
            SOURCE_OZON_MAPPING_V2_WRITE: { mode: 'off' },
          },
        }),
      }),
    });

    await expect(evaluator.evaluate('SOURCE_OZON_MAPPING_V2_READ', context)).resolves.toMatchObject({
      enabled: true,
      reason: 'global',
      revision: 'mapping-shadow-1',
    });
    await expect(evaluator.evaluate('SOURCE_OZON_MAPPING_V2_WRITE', context)).resolves.toMatchObject({
      enabled: false,
      reason: 'master_off',
    });
  });

  it.each([
    ['missing shop', { ...context, shopId: null }],
    ['wrong platform', { ...context, platform: '1688' }],
  ])('requires an owned Ozon shop context for mapping boundaries: %s', async (_label, mappingContext) => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        feature_source_ozon_mapping_v2_write: true,
        source_workflow_rollout_policy: JSON.stringify({
          revision: 'mapping-context-1',
          features: { SOURCE_OZON_MAPPING_V2_WRITE: { mode: 'global' } },
        }),
      }),
    });

    await expect(evaluator.evaluate('SOURCE_OZON_MAPPING_V2_WRITE', mappingContext)).resolves.toMatchObject({
      enabled: false,
      legacyAllowed: false,
      reason: 'context_invalid',
    });
  });

  it('rejects a mapping pilot that is not explicitly scoped to shops', async () => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        feature_source_ozon_mapping_v2_read: true,
        source_workflow_rollout_policy: JSON.stringify({
          revision: 'unsafe-mapping-pilot',
          features: {
            SOURCE_OZON_MAPPING_V2_READ: {
              mode: 'pilot',
              ownerUserIds: ['owner-1'],
            },
          },
        }),
      }),
    });

    await expect(evaluator.evaluate('SOURCE_OZON_MAPPING_V2_READ', context)).resolves.toMatchObject({
      enabled: false,
      legacyAllowed: false,
      reason: 'policy_invalid',
    });
  });

  it('requires every configured pilot dimension to match server context', async () => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        feature_source_ozon_publisher_v2: true,
        source_workflow_rollout_policy: JSON.stringify({
          revision: 'policy-pilot',
          features: {
            SOURCE_OZON_PUBLISHER_V2: {
              mode: 'pilot',
              ownerUserIds: ['owner-1'],
              shopIds: ['shop-1'],
              platforms: ['OZON'],
            },
          },
        }),
      }),
    });

    await expect(evaluator.evaluate('SOURCE_OZON_PUBLISHER_V2', context)).resolves.toMatchObject({
      enabled: true,
      legacyAllowed: false,
      reason: 'pilot_match',
    });
    await expect(evaluator.evaluate('SOURCE_OZON_PUBLISHER_V2', {
      ...context,
      shopId: 'shop-2',
    })).resolves.toMatchObject({
      enabled: false,
      legacyAllowed: true,
      reason: 'pilot_miss',
    });
  });

  it.each([
    ['invalid JSON', '{'],
    ['missing feature policy', JSON.stringify({ revision: 'bad', features: {} })],
    ['empty pilot allowlist', JSON.stringify({
      revision: 'bad-pilot',
      features: { SOURCE_OZON_PUBLISHER_V2: { mode: 'pilot' } },
    })],
    ['global policy with a pilot allowlist', JSON.stringify({
      revision: 'bad-global',
      features: {
        SOURCE_OZON_PUBLISHER_V2: { mode: 'global', shopIds: ['shop-1'] },
      },
    })],
    ['publisher pilot without a shop allowlist', JSON.stringify({
      revision: 'unsafe-publisher-pilot',
      features: {
        SOURCE_OZON_PUBLISHER_V2: { mode: 'pilot', deviceSessionIds: ['session-1'] },
      },
    })],
  ])('fails closed when an enabled write boundary has %s', async (_label, policy) => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        feature_source_ozon_publisher_v2: true,
        source_workflow_rollout_policy: policy,
      }),
    });

    await expect(evaluator.evaluate('SOURCE_OZON_PUBLISHER_V2', context)).resolves.toMatchObject({
      enabled: false,
      legacyAllowed: false,
      reason: 'policy_invalid',
    });
  });

  it('reads current configuration on every call and across evaluator instances', async () => {
    let master = false;
    const values = {
      get feature_source_capture_v2() { return master; },
      source_workflow_rollout_policy: JSON.stringify({
        revision: 'live',
        features: { SOURCE_CAPTURE_V2: { mode: 'global' } },
      }),
    };
    const loadSnapshot = vi.fn(async (key: string) => ({
      master: (values as any)[key],
      policy: values.source_workflow_rollout_policy,
    }));
    const first = createSourceWorkflowFeatureFlagEvaluator({ loadSnapshot });
    const second = createSourceWorkflowFeatureFlagEvaluator({ loadSnapshot });

    expect(await first.evaluate('SOURCE_CAPTURE_V2', context)).toMatchObject({
      enabled: false,
      legacyAllowed: true,
      captureStage: 'off',
    });
    master = true;
    expect(await second.evaluate('SOURCE_CAPTURE_V2', context)).toMatchObject({
      enabled: true,
      legacyAllowed: false,
      captureStage: 'v2_only',
    });
    expect(loadSnapshot.mock.calls.filter(([key]) => key === 'feature_source_capture_v2')).toHaveLength(2);
  });

  it('fails closed when an enabled boundary has a malformed master value', async () => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        feature_source_ozon_publisher_v2: 'TRUE',
        source_workflow_rollout_policy: JSON.stringify({
          revision: 'policy-7',
          features: { SOURCE_OZON_PUBLISHER_V2: { mode: 'global' } },
        }),
      }),
    });

    await expect(evaluator.evaluate('SOURCE_OZON_PUBLISHER_V2', context)).resolves.toMatchObject({
      enabled: false,
      legacyAllowed: false,
      reason: 'policy_invalid',
    });
  });

  it('fails closed when required server context is missing', async () => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: snapshots({
        feature_source_ozon_publisher_v2: true,
        source_workflow_rollout_policy: JSON.stringify({
          revision: 'global',
          features: { SOURCE_OZON_PUBLISHER_V2: { mode: 'global' } },
        }),
      }),
    });

    await expect(evaluator.evaluate('SOURCE_OZON_PUBLISHER_V2', {
      ownerUserId: 'owner-1',
      shopId: null,
      platform: 'OZON',
    })).resolves.toMatchObject({
      enabled: false,
      legacyAllowed: false,
      reason: 'context_invalid',
    });
  });

  it('fails closed when the configuration snapshot cannot be read', async () => {
    const evaluator = createSourceWorkflowFeatureFlagEvaluator({
      loadSnapshot: vi.fn().mockRejectedValue(new Error('database unavailable')),
    });

    await expect(evaluator.evaluate('SOURCE_OZON_PUBLISHER_V2', context)).resolves.toEqual({
      enabled: false,
      legacyAllowed: false,
      captureStage: null,
      reason: 'config_unavailable',
      revision: 'unavailable',
    });
  });
});

import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { findSystemConfig } = vi.hoisted(() => ({
  findSystemConfig: vi.fn(),
}));

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    systemConfig: {
      findUnique: findSystemConfig,
    },
  },
}));

import { SystemConfigSchema } from '../config/system-config-schema.js';
import {
  createOzonPublisherEntrypointRolloutService,
  OZON_PUBLISHER_ENTRYPOINT_STAGE_CONFIG_KEYS,
  OZON_PUBLISHER_ORIGIN_CHANNELS,
  OZON_PUBLISHER_WRITER_ENTRYPOINTS,
  type OzonPublisherEntrypointReadiness,
  type OzonPublisherOriginChannel,
  type OzonPublisherRolloutBoundary,
  type OzonPublisherWriterEntrypoint,
} from '../services/ozon-publisher-entrypoint-rollout.js';
import type {
  SourceWorkflowFeatureDecision,
  SourceWorkflowFeatureFlagEvaluator,
} from '../services/source-workflow-feature-flags.js';

const CONTEXT = {
  ownerUserId: 'owner-1',
  shopId: 'shop-1',
  platform: 'OZON',
};
const EVIDENCE_HASH = 'a'.repeat(64);

function featureDecision(
  overrides: Partial<SourceWorkflowFeatureDecision> = {},
): SourceWorkflowFeatureDecision {
  return {
    enabled: true,
    legacyAllowed: false,
    captureStage: null,
    reason: 'global',
    revision: 'rollout-1',
    ...overrides,
  };
}

function flags(input: {
  listing?: SourceWorkflowFeatureDecision;
  publisher?: SourceWorkflowFeatureDecision;
  error?: Error;
} = {}): SourceWorkflowFeatureFlagEvaluator {
  return {
    evaluate: vi.fn(async (feature) => {
      if (input.error) throw input.error;
      return feature === 'SOURCE_LISTING_WORKFLOW'
        ? input.listing || featureDecision({ listingStage: 'v2_only' })
        : input.publisher || featureDecision();
    }),
  };
}

function readiness(
  overrides: Partial<OzonPublisherEntrypointReadiness> = {},
): OzonPublisherEntrypointReadiness {
  return {
    ready: true,
    rolloutRevision: 'rollout-1',
    gateStateVersion: 3,
    evidenceHash: EVIDENCE_HASH,
    ...overrides,
  };
}

function boundaryForKey(key: string): OzonPublisherRolloutBoundary {
  const boundary = Object.entries(OZON_PUBLISHER_ENTRYPOINT_STAGE_CONFIG_KEYS)
    .find(([, configKey]) => configKey === key)?.[0];
  if (!boundary) throw new Error(`Unknown test config key: ${key}`);
  return boundary as OzonPublisherRolloutBoundary;
}

function build(options: {
  defaultStage?: unknown;
  stages?: Partial<Record<OzonPublisherRolloutBoundary, unknown>>;
  featureFlags?: SourceWorkflowFeatureFlagEvaluator;
  gate?: OzonPublisherEntrypointReadiness | null;
  stageError?: Error;
  readinessError?: Error;
} = {}) {
  const loadStage = vi.fn(async (key: string) => {
    if (options.stageError) throw options.stageError;
    const boundary = boundaryForKey(key);
    return Object.hasOwn(options.stages || {}, boundary)
      ? options.stages![boundary]
      : options.defaultStage ?? 'off';
  });
  const loadReadiness = vi.fn(async () => {
    if (options.readinessError) throw options.readinessError;
    return options.gate === undefined ? readiness() : options.gate;
  });
  const featureFlags = options.featureFlags || flags();
  return {
    featureFlags,
    loadStage,
    loadReadiness,
    service: createOzonPublisherEntrypointRolloutService({
      featureFlags,
      loadStage,
      loadReadiness,
    }),
  };
}

function evaluateWrite(
  service: ReturnType<typeof build>['service'],
  writerEntrypoint: OzonPublisherWriterEntrypoint | null = 'COLLECT_PUBLISH_OZON',
  originChannel: OzonPublisherOriginChannel = 'DIRECT',
) {
  return service.evaluateWrite({ writerEntrypoint, originChannel, context: CONTEXT });
}

describe('Ozon publisher entrypoint rollout control plane', () => {
  beforeEach(() => {
    findSystemConfig.mockReset();
  });

  it('partitions five unique stage keys into three writers and two origins, all default off', () => {
    expect(OZON_PUBLISHER_WRITER_ENTRYPOINTS).toEqual([
      'COLLECT_PUBLISH_OZON',
      'LISTING_BATCH',
      'LISTING_IMPORT_BY_SKU',
    ]);
    expect(OZON_PUBLISHER_ORIGIN_CHANNELS).toEqual([
      'BROWSER_ONE_CLICK',
      'EXTENSION_ADAPTER',
    ]);
    const boundaries = [
      ...OZON_PUBLISHER_WRITER_ENTRYPOINTS,
      ...OZON_PUBLISHER_ORIGIN_CHANNELS,
    ];
    expect(new Set(boundaries).size).toBe(5);
    expect(Object.keys(OZON_PUBLISHER_ENTRYPOINT_STAGE_CONFIG_KEYS)).toEqual(boundaries);
    const keys = Object.values(OZON_PUBLISHER_ENTRYPOINT_STAGE_CONFIG_KEYS);
    expect(new Set(keys).size).toBe(5);
    for (const key of keys) expect(SystemConfigSchema[key].parse(undefined)).toBe('off');
  });

  it('has no dependency on Ozon submission or write-path implementations', () => {
    const source = readFileSync(new URL(
      '../services/ozon-publisher-entrypoint-rollout.ts',
      import.meta.url,
    ), 'utf8');

    for (const forbidden of [
      'getConfig',
      'ozon-client',
      'ozon-listing-publisher',
      'ozon-publish-attempt',
      'ozon-v3-import-package-contract',
      'ozon-listing-production-compile-adapter',
      'importProducts',
    ]) {
      expect(source).not.toContain(forbidden);
    }
    expect(source).not.toMatch(/from\s+['"][^'"]*\/routes\//u);
  });

  it('strictly reads a missing persisted writer stage as off', async () => {
    findSystemConfig.mockResolvedValueOnce(null);
    const featureFlags = flags();
    const service = createOzonPublisherEntrypointRolloutService({ featureFlags });

    await expect(service.evaluateWrite({
      writerEntrypoint: 'LISTING_BATCH',
      originChannel: 'DIRECT',
      context: CONTEXT,
    })).resolves.toMatchObject({
      configuredStages: { writer: 'off', origin: null },
      effectiveStage: 'off',
      authority: 'LEGACY',
      reason: 'effective_stage_off',
    });
    expect(findSystemConfig).toHaveBeenCalledOnce();
    expect(findSystemConfig).toHaveBeenCalledWith({
      where: { key: 'source_ozon_publisher_listing_batch_stage' },
      select: { value: true },
    });
  });

  it.each(['V2', ' off ', '', 'unknown'])(
    'blocks an invalid persisted stage value %j without evaluating policy',
    async (value) => {
      findSystemConfig.mockResolvedValueOnce({ value });
      const featureFlags = flags();
      const service = createOzonPublisherEntrypointRolloutService({ featureFlags });

      await expect(service.evaluateWrite({
        writerEntrypoint: 'COLLECT_PUBLISH_OZON',
        originChannel: 'DIRECT',
        context: CONTEXT,
      })).resolves.toMatchObject({
        configuredStages: { writer: null, origin: null },
        effectiveStage: null,
        authority: 'BLOCKED',
        limitingBoundary: 'COLLECT_PUBLISH_OZON',
        reason: 'stage_config_invalid',
      });
      expect(featureFlags.evaluate).not.toHaveBeenCalled();
    },
  );

  it('blocks when the strict persisted stage query fails', async () => {
    findSystemConfig.mockRejectedValueOnce(new Error('database unavailable'));
    const featureFlags = flags();
    const service = createOzonPublisherEntrypointRolloutService({ featureFlags });

    await expect(service.evaluateWrite({
      writerEntrypoint: 'COLLECT_PUBLISH_OZON',
      originChannel: 'DIRECT',
      context: CONTEXT,
    })).resolves.toMatchObject({
      authority: 'BLOCKED',
      limitingBoundary: 'COLLECT_PUBLISH_OZON',
      reason: 'stage_config_unavailable',
    });
    expect(featureFlags.evaluate).not.toHaveBeenCalled();
  });

  it.each(OZON_PUBLISHER_WRITER_ENTRYPOINTS)(
    'keeps direct writer %s on legacy when its stage is off',
    async (writerEntrypoint) => {
      const built = build({ defaultStage: 'off' });

      await expect(evaluateWrite(built.service, writerEntrypoint)).resolves.toMatchObject({
        writerEntrypoint,
        originChannel: 'DIRECT',
        configuredStages: { writer: 'off', origin: null },
        effectiveStage: 'off',
        authority: 'LEGACY',
        observeParity: false,
        limitingBoundary: writerEntrypoint,
        reason: 'effective_stage_off',
      });
      expect(built.loadStage).toHaveBeenCalledWith(
        OZON_PUBLISHER_ENTRYPOINT_STAGE_CONFIG_KEYS[writerEntrypoint],
      );
    },
  );

  it('keeps a direct shadow writer on legacy and enables observation', async () => {
    const built = build({ defaultStage: 'shadow' });

    await expect(evaluateWrite(built.service)).resolves.toMatchObject({
      configuredStages: { writer: 'shadow', origin: null },
      effectiveStage: 'shadow',
      authority: 'LEGACY',
      observeParity: true,
      reason: 'shadow',
    });
    expect(built.loadReadiness).not.toHaveBeenCalled();
  });

  it.each(OZON_PUBLISHER_WRITER_ENTRYPOINTS)(
    'allows direct writer %s V2 only with exact route readiness',
    async (writerEntrypoint) => {
      const built = build({ defaultStage: 'v2' });

      await expect(evaluateWrite(built.service, writerEntrypoint)).resolves.toMatchObject({
        writerEntrypoint,
        originChannel: 'DIRECT',
        effectiveStage: 'v2',
        authority: 'V2',
        reason: 'v2_ready',
        gateStateVersion: 3,
        evidenceHash: EVIDENCE_HASH,
      });
      expect(built.loadReadiness).toHaveBeenCalledWith({
        writerEntrypoint,
        originChannel: 'DIRECT',
        rolloutRevision: 'rollout-1',
      });
    },
  );

  it.each([
    ['off', 'off', 'off', 'LEGACY', false],
    ['off', 'shadow', 'off', 'LEGACY', false],
    ['off', 'v2', 'off', 'LEGACY', false],
    ['shadow', 'off', 'off', 'LEGACY', false],
    ['shadow', 'shadow', 'shadow', 'LEGACY', true],
    ['shadow', 'v2', 'shadow', 'LEGACY', true],
    ['v2', 'off', 'off', 'LEGACY', false],
    ['v2', 'shadow', 'shadow', 'LEGACY', true],
    ['v2', 'v2', 'v2', 'V2', false],
  ] as const)(
    'caps browser origin stage: writer=%s origin=%s',
    async (writerStage, originStage, effectiveStage, authority, observeParity) => {
      const built = build({
        stages: {
          COLLECT_PUBLISH_OZON: writerStage,
          BROWSER_ONE_CLICK: originStage,
        },
      });

      await expect(evaluateWrite(
        built.service,
        'COLLECT_PUBLISH_OZON',
        'BROWSER_ONE_CLICK',
      )).resolves.toMatchObject({
        configuredStages: { writer: writerStage, origin: originStage },
        effectiveStage,
        authority,
        observeParity,
      });
      if (effectiveStage === 'v2') {
        expect(built.loadReadiness).toHaveBeenCalledWith({
          writerEntrypoint: 'COLLECT_PUBLISH_OZON',
          originChannel: 'BROWSER_ONE_CLICK',
          rolloutRevision: 'rollout-1',
        });
      } else {
        expect(built.loadReadiness).not.toHaveBeenCalled();
      }
    },
  );

  it.each(['LISTING_BATCH', 'LISTING_IMPORT_BY_SKU'] as const)(
    'blocks browser origin from incompatible writer %s',
    async (writerEntrypoint) => {
      const built = build({ defaultStage: 'v2' });

      await expect(evaluateWrite(
        built.service,
        writerEntrypoint,
        'BROWSER_ONE_CLICK',
      )).resolves.toMatchObject({
        authority: 'BLOCKED',
        reason: 'origin_writer_mismatch',
      });
      expect(built.loadStage).not.toHaveBeenCalled();
      expect(built.loadReadiness).not.toHaveBeenCalled();
    },
  );

  it.each(OZON_PUBLISHER_WRITER_ENTRYPOINTS)(
    'blocks extension origin from independently authorizing writer %s',
    async (writerEntrypoint) => {
      const built = build({ defaultStage: 'v2' });

      await expect(evaluateWrite(
        built.service,
        writerEntrypoint,
        'EXTENSION_ADAPTER',
      )).resolves.toMatchObject({
        authority: 'BLOCKED',
        reason: 'origin_writer_unavailable',
      });
      expect(built.loadStage).not.toHaveBeenCalled();
      expect(built.loadReadiness).not.toHaveBeenCalled();
    },
  );

  it('blocks a write request without a physical writer', async () => {
    const built = build({ defaultStage: 'v2' });

    await expect(evaluateWrite(
      built.service,
      null,
      'EXTENSION_ADAPTER',
    )).resolves.toMatchObject({
      writerEntrypoint: null,
      authority: 'BLOCKED',
      reason: 'writer_unavailable',
    });
    expect(built.loadStage).not.toHaveBeenCalled();
  });

  it.each([
    ['master_off', featureDecision({ enabled: false, legacyAllowed: true, reason: 'master_off' })],
    ['policy_off', featureDecision({ enabled: false, legacyAllowed: true, reason: 'policy_off' })],
    ['pilot_miss', featureDecision({ enabled: false, legacyAllowed: true, reason: 'pilot_miss' })],
  ] as const)('keeps a consistently inactive %s scope on legacy', async (reason, inactive) => {
    const built = build({
      defaultStage: 'v2',
      featureFlags: flags({ listing: inactive, publisher: inactive }),
    });

    await expect(evaluateWrite(built.service)).resolves.toMatchObject({
      authority: 'LEGACY',
      observeParity: false,
      reason,
    });
    expect(built.loadReadiness).not.toHaveBeenCalled();
  });

  it.each([
    ['active listing and inactive publisher', {
      listing: featureDecision({ listingStage: 'v2_only' }),
      publisher: featureDecision({
        enabled: false,
        legacyAllowed: true,
        reason: 'pilot_miss',
      }),
    }],
    ['inactive listing and active publisher', {
      listing: featureDecision({
        enabled: false,
        legacyAllowed: true,
        reason: 'pilot_miss',
        listingStage: 'off',
      }),
      publisher: featureDecision(),
    }],
  ] as const)('blocks a mixed capability decision: %s', async (_label, decisions) => {
    const built = build({
      defaultStage: 'off',
      featureFlags: flags(decisions),
    });

    await expect(evaluateWrite(built.service)).resolves.toMatchObject({
      authority: 'BLOCKED',
      observeParity: false,
      reason: 'publisher_capability_not_ready',
    });
    expect(built.loadReadiness).not.toHaveBeenCalled();
  });

  it.each([
    ['missing evidence', null, 'evidence_missing'],
    ['not-ready evidence', readiness({ ready: false }), 'evidence_not_ready'],
    ['revision drift', readiness({ rolloutRevision: 'rollout-2' }), 'evidence_revision_mismatch'],
    ['missing ready hash', readiness({ evidenceHash: null }), 'readiness_invalid'],
    ['invalid hash', readiness({ evidenceHash: 'not-a-hash' }), 'readiness_invalid'],
    ['invalid state version', readiness({ gateStateVersion: -1 }), 'readiness_invalid'],
  ] as const)('blocks V2 for %s', async (_label, gate, reason) => {
    const built = build({ defaultStage: 'v2', gate });

    await expect(evaluateWrite(built.service, 'LISTING_BATCH')).resolves.toMatchObject({
      authority: 'BLOCKED',
      observeParity: false,
      rolloutRevision: 'rollout-1',
      reason,
    });
  });

  it.each(['off', 'shadow', 'v2'] as const)(
    'blocks stage %s while the combined listing/publisher capability is inconsistent',
    async (stage) => {
      const built = build({
        defaultStage: stage,
        featureFlags: flags({
          listing: featureDecision({ legacyAllowed: true, listingStage: 'shadow_write' }),
        }),
      });

      await expect(evaluateWrite(built.service)).resolves.toMatchObject({
        authority: 'BLOCKED',
        reason: 'publisher_capability_not_ready',
      });
      expect(built.loadReadiness).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['policy_invalid', 'policy_invalid'],
    ['context_invalid', 'context_invalid'],
    ['config_unavailable', 'config_unavailable'],
  ] as const)('fails closed for a %s feature decision', async (featureReason, expectedReason) => {
    const invalid = featureDecision({
      enabled: false,
      legacyAllowed: false,
      reason: featureReason,
    });
    const built = build({ defaultStage: 'off', featureFlags: flags({ publisher: invalid }) });

    await expect(evaluateWrite(built.service)).resolves.toMatchObject({
      authority: 'BLOCKED',
      reason: expectedReason,
    });
  });

  it('fails closed when listing and publisher revisions drift', async () => {
    const built = build({
      defaultStage: 'off',
      featureFlags: flags({ publisher: featureDecision({ revision: 'rollout-2' }) }),
    });

    await expect(evaluateWrite(built.service, 'LISTING_IMPORT_BY_SKU')).resolves.toMatchObject({
      authority: 'BLOCKED',
      reason: 'policy_revision_mismatch',
      rolloutRevision: 'listing:rollout-1|publisher:rollout-2',
    });
  });

  it.each([
    ['empty', ''],
    ['non-canonical', ' rollout-1'],
    ['oversized', 'r'.repeat(201)],
  ])('fails closed with policy_revision_invalid for an %s revision', async (_label, revision) => {
    const built = build({
      defaultStage: 'off',
      featureFlags: flags({ publisher: featureDecision({ revision }) }),
    });

    await expect(evaluateWrite(built.service, 'LISTING_IMPORT_BY_SKU')).resolves.toMatchObject({
      authority: 'BLOCKED',
      reason: 'policy_revision_invalid',
    });
    expect(built.loadReadiness).not.toHaveBeenCalled();
  });

  it.each([
    ['stage read failure', { stageError: new Error('config unavailable') }, 'stage_config_unavailable'],
    ['invalid stage', { defaultStage: 'V2' }, 'stage_config_invalid'],
    ['feature read failure', { featureFlags: flags({ error: new Error('policy unavailable') }) }, 'feature_decision_unavailable'],
    ['readiness failure', { defaultStage: 'v2', readinessError: new Error('gate unavailable') }, 'readiness_unavailable'],
  ] as const)('fails closed on %s', async (_label, options, reason) => {
    const built = build(options);

    await expect(evaluateWrite(built.service)).resolves.toMatchObject({
      authority: 'BLOCKED',
      observeParity: false,
      reason,
    });
  });

  it('defaults a V2 request to blocked when no readiness adapter is installed', async () => {
    const service = createOzonPublisherEntrypointRolloutService({
      featureFlags: flags(),
      loadStage: async () => 'v2',
    });

    await expect(service.evaluateWrite({
      writerEntrypoint: 'COLLECT_PUBLISH_OZON',
      originChannel: 'DIRECT',
      context: CONTEXT,
    })).resolves.toMatchObject({ authority: 'BLOCKED', reason: 'evidence_missing' });
  });

  it('rejects malformed feature decisions without consulting readiness', async () => {
    const featureFlags = {
      evaluate: vi.fn(async () => ({
        enabled: true,
        legacyAllowed: false,
        captureStage: null,
        reason: 'master_off',
        revision: 'rollout-1',
      })),
    } as SourceWorkflowFeatureFlagEvaluator;
    const built = build({ defaultStage: 'v2', featureFlags });

    await expect(evaluateWrite(built.service)).resolves.toMatchObject({
      authority: 'BLOCKED',
      reason: 'feature_decision_invalid',
    });
    expect(built.loadReadiness).not.toHaveBeenCalled();
  });
});

import type { SystemConfigKey } from '../config/system-config-schema.js';
import { prisma } from '../lib/prisma.js';
import type { OzonPublisherEntrypoint } from './ozon-publisher-entrypoint-parity.js';
import {
  sourceListingPublisherCapability,
  type SourceWorkflowFeatureContext,
  type SourceWorkflowFeatureDecision,
  type SourceWorkflowFeatureFlagEvaluator,
} from './source-workflow-feature-flags.js';

export type OzonPublisherWriterEntrypoint = Extract<
  OzonPublisherEntrypoint,
  'COLLECT_PUBLISH_OZON' | 'LISTING_BATCH' | 'LISTING_IMPORT_BY_SKU'
>;
export type OzonPublisherOriginChannel =
  | 'DIRECT'
  | Extract<OzonPublisherEntrypoint, 'BROWSER_ONE_CLICK' | 'EXTENSION_ADAPTER'>;
export type OzonPublisherRolloutBoundary =
  | OzonPublisherWriterEntrypoint
  | Exclude<OzonPublisherOriginChannel, 'DIRECT'>;

export const OZON_PUBLISHER_WRITER_ENTRYPOINTS = [
  'COLLECT_PUBLISH_OZON',
  'LISTING_BATCH',
  'LISTING_IMPORT_BY_SKU',
] as const satisfies readonly OzonPublisherWriterEntrypoint[];

export const OZON_PUBLISHER_ORIGIN_CHANNELS = [
  'BROWSER_ONE_CLICK',
  'EXTENSION_ADAPTER',
] as const satisfies readonly Exclude<OzonPublisherOriginChannel, 'DIRECT'>[];

export type OzonPublisherEntrypointStage = 'off' | 'shadow' | 'v2';
export type OzonPublisherEntrypointAuthority = 'LEGACY' | 'V2' | 'BLOCKED';

export const OZON_PUBLISHER_ENTRYPOINT_STAGE_CONFIG_KEYS = {
  COLLECT_PUBLISH_OZON: 'source_ozon_publisher_collect_publish_stage',
  LISTING_BATCH: 'source_ozon_publisher_listing_batch_stage',
  LISTING_IMPORT_BY_SKU: 'source_ozon_publisher_listing_import_by_sku_stage',
  BROWSER_ONE_CLICK: 'source_ozon_publisher_browser_one_click_stage',
  EXTENSION_ADAPTER: 'source_ozon_publisher_extension_adapter_stage',
} as const satisfies Record<OzonPublisherRolloutBoundary, SystemConfigKey>;

export type OzonPublisherEntrypointStageConfigKey =
  typeof OZON_PUBLISHER_ENTRYPOINT_STAGE_CONFIG_KEYS[OzonPublisherRolloutBoundary];

export interface OzonPublisherEntrypointReadiness {
  ready: boolean;
  rolloutRevision: string;
  gateStateVersion: number;
  evidenceHash: string | null;
}

export type OzonPublisherEntrypointRolloutReason =
  | 'writer_unavailable'
  | 'origin_writer_mismatch'
  | 'origin_writer_unavailable'
  | 'effective_stage_off'
  | 'master_off'
  | 'policy_off'
  | 'pilot_miss'
  | 'shadow'
  | 'v2_ready'
  | 'stage_config_unavailable'
  | 'stage_config_invalid'
  | 'feature_decision_unavailable'
  | 'feature_decision_invalid'
  | 'policy_invalid'
  | 'context_invalid'
  | 'config_unavailable'
  | 'policy_revision_invalid'
  | 'policy_revision_mismatch'
  | 'publisher_capability_not_ready'
  | 'readiness_unavailable'
  | 'readiness_invalid'
  | 'evidence_missing'
  | 'evidence_revision_mismatch'
  | 'evidence_not_ready';

export interface OzonPublisherEntrypointRolloutDecision {
  writerEntrypoint: OzonPublisherWriterEntrypoint | null;
  originChannel: OzonPublisherOriginChannel;
  configuredStages: {
    writer: OzonPublisherEntrypointStage | null;
    origin: OzonPublisherEntrypointStage | null;
  };
  effectiveStage: OzonPublisherEntrypointStage | null;
  authority: OzonPublisherEntrypointAuthority;
  observeParity: boolean;
  limitingBoundary: OzonPublisherRolloutBoundary | null;
  rolloutRevision: string;
  reason: OzonPublisherEntrypointRolloutReason;
  gateStateVersion: number | null;
  evidenceHash: string | null;
}

export interface OzonPublisherEntrypointRolloutService {
  evaluateWrite(input: {
    writerEntrypoint: OzonPublisherWriterEntrypoint | null;
    originChannel: OzonPublisherOriginChannel;
    context: SourceWorkflowFeatureContext;
  }): Promise<OzonPublisherEntrypointRolloutDecision>;
}

type LoadStage = (
  key: OzonPublisherEntrypointStageConfigKey,
) => Promise<unknown>;

type LoadReadiness = (input: {
  writerEntrypoint: OzonPublisherWriterEntrypoint;
  originChannel: OzonPublisherOriginChannel;
  rolloutRevision: string;
}) => Promise<OzonPublisherEntrypointReadiness | null>;

type StageLoadResult =
  | { ok: true; stage: OzonPublisherEntrypointStage }
  | { ok: false; reason: 'stage_config_unavailable' | 'stage_config_invalid' };

const FEATURE_REASONS = new Set<SourceWorkflowFeatureDecision['reason']>([
  'master_off',
  'policy_off',
  'global',
  'pilot_match',
  'pilot_miss',
  'policy_invalid',
  'context_invalid',
  'config_unavailable',
]);
const SAFE_LEGACY_REASONS = new Set<SourceWorkflowFeatureDecision['reason']>([
  'master_off',
  'policy_off',
  'pilot_miss',
]);
const FAIL_CLOSED_REASONS = new Set<SourceWorkflowFeatureDecision['reason']>([
  'policy_invalid',
  'context_invalid',
  'config_unavailable',
]);
const ACTIVE_REASONS = new Set<SourceWorkflowFeatureDecision['reason']>([
  'global',
  'pilot_match',
]);
const EVIDENCE_HASH = /^[a-f0-9]{64}$/u;
const STAGE_RANK: Record<OzonPublisherEntrypointStage, number> = {
  off: 0,
  shadow: 1,
  v2: 2,
};

async function loadStageFromSystemConfig(
  key: OzonPublisherEntrypointStageConfigKey,
): Promise<unknown> {
  const record = await prisma.systemConfig.findUnique({
    where: { key },
    select: { value: true },
  });
  return record === null ? 'off' : record.value;
}

async function loadBoundaryStage(
  loadStage: LoadStage,
  boundary: OzonPublisherRolloutBoundary,
): Promise<StageLoadResult> {
  let value: unknown;
  try {
    value = await loadStage(OZON_PUBLISHER_ENTRYPOINT_STAGE_CONFIG_KEYS[boundary]);
  } catch {
    return { ok: false, reason: 'stage_config_unavailable' };
  }
  return value === 'off' || value === 'shadow' || value === 'v2'
    ? { ok: true, stage: value }
    : { ok: false, reason: 'stage_config_invalid' };
}

function exactRevision(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.normalize('NFKC').trim();
  return normalized === value && normalized.length > 0 && normalized.length <= 200
    ? normalized
    : null;
}

function combinedRevision(listing: unknown, publisher: unknown): string {
  const listingRevision = typeof listing === 'string' ? listing : 'invalid';
  const publisherRevision = typeof publisher === 'string' ? publisher : 'invalid';
  if (listingRevision === publisherRevision) return listingRevision.slice(0, 200);
  return `listing:${listingRevision}|publisher:${publisherRevision}`.slice(0, 200);
}

function validFeatureDecision(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const decision = value as Partial<SourceWorkflowFeatureDecision>;
  if (typeof decision.enabled !== 'boolean'
    || typeof decision.legacyAllowed !== 'boolean'
    || !FEATURE_REASONS.has(decision.reason as SourceWorkflowFeatureDecision['reason'])) {
    return false;
  }
  if (SAFE_LEGACY_REASONS.has(decision.reason!)
    && (decision.enabled || !decision.legacyAllowed)) return false;
  if (FAIL_CLOSED_REASONS.has(decision.reason!)
    && (decision.enabled || decision.legacyAllowed)) return false;
  if (ACTIVE_REASONS.has(decision.reason!) && !decision.enabled) return false;
  return true;
}

function validReadiness(value: unknown): value is OzonPublisherEntrypointReadiness {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const readiness = value as Partial<OzonPublisherEntrypointReadiness>;
  return typeof readiness.ready === 'boolean'
    && exactRevision(readiness.rolloutRevision) !== null
    && Number.isSafeInteger(readiness.gateStateVersion)
    && Number(readiness.gateStateVersion) >= 0
    && (readiness.evidenceHash === null
      || (typeof readiness.evidenceHash === 'string' && EVIDENCE_HASH.test(readiness.evidenceHash)))
    && (!readiness.ready || typeof readiness.evidenceHash === 'string');
}

function stages(input: {
  writer: OzonPublisherEntrypointStage;
  origin: OzonPublisherEntrypointStage | null;
  writerEntrypoint: OzonPublisherWriterEntrypoint;
  originChannel: OzonPublisherOriginChannel;
}) {
  if (input.origin === null) {
    return {
      effectiveStage: input.writer,
      limitingBoundary: input.writerEntrypoint as OzonPublisherRolloutBoundary,
    };
  }
  if (STAGE_RANK[input.writer] < STAGE_RANK[input.origin]) {
    return {
      effectiveStage: input.writer,
      limitingBoundary: input.writerEntrypoint as OzonPublisherRolloutBoundary,
    };
  }
  if (STAGE_RANK[input.origin] < STAGE_RANK[input.writer]) {
    return {
      effectiveStage: input.origin,
      limitingBoundary: input.originChannel as Exclude<OzonPublisherOriginChannel, 'DIRECT'>,
    };
  }
  return { effectiveStage: input.writer, limitingBoundary: null };
}

function decision(input: {
  writerEntrypoint: OzonPublisherWriterEntrypoint | null;
  originChannel: OzonPublisherOriginChannel;
  writerStage?: OzonPublisherEntrypointStage | null;
  originStage?: OzonPublisherEntrypointStage | null;
  effectiveStage?: OzonPublisherEntrypointStage | null;
  authority: OzonPublisherEntrypointAuthority;
  observeParity?: boolean;
  limitingBoundary?: OzonPublisherRolloutBoundary | null;
  rolloutRevision: string;
  reason: OzonPublisherEntrypointRolloutReason;
  readiness?: OzonPublisherEntrypointReadiness | null;
}): OzonPublisherEntrypointRolloutDecision {
  return {
    writerEntrypoint: input.writerEntrypoint,
    originChannel: input.originChannel,
    configuredStages: {
      writer: input.writerStage ?? null,
      origin: input.originStage ?? null,
    },
    effectiveStage: input.effectiveStage ?? null,
    authority: input.authority,
    observeParity: input.observeParity === true,
    limitingBoundary: input.limitingBoundary ?? null,
    rolloutRevision: input.rolloutRevision,
    reason: input.reason,
    gateStateVersion: input.readiness?.gateStateVersion ?? null,
    evidenceHash: input.readiness?.evidenceHash ?? null,
  };
}

export function createOzonPublisherEntrypointRolloutService(options: {
  featureFlags: SourceWorkflowFeatureFlagEvaluator;
  loadStage?: LoadStage;
  loadReadiness?: LoadReadiness;
}): OzonPublisherEntrypointRolloutService {
  const loadStage = options.loadStage || loadStageFromSystemConfig;
  const loadReadiness = options.loadReadiness || (async () => null);

  return {
    async evaluateWrite({ writerEntrypoint, originChannel, context }) {
      if (writerEntrypoint === null) {
        return decision({
          writerEntrypoint,
          originChannel,
          authority: 'BLOCKED',
          rolloutRevision: 'unavailable',
          reason: 'writer_unavailable',
        });
      }
      if (originChannel === 'EXTENSION_ADAPTER') {
        return decision({
          writerEntrypoint,
          originChannel,
          authority: 'BLOCKED',
          rolloutRevision: 'unavailable',
          reason: 'origin_writer_unavailable',
        });
      }
      if (originChannel === 'BROWSER_ONE_CLICK'
        && writerEntrypoint !== 'COLLECT_PUBLISH_OZON') {
        return decision({
          writerEntrypoint,
          originChannel,
          authority: 'BLOCKED',
          rolloutRevision: 'unavailable',
          reason: 'origin_writer_mismatch',
        });
      }

      const originBoundary = originChannel === 'DIRECT' ? null : originChannel;
      const [writerStageResult, originStageResult] = await Promise.all([
        loadBoundaryStage(loadStage, writerEntrypoint),
        originBoundary === null
          ? Promise.resolve<StageLoadResult | null>(null)
          : loadBoundaryStage(loadStage, originBoundary),
      ]);
      if (!writerStageResult.ok) {
        return decision({
          writerEntrypoint,
          originChannel,
          originStage: originStageResult?.ok ? originStageResult.stage : null,
          authority: 'BLOCKED',
          limitingBoundary: writerEntrypoint,
          rolloutRevision: writerStageResult.reason === 'stage_config_invalid'
            ? 'invalid'
            : 'unavailable',
          reason: writerStageResult.reason,
        });
      }
      if (originStageResult && !originStageResult.ok) {
        return decision({
          writerEntrypoint,
          originChannel,
          writerStage: writerStageResult.stage,
          authority: 'BLOCKED',
          limitingBoundary: originBoundary,
          rolloutRevision: originStageResult.reason === 'stage_config_invalid'
            ? 'invalid'
            : 'unavailable',
          reason: originStageResult.reason,
        });
      }

      const writerStage = writerStageResult.stage;
      const originStage = originStageResult?.stage ?? null;
      const effective = stages({
        writer: writerStage,
        origin: originStage,
        writerEntrypoint,
        originChannel,
      });
      const base = {
        writerEntrypoint,
        originChannel,
        writerStage,
        originStage,
        effectiveStage: effective.effectiveStage,
        limitingBoundary: effective.limitingBoundary,
      };

      let listing: SourceWorkflowFeatureDecision;
      let publisher: SourceWorkflowFeatureDecision;
      try {
        [listing, publisher] = await Promise.all([
          options.featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', context),
          options.featureFlags.evaluate('SOURCE_OZON_PUBLISHER_V2', context),
        ]);
      } catch {
        return decision({
          ...base,
          authority: 'BLOCKED',
          rolloutRevision: 'unavailable',
          reason: 'feature_decision_unavailable',
        });
      }
      const fallbackRevision = combinedRevision(listing?.revision, publisher?.revision);
      if (!validFeatureDecision(listing) || !validFeatureDecision(publisher)) {
        return decision({
          ...base,
          authority: 'BLOCKED',
          rolloutRevision: fallbackRevision,
          reason: 'feature_decision_invalid',
        });
      }
      const unavailable = [listing, publisher].find(({ reason }) => FAIL_CLOSED_REASONS.has(reason));
      if (unavailable) {
        return decision({
          ...base,
          authority: 'BLOCKED',
          rolloutRevision: listing.revision,
          reason: unavailable.reason as Extract<
            OzonPublisherEntrypointRolloutReason,
            'policy_invalid' | 'context_invalid' | 'config_unavailable'
          >,
        });
      }
      const listingRevision = exactRevision(listing.revision);
      const publisherRevision = exactRevision(publisher.revision);
      if (!listingRevision || !publisherRevision) {
        return decision({
          ...base,
          authority: 'BLOCKED',
          rolloutRevision: fallbackRevision,
          reason: 'policy_revision_invalid',
        });
      }
      if (listingRevision !== publisherRevision) {
        return decision({
          ...base,
          authority: 'BLOCKED',
          rolloutRevision: fallbackRevision,
          reason: 'policy_revision_mismatch',
        });
      }
      const rolloutRevision = listingRevision;
      const inactive = [listing, publisher].find(({ reason }) => SAFE_LEGACY_REASONS.has(reason));
      if (inactive) {
        if (!listing.legacyAllowed || !publisher.legacyAllowed) {
          return decision({
            ...base,
            authority: 'BLOCKED',
            rolloutRevision,
            reason: 'publisher_capability_not_ready',
          });
        }
        return decision({
          ...base,
          authority: 'LEGACY',
          rolloutRevision,
          reason: inactive.reason as Extract<
            OzonPublisherEntrypointRolloutReason,
            'master_off' | 'policy_off' | 'pilot_miss'
          >,
        });
      }
      const capability = sourceListingPublisherCapability(listing, publisher);
      if (!capability.enabled && !capability.legacyAllowed) {
        return decision({
          ...base,
          authority: 'BLOCKED',
          rolloutRevision,
          reason: 'publisher_capability_not_ready',
        });
      }
      if (effective.effectiveStage === 'off') {
        return decision({
          ...base,
          authority: 'LEGACY',
          rolloutRevision,
          reason: 'effective_stage_off',
        });
      }
      if (effective.effectiveStage === 'shadow') {
        return decision({
          ...base,
          authority: 'LEGACY',
          observeParity: true,
          rolloutRevision,
          reason: 'shadow',
        });
      }

      if (!capability.enabled || capability.legacyAllowed || capability.revision !== rolloutRevision) {
        return decision({
          ...base,
          authority: 'BLOCKED',
          rolloutRevision,
          reason: 'publisher_capability_not_ready',
        });
      }

      let readiness: OzonPublisherEntrypointReadiness | null;
      try {
        readiness = await loadReadiness({ writerEntrypoint, originChannel, rolloutRevision });
      } catch {
        return decision({
          ...base,
          authority: 'BLOCKED',
          rolloutRevision,
          reason: 'readiness_unavailable',
        });
      }
      if (readiness === null) {
        return decision({
          ...base,
          authority: 'BLOCKED',
          rolloutRevision,
          reason: 'evidence_missing',
        });
      }
      if (!validReadiness(readiness)) {
        return decision({
          ...base,
          authority: 'BLOCKED',
          rolloutRevision,
          reason: 'readiness_invalid',
        });
      }
      if (readiness.rolloutRevision !== rolloutRevision) {
        return decision({
          ...base,
          authority: 'BLOCKED',
          rolloutRevision,
          reason: 'evidence_revision_mismatch',
          readiness,
        });
      }
      if (!readiness.ready) {
        return decision({
          ...base,
          authority: 'BLOCKED',
          rolloutRevision,
          reason: 'evidence_not_ready',
          readiness,
        });
      }
      return decision({
        ...base,
        authority: 'V2',
        rolloutRevision,
        reason: 'v2_ready',
        readiness,
      });
    },
  };
}

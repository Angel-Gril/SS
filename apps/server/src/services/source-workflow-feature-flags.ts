import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import type { SystemConfigKey } from '../config/system-config-schema.js';

export const SOURCE_WORKFLOW_FEATURES = [
  { name: 'SOURCE_CAPTURE_V2', configKey: 'feature_source_capture_v2' },
  { name: 'SOURCE_LISTING_WORKFLOW', configKey: 'feature_source_listing_workflow' },
  { name: 'SOURCE_OZON_MAPPING_V2_READ', configKey: 'feature_source_ozon_mapping_v2_read' },
  { name: 'SOURCE_OZON_MAPPING_V2_WRITE', configKey: 'feature_source_ozon_mapping_v2_write' },
  { name: 'SOURCE_OZON_PUBLISHER_V2', configKey: 'feature_source_ozon_publisher_v2' },
  { name: 'SOURCE_NETWORK_CAPTURE', configKey: 'feature_source_network_capture' },
  { name: 'AI_MEDIA_WORKFLOW_V2', configKey: 'feature_ai_media_workflow_v2' },
  { name: 'SOURCE_LISTING_WEB_MEDIA', configKey: 'feature_source_listing_web_media' },
  {
    name: 'SOURCE_LISTING_EXTENSION_WORKBENCH',
    configKey: 'feature_source_listing_extension_workbench',
  },
] as const;

export type SourceWorkflowFeature = typeof SOURCE_WORKFLOW_FEATURES[number]['name'];
export type SourceCaptureRolloutStage = 'off' | 'shadow_write' | 'dual_read' | 'v2_only';
export type SourceListingWorkflowRolloutStage = 'off' | 'shadow_write' | 'dual_read' | 'v2_only';

export interface SourceWorkflowFeatureContext {
  ownerUserId: string;
  shopId?: string | null;
  deviceSessionId?: string | null;
  platform?: string | null;
}

export interface SourceWorkflowFeatureDecision {
  enabled: boolean;
  legacyAllowed: boolean;
  captureStage: SourceCaptureRolloutStage | null;
  listingStage?: SourceListingWorkflowRolloutStage;
  reason:
    | 'master_off'
    | 'policy_off'
    | 'global'
    | 'pilot_match'
    | 'pilot_miss'
    | 'policy_invalid'
    | 'context_invalid'
    | 'config_unavailable';
  revision: string;
}

export interface SourceWorkflowFeatureFlagEvaluator {
  evaluate(
    feature: SourceWorkflowFeature,
    context: SourceWorkflowFeatureContext,
  ): Promise<SourceWorkflowFeatureDecision>;
}

export interface SourceListingPublisherCapabilityDecision {
  enabled: boolean;
  legacyAllowed: boolean;
  reason: string;
  revision: string;
}

function combinedPublisherRevision(
  listing: SourceWorkflowFeatureDecision,
  publisher: SourceWorkflowFeatureDecision,
): string {
  if (listing.revision === publisher.revision) return listing.revision;
  return `listing:${listing.revision}|publisher:${publisher.revision}`.slice(0, 200);
}

export function sourceListingPublisherCapability(
  listing: SourceWorkflowFeatureDecision,
  publisher: SourceWorkflowFeatureDecision,
): SourceListingPublisherCapabilityDecision {
  const revision = combinedPublisherRevision(listing, publisher);
  const unavailableReasons = new Set(['policy_invalid', 'context_invalid', 'config_unavailable']);
  const unavailableReason = [listing.reason, publisher.reason]
    .find((reason) => unavailableReasons.has(reason));
  if (listing.revision !== publisher.revision) {
    return { enabled: false, legacyAllowed: false, reason: 'policy_revision_mismatch', revision };
  }
  if (unavailableReason) {
    return { enabled: false, legacyAllowed: false, reason: unavailableReason, revision };
  }
  const enabled = listing.enabled
    && listing.listingStage === 'v2_only'
    && !listing.legacyAllowed
    && publisher.enabled
    && !publisher.legacyAllowed;
  if (enabled) {
    return { enabled: true, legacyAllowed: false, reason: publisher.reason, revision };
  }
  const legacyAllowed = listing.legacyAllowed && publisher.legacyAllowed;
  if (legacyAllowed) {
    return { enabled: false, legacyAllowed: true, reason: publisher.reason, revision };
  }
  const reason = listing.enabled && listing.listingStage !== 'v2_only'
    ? `listing_stage_${listing.listingStage || 'unavailable'}`
    : !listing.enabled ? listing.reason : publisher.reason;
  return { enabled: false, legacyAllowed: false, reason, revision };
}

export async function evaluateSourceListingPublisherCapability(
  featureFlags: SourceWorkflowFeatureFlagEvaluator,
  context: SourceWorkflowFeatureContext,
): Promise<SourceListingPublisherCapabilityDecision> {
  const [listing, publisher] = await Promise.all([
    featureFlags.evaluate('SOURCE_LISTING_WORKFLOW', context),
    featureFlags.evaluate('SOURCE_OZON_PUBLISHER_V2', context),
  ]);
  return sourceListingPublisherCapability(listing, publisher);
}

export class SourceWorkflowLegacyPublishError extends Error {
  readonly statusCode: 409 | 503;
  readonly code: 'source_ozon_publisher_v2_required' | 'source_workflow_rollout_unavailable';
  readonly decision: SourceListingPublisherCapabilityDecision;

  constructor(decision: SourceListingPublisherCapabilityDecision) {
    const rolloutUnavailable = !decision.enabled;
    super(rolloutUnavailable
      ? '来源商品发布策略暂不可用，请稍后重试'
      : '该店铺已启用来源商品发布 V2，旧发布路径已关闭');
    this.name = 'SourceWorkflowLegacyPublishError';
    this.statusCode = rolloutUnavailable ? 503 : 409;
    this.code = rolloutUnavailable
      ? 'source_workflow_rollout_unavailable'
      : 'source_ozon_publisher_v2_required';
    this.decision = decision;
  }
}

export async function assertLegacySourceOzonPublishAllowed(
  featureFlags: SourceWorkflowFeatureFlagEvaluator,
  context: SourceWorkflowFeatureContext,
): Promise<SourceListingPublisherCapabilityDecision> {
  const decision = await evaluateSourceListingPublisherCapability(featureFlags, context);
  if (!decision.legacyAllowed) throw new SourceWorkflowLegacyPublishError(decision);
  return decision;
}

const identifierList = z.array(z.string().trim().min(1).max(200)).min(1).max(1000).optional();
const platformList = z.array(z.string().trim().min(1).max(40))
  .min(1)
  .max(20)
  .transform((values) => values.map((value) => value.toUpperCase()))
  .optional();
const sourceCaptureStage = z.enum(['shadow_write', 'dual_read', 'v2_only']);
const sourceListingWorkflowStage = z.enum(['shadow_write', 'dual_read', 'v2_only']);
const rolloutRule = z.union([
  z.object({ mode: z.literal('off') }).strict(),
  z.object({
    mode: z.literal('global'),
    stage: sourceCaptureStage.optional(),
    listingStage: sourceListingWorkflowStage.optional(),
  }).strict(),
  z.object({
    mode: z.literal('pilot'),
    stage: sourceCaptureStage.optional(),
    listingStage: sourceListingWorkflowStage.optional(),
    ownerUserIds: identifierList,
    shopIds: identifierList,
    deviceSessionIds: identifierList,
    platforms: platformList,
  }).strict().refine(
    (rule) => Boolean(
      rule.ownerUserIds || rule.shopIds || rule.deviceSessionIds || rule.platforms,
    ),
    { message: 'pilot requires at least one allowlist dimension' },
  ),
]);

const rolloutPolicy = z.object({
  revision: z.string().trim().min(1).max(200),
  features: z.record(z.string(), rolloutRule),
}).strict();

interface SourceWorkflowConfigSnapshot {
  master: unknown;
  policy: unknown;
}

type LoadSnapshot = (featureKey: SystemConfigKey) => Promise<SourceWorkflowConfigSnapshot>;

async function loadConfigSnapshot(featureKey: SystemConfigKey): Promise<SourceWorkflowConfigSnapshot> {
  const rows = await prisma.systemConfig.findMany({
    where: { key: { in: [featureKey, 'source_workflow_rollout_policy'] } },
    select: { key: true, value: true },
  });
  const values = new Map(rows.map((row) => [row.key, row.value]));
  return {
    master: values.get(featureKey),
    policy: values.get('source_workflow_rollout_policy'),
  };
}

function parseMaster(raw: unknown): boolean | null {
  if (raw === undefined) return false;
  if (raw === true || raw === 'true') return true;
  if (raw === false || raw === 'false') return false;
  return null;
}

function normalized(value: string | null | undefined): string | null {
  const text = String(value || '').trim();
  return text || null;
}

function matches(configured: string[] | undefined, actual: string | null): boolean {
  return !configured || (actual !== null && configured.includes(actual));
}

function hasRequiredContext(
  feature: SourceWorkflowFeature,
  context: SourceWorkflowFeatureContext,
): boolean {
  if (!normalized(context.ownerUserId)) return false;
  if (feature === 'SOURCE_OZON_PUBLISHER_V2'
    || feature === 'SOURCE_LISTING_WORKFLOW'
    || feature === 'SOURCE_OZON_MAPPING_V2_READ'
    || feature === 'SOURCE_OZON_MAPPING_V2_WRITE') {
    return Boolean(normalized(context.shopId)) && normalized(context.platform)?.toUpperCase() === 'OZON';
  }
  if (feature === 'SOURCE_NETWORK_CAPTURE') return Boolean(normalized(context.platform));
  if (feature === 'SOURCE_LISTING_EXTENSION_WORKBENCH') {
    return Boolean(normalized(context.deviceSessionId));
  }
  return true;
}

function ruleAppliesToFeature(
  feature: SourceWorkflowFeature,
  rule: z.infer<typeof rolloutRule>,
): boolean {
  const hasCaptureStage = 'stage' in rule && rule.stage !== undefined;
  const hasListingStage = 'listingStage' in rule && rule.listingStage !== undefined;
  if (feature !== 'SOURCE_CAPTURE_V2' && hasCaptureStage) return false;
  if (feature !== 'SOURCE_LISTING_WORKFLOW' && hasListingStage) return false;
  if (rule.mode !== 'pilot') return true;
  if (feature === 'SOURCE_OZON_PUBLISHER_V2'
    || feature === 'SOURCE_LISTING_WORKFLOW'
    || feature === 'SOURCE_OZON_MAPPING_V2_READ'
    || feature === 'SOURCE_OZON_MAPPING_V2_WRITE') {
    return Boolean(rule.shopIds) && !rule.deviceSessionIds;
  }
  return true;
}

function disabledCaptureStage(feature: SourceWorkflowFeature): SourceCaptureRolloutStage | null {
  return feature === 'SOURCE_CAPTURE_V2' ? 'off' : null;
}

function enabledCaptureStage(
  feature: SourceWorkflowFeature,
  rule: z.infer<typeof rolloutRule>,
): SourceCaptureRolloutStage | null {
  if (feature !== 'SOURCE_CAPTURE_V2') return null;
  if (rule.mode === 'off') return 'off';
  return rule.stage || 'v2_only';
}

function listingStageDecision(
  feature: SourceWorkflowFeature,
  stage: SourceListingWorkflowRolloutStage,
): Pick<SourceWorkflowFeatureDecision, 'listingStage'> | Record<string, never> {
  return feature === 'SOURCE_LISTING_WORKFLOW' ? { listingStage: stage } : {};
}

function enabledListingStage(
  feature: SourceWorkflowFeature,
  rule: z.infer<typeof rolloutRule>,
): SourceListingWorkflowRolloutStage | null {
  if (feature !== 'SOURCE_LISTING_WORKFLOW') return null;
  if (rule.mode === 'off') return 'off';
  return rule.listingStage || 'v2_only';
}

export function createSourceWorkflowFeatureFlagEvaluator(options: {
  loadSnapshot?: LoadSnapshot;
} = {}): SourceWorkflowFeatureFlagEvaluator {
  const load = options.loadSnapshot || loadConfigSnapshot;

  return {
    async evaluate(
      feature: SourceWorkflowFeature,
      context: SourceWorkflowFeatureContext,
    ): Promise<SourceWorkflowFeatureDecision> {
      const definition = SOURCE_WORKFLOW_FEATURES.find(({ name }) => name === feature);
      if (!definition) throw new Error(`Unknown source workflow feature: ${feature}`);
      let snapshot: SourceWorkflowConfigSnapshot;
      try {
        snapshot = await load(definition.configKey);
      } catch {
        return {
          enabled: false,
          legacyAllowed: false,
          captureStage: null,
          reason: 'config_unavailable',
          revision: 'unavailable',
        };
      }
      const master = parseMaster(snapshot.master);
      if (master === null) {
        return {
          enabled: false,
          legacyAllowed: false,
          captureStage: null,
          reason: 'policy_invalid',
          revision: 'invalid',
        };
      }
      if (!master) {
        return {
          enabled: false,
          legacyAllowed: true,
          captureStage: disabledCaptureStage(feature),
          ...listingStageDecision(feature, 'off'),
          reason: 'master_off',
          revision: 'master-off',
        };
      }

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(typeof snapshot.policy === 'string' ? snapshot.policy : '');
      } catch {
        parsedJson = null;
      }
      const parsed = rolloutPolicy.safeParse(parsedJson);
      const rule = parsed.success ? parsed.data.features[feature] : undefined;
      if (!parsed.success || !rule || !ruleAppliesToFeature(feature, rule)) {
        return {
          enabled: false,
          legacyAllowed: false,
          captureStage: null,
          reason: 'policy_invalid',
          revision: 'invalid',
        };
      }
      if (!hasRequiredContext(feature, context)) {
        return {
          enabled: false,
          legacyAllowed: false,
          captureStage: null,
          reason: 'context_invalid',
          revision: parsed.data.revision,
        };
      }
      if (rule.mode === 'off') {
        return {
          enabled: false,
          legacyAllowed: true,
          captureStage: disabledCaptureStage(feature),
          ...listingStageDecision(feature, 'off'),
          reason: 'policy_off',
          revision: parsed.data.revision,
        };
      }
      if (rule.mode === 'global') {
        const captureStage = enabledCaptureStage(feature, rule);
        const listingStage = enabledListingStage(feature, rule);
        return {
          enabled: true,
          legacyAllowed: captureStage === 'shadow_write'
            || captureStage === 'dual_read'
            || listingStage === 'shadow_write'
            || listingStage === 'dual_read',
          captureStage,
          ...(listingStage ? listingStageDecision(feature, listingStage) : {}),
          reason: 'global',
          revision: parsed.data.revision,
        };
      }

      const pilotMatch = matches(rule.ownerUserIds, normalized(context.ownerUserId))
        && matches(rule.shopIds, normalized(context.shopId))
        && matches(rule.deviceSessionIds, normalized(context.deviceSessionId))
        && matches(rule.platforms, normalized(context.platform)?.toUpperCase() || null);
      const captureStage = pilotMatch
        ? enabledCaptureStage(feature, rule)
        : disabledCaptureStage(feature);
      const listingStage = pilotMatch
        ? enabledListingStage(feature, rule)
        : feature === 'SOURCE_LISTING_WORKFLOW' ? 'off' : null;
      return {
        enabled: pilotMatch,
        legacyAllowed: !pilotMatch
          || captureStage === 'shadow_write'
          || captureStage === 'dual_read'
          || listingStage === 'shadow_write'
          || listingStage === 'dual_read',
        captureStage,
        ...(listingStage ? listingStageDecision(feature, listingStage) : {}),
        reason: pilotMatch ? 'pilot_match' : 'pilot_miss',
        revision: parsed.data.revision,
      };
    },
  };
}

export const sourceWorkflowFeatureFlags = createSourceWorkflowFeatureFlagEvaluator();

import { createHash } from 'node:crypto';
import { getConfig } from '../config/system-config-schema.js';
import {
  getAiImageSuiteDispatchAuthorization,
} from './ai-image-suite-dispatch-authorization.js';
import type {
  ExtensionHostedAiImagePlanPolicyDecision,
} from './extension-hosted-ai-image-plan.js';
import { sourceWorkflowFeatureFlags } from './source-workflow-feature-flags.js';

const POLICY_REVISION_VERSION = 'extension-hosted-ai-image-policy/v1';
const EMPTY_IDENTITY = Object.freeze({
  ownerUserId: '',
  shopId: '',
  deviceSessionId: '',
});
const DISPATCH_REASON_CODES = new Set([
  'authorization_unavailable',
  'invalid_policy',
  'master_off',
  'source_web_media_off',
  'suite_off',
  'tenant_allowed',
  'tenant_not_allowed',
]);
const WORKBENCH_REASONS = new Set([
  'config_unavailable',
  'context_invalid',
  'global',
  'master_off',
  'pilot_match',
  'pilot_miss',
  'policy_invalid',
  'policy_off',
]);
const ENABLED_WORKBENCH_REASONS = new Set(['global', 'pilot_match']);

export interface ExtensionHostedAiImagePolicyIdentity {
  ownerUserId: string;
  shopId: string;
  deviceSessionId: string;
}

export interface ExtensionHostedAiImagePolicyDependencies {
  loadHostedFeatureEnabled(): Promise<unknown>;
  loadDispatchAuthorization(ownerUserId: string): Promise<unknown>;
  featureFlags: {
    evaluate(
      feature: 'SOURCE_LISTING_EXTENSION_WORKBENCH',
      context: ExtensionHostedAiImagePolicyIdentity,
    ): Promise<unknown>;
  };
}

interface ConstituentDecision {
  enabled: boolean;
  revisionPart: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function identifier(value: unknown): string | null {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 200
    || value !== value.trim()
    // eslint-disable-next-line no-control-regex
    || /[\u0000-\u001f\u007f]/u.test(value)) {
    return null;
  }
  return value;
}

function normalizeIdentity(value: unknown): ExtensionHostedAiImagePolicyIdentity | null {
  const candidate = record(value);
  const ownerUserId = identifier(candidate?.ownerUserId);
  const shopId = identifier(candidate?.shopId);
  const deviceSessionId = identifier(candidate?.deviceSessionId);
  return ownerUserId && shopId && deviceSessionId
    ? { ownerUserId, shopId, deviceSessionId }
    : null;
}

function policyRevision(parts: readonly string[]): number {
  const digest = createHash('sha256')
    .update(JSON.stringify([POLICY_REVISION_VERSION, ...parts]))
    .digest('hex');
  return Number.parseInt(digest.slice(0, 12), 16) + 1;
}

function decision(
  identity: ExtensionHostedAiImagePolicyIdentity,
  enabled: boolean,
  revisionParts: readonly string[],
): ExtensionHostedAiImagePlanPolicyDecision {
  return {
    enabled,
    revision: policyRevision(revisionParts),
    ...identity,
  };
}

function hostedFeatureDecision(
  result: PromiseSettledResult<unknown>,
): ConstituentDecision {
  if (result.status === 'rejected') {
    return { enabled: false, revisionPart: 'hosted:unavailable' };
  }
  if (result.value === true) return { enabled: true, revisionPart: 'hosted:on' };
  if (result.value === false) return { enabled: false, revisionPart: 'hosted:off' };
  return { enabled: false, revisionPart: 'hosted:invalid' };
}

function dispatchDecision(
  result: PromiseSettledResult<unknown>,
): ConstituentDecision {
  if (result.status === 'rejected') {
    return { enabled: false, revisionPart: 'dispatch:unavailable' };
  }
  const value = record(result.value);
  const enabled = value?.enabled;
  const reasonCode = value?.reasonCode;
  const reason = value?.reason;
  const validReasonCode = typeof reasonCode === 'string'
    && DISPATCH_REASON_CODES.has(reasonCode);
  const validReason = typeof reason === 'string'
    && reason.length > 0
    && reason.length <= 500;
  if (typeof enabled !== 'boolean' || !validReasonCode || !validReason
    || enabled !== (reasonCode === 'tenant_allowed')) {
    return { enabled: false, revisionPart: 'dispatch:invalid' };
  }
  return {
    enabled,
    revisionPart: `dispatch:${enabled ? 'on' : 'off'}:${reasonCode}`,
  };
}

function workbenchDecision(
  result: PromiseSettledResult<unknown>,
): ConstituentDecision {
  if (result.status === 'rejected') {
    return { enabled: false, revisionPart: 'workbench:unavailable' };
  }
  const value = record(result.value);
  const enabled = value?.enabled;
  const reason = value?.reason;
  const revision = value?.revision;
  const validRevision = typeof revision === 'string'
    && revision.length > 0
    && revision.length <= 200
    && revision === revision.trim()
    // eslint-disable-next-line no-control-regex
    && !/[\u0000-\u001f\u007f]/u.test(revision);
  const enabledForReason = typeof reason === 'string'
    && ENABLED_WORKBENCH_REASONS.has(reason);
  if (typeof enabled !== 'boolean'
    || typeof value?.legacyAllowed !== 'boolean'
    || typeof reason !== 'string'
    || !WORKBENCH_REASONS.has(reason)
    || !validRevision
    || enabled !== enabledForReason) {
    return { enabled: false, revisionPart: 'workbench:invalid' };
  }
  return {
    enabled,
    revisionPart: `workbench:${enabled ? 'on' : 'off'}:${reason}:${revision}`,
  };
}

export function createExtensionHostedAiImagePolicyEvaluator(
  overrides: Partial<ExtensionHostedAiImagePolicyDependencies> = {},
) {
  const dependencies: ExtensionHostedAiImagePolicyDependencies = {
    loadHostedFeatureEnabled: overrides.loadHostedFeatureEnabled
      || (() => getConfig('feature_extension_hosted_ai')),
    loadDispatchAuthorization: overrides.loadDispatchAuthorization
      || getAiImageSuiteDispatchAuthorization,
    featureFlags: overrides.featureFlags || sourceWorkflowFeatureFlags,
  };

  return async (
    input: ExtensionHostedAiImagePolicyIdentity,
  ): Promise<ExtensionHostedAiImagePlanPolicyDecision> => {
    try {
      const identity = normalizeIdentity(input);
      if (!identity) return decision(EMPTY_IDENTITY, false, ['identity:invalid']);
      const [hostedResult, dispatchResult, workbenchResult] = await Promise.allSettled([
        Promise.resolve().then(() => dependencies.loadHostedFeatureEnabled()),
        Promise.resolve().then(() => (
          dependencies.loadDispatchAuthorization(identity.ownerUserId)
        )),
        Promise.resolve().then(() => dependencies.featureFlags.evaluate(
          'SOURCE_LISTING_EXTENSION_WORKBENCH',
          identity,
        )),
      ]);
      const hosted = hostedFeatureDecision(hostedResult);
      const dispatch = dispatchDecision(dispatchResult);
      const workbench = workbenchDecision(workbenchResult);
      return decision(
        identity,
        hosted.enabled && dispatch.enabled && workbench.enabled,
        [hosted.revisionPart, dispatch.revisionPart, workbench.revisionPart],
      );
    } catch {
      return decision(EMPTY_IDENTITY, false, ['evaluation:unavailable']);
    }
  };
}

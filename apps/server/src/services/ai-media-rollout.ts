import { getConfig } from '../config/system-config-schema.js';

export interface AiMediaRolloutPolicy {
  revision: number;
  tenantIds: string[];
}

export interface AiMediaRolloutDecision {
  enabled: boolean;
  revision: number;
  reason: 'master_off' | 'tenant_allowed' | 'tenant_not_allowed' | 'invalid_policy';
}

export function parseAiMediaRolloutPolicy(raw: string): AiMediaRolloutPolicy {
  const value = JSON.parse(raw) as { revision?: unknown; tenantIds?: unknown };
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.tenantIds)) {
    throw new Error('Invalid AI media rollout policy');
  }
  if (value.tenantIds.some((entry) => typeof entry !== 'string')) {
    throw new Error('Invalid AI media rollout tenant IDs');
  }
  const tenantIds = [...new Set(value.tenantIds.map((entry) => entry.trim()).filter(Boolean))];
  if (tenantIds.length !== value.tenantIds.length) throw new Error('Invalid AI media rollout tenant IDs');
  return { revision: Number(value.revision), tenantIds };
}

export async function getAiMediaRolloutDecision(
  ownerUserId: string,
  loadConfig: typeof getConfig = getConfig,
): Promise<AiMediaRolloutDecision> {
  const [masterEnabled, rawPolicy] = await Promise.all([
    loadConfig('feature_ai_media_workflow_v2'),
    loadConfig('ai_media_workflow_v2_rollout_policy'),
  ]);
  if (!masterEnabled) return { enabled: false, revision: 0, reason: 'master_off' };
  try {
    const policy = parseAiMediaRolloutPolicy(String(rawPolicy));
    return policy.tenantIds.includes(ownerUserId)
      ? { enabled: true, revision: policy.revision, reason: 'tenant_allowed' }
      : { enabled: false, revision: policy.revision, reason: 'tenant_not_allowed' };
  } catch {
    return { enabled: false, revision: 0, reason: 'invalid_policy' };
  }
}

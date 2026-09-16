import { getConfig } from '../config/system-config-schema.js';

export interface AiMediaRolloutPolicy {
  revision: number;
  tenantIds: string[];
  mode?: 'allowlist' | 'all';
}

export interface AiMediaRolloutDecision {
  enabled: boolean;
  revision: number;
  reason: 'master_off' | 'tenant_allowed' | 'all_tenants' | 'tenant_not_allowed' | 'invalid_policy';
}

export function parseAiMediaRolloutPolicy(raw: string): AiMediaRolloutPolicy {
  const value = JSON.parse(raw) as { revision?: unknown; tenantIds?: unknown; mode?: unknown };
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0 || !Array.isArray(value.tenantIds)) {
    throw new Error('Invalid AI media rollout policy');
  }
  if (value.tenantIds.some((entry) => typeof entry !== 'string')) {
    throw new Error('Invalid AI media rollout tenant IDs');
  }
  const tenantIds = [...new Set(value.tenantIds.map((entry) => entry.trim()).filter(Boolean))];
  if (tenantIds.length !== value.tenantIds.length) throw new Error('Invalid AI media rollout tenant IDs');
  if (value.mode !== undefined && value.mode !== 'allowlist' && value.mode !== 'all') {
    throw new Error('Invalid AI media rollout mode');
  }
  if (value.mode === 'all' && tenantIds.length) throw new Error('Global AI media rollout must not contain an allowlist');
  return { revision: Number(value.revision), tenantIds, ...(value.mode === undefined ? {} : { mode: value.mode }) };
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
    if (policy.mode === 'all' && ownerUserId.trim() && ownerUserId === ownerUserId.trim()) {
      return { enabled: true, revision: policy.revision, reason: 'all_tenants' };
    }
    return policy.tenantIds.includes(ownerUserId)
      ? { enabled: true, revision: policy.revision, reason: 'tenant_allowed' }
      : { enabled: false, revision: policy.revision, reason: 'tenant_not_allowed' };
  } catch {
    return { enabled: false, revision: 0, reason: 'invalid_policy' };
  }
}

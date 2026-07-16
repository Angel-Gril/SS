import { describe, expect, it } from 'vitest';
import { getAiMediaRolloutDecision, parseAiMediaRolloutPolicy } from '../services/ai-media-rollout.js';

describe('AI media tenant rollout', () => {
  it('requires both the master switch and an explicit tenant allowlist entry', async () => {
    const config = new Map<string, unknown>([
      ['feature_ai_media_workflow_v2', true],
      ['ai_media_workflow_v2_rollout_policy', '{"revision":7,"tenantIds":["owner-1"]}'],
    ]);
    const load = async (key: string) => config.get(key) as never;

    await expect(getAiMediaRolloutDecision('owner-1', load as never)).resolves.toEqual({
      enabled: true, revision: 7, reason: 'tenant_allowed',
    });
    await expect(getAiMediaRolloutDecision('owner-2', load as never)).resolves.toEqual({
      enabled: false, revision: 7, reason: 'tenant_not_allowed',
    });
    config.set('feature_ai_media_workflow_v2', false);
    await expect(getAiMediaRolloutDecision('owner-1', load as never)).resolves.toMatchObject({
      enabled: false, reason: 'master_off',
    });
  });

  it('fails closed for malformed or duplicate tenant evidence', async () => {
    expect(() => parseAiMediaRolloutPolicy('{"revision":1,"tenantIds":["owner-1","owner-1"]}')).toThrow();
    expect(() => parseAiMediaRolloutPolicy('{"revision":1,"tenantIds":[123]}')).toThrow();
    const load = async (key: string) => (key === 'feature_ai_media_workflow_v2' ? true : '{bad json') as never;
    await expect(getAiMediaRolloutDecision('owner-1', load as never)).resolves.toMatchObject({
      enabled: false, reason: 'invalid_policy',
    });
  });
});

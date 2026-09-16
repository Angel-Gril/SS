import { describe, expect, it } from 'vitest';
import { getAiMediaRolloutDecision, parseAiMediaRolloutPolicy } from '../services/ai-media-rollout.js';

describe('AI media tenant rollout', () => {
  it('enables authenticated tenants only through an explicit all mode, with the master switch retained', async () => {
    let enabled = true;
    const load = async (key: string) => (key === 'feature_ai_media_workflow_v2'
      ? enabled : '{"revision":8,"mode":"all","tenantIds":[]}') as never;
    await expect(getAiMediaRolloutDecision('owner-new', load as never)).resolves.toEqual({
      enabled: true, revision: 8, reason: 'all_tenants',
    });
    for (const owner of ['', ' ', ' owner ']) {
      await expect(getAiMediaRolloutDecision(owner, load as never)).resolves.toMatchObject({ enabled: false });
    }
    enabled = false;
    await expect(getAiMediaRolloutDecision('owner-new', load as never)).resolves.toMatchObject({ enabled: false, reason: 'master_off' });
  });

  it('keeps empty legacy and explicit allowlists closed rather than interpreting them as global', async () => {
    for (const policy of [
      '{"revision":8,"tenantIds":[]}',
      '{"revision":8,"mode":"allowlist","tenantIds":[]}',
    ]) {
      const load = async (key: string) => (key === 'feature_ai_media_workflow_v2' ? true : policy) as never;
      await expect(getAiMediaRolloutDecision('owner-new', load as never)).resolves.toMatchObject({ enabled: false, reason: 'tenant_not_allowed' });
    }
  });

  it.each([
    '{"revision":8,"mode":"ALL","tenantIds":[]}',
    '{"revision":8,"mode":true,"tenantIds":[]}',
    '{"revision":8,"mode":"all","tenantIds":["owner-1"]}',
  ])('rejects malformed or ambiguous global policy %s', (raw) => {
    expect(() => parseAiMediaRolloutPolicy(raw)).toThrow();
  });

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

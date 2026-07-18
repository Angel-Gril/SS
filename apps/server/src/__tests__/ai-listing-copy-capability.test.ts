import { describe, expect, it, vi } from 'vitest';

import { getConfig } from '../config/system-config-schema.js';
import { getAiListingCopyCapability } from '../services/ai-listing-copy-capability.js';

function loader(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    feature_ai_media_workflow_v2: true,
    ai_media_workflow_v2_rollout_policy: JSON.stringify({ revision: 4, tenantIds: ['owner-1'] }),
    feature_ai_listing_copy_generation: true,
    ai_product_generation_enabled: true,
    ai_provider: 'custom',
    ai_base_url: 'https://provider.example/v1',
    ai_api_key: 'secret',
    ai_model: 'model-v1',
    ai_product_title_model: '',
    ai_product_description_model: '',
    ...overrides,
  };
  return vi.fn(async (key: string) => values[key]) as unknown as typeof getConfig;
}

describe('AI listing copy capability', () => {
  it('fails closed behind the media rollout and dedicated copy switch', async () => {
    await expect(getAiListingCopyCapability('owner-1', loader({
      feature_ai_media_workflow_v2: false,
    }))).resolves.toEqual({ enabled: false, revision: 0, reason: 'master_off' });
    await expect(getAiListingCopyCapability('owner-2', loader())).resolves.toEqual({
      enabled: false, revision: 4, reason: 'tenant_not_allowed',
    });
    await expect(getAiListingCopyCapability('owner-1', loader({
      feature_ai_listing_copy_generation: false,
    }))).resolves.toEqual({ enabled: false, revision: 4, reason: 'listing_copy_off' });
  });

  it('reports provider readiness without exposing provider configuration', async () => {
    await expect(getAiListingCopyCapability('owner-1', loader({ ai_api_key: '' }))).resolves.toEqual({
      enabled: false, revision: 4, reason: 'provider_not_ready',
    });
    const ready = await getAiListingCopyCapability('owner-1', loader());
    expect(ready).toEqual({ enabled: true, revision: 4, reason: 'tenant_allowed' });
    expect(JSON.stringify(ready)).not.toContain('secret');
    expect(JSON.stringify(ready)).not.toContain('provider.example');
  });
});

import { getConfig } from '../config/system-config-schema.js';
import { getAiMediaRolloutDecision } from './ai-media-rollout.js';

export interface AiListingCopyCapability {
  enabled: boolean;
  revision: number;
  reason:
    | 'master_off'
    | 'tenant_not_allowed'
    | 'invalid_policy'
    | 'listing_copy_off'
    | 'provider_not_ready'
    | 'tenant_allowed';
}

export async function getAiListingCopyCapability(
  ownerUserId: string,
  loadConfig: typeof getConfig = getConfig,
): Promise<AiListingCopyCapability> {
  const [media, copyEnabled, productEnabled, provider, baseUrl, apiKey, model, titleModel, descriptionModel] = await Promise.all([
    getAiMediaRolloutDecision(ownerUserId, loadConfig),
    loadConfig('feature_ai_listing_copy_generation'),
    loadConfig('ai_product_generation_enabled'),
    loadConfig('ai_provider'),
    loadConfig('ai_base_url'),
    loadConfig('ai_api_key'),
    loadConfig('ai_model'),
    loadConfig('ai_product_title_model'),
    loadConfig('ai_product_description_model'),
  ]);
  if (!media.enabled) {
    return {
      enabled: false,
      revision: media.revision,
      reason: media.reason === 'tenant_not_allowed'
        ? 'tenant_not_allowed'
        : media.reason === 'invalid_policy'
          ? 'invalid_policy'
          : 'master_off',
    };
  }
  if (!copyEnabled) {
    return { enabled: false, revision: media.revision, reason: 'listing_copy_off' };
  }
  const baseModel = String(model || '').trim();
  const providerReady = productEnabled
    && provider === 'custom'
    && Boolean(String(baseUrl || '').trim())
    && Boolean(String(apiKey || '').trim())
    && Boolean(String(titleModel || '').trim() || baseModel)
    && Boolean(String(descriptionModel || '').trim() || baseModel);
  if (!providerReady) {
    return { enabled: false, revision: media.revision, reason: 'provider_not_ready' };
  }
  return { enabled: true, revision: media.revision, reason: 'tenant_allowed' };
}

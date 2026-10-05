import { getConfig } from '../config/system-config-schema.js';
import type { AiTextConfig } from './ai-text.js';
import { getAiMediaRolloutDecision } from './ai-media-rollout.js';
import { normalizePublicSourceUrl } from './source-public-image-download.js';

export async function getProductVisionCapability(
  ownerUserId: string,
  loadConfig: typeof getConfig = getConfig,
): Promise<{
  available: boolean;
  reasonCode: string;
  config?: AiTextConfig;
  dailyLimit: number;
}> {
  const enabled = await loadConfig('feature_extension_product_vision');
  if (!enabled) return { available: false, reasonCode: 'VISION_OFF', dailyLimit: 0 };
  const rollout = await getAiMediaRolloutDecision(ownerUserId, loadConfig);
  if (!rollout.enabled) return { available: false, reasonCode: 'TENANT_DENIED', dailyLimit: 0 };
  const [provider, baseUrl, apiKey, model, dailyLimit, timeoutMs, providerLabel] =
    await Promise.all([
      loadConfig('ai_product_vision_provider'),
      loadConfig('ai_product_vision_base_url'),
      loadConfig('ai_product_vision_api_key'),
      loadConfig('ai_product_vision_model'),
      loadConfig('ai_user_daily_product_vision_limit'),
      loadConfig('ai_timeout_ms'),
      loadConfig('ai_provider_label'),
    ]);
  if (provider !== 'custom' || !baseUrl || !apiKey || !model) {
    return { available: false, reasonCode: 'PROVIDER_NOT_READY', dailyLimit: 0 };
  }
  try {
    if (/[?#]/u.test(baseUrl)) throw new Error();
    const endpoint = normalizePublicSourceUrl(baseUrl);
    if (endpoint.protocol !== 'https:' || (endpoint.port && endpoint.port !== '443'))
      throw new Error();
  } catch {
    return { available: false, reasonCode: 'PROVIDER_NOT_READY', dailyLimit: 0 };
  }
  if (!Number.isSafeInteger(dailyLimit) || dailyLimit < 1)
    return { available: false, reasonCode: 'QUOTA_DISABLED', dailyLimit: 0 };
  return {
    available: true,
    reasonCode: 'READY',
    dailyLimit,
    config: { provider, baseUrl, apiKey, model, timeoutMs, providerLabel },
  };
}

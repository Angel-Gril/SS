import { getConfig } from '../config/system-config-schema.js';
import { getAiMediaRolloutDecision } from './ai-media-rollout.js';
import { sourceWorkflowFeatureFlags } from './source-workflow-feature-flags.js';

export interface AiImageSuiteDispatchAuthorization {
  enabled: boolean;
  reasonCode: string;
  reason: string;
}

interface Dependencies {
  loadGenerationEnabled?: () => Promise<boolean>;
  loadSuiteEnabled?: () => Promise<boolean>;
  loadRollout?: typeof getAiMediaRolloutDecision;
  loadWebMediaEnabled?: (ownerUserId: string) => Promise<boolean>;
}

export async function getAiImageSuiteDispatchAuthorization(
  ownerUserId: string,
  dependencies: Dependencies = {},
): Promise<AiImageSuiteDispatchAuthorization> {
  try {
    const [generationEnabled, suiteEnabled, rollout, webMediaEnabled] = await Promise.all([
      (dependencies.loadGenerationEnabled || (() => getConfig('ai_image_generation_enabled')))(),
      (dependencies.loadSuiteEnabled || (() => getConfig('feature_ai_media_suite')))(),
      (dependencies.loadRollout || getAiMediaRolloutDecision)(ownerUserId),
      (dependencies.loadWebMediaEnabled || (async (ownerId: string) => (
        await sourceWorkflowFeatureFlags.evaluate('SOURCE_LISTING_WEB_MEDIA', { ownerUserId: ownerId })
      ).enabled))(ownerUserId),
    ]);
    if (!generationEnabled) {
      return {
        enabled: false,
        reasonCode: 'master_off',
        reason: 'AI image generation was disabled before suite Provider dispatch',
      };
    }
    if (!suiteEnabled) {
      return {
        enabled: false,
        reasonCode: 'suite_off',
        reason: 'AI image suite generation was disabled before Provider dispatch',
      };
    }
    if (!rollout.enabled) {
      return {
        enabled: false,
        reasonCode: rollout.reason,
        reason: 'AI media rollout was revoked before suite Provider dispatch',
      };
    }
    if (!webMediaEnabled) {
      return {
        enabled: false,
        reasonCode: 'source_web_media_off',
        reason: 'Source listing web media access was revoked before Provider dispatch',
      };
    }
    return {
      enabled: true,
      reasonCode: rollout.reason,
      reason: 'AI image suite dispatch is authorized',
    };
  } catch {
    return {
      enabled: false,
      reasonCode: 'authorization_unavailable',
      reason: 'AI image suite dispatch authorization is unavailable',
    };
  }
}

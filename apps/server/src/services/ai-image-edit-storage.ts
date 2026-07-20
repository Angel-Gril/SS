import type { RuntimeConfig } from '../adapters/runtime-config.js';

export interface AiImageEditStorageReadiness {
  ready: boolean;
  reason: string;
  backend?: RuntimeConfig['imageStorage'];
}

export function resolveAiImageEditStorageReadiness(
  config: Pick<RuntimeConfig, 'imageStorage' | 'oss'>,
): AiImageEditStorageReadiness {
  if (config.imageStorage === 'local') {
    return {
      ready: true,
      backend: 'local',
      reason: 'Local AI image edit storage is available for fake/sandbox execution',
    };
  }
  if (config.imageStorage === 'oss') {
    if (!config.oss) {
      return {
        ready: false,
        backend: 'oss',
        reason: 'AI image edit object storage is not fully configured',
      };
    }
    return {
      ready: true,
      backend: 'oss',
      reason: 'Owned OSS AI image edit storage is ready',
    };
  }
  return {
    ready: false,
    backend: config.imageStorage,
    reason: 'AI image edit requires owned local or OSS storage',
  };
}

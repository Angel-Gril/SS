export type RuntimeMode = 'local' | 'cloud';

export function getRuntimeMode(): RuntimeMode {
  const mode = process.env.RUNTIME_MODE || 'local';
  if (mode === 'cloud') return 'cloud';
  return 'local';
}

export interface RuntimeConfig {
  mode: RuntimeMode;
  imageStorage: 'local' | 'oss' | 'ozon-cdn';
  authSource: 'cookie' | 'token';
  extensionSync: 'direct' | 'queue';
}

function getCloudImageStorage(): RuntimeConfig['imageStorage'] {
  const backend = process.env.IMAGE_STORAGE_BACKEND;
  if (backend === 'local' || backend === 'oss' || backend === 'ozon-cdn') return backend;
  return 'oss';
}

export function getRuntimeConfig(): RuntimeConfig {
  const mode = getRuntimeMode();

  if (mode === 'cloud') {
    return {
      mode: 'cloud',
      imageStorage: getCloudImageStorage(),
      authSource: 'token',
      extensionSync: 'queue',
    };
  }

  return {
    mode: 'local',
    imageStorage: 'local',
    authSource: 'cookie',
    extensionSync: 'direct',
  };
}

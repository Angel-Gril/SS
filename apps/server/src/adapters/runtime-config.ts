export type RuntimeMode = 'local' | 'cloud';

export function getRuntimeMode(): RuntimeMode {
  const mode = process.env.RUNTIME_MODE || 'local';
  if (mode === 'cloud') return 'cloud';
  return 'local';
}

export interface OssEnvConfig {
  endpoint: string;
  bucket: string;
  accessKeyId: string;
  accessKeySecret: string;
  region: string;
  cdnDomain?: string;
}

export interface RuntimeConfig {
  mode: RuntimeMode;
  imageStorage: 'local' | 'oss' | 'ozon-cdn';
  authSource: 'cookie' | 'token';
  extensionSync: 'direct' | 'queue';
  oss: OssEnvConfig | null;
  ozonCdnRelayUrl: string | undefined;
  ossFallbackToCdn: boolean;
  localBaseUrl: string;
}

function getImageStorage(): RuntimeConfig['imageStorage'] {
  const backend = process.env.IMAGE_STORAGE_BACKEND;
  if (backend === 'local' || backend === 'oss' || backend === 'ozon-cdn') return backend;
  const mode = getRuntimeMode();
  return mode === 'cloud' ? 'oss' : 'local';
}

function getOssConfig(): OssEnvConfig | null {
  const endpoint = process.env.OSS_ENDPOINT;
  const bucket = process.env.OSS_BUCKET;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  if (!endpoint || !bucket || !accessKeyId || !accessKeySecret) return null;
  return {
    endpoint,
    bucket,
    accessKeyId,
    accessKeySecret,
    region: process.env.OSS_REGION || 'auto',
    cdnDomain: process.env.OSS_CDN_DOMAIN || undefined,
  };
}

export function getRuntimeConfig(): RuntimeConfig {
  const mode = getRuntimeMode();
  return {
    mode,
    imageStorage: getImageStorage(),
    authSource: mode === 'cloud' ? 'token' : 'cookie',
    extensionSync: mode === 'cloud' ? 'queue' : 'direct',
    oss: getOssConfig(),
    ozonCdnRelayUrl: process.env.OZON_CDN_RELAY_URL || undefined,
    ossFallbackToCdn: process.env.OSS_FALLBACK_TO_CDN !== 'false',
    localBaseUrl: process.env.LOCAL_BASE_URL || 'http://localhost:3001',
  };
}

export function requiresAuthChallenges(): boolean {
  return getRuntimeMode() === 'cloud';
}

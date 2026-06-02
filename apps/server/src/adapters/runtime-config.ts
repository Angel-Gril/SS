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
  source: 'env' | 'system-config';
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

function getDefaultLocalBaseUrl(mode: RuntimeMode): string {
  const explicit = process.env.LOCAL_BASE_URL || process.env.PUBLIC_API_BASE_URL || process.env.NEXT_PUBLIC_API_BASE_URL;
  if (explicit) return explicit;
  if (mode === 'cloud') {
    const userHostname = process.env.NEXT_PUBLIC_USER_HOSTNAME || 'app.ss-erp.com';
    return `https://${userHostname}`;
  }
  return 'http://localhost:3001';
}

export function getRuntimeConfig(): RuntimeConfig {
  const mode = getRuntimeMode();
  return {
    source: 'env',
    mode,
    imageStorage: getImageStorage(),
    authSource: mode === 'cloud' ? 'token' : 'cookie',
    extensionSync: mode === 'cloud' ? 'queue' : 'direct',
    oss: getOssConfig(),
    ozonCdnRelayUrl: process.env.OZON_CDN_RELAY_URL || undefined,
    ossFallbackToCdn: process.env.OSS_FALLBACK_TO_CDN !== 'false',
    localBaseUrl: getDefaultLocalBaseUrl(mode),
  };
}

function normalizeStorageBackend(value: string | undefined): RuntimeConfig['imageStorage'] | null {
  if (value === 'local' || value === 'oss' || value === 'ozon-cdn') return value;
  return null;
}

function hasOssConfig(oss: OssEnvConfig | null): oss is OssEnvConfig {
  return !!(oss?.endpoint && oss.bucket && oss.accessKeyId && oss.accessKeySecret);
}

export async function getRuntimeConfigForStorage(): Promise<RuntimeConfig> {
  const envConfig = getRuntimeConfig();

  try {
    const { getConfig } = await import('../config/system-config-schema.js');
    const [
      configuredBackend,
      endpoint,
      bucket,
      accessKeyId,
      accessKeySecret,
      region,
      cdnDomain,
      ozonRelayUrl,
      localBaseUrl,
    ] = await Promise.all([
      getConfig('upload_storage_backend'),
      getConfig('upload_oss_endpoint'),
      getConfig('upload_oss_bucket'),
      getConfig('upload_oss_access_key_id'),
      getConfig('upload_oss_access_key_secret'),
      getConfig('upload_oss_region'),
      getConfig('upload_oss_cdn_domain'),
      getConfig('upload_ozon_cdn_relay_url'),
      getConfig('upload_local_base_url'),
    ]);

    const dbOss = endpoint && bucket && accessKeyId && accessKeySecret
      ? {
          endpoint,
          bucket,
          accessKeyId,
          accessKeySecret,
          region: region || 'auto',
          cdnDomain: cdnDomain || undefined,
        }
      : null;

    const selectedBackend = normalizeStorageBackend(configuredBackend === 'env' ? undefined : configuredBackend)
      || (hasOssConfig(dbOss) ? 'oss' : envConfig.imageStorage);

    return {
      ...envConfig,
      source: configuredBackend !== 'env' || hasOssConfig(dbOss) ? 'system-config' : 'env',
      imageStorage: selectedBackend,
      oss: hasOssConfig(dbOss) ? dbOss : envConfig.oss,
      ozonCdnRelayUrl: ozonRelayUrl || envConfig.ozonCdnRelayUrl,
      localBaseUrl: localBaseUrl || envConfig.localBaseUrl,
    };
  } catch (error: any) {
    console.warn(`[runtime-config] failed to load upload SystemConfig, using env: ${error?.message || error}`);
    return envConfig;
  }
}

export function requiresAuthChallenges(): boolean {
  return getRuntimeMode() === 'cloud';
}

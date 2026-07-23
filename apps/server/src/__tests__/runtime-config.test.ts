import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeConfig, getRuntimeConfigForStorage, getRuntimeMode, requiresAuthChallenges } from '../adapters/runtime-config.js';

describe('runtime config', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('defaults to local mode for offline builds', () => {
    vi.stubEnv('RUNTIME_MODE', '');

    expect(getRuntimeMode()).toBe('local');
    expect(getRuntimeConfig()).toMatchObject({
      mode: 'local',
      imageStorage: 'local',
      authSource: 'cookie',
      extensionSync: 'direct',
    });
    expect(requiresAuthChallenges()).toBe(false);
  });

  it('enables cloud capabilities when RUNTIME_MODE=cloud', () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('NEXT_PUBLIC_USER_HOSTNAME', '');
    vi.stubEnv('LOCAL_BASE_URL', '');
    vi.stubEnv('PUBLIC_API_BASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');

    expect(getRuntimeConfig()).toMatchObject({
      mode: 'cloud',
      imageStorage: 'oss',
      authSource: 'token',
      extensionSync: 'queue',
      localBaseUrl: 'https://app.ss-erp.com',
    });
    expect(requiresAuthChallenges()).toBe(true);
  });

  it('uses configured user hostname as cloud upload proxy base url', () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('NEXT_PUBLIC_USER_HOSTNAME', 'app.example.com');
    vi.stubEnv('LOCAL_BASE_URL', '');
    vi.stubEnv('PUBLIC_API_BASE_URL', '');
    vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');

    expect(getRuntimeConfig().localBaseUrl).toBe('https://app.example.com');
  });

  it('accepts only known cloud image storage backends', () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('IMAGE_STORAGE_BACKEND', 'ozon-cdn');
    expect(getRuntimeConfig().imageStorage).toBe('ozon-cdn');

    vi.stubEnv('IMAGE_STORAGE_BACKEND', 'invalid');
    expect(getRuntimeConfig().imageStorage).toBe('oss');
  });

  it('reads image storage integration settings from environment variables', () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('IMAGE_STORAGE_BACKEND', 'oss');
    vi.stubEnv('OSS_ENDPOINT', 'https://oss.example.com');
    vi.stubEnv('OSS_BUCKET', 'ss-erp-assets');
    vi.stubEnv('OSS_ACCESS_KEY_ID', 'ak');
    vi.stubEnv('OSS_ACCESS_KEY_SECRET', 'sk');
    vi.stubEnv('OSS_REGION', 'auto');
    vi.stubEnv('OSS_CDN_DOMAIN', 'https://assets.example.com');
    vi.stubEnv('OZON_CDN_RELAY_URL', 'https://relay.example.com');
    vi.stubEnv('OSS_FALLBACK_TO_CDN', 'false');
    vi.stubEnv('LOCAL_BASE_URL', 'https://app.example.com');

    expect(getRuntimeConfig()).toMatchObject({
      mode: 'cloud',
      imageStorage: 'oss',
      oss: {
        endpoint: 'https://oss.example.com',
        bucket: 'ss-erp-assets',
        accessKeyId: 'ak',
        accessKeySecret: 'sk',
        region: 'auto',
        cdnDomain: 'https://assets.example.com',
      },
      ozonCdnRelayUrl: 'https://relay.example.com',
      ossFallbackToCdn: false,
      localBaseUrl: 'https://app.example.com',
    });
  });

  it('lets SystemConfig upload settings override env image storage for uploads', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('IMAGE_STORAGE_BACKEND', 'ozon-cdn');

    vi.doMock('../config/system-config-schema.js', () => ({
      getConfig: async (key: string) => {
        const values: Record<string, string> = {
          upload_storage_backend: 'oss',
          upload_oss_endpoint: 'https://r2.example.com',
          upload_oss_bucket: 'assets',
          upload_oss_access_key_id: 'ak',
          upload_oss_access_key_secret: 'sk',
          upload_oss_region: 'auto',
          upload_oss_cdn_domain: '',
          upload_ozon_cdn_relay_url: '',
          upload_local_base_url: '',
        };
        return values[key] ?? '';
      },
    }));

    const config = await getRuntimeConfigForStorage();

    expect(config.source).toBe('system-config');
    expect(config.imageStorage).toBe('oss');
    expect(config.oss).toMatchObject({
      endpoint: 'https://r2.example.com',
      bucket: 'assets',
      accessKeyId: 'ak',
      accessKeySecret: 'sk',
      region: 'auto',
    });

    vi.doUnmock('../config/system-config-schema.js');
  });

  it('reports mixed provenance for a database backend using environment OSS credentials', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('IMAGE_STORAGE_BACKEND', 'oss');
    vi.stubEnv('OSS_ENDPOINT', 'https://oss.example.com');
    vi.stubEnv('OSS_BUCKET', 'env-assets');
    vi.stubEnv('OSS_ACCESS_KEY_ID', 'env-ak');
    vi.stubEnv('OSS_ACCESS_KEY_SECRET', 'env-sk');

    vi.doMock('../config/system-config-schema.js', () => ({
      getConfig: async (key: string) => {
        const values: Record<string, string> = {
          upload_storage_backend: 'oss',
          upload_oss_endpoint: 'https://incomplete-db.example.com',
          upload_oss_bucket: '',
          upload_oss_access_key_id: '',
          upload_oss_access_key_secret: '',
          upload_oss_region: 'auto',
          upload_oss_cdn_domain: '',
          upload_ozon_cdn_relay_url: '',
          upload_local_base_url: '',
        };
        return values[key] ?? '';
      },
    }));

    const config = await getRuntimeConfigForStorage();

    expect(config.source).toBe('mixed');
    expect(config.oss).toMatchObject({
      endpoint: 'https://oss.example.com',
      bucket: 'env-assets',
    });

    vi.doUnmock('../config/system-config-schema.js');
  });

  it('ignores partial database OSS fields when both backend and effective tuple come from env', async () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('IMAGE_STORAGE_BACKEND', 'oss');
    vi.stubEnv('OSS_ENDPOINT', 'https://oss.example.com');
    vi.stubEnv('OSS_BUCKET', 'env-assets');
    vi.stubEnv('OSS_ACCESS_KEY_ID', 'env-ak');
    vi.stubEnv('OSS_ACCESS_KEY_SECRET', 'env-sk');

    vi.doMock('../config/system-config-schema.js', () => ({
      getConfig: async (key: string) => {
        const values: Record<string, string> = {
          upload_storage_backend: 'env',
          upload_oss_endpoint: 'https://ignored-partial-db.example.com',
          upload_oss_bucket: '',
          upload_oss_access_key_id: '',
          upload_oss_access_key_secret: '',
          upload_oss_region: 'auto',
          upload_oss_cdn_domain: '',
          upload_ozon_cdn_relay_url: '',
          upload_local_base_url: '',
        };
        return values[key] ?? '';
      },
    }));

    const config = await getRuntimeConfigForStorage();

    expect(config.source).toBe('env');
    expect(config.oss?.endpoint).toBe('https://oss.example.com');

    vi.doUnmock('../config/system-config-schema.js');
  });
});

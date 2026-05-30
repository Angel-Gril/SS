import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeConfig, getRuntimeMode, requiresAuthChallenges } from '../adapters/runtime-config.js';

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

    expect(getRuntimeConfig()).toMatchObject({
      mode: 'cloud',
      imageStorage: 'oss',
      authSource: 'token',
      extensionSync: 'queue',
    });
    expect(requiresAuthChallenges()).toBe(true);
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
});

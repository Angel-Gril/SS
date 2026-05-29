import { afterEach, describe, expect, it, vi } from 'vitest';
import { getRuntimeConfig, getRuntimeMode } from '../adapters/runtime-config.js';

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
  });

  it('enables cloud capabilities when RUNTIME_MODE=cloud', () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');

    expect(getRuntimeConfig()).toMatchObject({
      mode: 'cloud',
      imageStorage: 'oss',
      authSource: 'token',
      extensionSync: 'queue',
    });
  });

  it('accepts only known cloud image storage backends', () => {
    vi.stubEnv('RUNTIME_MODE', 'cloud');
    vi.stubEnv('IMAGE_STORAGE_BACKEND', 'ozon-cdn');
    expect(getRuntimeConfig().imageStorage).toBe('ozon-cdn');

    vi.stubEnv('IMAGE_STORAGE_BACKEND', 'invalid');
    expect(getRuntimeConfig().imageStorage).toBe('oss');
  });
});

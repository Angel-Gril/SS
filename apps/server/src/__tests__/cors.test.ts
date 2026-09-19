import { describe, expect, it } from 'vitest';
import { isAllowedCorsOrigin, shouldAllowPrivateNetwork } from '../lib/cors.js';

describe('cors origin policy', () => {
  it('allows configured web origins in production', () => {
    expect(
      isAllowedCorsOrigin('http://120.55.61.146', {
        NODE_ENV: 'production',
        CORS_ORIGIN: 'https://app.example.com,http://120.55.61.146',
      }),
    ).toBe(true);
  });

  it('blocks unconfigured chrome extension origins in production', () => {
    expect(
      isAllowedCorsOrigin('chrome-extension://abcdefghijklmnop', {
        NODE_ENV: 'production',
        CORS_ORIGIN: 'http://120.55.61.146',
      }),
    ).toBe(false);
  });

  it('allows configured chrome extension origins in production', () => {
    expect(
      isAllowedCorsOrigin('chrome-extension://abcdefghijklmnop', {
        NODE_ENV: 'production',
        CORS_ORIGIN: 'http://120.55.61.146',
        CORS_EXTENSION_ORIGINS: 'chrome-extension://abcdefghijklmnop',
      }),
    ).toBe(true);
  });

  it('supports a staging-only chrome extension wildcard', () => {
    expect(
      isAllowedCorsOrigin('chrome-extension://temporary-dev-extension', {
        NODE_ENV: 'production',
        CORS_ORIGIN: 'http://120.55.61.146',
        CORS_EXTENSION_ORIGINS: 'chrome-extension://*',
      }),
    ).toBe(true);
  });

  it('allows private-network preflight only for an already allowed origin', () => {
    expect(shouldAllowPrivateNetwork(
      'chrome-extension://abcdefghijklmnop',
      'true',
      { NODE_ENV: 'production', CORS_EXTENSION_ORIGINS: 'chrome-extension://abcdefghijklmnop' },
    )).toBe(true);
    expect(shouldAllowPrivateNetwork(
      'chrome-extension://foreign-extension',
      'true',
      { NODE_ENV: 'production', CORS_EXTENSION_ORIGINS: 'chrome-extension://abcdefghijklmnop' },
    )).toBe(false);
    expect(shouldAllowPrivateNetwork(
      'chrome-extension://abcdefghijklmnop',
      'false',
      { NODE_ENV: 'production', CORS_EXTENSION_ORIGINS: 'chrome-extension://abcdefghijklmnop' },
    )).toBe(false);
  });
});

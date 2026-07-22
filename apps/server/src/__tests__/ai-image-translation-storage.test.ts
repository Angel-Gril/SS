import { describe, expect, it } from 'vitest';
import {
  isPublicHttpsStorageUrl,
  resolveAiImageTranslationStorageReadiness,
} from '../services/ai-image-translation-storage.js';

const oss = {
  endpoint: 'https://storage.example.com',
  bucket: 'media',
  accessKeyId: 'key',
  accessKeySecret: 'secret',
  region: 'auto',
};

describe('AI image translation storage readiness', () => {
  it('allows local storage only as a fake/sandbox transport', () => {
    const readiness = resolveAiImageTranslationStorageReadiness({
      imageStorage: 'local',
      oss: null,
      localBaseUrl: 'http://localhost:3001',
    });

    expect(readiness).toMatchObject({ ready: true, backend: 'local', publicHttps: false });
  });

  it('rejects OSS without a reachable public HTTPS URL', () => {
    expect(resolveAiImageTranslationStorageReadiness({
      imageStorage: 'oss', oss, localBaseUrl: 'http://localhost:3001',
    })).toMatchObject({ ready: false, backend: 'oss', publicHttps: false });
  });

  it('accepts owned OSS CDN transport over public HTTPS', () => {
    expect(resolveAiImageTranslationStorageReadiness({
      imageStorage: 'oss',
      oss: { ...oss, cdnDomain: 'https://cdn.example.com/media' },
      localBaseUrl: 'http://localhost:3001',
    })).toMatchObject({ ready: true, backend: 'oss', publicHttps: true });
  });

  it('rejects private, credential-bearing, and non-HTTPS URLs', () => {
    expect(isPublicHttpsStorageUrl('http://cdn.example.com/media')).toBe(false);
    expect(isPublicHttpsStorageUrl('https://localhost/media')).toBe(false);
    expect(isPublicHttpsStorageUrl('https://127.0.0.1/media')).toBe(false);
    expect(isPublicHttpsStorageUrl('https://[::1]/media')).toBe(false);
    expect(isPublicHttpsStorageUrl('https://[fd00::1]/media')).toBe(false);
    expect(isPublicHttpsStorageUrl('https://[::ffff:127.0.0.1]/media')).toBe(false);
    expect(isPublicHttpsStorageUrl('https://[ff02::1]/media')).toBe(false);
    expect(isPublicHttpsStorageUrl('https://localhost./media')).toBe(false);
    expect(isPublicHttpsStorageUrl('https://foo.local./media')).toBe(false);
    expect(isPublicHttpsStorageUrl('https://user:pass@cdn.example.com/media')).toBe(false);
    expect(isPublicHttpsStorageUrl('https://cdn.example.com/media')).toBe(true);
  });
});

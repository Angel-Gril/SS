import { describe, expect, it } from 'vitest';
import { resolveAiImageEditStorageReadiness } from '../services/ai-image-edit-storage.js';

describe('AI image edit storage readiness', () => {
  it('allows owned local and fully configured OSS storage', () => {
    expect(resolveAiImageEditStorageReadiness({ imageStorage: 'local', oss: null }))
      .toMatchObject({ ready: true, backend: 'local' });
    expect(resolveAiImageEditStorageReadiness({
      imageStorage: 'oss',
      oss: {
        endpoint: 'https://oss.example.com',
        bucket: 'bucket',
        accessKeyId: 'key',
        accessKeySecret: 'secret',
        region: 'auto',
      },
    })).toMatchObject({ ready: true, backend: 'oss' });
  });

  it('fails closed for incomplete OSS and Ozon CDN storage', () => {
    expect(resolveAiImageEditStorageReadiness({ imageStorage: 'oss', oss: null }))
      .toMatchObject({ ready: false, backend: 'oss' });
    expect(resolveAiImageEditStorageReadiness({ imageStorage: 'ozon-cdn', oss: null }))
      .toMatchObject({ ready: false, backend: 'ozon-cdn' });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const configStore = new Map<string, string>();

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    systemConfig: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        if (!configStore.has(where.key)) return null;
        return { key: where.key, value: configStore.get(where.key) };
      }),
      upsert: vi.fn(async ({ where, create, update }: any) => {
        const value = update?.value ?? create.value;
        configStore.set(where.key, value);
        return { key: where.key, value };
      }),
      findMany: vi.fn(async () => Array.from(configStore.entries()).map(([key, value]) => ({ key, value }))),
    },
  },
}));

describe('SystemConfig sensitive storage', () => {
  beforeEach(() => {
    configStore.clear();
    vi.stubEnv('ENCRYPTION_KEY', '12345678901234567890123456789012');
  });

  it('encrypts sensitive SystemConfig values when saving and decrypts when reading', async () => {
    const { getConfig, setConfig } = await import('../config/system-config-schema.js');

    await setConfig('auth_sms_tencent_secret_key', 'super-secret');

    const stored = configStore.get('auth_sms_tencent_secret_key');
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain('super-secret');
    await expect(getConfig('auth_sms_tencent_secret_key')).resolves.toBe('super-secret');
  });

  it('encrypts backup remote access secrets when saving and decrypts when reading', async () => {
    const { getConfig, setConfig } = await import('../config/system-config-schema.js');

    await setConfig('backup_remote_secret_access_key', 'backup-secret');

    const stored = configStore.get('backup_remote_secret_access_key');
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain('backup-secret');
    await expect(getConfig('backup_remote_secret_access_key')).resolves.toBe('backup-secret');
  });

  it('encrypts AI provider API keys and exposes safe disabled defaults', async () => {
    const { getConfig, setConfig, SystemConfigMeta } = await import('../config/system-config-schema.js');

    await expect(getConfig('ai_provider')).resolves.toBe('disabled');
    await expect(getConfig('ai_category_translation_enabled')).resolves.toBe(false);
    await expect(getConfig('ai_product_generation_enabled')).resolves.toBe(false);
    await expect(getConfig('ai_user_daily_product_generation_limit')).resolves.toBe(20);
    await expect(getConfig('feature_image_translate')).resolves.toBe(false);
    await expect(getConfig('feature_ai_media_image_to_image')).resolves.toBe(false);
    await expect(getConfig('feature_ai_media_full_edit')).resolves.toBe(false);
    await expect(getConfig('feature_ai_media_inpaint')).resolves.toBe(false);
    await expect(getConfig('ai_image_translation_provider')).resolves.toBe('disabled');
    await expect(getConfig('ai_image_translation_model')).resolves.toBe('qwen-mt-image');
    expect(SystemConfigMeta.feature_ai_media_full_edit).toMatchObject({ group: 'feature' });
    expect(SystemConfigMeta.feature_ai_media_image_to_image).toMatchObject({ group: 'feature' });
    expect(SystemConfigMeta.feature_ai_media_inpaint).toMatchObject({ group: 'feature' });

    await setConfig('feature_ai_media_full_edit', true);
    await setConfig('feature_ai_media_inpaint', true);
    expect(configStore.get('feature_ai_media_full_edit')).toBe('true');
    expect(configStore.get('feature_ai_media_inpaint')).toBe('true');
    await expect(getConfig('feature_ai_media_full_edit')).resolves.toBe(true);
    await expect(getConfig('feature_ai_media_inpaint')).resolves.toBe(true);

    await setConfig('ai_api_key', 'ai-secret-token');

    const stored = configStore.get('ai_api_key');
    expect(stored).toMatch(/^enc:v1:/);
    expect(stored).not.toContain('ai-secret-token');
    await expect(getConfig('ai_api_key')).resolves.toBe('ai-secret-token');

    await setConfig('ai_image_translation_api_key', 'translation-secret-token');
    const translationStored = configStore.get('ai_image_translation_api_key');
    expect(translationStored).toMatch(/^enc:v1:/);
    expect(translationStored).not.toContain('translation-secret-token');
    await expect(getConfig('ai_image_translation_api_key')).resolves.toBe('translation-secret-token');
  });

  it('keeps extension hosted and BYOK controls independently default-off', async () => {
    const { getConfig, setConfig, SystemConfigMeta } = await import('../config/system-config-schema.js');

    await expect(getConfig('feature_extension_hosted_ai')).resolves.toBe(false);
    await expect(getConfig('feature_extension_byok_ai')).resolves.toBe(false);
    await expect(getConfig('feature_extension_byok_ingest')).resolves.toBe(false);
    await expect(getConfig('feature_extension_byok_publish')).resolves.toBe(false);
    await expect(getConfig('extension_byok_admin_policy')).resolves.toBe(
      '{"contractVersion":"extension-byok-admin-policy/v1","revision":0,"mode":"off","ownerUserIds":[],"shopIds":[],"deviceSessionIds":[],"allowedOrigins":[],"allowedOperations":[],"maxConcurrency":1}',
    );
    expect(SystemConfigMeta.feature_extension_hosted_ai).toMatchObject({ group: 'ai' });
    expect(SystemConfigMeta.feature_extension_byok_ai).toMatchObject({ group: 'ai' });

    await setConfig('feature_extension_byok_ai', true);
    await setConfig('feature_extension_byok_ingest', true);
    await expect(getConfig('feature_extension_byok_ai')).resolves.toBe(true);
    await expect(getConfig('feature_extension_byok_ingest')).resolves.toBe(true);
  });

  it('accepts only strict non-secret BYOK admin policy JSON', async () => {
    const { setConfig } = await import('../config/system-config-schema.js');
    const valid = JSON.stringify({
      contractVersion: 'extension-byok-admin-policy/v1',
      revision: 2,
      mode: 'pilot',
      ownerUserIds: ['owner-1'],
      shopIds: ['shop-1'],
      deviceSessionIds: ['device-1'],
      allowedOrigins: ['https://provider.example'],
      allowedOperations: ['TEXT_TO_IMAGE'],
      maxConcurrency: 1,
    });
    await expect(setConfig('extension_byok_admin_policy', valid)).resolves.toBeUndefined();
    await expect(setConfig('extension_byok_admin_policy', '{bad json')).rejects.toThrow();
    await expect(setConfig(
      'extension_byok_admin_policy',
      valid.replace('"maxConcurrency":1', '"maxConcurrency":1,"apiKey":"sk-secret"'),
    )).rejects.toThrow();
    await expect(setConfig(
      'extension_byok_admin_policy',
      valid.replace('https://provider.example', 'http://provider.example'),
    )).rejects.toThrow();
    await expect(setConfig(
      'extension_byok_admin_policy',
      valid.replace('"TEXT_TO_IMAGE"', '"UNKNOWN"'),
    )).rejects.toThrow();
  });

  it('stores only strictly valid category glossary JSON for image translation', async () => {
    const { getConfig, setConfig } = await import('../config/system-config-schema.js');
    const validGlossary = JSON.stringify({
      version: 1,
      profiles: [{
        sourceLanguage: 'en',
        targetLanguage: 'ru',
        categoryId: 123,
        terms: [{ src: 'ceramic mug', tgt: 'керамическая кружка' }],
      }],
    });

    await expect(getConfig('ai_image_translation_category_glossary_json'))
      .resolves.toBe('{"version":1,"profiles":[]}');

    await setConfig('ai_image_translation_category_glossary_json', validGlossary);
    expect(configStore.get('ai_image_translation_category_glossary_json')).toBe(validGlossary);
    await expect(getConfig('ai_image_translation_category_glossary_json')).resolves.toBe(validGlossary);

    await expect(setConfig('ai_image_translation_category_glossary_json', '{bad json'))
      .rejects.toThrow();
    await expect(setConfig(
      'ai_image_translation_category_glossary_json',
      '{"version":1,"profiles":[],"unexpected":true}',
    )).rejects.toThrow();
    await expect(setConfig(
      'ai_image_translation_category_glossary_json',
      '{"version":1,"profiles":[{"sourceLanguage":"en","targetLanguage":"ru","typeId":7,"terms":[]}]}',
    )).rejects.toThrow(/typeId requires categoryId/u);
  });

  it('encrypts Aliyun SMS credentials and marks both fields as sensitive', async () => {
    const { getConfig, setConfig, SystemConfigMeta } = await import('../config/system-config-schema.js');

    await setConfig('auth_sms_aliyun_access_key_id', 'aliyun-access-key-id');
    await setConfig('auth_sms_aliyun_access_key_secret', 'aliyun-access-key-secret');

    for (const key of ['auth_sms_aliyun_access_key_id', 'auth_sms_aliyun_access_key_secret'] as const) {
      const stored = configStore.get(key);
      expect(stored).toMatch(/^enc:v1:/);
      expect(stored).not.toContain('aliyun-access-key');
      expect(SystemConfigMeta[key]).toMatchObject({ sensitive: true, encrypted: true });
    }
    await expect(getConfig('auth_sms_aliyun_access_key_id')).resolves.toBe('aliyun-access-key-id');
    await expect(getConfig('auth_sms_aliyun_access_key_secret')).resolves.toBe('aliyun-access-key-secret');
  });
  it('keeps reading legacy plaintext sensitive values for backward compatibility', async () => {
    const { getConfig } = await import('../config/system-config-schema.js');

    configStore.set('auth_turnstile_secret_key', 'legacy-plain-secret');

    await expect(getConfig('auth_turnstile_secret_key')).resolves.toBe('legacy-plain-secret');
  });
});

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
    await expect(getConfig('feature_ai_media_full_edit')).resolves.toBe(false);
    await expect(getConfig('feature_ai_media_inpaint')).resolves.toBe(false);
    await expect(getConfig('ai_image_translation_provider')).resolves.toBe('disabled');
    await expect(getConfig('ai_image_translation_model')).resolves.toBe('qwen-mt-image');
    expect(SystemConfigMeta.feature_ai_media_full_edit).toMatchObject({ group: 'feature' });
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
  it('keeps reading legacy plaintext sensitive values for backward compatibility', async () => {
    const { getConfig } = await import('../config/system-config-schema.js');

    configStore.set('auth_turnstile_secret_key', 'legacy-plain-secret');

    await expect(getConfig('auth_turnstile_secret_key')).resolves.toBe('legacy-plain-secret');
  });
});

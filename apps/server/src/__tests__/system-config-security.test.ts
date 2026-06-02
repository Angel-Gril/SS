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

  it('keeps reading legacy plaintext sensitive values for backward compatibility', async () => {
    const { getConfig } = await import('../config/system-config-schema.js');

    configStore.set('auth_turnstile_secret_key', 'legacy-plain-secret');

    await expect(getConfig('auth_turnstile_secret_key')).resolves.toBe('legacy-plain-secret');
  });
});

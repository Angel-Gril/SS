import { beforeEach, describe, expect, it, vi } from 'vitest';

const configStore = new Map<string, string>();

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    systemConfig: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        if (!configStore.has(where.key)) return null;
        return { key: where.key, value: configStore.get(where.key) };
      }),
    },
  },
}));

describe('auth challenge config', () => {
  beforeEach(() => {
    configStore.clear();
    vi.resetModules();
    vi.stubEnv('RUNTIME_MODE', 'cloud');
  });

  it('returns public SMS and Turnstile settings from SystemConfig without exposing secrets', async () => {
    configStore.set('feature_sms_register', 'true');
    configStore.set('feature_sms_login', 'true');
    configStore.set('feature_turnstile_login', 'true');
    configStore.set('auth_turnstile_site_key', 'public-site-key');
    configStore.set('auth_turnstile_secret_key', 'private-secret-key');
    configStore.set('auth_sms_rate_limit_seconds', '90');

    const { getPublicAuthChallengeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getPublicAuthChallengeConfig()).resolves.toEqual({
      runtimeMode: 'cloud',
      smsRegisterEnabled: true,
      smsLoginEnabled: true,
      turnstileEnabled: true,
      turnstileSiteKey: 'public-site-key',
      smsRateLimitSeconds: 90,
    });
  });

  it('uses Tencent SMS settings from SystemConfig before env fallback', async () => {
    configStore.set('auth_sms_provider', 'tencent');
    configStore.set('auth_sms_tencent_secret_id', 'db-secret-id');
    configStore.set('auth_sms_tencent_secret_key', 'db-secret-key');
    configStore.set('auth_sms_tencent_region', 'ap-shanghai');
    configStore.set('auth_sms_tencent_sdk_app_id', 'db-sdk-app-id');
    configStore.set('auth_sms_tencent_sign_name', 'db-sign');
    configStore.set('auth_sms_tencent_template_id', 'db-template');
    vi.stubEnv('SMS_TENCENT_SECRET_ID', 'env-secret-id');
    vi.stubEnv('SMS_TENCENT_SECRET_KEY', 'env-secret-key');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).resolves.toMatchObject({
      provider: 'tencent',
      source: 'system-config',
      tencent: {
        secretId: 'db-secret-id',
        secretKey: 'db-secret-key',
        region: 'ap-shanghai',
        sdkAppId: 'db-sdk-app-id',
        signName: 'db-sign',
        templateId: 'db-template',
      },
    });
  });

  it('uses Aliyun SMS settings from SystemConfig before env fallback', async () => {
    configStore.set('auth_sms_provider', 'aliyun');
    configStore.set('auth_sms_aliyun_credential_mode', 'access_key');
    configStore.set('auth_sms_aliyun_access_key_id', 'db-access-key-id');
    configStore.set('auth_sms_aliyun_access_key_secret', 'db-access-key-secret');
    configStore.set('auth_sms_aliyun_sign_name', 'db-sign');
    configStore.set('auth_sms_aliyun_template_code', 'SMS_DB_TEMPLATE');
    configStore.set('auth_sms_aliyun_template_param_name', 'verifyCode');
    vi.stubEnv('SMS_ALIYUN_ACCESS_KEY_ID', 'env-access-key-id');
    vi.stubEnv('SMS_ALIYUN_CREDENTIAL_MODE', 'ecs_ram_role');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).resolves.toMatchObject({
      provider: 'aliyun',
      source: 'system-config',
      aliyun: {
        credentialMode: 'access_key',
        accessKeyId: 'db-access-key-id',
        accessKeySecret: 'db-access-key-secret',
        signName: 'db-sign',
        templateCode: 'SMS_DB_TEMPLATE',
        templateParamName: 'verifyCode',
      },
    });
  });

  it('supports Alibaba ECS RAM role credentials without SMS AccessKey fields', async () => {
    configStore.set('auth_sms_provider', 'aliyun');
    configStore.set('auth_sms_aliyun_credential_mode', 'ecs_ram_role');
    configStore.set('auth_sms_aliyun_role_name', 'ss-erp-sms');
    configStore.set('auth_sms_aliyun_sign_name', 'ecs-sign');
    configStore.set('auth_sms_aliyun_template_code', 'SMS_ECS_TEMPLATE');
    vi.stubEnv('SMS_ALIYUN_ACCESS_KEY_ID', '');
    vi.stubEnv('SMS_ALIYUN_ACCESS_KEY_SECRET', '');
    vi.stubEnv('SMS_ALIYUN_CREDENTIAL_MODE', '');
    vi.stubEnv('SMS_ALIYUN_ROLE_NAME', '');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).resolves.toMatchObject({
      provider: 'aliyun',
      aliyun: {
        accessKeyId: '',
        accessKeySecret: '',
        credentialMode: 'ecs_ram_role',
        roleName: 'ss-erp-sms',
        signName: 'ecs-sign',
        templateCode: 'SMS_ECS_TEMPLATE',
      },
    });
  });

  it('disables public challenges in local runtime even if flags are enabled', async () => {
    vi.stubEnv('RUNTIME_MODE', 'local');
    configStore.set('feature_sms_register', 'true');
    configStore.set('feature_turnstile_login', 'true');
    configStore.set('auth_turnstile_site_key', 'public-site-key');

    const { getPublicAuthChallengeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getPublicAuthChallengeConfig()).resolves.toMatchObject({
      runtimeMode: 'local',
      smsRegisterEnabled: false,
      smsLoginEnabled: false,
      turnstileEnabled: false,
      turnstileSiteKey: '',
    });
  });
});

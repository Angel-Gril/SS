import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const configStore = new Map<string, string>();
const configFailures = new Set<string>();

vi.mock('../lib/prisma.js', () => ({
  prisma: {
    systemConfig: {
      findUnique: vi.fn(async ({ where }: { where: { key: string } }) => {
        if (configFailures.has(where.key)) throw new Error(`database unavailable for ${where.key}`);
        if (!configStore.has(where.key)) return null;
        return { key: where.key, value: configStore.get(where.key) };
      }),
    },
  },
}));

describe('auth challenge config', () => {
  beforeEach(() => {
    configStore.clear();
    configFailures.clear();
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

  it('loads SMS daily quota defaults and SystemConfig overrides', async () => {
    configStore.set('auth_sms_daily_per_phone_limit', '7');
    configStore.set('auth_sms_daily_per_ip_limit', '80');
    configStore.set('auth_sms_daily_global_limit', '900');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).resolves.toMatchObject({
      dailyPerPhoneLimit: 7,
      dailyPerIpLimit: 80,
      dailyGlobalLimit: 900,
    });
  });

  it('reports mixed provenance when a database-selected Tencent provider uses an env fallback', async () => {
    configStore.set('auth_sms_provider', 'tencent');
    configStore.set('auth_sms_tencent_secret_id', 'db-secret-id');
    configStore.set('auth_sms_tencent_region', 'ap-shanghai');
    configStore.set('auth_sms_tencent_sdk_app_id', 'db-sdk-app-id');
    configStore.set('auth_sms_tencent_sign_name', 'db-sign');
    configStore.set('auth_sms_tencent_template_id', 'db-template');
    vi.stubEnv('SMS_TENCENT_SECRET_KEY', 'env-secret-key');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).resolves.toMatchObject({
      provider: 'tencent',
      source: 'mixed',
      tencent: {
        secretId: 'db-secret-id',
        secretKey: 'env-secret-key',
      },
    });
  });

  it('fails closed when a daily cost-fuse setting cannot be read', async () => {
    configFailures.add('auth_sms_daily_global_limit');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).rejects.toThrow(/database unavailable.*daily_global_limit/);
  });

  it('keeps ordinary decrypt compatibility but rejects malformed encrypted values in strict reads', async () => {
    vi.stubEnv('ENCRYPTION_KEY', '12345678901234567890123456789012');
    const malformed = 'enc:v1:not-valid-ciphertext';
    configStore.set('auth_sms_provider', 'aliyun');
    configStore.set('auth_sms_aliyun_access_key_secret', malformed);

    const { decryptConfigValue, decryptConfigValueStrict, getConfig, getStrictConfig } = await import('../config/system-config-schema.js');
    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    expect(decryptConfigValue('auth_sms_aliyun_access_key_secret', malformed)).toBe(malformed);
    expect(() => decryptConfigValueStrict('auth_sms_aliyun_access_key_secret', malformed)).toThrow(/解密失败/);
    await expect(getConfig('auth_sms_aliyun_access_key_secret')).resolves.toBe(malformed);
    await expect(getStrictConfig('auth_sms_aliyun_access_key_secret')).rejects.toThrow(/解密失败/);
    await expect(getSmsRuntimeConfig()).rejects.toThrow(/auth_sms_aliyun_access_key_secret.*解密失败/);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses Aliyun SMS settings from SystemConfig before env fallback', async () => {
    configStore.set('auth_sms_provider', 'aliyun');
    configStore.set('auth_sms_aliyun_credential_mode', 'access_key');
    configStore.set('auth_sms_aliyun_access_key_id', 'db-access-key-id');
    configStore.set('auth_sms_aliyun_access_key_secret', 'db-access-key-secret');
    configStore.set('auth_sms_aliyun_sign_name', 'db-sign');
    configStore.set('auth_sms_aliyun_template_code', 'SMS_DB_TEMPLATE');
    configStore.set('auth_sms_aliyun_template_param_name', 'verifyCode');
    configStore.set('auth_sms_aliyun_register_template_code', 'SMS_DB_REGISTER');
    configStore.set('auth_sms_aliyun_register_template_param_name', 'registerCode');
    configStore.set('auth_sms_aliyun_password_reset_template_code', 'SMS_DB_PASSWORD_RESET');
    configStore.set('auth_sms_aliyun_password_reset_template_param_name', 'resetCode');
    configStore.set('auth_sms_aliyun_sms_login_template_code', 'SMS_DB_LOGIN');
    configStore.set('auth_sms_aliyun_sms_login_template_param_name', 'loginCode');
    vi.stubEnv('SMS_ALIYUN_ACCESS_KEY_ID', 'env-access-key-id');
    vi.stubEnv('SMS_ALIYUN_CREDENTIAL_MODE', 'ecs_ram_role');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).resolves.toMatchObject({
      provider: 'aliyun',
      source: 'system-config',
      aliyun: {
        credentialMode: 'access_key',
        credentialSource: 'db_access_key',
        accessKeyId: 'db-access-key-id',
        accessKeySecret: 'db-access-key-secret',
        signName: 'db-sign',
        templateCode: 'SMS_DB_TEMPLATE',
        templateParamName: 'verifyCode',
        registerTemplateCode: 'SMS_DB_REGISTER',
        registerTemplateParamName: 'registerCode',
        passwordResetTemplateCode: 'SMS_DB_PASSWORD_RESET',
        passwordResetTemplateParamName: 'resetCode',
        smsLoginTemplateCode: 'SMS_DB_LOGIN',
        smsLoginTemplateParamName: 'loginCode',
      },
    });
  });

  it('keeps auto-mode credentials database-sourced when the saved AccessKey pair is complete', async () => {
    configStore.set('auth_sms_provider', 'aliyun');
    configStore.set('auth_sms_aliyun_credential_mode', 'auto');
    configStore.set('auth_sms_aliyun_access_key_id', 'db-access-key-id');
    configStore.set('auth_sms_aliyun_access_key_secret', 'db-access-key-secret');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).resolves.toMatchObject({
      source: 'system-config',
      aliyun: { credentialSource: 'db_access_key' },
    });
  });

  it('reports mixed provenance when auto mode uses Alibaba environment credentials through the default chain', async () => {
    configStore.set('auth_sms_provider', 'aliyun');
    configStore.set('auth_sms_aliyun_credential_mode', 'auto');
    configStore.set('auth_sms_aliyun_sign_name', 'db-sign');
    vi.stubEnv('SMS_ALIYUN_ACCESS_KEY_ID', '');
    vi.stubEnv('SMS_ALIYUN_ACCESS_KEY_SECRET', '');
    vi.stubEnv('ALIBABA_CLOUD_ACCESS_KEY_ID', 'default-chain-access-key-id');
    vi.stubEnv('ALIBABA_CLOUD_ACCESS_KEY_SECRET', 'default-chain-access-key-secret');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).resolves.toMatchObject({
      provider: 'aliyun',
      source: 'mixed',
      aliyun: {
        accessKeyId: '',
        accessKeySecret: '',
        credentialMode: 'auto',
        credentialSource: 'aliyun_env_access_key',
      },
    });
  });

  it('identifies an ECS metadata role selected through the Alibaba default chain', async () => {
    configStore.set('auth_sms_provider', 'aliyun');
    configStore.set('auth_sms_aliyun_credential_mode', 'auto');
    vi.stubEnv('SMS_ALIYUN_ACCESS_KEY_ID', '');
    vi.stubEnv('SMS_ALIYUN_ACCESS_KEY_SECRET', '');
    vi.stubEnv('ALIBABA_CLOUD_ACCESS_KEY_ID', '');
    vi.stubEnv('ALIBABA_CLOUD_ACCESS_KEY_SECRET', '');
    vi.stubEnv('ALIBABA_CLOUD_ECS_METADATA', 'ss-erp-sms');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).resolves.toMatchObject({
      source: 'mixed',
      aliyun: {
        credentialMode: 'auto',
        credentialSource: 'ecs_ram_role',
        roleName: 'ss-erp-sms',
      },
    });
  });

  it('uses only matching purpose environment fallbacks for mixed SystemConfig deployments', async () => {
    configStore.set('auth_sms_provider', 'aliyun');
    configStore.set('auth_sms_aliyun_sign_name', 'db-sign');
    configStore.set('auth_sms_aliyun_template_code', 'SMS_LEGACY_REGISTER');
    configStore.set('auth_sms_aliyun_template_param_name', 'code');
    vi.stubEnv('SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE', 'SMS_ENV_RESET_FALLBACK');
    vi.stubEnv('SMS_ALIYUN_SMS_LOGIN_TEMPLATE_CODE', 'SMS_ENV_LOGIN_FALLBACK');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).resolves.toMatchObject({
      source: 'mixed',
      aliyun: {
        templateCode: 'SMS_LEGACY_REGISTER',
        templateParamName: 'code',
        registerTemplateCode: '',
        registerTemplateParamName: 'code',
        passwordResetTemplateCode: 'SMS_ENV_RESET_FALLBACK',
        passwordResetTemplateParamName: 'code',
        smsLoginTemplateCode: 'SMS_ENV_LOGIN_FALLBACK',
        smsLoginTemplateParamName: 'code',
      },
    });
  });

  it('never reuses a legacy registration environment template for reset or login', async () => {
    configStore.set('auth_sms_provider', 'aliyun');
    configStore.set('auth_sms_aliyun_sign_name', 'db-sign');
    vi.stubEnv('SMS_ALIYUN_TEMPLATE_CODE', 'SMS_ENV_LEGACY_REGISTER');
    vi.stubEnv('SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE', '');
    vi.stubEnv('SMS_ALIYUN_SMS_LOGIN_TEMPLATE_CODE', '');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).resolves.toMatchObject({
      aliyun: {
        templateCode: 'SMS_ENV_LEGACY_REGISTER',
        passwordResetTemplateCode: '',
        smsLoginTemplateCode: '',
      },
    });
  });

  it('fails closed when an active provider configuration cannot be read', async () => {
    configStore.set('auth_sms_provider', 'aliyun');
    configFailures.add('auth_sms_aliyun_credential_mode');
    vi.stubEnv('SMS_PROVIDER', 'aliyun');
    vi.stubEnv('SMS_ALIYUN_CREDENTIAL_MODE', 'auto');

    const { getSmsRuntimeConfig } = await import('../lib/auth-challenge-config.js');

    await expect(getSmsRuntimeConfig()).rejects.toThrow(/database unavailable.*credential_mode/);
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
        credentialSource: 'ecs_ram_role',
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

import { getRuntimeMode, type RuntimeMode } from '../adapters/runtime-config.js';
import { getConfig, getDefaultValue, type SystemConfigKey, type SystemConfigValue } from '../config/system-config-schema.js';

export type SmsProviderName = 'console' | 'tencent' | 'aliyun';

export interface TencentSmsRuntimeConfig {
  secretId: string;
  secretKey: string;
  region: string;
  sdkAppId: string;
  signName: string;
  templateId: string;
}

export interface AliyunSmsRuntimeConfig {
  accessKeyId: string;
  accessKeySecret: string;
  /**
   * `auto` uses the Alibaba Cloud default credential chain when no explicit
   * SMS_* key pair is configured. `ecs_ram_role` is useful on an Alibaba ECS
   * instance with an attached RAM role.
   */
  credentialMode: 'auto' | 'access_key' | 'ecs_ram_role';
  roleName: string;
  signName: string;
  templateCode: string;
  templateParamName: string;
}

export interface SmsRuntimeConfig {
  provider: SmsProviderName | '';
  source: 'env' | 'system-config' | 'mixed';
  codeTtlSeconds: number;
  rateLimitSeconds: number;
  testPhoneWhitelist: string[];
  tencent: TencentSmsRuntimeConfig;
  aliyun: AliyunSmsRuntimeConfig;
}

export interface TurnstileRuntimeConfig {
  enabled: boolean;
  siteKey: string;
  secretKey: string;
  source: 'env' | 'system-config' | 'mixed' | 'none';
}

export interface PublicAuthChallengeConfig {
  runtimeMode: RuntimeMode;
  smsRegisterEnabled: boolean;
  smsLoginEnabled: boolean;
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  smsRateLimitSeconds: number;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function normalizeAliyunCredentialMode(value: unknown): AliyunSmsRuntimeConfig['credentialMode'] {
  const mode = clean(value);
  return mode === 'access_key' || mode === 'ecs_ram_role' || mode === 'auto' ? mode : 'auto';
}

async function readConfig<K extends SystemConfigKey>(key: K): Promise<SystemConfigValue<K>> {
  try {
    return await getConfig(key);
  } catch (error: any) {
    console.warn(`[auth-config] failed to load ${key}, using default/env fallback: ${error?.message || error}`);
    return getDefaultValue(key);
  }
}

function splitCsv(value: string): string[] {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function envSmsProvider(): SmsProviderName | '' {
  const provider = process.env.SMS_PROVIDER || (process.env.NODE_ENV === 'production' ? '' : 'console');
  if (provider === 'console' || provider === 'tencent' || provider === 'aliyun') return provider;
  return '';
}

export async function isSmsRegistrationChallengeEnabled(): Promise<boolean> {
  return getRuntimeMode() === 'cloud' && await readConfig('feature_sms_register');
}

export async function isSmsLoginChallengeEnabled(): Promise<boolean> {
  return getRuntimeMode() === 'cloud' && await readConfig('feature_sms_login');
}

export async function isTurnstileChallengeEnabled(): Promise<boolean> {
  return getRuntimeMode() === 'cloud' && await readConfig('feature_turnstile_login');
}

export async function getSmsRuntimeConfig(): Promise<SmsRuntimeConfig> {
  const [
    configuredProvider,
    secretId,
    secretKey,
    region,
    sdkAppId,
    signName,
    templateId,
    aliyunAccessKeyId,
    aliyunAccessKeySecret,
    configuredAliyunCredentialMode,
    configuredAliyunRoleName,
    aliyunSignName,
    aliyunTemplateCode,
    aliyunTemplateParamName,
    codeTtlSeconds,
    rateLimitSeconds,
    whitelist,
  ] = await Promise.all([
    readConfig('auth_sms_provider'),
    readConfig('auth_sms_tencent_secret_id'),
    readConfig('auth_sms_tencent_secret_key'),
    readConfig('auth_sms_tencent_region'),
    readConfig('auth_sms_tencent_sdk_app_id'),
    readConfig('auth_sms_tencent_sign_name'),
    readConfig('auth_sms_tencent_template_id'),
    readConfig('auth_sms_aliyun_access_key_id'),
    readConfig('auth_sms_aliyun_access_key_secret'),
    readConfig('auth_sms_aliyun_credential_mode'),
    readConfig('auth_sms_aliyun_role_name'),
    readConfig('auth_sms_aliyun_sign_name'),
    readConfig('auth_sms_aliyun_template_code'),
    readConfig('auth_sms_aliyun_template_param_name'),
    readConfig('auth_sms_code_ttl_seconds'),
    readConfig('auth_sms_rate_limit_seconds'),
    readConfig('auth_sms_test_phone_whitelist'),
  ]);

  const provider = configuredProvider === 'env' ? envSmsProvider() : configuredProvider;
  const useDbTencent = configuredProvider === 'tencent';
  const useDbAliyun = configuredProvider === 'aliyun';
  const aliyunCredentialMode = normalizeAliyunCredentialMode(
    useDbAliyun ? configuredAliyunCredentialMode : process.env.SMS_ALIYUN_CREDENTIAL_MODE,
  );
  const aliyunRoleName = useDbAliyun
    ? clean(configuredAliyunRoleName) || clean(process.env.SMS_ALIYUN_ROLE_NAME || process.env.ALIBABA_CLOUD_ECS_METADATA)
    : clean(process.env.SMS_ALIYUN_ROLE_NAME || process.env.ALIBABA_CLOUD_ECS_METADATA);
  const hasDbProviderFields = !!(
    secretId || secretKey || sdkAppId || signName || templateId
    || aliyunAccessKeyId || aliyunAccessKeySecret
    || (configuredAliyunCredentialMode !== 'auto' && configuredAliyunCredentialMode)
    || configuredAliyunRoleName || aliyunSignName || aliyunTemplateCode
  );

  return {
    provider,
    source: configuredProvider === 'env' ? (hasDbProviderFields ? 'mixed' : 'env') : 'system-config',
    codeTtlSeconds,
    rateLimitSeconds,
    testPhoneWhitelist: splitCsv(whitelist),
    tencent: {
      secretId: useDbTencent ? clean(secretId) || process.env.SMS_TENCENT_SECRET_ID || '' : process.env.SMS_TENCENT_SECRET_ID || '',
      secretKey: useDbTencent ? clean(secretKey) || process.env.SMS_TENCENT_SECRET_KEY || '' : process.env.SMS_TENCENT_SECRET_KEY || '',
      region: useDbTencent ? clean(region) || process.env.SMS_TENCENT_REGION || 'ap-guangzhou' : process.env.SMS_TENCENT_REGION || 'ap-guangzhou',
      sdkAppId: useDbTencent ? clean(sdkAppId) || process.env.SMS_TENCENT_SDK_APP_ID || '' : process.env.SMS_TENCENT_SDK_APP_ID || '',
      signName: useDbTencent ? clean(signName) || process.env.SMS_TENCENT_SIGN_NAME || '' : process.env.SMS_TENCENT_SIGN_NAME || '',
      templateId: useDbTencent ? clean(templateId) || process.env.SMS_TENCENT_TEMPLATE_ID || '' : process.env.SMS_TENCENT_TEMPLATE_ID || '',
    },
    aliyun: {
      accessKeyId: useDbAliyun ? clean(aliyunAccessKeyId) || process.env.SMS_ALIYUN_ACCESS_KEY_ID || '' : process.env.SMS_ALIYUN_ACCESS_KEY_ID || '',
      accessKeySecret: useDbAliyun ? clean(aliyunAccessKeySecret) || process.env.SMS_ALIYUN_ACCESS_KEY_SECRET || '' : process.env.SMS_ALIYUN_ACCESS_KEY_SECRET || '',
      credentialMode: aliyunCredentialMode,
      roleName: aliyunRoleName,
      signName: useDbAliyun ? clean(aliyunSignName) || process.env.SMS_ALIYUN_SIGN_NAME || '' : process.env.SMS_ALIYUN_SIGN_NAME || '',
      templateCode: useDbAliyun ? clean(aliyunTemplateCode) || process.env.SMS_ALIYUN_TEMPLATE_CODE || '' : process.env.SMS_ALIYUN_TEMPLATE_CODE || '',
      templateParamName: useDbAliyun
        ? clean(aliyunTemplateParamName) || process.env.SMS_ALIYUN_TEMPLATE_PARAM_NAME || 'code'
        : process.env.SMS_ALIYUN_TEMPLATE_PARAM_NAME || 'code',
    },
  };
}

export async function getTurnstileRuntimeConfig(): Promise<TurnstileRuntimeConfig> {
  const enabled = await isTurnstileChallengeEnabled();
  const [configuredSiteKey, configuredSecretKey] = await Promise.all([
    readConfig('auth_turnstile_site_key'),
    readConfig('auth_turnstile_secret_key'),
  ]);
  const dbSiteKey = clean(configuredSiteKey);
  const dbSecretKey = clean(configuredSecretKey);
  const envSiteKey = process.env.TURNSTILE_SITE_KEY || process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '';
  const envSecretKey = process.env.TURNSTILE_SECRET_KEY || '';

  let source: TurnstileRuntimeConfig['source'] = 'none';
  if (dbSiteKey || dbSecretKey) source = envSiteKey || envSecretKey ? 'mixed' : 'system-config';
  else if (envSiteKey || envSecretKey) source = 'env';

  return {
    enabled,
    siteKey: dbSiteKey || envSiteKey,
    secretKey: dbSecretKey || envSecretKey,
    source,
  };
}

export async function getPublicAuthChallengeConfig(): Promise<PublicAuthChallengeConfig> {
  const runtimeMode = getRuntimeMode();
  const smsConfig = await getSmsRuntimeConfig();

  if (runtimeMode !== 'cloud') {
    return {
      runtimeMode,
      smsRegisterEnabled: false,
      smsLoginEnabled: false,
      turnstileEnabled: false,
      turnstileSiteKey: '',
      smsRateLimitSeconds: smsConfig.rateLimitSeconds,
    };
  }

  const [smsRegisterEnabled, smsLoginEnabled, turnstile] = await Promise.all([
    isSmsRegistrationChallengeEnabled(),
    isSmsLoginChallengeEnabled(),
    getTurnstileRuntimeConfig(),
  ]);

  return {
    runtimeMode,
    smsRegisterEnabled,
    smsLoginEnabled,
    turnstileEnabled: turnstile.enabled,
    turnstileSiteKey: turnstile.enabled ? turnstile.siteKey : '',
    smsRateLimitSeconds: smsConfig.rateLimitSeconds,
  };
}

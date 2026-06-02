import { getRuntimeMode, type RuntimeMode } from '../adapters/runtime-config.js';
import { getConfig, getDefaultValue, type SystemConfigKey, type SystemConfigValue } from '../config/system-config-schema.js';

export type SmsProviderName = 'console' | 'tencent';

export interface TencentSmsRuntimeConfig {
  secretId: string;
  secretKey: string;
  region: string;
  sdkAppId: string;
  signName: string;
  templateId: string;
}

export interface SmsRuntimeConfig {
  provider: SmsProviderName | '';
  source: 'env' | 'system-config' | 'mixed';
  codeTtlSeconds: number;
  rateLimitSeconds: number;
  testPhoneWhitelist: string[];
  tencent: TencentSmsRuntimeConfig;
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
  turnstileEnabled: boolean;
  turnstileSiteKey: string;
  smsRateLimitSeconds: number;
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
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
  if (provider === 'console' || provider === 'tencent') return provider;
  return '';
}

export async function isSmsRegistrationChallengeEnabled(): Promise<boolean> {
  return getRuntimeMode() === 'cloud' && await readConfig('feature_sms_register');
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
    readConfig('auth_sms_code_ttl_seconds'),
    readConfig('auth_sms_rate_limit_seconds'),
    readConfig('auth_sms_test_phone_whitelist'),
  ]);

  const provider = configuredProvider === 'env' ? envSmsProvider() : configuredProvider;
  const useDbTencent = configuredProvider === 'tencent';
  const hasDbTencentFields = !!(secretId || secretKey || sdkAppId || signName || templateId);

  return {
    provider,
    source: configuredProvider === 'env' ? (hasDbTencentFields ? 'mixed' : 'env') : 'system-config',
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
      turnstileEnabled: false,
      turnstileSiteKey: '',
      smsRateLimitSeconds: smsConfig.rateLimitSeconds,
    };
  }

  const [smsRegisterEnabled, turnstile] = await Promise.all([
    isSmsRegistrationChallengeEnabled(),
    getTurnstileRuntimeConfig(),
  ]);

  return {
    runtimeMode,
    smsRegisterEnabled,
    turnstileEnabled: turnstile.enabled,
    turnstileSiteKey: turnstile.enabled ? turnstile.siteKey : '',
    smsRateLimitSeconds: smsConfig.rateLimitSeconds,
  };
}

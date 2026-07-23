import { getRuntimeMode, type RuntimeMode } from '../adapters/runtime-config.js';
import { getConfig, getDefaultValue, getStrictConfig, type SystemConfigKey, type SystemConfigValue } from '../config/system-config-schema.js';

export type SmsProviderName = 'console' | 'tencent' | 'aliyun';

export type AliyunSmsCredentialSource =
  | 'db_access_key'
  | 'sms_env_access_key'
  | 'mixed_access_key'
  | 'aliyun_env_access_key'
  | 'ecs_ram_role'
  | 'aliyun_default_chain';

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
   * `auto` preserves existing complete SMS AccessKey pairs, otherwise it uses
   * the Alibaba Cloud default credential chain. `ecs_ram_role` is preferred on
   * an Alibaba ECS instance with an attached RAM role.
   */
  credentialMode: 'auto' | 'access_key' | 'ecs_ram_role';
  /** Non-secret provenance for the credential mechanism used by the SMS SDK. */
  credentialSource?: AliyunSmsCredentialSource;
  roleName: string;
  signName: string;
  templateCode: string;
  templateParamName: string;
  registerTemplateCode: string;
  registerTemplateParamName: string;
  passwordResetTemplateCode: string;
  passwordResetTemplateParamName: string;
  smsLoginTemplateCode: string;
  smsLoginTemplateParamName: string;
}

export interface SmsRuntimeConfig {
  provider: SmsProviderName | '';
  source: 'env' | 'system-config' | 'mixed';
  codeTtlSeconds: number;
  rateLimitSeconds: number;
  dailyPerPhoneLimit: number;
  dailyPerIpLimit: number;
  dailyGlobalLimit: number;
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
  const provider = clean(process.env.SMS_PROVIDER)
    || (process.env.NODE_ENV === 'production' ? '' : 'console');
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
  // Provider selection is a security boundary. A database read failure must
  // not silently switch a cloud deployment to another environment provider.
  const configuredProvider = await getStrictConfig('auth_sms_provider');
  const useDbTencent = configuredProvider === 'tencent';
  const useDbAliyun = configuredProvider === 'aliyun';
  const providerConfig = <K extends SystemConfigKey>(key: K, active: boolean) => (
    active ? getStrictConfig(key) : readConfig(key)
  );
  const [
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
    aliyunRegisterTemplateCode,
    aliyunRegisterTemplateParamName,
    aliyunPasswordResetTemplateCode,
    aliyunPasswordResetTemplateParamName,
    aliyunSmsLoginTemplateCode,
    aliyunSmsLoginTemplateParamName,
    codeTtlSeconds,
    rateLimitSeconds,
    dailyPerPhoneLimit,
    dailyPerIpLimit,
    dailyGlobalLimit,
    whitelist,
  ] = await Promise.all([
    providerConfig('auth_sms_tencent_secret_id', useDbTencent),
    providerConfig('auth_sms_tencent_secret_key', useDbTencent),
    providerConfig('auth_sms_tencent_region', useDbTencent),
    providerConfig('auth_sms_tencent_sdk_app_id', useDbTencent),
    providerConfig('auth_sms_tencent_sign_name', useDbTencent),
    providerConfig('auth_sms_tencent_template_id', useDbTencent),
    providerConfig('auth_sms_aliyun_access_key_id', useDbAliyun),
    providerConfig('auth_sms_aliyun_access_key_secret', useDbAliyun),
    providerConfig('auth_sms_aliyun_credential_mode', useDbAliyun),
    providerConfig('auth_sms_aliyun_role_name', useDbAliyun),
    providerConfig('auth_sms_aliyun_sign_name', useDbAliyun),
    providerConfig('auth_sms_aliyun_template_code', useDbAliyun),
    providerConfig('auth_sms_aliyun_template_param_name', useDbAliyun),
    providerConfig('auth_sms_aliyun_register_template_code', useDbAliyun),
    providerConfig('auth_sms_aliyun_register_template_param_name', useDbAliyun),
    providerConfig('auth_sms_aliyun_password_reset_template_code', useDbAliyun),
    providerConfig('auth_sms_aliyun_password_reset_template_param_name', useDbAliyun),
    providerConfig('auth_sms_aliyun_sms_login_template_code', useDbAliyun),
    providerConfig('auth_sms_aliyun_sms_login_template_param_name', useDbAliyun),
    readConfig('auth_sms_code_ttl_seconds'),
    readConfig('auth_sms_rate_limit_seconds'),
    getStrictConfig('auth_sms_daily_per_phone_limit'),
    getStrictConfig('auth_sms_daily_per_ip_limit'),
    getStrictConfig('auth_sms_daily_global_limit'),
    readConfig('auth_sms_test_phone_whitelist'),
  ]);

  const provider = configuredProvider === 'env' ? envSmsProvider() : configuredProvider;
  const aliyunCredentialMode = normalizeAliyunCredentialMode(
    useDbAliyun ? configuredAliyunCredentialMode : process.env.SMS_ALIYUN_CREDENTIAL_MODE,
  );
  const aliyunRoleName = useDbAliyun
    ? clean(configuredAliyunRoleName) || clean(process.env.SMS_ALIYUN_ROLE_NAME || process.env.ALIBABA_CLOUD_ECS_METADATA)
    : clean(process.env.SMS_ALIYUN_ROLE_NAME || process.env.ALIBABA_CLOUD_ECS_METADATA);
  const dbAliyunAccessKeyId = clean(aliyunAccessKeyId);
  const dbAliyunAccessKeySecret = clean(aliyunAccessKeySecret);
  const smsEnvAliyunAccessKeyId = clean(process.env.SMS_ALIYUN_ACCESS_KEY_ID);
  const smsEnvAliyunAccessKeySecret = clean(process.env.SMS_ALIYUN_ACCESS_KEY_SECRET);
  const resolvedAliyunAccessKeyId = useDbAliyun
    ? dbAliyunAccessKeyId || smsEnvAliyunAccessKeyId
    : smsEnvAliyunAccessKeyId;
  const resolvedAliyunAccessKeySecret = useDbAliyun
    ? dbAliyunAccessKeySecret || smsEnvAliyunAccessKeySecret
    : smsEnvAliyunAccessKeySecret;
  const delegatesToAliyunDefaultChain = aliyunCredentialMode === 'auto'
    && !resolvedAliyunAccessKeyId
    && !resolvedAliyunAccessKeySecret;
  const hasAlibabaEnvironmentAccessKey = Boolean(
    clean(process.env.ALIBABA_CLOUD_ACCESS_KEY_ID)
    && clean(process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET),
  );
  const hasAlibabaEcsMetadataRole = Boolean(clean(process.env.ALIBABA_CLOUD_ECS_METADATA));
  const aliyunCredentialSource: AliyunSmsCredentialSource = aliyunCredentialMode === 'ecs_ram_role'
    ? 'ecs_ram_role'
    : delegatesToAliyunDefaultChain
      ? hasAlibabaEnvironmentAccessKey
        ? 'aliyun_env_access_key'
        : hasAlibabaEcsMetadataRole
          ? 'ecs_ram_role'
          : 'aliyun_default_chain'
      : useDbAliyun
        ? (dbAliyunAccessKeyId || dbAliyunAccessKeySecret)
          && ((!dbAliyunAccessKeyId && smsEnvAliyunAccessKeyId)
            || (!dbAliyunAccessKeySecret && smsEnvAliyunAccessKeySecret))
          ? 'mixed_access_key'
          : (!dbAliyunAccessKeyId && smsEnvAliyunAccessKeyId)
            || (!dbAliyunAccessKeySecret && smsEnvAliyunAccessKeySecret)
            ? 'sms_env_access_key'
            : 'db_access_key'
        : 'sms_env_access_key';
  const tencent = {
    secretId: useDbTencent ? clean(secretId) || process.env.SMS_TENCENT_SECRET_ID || '' : process.env.SMS_TENCENT_SECRET_ID || '',
    secretKey: useDbTencent ? clean(secretKey) || process.env.SMS_TENCENT_SECRET_KEY || '' : process.env.SMS_TENCENT_SECRET_KEY || '',
    region: useDbTencent ? clean(region) || process.env.SMS_TENCENT_REGION || 'ap-guangzhou' : process.env.SMS_TENCENT_REGION || 'ap-guangzhou',
    sdkAppId: useDbTencent ? clean(sdkAppId) || process.env.SMS_TENCENT_SDK_APP_ID || '' : process.env.SMS_TENCENT_SDK_APP_ID || '',
    signName: useDbTencent ? clean(signName) || process.env.SMS_TENCENT_SIGN_NAME || '' : process.env.SMS_TENCENT_SIGN_NAME || '',
    templateId: useDbTencent ? clean(templateId) || process.env.SMS_TENCENT_TEMPLATE_ID || '' : process.env.SMS_TENCENT_TEMPLATE_ID || '',
  };
  const aliyun = {
    accessKeyId: resolvedAliyunAccessKeyId,
    accessKeySecret: resolvedAliyunAccessKeySecret,
    credentialMode: aliyunCredentialMode,
    credentialSource: aliyunCredentialSource,
    roleName: aliyunRoleName,
    signName: useDbAliyun ? clean(aliyunSignName) || process.env.SMS_ALIYUN_SIGN_NAME || '' : process.env.SMS_ALIYUN_SIGN_NAME || '',
    templateCode: useDbAliyun ? clean(aliyunTemplateCode) || process.env.SMS_ALIYUN_TEMPLATE_CODE || '' : process.env.SMS_ALIYUN_TEMPLATE_CODE || '',
    templateParamName: useDbAliyun
      ? clean(aliyunTemplateParamName) || process.env.SMS_ALIYUN_TEMPLATE_PARAM_NAME || 'code'
      : process.env.SMS_ALIYUN_TEMPLATE_PARAM_NAME || 'code',
    registerTemplateCode: useDbAliyun
      ? clean(aliyunRegisterTemplateCode) || process.env.SMS_ALIYUN_REGISTER_TEMPLATE_CODE || ''
      : process.env.SMS_ALIYUN_REGISTER_TEMPLATE_CODE || '',
    registerTemplateParamName: useDbAliyun
      ? clean(aliyunRegisterTemplateParamName) || process.env.SMS_ALIYUN_REGISTER_TEMPLATE_PARAM_NAME || 'code'
      : process.env.SMS_ALIYUN_REGISTER_TEMPLATE_PARAM_NAME || 'code',
    passwordResetTemplateCode: useDbAliyun
      ? clean(aliyunPasswordResetTemplateCode) || process.env.SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE || ''
      : process.env.SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE || '',
    passwordResetTemplateParamName: useDbAliyun
      ? clean(aliyunPasswordResetTemplateParamName) || process.env.SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_PARAM_NAME || 'code'
      : process.env.SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_PARAM_NAME || 'code',
    smsLoginTemplateCode: useDbAliyun
      ? clean(aliyunSmsLoginTemplateCode) || process.env.SMS_ALIYUN_SMS_LOGIN_TEMPLATE_CODE || ''
      : process.env.SMS_ALIYUN_SMS_LOGIN_TEMPLATE_CODE || '',
    smsLoginTemplateParamName: useDbAliyun
      ? clean(aliyunSmsLoginTemplateParamName) || process.env.SMS_ALIYUN_SMS_LOGIN_TEMPLATE_PARAM_NAME || 'code'
      : process.env.SMS_ALIYUN_SMS_LOGIN_TEMPLATE_PARAM_NAME || 'code',
  };
  const usesEnvFallback = (dbValue: unknown, envValue: string | undefined) => (
    clean(dbValue).length === 0 && Boolean(envValue)
  );
  let source: SmsRuntimeConfig['source'] = configuredProvider === 'env' ? 'env' : 'system-config';
  if (useDbTencent && [
    [secretId, process.env.SMS_TENCENT_SECRET_ID],
    [secretKey, process.env.SMS_TENCENT_SECRET_KEY],
    [region, process.env.SMS_TENCENT_REGION],
    [sdkAppId, process.env.SMS_TENCENT_SDK_APP_ID],
    [signName, process.env.SMS_TENCENT_SIGN_NAME],
    [templateId, process.env.SMS_TENCENT_TEMPLATE_ID],
  ].some(([dbValue, envValue]) => usesEnvFallback(dbValue, envValue as string | undefined))) {
    source = 'mixed';
  }
  if (useDbAliyun) {
    const fallbackFields: Array<[unknown, string | undefined]> = [
      [aliyunSignName, process.env.SMS_ALIYUN_SIGN_NAME],
    ];
    const usesAccessKeyPair = aliyun.credentialMode === 'access_key'
      || (aliyun.credentialMode === 'auto' && Boolean(aliyun.accessKeyId || aliyun.accessKeySecret));
    if (usesAccessKeyPair) {
      fallbackFields.push(
        [aliyunAccessKeyId, process.env.SMS_ALIYUN_ACCESS_KEY_ID],
        [aliyunAccessKeySecret, process.env.SMS_ALIYUN_ACCESS_KEY_SECRET],
      );
    }
    if (aliyun.credentialMode === 'ecs_ram_role' && aliyun.roleName) {
      fallbackFields.push([
        configuredAliyunRoleName,
        clean(process.env.SMS_ALIYUN_ROLE_NAME || process.env.ALIBABA_CLOUD_ECS_METADATA),
      ]);
    }
    if (aliyun.registerTemplateCode) {
      fallbackFields.push(
        [aliyunRegisterTemplateCode, process.env.SMS_ALIYUN_REGISTER_TEMPLATE_CODE],
        [aliyunRegisterTemplateParamName, process.env.SMS_ALIYUN_REGISTER_TEMPLATE_PARAM_NAME],
      );
    } else if (aliyun.templateCode) {
      fallbackFields.push(
        [aliyunTemplateCode, process.env.SMS_ALIYUN_TEMPLATE_CODE],
        [aliyunTemplateParamName, process.env.SMS_ALIYUN_TEMPLATE_PARAM_NAME],
      );
    }
    if (aliyun.passwordResetTemplateCode) {
      fallbackFields.push(
        [aliyunPasswordResetTemplateCode, process.env.SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE],
        [aliyunPasswordResetTemplateParamName, process.env.SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_PARAM_NAME],
      );
    }
    if (aliyun.smsLoginTemplateCode) {
      fallbackFields.push(
        [aliyunSmsLoginTemplateCode, process.env.SMS_ALIYUN_SMS_LOGIN_TEMPLATE_CODE],
        [aliyunSmsLoginTemplateParamName, process.env.SMS_ALIYUN_SMS_LOGIN_TEMPLATE_PARAM_NAME],
      );
    }
    if (fallbackFields.some(([dbValue, envValue]) => usesEnvFallback(dbValue, envValue))) {
      source = 'mixed';
    }
    // In auto mode the SDK default chain can source the effective identity
    // from ALIBABA_CLOUD_* env, a local profile, URI credentials, or ECS IMDS.
    if (delegatesToAliyunDefaultChain) source = 'mixed';
  }

  return {
    provider,
    source,
    codeTtlSeconds,
    rateLimitSeconds,
    dailyPerPhoneLimit,
    dailyPerIpLimit,
    dailyGlobalLimit,
    testPhoneWhitelist: splitCsv(whitelist),
    tencent,
    aliyun,
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

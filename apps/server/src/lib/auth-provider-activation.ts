import { getRuntimeMode, type RuntimeMode } from '../adapters/runtime-config.js';
import {
  SystemConfigSchema,
  type SystemConfigKey,
} from '../config/system-config-schema.js';

export const AUTH_PROVIDER_PREFLIGHT_KEYS = [
  'feature_sms_register',
  'feature_sms_login',
  'feature_turnstile_login',
  'auth_human_challenge_provider',
  'auth_pow_signing_secret',
  'auth_pow_difficulty',
  'auth_pow_ttl_seconds',
  'auth_turnstile_allowed_hostnames',
  'auth_turnstile_site_key',
  'auth_turnstile_secret_key',
  'auth_sms_provider',
  'auth_sms_tencent_secret_id',
  'auth_sms_tencent_secret_key',
  'auth_sms_tencent_region',
  'auth_sms_tencent_sdk_app_id',
  'auth_sms_tencent_sign_name',
  'auth_sms_tencent_template_id',
  'auth_sms_aliyun_access_key_id',
  'auth_sms_aliyun_access_key_secret',
  'auth_sms_aliyun_credential_mode',
  'auth_sms_aliyun_role_name',
  'auth_sms_aliyun_sign_name',
  'auth_sms_aliyun_template_code',
  'auth_sms_aliyun_template_param_name',
  'auth_sms_aliyun_register_template_code',
  'auth_sms_aliyun_register_template_param_name',
  'auth_sms_aliyun_password_reset_template_code',
  'auth_sms_aliyun_password_reset_template_param_name',
  'auth_sms_aliyun_sms_login_template_code',
  'auth_sms_aliyun_sms_login_template_param_name',
] as const satisfies readonly SystemConfigKey[];

const HUMAN_PREFLIGHT_KEYS = new Set<SystemConfigKey>([
  'feature_turnstile_login',
  'auth_human_challenge_provider',
  'auth_pow_signing_secret',
  'auth_pow_difficulty',
  'auth_pow_ttl_seconds',
  'auth_turnstile_allowed_hostnames',
  'auth_turnstile_site_key',
  'auth_turnstile_secret_key',
]);

const SMS_PREFLIGHT_KEYS = new Set<SystemConfigKey>([
  'feature_sms_register',
  'feature_sms_login',
  'auth_sms_provider',
  'auth_sms_tencent_secret_id',
  'auth_sms_tencent_secret_key',
  'auth_sms_tencent_region',
  'auth_sms_tencent_sdk_app_id',
  'auth_sms_tencent_sign_name',
  'auth_sms_tencent_template_id',
  'auth_sms_aliyun_access_key_id',
  'auth_sms_aliyun_access_key_secret',
  'auth_sms_aliyun_credential_mode',
  'auth_sms_aliyun_role_name',
  'auth_sms_aliyun_sign_name',
  'auth_sms_aliyun_template_code',
  'auth_sms_aliyun_template_param_name',
  'auth_sms_aliyun_register_template_code',
  'auth_sms_aliyun_register_template_param_name',
  'auth_sms_aliyun_password_reset_template_code',
  'auth_sms_aliyun_password_reset_template_param_name',
  'auth_sms_aliyun_sms_login_template_code',
  'auth_sms_aliyun_sms_login_template_param_name',
]);

const HUMAN_POW_KEYS = new Set<SystemConfigKey>([
  'auth_pow_signing_secret',
  'auth_pow_difficulty',
  'auth_pow_ttl_seconds',
]);

const HUMAN_TURNSTILE_KEYS = new Set<SystemConfigKey>([
  'auth_turnstile_allowed_hostnames',
  'auth_turnstile_site_key',
  'auth_turnstile_secret_key',
]);

const SMS_TENCENT_KEYS = new Set<SystemConfigKey>([
  'auth_sms_tencent_secret_id',
  'auth_sms_tencent_secret_key',
  'auth_sms_tencent_region',
  'auth_sms_tencent_sdk_app_id',
  'auth_sms_tencent_sign_name',
  'auth_sms_tencent_template_id',
]);

const SMS_ALIYUN_KEYS = new Set<SystemConfigKey>([
  'auth_sms_aliyun_access_key_id',
  'auth_sms_aliyun_access_key_secret',
  'auth_sms_aliyun_credential_mode',
  'auth_sms_aliyun_role_name',
  'auth_sms_aliyun_sign_name',
  'auth_sms_aliyun_template_code',
  'auth_sms_aliyun_template_param_name',
  'auth_sms_aliyun_register_template_code',
  'auth_sms_aliyun_register_template_param_name',
  'auth_sms_aliyun_password_reset_template_code',
  'auth_sms_aliyun_password_reset_template_param_name',
  'auth_sms_aliyun_sms_login_template_code',
  'auth_sms_aliyun_sms_login_template_param_name',
]);

type AuthProviderPreflightErrorCode =
  | 'system_config_human_challenge_not_ready'
  | 'system_config_sms_provider_not_ready';

export interface AuthProviderPreflightFailure {
  errorCode: AuthProviderPreflightErrorCode;
  msg: string;
}

interface AuthProviderPreflightInput {
  values: ReadonlyMap<SystemConfigKey, string>;
  changedKeys: ReadonlySet<SystemConfigKey>;
  previousValues?: ReadonlyMap<SystemConfigKey, string>;
  env?: NodeJS.ProcessEnv;
  runtimeMode?: RuntimeMode;
}

type HumanChallengeProvider = 'disabled' | 'cloudflare-turnstile' | 'builtin-pow';
type SmsProvider = '' | 'console' | 'tencent' | 'aliyun';

const ALIYUN_TEMPLATE_PARAM_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

export function isAliyunTemplateParamName(value: unknown): boolean {
  return ALIYUN_TEMPLATE_PARAM_PATTERN.test(clean(value));
}

function clean(value: unknown): string {
  return String(value ?? '').trim();
}

function valueOf(values: ReadonlyMap<SystemConfigKey, string>, key: SystemConfigKey): string {
  return clean(values.get(key));
}

function envValue(env: NodeJS.ProcessEnv, key: string): string {
  return clean(env[key]);
}

function hasChanged(changedKeys: ReadonlySet<SystemConfigKey>, keys: ReadonlySet<SystemConfigKey>): boolean {
  return [...changedKeys].some((key) => keys.has(key));
}

function readBoolean(values: ReadonlyMap<SystemConfigKey, string>, key: 'feature_sms_register' | 'feature_sms_login' | 'feature_turnstile_login'): boolean {
  const parsed = SystemConfigSchema[key].safeParse(valueOf(values, key) === 'true'
    ? true
    : valueOf(values, key) === 'false'
      ? false
      : undefined);
  return parsed.success ? parsed.data : SystemConfigSchema[key].parse(undefined);
}

function changedToTrue(
  previousValues: ReadonlyMap<SystemConfigKey, string>,
  values: ReadonlyMap<SystemConfigKey, string>,
  key: 'feature_sms_register' | 'feature_sms_login' | 'feature_turnstile_login',
): boolean {
  return !readBoolean(previousValues, key) && readBoolean(values, key);
}

function humanFailure(msg: string): AuthProviderPreflightFailure {
  return { errorCode: 'system_config_human_challenge_not_ready', msg };
}

function smsFailure(msg: string): AuthProviderPreflightFailure {
  return { errorCode: 'system_config_sms_provider_not_ready', msg };
}

function resolveHumanProvider(
  values: ReadonlyMap<SystemConfigKey, string>,
  env: NodeJS.ProcessEnv,
): HumanChallengeProvider | AuthProviderPreflightFailure {
  const explicitEnvProvider = envValue(env, 'HUMAN_CHALLENGE_PROVIDER');
  if (explicitEnvProvider) {
    if (explicitEnvProvider === 'disabled'
      || explicitEnvProvider === 'cloudflare-turnstile'
      || explicitEnvProvider === 'builtin-pow') {
      return explicitEnvProvider;
    }
    return humanFailure('HUMAN_CHALLENGE_PROVIDER 环境变量无效，认证服务配置未保存');
  }
  if (envValue(env, 'FEATURE_TURNSTILE_LOGIN') === 'true') return 'cloudflare-turnstile';

  const configured = valueOf(values, 'auth_human_challenge_provider');
  if (configured !== 'disabled'
    && configured !== 'cloudflare-turnstile'
    && configured !== 'builtin-pow') {
    return humanFailure('人机验证服务商配置无效，认证服务配置未保存');
  }
  if (configured === 'disabled' && readBoolean(values, 'feature_turnstile_login')) {
    return 'cloudflare-turnstile';
  }
  return configured;
}

function validateHumanChallenge(
  values: ReadonlyMap<SystemConfigKey, string>,
  env: NodeJS.ProcessEnv,
): AuthProviderPreflightFailure | null {
  const resolved = resolveHumanProvider(values, env);
  if (typeof resolved !== 'string') return resolved;
  if (resolved === 'disabled') return null;

  if (resolved === 'builtin-pow') {
    const secret = envValue(env, 'HUMAN_CHALLENGE_SIGNING_SECRET')
      || valueOf(values, 'auth_pow_signing_secret');
    if (secret.length < 32) {
      return humanFailure('内置 PoW 未就绪：工作量证明签名密钥至少需要 32 个字符，认证服务配置未保存');
    }
    const difficulty = Number(
      envValue(env, 'HUMAN_CHALLENGE_POW_DIFFICULTY') || valueOf(values, 'auth_pow_difficulty'),
    );
    const ttlSeconds = Number(
      envValue(env, 'HUMAN_CHALLENGE_TTL_SECONDS') || valueOf(values, 'auth_pow_ttl_seconds'),
    );
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 5) {
      return humanFailure('内置 PoW 未就绪：难度必须是 1-5 的整数，认证服务配置未保存');
    }
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 30 || ttlSeconds > 600) {
      return humanFailure('内置 PoW 未就绪：有效期必须是 30-600 秒的整数，认证服务配置未保存');
    }
    return null;
  }

  const siteKey = envValue(env, 'TURNSTILE_SITE_KEY')
    || envValue(env, 'NEXT_PUBLIC_TURNSTILE_SITE_KEY')
    || valueOf(values, 'auth_turnstile_site_key');
  const secretKey = envValue(env, 'TURNSTILE_SECRET_KEY')
    || valueOf(values, 'auth_turnstile_secret_key');
  const envHostnames = envValue(env, 'TURNSTILE_ALLOWED_HOSTNAMES');
  const rawHostnames = envHostnames || valueOf(values, 'auth_turnstile_allowed_hostnames');
  const hostnameResult = SystemConfigSchema.auth_turnstile_allowed_hostnames.safeParse(rawHostnames);
  const hostnames = hostnameResult.success
    ? rawHostnames.split(',').map((item) => item.trim()).filter(Boolean)
    : [];
  const missing = [
    !siteKey && 'Site Key',
    !secretKey && 'Secret Key',
    hostnames.length === 0 && 'hostname 白名单',
  ].filter((label): label is string => Boolean(label));
  if (missing.length > 0 || !hostnameResult.success) {
    const detail = !hostnameResult.success
      ? 'hostname 白名单格式无效'
      : `缺少 ${missing.join('、')}`;
    return humanFailure(`Cloudflare Turnstile 未就绪：${detail}，认证服务配置未保存`);
  }
  return null;
}

function resolveSmsProvider(
  values: ReadonlyMap<SystemConfigKey, string>,
  env: NodeJS.ProcessEnv,
): { configured: string; effective: SmsProvider } | AuthProviderPreflightFailure {
  const configured = valueOf(values, 'auth_sms_provider');
  if (!['env', 'console', 'tencent', 'aliyun'].includes(configured)) {
    return smsFailure('短信服务来源配置无效，认证服务配置未保存');
  }
  if (configured !== 'env') return { configured, effective: configured as SmsProvider };

  const envProvider = envValue(env, 'SMS_PROVIDER');
  if (envProvider === 'console' || envProvider === 'tencent' || envProvider === 'aliyun') {
    return { configured, effective: envProvider };
  }
  return { configured, effective: '' };
}

function providerValue(
  values: ReadonlyMap<SystemConfigKey, string>,
  key: SystemConfigKey,
  env: NodeJS.ProcessEnv,
  envKey: string,
  useDatabase: boolean,
  fallback = '',
): string {
  if (useDatabase) return valueOf(values, key) || envValue(env, envKey) || fallback;
  return envValue(env, envKey) || fallback;
}

function validateTencentSms(
  values: ReadonlyMap<SystemConfigKey, string>,
  env: NodeJS.ProcessEnv,
  useDatabase: boolean,
): AuthProviderPreflightFailure | null {
  const required = [
    ['SecretId', providerValue(values, 'auth_sms_tencent_secret_id', env, 'SMS_TENCENT_SECRET_ID', useDatabase)],
    ['SecretKey', providerValue(values, 'auth_sms_tencent_secret_key', env, 'SMS_TENCENT_SECRET_KEY', useDatabase)],
    ['SDK AppId', providerValue(values, 'auth_sms_tencent_sdk_app_id', env, 'SMS_TENCENT_SDK_APP_ID', useDatabase)],
    ['签名', providerValue(values, 'auth_sms_tencent_sign_name', env, 'SMS_TENCENT_SIGN_NAME', useDatabase)],
    ['模板 ID', providerValue(values, 'auth_sms_tencent_template_id', env, 'SMS_TENCENT_TEMPLATE_ID', useDatabase)],
  ] as const;
  const missing = required.filter(([, value]) => !value).map(([label]) => label);
  return missing.length > 0
    ? smsFailure(`腾讯云 SMS 未就绪：缺少 ${missing.join('、')}，认证服务配置未保存`)
    : null;
}

function validateAliyunSms(
  values: ReadonlyMap<SystemConfigKey, string>,
  env: NodeJS.ProcessEnv,
  useDatabase: boolean,
): AuthProviderPreflightFailure | null {
  const credentialModeRaw = useDatabase
    ? valueOf(values, 'auth_sms_aliyun_credential_mode') || envValue(env, 'SMS_ALIYUN_CREDENTIAL_MODE')
    : envValue(env, 'SMS_ALIYUN_CREDENTIAL_MODE');
  if (credentialModeRaw
    && credentialModeRaw !== 'auto'
    && credentialModeRaw !== 'access_key'
    && credentialModeRaw !== 'ecs_ram_role') {
    return smsFailure('阿里云 SMS 未就绪：凭据模式无效，认证服务配置未保存');
  }
  const credentialMode = credentialModeRaw === 'access_key' || credentialModeRaw === 'ecs_ram_role'
    ? credentialModeRaw
    : 'auto';
  const accessKeyId = providerValue(values, 'auth_sms_aliyun_access_key_id', env, 'SMS_ALIYUN_ACCESS_KEY_ID', useDatabase);
  const accessKeySecret = providerValue(values, 'auth_sms_aliyun_access_key_secret', env, 'SMS_ALIYUN_ACCESS_KEY_SECRET', useDatabase);
  const signName = providerValue(values, 'auth_sms_aliyun_sign_name', env, 'SMS_ALIYUN_SIGN_NAME', useDatabase);
  const legacyTemplateCode = providerValue(values, 'auth_sms_aliyun_template_code', env, 'SMS_ALIYUN_TEMPLATE_CODE', useDatabase);
  const legacyTemplateParam = providerValue(values, 'auth_sms_aliyun_template_param_name', env, 'SMS_ALIYUN_TEMPLATE_PARAM_NAME', useDatabase, 'code');
  const registerTemplateCode = providerValue(values, 'auth_sms_aliyun_register_template_code', env, 'SMS_ALIYUN_REGISTER_TEMPLATE_CODE', useDatabase);
  const registerTemplateParam = providerValue(values, 'auth_sms_aliyun_register_template_param_name', env, 'SMS_ALIYUN_REGISTER_TEMPLATE_PARAM_NAME', useDatabase, 'code');
  const passwordResetTemplateCode = providerValue(values, 'auth_sms_aliyun_password_reset_template_code', env, 'SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE', useDatabase);
  const passwordResetTemplateParam = providerValue(values, 'auth_sms_aliyun_password_reset_template_param_name', env, 'SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_PARAM_NAME', useDatabase, 'code');
  const smsLoginTemplateCode = providerValue(values, 'auth_sms_aliyun_sms_login_template_code', env, 'SMS_ALIYUN_SMS_LOGIN_TEMPLATE_CODE', useDatabase);
  const smsLoginTemplateParam = providerValue(values, 'auth_sms_aliyun_sms_login_template_param_name', env, 'SMS_ALIYUN_SMS_LOGIN_TEMPLATE_PARAM_NAME', useDatabase, 'code');
  const validateAccessKeyPair = credentialMode === 'access_key'
    || (credentialMode === 'auto' && Boolean(accessKeyId || accessKeySecret));
  const registerEnabled = readBoolean(values, 'feature_sms_register');
  const loginEnabled = readBoolean(values, 'feature_sms_login');
  const effectiveRegisterTemplateCode = registerTemplateCode || legacyTemplateCode;
  const effectiveRegisterTemplateParam = registerTemplateCode
    ? registerTemplateParam
    : legacyTemplateParam;
  const missing = [
    validateAccessKeyPair && !accessKeyId && 'AccessKey ID',
    validateAccessKeyPair && !accessKeySecret && 'AccessKey Secret',
    !signName && '签名',
    registerEnabled && !effectiveRegisterTemplateCode && '注册模板 Code',
    registerEnabled && !effectiveRegisterTemplateParam && '注册模板变量名',
    !passwordResetTemplateCode && '找回密码模板 Code',
    !passwordResetTemplateParam && '找回密码模板变量名',
    loginEnabled && !smsLoginTemplateCode && '短信登录模板 Code',
    loginEnabled && !smsLoginTemplateParam && '短信登录模板变量名',
  ].filter((label): label is string => Boolean(label));
  if (missing.length > 0) {
    return smsFailure(`阿里云 SMS 未就绪：缺少 ${missing.join('、')}，认证服务配置未保存`);
  }

  const invalidParams = [
    registerEnabled
      && effectiveRegisterTemplateCode
      && !isAliyunTemplateParamName(effectiveRegisterTemplateParam)
      && '注册模板变量名',
    passwordResetTemplateCode
      && !isAliyunTemplateParamName(passwordResetTemplateParam)
      && '找回密码模板变量名',
    loginEnabled
      && smsLoginTemplateCode
      && !isAliyunTemplateParamName(smsLoginTemplateParam)
      && '短信登录模板变量名',
  ].filter((label): label is string => Boolean(label));
  return invalidParams.length > 0
    ? smsFailure(`阿里云 SMS 未就绪：${invalidParams.join('、')}格式无效，认证服务配置未保存`)
    : null;
}

function validateSmsProvider(
  values: ReadonlyMap<SystemConfigKey, string>,
  env: NodeJS.ProcessEnv,
): AuthProviderPreflightFailure | null {
  const resolved = resolveSmsProvider(values, env);
  if ('errorCode' in resolved) return resolved;
  if (!resolved.effective) {
    return smsFailure('短信 provider 未就绪：SMS_PROVIDER 环境变量未配置或无效，认证服务配置未保存');
  }
  if (resolved.effective === 'console') {
    return smsFailure('cloud 运行模式禁止启用 console 短信 provider，认证服务配置未保存');
  }
  if (resolved.effective === 'tencent') {
    return validateTencentSms(values, env, resolved.configured === 'tencent');
  }
  return validateAliyunSms(values, env, resolved.configured === 'aliyun');
}

export function requiresAuthProviderPreflight(changedKeys: ReadonlySet<SystemConfigKey>): boolean {
  return hasChanged(changedKeys, HUMAN_PREFLIGHT_KEYS) || hasChanged(changedKeys, SMS_PREFLIGHT_KEYS);
}

export function validateAuthProviderActivation(input: AuthProviderPreflightInput): AuthProviderPreflightFailure | null {
  const runtimeMode = input.runtimeMode ?? getRuntimeMode();
  if (runtimeMode !== 'cloud') return null;
  const env = input.env ?? process.env;
  const previousValues = input.previousValues ?? input.values;

  if (hasChanged(input.changedKeys, HUMAN_PREFLIGHT_KEYS)) {
    const candidateProvider = resolveHumanProvider(input.values, env);
    const previousProvider = resolveHumanProvider(previousValues, env);
    const providerChanged = input.changedKeys.has('auth_human_challenge_provider');
    const providerConfigChanged = typeof candidateProvider === 'string' && (
      (candidateProvider === 'builtin-pow' && hasChanged(input.changedKeys, HUMAN_POW_KEYS))
      || (candidateProvider === 'cloudflare-turnstile'
        && hasChanged(input.changedKeys, HUMAN_TURNSTILE_KEYS))
    );
    const humanActivationChange = providerChanged
      || changedToTrue(previousValues, input.values, 'feature_turnstile_login');
    const shouldValidateHuman = typeof candidateProvider === 'string'
      && candidateProvider !== 'disabled'
      && (
        humanActivationChange
        || (typeof previousProvider === 'string' && previousProvider === candidateProvider && providerConfigChanged)
      );
    if (shouldValidateHuman) {
      const previousFailure = !humanActivationChange
        && typeof previousProvider === 'string'
        && previousProvider === candidateProvider
        ? validateHumanChallenge(previousValues, env)
        : null;
      const humanFailureResult = previousFailure
        ? null
        : validateHumanChallenge(input.values, env);
      if (humanFailureResult) return humanFailureResult;
    } else if (typeof candidateProvider !== 'string' && providerChanged) {
      return candidateProvider;
    }
  }
  if (hasChanged(input.changedKeys, SMS_PREFLIGHT_KEYS)) {
    const smsFeatureEnabled = readBoolean(input.values, 'feature_sms_register')
      || readBoolean(input.values, 'feature_sms_login');
    const providerSelectionChanged = input.changedKeys.has('auth_sms_provider');
    const candidateProvider = resolveSmsProvider(input.values, env);
    const previousProvider = resolveSmsProvider(previousValues, env);
    const candidateName = !('errorCode' in candidateProvider) ? candidateProvider.effective : '';
    const previousName = !('errorCode' in previousProvider) ? previousProvider.effective : '';
    const providerConfigChanged = candidateName === 'tencent'
      ? hasChanged(input.changedKeys, SMS_TENCENT_KEYS)
      : candidateName === 'aliyun'
        ? hasChanged(input.changedKeys, SMS_ALIYUN_KEYS)
        : false;
    const smsActivationChange = providerSelectionChanged
      || (smsFeatureEnabled && (
        changedToTrue(previousValues, input.values, 'feature_sms_register')
        || changedToTrue(previousValues, input.values, 'feature_sms_login')
      ));
    const activeProviderConfigChanged = previousName === candidateName && providerConfigChanged;
    const shouldValidateSms = smsActivationChange || activeProviderConfigChanged;
    if (!shouldValidateSms) return null;
    if (!smsActivationChange && activeProviderConfigChanged) {
      const previousFailure = validateSmsProvider(previousValues, env);
      if (previousFailure) return null;
    }
    return validateSmsProvider(input.values, env);
  }
  return null;
}

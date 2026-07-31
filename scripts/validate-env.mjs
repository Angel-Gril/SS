#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { posix as posixPath } from 'node:path';
import { readExpectedReleaseOrigins } from './extension-release-contract.mjs';

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const eq = args.find((arg) => arg.startsWith(`${name}=`));
  if (eq) return eq.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0 && args[index + 1]) return args[index + 1];
  return fallback;
};

const profile = getArg('--profile', 'cloud-r2');
const envFile = getArg('--env', process.env.ENV_FILE || '.env.staging');

const failures = [];
const warnings = [];

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function isSet(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function isPlaceholder(value) {
  if (!isSet(value)) return false;
  return /replace-with|change-me|yourdomain|example\.com|your-key|LTAI\.\.\.|^\.\.\.$/i.test(value);
}

function requireValue(env, key, options = {}) {
  const value = env[key];
  if (!isSet(value)) {
    fail(`${key} is required`);
    return;
  }
  if (options.minLength && String(value).length < options.minLength) {
    fail(`${key} must be at least ${options.minLength} characters`);
  }
  if (isPlaceholder(value)) {
    fail(`${key} still looks like a placeholder`);
  }
}

function expectValue(env, key, expected) {
  if (env[key] !== expected) {
    fail(`${key} expected ${expected}, got ${env[key] || 'empty'}`);
  }
}

function expectOneOf(env, key, allowed) {
  if (!allowed.includes(env[key])) {
    fail(`${key} expected one of ${allowed.join(', ')}, got ${env[key] || 'empty'}`);
  }
}

function warnIfMissing(env, key) {
  if (!isSet(env[key])) warn(`${key} is empty`);
}

function validateSmsProvider(env) {
  if (!isSet(env.SMS_PROVIDER)) return;
  expectOneOf(env, 'SMS_PROVIDER', ['console', 'tencent', 'aliyun']);
  if (env.SMS_PROVIDER === 'aliyun') {
    const credentialMode = env.SMS_ALIYUN_CREDENTIAL_MODE || 'auto';
    if (isSet(env.SMS_ALIYUN_CREDENTIAL_MODE)) {
      expectOneOf(env, 'SMS_ALIYUN_CREDENTIAL_MODE', ['auto', 'access_key', 'ecs_ram_role']);
    }
    const hasAnySmsAccessKey = isSet(env.SMS_ALIYUN_ACCESS_KEY_ID)
      || isSet(env.SMS_ALIYUN_ACCESS_KEY_SECRET);
    const usesExplicitAccessKey = credentialMode === 'access_key'
      || (credentialMode === 'auto' && hasAnySmsAccessKey);
    if (credentialMode === 'auto' && !hasAnySmsAccessKey
      && env.ALIBABA_CLOUD_IMDSV1_DISABLED !== 'true') {
      fail('SMS_ALIYUN_CREDENTIAL_MODE=auto requires ALIBABA_CLOUD_IMDSV1_DISABLED=true');
    }
    const required = [
      ...(usesExplicitAccessKey
        ? ['SMS_ALIYUN_ACCESS_KEY_ID', 'SMS_ALIYUN_ACCESS_KEY_SECRET']
        : []),
      'SMS_ALIYUN_SIGN_NAME',
      'SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_CODE',
      'SMS_ALIYUN_SMS_LOGIN_TEMPLATE_CODE',
    ];
    for (const key of required) requireValue(env, key);
    if (!isSet(env.SMS_ALIYUN_REGISTER_TEMPLATE_CODE) && !isSet(env.SMS_ALIYUN_TEMPLATE_CODE)) {
      fail('SMS_ALIYUN_REGISTER_TEMPLATE_CODE or legacy SMS_ALIYUN_TEMPLATE_CODE is required');
    }
  }
  const required = env.SMS_PROVIDER === 'tencent'
    ? [
        'SMS_TENCENT_SECRET_ID',
        'SMS_TENCENT_SECRET_KEY',
        'SMS_TENCENT_REGION',
        'SMS_TENCENT_SDK_APP_ID',
        'SMS_TENCENT_SIGN_NAME',
        'SMS_TENCENT_TEMPLATE_ID',
      ]
    : [];
  for (const key of required) requireValue(env, key);
  for (const key of [
    'SMS_ALIYUN_TEMPLATE_PARAM_NAME',
    'SMS_ALIYUN_REGISTER_TEMPLATE_PARAM_NAME',
    'SMS_ALIYUN_PASSWORD_RESET_TEMPLATE_PARAM_NAME',
    'SMS_ALIYUN_SMS_LOGIN_TEMPLATE_PARAM_NAME',
  ]) {
    if (isSet(env[key]) && !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(env[key])) {
      fail(`${key} must be an identifier such as code`);
    }
  }
}

function validateHumanChallenge(env) {
  let provider = env.HUMAN_CHALLENGE_PROVIDER;
  if (isSet(provider)) {
    expectOneOf(env, 'HUMAN_CHALLENGE_PROVIDER', [
      'disabled',
      'cloudflare-turnstile',
      'builtin-pow',
    ]);
  } else if (env.FEATURE_TURNSTILE_LOGIN === 'true') {
    provider = 'cloudflare-turnstile';
  } else {
    return;
  }

  if (provider === 'cloudflare-turnstile') {
    requireValue(env, 'TURNSTILE_SECRET_KEY');
    requireValue(env, 'NEXT_PUBLIC_TURNSTILE_SITE_KEY');
    requireValue(env, 'TURNSTILE_ALLOWED_HOSTNAMES');
    const hostnames = String(env.TURNSTILE_ALLOWED_HOSTNAMES || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    for (const hostname of hostnames) {
      if (hostname.length > 253
        || hostname.endsWith('.')
        || !hostname.split('.').every((label) => (
          label.length >= 1
          && label.length <= 63
          && /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/.test(label)
        ))) {
        fail(`TURNSTILE_ALLOWED_HOSTNAMES contains invalid hostname: ${hostname}`);
      }
    }
  }

  if (provider === 'builtin-pow') {
    requireValue(env, 'HUMAN_CHALLENGE_SIGNING_SECRET', { minLength: 32 });
    if (isSet(env.HUMAN_CHALLENGE_POW_DIFFICULTY)
      && !['1', '2', '3', '4', '5'].includes(env.HUMAN_CHALLENGE_POW_DIFFICULTY)) {
      fail('HUMAN_CHALLENGE_POW_DIFFICULTY expected an integer from 1 to 5');
    }
    if (isSet(env.HUMAN_CHALLENGE_TTL_SECONDS)) {
      const ttl = Number(env.HUMAN_CHALLENGE_TTL_SECONDS);
      if (!Number.isInteger(ttl) || ttl < 30 || ttl > 600) {
        fail('HUMAN_CHALLENGE_TTL_SECONDS expected an integer from 30 to 600');
      }
    }
  }
}

function validateDeploymentHosts(env) {
  const keys = [
    'NEXT_PUBLIC_USER_HOSTNAME',
    'NEXT_PUBLIC_ADMIN_HOSTNAME',
    'NEXT_PUBLIC_MARKETING_HOSTNAME',
  ];
  const configured = keys.filter((key) => isSet(env[key]));
  if (configured.length !== 0 && configured.length !== keys.length) {
    fail(`${keys.join(', ')} must be configured together or all left empty`);
    return;
  }
  for (const key of configured) {
    const value = String(env[key]).trim();
    if (value.length > 253
      || !/^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(value)) {
      fail(`${key} must be a hostname without a scheme, port, path, query, or fragment`);
    }
  }
}

function loadEnv(path) {
  if (!existsSync(path)) {
    fail(`env file not found: ${path}`);
    return {};
  }
  return parseEnv(readFileSync(path, 'utf8'));
}

function parseEnv(content) {
  const env = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const normalized = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = normalized.indexOf('=');
    if (eq <= 0) continue;

    const key = normalized.slice(0, eq).trim();
    let value = normalized.slice(eq + 1).trim();
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) {
      value = value.slice(1, -1);
      if (quote === '"') {
        value = value
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      }
    } else {
      const commentIndex = value.search(/\s+#/);
      if (commentIndex >= 0) value = value.slice(0, commentIndex).trim();
    }
    env[key] = value;
  }
  return env;
}

function validateBootstrapBase(env) {
  requireValue(env, 'DATABASE_URL');
  if (env.REDIS_DISABLED !== '1' && env.REDIS_DISABLED !== 'true') {
    requireValue(env, 'REDIS_URL');
  }
  requireValue(env, 'JWT_SECRET', { minLength: 16 });
  requireValue(env, 'ENCRYPTION_KEY', { minLength: 32 });
  validateDeploymentHosts(env);
  for (const key of [
    'LOGISTICS_DISTRIBUTION_ENABLED',
    'EXTENSION_DEVICE_AUTH_ENABLED',
    'AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS',
    'NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED',
    'NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED',
  ]) {
    if (isSet(env[key]) && !['true', 'false'].includes(env[key])) {
      fail(`${key} expected true/false, got ${env[key]}`);
    }
  }
  if (
    isSet(env.EXTENSION_AUTH_MODE) &&
    !['compat', 'device-only'].includes(env.EXTENSION_AUTH_MODE)
  ) {
    fail(`EXTENSION_AUTH_MODE expected compat or device-only, got ${env.EXTENSION_AUTH_MODE}`);
  }
  if (
    env.NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED === 'true' &&
    env.LOGISTICS_DISTRIBUTION_ENABLED !== 'true'
  ) {
    fail('NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED requires LOGISTICS_DISTRIBUTION_ENABLED=true');
  }
  if (
    env.NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED === 'true' &&
    env.EXTENSION_DEVICE_AUTH_ENABLED !== 'true' &&
    env.LOGISTICS_DISTRIBUTION_ENABLED !== 'true'
  ) {
    fail('NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED requires extension device auth on the server');
  }
  if (
    env.LOGISTICS_DISTRIBUTION_ENABLED === 'true' ||
    env.EXTENSION_DEVICE_AUTH_ENABLED === 'true'
  ) {
    requireValue(env, 'SS_ERP_DEPLOYMENT_ID');
    requireValue(env, 'AUTH_JWT_ISSUER');
    requireValue(env, 'EXTENSION_DEVICE_JWT_SECRET', { minLength: 32 });
    requireValue(env, 'EXTENSION_COMMAND_GRANT_SECRET', { minLength: 32 });
    if (
      isSet(env.SS_ERP_DEPLOYMENT_ID) &&
      (env.SS_ERP_DEPLOYMENT_ID === 'local-dev' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/.test(env.SS_ERP_DEPLOYMENT_ID))
    ) {
      fail('SS_ERP_DEPLOYMENT_ID is not valid for production');
    }
    if (
      isSet(env.AUTH_JWT_ISSUER) &&
      (env.AUTH_JWT_ISSUER === 'ss-erp-local' ||
        !/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,199}$/.test(env.AUTH_JWT_ISSUER))
    ) {
      fail('AUTH_JWT_ISSUER is not valid for production');
    }
    if (
      isSet(env.EXTENSION_DEVICE_JWT_SECRET) &&
      env.EXTENSION_DEVICE_JWT_SECRET === env.JWT_SECRET
    ) {
      fail('EXTENSION_DEVICE_JWT_SECRET must differ from JWT_SECRET');
    }
    if (
      isSet(env.EXTENSION_COMMAND_GRANT_SECRET) &&
      [env.JWT_SECRET, env.EXTENSION_DEVICE_JWT_SECRET].includes(env.EXTENSION_COMMAND_GRANT_SECRET)
    ) {
      fail('EXTENSION_COMMAND_GRANT_SECRET must differ from JWT secrets');
    }
  }
  expectOneOf(env, 'RUNTIME_MODE', ['local', 'cloud']);
  expectOneOf(env, 'LEGAL_PROFILE', ['local', 'cloud-cn', 'cloud-global', 'self-hosted']);
  if (isSet(env.AUTH_COOKIE_SECURE) && !['true', 'false'].includes(env.AUTH_COOKIE_SECURE)) {
    fail(`AUTH_COOKIE_SECURE expected true/false, got ${env.AUTH_COOKIE_SECURE}`);
  }
}

function validateCommon(env) {
  validateBootstrapBase(env);
  expectOneOf(env, 'IMAGE_STORAGE_BACKEND', ['local', 'oss', 'ozon-cdn']);
}

function validateExtensionReleaseOrigins(env) {
  try {
    readExpectedReleaseOrigins(env);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

function validateDeployBackupConfig(env) {
  requireValue(env, 'DEPLOY_DATABASE_ID');
  requireValue(env, 'DEPLOY_BACKUP_LOCAL_DIR');
  if (isSet(env.DEPLOY_DATABASE_ID)
    && !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(env.DEPLOY_DATABASE_ID)) {
    fail('DEPLOY_DATABASE_ID must be a canonical deployment database identifier');
  }
  const deployBackupDirectory = isSet(env.DEPLOY_BACKUP_LOCAL_DIR)
    ? posixPath.normalize(env.DEPLOY_BACKUP_LOCAL_DIR)
    : '';
  const applicationBackupDirectory = isSet(env.BACKUP_LOCAL_DIR)
    ? posixPath.normalize(env.BACKUP_LOCAL_DIR)
    : '';
  if (deployBackupDirectory
    && (!env.DEPLOY_BACKUP_LOCAL_DIR.startsWith('/')
      || env.DEPLOY_BACKUP_LOCAL_DIR !== deployBackupDirectory
      || deployBackupDirectory === '/')) {
    fail('DEPLOY_BACKUP_LOCAL_DIR must be one canonical absolute path');
  }
  if (deployBackupDirectory && !deployBackupDirectory.startsWith('/var/backups/')) {
    fail('DEPLOY_BACKUP_LOCAL_DIR must be located beneath /var/backups');
  }
  if (applicationBackupDirectory
    && (!env.BACKUP_LOCAL_DIR.startsWith('/')
      || env.BACKUP_LOCAL_DIR !== applicationBackupDirectory)) {
    fail('BACKUP_LOCAL_DIR must be one canonical absolute path when set in the application env');
  }
  if (applicationBackupDirectory
    && applicationBackupDirectory === deployBackupDirectory) {
    fail('DEPLOY_BACKUP_LOCAL_DIR must be separate from application BACKUP_LOCAL_DIR');
  }
  if (isSet(env.DEPLOY_BACKUP_MAX_AGE_MINUTES)
    && (!/^[1-9][0-9]{0,3}$/.test(env.DEPLOY_BACKUP_MAX_AGE_MINUTES)
      || Number(env.DEPLOY_BACKUP_MAX_AGE_MINUTES) > 1440)) {
    fail('DEPLOY_BACKUP_MAX_AGE_MINUTES must be an integer from 1 through 1440');
  }
  if (isSet(env.DEPLOY_BACKUP_VERIFY_TIMEOUT)) {
    const match = env.DEPLOY_BACKUP_VERIFY_TIMEOUT.match(/^([1-9][0-9]*)([smh])$/);
    const multipliers = { s: 1, m: 60, h: 3600 };
    const seconds = match
      ? Number(match[1]) * multipliers[match[2]]
      : Number.NaN;
    if (!Number.isSafeInteger(seconds) || seconds > 24 * 60 * 60) {
      fail('DEPLOY_BACKUP_VERIFY_TIMEOUT must be a positive duration no longer than 24 hours');
    }
  }
}

function validateCloudR2(env) {
  validateCommon(env);
  validateExtensionReleaseOrigins(env);
  validateDeployBackupConfig(env);
  expectValue(env, 'RUNTIME_MODE', 'cloud');
  expectValue(env, 'IMAGE_STORAGE_BACKEND', 'oss');
  expectValue(env, 'NEXT_PUBLIC_RUNTIME_MODE', 'cloud');
  requireValue(env, 'NEXT_PUBLIC_API_BASE_URL');
  requireValue(env, 'CORS_ORIGIN');
  requireValue(env, 'OSS_ENDPOINT');
  requireValue(env, 'OSS_BUCKET');
  requireValue(env, 'OSS_ACCESS_KEY_ID');
  requireValue(env, 'OSS_ACCESS_KEY_SECRET');
  requireValue(env, 'OSS_REGION');

  warnIfMissing(env, 'TURNSTILE_SECRET_KEY');
  warnIfMissing(env, 'NEXT_PUBLIC_TURNSTILE_SITE_KEY');
  warnIfMissing(env, 'SMS_PROVIDER');
  if (env.SMS_PROVIDER === 'console') fail('SMS_PROVIDER=console is not allowed in cloud profiles');
  validateSmsProvider(env);
  validateHumanChallenge(env);
}

function validateCloudBootstrap(env) {
  validateBootstrapBase(env);
  validateExtensionReleaseOrigins(env);
  validateDeployBackupConfig(env);
  expectValue(env, 'RUNTIME_MODE', 'cloud');
  expectValue(env, 'NEXT_PUBLIC_RUNTIME_MODE', 'cloud');
  requireValue(env, 'CORS_ORIGIN');
  requireValue(env, 'NEXT_PUBLIC_API_BASE_URL');

  warnIfMissing(env, 'LOCAL_BASE_URL');
  warnIfMissing(env, 'TURNSTILE_SECRET_KEY');
  warnIfMissing(env, 'NEXT_PUBLIC_TURNSTILE_SITE_KEY');
  warnIfMissing(env, 'SMS_PROVIDER');
  if (env.SMS_PROVIDER === 'console') fail('SMS_PROVIDER=console is not allowed in cloud profiles');
  validateSmsProvider(env);
  validateHumanChallenge(env);
}

function validateLocal(env) {
  validateCommon(env);
  expectValue(env, 'RUNTIME_MODE', 'local');
  expectValue(env, 'IMAGE_STORAGE_BACKEND', 'local');
  if (isSet(env.NEXT_PUBLIC_RUNTIME_MODE)) expectValue(env, 'NEXT_PUBLIC_RUNTIME_MODE', 'local');
  if (isSet(env.SMS_PROVIDER) && env.SMS_PROVIDER !== 'console') {
    warn(`local profile usually uses SMS_PROVIDER=console, got ${env.SMS_PROVIDER}`);
  }
}

const env = loadEnv(envFile);
if (failures.length === 0) {
  if (profile === 'cloud-r2') validateCloudR2(env);
  else if (profile === 'cloud-bootstrap') validateCloudBootstrap(env);
  else if (profile === 'local') validateLocal(env);
  else fail(`unknown profile: ${profile}`);
}

console.log(`SS ERP env validation: ${envFile}`);
console.log(`Profile: ${profile}`);

for (const message of warnings) {
  console.log(`WARN ${message}`);
}

if (failures.length) {
  for (const message of failures) {
    console.error(`FAIL ${message}`);
  }
  console.error(`Result: ${failures.length} failure(s), ${warnings.length} warning(s)`);
  process.exit(1);
}

console.log(`PASS ${Object.keys(env).length} env keys parsed`);
console.log(`Result: 0 failure(s), ${warnings.length} warning(s)`);

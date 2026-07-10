#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';

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

function validateCloudR2(env) {
  validateCommon(env);
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
  if (env.SMS_PROVIDER === 'tencent') {
    for (const key of [
      'SMS_TENCENT_SECRET_ID',
      'SMS_TENCENT_SECRET_KEY',
      'SMS_TENCENT_REGION',
      'SMS_TENCENT_SDK_APP_ID',
      'SMS_TENCENT_SIGN_NAME',
      'SMS_TENCENT_TEMPLATE_ID',
    ]) {
      requireValue(env, key);
    }
  }
}

function validateCloudBootstrap(env) {
  validateBootstrapBase(env);
  expectValue(env, 'RUNTIME_MODE', 'cloud');
  expectValue(env, 'NEXT_PUBLIC_RUNTIME_MODE', 'cloud');
  requireValue(env, 'CORS_ORIGIN');
  requireValue(env, 'NEXT_PUBLIC_API_BASE_URL');

  warnIfMissing(env, 'LOCAL_BASE_URL');
  warnIfMissing(env, 'TURNSTILE_SECRET_KEY');
  warnIfMissing(env, 'NEXT_PUBLIC_TURNSTILE_SITE_KEY');
  warnIfMissing(env, 'SMS_PROVIDER');
  if (env.SMS_PROVIDER === 'tencent') {
    for (const key of [
      'SMS_TENCENT_SECRET_ID',
      'SMS_TENCENT_SECRET_KEY',
      'SMS_TENCENT_REGION',
      'SMS_TENCENT_SDK_APP_ID',
      'SMS_TENCENT_SIGN_NAME',
      'SMS_TENCENT_TEMPLATE_ID',
    ]) {
      requireValue(env, key);
    }
  }
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

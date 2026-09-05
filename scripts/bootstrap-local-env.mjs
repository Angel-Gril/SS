#!/usr/bin/env node
import { createHash, randomBytes as nodeRandomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const LOCAL_DEFAULTS = Object.freeze({
  REDIS_DISABLED: '0',
  EXTENSION_AUTH_MODE: 'compat',
  LOGISTICS_DISTRIBUTION_ENABLED: 'false',
  OZON_GLOBAL_CALCULATOR_LOCATIONS_ENABLED: 'false',
  OZON_GLOBAL_CALCULATOR_STATIC_PILOT_FALLBACK_ENABLED: 'false',
  AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS: 'true',
  AUTH_COOKIE_SECURE: 'false',
  NODE_ENV: 'development',
  LOG_LEVEL: 'info',
  RUNTIME_MODE: 'local',
  NEXT_PUBLIC_RUNTIME_MODE: 'local',
  NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED: 'false',
  HUMAN_CHALLENGE_PROVIDER: 'disabled',
  SMS_PROVIDER: 'console',
  IMAGE_STORAGE_BACKEND: 'local',
  LOCAL_BASE_URL: 'http://localhost:3001',
  OSS_FALLBACK_TO_CDN: 'true',
  LEGAL_PROFILE: 'local',
});

const PLACEHOLDER_PATTERN = /(?:change-me|replace-with|your-key|dummy|placeholder)/iu;

function unquote(value) {
  const trimmed = String(value || '').trim();
  if (trimmed.length >= 2 && ['"', "'"].includes(trimmed[0]) && trimmed.at(-1) === trimmed[0]) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseEntries(lines) {
  const entries = new Map();
  lines.forEach((line, index) => {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/u);
    if (match) entries.set(match[1], { index, value: unquote(match[2]) });
  });
  return entries;
}

function isUnsafeSecret(value, minimumLength) {
  const normalized = String(value || '').trim();
  return normalized.length < minimumLength || PLACEHOLDER_PATTERN.test(normalized);
}

function deterministicSecret(label, randomBytes) {
  return createHash('sha256')
    .update(label)
    .update(randomBytes(32))
    .digest('hex');
}

export function prepareLocalEnv(content, options = {}) {
  const randomBytes = options.randomBytes || nodeRandomBytes;
  const hadTrailingNewline = /\r?\n$/u.test(content);
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  const lines = content.split(/\r?\n/u);
  if (hadTrailingNewline) lines.pop();
  const entries = parseEntries(lines);
  const runtimeMode = entries.get('RUNTIME_MODE')?.value;
  if (runtimeMode && runtimeMode !== 'local') {
    throw new Error('refusing to rewrite a non-local environment');
  }

  const changedKeys = [];
  const setValue = (key, value, replace = false) => {
    const current = entries.get(key);
    if (current && !replace) return;
    const line = `${key}="${String(value).replaceAll('"', '\\"')}"`;
    if (current) {
      if (lines[current.index] === line) return;
      lines[current.index] = line;
      current.value = String(value);
    } else {
      lines.push(line);
      entries.set(key, { index: lines.length - 1, value: String(value) });
    }
    changedKeys.push(key);
  };

  for (const [key, value] of Object.entries(LOCAL_DEFAULTS)) setValue(key, value);

  for (const [key, minimumLength] of [['JWT_SECRET', 32], ['ENCRYPTION_KEY', 32]]) {
    const current = entries.get(key)?.value || '';
    if (isUnsafeSecret(current, minimumLength)) {
      setValue(key, deterministicSecret(key, randomBytes), true);
    }
  }

  const deviceAuthEnabled = ['true', '1'].includes(
    String(entries.get('EXTENSION_DEVICE_AUTH_ENABLED')?.value || '').toLowerCase(),
  ) || ['true', '1'].includes(
    String(entries.get('LOGISTICS_DISTRIBUTION_ENABLED')?.value || '').toLowerCase(),
  );

  if (deviceAuthEnabled) {
    let deploymentId = entries.get('SS_ERP_DEPLOYMENT_ID')?.value || '';
    if (!deploymentId || deploymentId === 'local-dev' || PLACEHOLDER_PATTERN.test(deploymentId)) {
      deploymentId = `local-${randomBytes(8).toString('hex')}`;
      setValue('SS_ERP_DEPLOYMENT_ID', deploymentId, true);
    }
    const issuer = entries.get('AUTH_JWT_ISSUER')?.value || '';
    if (!issuer || issuer === 'ss-erp-local' || PLACEHOLDER_PATTERN.test(issuer)) {
      setValue('AUTH_JWT_ISSUER', `ss-erp-${deploymentId}`, true);
    }
    for (const key of ['EXTENSION_DEVICE_JWT_SECRET', 'EXTENSION_COMMAND_GRANT_SECRET']) {
      const current = entries.get(key)?.value || '';
      if (isUnsafeSecret(current, 32)) {
        setValue(key, deterministicSecret(key, randomBytes), true);
      }
    }
  }

  const nextContent = `${lines.join(newline)}${newline}`;
  return {
    changed: nextContent !== content,
    content: nextContent,
    summary: changedKeys.map((key) => `${key}: updated`),
  };
}

function argumentValue(name, fallback) {
  const args = process.argv.slice(2);
  const direct = args.find((arg) => arg.startsWith(`${name}=`));
  if (direct) return direct.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
}

function main() {
  const target = resolve(argumentValue('--env', '.env'));
  if (!existsSync(target)) {
    console.error(`Local env file not found: ${target}`);
    process.exitCode = 1;
    return;
  }
  const current = readFileSync(target, 'utf8');
  const result = prepareLocalEnv(current);
  if (result.changed) writeFileSync(target, result.content, 'utf8');
  console.log(result.changed
    ? `Updated ${result.summary.length} local environment keys without printing values.`
    : 'Local environment already satisfies the bootstrap baseline.');
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) main();

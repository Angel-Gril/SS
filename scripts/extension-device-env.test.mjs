import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ACCOUNT_SECRET = '0123456789abcdef0123456789abcdef';
const DEVICE_SECRET = 'fedcba9876543210fedcba9876543210';
const COMMAND_GRANT_SECRET = 'abcdef0123456789abcdef0123456789';

function baseEnv(extra = []) {
  return [
    'DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/db?schema=public',
    'DEPLOY_DATABASE_ID=test-primary',
    'DEPLOY_BACKUP_LOCAL_DIR=/var/backups/ss-erp-deploy',
    'REDIS_URL=redis://127.0.0.1:6379',
    `JWT_SECRET=${ACCOUNT_SECRET}`,
    'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
    'RUNTIME_MODE=cloud',
    'LEGAL_PROFILE=cloud-global',
    'NEXT_PUBLIC_RUNTIME_MODE=cloud',
    'NEXT_PUBLIC_API_BASE_URL=https://ss-erp.example',
    'EXTENSION_RELEASE_EXPECTED_WEB_ORIGIN=https://app.ss-erp.example',
    'EXTENSION_RELEASE_EXPECTED_ADMIN_ORIGIN=https://admin.ss-erp.example',
    'EXTENSION_RELEASE_EXPECTED_API_ORIGIN=https://ss-erp.example',
    'EXTENSION_RELEASE_EXPECTED_LOCAL_ORIGIN=http://127.0.0.1:3001',
    'CORS_ORIGIN=https://ss-erp.example',
    'AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS=true',
    'EXTENSION_AUTH_MODE=compat',
    ...extra,
    '',
  ].join('\n');
}

function validate(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'ss-erp-device-env-'));
  const envPath = join(dir, '.env.test');
  writeFileSync(envPath, contents);
  try {
    return spawnSync(
      process.execPath,
      ['scripts/validate-env.mjs', '--profile', 'cloud-bootstrap', '--env', envPath],
      { cwd: process.cwd(), encoding: 'utf8' },
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('device auth env is optional while logistics distribution is disabled', () => {
  const result = validate(baseEnv(['LOGISTICS_DISTRIBUTION_ENABLED=false']));
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test('enabled logistics distribution requires isolated device auth settings', () => {
  const missing = validate(baseEnv(['LOGISTICS_DISTRIBUTION_ENABLED=true']));
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /SS_ERP_DEPLOYMENT_ID is required/);
  assert.match(missing.stderr, /AUTH_JWT_ISSUER is required/);
  assert.match(missing.stderr, /EXTENSION_DEVICE_JWT_SECRET is required/);
  assert.match(missing.stderr, /EXTENSION_COMMAND_GRANT_SECRET is required/);

  const valid = validate(
    baseEnv([
      'LOGISTICS_DISTRIBUTION_ENABLED=true',
      'SS_ERP_DEPLOYMENT_ID=cloud-global-prod',
      'AUTH_JWT_ISSUER=ss-erp-cloud-global',
      `EXTENSION_DEVICE_JWT_SECRET=${DEVICE_SECRET}`,
      `EXTENSION_COMMAND_GRANT_SECRET=${COMMAND_GRANT_SECRET}`,
    ]),
  );
  assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);
});

test('device auth env parsing fails closed for malformed flags and shared secrets', () => {
  const malformed = validate(baseEnv(['LOGISTICS_DISTRIBUTION_ENABLED=yes']));
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /LOGISTICS_DISTRIBUTION_ENABLED expected true\/false/);

  const malformedMode = validate(baseEnv(['EXTENSION_AUTH_MODE=legacy']));
  assert.equal(malformedMode.status, 1);
  assert.match(malformedMode.stderr, /EXTENSION_AUTH_MODE expected compat or device-only/);

  const sharedSecret = validate(
    baseEnv([
      'LOGISTICS_DISTRIBUTION_ENABLED=true',
      'SS_ERP_DEPLOYMENT_ID=cloud-global-prod',
      'AUTH_JWT_ISSUER=ss-erp-cloud-global',
      `EXTENSION_DEVICE_JWT_SECRET=${ACCOUNT_SECRET}`,
    ]),
  );
  assert.equal(sharedSecret.status, 1);
  assert.match(sharedSecret.stderr, /EXTENSION_DEVICE_JWT_SECRET must differ from JWT_SECRET/);
});

test('production env example documents the disabled-by-default device auth rollout', () => {
  const source = readFileSync('.env.production.example', 'utf8');
  for (const key of [
    'EXTENSION_AUTH_MODE',
    'LOGISTICS_DISTRIBUTION_ENABLED',
    'NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED',
    'EXTENSION_DEVICE_AUTH_ENABLED',
    'NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED',
    'SS_ERP_DEPLOYMENT_ID',
    'AUTH_JWT_ISSUER',
    'EXTENSION_DEVICE_JWT_SECRET',
    'EXTENSION_COMMAND_GRANT_SECRET',
    'AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS',
  ]) {
    assert.match(source, new RegExp(`^${key}=`, 'm'));
  }
  assert.match(source, /^EXTENSION_AUTH_MODE=compat\r?$/m);
  assert.match(source, /^LOGISTICS_DISTRIBUTION_ENABLED=false\r?$/m);
  assert.match(source, /^NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED=false\r?$/m);
  assert.match(source, /^EXTENSION_DEVICE_AUTH_ENABLED=false\r?$/m);
  assert.match(source, /^NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED=false\r?$/m);
});

test('staging env example documents independent device pairing as disabled by default', () => {
  const source = readFileSync('.env.staging.example', 'utf8');
  for (const key of [
    'EXTENSION_DEVICE_AUTH_ENABLED',
    'NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED',
    'SS_ERP_DEPLOYMENT_ID',
    'AUTH_JWT_ISSUER',
    'EXTENSION_DEVICE_JWT_SECRET',
    'EXTENSION_COMMAND_GRANT_SECRET',
  ]) {
    assert.match(source, new RegExp(`^${key}=`, 'm'));
  }
  assert.match(source, /^EXTENSION_DEVICE_AUTH_ENABLED=false\r?$/m);
  assert.match(source, /^NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED=false\r?$/m);
});

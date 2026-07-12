import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const ACCOUNT_SECRET = '0123456789abcdef0123456789abcdef';
const DEVICE_SECRET = 'fedcba9876543210fedcba9876543210';

function baseEnv(extra = []) {
  return [
    'DATABASE_URL=postgresql://user:pass@127.0.0.1:5432/db?schema=public',
    'REDIS_URL=redis://127.0.0.1:6379',
    `JWT_SECRET=${ACCOUNT_SECRET}`,
    'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
    'RUNTIME_MODE=cloud',
    'LEGAL_PROFILE=cloud-global',
    'NEXT_PUBLIC_RUNTIME_MODE=cloud',
    'NEXT_PUBLIC_API_BASE_URL=https://ss-erp.example',
    'CORS_ORIGIN=https://ss-erp.example',
    'AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS=true',
    ...extra,
    '',
  ].join('\n');
}

function validate(contents) {
  const dir = mkdtempSync(join(tmpdir(), 'ss-erp-device-env-'));
  const envPath = join(dir, '.env.test');
  writeFileSync(envPath, contents);
  try {
    return spawnSync(process.execPath, [
      'scripts/validate-env.mjs',
      '--profile',
      'cloud-bootstrap',
      '--env',
      envPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });
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

  const valid = validate(baseEnv([
    'LOGISTICS_DISTRIBUTION_ENABLED=true',
    'SS_ERP_DEPLOYMENT_ID=cloud-global-prod',
    'AUTH_JWT_ISSUER=ss-erp-cloud-global',
    `EXTENSION_DEVICE_JWT_SECRET=${DEVICE_SECRET}`,
  ]));
  assert.equal(valid.status, 0, `${valid.stdout}\n${valid.stderr}`);
});

test('device auth env parsing fails closed for malformed flags and shared secrets', () => {
  const malformed = validate(baseEnv(['LOGISTICS_DISTRIBUTION_ENABLED=yes']));
  assert.equal(malformed.status, 1);
  assert.match(malformed.stderr, /LOGISTICS_DISTRIBUTION_ENABLED expected true\/false/);

  const sharedSecret = validate(baseEnv([
    'LOGISTICS_DISTRIBUTION_ENABLED=true',
    'SS_ERP_DEPLOYMENT_ID=cloud-global-prod',
    'AUTH_JWT_ISSUER=ss-erp-cloud-global',
    `EXTENSION_DEVICE_JWT_SECRET=${ACCOUNT_SECRET}`,
  ]));
  assert.equal(sharedSecret.status, 1);
  assert.match(sharedSecret.stderr, /EXTENSION_DEVICE_JWT_SECRET must differ from JWT_SECRET/);
});

test('production env example documents the disabled-by-default device auth rollout', () => {
  const source = readFileSync('.env.production.example', 'utf8');
  for (const key of [
    'LOGISTICS_DISTRIBUTION_ENABLED',
    'SS_ERP_DEPLOYMENT_ID',
    'AUTH_JWT_ISSUER',
    'EXTENSION_DEVICE_JWT_SECRET',
    'AUTH_ACCEPT_LEGACY_ACCOUNT_TOKENS',
  ]) {
    assert.match(source, new RegExp(`^${key}=`, 'm'));
  }
  assert.match(source, /^LOGISTICS_DISTRIBUTION_ENABLED=false\r?$/m);
});

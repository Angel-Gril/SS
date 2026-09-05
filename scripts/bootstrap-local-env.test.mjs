import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prepareLocalEnv } from './bootstrap-local-env.mjs';

const deterministicBytes = (size) => Buffer.alloc(size, 0xab);

test('fills the local runtime profile and replaces only unsafe local placeholders', () => {
  const input = [
    '# local settings',
    'DATABASE_URL="postgresql://sserp:sserp@localhost:5432/sserp"',
    'REDIS_URL="redis://localhost:6379"',
    'JWT_SECRET="dev-secret-change-me"',
    'ENCRYPTION_KEY="keep-this-real-encryption-key-1234567890"',
    'EXTENSION_DEVICE_AUTH_ENABLED="true"',
    'NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED="true"',
    'SS_ERP_DEPLOYMENT_ID="local-dev"',
    'AUTH_JWT_ISSUER="ss-erp-local"',
    'EXTENSION_DEVICE_JWT_SECRET="device-secret-that-is-already-long-enough"',
    'EXTENSION_COMMAND_GRANT_SECRET="command-secret-that-is-already-long-enough"',
    '',
  ].join('\n');

  const result = prepareLocalEnv(input, { randomBytes: deterministicBytes });

  assert.equal(result.changed, true);
  assert.match(result.content, /^RUNTIME_MODE="local"$/mu);
  assert.match(result.content, /^NEXT_PUBLIC_RUNTIME_MODE="local"$/mu);
  assert.match(result.content, /^IMAGE_STORAGE_BACKEND="local"$/mu);
  assert.match(result.content, /^LOCAL_BASE_URL="http:\/\/localhost:3001"$/mu);
  assert.match(result.content, /^LEGAL_PROFILE="local"$/mu);
  assert.match(result.content, /^JWT_SECRET="[a-f0-9]{64}"$/mu);
  assert.match(result.content, /^SS_ERP_DEPLOYMENT_ID="local-[a-f0-9]{16}"$/mu);
  assert.match(result.content, /^AUTH_JWT_ISSUER="ss-erp-local-[a-f0-9]{16}"$/mu);
  assert.match(result.content, /^ENCRYPTION_KEY="keep-this-real-encryption-key-1234567890"$/mu);
  assert.match(result.content, /^EXTENSION_DEVICE_JWT_SECRET="device-secret-that-is-already-long-enough"$/mu);
  assert.doesNotMatch(result.summary.join('\n'), /abababab|secret-that-is-already/u);
});

test('is idempotent after the first safe local update', () => {
  const initial = prepareLocalEnv([
    'DATABASE_URL="postgresql://sserp:sserp@localhost:5432/sserp"',
    'REDIS_URL="redis://localhost:6379"',
    'JWT_SECRET="dev-secret-change-me"',
    'ENCRYPTION_KEY=""',
    '',
  ].join('\n'), { randomBytes: deterministicBytes });

  const repeated = prepareLocalEnv(initial.content, {
    randomBytes() {
      throw new Error('idempotent update must not generate new secrets');
    },
  });

  assert.equal(repeated.changed, false);
  assert.equal(repeated.content, initial.content);
});

test('rejects a cloud profile instead of silently converting it to local', () => {
  assert.throws(
    () => prepareLocalEnv('RUNTIME_MODE="cloud"\n', { randomBytes: deterministicBytes }),
    /refusing to rewrite a non-local environment/u,
  );
});

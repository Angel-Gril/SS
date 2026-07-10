import assert from 'node:assert/strict';
import fs, { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const read = (path) => fs.readFileSync(path, 'utf8');

test('environment examples select an explicit legal profile', () => {
  assert.match(read('.env.example'), /LEGAL_PROFILE="local"/);
  const production = read('.env.production.example');
  assert.match(production, /LEGAL_PROFILE=cloud-global/);
  assert.match(production, /cloud-cn/);
  assert.match(production, /self-hosted/);
});

test('environment validation rejects missing or unknown legal profiles', () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), 'ss-erp-legal-env-'));
  const envPath = path.join(tempDir, '.env.invalid-legal-profile');
  writeFileSync(envPath, [
    'DATABASE_URL=postgresql://user:password@127.0.0.1:5432/ss_erp',
    'REDIS_DISABLED=true',
    'JWT_SECRET=0123456789abcdef0123456789abcdef',
    'ENCRYPTION_KEY=0123456789abcdef0123456789abcdef',
    'RUNTIME_MODE=local',
    'IMAGE_STORAGE_BACKEND=local',
    'LEGAL_PROFILE=unknown',
  ].join('\n'));

  try {
    const result = spawnSync(process.execPath, [
      'scripts/validate-env.mjs',
      '--profile',
      'local',
      '--env',
      envPath,
    ], { cwd: process.cwd(), encoding: 'utf8' });

    assert.equal(result.status, 1);
    assert.match(result.stderr, /LEGAL_PROFILE expected one of/);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('deployment docs map domains and device types to legal profiles', () => {
  const docs = read('docs/legal-deployment-profiles.md');
  assert.match(docs, /ss-erp\.cn.*cloud-cn/s);
  assert.match(docs, /ss-erp\.com.*cloud-global/s);
  assert.match(docs, /本地.*local/s);
  assert.match(docs, /独立部署.*self-hosted/s);
});

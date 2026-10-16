import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

let subject = {};
try { subject = await import('./qa04-suite-current-runtime.mjs'); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND') throw error; }

test('current-runtime producer forces bounded PostgreSQL read-only connections without exposing credentials', () => {
  assert.equal(typeof subject.readOnlySuiteRuntimeEnvironment, 'function');
  const environment = subject.readOnlySuiteRuntimeEnvironment({ DATABASE_URL: 'postgresql://fixture:secret@127.0.0.1:5432/fixture?schema=isolated',
    ENCRYPTION_KEY: 'a'.repeat(32), NODE_ENV: 'development' });
  assert.equal(environment.NODE_ENV, 'production');
  const url = new URL(environment.DATABASE_URL);
  assert.equal(url.searchParams.get('schema'), 'isolated');
  assert.equal(url.searchParams.get('connection_limit'), '1');
  assert.match(url.searchParams.get('options'), /default_transaction_read_only=on/u);
  assert.match(url.searchParams.get('options'), /statement_timeout=15000/u);
  assert.throws(() => subject.readOnlySuiteRuntimeEnvironment({}), error => error.code === 'QA04_CURRENT_RUNTIME_ENV_REQUIRED');
  assert.throws(() => subject.readOnlySuiteRuntimeEnvironment({ DATABASE_URL: 'https://example.invalid', ENCRYPTION_KEY: 'a'.repeat(32) }),
    error => error.code === 'QA04_CURRENT_RUNTIME_ENV_REQUIRED');
});

test('native producer CLI can explain prerequisites without loading TypeScript or connecting to any database', () => {
  const result = spawnSync(process.execPath, ['scripts/qa04-suite-current-runtime.mjs', '--help'], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--import.*tsx/u);
  assert.match(result.stdout, /--commit/u);
  assert.doesNotMatch(result.stdout, /postgres(?:ql)?:\/\//u);
});

test('native current-runtime dry-run fails closed without credentials, never creates a receipt or tries Provider', () => {
  const environment = { ...process.env }; delete environment.DATABASE_URL; delete environment.ENCRYPTION_KEY;
  const result = spawnSync(process.execPath, ['scripts/qa04-suite-current-runtime.mjs', '--dry-run'],
    { env: environment, encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /QA04_CURRENT_RUNTIME_ENV_REQUIRED/u);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /Prisma|HTTP|fetch|connect|password|secret/u);
});

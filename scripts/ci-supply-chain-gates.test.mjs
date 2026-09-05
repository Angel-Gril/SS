import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
const serverPackage = JSON.parse(readFileSync('apps/server/package.json', 'utf8'));
const webPackage = JSON.parse(readFileSync('apps/web/package.json', 'utf8'));

function numericVersion(value) {
  const match = String(value || '').match(/(\d+)\.(\d+)\.(\d+)/u);
  assert.ok(match, `invalid semver range: ${value}`);
  return match.slice(1).map(Number);
}

function atLeast(value, floor) {
  const actual = numericVersion(value);
  const expected = numericVersion(floor);
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] > expected[index]) return true;
    if (actual[index] < expected[index]) return false;
  }
  return true;
}

test('pins directly owned production dependencies above audited high-severity floors', () => {
  assert.equal(atLeast(webPackage.dependencies.next, '15.5.21'), true);
  assert.equal(atLeast(serverPackage.dependencies.fastify, '5.12.3'), true);
  assert.equal(atLeast(serverPackage.dependencies.sharp, '0.35.0'), true);
  assert.equal(atLeast(serverPackage.dependencies.undici, '8.9.0'), true);
});

test('makes dependency and static security findings blocking CI gates', () => {
  const securityJob = ci.slice(ci.indexOf('  security:'), ci.indexOf('  test:'));
  assert.match(
    securityJob,
    /pnpm audit --registry=https:\/\/registry\.npmjs\.org --audit-level=high --prod/u,
  );
  assert.doesNotMatch(securityJob, /continue-on-error:\s*true/u);
});

test('runs Prisma format and the isolated logistics PostgreSQL suite in CI', () => {
  assert.match(ci, /pnpm --filter server exec prisma format --check/u);
  assert.match(ci, /pnpm --filter server test:logistics:postgres/u);
  assert.equal(
    serverPackage.scripts['test:logistics:postgres'],
    'node scripts/logistics-postgres-integration.mjs',
  );
});

test('the logistics runner owns an isolated schema and all protected PostgreSQL files', () => {
  const runner = readFileSync(
    'apps/server/scripts/logistics-postgres-integration.mjs',
    'utf8',
  );
  assert.match(runner, /logistics_test_/u);
  assert.match(runner, /CREATE SCHEMA/u);
  assert.match(runner, /DROP SCHEMA IF EXISTS/u);
  assert.match(runner, /RUN_LOGISTICS_POSTGRES_TESTS:\s*'1'/u);
  for (const name of [
    'extension-command-grants',
    'extension-device-session',
    'logistics-capture-task',
    'logistics-official-input-unit-contract',
    'logistics-rule-device-prisma',
    'logistics-rule-release',
    'logistics-scope-bootstrap',
    'ozon-publish-attempt',
    'ozon-publisher-parity',
    'ozon-publisher-rollout-gate',
    'source-capture',
    'source-listing-workflow',
  ]) {
    assert.match(runner, new RegExp(`src/__tests__/${name}\\.postgres\\.integration\\.test\\.ts`, 'u'));
  }
});

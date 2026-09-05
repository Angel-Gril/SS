import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const compose = readFileSync('docker-compose.yml', 'utf8');

test('local PostgreSQL and Redis publish only on IPv4 loopback', () => {
  for (const mapping of ['127.0.0.1:5432:5432', '127.0.0.1:6379:6379']) {
    assert.equal(
      compose.split(`"${mapping}"`).length - 1,
      1,
      `${mapping} must appear exactly once`,
    );
  }
  assert.doesNotMatch(
    compose,
    /^\s*-\s*["']?(?:5432:5432|6379:6379|0\.0\.0\.0:(?:5432|6379):(?:5432|6379)|\[::\]:(?:5432|6379):(?:5432|6379))["']?\s*$/gmu,
  );
  assert.doesNotMatch(compose, /^\s*network_mode:\s*["']?host["']?\s*$/gmu);
});

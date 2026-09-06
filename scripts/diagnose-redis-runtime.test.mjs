import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';

const scriptPath = 'scripts/diagnose-redis-runtime.sh';

test('Redis runtime diagnostic exists and is read-only', () => {
  assert.equal(existsSync(scriptPath), true, 'diagnostic script must exist');
  const source = readFileSync(scriptPath, 'utf8');
  assert.match(source, /redis-cli/u);
  assert.match(source, /redis_cli INFO "\$section"/u);
  assert.match(source, /cluster_connections/u);
  assert.match(source, /cluster_enabled/u);
  assert.match(source, /connected_slaves/u);
  assert.match(source, /systemctl list-unit-files/u);
  assert.match(source, /crontab -l/u);
  assert.doesNotMatch(source, /redis-cli\s+(set|del|flushall|flushdb|config\s+set|shutdown)\b/iu);
  assert.doesNotMatch(source, /redis-cli[^\n]*--raw[^\n]*get\b/iu);
});

test('diagnostic output distinguishes availability from HA and alert readiness', () => {
  const source = readFileSync(scriptPath, 'utf8');
  for (const marker of [
    'REDIS_RUNTIME_STATUS=',
    'REDIS_TOPOLOGY=',
    'REDIS_REPLICATION_STATUS=',
    'REDIS_ALERTING_STATUS=',
    'REDIS_PERSISTENCE_STATUS=',
    'REDIS_BLOCKED_CLIENTS=',
    'REDIS_CONNECTED_CLIENTS=',
  ]) {
    assert.equal(
      source.includes(marker)
        || (marker === 'REDIS_BLOCKED_CLIENTS=' && source.includes('blocked_clients'))
        || (marker === 'REDIS_CONNECTED_CLIENTS=' && source.includes('connected_clients')),
      true,
      `diagnostic must emit ${marker}`,
    );
  }
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readRepoFile(...parts) {
  return readFileSync(join(root, ...parts), 'utf8');
}

test('Ozon list overlay scans current list widgets and retries transient data failures quickly', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'content', 'ozon-list-overlay.js');

  assert.match(source, /\[data-widget="skuGridSimple"\]\s+\[data-index\]/);
  assert.match(source, /#layoutPage\s+\[data-index\]/);
  assert.match(source, /PREMIUM_FAILURE_TTL_MS\s*=\s*90\s*\*\s*1000/);
  assert.match(source, /PREMIUM_CONCURRENCY\s*=\s*3/);
  assert.match(source, /CARD_SCAN_FAST_MS\s*=\s*500/);
  assert.match(source, /data-ss-erp-overlay-sku/);
});

test('Ozon commission sync primes the help center session before document-manager API requests', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'background', 'service-worker.js');

  assert.match(source, /OZON_COMMISSION_BOOTSTRAP_URLS/);
  assert.match(source, /primeOzonCommissionSession/);
  assert.match(source, /fetchCommissionPayloadViaHelpTab/);
  assert.match(source, /isOzonChallengePayload/);
  assert.match(source, /document-manager-api\/global-help\/api\/v3\/document\/public\/by-path/);
  assert.match(source, /credentials:\s*'include'/);
});

test('production sources and extension package do not contain competitor brand markers', () => {
  const files = [
    ['extensions', 'ss-erp', 'content', 'ozon-list-overlay.js'],
    ['extensions', 'ss-erp', 'background', 'service-worker.js'],
    ['apps', 'server', 'src', 'routes', 'collect.ts'],
  ];
  const blocked = new RegExp(['企' + '鹅', '店' + '长', 'qe' + 'help', 'hq' + 'ozon'].join('|'), 'i');

  for (const parts of files) {
    assert.doesNotMatch(readRepoFile(...parts), blocked, parts.join('/'));
  }
});

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

test('Ozon list overlay attaches only to single-product card targets', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'content', 'ozon-list-overlay.js');

  assert.match(source, /function\s+extractSkuFromHref/);
  assert.match(source, /function\s+collectDistinctProductSkus/);
  assert.match(source, /function\s+resolveProductCardTarget/);
  assert.match(source, /function\s+collectProductCardTargets/);
  assert.match(source, /countDistinctProductSkus\(target\)\s*!==\s*1/);
  assert.match(source, /attachOverlay\(target\)/);
  assert.doesNotMatch(source, /attachOverlay\(card\)/);
  assert.doesNotMatch(source, /io\.observe\(card\)/);
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

test('Ozon seller company id detection falls back to captured x-o3-company-id', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'background', 'collect-background.js');

  assert.match(source, /ss_erp_ozon_company_id/);
  assert.match(source, /getStoredSellerCompanyId/);
  assert.match(source, /refreshSellerCompanyIdFromTab/);
  assert.match(source, /\.ozon\.ru/);
});

test('Ozon shop analytics sync falls back from charts table to what-to-sell data', () => {
  const source = readRepoFile('extensions', 'ss-erp', 'background', 'collect-background.js');

  assert.match(source, /syncShopAnalyticsWithFallback/);
  assert.match(source, /fetchShopAnalyticsFromChartsV3/);
  assert.match(source, /fetchShopAnalyticsFromWhatToSell/);
  assert.match(source, /mapChartsV3AnalyticsItem/);
  assert.match(source, /mapWhatToSellAnalyticsItem/);
  assert.match(source, /OZON_ENDPOINTS\.chartsV3TableBySku/);
  assert.match(source, /OZON_ENDPOINTS\.analytics/);
  assert.match(source, /analyticsSource/);
  assert.doesNotMatch(source, /不再依赖\s+what_to_sell\/data\/v3/);
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

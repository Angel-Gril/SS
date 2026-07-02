import assert from 'node:assert/strict';
import fs from 'node:fs';

const adminPage = fs.readFileSync('apps/web/src/app/(dashboard)/admin/ozon-pickup-points/page.tsx', 'utf8');
const userPage = fs.readFileSync('apps/web/src/app/(dashboard)/ozon-pickup-points/page.tsx', 'utf8');
const extensionBackground = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

for (const token of [
  '/api/ozon-pickup-points/sync-ozon-dropoffs',
  '/api/ozon-pickup-points/import-ozon-dropoffs',
  'spb-self-hosted:fetch-ozon-dropoff-points',
  '同步Ozon发运点',
  'Ozon接口同步',
  '从Ozon读取发运点/揽收点',
  'providerName',
  'externalId',
]) {
  assert.match(adminPage, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `admin pickup point page should expose ${token}`);
}

assert.match(
  adminPage,
  /filterKeyword[\s\S]*providerName[\s\S]*externalId/,
  'admin pickup point filter should search provider name and Ozon external id',
);

assert.match(
  userPage,
  /URLSearchParams[\s\S]*params\.set\('q',\s*keyword\.trim\(\)\)/,
  'user pickup point page should query the server with q so large synced Ozon point lists search reliably',
);
assert.match(
  userPage,
  /providerName|externalId/,
  'user pickup point page should display or search synced Ozon provider metadata',
);

assert.match(
  extensionBackground,
  /spb-self-hosted:fetch-ozon-dropoff-points/,
  'extension should expose a browser-context Ozon drop-off point fetch message',
);
assert.match(
  extensionBackground,
  /delivery-method-service\/v1\/drop-off\/list\/by-provider/,
  'extension should fetch Ozon drop-off points by provider from the seller tab context',
);

console.log('PASS web ozon pickup points');

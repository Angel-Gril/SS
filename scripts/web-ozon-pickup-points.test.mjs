import assert from 'node:assert/strict';
import fs from 'node:fs';

const adminPage = fs.readFileSync('apps/web/src/app/(dashboard)/admin/ozon-pickup-points/page.tsx', 'utf8');
const userPage = fs.readFileSync('apps/web/src/app/(dashboard)/ozon-pickup-points/page.tsx', 'utf8');
const extensionBackground = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

for (const token of [
  '/api/ozon-pickup-points/import-ozon-dropoffs',
  'spb-self-hosted:fetch-ozon-dropoff-points',
  '/ozon-cdn-auth',
  '读取可选发运点池',
  '需要通过浏览器扩展读取 Ozon 可选发运点池',
  '这一步必须通过浏览器扩展在真实 Seller 页面执行',
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
  adminPage,
  /api\.get<OzonCdnAuthStatus>\(`\/api\/shops\/\$\{syncShopId\}\/ozon-cdn-auth`\)[\s\S]{0,650}sendToExtension[\s\S]{0,260}\.\.\.\(companyId \? \{ companyId \} : \{\}\)/,
  'admin pickup sync should pass the ERP-stored Ozon companyId to the browser extension',
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
assert.match(
  extensionBackground,
  /delivery-method-service\/v2\/provider\/template\/by-location\/list/,
  'extension should discover Ozon providers through the seller provider template endpoint when warehouse/list is unavailable',
);
assert.match(
  extensionBackground,
  /Ozon warehouse\/list provider discovery failed[\s\S]{0,900}fetchOzonSellerProviderTemplates\(companyId\)/,
  'extension should fall back to provider templates after warehouse/list rejects the request',
);
assert.match(
  extensionBackground,
  /sellerWarehouseList[\s\S]{0,220}\{\s*company_id:\s*String\(companyId\)\s*\}/,
  'extension should include string company_id in the Ozon seller warehouse list request body',
);

console.log('PASS web ozon pickup points');

import assert from 'node:assert/strict';
import fs from 'node:fs';

const adminPage = fs.readFileSync(
  'apps/web/src/app/(dashboard)/admin/ozon-pickup-points/page.tsx',
  'utf8',
);
const userPage = fs.readFileSync(
  'apps/web/src/app/(dashboard)/ozon-pickup-points/page.tsx',
  'utf8',
);
const extensionBackground = fs.readFileSync(
  'extensions/ss-erp/background/collect-background.js',
  'utf8',
);
const extensionBridge = fs.readFileSync('extensions/ss-erp/content/erp-collect-bridge.js', 'utf8');
const serviceWorker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');

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
  assert.match(
    adminPage,
    new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
    `admin pickup point page should expose ${token}`,
  );
}

assert.match(
  adminPage,
  /filterKeyword[\s\S]*providerName[\s\S]*externalId/,
  'admin pickup point filter should search provider name and Ozon external id',
);

assert.match(
  adminPage,
  /api\.get<OzonCdnAuthStatus>\(`\/api\/shops\/\$\{syncShopId\}\/ozon-cdn-auth`\)/,
  'admin pickup sync should read the ERP-stored Ozon companyId before calling the browser extension',
);
assert.match(
  adminPage,
  /sendToExtension<OzonDropoffSyncPayload>[\s\S]{0,420}\.\.\.\(companyId \? \{ companyId \} : \{\}\)/,
  'admin pickup sync should pass the ERP-stored Ozon companyId to the browser extension',
);
assert.match(
  adminPage,
  /api\s*\.get<WarehouseOption\[]>\s*\(`\/api\/shops\/\$\{encodeURIComponent\(syncShopId\)\}\/warehouses`\)/,
  'admin pickup sync should load warehouses for the selected ERP shop',
);
assert.match(
  adminPage,
  /syncWarehouseId[\s\S]*发运仓库/,
  'admin pickup sync should require an explicit warehouse selection',
);
assert.match(
  adminPage,
  /point:\s*\{\s*latitude:\s*selectedSyncWarehouse\.latitude,\s*longitude:\s*selectedSyncWarehouse\.longitude,?\s*\}/,
  'admin pickup sync should pass the selected warehouse coordinates to the extension',
);
assert.match(
  adminPage,
  /仓库缺少坐标|先同步[^\n]*仓库坐标/,
  'admin pickup sync should explain why a warehouse without coordinates cannot collect',
);
assert.match(
  adminPage,
  /sendToExtension<\{ version\?: string \}>\(\s*\{\s*type:\s*'ss-erp:ping'\s*\}/,
  'admin pickup sync should ping the extension before starting the long Ozon drop-off collection',
);
assert.match(
  adminPage,
  /syncProgress[\s\S]{0,1800}role="progressbar"[\s\S]{0,600}providerDone[\s\S]{0,1800}pointCount/,
  'admin pickup sync should render provider progress and collected point count while extension collection is running',
);
assert.match(
  adminPage,
  /sendToExtension<OzonDropoffSyncPayload>[\s\S]{0,900}setSyncProgress/,
  'admin pickup sync should update progress from extension events during Ozon drop-off collection',
);

assert.match(
  userPage,
  /URLSearchParams[\s\S]*params\.set\('q',\s*keyword\.trim\(\)\)/,
  'user pickup point page should query the server with q so large synced Ozon point lists search reliably',
);
assert.match(
  userPage,
  /\/api\/ozon-pickup-points\/providers/,
  'user pickup point page should load provider options from the provider endpoint instead of a full point list',
);
assert.match(
  userPage,
  /params\.set\('pageSize',\s*String\(PAGE_SIZE\)\)/,
  'user pickup point page should request paged pickup point results',
);
assert.match(
  userPage,
  /providerName|externalId/,
  'user pickup point page should display or search synced Ozon provider metadata',
);
assert.doesNotMatch(
  userPage,
  /api\.(put|delete)\(`\/api\/ozon-pickup-points|Pencil|Trash2|编辑|保存/,
  'user pickup point page should remain view/search only without edit or delete controls',
);
assert.match(
  adminPage,
  /params\.set\('q',\s*filterKeyword\.trim\(\)\)[\s\S]*params\.toString\(\)/,
  'admin pickup point page should send keyword filtering to the backend',
);
assert.match(
  adminPage,
  /pageSize:\s*String\(PAGE_SIZE\)/,
  'admin pickup point page should request paged admin results',
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
const methodDiscoveryIndex = extensionBackground.indexOf(
  'fetchOzonSellerConfiguredMethods(companyId)',
);
const templateDiscoveryIndex = extensionBackground.indexOf(
  'fetchOzonSellerProviderTemplates(companyId, point)',
  methodDiscoveryIndex,
);
assert.ok(
  methodDiscoveryIndex >= 0 && templateDiscoveryIndex > methodDiscoveryIndex,
  'extension should read configured methods before supplementing them with provider templates',
);
assert.match(
  extensionBackground,
  /mergeOzonSellerProviderSources\(methodProviders, templateProviders\)/,
  'extension should merge configured-method and provider-template sources',
);
assert.match(
  extensionBackground,
  /sellerWarehouseList[\s\S]{0,220}\{\s*company_id:\s*toOzonSellerTemplateCompanyId\(companyId\)\s*\}/,
  'extension should normalize company_id in the Ozon seller warehouse list request body',
);
assert.match(
  serviceWorker,
  /message\.type === ['"]ss-erp:ping['"][\s\S]*?hasCollectModule/,
  'extension service worker should answer the ERP page ping with collect-module diagnostics',
);
assert.doesNotMatch(
  extensionBackground,
  /message\.type === ['"]ss-erp:ping['"]/,
  'extension collect background should not shadow the service-worker ping diagnostics',
);
assert.match(
  extensionBackground,
  /SS_ERP_COLLECT_OZON_DROPOFF_PROVIDER_CONCURRENCY\s*=\s*6/,
  'extension should fetch provider drop-off lists with a bounded concurrency',
);
assert.match(
  extensionBackground,
  /sendExtensionProgress[\s\S]{0,700}ss-erp:extension-progress[\s\S]{0,900}requestId/,
  'extension background should send request-scoped progress events back to the ERP tab',
);
assert.match(
  extensionBackground,
  /fetchOzonSellerDropoffPointsViaTab\(message\.companyId,\s*\{[\s\S]{0,700}onProgress[\s\S]{0,700}sendExtensionProgress\(sender,\s*message\.requestId/,
  'extension drop-off fetch command should wire progress events to the current ERP request',
);
assert.match(
  extensionBridge,
  /ss-erp:extension-progress[\s\S]{0,260}requestId:\s*msg\.requestId[\s\S]{0,260}progress:\s*msg\.progress/,
  'extension content bridge should forward background progress events to the ERP page with the matching request id',
);

console.log('PASS web ozon pickup points');

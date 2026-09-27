import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync('extensions/ss-erp/pages/settings.html', 'utf8');
const source = fs.readFileSync('extensions/ss-erp/pages/settings.js', 'utf8');
const popupSource = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');
const ozonOverlaySource = fs.readFileSync('extensions/ss-erp/content/ozon-list-overlay.js', 'utf8');
const workerSource = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const collectWorkerSource = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');
const policySource = fs.readFileSync('extensions/ss-erp/shared/message-security/runtime-message-policy.js', 'utf8');

test('settings exposes device pairing, scoped assignment selection, sync, and revoke controls', () => {
  for (const id of [
    'logisticsDeploymentInput',
    'logisticsPairingCodeInput',
    'logisticsDeviceLabelInput',
    'pairLogisticsDeviceBtn',
    'logisticsAssignmentSelect',
    'syncPublishedLogisticsBtn',
    'revokeLogisticsDeviceBtn',
    'logisticsDistributionStatus',
  ]) {
    assert.ok(html.includes('id="' + id + '"'), id + ' is required');
    assert.ok(source.includes("getElementById('" + id + "')"), id + ' must be wired');
  }
  assert.match(html, /id="logisticsPairingCodeInput"[^>]+type="password"/);
});

test('settings delegates secrets to the background runtime and never stores device tokens', () => {
  for (const type of [
    'ss-erp:extension-device-claim',
    'ss-erp:extension-device-status',
    'ss-erp:extension-device-clear',
    'ss-erp:logistics-rules-sync',
  ]) {
    assert.ok(source.includes("type: '" + type + "'"), type + ' must be sent');
  }
  assert.equal(source.includes('ss-erp:extension-device:credential:v1'), false);
  assert.equal(source.includes('refreshToken'), false);
  assert.equal(source.includes('accessToken'), false);
});

test('settings reconciles the legacy form with an active scoped device session', () => {
  assert.match(source, /ss-erp:extension-device-status/);
  assert.match(source, /refreshPairedDeviceStatus/);
  assert.match(source, /status\.endpoint/);
  assert.match(source, /status\.deploymentId/);
  assert.match(source, /defaults\.erpApiBaseUrl \|\| defaults\.erpBaseUrl/);
  assert.match(source, /设备已连接/);
  assert.match(source, /设备授权已失效，请重新配对/);
  assert.match(source, /尚未完成设备配对/);
  assert.match(source, /设备已连接，但暂时无法读取授权店铺/);
  assert.match(html, /id="logisticsFeatureControls"/);
  assert.match(html, /扩展设备配对/);
  assert.match(html, /解除本机配对/);
  assert.match(source, /logisticsFeatureControls\.hidden = !logisticsDistributionEnabled/);
  assert.match(policySource, /'ss-erp:extension-device-clear'/);
  assert.match(workerSource, /message\.type === 'ss-erp:extension-device-clear'/);
  assert.match(source, /本机设备配对已清除/);
  assert.match(workerSource, /SS_ERP_EXTENSION_DEVICE_SHOPS/);
  assert.match(workerSource, /shop-analytics-device-writer\.js/);
  assert.match(workerSource, /SS_ERP_EXTENSION_DEVICE_SHOP_ANALYTICS/);
  assert.match(workerSource, /\/api\/extension-device\/shops/);
  assert.match(workerSource, /operation\.accessToken/);
  assert.match(collectWorkerSource, /deviceShopReader/);
  assert.match(collectWorkerSource, /never fall back to an account-wide/);
  assert.doesNotMatch(collectWorkerSource, /deviceResult\.errorCode !== 'device_unpaired'/);
  assert.match(collectWorkerSource, /deviceAnalyticsWriter/);
  assert.match(collectWorkerSource, /writeShopAnalyticsSnapshotToErp/);
  const writerStart = collectWorkerSource.indexOf('async function writeShopAnalyticsSnapshotToErp');
  const analyticsStart = collectWorkerSource.indexOf('async function syncShopAnalyticsToErp');
  const graphsStart = collectWorkerSource.indexOf('async function syncShopGraphsToErp');
  const exportStart = collectWorkerSource.indexOf('globalThis.SS_ERP_COLLECT_BACKGROUND', graphsStart);
  assert.ok(writerStart >= 0 && analyticsStart > writerStart
    && graphsStart > analyticsStart && exportStart > graphsStart);
  const analyticsWriter = collectWorkerSource.slice(writerStart, analyticsStart);
  assert.doesNotMatch(analyticsWriter, /getStoredErpConnection|conn\.token|\/api\/shops\//);
  assert.match(analyticsWriter, /device_analytics_writer_unavailable/);
  const analyticsHandler = collectWorkerSource.slice(analyticsStart, graphsStart);
  const graphsHandler = collectWorkerSource.slice(graphsStart, exportStart);
  assert.match(analyticsHandler, /writeShopAnalyticsSnapshotToErp/);
  assert.doesNotMatch(analyticsHandler, /if \(!conn\.token\)/);
  assert.match(graphsHandler, /writeShopAnalyticsSnapshotToErp/);
  assert.doesNotMatch(graphsHandler, /return \{ ok: true, data: v3Result \};/);
  assert.match(fs.readFileSync('apps/server/src/routes/extension-device.ts', 'utf8'), /app\.get\('\/shops'/);
});

test('popup shop and Cookie sync use scoped device auth without a legacy account Token', () => {
  const readerStart = popupSource.indexOf('function readAuthorizedOzonShops(callback)');
  const readerEnd = popupSource.indexOf('\n  function getSelectedShopId', readerStart);
  const selectedStart = popupSource.indexOf('function getSelectedShopId(callback)');
  const selectedEnd = popupSource.indexOf('\n  function getManualSellerCompanyIdOverride', selectedStart);
  const listStart = popupSource.indexOf('function loadShopsToSelect()');
  const listEnd = popupSource.indexOf('\n  // 加载所选店铺的现有认证信息', listStart);
  const authStart = popupSource.indexOf('function readShopAuthInfo(shopId, callback)');
  const authEnd = popupSource.indexOf('\n  function loadShopAuthInfo', authStart);
  assert.ok(readerStart >= 0 && readerEnd > readerStart);
  assert.ok(selectedStart >= 0 && selectedEnd > selectedStart);
  assert.ok(listStart >= 0 && listEnd > listStart);
  assert.ok(authStart >= 0 && authEnd > authStart);
  const readerSection = popupSource.slice(readerStart, readerEnd);
  assert.match(readerSection, /spb-self-hosted:get-ozon-shops/);
  assert.doesNotMatch(readerSection, /getErpConnectionStorage|\/api\/shops|Authorization/);
  for (const section of [
    popupSource.slice(selectedStart, selectedEnd),
    popupSource.slice(listStart, listEnd),
  ]) {
    assert.match(section, /readAuthorizedOzonShops/);
    assert.doesNotMatch(section, /getErpConnectionStorage|\/api\/shops|Authorization/);
  }
  const authSection = popupSource.slice(authStart, authEnd);
  assert.match(authSection, /ozon-calc:get-ozon-cdn-auth/);
  assert.doesNotMatch(authSection, /getErpConnectionStorage|\/api\/shops|Authorization/);

  assert.match(workerSource, /readExtensionDeviceOzonCdnAuth/);
  assert.match(workerSource, /writeExtensionDeviceOzonCdnAuth/);
  assert.match(workerSource, /\/api\/extension-device\/shops\//);
  const writerStart = workerSource.indexOf('async function writeOzonCdnAuthForSync');
  const writerEnd = workerSource.indexOf('\nasync function fetchStoredOzonCompanyIdForSync', writerStart);
  const cookieStart = workerSource.indexOf('async function syncOzonCookieToShopForSync');
  const cookieEnd = workerSource.indexOf('\nglobalThis.syncOzonCookieToShopForSync', cookieStart);
  assert.ok(writerStart >= 0 && writerEnd > writerStart);
  assert.ok(cookieStart >= 0 && cookieEnd > cookieStart);
  const writer = workerSource.slice(writerStart, writerEnd);
  const cookieHandler = workerSource.slice(cookieStart, cookieEnd);
  assert.match(writer, /writeExtensionDeviceOzonCdnAuth/);
  assert.doesNotMatch(writer, /OZON_CALC_ERP_TOKEN_KEY|\/api\/shops|authMode: 'legacy'/);
  assert.match(cookieHandler, /writeOzonCdnAuthForSync/);
  assert.doesNotMatch(cookieHandler, /if \(!connection\.token\)/);
  const autoShopStart = workerSource.indexOf('async function readOzonShopsForAutoSync');
  const autoShopEnd = workerSource.indexOf('\nfunction shopMatchesOzonCompanyId', autoShopStart);
  const resolverStart = workerSource.indexOf('async function resolveOzonAutoSyncShop');
  const resolverEnd = workerSource.indexOf('\nasync function updateOzonSyncTimes', resolverStart);
  assert.ok(autoShopStart >= 0 && autoShopEnd > autoShopStart);
  assert.ok(resolverStart >= 0 && resolverEnd > resolverStart);
  assert.doesNotMatch(workerSource.slice(autoShopStart, autoShopEnd), /OZON_CALC_ERP_TOKEN_KEY|\/api\/shops/);
  assert.match(workerSource.slice(resolverStart, resolverEnd), /if \(normalizedCompanyId\) return null/);
  assert.doesNotMatch(workerSource.slice(resolverStart, resolverEnd), /\{ id: fallbackId \}/);
  const deviceShopCaseStart = collectWorkerSource.indexOf('case "spb-self-hosted:get-ozon-shops"');
  const deviceShopCaseEnd = collectWorkerSource.indexOf('\n      case ', deviceShopCaseStart + 10);
  const deviceShopCase = collectWorkerSource.slice(deviceShopCaseStart, deviceShopCaseEnd);
  assert.match(deviceShopCase, /never fall back to an account-wide/);
  assert.doesNotMatch(deviceShopCase, /deviceResult\.errorCode !== 'device_unpaired'/);
  assert.match(deviceShopCase, /message\.deviceOnly\s*===\s*true/);
  assert.match(deviceShopCase, /device_shop_reader_unavailable/);
  assert.ok(
    deviceShopCase.indexOf('device_shop_reader_unavailable') < deviceShopCase.indexOf('getStoredErpConnection'),
    'device-only shop reads must fail before the legacy account-token branch',
  );
  assert.match(policySource, /'ozon-calc:get-ozon-cdn-auth'/);
  const preloadStart = ozonOverlaySource.indexOf('function autoSyncCurrentOzonCookieForListData');
  const preloadEnd = ozonOverlaySource.indexOf('\n  function hasDisplayablePremiumData', preloadStart);
  assert.ok(preloadStart >= 0 && preloadEnd > preloadStart);
  assert.match(ozonOverlaySource.slice(preloadStart, preloadEnd), /automatic: true/);
  assert.match(
    workerSource,
    /if \(isOzonPageRuntimeSender\(sender\)\) payload\.automatic = true;/,
  );
});

test('device Cookie transport keeps credentials in the worker and rejects missing scope before fetch', async () => {
  const start = workerSource.indexOf('async function readBoundedExtensionDeviceJson');
  const end = workerSource.indexOf('\nasync function writeExtensionDeviceShopAnalytics', start);
  assert.ok(start >= 0 && end > start, 'device Cookie transport must be extractable');
  const requests = [];
  let scopes = ['capture:write'];
  let operationCurrent = true;
  let responseStatus = 200;
  let invalidSuccessBody = false;
  let responseReaderError = null;
  const credentials = {
    async getStatus() { return { state: 'paired' }; },
    async beginOperation() {
      return {
        state: 'paired',
        sessionId: 'session-1',
        baseUrl: 'https://erp.example',
        accessToken: 'device-secret-token',
        scopes: scopes.slice(),
      };
    },
    async isOperationCurrent() { return operationCurrent; },
    async clearIfCurrent() { throw new Error('must not clear a healthy operation'); },
  };
  const context = {
    AbortController,
    Array,
    Boolean,
    JSON,
    Object,
    Promise,
    String,
    TextDecoder,
    TextEncoder,
    SS_ERP_DEVICE_JSON_RESPONSE_MAX_BYTES: 256 * 1024,
    SS_ERP_DEVICE_COOKIE_REQUEST_MAX_BYTES: 66 * 1024,
    clearTimeout,
    encodeURIComponent,
    setTimeout,
    toText(value) { return value == null ? '' : String(value); },
    getLogisticsDeviceCredentials() { return credentials; },
    async fetch(url, init) {
      requests.push({ url, init });
      const data = url.endsWith('/api/extension-device/shops')
        ? [{
            id: 'shop-1', platform: 'OZON', name: 'BINI', status: 'ACTIVE',
            clientId: '123', companyId: '123', privateSetting: 'must-not-leak',
          }]
        : init.method === 'GET'
          ? { hasCookie: true, companyId: '123', updatedAt: 'now' }
          : { hasCookie: true, companyId: '123', updatedAt: 'later' };
      const responseText = JSON.stringify(invalidSuccessBody
        ? { code: 0, errorCode: 'invalid_success', msg: 'ambiguous response' }
        : responseStatus >= 500
          ? { code: 0, errorCode: 'proxy_error', msg: 'upstream failed' }
          : { code: 1, data });
      const responseBytes = new TextEncoder().encode(responseText);
      const readerError = responseReaderError;
      let delivered = false;
      return {
        ok: responseStatus >= 200 && responseStatus < 300,
        status: responseStatus,
        headers: { get() { return null; } },
        body: {
          getReader() {
            return {
              async read() {
                if (readerError) throw readerError;
                if (delivered) return { done: true, value: undefined };
                delivered = true;
                return { done: false, value: responseBytes };
              },
              async cancel() {},
              releaseLock() {},
            };
          },
        },
      };
    },
  };
  context.globalThis = context;
  vm.runInNewContext(workerSource.slice(start, end), context, {
    filename: 'device-ozon-cdn-auth-transport.js',
  });

  const read = await context.SS_ERP_EXTENSION_DEVICE_OZON_CDN_AUTH.read('shop-1');
  const write = await context.SS_ERP_EXTENSION_DEVICE_OZON_CDN_AUTH.write('shop-1', {
    cookie: 'session=secret', companyId: '123',
  });
  const clear = await context.SS_ERP_EXTENSION_DEVICE_OZON_CDN_AUTH.write('shop-1', {
    clearCookie: true, companyId: '123',
  });
  assert.equal(read.ok, true);
  assert.equal(write.ok, true);
  assert.equal(clear.ok, true);
  assert.equal(JSON.stringify(read).includes('device-secret-token'), false);
  assert.equal(JSON.stringify(write).includes('device-secret-token'), false);
  assert.equal(requests.length, 3);
  assert.equal(requests[0].url, 'https://erp.example/api/extension-device/shops/shop-1/ozon-cdn-auth');
  assert.equal(requests[0].init.method, 'GET');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer device-secret-token');
  assert.equal(requests[0].init.credentials, 'omit');
  assert.equal(requests[0].init.redirect, 'error');
  assert.equal(requests[1].init.method, 'PUT');
  assert.deepEqual(JSON.parse(requests[1].init.body), {
    cookie: 'session=secret', companyId: '123',
  });
  assert.equal(requests[2].init.method, 'PUT');
  assert.deepEqual(JSON.parse(requests[2].init.body), {
    clearCookie: true, companyId: '123',
  });

  scopes = ['listing:review'];
  const denied = await context.SS_ERP_EXTENSION_DEVICE_OZON_CDN_AUTH.write('shop-1', {
    cookie: 'must-not-send',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(denied)), {
    ok: false,
    errorCode: 'device_scope_required',
    error: '设备缺少 Cookie 同步权限',
  });
  assert.equal(requests.length, 3);

  const shops = await context.SS_ERP_EXTENSION_DEVICE_SHOPS();
  assert.equal(shops.ok, true);
  assert.equal(shops.data[0].companyId, '123');
  assert.equal(Object.hasOwn(shops.data[0], 'privateSetting'), false);
  operationCurrent = false;
  const staleShops = await context.SS_ERP_EXTENSION_DEVICE_SHOPS();
  assert.equal(staleShops.ok, false);
  assert.equal(staleShops.errorCode, 'device_authority_changed');
  assert.equal(JSON.stringify(staleShops).includes('BINI'), false);

  operationCurrent = true;
  scopes = ['capture:write'];
  responseStatus = 502;
  const uncertain = await context.SS_ERP_EXTENSION_DEVICE_OZON_CDN_AUTH.write('shop-1', {
    cookie: 'session=secret', companyId: '123',
  });
  assert.equal(uncertain.ok, false);
  assert.equal(uncertain.outcome, 'UNKNOWN_OUTCOME');
  assert.equal(uncertain.automaticRetryAllowed, false);
  assert.equal(uncertain.guardSessionId, 'session-1');

  responseStatus = 429;
  const throttled = await context.SS_ERP_EXTENSION_DEVICE_OZON_CDN_AUTH.write('shop-1', {
    cookie: 'session=secret', companyId: '123',
  });
  assert.equal(throttled.outcome, 'UNKNOWN_OUTCOME');
  assert.equal(throttled.automaticRetryAllowed, false);

  responseStatus = 200;
  invalidSuccessBody = true;
  const ambiguousSuccess = await context.SS_ERP_EXTENSION_DEVICE_OZON_CDN_AUTH.write('shop-1', {
    cookie: 'session=secret', companyId: '123',
  });
  assert.equal(ambiguousSuccess.outcome, 'UNKNOWN_OUTCOME');
  assert.equal(ambiguousSuccess.automaticRetryAllowed, false);

  invalidSuccessBody = false;
  responseReaderError = new Error('response stream failed');
  const interrupted = await context.SS_ERP_EXTENSION_DEVICE_OZON_CDN_AUTH.write('shop-1', {
    cookie: 'session=secret', companyId: '123',
  });
  assert.equal(interrupted.outcome, 'UNKNOWN_OUTCOME');
  assert.equal(interrupted.automaticRetryAllowed, false);
  responseReaderError = null;

  let oversizedReads = 0;
  let oversizedCancelled = false;
  const oversizedResponse = {
    headers: { get() { return '10'; } },
    body: {
      getReader() {
        return {
          async read() {
            oversizedReads += 1;
            if (oversizedReads === 1) {
              return { done: false, value: new Uint8Array(128 * 1024) };
            }
            if (oversizedReads === 2) {
              return { done: false, value: new Uint8Array(128 * 1024 + 1) };
            }
            throw new Error('must not read after the byte limit is exceeded');
          },
          async cancel() { oversizedCancelled = true; },
          releaseLock() {},
        };
      },
    },
  };
  await assert.rejects(
    context.readBoundedExtensionDeviceJson(oversizedResponse),
    /设备响应过大/,
  );
  assert.equal(oversizedReads, 2);
  assert.equal(oversizedCancelled, true);

  const prefix = '{"value":"';
  const suffix = '"}';
  const exactText = prefix
    + 'x'.repeat(context.SS_ERP_DEVICE_JSON_RESPONSE_MAX_BYTES - prefix.length - suffix.length)
    + suffix;
  const exactBytes = new TextEncoder().encode(exactText);
  let exactDelivered = false;
  const exactResult = await context.readBoundedExtensionDeviceJson({
    headers: { get() { return String(exactBytes.byteLength); } },
    body: {
      getReader() {
        return {
          async read() {
            if (exactDelivered) return { done: true, value: undefined };
            exactDelivered = true;
            return { done: false, value: exactBytes };
          },
          async cancel() {},
          releaseLock() {},
        };
      },
    },
  });
  assert.equal(exactBytes.byteLength, context.SS_ERP_DEVICE_JSON_RESPONSE_MAX_BYTES);
  assert.equal(exactResult.value.length, exactText.length - prefix.length - suffix.length);

  await assert.rejects(context.readBoundedExtensionDeviceJson({
    headers: { get() { return null; } },
    body: {
      getReader() {
        return {
          async read() { throw new Error('reader interrupted'); },
          async cancel() {},
          releaseLock() {},
        };
      },
    },
  }), /reader interrupted/);
});

test('multi-shop auto sync fails closed instead of reusing a cached shop', async () => {
  const start = workerSource.indexOf('function shopMatchesOzonCompanyId');
  const end = workerSource.indexOf('\nasync function updateOzonSyncTimes', start);
  assert.ok(start >= 0 && end > start, 'shop resolver must be extractable');
  const values = { ss_erp_cookie_shop: 'shop-a', ss_erp_selected_shop: 'shop-a' };
  const shops = [
    { id: 'shop-a', companyId: '1001', clientId: '1001' },
    { id: 'shop-b', companyId: '2002', clientId: '2002' },
  ];
  const context = {
    Array,
    Boolean,
    Object,
    Promise,
    String,
    chrome: {
      storage: {
        local: {
          async get() { return { ...values }; },
          async set(patch) { Object.assign(values, patch); },
        },
      },
    },
    normalizeOzonCompanyIdForSync(value) { return value == null ? '' : String(value).trim(); },
    toText(value) { return value == null ? '' : String(value); },
    async readOzonShopsForAutoSync() { return shops; },
  };
  context.globalThis = context;
  vm.runInNewContext(workerSource.slice(start, end), context, {
    filename: 'device-shop-company-resolver.js',
  });

  assert.equal((await context.resolveOzonAutoSyncShop('2002')).id, 'shop-b');
  values.ss_erp_cookie_shop = 'shop-a';
  values.ss_erp_selected_shop = 'shop-a';
  assert.equal(await context.resolveOzonAutoSyncShop('9999'), null);
  shops.push({ id: 'shop-b-duplicate', companyId: '2002', clientId: 'different' });
  assert.equal(await context.resolveOzonAutoSyncShop('2002'), null);
  assert.equal(await context.resolveOzonAutoSyncShop('', { requireCompanyMatch: true }), null);
  assert.equal((await context.resolveOzonAutoSyncShop('')).id, 'shop-a');
});

test('automatic Cookie sync rejects a seller company switch before device write', async () => {
  const start = workerSource.indexOf('async function syncOzonCookieToShopForSync');
  const end = workerSource.indexOf('\nglobalThis.syncOzonCookieToShopForSync', start);
  assert.ok(start >= 0 && end > start, 'Cookie sync function must be extractable');
  let writes = 0;
  let liveCompanyId = '2002';
  let failSyncTimeWrite = false;
  const context = {
    Array,
    Date,
    Error,
    Object,
    Promise,
    String,
    toText(value) { return value == null ? '' : String(value); },
    normalizeOzonCompanyIdForSync(value) { return value == null ? '' : String(value).trim(); },
    async getOzonSellerCookiesForSync() {
      return liveCompanyId
        ? [{ name: 'sc_company_id', value: liveCompanyId, domain: 'seller.ozon.ru', path: '/' }]
        : [{ name: 'session', value: 'x', domain: 'seller.ozon.ru', path: '/' }];
    },
    async readOzonSellerCookieStringFromOpenTabForSync() {
      return liveCompanyId ? `sc_company_id=${liveCompanyId}; session=x` : 'session=x';
    },
    async readOzonSellerCookieValueFromOpenTabForSync() { return liveCompanyId; },
    mergeCookieStringsForSync(left, right) { return [left, right].filter(Boolean).join('; '); },
    cookieStringFromOzonCookiesForSync() {
      return liveCompanyId ? `sc_company_id=${liveCompanyId}` : 'session=x';
    },
    findOzonCompanyIdFromCookies() { return liveCompanyId; },
    async getCapturedOzonCompanyIdForSync() { return '1001'; },
    async fetchStoredOzonCompanyIdForSync() { return '1001'; },
    async writeOzonCdnAuthForSync() { writes += 1; return { ok: true, data: {} }; },
    rememberRuntimeOzonCompanyIdForSync() {},
    async updateOzonSyncTimes() {
      if (failSyncTimeWrite) throw new Error('diagnostic storage failed');
    },
  };
  context.globalThis = context;
  vm.runInNewContext(workerSource.slice(start, end), context, {
    filename: 'automatic-cookie-company-binding.js',
  });

  await assert.rejects(context.syncOzonCookieToShopForSync('shop-a', {
    companyId: '1001', automatic: true,
  }), (error) => error.errorCode === 'ozon_company_binding_mismatch');
  await assert.rejects(context.syncOzonCookieToShopForSync('shop-a', {
    companyId: '1001', requireCompanyMatch: true,
  }), (error) => error.errorCode === 'ozon_company_binding_mismatch');
  liveCompanyId = '';
  await assert.rejects(context.syncOzonCookieToShopForSync('shop-a', {
    companyId: '1001', automatic: true,
  }), (error) => error.errorCode === 'ozon_company_binding_mismatch');
  liveCompanyId = '1001';
  failSyncTimeWrite = true;
  const successfulWrite = await context.syncOzonCookieToShopForSync('shop-a', {
    companyId: '1001', automatic: true,
  });
  assert.equal(successfulWrite.ok, true);
  assert.equal(writes, 1);
});

test('automatic maintenance skips analytics and graphs when Cookie binding is unverified', async () => {
  const start = workerSource.indexOf('function shouldRunOzonAutoSyncSlot');
  const end = workerSource.indexOf('\nasync function readOzonAutoSyncStatus', start);
  assert.ok(start >= 0 && end > start, 'auto maintenance must be extractable');
  let analyticsWrites = 0;
  let graphWrites = 0;
  let storedState = null;
  let cookieBindingFails = true;
  let failStateWrite = false;
  let graphSyncThrows = false;
  const context = {
    Boolean,
    Date,
    Object,
    Promise,
    String,
    SS_ERP_OZON_AUTO_SYNC_INTERVAL_MS: 30 * 60 * 1000,
    SS_ERP_OZON_AUTO_SYNC_STATE_KEY: 'auto-state',
    chrome: {
      storage: {
        local: {
          async get() { return {}; },
          async set(patch) {
            if (failStateWrite) throw new Error('auto-state storage failed');
            storedState = patch['auto-state'];
          },
        },
      },
    },
    toText(value) { return value == null ? '' : String(value); },
    normalizeOzonCompanyIdForSync(value) { return value == null ? '' : String(value).trim(); },
    async getCapturedOzonCompanyIdForSync() { return '1001'; },
    async readOzonSellerCookieValueFromOpenTabForSync() { return '1001'; },
    async resolveOzonAutoSyncShop() { return { id: 'shop-a' }; },
    async syncOzonCookieToShopForSync() {
      if (!cookieBindingFails) return { ok: true, syncedAt: '2030-01-01T00:00:00.000Z' };
      const error = new Error('seller company changed');
      error.errorCode = 'ozon_company_binding_mismatch';
      throw error;
    },
    publicOzonSyncError(error) {
      return { ok: false, error: error.message, errorCode: error.errorCode };
    },
    async updateOzonSyncTimes() {},
    SS_ERP_COLLECT_BACKGROUND: {
      async syncShopAnalyticsToErp() { analyticsWrites += 1; return { ok: true }; },
      async syncShopGraphsToErp() {
        graphWrites += 1;
        if (graphSyncThrows) throw new Error('graph sync failed after Cookie success');
        return { ok: true };
      },
    },
  };
  context.globalThis = context;
  vm.runInNewContext(workerSource.slice(start, end), context, {
    filename: 'automatic-maintenance-binding.js',
  });

  const result = await context.runOzonAutoSyncMaintenance({ force: true });

  assert.equal(result.ok, false);
  assert.equal(result.cookie.errorCode, 'ozon_company_binding_mismatch');
  assert.equal(result.analytics.reason, 'company_binding_unverified');
  assert.equal(result.graphs.reason, 'company_binding_unverified');
  assert.equal(analyticsWrites, 0);
  assert.equal(graphWrites, 0);
  assert.equal(storedState.lastResult.analytics.skipped, true);
  assert.equal(storedState.lastResult.graphs.skipped, true);

  cookieBindingFails = false;
  graphSyncThrows = true;
  const graphFailureResult = await context.runOzonAutoSyncMaintenance({ force: true });
  assert.equal(graphFailureResult.ok, true);
  assert.equal(graphFailureResult.graphs.ok, false);
  assert.equal(analyticsWrites, 1);
  assert.equal(graphWrites, 1);
  assert.equal(typeof storedState.cookieAt, 'number');

  graphSyncThrows = false;
  failStateWrite = true;
  const successfulResult = await context.runOzonAutoSyncMaintenance({ force: true });
  assert.equal(successfulResult.ok, true);
  assert.equal(analyticsWrites, 2);
  assert.equal(graphWrites, 2);
});

test('unknown device Cookie writes survive worker restart and block automatic retries', async () => {
  const start = workerSource.indexOf('async function writeOzonCdnAuthForSync');
  const end = workerSource.indexOf('\nfunction ensureOzonAutoSyncAlarm', start);
  assert.ok(start >= 0 && end > start, 'Cookie write guard must be extractable');
  const values = {};
  let writes = 0;
  let failLocalGets = false;
  let failLocalSets = false;
  let failLocalRemoves = false;
  let transportError = null;
  let digestCrypto = globalThis.crypto;
  let transportOrder = null;
  let nextWriteResult = {
    ok: false,
    error: 'network lost',
    errorCode: 'device_cookie_write_outcome_unknown',
    outcome: 'UNKNOWN_OUTCOME',
    automaticRetryAllowed: false,
    guardSessionId: 'session-1',
  };
  const localStorage = {
    async get(keys) {
      if (failLocalGets) throw new Error('local storage read failed');
      const result = {};
      keys.forEach((key) => { if (Object.hasOwn(values, key)) result[key] = values[key]; });
      return result;
    },
    async set(patch) {
      if (failLocalSets) throw new Error('local storage write failed');
      Object.assign(values, structuredClone(patch));
    },
    async remove(keys) {
      if (failLocalRemoves) throw new Error('local storage remove failed');
      keys.forEach((key) => { delete values[key]; });
    },
  };
  const createContext = () => {
    const context = {
      Array,
      Date,
      Error,
      JSON,
      Map,
      Object,
      Promise,
      String,
      TextEncoder,
      Uint8Array,
      crypto: digestCrypto,
      SS_ERP_OZON_CDN_WRITE_GUARDS_KEY: 'write-guards',
      SS_ERP_OZON_CDN_WRITE_GUARD_MAX: 50,
      ozonCdnWriteQueues: new Map(),
      ozonCdnWriteEpochs: new Map(),
      ozonCdnMemoryGuards: new Map(),
      ozonCdnGuardStorageQueue: Promise.resolve(),
      chrome: { storage: { local: localStorage } },
      toText(value) { return value == null ? '' : String(value); },
      normalizeOzonCompanyIdForSync(value) { return value == null ? '' : String(value).trim(); },
      deviceShopIdentifier(value) {
        const text = value == null ? '' : String(value).trim();
        return text && text.length <= 200 ? text : null;
      },
      getLogisticsDeviceCredentials() {
        return { async getStatus() { return { state: 'paired', sessionId: 'session-1' }; } };
      },
      async writeExtensionDeviceOzonCdnAuth(shopId, _payload, sessionId) {
        const armedGuard = Array.isArray(values['write-guards'])
          ? values['write-guards'].find((guard) => (
            guard.shopId === shopId && guard.sessionId === sessionId
          ))
          : null;
        assert.ok(armedGuard, 'unresolved guard must be durable before transport starts');
        writes += 1;
        if (transportOrder) transportOrder.push(_payload.cookie || _payload.companyId);
        if (transportError) throw transportError;
        return nextWriteResult;
      },
    };
    context.globalThis = context;
    vm.runInNewContext(workerSource.slice(start, end), context, {
      filename: 'device-cookie-write-guard.js',
    });
    return context;
  };

  const firstWorker = createContext();
  const payload = { cookie: 'session=secret', companyId: '1001' };
  const historicalRequestSha256 = createHash('sha256')
    .update(JSON.stringify({ cookie: 'session=secret', companyId: '1001' }))
    .digest('hex');
  assert.equal(
    await firstWorker.ozonCdnWriteRequestSha256(payload),
    historicalRequestSha256,
    'ordinary Cookie writes must retain the pre-clearCookie guard hash',
  );
  assert.notEqual(
    await firstWorker.ozonCdnWriteRequestSha256({ clearCookie: true, companyId: '1001' }),
    historicalRequestSha256,
  );
  await assert.rejects(firstWorker.writeOzonCdnAuthForSync('shop-1', payload), (error) => (
    error.outcome === 'UNKNOWN_OUTCOME' && error.automaticRetryAllowed === false
  ));
  assert.equal(writes, 1);
  assert.equal(values['write-guards'].length, 1);
  assert.match(values['write-guards'][0].requestSha256, /^[a-f0-9]{64}$/);

  const restartedWorker = createContext();
  await assert.rejects(restartedWorker.writeOzonCdnAuthForSync(
    'shop-1', payload, { automatic: true },
  ), (error) => (
    error.errorCode === 'device_cookie_write_blocked_unknown'
    && error.automaticRetryAllowed === false
  ));
  await assert.rejects(restartedWorker.writeOzonCdnAuthForSync('shop-1', {
    cookie: 'different-session', companyId: '1001',
  }), (error) => error.errorCode === 'device_cookie_write_blocked_unknown');
  assert.equal(writes, 1);

  nextWriteResult = {
    ok: false,
    error: 'validation failed',
    errorCode: 'device_cookie_request_failed',
    status: 422,
  };
  await assert.rejects(restartedWorker.writeOzonCdnAuthForSync('shop-1', payload), (error) => (
    error.errorCode === 'device_cookie_request_failed'
  ));
  assert.equal(writes, 2);
  assert.equal(values['write-guards'].length, 1);

  nextWriteResult = { ok: true, authMode: 'device', data: {} };
  await restartedWorker.writeOzonCdnAuthForSync('shop-1', payload);
  assert.equal(writes, 3);
  assert.equal(Object.hasOwn(values, 'write-guards'), false);

  let active = 0;
  let maximumActive = 0;
  restartedWorker.writeExtensionDeviceOzonCdnAuth = async () => {
    writes += 1;
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5));
    active -= 1;
    return { ok: true, authMode: 'device', data: {} };
  };
  await Promise.all([
    restartedWorker.writeOzonCdnAuthForSync('shop-1', payload),
    restartedWorker.writeOzonCdnAuthForSync('shop-1', payload),
  ]);
  assert.equal(maximumActive, 1);

  let releaseUnknown;
  nextWriteResult = new Promise((resolve) => {
    releaseUnknown = () => resolve({
      ok: false,
      error: 'network lost again',
      errorCode: 'device_cookie_write_outcome_unknown',
      outcome: 'UNKNOWN_OUTCOME',
      automaticRetryAllowed: false,
      guardSessionId: 'session-1',
    });
  });
  const queuedWorker = createContext();
  const writesBeforeUnknownQueue = writes;
  const firstQueued = queuedWorker.writeOzonCdnAuthForSync('shop-2', payload);
  const secondQueued = queuedWorker.writeOzonCdnAuthForSync('shop-2', payload);
  await new Promise((resolve) => setTimeout(resolve, 0));
  releaseUnknown();
  await assert.rejects(firstQueued, (error) => error.outcome === 'UNKNOWN_OUTCOME');
  await assert.rejects(secondQueued, (error) => (
    error.errorCode === 'device_cookie_write_queue_superseded'
  ));
  assert.equal(writes, writesBeforeUnknownQueue + 1);

  transportError = new Error('authority verification storage failed after PUT');
  const thrownTransportWorker = createContext();
  const writesBeforeThrownTransport = writes;
  const firstThrown = thrownTransportWorker.writeOzonCdnAuthForSync('shop-thrown', payload);
  const secondThrown = thrownTransportWorker.writeOzonCdnAuthForSync('shop-thrown', payload);
  const [firstThrownResult, secondThrownResult] = await Promise.allSettled([
    firstThrown,
    secondThrown,
  ]);
  assert.equal(firstThrownResult.status, 'rejected');
  assert.equal(firstThrownResult.reason.outcome, 'UNKNOWN_OUTCOME');
  assert.equal(secondThrownResult.status, 'rejected');
  assert.equal(secondThrownResult.reason.errorCode, 'device_cookie_write_queue_superseded');
  assert.equal(writes, writesBeforeThrownTransport + 1);
  transportError = null;

  values['write-guards'] = Array.from({ length: 50 }, (_, index) => ({
    shopId: `shop-${index + 1}`,
    sessionId: 'session-1',
    requestSha256: String(index + 1).padStart(64, '0'),
    outcome: 'UNKNOWN_OUTCOME',
    createdAt: '2030-01-01T00:00:00.000Z',
  }));
  const capacityWorker = createContext();
  assert.equal((await capacityWorker.readOzonCdnWriteGuards('session-1')).length, 50);
  const writesBeforeCapacityBlock = writes;
  await assert.rejects(capacityWorker.writeOzonCdnAuthForSync(
    'shop-1', payload, { automatic: true },
  ), (error) => error.errorCode === 'device_cookie_write_blocked_unknown');
  assert.equal(writes, writesBeforeCapacityBlock);
  values['write-guards'].push({
    shopId: 'shop-51',
    sessionId: 'session-1',
    requestSha256: 'f'.repeat(64),
    outcome: 'UNKNOWN_OUTCOME',
    createdAt: '2030-01-01T00:00:00.000Z',
  });
  await assert.rejects(capacityWorker.readOzonCdnWriteGuards('session-1'), (error) => (
    error.errorCode === 'device_cookie_write_guard_unavailable'
  ));

  values['write-guards'] = [
    {
      shopId: 'conflict-shop',
      sessionId: 'session-1',
      requestSha256: 'a'.repeat(64),
      outcome: 'UNKNOWN_OUTCOME',
      createdAt: '2030-01-01T00:00:00.000Z',
    },
    {
      shopId: 'conflict-shop',
      sessionId: 'session-1',
      requestSha256: 'b'.repeat(64),
      outcome: 'UNKNOWN_OUTCOME',
      createdAt: '2030-01-01T00:00:00.000Z',
    },
  ];
  const conflictWorker = createContext();
  await assert.rejects(conflictWorker.readOzonCdnWriteGuards('session-1'), (error) => (
    error.errorCode === 'device_cookie_write_guard_unavailable'
  ));

  values['write-guards'] = Array.from({ length: 50 }, (_, index) => ({
    shopId: `old-shop-${index + 1}`,
    sessionId: 'old-session',
    requestSha256: String(index + 1).padStart(64, '0'),
    outcome: 'UNKNOWN_OUTCOME',
    createdAt: '2030-01-01T00:00:00.000Z',
  }));
  nextWriteResult = { ok: true, authMode: 'device', data: {} };
  const newSessionWorker = createContext();
  await newSessionWorker.writeOzonCdnAuthForSync('fresh-shop', payload);
  assert.equal(Object.hasOwn(values, 'write-guards'), false);

  nextWriteResult = {
    ok: false,
    error: 'new request rejected',
    errorCode: 'device_cookie_request_failed',
    status: 422,
  };
  const deterministicWorker = createContext();
  await assert.rejects(deterministicWorker.writeOzonCdnAuthForSync(
    'deterministic-shop', payload,
  ), (error) => error.errorCode === 'device_cookie_request_failed');
  assert.equal(Object.hasOwn(values, 'write-guards'), false);

  nextWriteResult = { ok: true, authMode: 'device', data: {} };
  failLocalRemoves = true;
  const clearFailureWorker = createContext();
  const writesBeforeClearFailure = writes;
  const firstClearFailure = clearFailureWorker.writeOzonCdnAuthForSync(
    'clear-failure-shop', payload,
  );
  const secondClearFailure = clearFailureWorker.writeOzonCdnAuthForSync(
    'clear-failure-shop', payload,
  );
  const [firstClearResult, secondClearResult] = await Promise.allSettled([
    firstClearFailure,
    secondClearFailure,
  ]);
  assert.equal(firstClearResult.status, 'rejected');
  assert.equal(firstClearResult.reason.errorCode, 'device_cookie_write_guard_unavailable');
  assert.equal(secondClearResult.status, 'rejected');
  assert.equal(secondClearResult.reason.errorCode, 'device_cookie_write_queue_superseded');
  assert.equal(writes, writesBeforeClearFailure + 1);
  assert.equal(values['write-guards'].length, 1);
  failLocalRemoves = false;
  const clearRecoveryWorker = createContext();
  await clearRecoveryWorker.writeOzonCdnAuthForSync('clear-failure-shop', payload);
  assert.equal(Object.hasOwn(values, 'write-guards'), false);

  delete values['write-guards'];
  failLocalSets = true;
  nextWriteResult = {
    ok: false,
    error: 'network lost while guard storage is unavailable',
    errorCode: 'device_cookie_write_outcome_unknown',
    outcome: 'UNKNOWN_OUTCOME',
    automaticRetryAllowed: false,
    guardSessionId: 'session-1',
  };
  const storageFailureWorker = createContext();
  const writesBeforeStorageFailure = writes;
  await assert.rejects(storageFailureWorker.writeOzonCdnAuthForSync('shop-storage', payload), (error) => (
    error.errorCode === 'device_cookie_write_guard_unavailable'
    && error.automaticRetryAllowed === false
  ));
  assert.equal(writes, writesBeforeStorageFailure);
  assert.equal(storageFailureWorker.ozonCdnMemoryGuards.size, 0);

  failLocalSets = false;
  failLocalGets = true;
  const readFailureWorker = createContext();
  await assert.rejects(readFailureWorker.writeOzonCdnAuthForSync('shop-read', payload), (error) => (
    error.errorCode === 'device_cookie_write_guard_unavailable'
  ));
  assert.equal(writes, writesBeforeStorageFailure);

  failLocalGets = false;
  nextWriteResult = { ok: true, authMode: 'device', data: {} };
  transportOrder = [];
  digestCrypto = {
    subtle: {
      async digest(_algorithm, bytes) {
        const value = new TextDecoder().decode(bytes);
        if (value.includes('first-large')) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        return new Uint8Array(32).buffer;
      },
    },
  };
  const fifoWorker = createContext();
  await Promise.all([
    fifoWorker.writeOzonCdnAuthForSync('shop-fifo', {
      cookie: `first-large-${'x'.repeat(2048)}`,
    }),
    fifoWorker.writeOzonCdnAuthForSync('shop-fifo', { companyId: 'second-small' }),
  ]);
  assert.deepEqual(
    transportOrder.map((value) => value.startsWith('first-large') ? 'first' : value),
    ['first', 'second-small'],
  );
});

test('device Cookie status is callable only from trusted extension pages', () => {
  const context = { URL };
  context.globalThis = context;
  vm.runInNewContext(policySource, context, { filename: 'runtime-message-policy.js' });
  const policy = context.SS_ERP_RUNTIME_MESSAGE_POLICY;
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const sender = (url) => ({
    id: extensionId,
    url,
    origin: url.startsWith('chrome-extension:')
      ? `chrome-extension://${extensionId}`
      : new URL(url).origin,
  });
  const type = 'ozon-calc:get-ozon-cdn-auth';

  assert.equal(policy.isAllowedRuntimeMessageSender(
    type,
    sender(`chrome-extension://${extensionId}/pages/popup.html`),
    extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    type,
    sender(`chrome-extension://${extensionId}/pages/settings.html`),
    extensionId,
  ), true);
  for (const url of [
    'https://seller.ozon.ru/app/dashboard',
    'https://ss-erp.com/settings',
    'https://detail.1688.com/offer/123.html',
  ]) {
    assert.equal(policy.isAllowedRuntimeMessageSender(type, sender(url), extensionId), false);
  }
});

test('settings runtime messages settle after a bounded timeout when Chrome drops the callback', async () => {
  const start = source.indexOf('function sendMessage(message)');
  const end = source.indexOf('\n  function formatRuntimeError', start);
  assert.ok(start >= 0 && end > start, 'sendMessage helper must be extractable');
  let scheduled = null;
  let callback = null;
  const context = {
    Promise,
    String,
    SS_ERP_MESSAGE_TIMEOUT_MS: 60000,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(_message, next) { callback = next; },
      },
    },
    clearTimeout() {},
    setTimeout(fn, delay) {
      scheduled = { fn, delay };
      return 1;
    },
    formatRuntimeError(message) { return String(message || ''); },
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.sendMessage = sendMessage;', context);

  const pending = context.sendMessage({ type: 'ss-erp:logistics-rules-sync' });
  assert.equal(typeof callback, 'function');
  assert.ok(scheduled, 'a lost Chrome callback must have a timeout fallback');
  assert.equal(scheduled.delay, 60000);
  scheduled.fn();

  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), {
    ok: false,
    errorCode: 'runtime_timeout',
    error: '扩展后台响应超时，操作可能仍在后台执行，请刷新状态后重试。',

  });
});

test('all four manual logistics entry points delegate to unified scoped persistence', () => {
  assert.match(workerSource, /importScripts\('\.\.\/shared\/logistics-rules\/manual-fallback-persistence\.js'\)/);
  assert.equal((workerSource.match(/persistManualCalculatorData\(\{/g) || []).length, 4);
  for (const marker of [
    'if (message.type === OZON_CALC_SYNC_CHANNEL)',
    "if (message.type === 'ozon-calculator:build-config-from-captured-seller')",
    "if (message.type === 'ozon-calculator:sync-captured-seller-official')",
    "if (message.type === 'ozon-calculator:sync-captured-official')",
  ]) {
    const start = workerSource.indexOf(marker);
    const end = workerSource.indexOf('\n  if (message.type === ', start + marker.length);
    assert.ok(start >= 0 && end > start, marker + ' must be extractable');
    const handler = workerSource.slice(start, end);
    assert.match(handler, /persistManualCalculatorData\(\{/);
    assert.match(handler, /scope_required/);
  }
});

const persistencePath = 'extensions/ss-erp/shared/logistics-rules/manual-fallback-persistence.js';

function loadPersistence(options = {}) {
  assert.equal(fs.existsSync(persistencePath), true, 'manual fallback persistence helper is required');
  const context = { console, JSON, Object, Array, String, Boolean, Date };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(persistencePath, 'utf8'), context, {
    filename: 'manual-fallback-persistence.js',
  });
  return context.SS_ERP_LOGISTICS_MANUAL_FALLBACK.createPersistence(options);
}

function createStorage(initial = {}) {
  const values = JSON.parse(JSON.stringify(initial));
  const writes = [];
  return {
    writes,
    values,
    async get(keys) {
      return Object.fromEntries(keys.filter((key) => key in values).map((key) => [key, values[key]]));
    },
    async set(input) {
      writes.push(JSON.parse(JSON.stringify(input)));
      Object.assign(values, JSON.parse(JSON.stringify(input)));
    },
  };
}

const fallbackScope = {
  deploymentId: 'local-dev', tenantSubject: 'tenant-a', shopId: 'shop-a',
  ozonCompanyId: 'company-a', warehouseId: 'warehouse-a',
  originCountryUid: 'china', originCityUid: 'xiamen',
  destinationCountryUid: 'russia', destinationLocationUid: 'moscow',
  assignmentId: 'assignment-a', schemaMajor: 1,
};
const fallbackSnapshot = {
  userConfig: { selectedServiceIds: ['manual-a'] },
  catalogSnapshot: { metadata: { source: 'erp_release' }, services: [{ id: 'manual-a' }] },
  ruleSnapshot: { services: [{ serviceId: 'manual-a' }] },
};

test('manual persistence fails closed when distribution is enabled without an active scope', async () => {
  const storage = createStorage({ 'ozon-calc:config-snapshot': { legacy: true } });
  const persistence = loadPersistence({
    storage,
    isFeatureEnabled: () => true,
    runtime: { async saveLocalFallback() { throw new Error('must not run'); } },
  });

  const result = await persistence.persist({ snapshot: fallbackSnapshot });

  assert.equal(result.state, 'scope_required');
  assert.equal(storage.writes.length, 0);
  assert.deepEqual(storage.values['ozon-calc:config-snapshot'], { legacy: true });
});

test('manual persistence keeps healthy remote rules active and scopes fallback samples exactly', async () => {
  const storage = createStorage({
    'ozon-logistics:calculator-state:v1': { scope: fallbackScope, state: 'healthy', source: 'remote' },
  });
  const calls = [];
  const remoteState = { state: 'healthy', source: 'remote', quoteAllowed: true, snapshot: { remote: true } };
  const persistence = loadPersistence({
    storage,
    isFeatureEnabled: () => true,
    runtime: {
      async saveLocalFallback() { throw new Error('erp_release must use one atomic command'); },
      async updatePreferences() { throw new Error('erp_release must use one atomic command'); },
      async saveLocalFallbackWithPreferences(input) {
        calls.push(['configuration', input]); return remoteState;
      },
    },
  });
  const officialSnapshot = {
    samples: [
      { request: { origin: { countryUid: 'china', cityUid: 'xiamen' }, destination: { countryUid: 'russia', locationUid: 'moscow' } } },
      { request: { origin: { countryUid: 'china', cityUid: 'shenzhen' }, destination: { countryUid: 'russia', locationUid: 'moscow' } } },
    ],
  };

  const result = await persistence.persist({
    snapshot: fallbackSnapshot,
    officialSnapshot,
    source: 'erp_release',
  });

  assert.equal(result.state, 'healthy');
  assert.equal(result.mode, 'scoped_fallback');
  assert.equal(calls[0][0], 'configuration');
  assert.equal(calls[0][1].officialSnapshot.samples.length, 1);
  assert.equal(calls[0][1].officialSnapshot.scope.assignmentId, fallbackScope.assignmentId);
  assert.equal(calls.length, 1);
  assert.equal(storage.writes.length, 0);
});

test('Official-only persistence delegates to the exact existing scoped fallback', async () => {
  const storage = createStorage({
    'ozon-logistics:calculator-state:v1': { scope: fallbackScope, state: 'local_fallback' },
  });
  let saved = null;
  const persistence = loadPersistence({
    storage,
    isFeatureEnabled: () => true,
    runtime: {
      async saveLocalFallback(input) {
        saved = input;
        return { state: 'local_fallback', snapshot: fallbackSnapshot, officialSnapshot: input.officialSnapshot };
      },
    },
  });

  const result = await persistence.persist({
    officialSnapshot: {
      samples: [{ request: { origin: { countryUid: 'china', cityUid: 'xiamen' }, destination: { countryUid: 'russia', locationUid: 'moscow' } } }],
    },
  });

  assert.equal(saved.snapshot, undefined);
  assert.equal(saved.scopeBinding.assignmentId, fallbackScope.assignmentId);
  assert.equal(result.state, 'local_fallback');
});

test('manual persistence retains legacy global storage only while distribution is disabled', async () => {
  const storage = createStorage();
  const officialSnapshot = { tariffs: [{ id: 'official-a' }] };
  const persistence = loadPersistence({
    storage,
    isFeatureEnabled: () => false,
    getRuntime() { throw new Error('must not run'); },
    now: () => new Date('2026-07-14T00:00:00.000Z'),
  });

  const result = await persistence.persist({ snapshot: fallbackSnapshot, officialSnapshot });

  assert.equal(result.mode, 'legacy_unscoped');
  assert.deepEqual(storage.values['ozon-calc:config-snapshot'], fallbackSnapshot);
  assert.deepEqual(storage.values['ozon-calculator:official-snapshot'], officialSnapshot);
  assert.equal(storage.values['ozon-calc:config-updated-at'], '2026-07-14T00:00:00.000Z');
});

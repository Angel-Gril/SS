import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const moduleSource = readFileSync(
  'extensions/ss-erp/shared/ozon/seller-origin-access.js',
  'utf8',
);

function loadApi() {
  const context = { URL, console };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(moduleSource, context, {
    filename: 'seller-origin-access.js',
  });
  return context.SS_ERP_SELLER_ORIGIN_ACCESS;
}

function createEvent() {
  const listeners = new Set();
  return {
    api: {
      addListener(listener) {
        listeners.add(listener);
      },
    },
    emit(change) {
      listeners.forEach((listener) => listener(change));
    },
  };
}

function outcome(value) {
  return value && typeof value === 'object' ? value : { granted: Boolean(value) };
}

function createChromeMock({
  containsResults = [],
  requestResults = [true],
  includeContains = true,
  includeRequest = true,
} = {}) {
  const remainingContains = [...containsResults];
  const remainingRequests = [...requestResults];
  const onAdded = createEvent();
  const onRemoved = createEvent();
  let requestCalls = 0;
  let requestCalledSynchronously = false;
  let insideRequestCall = false;
  const runtime = { id: 'test-extension-id', lastError: null };
  const permissions = {
    onAdded: onAdded.api,
    onRemoved: onRemoved.api,
  };
  if (includeContains) {
    permissions.contains = (spec, callback) => {
      assert.equal(JSON.stringify(spec), JSON.stringify({ origins: ['https://seller.ozon.ru/*'] }));
      const next = outcome(remainingContains.shift());
      if (next.throw) throw next.throw;
      queueMicrotask(() => {
        runtime.lastError = next.lastError ? { message: next.lastError } : null;
        callback(Boolean(next.granted));
        runtime.lastError = null;
      });
    };
  }
  if (includeRequest) {
    permissions.request = (spec, callback) => {
      assert.equal(JSON.stringify(spec), JSON.stringify({ origins: ['https://seller.ozon.ru/*'] }));
      requestCalls += 1;
      requestCalledSynchronously = insideRequestCall;
      const next = outcome(remainingRequests.shift());
      if (next.throw) throw next.throw;
      queueMicrotask(() => {
        runtime.lastError = next.lastError ? { message: next.lastError } : null;
        callback(Boolean(next.granted));
        runtime.lastError = null;
      });
    };
  }
  return {
    chrome: { permissions, runtime },
    beginRequest() {
      insideRequestCall = true;
    },
    endRequest() {
      insideRequestCall = false;
    },
    requestCalls() {
      return requestCalls;
    },
    requestCalledSynchronously() {
      return requestCalledSynchronously;
    },
    triggerAdded(origins) {
      onAdded.emit({ origins });
    },
    triggerRemoved(origins) {
      onRemoved.emit({ origins });
    },
  };
}

function inspect(access) {
  return new Promise((resolve) => access.inspect(resolve));
}

function request(access, harness) {
  return new Promise((resolve) => {
    harness.beginRequest();
    access.request(resolve);
    harness.endRequest();
  });
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const api = loadApi();
assert.equal(api.SELLER_ORIGIN, 'https://seller.ozon.ru/*');

{
  const harness = createChromeMock({
    containsResults: [true, true],
    requestResults: [true],
  });
  const access = api.create(harness.chrome);
  assert.deepEqual(plain(await inspect(access)), { ok: true, granted: true });
  assert.deepEqual(plain(await request(access, harness)), {
    ok: true,
    granted: true,
    requested: false,
  });
  assert.equal(
    harness.requestCalls(),
    0,
    'an effective cached Seller grant must not open another permission prompt',
  );
}

{
  const harness = createChromeMock({
    containsResults: [true, false],
    requestResults: [true],
  });
  const access = api.create(harness.chrome);
  assert.deepEqual(plain(await inspect(access)), { ok: true, granted: true });
  const result = await request(access, harness);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'seller_site_access_denied');
  assert.equal(harness.requestCalls(), 0, 'a stale cache must stop instead of claiming access');
}

{
  const harness = createChromeMock({
    containsResults: [false, true],
    requestResults: [true],
  });
  const access = api.create(harness.chrome);
  assert.deepEqual(plain(await inspect(access)), { ok: true, granted: false });
  assert.deepEqual(plain(await request(access, harness)), {
    ok: true,
    granted: true,
    requested: true,
  });
  assert.equal(harness.requestCalls(), 1);
  assert.equal(
    harness.requestCalledSynchronously(),
    true,
    'permissions.request must remain inside the trusted click call stack',
  );
}

{
  const harness = createChromeMock({
    containsResults: [false, true],
    requestResults: [{ granted: false, lastError: 'The user gesture expired' }],
  });
  const access = api.create(harness.chrome);
  assert.deepEqual(plain(await inspect(access)), { ok: true, granted: false });
  assert.deepEqual(plain(await request(access, harness)), {
    ok: true,
    granted: true,
    requested: false,
  });
  assert.equal(
    harness.requestCalls(),
    1,
    'a request API error must still verify the effective Chrome host grant',
  );
}

for (const requestResult of [false, true]) {
  const harness = createChromeMock({
    containsResults: [false, false],
    requestResults: [requestResult],
  });
  const access = api.create(harness.chrome);
  await inspect(access);
  const result = await request(access, harness);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'seller_site_access_denied');
  assert.match(result.error, /当前 Chrome 配置文件/);
  assert.match(result.error, /不会共享/);
}

for (const missingMethod of ['contains', 'request']) {
  const harness = createChromeMock({
    includeContains: missingMethod !== 'contains',
    includeRequest: missingMethod !== 'request',
  });
  const access = api.create(harness.chrome);
  const result = missingMethod === 'contains'
    ? await inspect(access)
    : await request(access, harness);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, 'seller_site_access_api_unavailable');
}

for (const failure of [
  { containsResults: [{ throw: new Error('contains threw') }], code: 'seller_site_access_check_failed' },
  { containsResults: [{ lastError: 'contains lastError' }], code: 'seller_site_access_check_failed' },
  { requestResults: [{ throw: new Error('request threw') }], code: 'seller_site_access_request_failed' },
  {
    containsResults: [false],
    requestResults: [{ granted: false, lastError: 'request lastError' }],
    code: 'seller_site_access_request_failed',
  },
]) {
  const harness = createChromeMock(failure);
  const access = api.create(harness.chrome);
  const result = failure.code.includes('check')
    ? await inspect(access)
    : await request(access, harness);
  assert.equal(result.ok, false);
  assert.equal(result.errorCode, failure.code);
}

{
  const harness = createChromeMock({ containsResults: [true] });
  const access = api.create(harness.chrome);
  const events = [];
  access.subscribe((event) => events.push(plain(event)));
  harness.triggerRemoved(['https://relay.example/*']);
  assert.deepEqual(events, [], 'unrelated Provider permission events must not affect Seller state');
  harness.triggerRemoved(['https://seller.ozon.ru/*']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    events,
    [{ ok: true, granted: true }],
    'removing one overlapping grant must preserve an effective exact Seller grant',
  );
}

{
  const harness = createChromeMock({ containsResults: [false] });
  const access = api.create(harness.chrome);
  const events = [];
  access.subscribe((event) => events.push(plain(event)));
  harness.triggerRemoved(['https://*.ozon.ru/*']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [{ ok: true, granted: false }]);
}

{
  const harness = createChromeMock({ containsResults: [true] });
  const access = api.create(harness.chrome);
  const events = [];
  access.subscribe((event) => events.push(plain(event)));
  harness.triggerAdded(['https://*.ozon.ru/*']);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [{ ok: true, granted: true }]);
}

{
  const onRemoved = createEvent();
  const callbacks = [];
  const permissions = {
    contains(_spec, callback) {
      callbacks.push(callback);
    },
    request() {},
    onAdded: createEvent().api,
    onRemoved: onRemoved.api,
  };
  const access = api.create({ permissions, runtime: { lastError: null } });
  const pending = inspect(access);
  onRemoved.emit({ origins: ['https://*.ozon.ru/*'] });
  callbacks.shift()(true);
  assert.equal(callbacks.length, 2, 'a stale contains callback must trigger a fresh exact check');
  callbacks.shift()(false);
  callbacks.shift()(false);
  assert.deepEqual(plain(await pending), { ok: true, granted: false });
}

const collectBackgroundSource = readFileSync(
  'extensions/ss-erp/background/collect-background.js',
  'utf8',
);

function loadCollectPermissionApi(chrome) {
  const constantSource = [
    'SELLER_OZON_ORIGIN',
    'SELLER_OZON_PERMISSION_ERROR',
    'SELLER_OZON_PERMISSION_CHECK_ERROR',
    'SELLER_OZON_PAGE_SCRIPT_ERROR',
  ].map((name) => {
    const match = collectBackgroundSource.match(new RegExp(`const ${name} = [^\\n]+;`));
    assert.ok(match, `collect background must define ${name}`);
    return match[0];
  }).join('\n');
  const normalizeSource = collectBackgroundSource.match(
    /function normalizeErrorMessage\(error\) \{[\s\S]*?\n\}/,
  );
  const hostErrorSource = collectBackgroundSource.match(
    /function isHostAccessError\(error\) \{[\s\S]*?\n\}/,
  );
  const permissionSource = collectBackgroundSource.match(
    /function sellerOzonAccessError\(errorCode, message\) \{[\s\S]*?\r?\n\}\r?\n\r?\nfunction parseCookieValueFromString/,
  );
  assert.ok(normalizeSource, 'collect background must expose error normalization for VM regression');
  assert.ok(hostErrorSource, 'collect background must classify Chrome host-access errors');
  assert.ok(permissionSource, 'collect background must expose its complete Seller permission flow');

  const context = { chrome, console, Promise, setTimeout };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    `${constantSource}\n${normalizeSource[0]}\n${hostErrorSource[0]}\n`
      + `${permissionSource[0].replace(/\r?\n\r?\nfunction parseCookieValueFromString$/, '')}\n`
      + 'globalThis.permissionApi = {'
      + 'chromePermissionsInspect, ensureSellerOzonHostAccess, executeScriptWithHostAccess};',
    context,
    { filename: 'collect-background-seller-permission.js' },
  );
  return context.permissionApi;
}

async function rejectedError(promise) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected promise to reject');
}

{
  const runtime = { lastError: null };
  const chrome = {
    runtime,
    permissions: {
      contains(_spec, callback) {
        runtime.lastError = { message: 'Permission database temporarily unavailable' };
        callback(false);
        runtime.lastError = null;
      },
    },
  };
  const permissionApi = loadCollectPermissionApi(chrome);
  const error = await rejectedError(permissionApi.ensureSellerOzonHostAccess());
  assert.equal(error.errorCode, 'seller_site_access_check_failed');
  assert.doesNotMatch(error.message, /未获得 seller\.ozon\.ru 站点访问权限/);
}

{
  const runtime = { lastError: null };
  const chrome = {
    runtime,
    permissions: {
      contains(_spec, callback) {
        callback(true);
      },
    },
    scripting: {
      async executeScript() {
        throw new Error('Cannot access contents of url https://seller.ozon.ru/app/');
      },
    },
    tabs: {
      async get() {
        throw new Error('No tab with id: 42');
      },
    },
  };
  const permissionApi = loadCollectPermissionApi(chrome);
  const error = await rejectedError(permissionApi.executeScriptWithHostAccess(
    { target: { tabId: 42 }, func() {} },
    undefined,
    'https://seller.ozon.ru/*',
  ));
  assert.equal(error.errorCode, 'seller_page_script_unavailable');
  assert.doesNotMatch(error.message, /No tab with id/);
}

for (const [granted, expectedCode] of [
  [true, 'seller_page_script_unavailable'],
  [false, 'seller_site_access_denied'],
]) {
  const runtime = { lastError: null };
  const chrome = {
    runtime,
    permissions: {
      contains(_spec, callback) {
        callback(granted);
      },
    },
    scripting: {
      async executeScript() {
        throw new Error('Cannot access contents of url https://seller.ozon.ru/app/');
      },
    },
    tabs: {
      async get(tabId) {
        assert.equal(tabId, 42);
        return { id: tabId, url: 'https://seller.ozon.ru/app/' };
      },
    },
  };
  const permissionApi = loadCollectPermissionApi(chrome);
  const error = await rejectedError(permissionApi.executeScriptWithHostAccess({
    target: { tabId: 42 },
    func() {},
  }));
  assert.equal(
    error.errorCode,
    expectedCode,
    `executeScript host error with effective grant=${granted} must be classified precisely`,
  );
  if (granted) {
    assert.doesNotMatch(error.message, /未获得 seller\.ozon\.ru 站点访问权限/);
  } else {
    assert.match(error.message, /未获得 seller\.ozon\.ru 站点访问权限/);
  }
}

{
  let attempts = 0;
  const chrome = {
    runtime: { lastError: null },
    permissions: {
      contains(_spec, callback) {
        callback(true);
      },
    },
    scripting: {
      async executeScript() {
        attempts += 1;
        return [{ result: { ok: true } }];
      },
    },
    tabs: {
      async get(tabId) {
        return { id: tabId, status: 'complete', url: 'https://www.ozon.ru/product/123' };
      },
    },
  };
  const permissionApi = loadCollectPermissionApi(chrome);
  const error = await rejectedError(permissionApi.executeScriptWithHostAccess(
    { target: { tabId: 42 }, func() {} },
    undefined,
    'https://seller.ozon.ru/*',
  ));
  assert.equal(error.errorCode, 'seller_page_script_unavailable');
  assert.equal(attempts, 0, 'a navigated-away Seller tab must never run the supplied script');
}

assert.doesNotMatch(
  collectBackgroundSource.match(
    /async function executeScriptWithHostAccess[\s\S]*?\nfunction parseCookieValueFromString/,
  )[0],
  /return await chrome\.scripting\.executeScript\(options\)[\s\S]+return await chrome\.scripting\.executeScript\(options\)/,
  'Seller script execution must never retry an injected function with unknown completion',
);

const settingsHtml = readFileSync('extensions/ss-erp/pages/settings.html', 'utf8');
const popupHtml = readFileSync('extensions/ss-erp/pages/popup.html', 'utf8');
const settingsScript = readFileSync('extensions/ss-erp/pages/settings.js', 'utf8');
const popupScript = readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');
for (const [name, html, pageScript] of [
  ['settings', settingsHtml, 'settings.js'],
  ['popup', popupHtml, 'popup.js'],
]) {
  const sharedIndex = html.indexOf('../shared/ozon/seller-origin-access.js');
  const pageIndex = html.indexOf(pageScript);
  assert.ok(sharedIndex >= 0, `${name} must load the shared Seller origin access helper`);
  assert.ok(sharedIndex < pageIndex, `${name} must load the helper before its page controller`);
}
assert.match(settingsScript, /function requestSellerOzonAccess\(\)[\s\S]{0,500}access\.request\(/);
assert.match(popupScript, /function requestSellerOzonAccess\(callback\)[\s\S]{0,400}access\.request\(/);
assert.match(settingsHtml, /id="extensionRuntimeIdentity"/);
assert.match(settingsHtml, /id="sellerPermissionStatus"/);
assert.doesNotMatch(settingsScript, /授权店铺读取可用/);
assert.match(settingsScript, /updatePairedShopAccessStatus\('正在验证授权店铺'/);
assert.match(settingsScript, /updatePairedShopAccessStatus\('已授权 ' \+ shops\.length \+ ' 个店铺'/);
assert.match(settingsScript, /function pairLogisticsDevice\([\s\S]{0,2200}loadAnalyticsShops\(\)/);
assert.match(settingsScript, /var analyticsShopLoadSequence = 0/);
assert.match(settingsScript, /sequence !== analyticsShopLoadSequence/);

{
  const functionSource = settingsScript.match(
    /var analyticsShopLoadSequence = 0;[\s\S]*?\n {2}function sendSellerAnalyticsMessage/,
  );
  assert.ok(functionSource, 'settings shop loader must remain executable by the race regression test');

  const requests = [];
  const accessStatuses = [];
  const analyticsShopSelect = { innerHTML: '' };
  const context = {
    Promise,
    analyticsShopSelect,
    pairedDeviceStatus: { state: 'paired' },
    pairedDeviceStatusPromise: Promise.resolve({ state: 'paired' }),
    escapeHtml(value) {
      return String(value);
    },
    sendMessage(message) {
      assert.equal(message.type, 'spb-self-hosted:get-ozon-shops');
      let resolve;
      const promise = new Promise((settle) => {
        resolve = settle;
      });
      requests.push({ promise, resolve });
      return promise;
    },
    updatePairedShopAccessStatus(text, tone) {
      accessStatuses.push({ text, tone });
    },
  };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(
    `${functionSource[0].replace(/\n {2}function sendSellerAnalyticsMessage$/, '')}\n`
      + 'globalThis.loadAnalyticsShops = loadAnalyticsShops;',
    context,
    { filename: 'settings-shop-loader.js' },
  );

  context.loadAnalyticsShops();
  await new Promise((resolve) => setImmediate(resolve));
  context.loadAnalyticsShops();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);

  requests[1].resolve({ ok: true, data: [{ id: 'current', name: 'Current shop' }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(analyticsShopSelect.innerHTML, /current/);

  requests[0].resolve({ ok: true, data: [{ id: 'stale', name: 'Stale shop' }] });
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(analyticsShopSelect.innerHTML, /current/);
  assert.doesNotMatch(analyticsShopSelect.innerHTML, /stale/);
  assert.deepEqual(accessStatuses, [{ text: '已授权 1 个店铺', tone: '' }]);
}

console.log('PASS Seller origin access verification');

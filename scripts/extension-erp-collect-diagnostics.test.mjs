import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

test('extension background exposes ERP collect diagnostics ping', () => {
  const source = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');

  assert.match(
    source,
    /message\.type\s*===\s*['"]ss-erp:ping['"]/,
    'service worker should answer a lightweight ping from the ERP collect page',
  );
  assert.match(
    source,
    /hasCollectModule:\s*Boolean\(/,
    'ping response should tell the ERP page whether the Ozon collect module is loaded',
  );
  assert.match(
    source,
    /hasToken:\s*Boolean\(/,
    'ping response should report ERP token presence without exposing the token',
  );
  assert.match(
    source,
    /deviceState:/,
    'ping response should report the scoped device connection state without exposing credentials',
  );
  assert.match(
    source,
    /deviceScopes:/,
    'ping response should report device scopes without exposing the access token',
  );
});

test('extension popup treats a scoped device session as the primary ERP connection', () => {
  const popup = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');
  const popupHtml = fs.readFileSync('extensions/ss-erp/pages/popup.html', 'utf8');

  assert.match(popup, /ss-erp:extension-device-status/);
  assert.match(popup, /deviceStatus[\s\S]{0,1000}state\s*===\s*['"]paired['"]/);
  assert.match(popup, /设备已连接/);
  assert.match(popup, /设备待授权/);
  assert.match(popup, /设备授权失效/);
  assert.match(popup, /设备验证失败/);
  assert.match(popup, /未检测到 ERP/);
  assert.match(popup, /renderScopedDeviceStatus\(deviceStatus\)/);
  assert.match(popup, /isScopedStateAuthoritative/);
  assert.match(popup, /兼容模式/);
  assert.match(popupHtml, /device-connection-state\.js/);
  assert.match(
    popup,
    /if \(!baseUrl \|\| !token\)/,
    'legacy token status should remain as a compatibility fallback',
  );
});

test('ERP collect page checks extension status before starting Ozon collection', () => {
  const source = fs.readFileSync('apps/web/src/app/(dashboard)/collect/page.tsx', 'utf8');

  assert.match(
    source,
    /type:\s*['"]ss-erp:ping['"]/,
    'collect page should ping the extension before submitting collect work',
  );
  assert.match(
    source,
    /setExtFetchStatus\(/,
    'collect dialog should update visible progress/status text while waiting for the extension',
  );
  assert.match(
    source,
    /扩展未连接|扩展未响应/,
    'collect page should show an immediate actionable error when the extension bridge is unavailable',
  );
  assert.match(
    source,
    /deviceCollectReady[\s\S]{0,500}capture:write/,
    'collect page should accept a paired capture:write device without a legacy token',
  );
});

test('ERP collect bridge relays Chrome runtime errors to the page', () => {
  const source = fs.readFileSync('extensions/ss-erp/content/erp-collect-bridge.js', 'utf8');

  assert.match(
    source,
    /chrome\.runtime\.lastError/,
    'bridge should read chrome.runtime.lastError after sendMessage callbacks',
  );
  assert.match(
    source,
    /lastError\.message/,
    'bridge should return the runtime error message to the ERP page',
  );
});
test('source collection diagnostics include the installed extension version', () => {
  const source = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');

  assert.match(
    source,
    /extensionVersion/,
    'source collection payload should include the installed extension version for debugging stale parsers',
  );
  assert.match(
    source,
    /chrome\.runtime\.getManifest\(\)\.version/,
    'source collection should read the version from the Chrome extension manifest',
  );
});

test('Ozon ERP collect response includes the target ERP account and backend for troubleshooting', () => {
  const source = fs.readFileSync('extensions/ss-erp/background/collect-background.js', 'utf8');

  assert.match(
    source,
    /async function fetchErpIdentityForDiagnostics\(erpBase,\s*erpToken\)/,
    'background collection should fetch /api/user/me so success responses identify the target account',
  );
  assert.match(
    source,
    /const\s+connection\s*=\s*\{\s*baseUrl:\s*erpBase,\s*user:\s*identity,\s*authMode\s*\}/,
    'successful collection responses should build connection context from the ERP base URL and auth mode',
  );
  assert.match(
    source,
    /data:\s*\{[\s\S]*connection,/,
    'successful collection responses should return the connection context to callers',
  );
  assert.match(
    source,
    /notifyErpCollectCompleted\(collected\.length,\s*allErrors\.length,\s*\{[\s\S]*connection:/,
    'collect-completed broadcasts should include the same connection context shown in the popup/page',
  );
  assert.match(
    source,
    /SS_ERP_EXTENSION_DEVICE_COLLECT[\s\S]{0,900}deviceCollect\.submit\(batchPayload\)/,
    'paired Ozon collection should write through the scoped device transport',
  );
  assert.match(
    source,
    /deviceStatus\.state !== "unpaired"[\s\S]{0,260}设备采集授权不可用/,
    'paired device failures must not silently fall back to an account token',
  );
});

test('extension collection surfaces the target account instead of only saying sent to ERP', () => {
  const popup = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');
  const panel = fs.readFileSync('extensions/ss-erp/content/ozon-panel.js', 'utf8');

  for (const [name, source] of [['popup', popup], ['product panel', panel]]) {
    assert.match(
      source,
      /formatErpCollectTargetLabel/,
      `${name} should format the ERP account/backend returned by collection`,
    );
    assert.match(
      source,
      /connectionLabel|targetLabel/,
      `${name} should append the target account/backend to the collect success message`,
    );
  }
});

test('ERP topbar shows a stable account identifier when nicknames are duplicated locally', () => {
  const topbar = fs.readFileSync('apps/web/src/components/layout/topbar.tsx', 'utf8');

  assert.match(
    topbar,
    /user\.phone/,
    'topbar should show the phone number, not just a nickname that may be duplicated',
  );
  assert.match(
    topbar,
    /user\.id\.slice\(/,
    'topbar should include a short account id fallback when accountCode is missing',
  );
});

test('extension-owned legacy import validates the token and returns the bound ERP account', () => {
  const serviceWorker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');

  assert.match(
    serviceWorker,
    /ozon-calc:erp-endpoint-save[\s\S]*\/api\/user\/me/,
    'endpoint-save should validate the configured token against /api/user/me instead of only storing it',
  );
  assert.match(
    serviceWorker,
    /sendResponse\(\{[\s\S]*user:/,
    'endpoint-save should return the bound user identity to the extension-owned import page',
  );
});

test('ERP extension dialog provisions a scoped device pairing code', () => {
  const dialog = fs.readFileSync('apps/web/src/components/extension-token-dialog.tsx', 'utf8');

  assert.match(
    dialog,
    /\/api\/extension-device\/pairing-codes/,
    'extension dialog should create a server-scoped device pairing code',
  );
  assert.match(
    dialog,
    /shopIds:\s*selectedShopIds/,
    'pairing code should be scoped to the selected Ozon shops',
  );
  assert.match(
    dialog,
    /pairing\.deploymentId[\s\S]*pairing\.code/,
    'pairing instructions should display the deployment id and one-time code',
  );
});

test('ERP collect page shows the extension write target after popup or dialog collection', () => {
  const source = fs.readFileSync('apps/web/src/app/(dashboard)/collect/page.tsx', 'utf8');

  assert.match(
    source,
    /formatErpCollectTargetLabel/,
    'collect page should format the connection context returned by the extension',
  );
  assert.match(
    source,
    /evt\.connection/,
    'collect-completed broadcasts should display the backend/account that received the write',
  );
  assert.match(
    source,
    /res\.data\?\.connection/,
    'direct collect dialog success should display the backend/account that received the write',
  );
});

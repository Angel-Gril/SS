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

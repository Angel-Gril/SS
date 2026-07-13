import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const manifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));
const buildScript = fs.readFileSync('scripts/build-extension-package.mjs', 'utf8');
const verifyScript = fs.readFileSync('scripts/verify-extension-package.mjs', 'utf8');
const erpBridge = fs.readFileSync('extensions/ss-erp/content/erp-collect-bridge.js', 'utf8');

test('source manifest trusts both international and domestic ERP domains', () => {
  const matches = manifest.externally_connectable?.matches || [];
  assert.ok(matches.includes('https://*.ss-erp.com/*'));
  assert.ok(matches.includes('https://*.ss-erp.cn/*'));
});

test('cloud package grants API and page access to both ERP domain families', () => {
  assert.match(buildScript, /https:\/\/ss-erp\.cn\/\*/);
  assert.match(buildScript, /https:\/\/\*\.ss-erp\.cn\/\*/);
});
test('ERP page bridge accepts the domestic domain family', () => {
  assert.match(erpBridge, /hostname === 'ss-erp\.cn'/);
  assert.match(erpBridge, /hostname\.endsWith\('\.ss-erp\.cn'\)/);
});


test('package verification fails when the domestic ERP domain is absent', () => {
  assert.match(verifyScript, /externally_connectable includes ss-erp\.cn/);
  assert.match(verifyScript, /externally_connectable missing ss-erp\.cn/);
});

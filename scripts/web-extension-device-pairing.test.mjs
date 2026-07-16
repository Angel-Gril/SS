import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('apps/web/src/components/extension-token-dialog.tsx', 'utf8');

test('extension dialog creates shop-scoped one-time device pairing codes', () => {
  assert.match(source, /\/api\/extension-device\/pairing-codes/);
  assert.match(source, /\/api\/shops/);
  assert.match(source, /shopIds/);
  assert.match(source, /deploymentId/);
  assert.match(source, /一次性配对码/);
  assert.match(source, /选择 Ozon 店铺/);
  assert.match(source, /scopes: selectedScopes/);
  assert.match(source, /listing:publish/);
  assert.match(source, /useState<string\[\]>\(\[\]\)/);
});

test('pairing credentials stay in the extension-owned manual claim flow', () => {
  assert.doesNotMatch(source, /window\.postMessage/);
  assert.doesNotMatch(source, /ozon-calc:erp-endpoint-save/);
  assert.match(source, /打开扩展.*完整设置/);
  assert.match(source, /兼容 Token/);
  assert.match(source, /legacy_extension_token_disabled/);
});

test('tenant owners can inspect and revoke paired devices', () => {
  assert.match(source, /\/api\/extension-device\/sessions/);
  assert.match(source, /已配对设备/);
  assert.match(source, /撤销设备/);
  assert.match(source, /api\.delete/);
});

test('opening the dialog does not automatically mint a legacy account token', () => {
  assert.doesNotMatch(source, /onOpenChange=.*generateToken\(\)/);
});

test('device pairing rollout is independent from logistics distribution', () => {
  assert.match(source, /NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED/);
  assert.match(source, /useState<View>\(extensionDeviceAuthEnabled \? 'pairing' : 'legacy'\)/);
  assert.match(source, /if \(open && extensionDeviceAuthEnabled\) void loadPairingContext\(\)/);
});

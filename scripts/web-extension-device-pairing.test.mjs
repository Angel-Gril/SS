import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { equalStringSets } from '../apps/web/src/lib/extension-device-pairing.ts';

const source = fs.readFileSync('apps/web/src/components/extension-token-dialog.tsx', 'utf8');
const serviceWorkerSource = fs.readFileSync(
  'extensions/ss-erp/background/service-worker.js',
  'utf8',
);

test('extension dialog creates shop-scoped one-time device pairing codes', () => {
  assert.match(source, /\/api\/extension-device\/pairing-codes/);
  assert.match(source, /\/api\/shops/);
  assert.match(source, /shopIds/);
  assert.match(source, /deploymentId/);
  assert.match(source, /配对码领取成功后不可再次使用/);
  assert.match(source, /选择 Ozon 店铺/);
  assert.match(source, /scopes: selectedScopes/);
  assert.match(source, /listing:publish/);
  assert.match(source, /useState<string\[\]>\(\[\]\)/);
});

test('pairing supports a trusted one-click device claim without restoring legacy token injection', () => {
  assert.match(source, /ss-erp:extension-device-status/);
  assert.match(source, /ss-erp:extension-device-claim/);
  assert.match(source, /async function connectExtension/);
  assert.match(source, /sendToExtension/);
  assert.doesNotMatch(source, /ozon-calc:erp-endpoint-save/);
  assert.doesNotMatch(source, /payload:\s*\{\s*endpoint,\s*token/);
  assert.match(source, /手动配对/);
  assert.match(source, /兼容 Token/);
  assert.match(source, /legacy_extension_token_disabled/);
});

test('opening the pairing view automatically discovers the installed extension but does not grant scopes', () => {
  assert.match(source, /const generation = beginPairingGeneration\(\)/);
  assert.match(source, /loadPairingContext\(generation\)[\s\S]{0,160}detectExtensionConnection\(ownerUserId, generation\)/);
  assert.match(source, /type:\s*'ss-erp:extension-device-status'/);
  assert.match(source, /type:\s*'ss-erp:extension-device-status'[\s\S]{0,80}\}, 8000\)/);
  assert.match(source, /authorization_required/);
  assert.match(source, /已检测 ERP/);
  assert.match(source, /原设备授权已失效/);
  assert.doesNotMatch(source, /useEffect\([\s\S]{0,400}createPairingCode\(/);
  assert.doesNotMatch(source, /useEffect\([\s\S]{0,400}connectExtension\(/);
});

test('status detection outlives the worker deadline and cannot supersede context loading', () => {
  assert.match(serviceWorkerSource, /requestTimeoutMs:\s*6000/);
  assert.match(source, /'ss-erp:extension-device-status'[\s\S]{0,100}8000/);
  assert.match(
    source,
    /disabled=\{[\s\S]{0,140}extensionConnection === 'checking'[\s\S]{0,140}loadingContext[\s\S]{0,20}\}/,
  );
});

test('one-click pairing recovers a successful extension claim when the page response is lost', () => {
  assert.match(source, /for \(let attempt = 0; attempt < 2/);
  assert.match(source, /const recovered = await detectExtensionConnection\(ownerUserId, generation, false\)/);
  assert.match(source, /const refreshedSessions = await refreshDeviceSessions\(generation\)/);
  assert.match(source, /claimedStatusMatches/);
  assert.match(source, /cancelPairingAttempt\(nextPairing\.id\)/);
  assert.match(source, /if \(nextPairing\) \{[\s\S]{0,120}cancelPairingAttempt\(nextPairing\.id\)/);
});

test('successful one-click reauthorization replaces stale dialog status', () => {
  assert.match(
    source,
    /function showConnectedExtension\([\s\S]{0,120}generation: number\) \{[\s\S]{0,180}setExtensionDeviceStatus\(status\)/,
  );
});

test('stale async dialog work cannot overwrite a newer open, refresh, detection, or connection', () => {
  assert.match(source, /const pairingGenerationRef = useRef\(0\)/);
  assert.match(source, /function beginPairingGeneration/);
  assert.match(source, /function isCurrentPairingGeneration/);
  assert.match(source, /function handleOpenChange[\s\S]{0,120}beginPairingGeneration\(\)/);
  assert.match(source, /function refreshPairingContext[\s\S]{0,100}beginPairingGeneration\(\)/);
  assert.match(source, /function refreshExtensionDetection[\s\S]{0,100}beginPairingGeneration\(\)/);
  assert.match(source, /async function connectExtension[\s\S]{0,500}beginPairingGeneration\(\)/);
  assert.match(source, /if \(!isCurrentPairingGeneration\(generation\)\) return null/);
  assert.match(source, /if \(isCurrentPairingGeneration\(generation\)\) setConnecting\(false\)/);
});

test('one-click pairing revokes a visible manual pairing code before issuing another code', () => {
  assert.match(
    source,
    /async function connectExtension\(\) \{[\s\S]{0,900}pairing[\s\S]{0,300}revokePairingCode\(pairing\.id\)/,
  );
  assert.match(source, /无法撤销现有手动配对码/);
});

test('pairing choices stay immutable while a claim or manual-code request is in flight', () => {
  assert.match(source, /const pairingSelectionLocked = connecting \|\| pairingBusy \|\| Boolean\(pairing\)/);
  assert.match(source, /disabled=\{pairingSelectionLocked\}/);
});

test('pairing defaults stay least-privileged across multiple shops and accounts', () => {
  assert.match(source, /ozonShops\.length === 1 \? \[ozonShops\[0\]!\.id\] : \[\]/);
  assert.match(source, /!currentOwnerUserId/);
  assert.match(source, /detected\.ownerUserId && detected\.ownerUserId !== ownerUserId/);
  assert.doesNotMatch(source, /return ozonShops\.map\(\(shop\) => shop\.id\)/);
});

test('an existing device can explicitly replace a stale shop or scope grant', () => {
  assert.match(source, /function deviceGrantMismatch/);
  assert.match(source, /extensionNeedsAuthorization/);
  assert.match(source, /reauthorize: true/);
  assert.match(source, /更新授权/);
  assert.match(source, /status\.sessionId === replacedSessionId/);
  assert.match(source, /equalStringSets\(status\.scopes \|\| \[\], scopes\)/);
  assert.match(source, /equalStringSets\(session\.shopIds, shopIds\)/);
});

test('one-click success requires a fresh exact session grant and retries wrong-shop claims explicitly', () => {
  assert.match(source, /api\.get<DeviceSession\[]>\('\/api\/extension-device\/sessions'\)/);
  assert.match(source, /session\.id !== status\.sessionId \|\| session\.status !== 'ACTIVE'/);
  assert.match(source, /equalStringSets\(session\.scopes, scopes\)/);
  assert.match(source, /equalStringSets\(session\.shopIds, shopIds\)/);
  assert.match(source, /let needsAuthorization = deviceGrantMismatch/);
  assert.match(source, /needsAuthorization = true/);
  assert.match(source, /replacedSessionId = candidate\.sessionId \|\| replacedSessionId/);
  assert.match(source, /\.\.\.\(needsAuthorization \? \{ reauthorize: true \} : \{\}\)/);
  const connectStart = source.indexOf('async function connectExtension');
  const exactGrantCheck = source.indexOf('claimedStatusMatches(candidate, claimedSession', connectStart);
  const successProjection = source.indexOf('showConnectedExtension(connected, generation)', connectStart);
  assert.ok(exactGrantCheck > connectStart);
  assert.ok(successProjection > exactGrantCheck, 'success must be projected only after exact grant validation');
});

test('grant comparison detects both added and removed permissions', () => {
  assert.equal(equalStringSets(['capture:write'], ['capture:write']), true);
  assert.equal(equalStringSets(['capture:write'], ['capture:write', 'media:execute']), false);
  assert.equal(equalStringSets(['capture:write', 'media:execute'], ['capture:write']), false);
  assert.equal(equalStringSets(['shop-b', 'shop-a'], ['shop-a', 'shop-b']), true);
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
  assert.match(source, /if \(open && extensionDeviceAuthEnabled\) \{[\s\S]{0,220}loadPairingContext\(generation\)/);
});

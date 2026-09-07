import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import {
  equalStringSets,
  extensionPairingSelectionLocked,
  singleActiveOzonShopIds,
} from '../apps/web/src/lib/extension-device-pairing.ts';

const source = fs.readFileSync('apps/web/src/components/extension-token-dialog.tsx', 'utf8');
const autoConnectSource = fs.readFileSync(
  'apps/web/src/components/extension-device-auto-connect.tsx',
  'utf8',
);
const topbarSource = fs.readFileSync('apps/web/src/components/layout/topbar.tsx', 'utf8');
const erpBridgeSource = fs.readFileSync('extensions/ss-erp/content/erp-collect-bridge.js', 'utf8');
const serviceWorkerSource = fs.readFileSync(
  'extensions/ss-erp/background/service-worker.js',
  'utf8',
);

function loadAutoConnectRuntime(overrides = {}) {
  const storage = new Map();
  const dispatched = [];
  const api = overrides.api;
  const module = { exports: {} };
  const sandbox = {
    CustomEvent: class CustomEvent {
      constructor(type) { this.type = type; }
    },
    Date,
    Math,
    clearTimeout,
    console,
    exports: module.exports,
    module,
    navigator: overrides.navigator || {},
    process: { env: { NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED: 'true' } },
    require: (id) => {
      if (id === 'react') return { useEffect: () => {} };
      if (id === '@/lib/api') {
        return { api, getApiBase: () => 'https://api.ss-erp.test' };
      }
      if (id === '@/lib/extension-device-bridge') {
        return { sendToExtension: overrides.sendToExtension };
      }
      if (id === '@/lib/extension-device-pairing') {
        return { equalStringSets, singleActiveOzonShopIds };
      }
      throw new Error(`Unexpected auto-connect dependency: ${id}`);
    },
    setTimeout,
    window: {
      addEventListener: () => {},
      clearTimeout,
      dispatchEvent: (event) => dispatched.push(event.type),
      localStorage: {
        getItem: (key) => storage.get(key) || null,
        setItem: (key, value) => storage.set(key, value),
      },
      location: { origin: 'https://app.ss-erp.test' },
      postMessage: () => {},
      removeEventListener: () => {},
      setTimeout,
    },
  };
  const compiled = ts.transpileModule(autoConnectSource, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(compiled, sandbox, { filename: 'extension-device-auto-connect.cjs' });
  return { dispatched, exports: module.exports };
}

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

test('BYOK ingest is selectable but never granted by default', () => {
  const options = source.match(/const DEVICE_SCOPE_OPTIONS = \[([\s\S]*?)\] as const;/)?.[1] || '';
  const defaults = source.match(/const DEFAULT_DEVICE_SCOPES = \[([\s\S]*?)\];/)?.[1] || '';
  assert.match(options, /byok:media:ingest/);
  assert.doesNotMatch(defaults, /byok:media:ingest/);
  assert.doesNotMatch(defaults, /listing:publish/);
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

test('a verified active session hydrates its grant plus an explicit deep-link scope request without minting a new grant', () => {
  assert.match(source, /const hydratedSessionRef = useRef\(''\)/);
  assert.match(source, /status\?\.state !== 'paired'[\s\S]{0,500}hydratedSessionRef\.current === session\.id/);
  assert.match(source, /setSelectedShopIds\(session\.shopIds\.slice\(\)\)/);
  assert.match(source, /const requestedScopes = requestedScopesRef\.current/);
  assert.match(
    source,
    /setSelectedScopes\(\[[\s\S]{0,100}new Set\(\[\.\.\.session\.scopes, \.\.\.requestedScopes\]\)[\s\S]{0,40}\]\)/,
  );
  assert.match(source, /setSelectedScopes\([\s\S]{0,180}requestedScopesRef\.current = \[\]/);
  assert.doesNotMatch(
    source,
    /useEffect\(\(\) => \{[\s\S]{0,900}(?:issuePairingCode|createPairingCode|connectExtension)\(/,
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
  assert.match(source, /const pairingSelectionLocked = extensionPairingSelectionLocked\(\{/);
  for (const input of [
    'connecting',
    'pairingBusy',
    'hasPairingCode: Boolean(pairing)',
    'loadingContext',
    'extensionConnection',
    "currentSessionId: currentDeviceSession?.id || ''",
    'hydratedSessionId: hydratedSessionRef.current',
  ]) {
    assert.match(source, new RegExp(input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
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

test('pairing choices stay locked until the verified active session is hydrated', () => {
  const ready = {
    connecting: false,
    pairingBusy: false,
    hasPairingCode: false,
    loadingContext: false,
    extensionConnection: 'paired',
    currentSessionId: 'session-1',
    hydratedSessionId: 'session-1',
  };
  assert.equal(extensionPairingSelectionLocked(ready), false);
  assert.equal(extensionPairingSelectionLocked({ ...ready, loadingContext: true }), true);
  assert.equal(extensionPairingSelectionLocked({
    ...ready,
    extensionConnection: 'checking',
  }), true);
  assert.equal(extensionPairingSelectionLocked({
    ...ready,
    hydratedSessionId: '',
  }), true);
  assert.equal(extensionPairingSelectionLocked({
    ...ready,
    currentSessionId: '',
    hydratedSessionId: '',
  }), true);
  assert.equal(extensionPairingSelectionLocked({
    ...ready,
    extensionConnection: 'unpaired',
    currentSessionId: '',
    hydratedSessionId: '',
  }), false);
});

test('tenant owners can inspect and revoke paired devices', () => {
  assert.match(source, /\/api\/extension-device\/sessions/);
  assert.match(source, /已配对设备/);
  assert.match(source, /撤销设备/);
  assert.match(source, /api\.delete/);
});

test('device management keeps revoked sessions as collapsed audit history', () => {
  assert.match(source, /const \[showRevokedSessions, setShowRevokedSessions\] = useState\(false\)/);
  assert.match(source, /sessions\.filter\(\(session\) => session\.status === 'ACTIVE'\)/);
  assert.match(source, /sessions\.filter\(\(session\) => session\.status !== 'ACTIVE'\)/);
  assert.match(source, /showRevokedSessions \? '收起历史' : `\$\{revokedSessions\.length\} 条历史`/);
  assert.match(source, /session\.status === 'ACTIVE' \? \([\s\S]{0,1200}断开访问/);
});

test('opening the dialog does not automatically mint a legacy account token', () => {
  assert.doesNotMatch(source, /onOpenChange=.*generateToken\(\)/);
});

test('device pairing rollout is independent from logistics distribution', () => {
  assert.match(source, /NEXT_PUBLIC_EXTENSION_DEVICE_AUTH_ENABLED/);
  assert.match(source, /useState<View>\(extensionDeviceAuthEnabled \? 'pairing' : 'legacy'\)/);
  assert.match(source, /if \(open && extensionDeviceAuthEnabled\) \{[\s\S]{0,220}loadPairingContext\(generation\)/);
});

test('logged-in ERP pages can establish a bounded minimal device session without copying account tokens', () => {
  assert.match(topbarSource, /ExtensionDeviceAutoConnect/);
  assert.match(autoConnectSource, /ss-erp:extension-device-status/);
assert.match(autoConnectSource, /status\.state !== 'authorization_required'/);
assert.match(
  autoConnectSource,
  /status\.state === 'paired'[\s\S]{0,280}status\.ownerUserId !== ownerUserId[\s\S]{0,220}extension-device-clear/,
  'silent auto-connect must replace a device session bound to a different logged-in ERP owner',
);
  assert.match(autoConnectSource, /\/api\/extension-device\/pairing-codes/);
  assert.match(autoConnectSource, /ss-erp:extension-device-claim/);
  assert.match(autoConnectSource, /onlyIfAuthorizationRequired:\s*true/);
  assert.match(autoConnectSource, /AUTO_CONNECT_SCOPES\s*=\s*\['capture:write'\]/);
  assert.match(autoConnectSource, /singleActiveOzonShopIds\(shopResponse\.data\)/);
  assert.doesNotMatch(autoConnectSource, /NEXT_PUBLIC_LOGISTICS_DISTRIBUTION_ENABLED/);
  assert.match(autoConnectSource, /navigator\.locks/);
  assert.match(autoConnectSource, /window\.addEventListener\('focus', connect\)/);
  assert.match(autoConnectSource, /window\.addEventListener\('online', connect\)/);
  assert.match(autoConnectSource, /document\.addEventListener\('visibilitychange', onVisible\)/);
  assert.ok(
    autoConnectSource.indexOf('const shopIds = singleActiveOzonShopIds')
      < autoConnectSource.indexOf('if (recentlyAttempted()) return'),
    'a missing or ambiguous shop must not consume the retry cooldown',
  );
  assert.match(erpBridgeSource, /ss-erp:extension-bridge-ready/);
  assert.match(autoConnectSource, /bridgeEvent\?\.type === 'ss-erp:extension-bridge-ready'[\s\S]*connect\(\)/);
  assert.match(serviceWorkerSource, /function injectErpBridgeIntoOpenTabs[\s\S]*chrome\.tabs\.query\(\{ url: matches \}\)[\s\S]*content\/erp-collect-bridge\.js/);
  assert.doesNotMatch(serviceWorkerSource, /injectErpBridgeIntoOpenTabs[\s\S]{0,1200}chrome\.tabs\.reload/);
  assert.match(serviceWorkerSource, /chrome\.runtime\.onInstalled\.addListener[\s\S]{0,300}injectErpBridgeIntoOpenTabs\(\)/);
  assert.match(serviceWorkerSource, /chrome\.runtime\.onStartup\.addListener[\s\S]{0,300}injectErpBridgeIntoOpenTabs\(\)/);
  assert.equal(
    [...serviceWorkerSource.matchAll(/injectErpBridgeIntoOpenTabs\(\)\.catch\(\(\) => \{\}\)/g)].length,
    2,
    'ERP bridge injection should run only for install/update and browser startup, not every MV3 wake',
  );
  assert.match(autoConnectSource, /const pairing = pairingResponse\.data;[\s\S]*try \{[\s\S]*if \(cancelled\(\)\) return;[\s\S]*finally \{[\s\S]*cancelPairingCode\(pairing\.id\)/);
  assert.match(autoConnectSource, /claimedStatus\.ownerUserId === ownerUserId/);
  assert.match(autoConnectSource, /equalStringSets\(claimedSession\.shopIds, shopIds\)/);
  assert.match(autoConnectSource, /equalStringSets\(claimedSession\.scopes, AUTO_CONNECT_SCOPES\)/);
  assert.doesNotMatch(autoConnectSource, /ozon-calc:erp-token|sserp_token|Authorization:\s*['"]Bearer/);
  assert.doesNotMatch(autoConnectSource, /listing:write|listing:review|media:execute|byok:media:ingest|listing:publish/);
});

test('silent device bootstrap is available only for one exact active Ozon shop', () => {
  assert.deepEqual(singleActiveOzonShopIds([
    { id: 'shop-b', platform: 'OZON', status: 'ACTIVE' },
    { id: 'shop-b', platform: 'OZON', status: 'ACTIVE' },
    { id: 'disabled', platform: 'OZON', status: 'DISABLED' },
    { id: 'errored', platform: 'OZON', status: 'ERROR' },
    { id: 'unknown', platform: 'OZON' },
    { id: 'other', platform: 'WB', status: 'ACTIVE' },
  ]), ['shop-b']);
  assert.deepEqual(singleActiveOzonShopIds([]), []);
  assert.deepEqual(singleActiveOzonShopIds([
    { id: 'shop-a', platform: 'OZON', status: 'ACTIVE' },
    { id: 'shop-b', platform: 'OZON', status: 'ACTIVE' },
  ]), []);
});

test('silent auto-connect serializes concurrent bootstrap and cleans its one-time code', async () => {
  const calls = { claim: 0, delete: 0, post: 0, status: 0 };
  const api = {
    delete: async () => {
      calls.delete += 1;
      return { code: 1 };
    },
    get: async (path) => {
      if (path === '/api/shops') {
        return { code: 1, data: [{ id: 'shop-1', platform: 'OZON', status: 'ACTIVE' }] };
      }
      if (path === '/api/user/me') return { code: 1, data: { id: 'owner-1' } };
      if (path === '/api/extension-device/sessions') {
        return {
          code: 1,
          data: [{
            id: 'session-1',
            scopes: ['capture:write'],
            shopIds: ['shop-1'],
            status: 'ACTIVE',
          }],
        };
      }
      throw new Error(`Unexpected GET ${path}`);
    },
    post: async () => {
      calls.post += 1;
      return {
        code: 1,
        data: { code: 'one-time-code', deploymentId: 'deployment-1', id: 'pairing-1' },
      };
    },
  };
  let lockBusy = false;
  const navigator = {
    locks: {
      request: async (_name, _options, callback) => {
        if (lockBusy) return callback(null);
        lockBusy = true;
        try {
          return await callback({ name: 'lock' });
        } finally {
          lockBusy = false;
        }
      },
    },
  };
  const runtime = loadAutoConnectRuntime({
    api,
    navigator,
    sendToExtension: async (message) => {
      if (message.type === 'ss-erp:extension-device-claim') {
        calls.claim += 1;
        return { ok: true, data: { state: 'paired' } };
      }
      calls.status += 1;
      return calls.status === 1
        ? { ok: true, data: { state: 'authorization_required' } }
        : {
            ok: true,
            data: { ownerUserId: 'owner-1', sessionId: 'session-1', state: 'paired' },
          };
    },
  });
  const run = () => runtime.exports.runAutoConnect(() => false);
  await Promise.all([
    runtime.exports.runWithAutoConnectLock(run),
    runtime.exports.runWithAutoConnectLock(run),
  ]);

  assert.deepEqual(calls, { claim: 1, delete: 1, post: 1, status: 2 });
  assert.deepEqual(runtime.dispatched, ['ss-erp:extension-device-connected']);
});

test('silent auto-connect deletes an issued code when the page is disposed before claim', async () => {
  const calls = { claim: 0, delete: 0, post: 0 };
  let disposed = false;
  const runtime = loadAutoConnectRuntime({
    api: {
      delete: async () => {
        calls.delete += 1;
        return { code: 1 };
      },
      get: async (path) => {
        if (path === '/api/shops') {
          return { code: 1, data: [{ id: 'shop-1', platform: 'OZON', status: 'ACTIVE' }] };
        }
        if (path === '/api/user/me') return { code: 1, data: { id: 'owner-1' } };
        throw new Error(`Unexpected GET ${path}`);
      },
      post: async () => {
        calls.post += 1;
        disposed = true;
        return {
          code: 1,
          data: { code: 'one-time-code', deploymentId: 'deployment-1', id: 'pairing-1' },
        };
      },
    },
    sendToExtension: async (message) => {
      if (message.type === 'ss-erp:extension-device-claim') calls.claim += 1;
      return { ok: true, data: { state: 'authorization_required' } };
    },
  });
  await runtime.exports.runAutoConnect(() => disposed);

  assert.deepEqual(calls, { claim: 0, delete: 1, post: 1 });
});

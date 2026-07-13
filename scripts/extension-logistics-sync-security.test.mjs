import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const extensionRoot = 'extensions/ss-erp';
const manifest = JSON.parse(fs.readFileSync(`${extensionRoot}/manifest.json`, 'utf8'));
const serviceWorkerSource = fs.readFileSync(`${extensionRoot}/background/service-worker.js`, 'utf8');
const schemaSource = fs.readFileSync(`${extensionRoot}/shared/config-bridge/sync-schema.js`, 'utf8');
const erpBridgeSource = fs.readFileSync(`${extensionRoot}/content/erp-collect-bridge.js`, 'utf8');
const collectBackgroundSource = fs.readFileSync(`${extensionRoot}/background/collect-background.js`, 'utf8');
const messagePolicyPath = `${extensionRoot}/shared/message-security/runtime-message-policy.js`;
const verifyPackageSource = fs.readFileSync('scripts/verify-extension-package.mjs', 'utf8');

function loadSchema() {
  const context = { Date, JSON, Number, Object, Array, String, Boolean, Set, URL };
  context.globalThis = context;
  vm.runInNewContext(schemaSource, context, { filename: 'sync-schema.js' });
  return context.OZON_CALC_SYNC_SCHEMA;
}

function loadMessagePolicy() {
  assert.equal(
    fs.existsSync(messagePolicyPath),
    true,
    'the extension must ship a centralized runtime message policy',
  );
  const source = fs.readFileSync(messagePolicyPath, 'utf8');
  const context = { Array, Boolean, Object, Set, String, URL };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'runtime-message-policy.js' });
  return context.SS_ERP_RUNTIME_MESSAGE_POLICY;
}
function runErpBridge({ protocol = 'https:', hostname, marker = false }) {
  const listenerTypes = [];
  const documentElement = {
    getAttribute(name) {
      return marker && name === 'data-ss-erp-app' ? 'true' : null;
    },
    setAttribute() {},
  };
  class FakeMutationObserver {
    constructor(callback) {
      this.callback = callback;
    }

    observe() {}

    disconnect() {}
  }
  const window = {
    location: { protocol, hostname },
    addEventListener(type) {
      listenerTypes.push(type);
    },
  };
  const context = {
    chrome: { runtime: { onMessage: { addListener() {} } } },
    document: {
      documentElement,
      querySelector(selector) {
        return marker && selector === 'meta[name="ss-erp-app"]'
          ? { getAttribute: () => 'true' }
          : null;
      },
    },
    MutationObserver: FakeMutationObserver,
    setTimeout() {},
    window,
  };
  context.globalThis = context;
  vm.runInNewContext(erpBridgeSource, context, { filename: 'erp-collect-bridge.js' });
  return listenerTypes;
}

test('an arbitrary webpage cannot activate the ERP bridge by forging the app marker', () => {
  const erpBridgeRegistration = (manifest.content_scripts || []).find((entry) =>
    (entry.js || []).includes('content/erp-collect-bridge.js'));
  assert.ok(erpBridgeRegistration, 'ERP bridge registration is required');
  assert.equal(
    (erpBridgeRegistration.matches || []).includes('<all_urls>'),
    false,
    'ERP bridge must only be injected into explicitly trusted ERP origins',
  );
  assert.equal(
    runErpBridge({ hostname: 'evil.example', marker: true }).includes('message'),
    false,
    'an attacker-controlled marker must not install the page-to-runtime relay',
  );
  assert.equal(
    runErpBridge({ hostname: 'ss-erp.cn' }).includes('message'),
    true,
    'the production ERP origin must retain the bridge workflow',
  );
});


function runtimeSender(url, extensionId) {
  return { id: extensionId, url, tab: { url } };
}

test('runtime message policy denies sensitive actions from arbitrary webpage senders', () => {
  const policy = loadMessagePolicy();
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const evil = runtimeSender('https://evil.example/app', extensionId);
  const sensitiveTypes = [
    'ozon-calc:get-captured-har',
    'ozon-calc:erp-endpoint-save',
    'ozon-calc:sync-current-ozon-cookie',
    'ozon-calc:auto-sync-maintenance',
    'ss-erp:collect-source-to-erp',
    'spb-self-hosted:save-config',
    'spb-self-hosted:publish-ozon-workbench-rows',
  ];
  for (const type of sensitiveTypes) {
    assert.equal(
      policy.isAllowedRuntimeMessageSender(type, evil, extensionId),
      false,
      type + ' must fail closed for an arbitrary webpage',
    );
  }
  assert.equal(
    policy.isAllowedRuntimeMessageSender('unknown:future-command', evil, extensionId),
    false,
    'unknown message types must fail closed',
  );
});

test('runtime message policy preserves only each trusted surface required workflows', () => {
  const policy = loadMessagePolicy();
  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const settings = runtimeSender(
    `chrome-extension://${extensionId}/pages/settings.html`,
    extensionId,
  );
  const configImport = runtimeSender(
    `chrome-extension://${extensionId}/pages/config-import.html`,
    extensionId,
  );
  const erp = runtimeSender('https://app.ss-erp.cn/collect', extensionId);
  const seller = runtimeSender('https://seller.ozon.ru/app/products', extensionId);
  const official = runtimeSender('https://globalcalculator.ozon.ru/', extensionId);
  const source = runtimeSender('https://detail.1688.com/offer/123.html', extensionId);

  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ss-erp:logistics-device-claim', settings, extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ozon-calc:get-captured-har', settings, extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ozon-calc:erp-endpoint-save', configImport, extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ss-erp:logistics-device-claim', configImport, extensionId,
  ), false);

  assert.equal(policy.isAllowedRuntimeMessageSender('ss-erp:ping', erp, extensionId), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'spb-self-hosted:fetch-ozon-product-to-erp', erp, extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ozon-calc:auto-sync-maintenance', erp, extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ozon-calc:get-captured-har', erp, extensionId,
  ), false);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ozon-calc:erp-endpoint-save', erp, extensionId,
  ), false);

  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ozon-calc:capture-har-entry', seller, extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ozon-calc:sync-current-ozon-cookie', seller, extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ozon-calc:get-captured-har', seller, extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ozon-calc:erp-endpoint-save', seller, extensionId,
  ), false);

  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ozon-calc:capture-har-entry', official, extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ozon-calc:get-captured-har', official, extensionId,
  ), false);

  assert.equal(policy.isAllowedRuntimeMessageSender(
    'spb-self-hosted:collect-current-tab', source, extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ss-erp:collect-source-to-erp', source, extensionId,
  ), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(
    'ozon-calc:erp-endpoint-save', source, extensionId,
  ), false);
});

test('both background message listeners enforce the centralized policy before dispatch', () => {
  const policy = loadMessagePolicy();
  const policyImportIndex = serviceWorkerSource.indexOf(
    '../shared/message-security/runtime-message-policy.js',
  );
  const collectImportIndex = serviceWorkerSource.indexOf(
    "importScripts('collect-background.js')",
  );
  assert.ok(policyImportIndex >= 0, 'service worker must load the runtime message policy');
  assert.ok(
    policyImportIndex < collectImportIndex,
    'the policy must load before collect-background registers its listener',
  );

  const workerListenerIndex = serviceWorkerSource.indexOf(
    'chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {',
  );
  const workerGuardIndex = serviceWorkerSource.indexOf(
    'isAllowedRuntimeMessageSender(message.type, sender, chrome.runtime.id)',
    workerListenerIndex,
  );
  const workerFirstHandlerIndex = serviceWorkerSource.indexOf(
    "message.type === 'ss-erp:ozon-company-id-captured'",
    workerListenerIndex,
  );
  assert.ok(workerGuardIndex > workerListenerIndex, 'service worker listener must call the policy');
  assert.ok(
    workerGuardIndex < workerFirstHandlerIndex,
    'service worker sender authorization must run before message handlers',
  );

  const collectListenerIndex = collectBackgroundSource.indexOf(
    'chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {',
  );
  const collectGuardIndex = collectBackgroundSource.indexOf(
    'isAllowedRuntimeMessageSender(message.type, sender, chrome.runtime.id)',
    collectListenerIndex,
  );
  const collectDispatchIndex = collectBackgroundSource.indexOf(
    'switch (message.type)',
    collectListenerIndex,
  );
  assert.ok(collectGuardIndex > collectListenerIndex, 'collect listener must call the policy');
  assert.ok(
    collectGuardIndex < collectDispatchIndex,
    'collect sender authorization must run before self-hosted dispatch',
  );

  const explicitWorkerTypes = [
    ...serviceWorkerSource.matchAll(/message\.type === ['"]([^'"]+)['"]/g),
  ].map((match) => match[1]);
  const selfHostedTypes = [
    ...collectBackgroundSource.matchAll(/case ['"](spb-self-hosted:[^'"]+)['"]:/g),
  ].map((match) => match[1]);
  for (const type of [...new Set([
    'ozon-calc:sync-config',
    ...explicitWorkerTypes,
    ...selfHostedTypes,
  ])]) {
    assert.equal(
      policy.isKnownRuntimeMessageType(type),
      true,
      type + ' must be classified before its handler can run',
    );
  }
});

test('package verification requires the message policy and page bridges cannot relay arbitrary runtime types', () => {
  assert.match(
    verifyPackageSource,
    /requiredSecurityModules[\s\S]*shared\/message-security\/runtime-message-policy\.js/,
    'package verification must require the runtime message policy module',
  );
  const contentDir = `${extensionRoot}/content`;
  const genericRelay = /chrome\.runtime\.sendMessage\s*\(\s*(?:event\.data|data\.message|payload\.message|runtimeMessage)/;
  for (const name of fs.readdirSync(contentDir).filter((entry) => entry.endsWith('.js'))) {
    if (name === 'erp-collect-bridge.js') continue;
    const source = fs.readFileSync(`${contentDir}/${name}`, 'utf8');
    assert.doesNotMatch(
      source,
      genericRelay,
      name + ' must not turn a page message into an arbitrary runtime command',
    );
  }
  const captureBridge = fs.readFileSync(
    `${contentDir}/capture-network-bridge.js`,
    'utf8',
  );
  assert.match(captureBridge, /type:\s*'ozon-calc:capture-har-entry'/);
  assert.match(captureBridge, /type:\s*'ss-erp:ozon-company-id-captured'/);
});

function validSnapshot() {
  return {
    schemaVersion: 'ozon-calculator/config-v1',
    generatedAt: '2026-07-12T00:00:00.000Z',
    source: 'seller-har',
    userConfig: {
      selectedServiceIds: ['service-1'],
      resolutionMode: 'lowest_cost',
      updatedAt: '2026-07-12T00:00:00.000Z',
    },
    formState: {
      fxRate: 0.08,
      commissionPct: 12,
      packingFee: 1,
      customFees: [{ label: 'label', amount: 1 }],
    },
    catalogSnapshot: {
      metadata: {},
      services: [{ id: 'service-1', displayName: 'Service 1' }],
    },
    ruleSnapshot: {
      metadata: {},
      services: [{
        ruleId: 'rule-1',
        serviceId: 'service-1',
        conditions: { weightRangeG: [1, 30000], chargeMode: 'actual' },
        pricing: { type: 'linear', baseFee: 10, stepFee: 2, stepSize: 100 },
      }],
    },
  };
}

test('ordinary webpages have no calculator configuration write receiver', () => {
  const webResources = (manifest.web_accessible_resources || [])
    .flatMap((entry) => entry.resources || []);
  const contentScripts = (manifest.content_scripts || [])
    .flatMap((entry) => entry.js || []);

  assert.equal(webResources.includes('pages/sync-receiver.html'), false);
  assert.equal(webResources.includes('pages/sync-receiver.js'), false);
  assert.equal(webResources.includes('pages/config-import.html'), false);
  assert.equal(webResources.includes('pages/config-import.js'), false);
  assert.equal(contentScripts.includes('content/calculator-sync-bridge.js'), false);
});

test('only the extension-owned settings and config-import pages are trusted writers', () => {
  const schema = loadSchema();
  assert.equal(typeof schema.isTrustedManualImportSender, 'function');

  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const settingsUrl = `chrome-extension://${extensionId}/pages/settings.html`;
  const importUrl = `chrome-extension://${extensionId}/pages/config-import.html`;
  assert.equal(schema.isTrustedManualImportSender({ id: extensionId, url: settingsUrl }, extensionId), true);
  assert.equal(schema.isTrustedManualImportSender({ id: extensionId, url: importUrl, tab: { url: importUrl } }, extensionId), true);

  assert.equal(schema.isTrustedManualImportSender({ id: 'forged', url: settingsUrl }, extensionId), false);
  assert.equal(schema.isTrustedManualImportSender({ id: extensionId, url: 'https://evil.example/settings.html' }, extensionId), false);
  assert.equal(schema.isTrustedManualImportSender({ id: extensionId, url: `chrome-extension://${extensionId}/pages/popup.html` }, extensionId), false);
  assert.equal(schema.isTrustedManualImportSender({
    id: extensionId,
    url: settingsUrl,
    tab: { url: 'https://evil.example/' },
  }, extensionId), false);
});

test('settings-only calculator mutations cannot be forwarded by a webpage content script', () => {
  const schema = loadSchema();
  assert.equal(typeof schema.isTrustedSettingsSender, 'function');

  const extensionId = 'abcdefghijklmnopabcdefghijklmnop';
  const settingsUrl = `chrome-extension://${extensionId}/pages/settings.html`;
  assert.equal(schema.isTrustedSettingsSender({ id: extensionId, url: settingsUrl }, extensionId), true);
  assert.equal(schema.isTrustedSettingsSender({
    id: extensionId,
    url: 'https://evil.example/',
    tab: { url: 'https://evil.example/' },
  }, extensionId), false);
  assert.equal(schema.isTrustedSettingsSender({
    id: extensionId,
    url: `chrome-extension://${extensionId}/pages/config-import.html`,
  }, extensionId), false);

  const guardIndex = serviceWorkerSource.indexOf('OZON_CALC_SETTINGS_WRITE_CHANNELS.has(message.type)');
  const firstMutationIndex = serviceWorkerSource.indexOf("message.type === 'ozon-calculator:build-config-from-captured-seller'");
  assert.ok(guardIndex >= 0, 'background must guard settings-only calculator mutations');
  assert.ok(firstMutationIndex > guardIndex, 'settings-only guard must run before mutation handlers');

  const importGuardIndex = serviceWorkerSource.indexOf('OZON_CALC_IMPORT_PAGE_WRITE_CHANNELS.has(message.type)');
  const endpointMutationIndex = serviceWorkerSource.indexOf("message.type === 'ozon-calc:erp-endpoint-save'");
  assert.ok(importGuardIndex >= 0, 'background must guard extension connection settings');
  assert.ok(endpointMutationIndex > importGuardIndex, 'import-page guard must run before connection writes');
});

test('raw unknown schemas are rejected before normalization', () => {
  const schema = loadSchema();
  assert.equal(typeof schema.validateRawSnapshot, 'function');

  const payload = validSnapshot();
  payload.schemaVersion = 'ozon-calculator/config-v99';
  const result = schema.validateRawSnapshot(payload);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /schema/i);
});

test('malformed or dangerous snapshots are rejected without producing a replacement', () => {
  const schema = loadSchema();
  assert.equal(typeof schema.prepareManualImport, 'function');

  const empty = validSnapshot();
  empty.catalogSnapshot.services = [];
  empty.ruleSnapshot.services = [];
  assert.equal(schema.prepareManualImport(empty).valid, false);

  const negativeFee = validSnapshot();
  negativeFee.ruleSnapshot.services[0].pricing.baseFee = -0.01;
  assert.equal(schema.prepareManualImport(negativeFee).valid, false);

  const nonFinite = validSnapshot();
  nonFinite.formState.fxRate = Number.POSITIVE_INFINITY;
  assert.equal(schema.prepareManualImport(nonFinite).valid, false);

  const tooDeep = validSnapshot();
  let cursor = tooDeep.catalogSnapshot.metadata;
  for (let index = 0; index < 30; index += 1) {
    cursor.child = {};
    cursor = cursor.child;
  }
  assert.equal(schema.prepareManualImport(tooDeep).valid, false);

  const oversized = validSnapshot();
  oversized.catalogSnapshot.metadata.padding = 'x'.repeat(6 * 1024 * 1024);
  const oversizedResult = schema.prepareManualImport(oversized);
  assert.equal(oversizedResult.valid, false);
  assert.equal(oversizedResult.snapshot, null);
});

test('supported extension-owned manual imports remain available as local fallback', () => {
  const schema = loadSchema();
  const result = schema.prepareManualImport(validSnapshot());

  assert.equal(result.valid, true, result.errors && result.errors.join('; '));
  assert.ok(result.snapshot);
  assert.equal(result.snapshot.schemaVersion, schema.CURRENT_SCHEMA_VERSION);
  assert.equal(result.snapshot.source, 'local-fallback');
  assert.equal(result.snapshot.catalogSnapshot.services.length, 1);
  assert.equal(result.snapshot.ruleSnapshot.services.length, 1);
});

test('the background repeats sender and raw payload validation before storage', () => {
  const handlerIndex = serviceWorkerSource.indexOf("if (message.type === OZON_CALC_SYNC_CHANNEL)");
  assert.notEqual(handlerIndex, -1);
  const handler = serviceWorkerSource.slice(handlerIndex, handlerIndex + 2200);

  const senderCheckIndex = handler.indexOf('isTrustedManualImportSender');
  const prepareIndex = handler.indexOf('prepareManualImport');
  const writeIndex = handler.indexOf('chrome.storage.local.set');
  assert.ok(senderCheckIndex >= 0, 'background must verify the runtime sender');
  assert.ok(prepareIndex > senderCheckIndex, 'background must validate raw payload after sender verification');
  assert.ok(writeIndex > prepareIndex, 'background must only write after validation succeeds');
});

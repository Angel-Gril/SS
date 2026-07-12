import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const extensionRoot = 'extensions/ss-erp';
const manifest = JSON.parse(fs.readFileSync(`${extensionRoot}/manifest.json`, 'utf8'));
const serviceWorkerSource = fs.readFileSync(`${extensionRoot}/background/service-worker.js`, 'utf8');
const schemaSource = fs.readFileSync(`${extensionRoot}/shared/config-bridge/sync-schema.js`, 'utf8');

function loadSchema() {
  const context = { Date, JSON, Number, Object, Array, String, Boolean, Set, URL };
  context.globalThis = context;
  vm.runInNewContext(schemaSource, context, { filename: 'sync-schema.js' });
  return context.OZON_CALC_SYNC_SCHEMA;
}

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

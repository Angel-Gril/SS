import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');

test('service worker loads logistics distribution modules before runtime initialization', () => {
  const schema = source.indexOf("importScripts('../shared/logistics-rules/distribution-schema.js')");
  const credentials = source.indexOf("importScripts('../shared/logistics-rules/device-credential-manager.js')");
  const store = source.indexOf("importScripts('../shared/logistics-rules/distribution-store.js')");
  const client = source.indexOf("importScripts('../shared/logistics-rules/distribution-client.js')");
  const runtime = source.indexOf("importScripts('../shared/logistics-rules/distribution-runtime.js')");
  const initializer = source.indexOf('function getLogisticsDistributionRuntime()');

  assert.ok(schema >= 0);
  assert.ok(credentials > schema);
  assert.ok(store > credentials);
  assert.ok(client > store);
  assert.ok(runtime > client);
  assert.ok(initializer > runtime);
});

test('pairing and sync messages use the extension-owned sender guard before runtime dispatch', () => {
  for (const type of [
    'ss-erp:logistics-device-claim',
    'ss-erp:logistics-device-clear',
    'ss-erp:logistics-device-status',
    'ss-erp:logistics-rules-sync',
  ]) {
    assert.ok(source.includes("'" + type + "'"), type + ' must be registered');
  }
  const guard = source.indexOf('OZON_CALC_SETTINGS_WRITE_CHANNELS.has(message.type)');
  const dispatch = source.indexOf('getLogisticsDistributionMessageHandler()', guard);
  assert.ok(guard >= 0);
  assert.ok(dispatch > guard, 'runtime dispatch must happen after sender validation');
  assert.ok(source.includes('validateDeliveryEnvelope'), 'bundle application must fail closed through the shared validator');
});

test('service worker schedules scoped logistics refresh on install, startup, and alarm', () => {
  assert.ok(source.includes('SS_ERP_LOGISTICS_RULE_SYNC_ALARM_NAME'));
  assert.ok(source.includes('ensureLogisticsRuleSyncAlarm()'));
  assert.ok(source.includes('chrome.runtime.onStartup.addListener'));
  assert.ok(source.includes("reason: 'startup'"));
  assert.ok(source.includes("reason: 'alarm'"));
  assert.ok(source.includes('syncStored'));
});

test('settings writes keep manual imports unscoped unless an ERP release owns the active scope', () => {
  assert.ok(source.includes('OZON_LOGISTICS_CALCULATOR_STATE_KEY'));
  assert.match(source, /OZON_CALC_SYNC_CHANNEL[\s\S]*updatePreferences/);
  assert.doesNotMatch(source, /await runtime\.saveLocalFallback\(\{ snapshot \}\)/);
  assert.match(source, /mode: 'legacy_unscoped'/);
  assert.match(
    source,
    /ozon-calculator:update-fee-settings[\s\S]*updatePreferences/,
  );
  assert.match(
    source,
    /ozon-calculator:status[\s\S]*OZON_LOGISTICS_CALCULATOR_STATE_KEY/,
  );
});

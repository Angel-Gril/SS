import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const source = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const persistenceSource = fs.readFileSync(
  'extensions/ss-erp/shared/logistics-rules/manual-fallback-persistence.js',
  'utf8',
);

test('service worker loads logistics distribution modules before runtime initialization', () => {
  const schema = source.indexOf("importScripts('../shared/logistics-rules/distribution-schema.js')");
  const credentials = source.indexOf("importScripts('../shared/logistics-rules/device-credential-manager.js')");
  const versionPolicy = source.indexOf("importScripts('../shared/logistics-rules/version-policy.js')");
  const store = source.indexOf("importScripts('../shared/logistics-rules/distribution-store.js')");
  const client = source.indexOf("importScripts('../shared/logistics-rules/distribution-client.js')");
  const runtime = source.indexOf("importScripts('../shared/logistics-rules/distribution-runtime.js')");
  const initializer = source.indexOf('function getLogisticsDistributionRuntime()');

  assert.ok(schema >= 0);
  assert.ok(credentials > schema);
  assert.ok(versionPolicy >= 0 && versionPolicy < store);
  assert.ok(store > credentials);
  assert.ok(client > store);
  assert.ok(runtime > client);
  assert.ok(initializer > runtime);
  assert.match(
    source,
    /currentExtensionVersion:\s*chrome\.runtime\.getManifest\(\)\.version/,
  );
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

test('settings writes use scoped persistence and reserve global storage for the disabled gate', () => {
  assert.ok(source.includes('OZON_LOGISTICS_CALCULATOR_STATE_KEY'));
  assert.match(source, /manual-fallback-persistence\.js/);
  assert.equal((source.match(/persistManualCalculatorData\(\{/g) || []).length, 4);
  assert.match(persistenceSource, /if \(!isFeatureEnabled\(\)\)/);
  assert.match(persistenceSource, /mode: 'legacy_unscoped'/);
  assert.match(persistenceSource, /state: 'scope_required'/);
  assert.match(
    source,
    /ozon-calculator:update-fee-settings[\s\S]*updatePreferences/,
  );
  assert.match(
    source,
    /ozon-calculator:status[\s\S]*OZON_LOGISTICS_CALCULATOR_STATE_KEY/,
  );
});

test('disabled distribution ignores residual scoped state for status and fee settings', () => {
  const statusStart = source.indexOf("if (message.type === 'ozon-calculator:status')");
  const statusEnd = source.indexOf('\n  if (message.type === ', statusStart + 1);
  const statusHandler = source.slice(statusStart, statusEnd);
  assert.ok(statusStart >= 0 && statusEnd > statusStart);
  assert.match(
    statusHandler,
    /logisticsState\s*=\s*isLogisticsDistributionFeatureEnabled\(\)/,
  );

  const feeStart = source.indexOf("if (message.type === 'ozon-calculator:update-fee-settings')");
  const feeEnd = source.indexOf('\n  if (message.type === ', feeStart + 1);
  const feeHandler = source.slice(feeStart, feeEnd);
  assert.ok(feeStart >= 0 && feeEnd > feeStart);
  assert.match(
    feeHandler,
    /calculatorState\s*=\s*isLogisticsDistributionFeatureEnabled\(\)/,
  );
});

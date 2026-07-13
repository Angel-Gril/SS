import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const worker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const settingsHtml = fs.readFileSync('extensions/ss-erp/pages/settings.html', 'utf8');
const settingsJs = fs.readFileSync('extensions/ss-erp/pages/settings.js', 'utf8');

test('service worker imports and schedules the authenticated logistics capture loop', () => {
  assert.match(worker, /capture-task-adapter\.js/);
  assert.match(worker, /capture-task-runtime\.js/);
  assert.match(worker, /getLogisticsDeviceCredentials/);
  assert.match(worker, /captureOzonSellerProviderInventory/);
  assert.match(worker, /allowProviderCollection/);
  assert.match(worker, /provider-inventory-capture\.js/);
  assert.match(worker, /SS_ERP_LOGISTICS_CAPTURE_ALARM_NAME/);
  assert.match(worker, /runScheduledLogisticsCapture/);
  assert.match(worker, /ss-erp:logistics-capture-refresh/);
  assert.match(worker, /ss-erp:logistics-capture-cancel/);
});

test('settings exposes capture status, refresh, retry, and cancel actions', () => {
  assert.match(settingsHtml, /id="logisticsCaptureStatus"/);
  assert.match(settingsHtml, /id="refreshLogisticsCaptureBtn"/);
  assert.match(settingsHtml, /id="retryLogisticsCaptureBtn"/);
  assert.match(settingsHtml, /id="cancelLogisticsCaptureBtn"/);
  assert.match(settingsJs, /ss-erp:logistics-capture-status/);
  assert.match(settingsJs, /ss-erp:logistics-capture-refresh/);
  assert.match(settingsJs, /ss-erp:logistics-capture-retry/);
  assert.match(settingsJs, /ss-erp:logistics-capture-cancel/);
  assert.match(settingsJs, /function cancelLogisticsCapture\(\) \{[\s\S]{0,900}\.finally\(/);
});

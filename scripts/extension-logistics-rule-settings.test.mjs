import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const html = fs.readFileSync('extensions/ss-erp/pages/settings.html', 'utf8');
const source = fs.readFileSync('extensions/ss-erp/pages/settings.js', 'utf8');
const workerSource = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');

test('settings exposes device pairing, scoped assignment selection, sync, and revoke controls', () => {
  for (const id of [
    'logisticsDeploymentInput',
    'logisticsPairingCodeInput',
    'logisticsDeviceLabelInput',
    'pairLogisticsDeviceBtn',
    'logisticsAssignmentSelect',
    'syncPublishedLogisticsBtn',
    'revokeLogisticsDeviceBtn',
    'logisticsDistributionStatus',
  ]) {
    assert.ok(html.includes('id="' + id + '"'), id + ' is required');
    assert.ok(source.includes("getElementById('" + id + "')"), id + ' must be wired');
  }
  assert.match(html, /id="logisticsPairingCodeInput"[^>]+type="password"/);
});

test('settings delegates secrets to the background runtime and never stores device tokens', () => {
  for (const type of [
    'ss-erp:logistics-device-claim',
    'ss-erp:logistics-device-status',
    'ss-erp:logistics-rules-sync',
    'ss-erp:logistics-device-clear',
  ]) {
    assert.ok(source.includes("type: '" + type + "'"), type + ' must be sent');
  }
  assert.equal(source.includes('ss-erp:extension-device:credential:v1'), false);
  assert.equal(source.includes('refreshToken'), false);
  assert.equal(source.includes('accessToken'), false);
});

test('settings runtime messages settle after a bounded timeout when Chrome drops the callback', async () => {
  const start = source.indexOf('function sendMessage(message)');
  const end = source.indexOf('\n  function formatRuntimeError', start);
  assert.ok(start >= 0 && end > start, 'sendMessage helper must be extractable');
  let scheduled = null;
  let callback = null;
  const context = {
    Promise,
    String,
    SS_ERP_MESSAGE_TIMEOUT_MS: 60000,
    chrome: {
      runtime: {
        lastError: null,
        sendMessage(_message, next) { callback = next; },
      },
    },
    clearTimeout() {},
    setTimeout(fn, delay) {
      scheduled = { fn, delay };
      return 1;
    },
    formatRuntimeError(message) { return String(message || ''); },
  };
  vm.runInNewContext(source.slice(start, end) + '\nthis.sendMessage = sendMessage;', context);

  const pending = context.sendMessage({ type: 'ss-erp:logistics-rules-sync' });
  assert.equal(typeof callback, 'function');
  assert.ok(scheduled, 'a lost Chrome callback must have a timeout fallback');
  assert.equal(scheduled.delay, 60000);
  scheduled.fn();

  assert.deepEqual(JSON.parse(JSON.stringify(await pending)), {
    ok: false,
    errorCode: 'runtime_timeout',
    error: '扩展后台响应超时，操作可能仍在后台执行，请刷新状态后重试。',

  });
});

test('manual imports become scoped fallbacks when distribution is active', () => {
  const start = workerSource.indexOf("if (message.type === OZON_CALC_SYNC_CHANNEL)");
  const end = workerSource.indexOf("if (message.type === 'ozon-calc:erp-enqueue')", start);
  assert.ok(start >= 0 && end > start, 'manual import handler must be extractable');
  const handler = workerSource.slice(start, end);
  assert.match(handler, /isLogisticsDistributionFeatureEnabled\(\)/);
  assert.match(
    handler,
    /saveLocalFallback\(\{\s*scopeBinding:\s*calculatorState\.scope,\s*snapshot:\s*snapshot,?\s*\}\)/,
  );
  assert.match(handler, /mode:\s*'scoped_fallback'/);
});

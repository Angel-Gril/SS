import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const popup = readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');
const opener = popup.slice(popup.indexOf('  function openPrecisionWorkbench('), popup.indexOf('  function quoteSourcePage('));
function harness({ url = 'https://detail.1688.com/offer/845581683597.html', currentUrl = url, response = { ok: true, state: 'WORKBENCH_OPENED' } } = {}) {
  const tab = { id: 7, url }, requests = [], statuses = [];
  const context = { URL, Number, String, Promise, Error, primaryActionRevision: 1,
    primaryActionState: { tab }, primaryActionBtn: { disabled: false },
    setPrimaryButtonBusy() {}, restorePrimaryButton() {},
    setActionStatus(text, kind) { statuses.push({ text, kind }); },
    chrome: { runtime: { lastError: null }, tabs: {
      get(id, callback) { assert.equal(id, 7); callback({ id, url: currentUrl }); },
      sendMessage(id, message, options, callback) { requests.push({ id, message, options }); callback(response); },
      create() { throw Error('Unexpected new tab'); },
    } },
  };
  assert.ok(opener.includes('function openPrecisionWorkbench'), 'popup needs a same-page precision entry');
  vm.runInNewContext(opener + '\nopenPrecisionWorkbench();', context);
  return { requests, statuses };
}

test('popup opens the current source-page workbench without collection, drafts, or a new tab', () => {
  const { requests, statuses } = harness();
  assert.deepEqual(JSON.parse(JSON.stringify(requests)), [{ id: 7, message: { type: 'ss-erp:precision-workbench-open' }, options: { frameId: 0 } }]);
  assert.match(statuses.at(-1).text, /当前商品页/);
  assert.equal(statuses.at(-1).kind, 'ok');
});

test('popup does not open a workbench on a source tab that changed after selection', () => {
  const { requests, statuses } = harness({ currentUrl: 'https://detail.1688.com/offer/1048072018093.html' });
  assert.equal(requests.length, 0);
  assert.equal(statuses.at(-1).kind, 'fail');
});

test('a missing or failed source listener reports failure without opening ERP', () => {
  for (const response of [undefined, { ok: false }, { ok: true, state: 'OTHER_STATE' }]) {
    const { requests, statuses } = harness({ response: response || { ok: false, error: '工作台未加载' } });
    assert.equal(requests.length, 1);
    assert.equal(statuses.at(-1).kind, 'fail');
  }
});

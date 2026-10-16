import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const content = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');
const captureType = 'spb-self-hosted:fetch-ozon-product-to-erp';
const productUrl = (id) => `https://www.ozon.ru/product/test-product-${id}/?at=source-context`;
const success = { ok: true, data: { collected: 1, pushed: { code: 1, data: { saved: 1, errors: [] } }, errors: [] } };
const flush = () => new Promise((resolve) => setImmediate(resolve));

class Element extends EventTarget {
  constructor(tagName = 'div') {
    super();
    this.tagName = tagName;
    this.children = [];
    this.style = {};
    this.dataset = {};
    this.textContent = '';
    this.disabled = false;
  }
  set innerHTML(value) {
    this.markup = value;
    this.children = [];
    for (const match of value.matchAll(/<(button|div)\b[^>]*data-role="([^"]+)"[^>]*>([^<]*)/g)) {
      const child = new Element(match[1]);
      child.dataset.role = match[2];
      child.textContent = match[3];
      this.appendChild(child);
    }
  }
  get innerHTML() { return this.markup || ''; }
  appendChild(child) { child.parent = this; this.children.push(child); return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); }
  querySelector(selector) {
    const role = selector.match(/data-role=['"]([^'"]+)['"]/);
    return role ? this.children.find((child) => child.dataset.role === role[1]) || null : null;
  }
  setAttribute(name, value) { this[name] = String(value); }
  click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
}

function harness() {
  const body = new Element('body');
  const head = new Element('head');
  const requests = [];
  const callbacks = [];
  const timers = [];
  const location = { hostname: 'www.ozon.ru', href: 'https://www.ozon.ru/category/test/' };
  const find = (node, id) => node.id === id ? node : node.children.map((child) => find(child, id)).find(Boolean);
  const runtime = {
    getURL: (path) => `chrome-extension://test-extension/${path}`,
    onMessage: { addListener() {} },
    sendMessage(message, callback) { requests.push(message); callbacks.push(callback); },
  };
  const context = {
    console, URL, Event, location,
    document: { body, head, createElement: (tag) => new Element(tag), getElementById: (id) => find(body, id) || find(head, id) || null },
    chrome: { runtime },
    setInterval: (fn) => { timers.push(fn); return timers.length; },
  };
  context.window = context;
  context.globalThis = context;
  vm.runInNewContext(content.replace(/\n\}\)\(\);\s*$/, '\n globalThis.__detail = { renderOzonQuickActions };\n})();'), context, { filename: 'collect-content-script.js' });
  return {
    requests, callbacks, runtime,
    render(id) { location.href = productUrl(id); context.__detail.renderOzonQuickActions(id); return find(body, 'ss-erp-ozon-quick-actions'); },
  };
}

function collectButton(panel) {
  const button = panel.querySelector("[data-role='quick-collect']");
  assert.ok(button, 'detail dock must expose the independent collect/follow preparation entry');
  assert.match(button.textContent, /采集|跟卖/);
  return button;
}
const status = (panel) => panel.querySelector("[data-role='quick-status']").textContent;

test('detail capture uses the already authorized Ozon sender policy without a new permission surface', () => {
  const sandbox = { URL };
  vm.runInNewContext(fs.readFileSync('extensions/ss-erp/shared/message-security/runtime-message-policy.js', 'utf8'), sandbox);
  const policy = sandbox.SS_ERP_RUNTIME_MESSAGE_POLICY;
  const sender = (url) => ({ id: 'test-extension', url, tab: { id: 1, url }, frameId: 0, origin: new URL(url).origin });
  for (const host of ['www.ozon.ru', 'www.ozon.kz', 'www.ozon.by']) {
    assert.equal(policy.isAllowedRuntimeMessageSender(captureType, sender(`https://${host}/product/test-123456789/`), 'test-extension'), true);
  }
  assert.equal(policy.isAllowedRuntimeMessageSender(captureType, sender('https://example.com/product/test-123456789/'), 'test-extension'), false);
  assert.equal(policy.isAllowedRuntimeMessageSender(captureType, sender('https://detail.1688.com/offer/123456789.html'), 'test-extension'), false);
});

test('ordinary startup/render are read-only; one click invokes only complete collection with the current URL', async () => {
  const run = harness();
  const panel = run.render('123456789');
  const button = collectButton(panel);
  assert.equal(run.requests.length, 0);
  button.click();
  assert.equal(run.requests.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(run.requests[0])), {
    type: captureType, productIds: ['123456789'], productUrls: [productUrl('123456789')], collectMode: 'complete',
  });
  assert.equal(button.disabled, true);
  // A synthetic second event must not bypass the pending guard either.
  button.dispatchEvent(new Event('click'));
  assert.equal(run.requests.length, 1);
  run.callbacks[0](success);
  await flush();
  assert.match(status(panel), /已采集.*1/);
  assert.match(status(panel), /未上架/);
  assert.equal(button.disabled, false);
});

test('confirmed collection failures restore the click action and preserve the server explanation', async () => {
  const run = harness();
  const panel = run.render('123456789');
  const button = collectButton(panel);
  button.click();
  run.callbacks[0]({ ok: false, error: '设备采集授权不可用' });
  await flush();
  assert.equal(button.disabled, false);
  assert.match(status(panel), /设备采集授权不可用/);
  assert.doesNotMatch(status(panel), /已采集/);
  button.click();
  assert.equal(run.requests.length, 2, 'only a new explicit click may retry a known failure');
});

test('fetched data is not claimed as saved when the backend reports no saved product and errors', async () => {
  const run = harness();
  const panel = run.render('123456789');
  const button = collectButton(panel);
  button.click();
  run.callbacks[0]({ ok: true, data: { collected: 1, pushed: { code: 1, msg: '已采集 0 件', data: { saved: 0, errors: [{ error: '来源数据不完整' }] } }, errors: [{ error: '来源数据不完整' }] } });
  await flush();
  assert.doesNotMatch(status(panel), /已采集/);
  assert.match(status(panel), /来源数据不完整/);
  assert.equal(button.disabled, false);
});

test('missing or malformed save receipts remain unknown and cannot automatically resubmit', async () => {
  for (const receipt of [undefined, { ok: true }, { ok: false, errorCode: 'device_collect_outcome_unknown', error: '核对结果' },
    { ok: false, outcome: 'UNKNOWN_OUTCOME', automaticRetryAllowed: false },
    { ok: true, data: { collected: 1 } }, { ok: true, data: { collected: 1, pushed: { code: 1, data: { saved: 0, errors: [] } }, errors: [] } }]) {
    const run = harness();
    const panel = run.render('123456789');
    const button = collectButton(panel);
    button.click();
    run.callbacks[0](receipt);
    await flush();
    assert.match(status(panel), /结果.*核对/);
    assert.doesNotMatch(status(panel), /已采集/);
    button.dispatchEvent(new Event('click'));
    assert.equal(run.requests.length, 1);
    assert.equal(button.disabled, true);
  }
});

test('transport loss after dispatch does not silently retry or claim successful collection', async () => {
  const run = harness();
  const panel = run.render('123456789');
  const button = collectButton(panel);
  button.click();
  run.runtime.lastError = { message: 'The message port closed before a response was received.' };
  run.callbacks[0]();
  delete run.runtime.lastError;
  await flush();
  assert.match(status(panel), /结果.*核对/);
  assert.equal(button.disabled, true);
  assert.equal(run.requests.length, 1);
});

test('partial save warnings stay visible and backend rejection never becomes a success', async () => {
  for (const [receipt, expected] of [
    [{ ok: true, data: { collected: 1, pushed: { code: 1, data: { saved: 1, errors: [{ error: '部分变体属性缺失' }] } }, errors: [] } }, /已采集 1 件，未上架；部分数据失败：部分变体属性缺失/],
    [{ ok: true, data: { collected: 1, pushed: { code: 0, msg: '设备权限不足', data: { saved: 0 } }, errors: [] } }, /采集失败：设备权限不足/],
  ]) {
    const run = harness();
    const panel = run.render('123456789');
    collectButton(panel).click();
    run.callbacks[0](receipt);
    await flush();
    assert.match(status(panel), expected);
    assert.equal(collectButton(panel).disabled, false);
    assert.equal(run.requests.length, 1);
  }
});

test('same-product rerender does not duplicate controls and stale detached clicks cannot collect another product', () => {
  const run = harness();
  const oldPanel = run.render('123456789');
  const same = run.render('123456789');
  assert.equal(same, oldPanel);
  const current = run.render('987654321');
  collectButton(oldPanel).dispatchEvent(new Event('click'));
  assert.equal(run.requests.length, 0);
  assert.equal(collectButton(current).disabled, false);
});

test('SPA product changes replace stale controls and keep duplicate guards independent per product', async () => {
  const run = harness();
  const panelA = run.render('123456789');
  collectButton(panelA).click();
  const panelB = run.render('987654321');
  assert.notEqual(panelB, panelA, 'a different product must not inherit the old toolbar closure');
  collectButton(panelB).click();
  assert.equal(run.requests.length, 2);
  assert.equal(run.requests[1].productIds[0], '987654321');
  assert.equal(run.requests[1].productUrls[0], productUrl('987654321'));
  const againA = run.render('123456789');
  const pendingA = collectButton(againA);
  assert.equal(pendingA.disabled, true);
  pendingA.dispatchEvent(new Event('click'));
  assert.equal(run.requests.length, 2);
  run.callbacks[0](success);
  await flush();
  assert.match(status(againA), /已采集.*1/);
  assert.equal(pendingA.disabled, false);
  assert.doesNotMatch(status(panelB), /已采集/);
  run.callbacks[1](success);
  await flush();
  assert.equal(run.requests.length, 2);
});

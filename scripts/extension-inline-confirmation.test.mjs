import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
const { createInlineConfirmation } = await import('data:text/javascript;base64,' + Buffer.from(readFileSync('extensions/ss-erp/pages/donor/inline-confirmation.js', 'utf8')).toString('base64'));

class Node {
  constructor(tag = 'div') { this.tagName = tag; this.children = []; this.listeners = new Map(); this.dataset = {}; this.hidden = false; this.disabled = false; this.textContent = ''; }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  setAttribute(name, value) { this[name] = value; }
  click(isTrusted = true) { return this.listeners.get('click')?.({ isTrusted }); }
  scrollIntoView() {}
}

test('inline confirmation requires a trusted accept and resolves once', async () => {
  const root = new Node();
  const confirmation = createInlineConfirmation({ container: root, make: tag => new Node(tag) });
  const pending = confirmation.request({ message: '生成两张图片', detail: '最高费用 CNY 0.20', token: 'v1', getToken: () => 'v1' });
  assert.equal(confirmation.panel.hidden, false);
  confirmation.panel.children[3].children[1].click(false);
  assert.equal(confirmation.isPending(), true);
  confirmation.panel.children[3].children[1].click(true);
  assert.equal(await pending, true);
  assert.equal(confirmation.panel.hidden, true);
});

test('inline confirmation cancels on stale token and never calls hidden native confirmation', async () => {
  const root = new Node();
  const confirmation = createInlineConfirmation({ container: root, make: tag => new Node(tag) });
  let token = 'draft-r1';
  const pending = confirmation.request({ message: '保存草稿', token, getToken: () => token });
  token = 'draft-r2';
  confirmation.sync(token);
  assert.equal(await pending, false);
  assert.equal(confirmation.panel.hidden, false);
  assert.equal(confirmation.panel.children[3].children[1].disabled, true);
});

test('a second request while one is pending fails closed', async () => {
  const root = new Node();
  const confirmation = createInlineConfirmation({ container: root, make: tag => new Node(tag) });
  const first = confirmation.request({ message: 'first' });
  assert.equal(await confirmation.request({ message: 'second' }), false);
  confirmation.panel.children[3].children[0].click(true);
  assert.equal(await first, false);
});

test('a throwing authority read fails closed and resolves rather than leaving a live confirmation', async () => {
  const confirmation = createInlineConfirmation({ container: new Node(), make: tag => new Node(tag) });
  const pending = confirmation.request({ message: 'paid', token: 'r1', getToken: () => { throw Error('draft removed'); } });
  assert.doesNotThrow(() => confirmation.panel.children[3].children[1].click());
  assert.equal(await pending, false);
});

test('closing the current operation area cancels pending approval', async () => {
  const root = new Node();
  const confirmation = createInlineConfirmation({ container: root, make: tag => new Node(tag) });
  const pending = confirmation.request({ message: 'paid' });
  root.hidden = true;
  confirmation.check();
  assert.equal(await pending, false);
});

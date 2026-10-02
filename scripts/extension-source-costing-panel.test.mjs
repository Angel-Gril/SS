import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const root = 'extensions/ss-erp';
const panelSource = fs.readFileSync(`${root}/content/source-costing-panel.js`, 'utf8');

class Element {
  constructor(tagName, document) {
    this.tagName = tagName.toUpperCase();
    this.document = document;
    this.attributes = new Map();
    this.listeners = new Map();
    this.nodes = new Map();
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    };
    this.style = { removeProperty(name) { delete this[name]; } };
  }

  set innerHTML(value) {
    this.html = value;
    this.nodes.clear();
    for (const match of value.matchAll(/<(button|section|strong|div|input|span)\b[^>]*\b(data-action|data-role|data-field)="([^"]+)"[^>]*>/gu)) {
      const node = new Element(match[1], this.document);
      node.setAttribute(match[2], match[3]);
      for (const attribute of match[0].matchAll(/([\w-]+)="([^"]*)"/gu)) {
        node.setAttribute(attribute[1], attribute[2]);
      }
      node.type = node.getAttribute('type') || '';
      node.value = node.getAttribute('value') || '';
      node.checked = /\schecked(?:\s|>)/u.test(match[0]);
      this.nodes.set(`[${match[2]}="${match[3]}"]`, node);
    }
  }

  get innerHTML() { return this.html || ''; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  querySelector(selector) { return this.nodes.get(selector) || null; }
  querySelectorAll(selector) {
    return selector === 'input[data-field]'
      ? [...this.nodes.values()].filter((node) => node.tagName === 'INPUT') : [];
  }
  contains(node) { return [...this.nodes.values()].includes(node); }
  focus() { this.document.activeElement = this; }
  click() { this.listeners.get('click')?.({ target: this }); }
  getBoundingClientRect() { return { left: 16, top: 64, width: 460, height: 520 }; }
}

function loadPanel() {
  const nodes = new Map();
  const document = {
    title: 'Fixture source',
    activeElement: null,
    createElement(tagName) { return new Element(tagName, document); },
    getElementById(id) { return nodes.get(id) || null; },
    querySelector(selector) {
      const match = selector.match(/^#([^ ]+) (.+)$/u);
      return match ? nodes.get(match[1])?.querySelector(match[2]) || null : null;
    },
    addEventListener() {},
  };
  document.documentElement = new Element('html', document);
  document.documentElement.appendChild = (node) => nodes.set(node.id, node);
  const messages = [];
  const timers = new Map();
  const location = { href: 'https://detail.1688.com/offer/123.html', hostname: 'detail.1688.com' };
  const source = {
    productId: '123', title: 'Fixture source', priceCny: 35, shippingCny: 5,
    totalCostCny: 40, selectedSku: { skuId: 'red', specText: '红色' },
  };
  const window = {
    innerWidth: 1440, innerHeight: 960,
    addEventListener() {},
    setTimeout(callback) { callback(); },
    setInterval(callback) { const timer = {}; timers.set(timer, callback); return timer; },
    clearInterval(timer) { timers.delete(timer); },
  };
  const context = vm.createContext({
    window, document, location, URL, console,
    chrome: {
      runtime: {
        sendMessage(message, callback) {
          messages.push(message);
          if (message.type === 'ss-erp:source-candidate-context-get') {
            callback({ ok: true, context: { ozon: {
              productId: 'ozon-fixture', title: 'Fixture listing', weightG: 500,
              pagePriceValue: 120, pagePriceCurrency: 'CNY',
            } } });
          } else if (message.type === 'ozon-calculator:status') {
            callback({ ok: true, snapshot: {
              userConfig: { selectedServiceIds: ['fixture'], resolutionMode: 'lowest_cost' },
              formState: { commissionPct: 10, packingFee: 2, autoCommissionSync: false },
              catalogSnapshot: { services: [{ id: 'fixture', displayName: 'Fixture logistics' }] },
              ruleSnapshot: window.OZON_CALC_RULE_ENGINE.normalizeRulePayload({ services: [{
                serviceId: 'fixture', ruleId: 'fixture-rule', displayName: 'Fixture logistics',
                conditions: { weightRangeG: [1, 30000] },
                pricing: { type: 'per_kg', pricePerKg: 20 },
              }] }),
            } });
          } else if (message.type === 'spb-self-hosted:collect-current-tab') {
            callback({ ok: true, data: structuredClone(source) });
          } else {
            throw new Error(`Unexpected calculator message: ${message.type}`);
          }
        },
      },
      storage: { local: { get(_keys, callback) { callback({}); }, set() {} } },
    },
  });
  for (const path of [
    'shared/calculator-core/profit-engine.js', 'shared/calculator-core/rule-engine.js',
    'shared/source-costing/panel-core.js',
  ]) {
    vm.runInContext(fs.readFileSync(`${root}/${path}`, 'utf8'), context, { filename: path });
  }
  vm.runInContext(panelSource, context, { filename: 'source-costing-panel.js' });
  return { document, messages, nodes, source, timers };
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

test('calculator boots without media owners and reads only when opened', async () => {
  const harness = loadPanel();
  const panel = harness.nodes.get('ss-erp-source-costing-panel');
  const fab = harness.nodes.get('ss-erp-source-costing-fab');
  assert.ok(panel, 'costing must stay available without any AI workbench dependency');
  assert.ok(fab);
  assert.equal(harness.nodes.has('ss-erp-source-media-fab'), false);
  assert.equal(harness.nodes.has('ss-erp-source-workbench-backdrop'), false);
  assert.equal(harness.messages.length, 0);
  assert.equal(panel.classList.contains('open'), false);
  fab.click();
  await settle();
  assert.equal(panel.classList.contains('open'), true);
  assert.equal(fab.getAttribute('aria-expanded'), 'true');
  assert.match(panel.querySelector('[data-role="result-card"]').innerHTML, /¥ 56/u);
  assert.match(panel.querySelector('[data-role="result-card"]').innerHTML, /Fixture logistics/u);
  assert.equal(harness.timers.size, 1);
  assert.deepEqual([...new Set(harness.messages.map((message) => message.type))].sort(), [
    'ozon-calculator:status', 'spb-self-hosted:collect-current-tab', 'ss-erp:source-candidate-context-get',
  ]);
});

test('calculator refreshes SKU costs, preserves focused inputs, and stops polling when closed', async () => {
  const harness = loadPanel();
  const fab = harness.nodes.get('ss-erp-source-costing-fab');
  assert.ok(fab, 'costing must stay available without media controller');
  fab.click();
  await settle();
  const panel = harness.nodes.get('ss-erp-source-costing-panel');
  const inputCard = panel.querySelector('[data-role="input-card"]');
  harness.document.activeElement = inputCard.querySelector('[data-field="cost"]');
  const messageCount = harness.messages.length;
  [...harness.timers.values()][0]();
  await settle();
  assert.equal(harness.messages.length, messageCount, 'auto refresh must not replace a focused costing input');
  harness.document.activeElement = null;
  Object.assign(harness.source, { totalCostCny: 50, selectedSku: { skuId: 'blue', specText: '蓝色' } });
  [...harness.timers.values()][0]();
  await settle();
  assert.match(panel.querySelector('[data-role="source-card"]').innerHTML, /蓝色/u);
  assert.match(panel.querySelector('[data-role="result-card"]').innerHTML, /¥ 46/u);
  panel.querySelector('[data-action="close"]').click();
  assert.equal(harness.timers.size, 0);
  assert.equal(fab.getAttribute('aria-expanded'), 'false');
  assert.equal(harness.document.activeElement, fab);
});

test('calculator surfaces contain no capture, AI, review, assignment, or publish UI', () => {
  const css = fs.readFileSync(`${root}/content/source-costing-panel.css`, 'utf8');
  const ozon = fs.readFileSync(`${root}/content/ozon-panel.js`, 'utf8');
  assert.doesNotMatch(panelSource, /source-listing-workbench|source-ai-workbench|AI_IMAGE_SUITE|media-focus|collect-erp|open-source-workflow|data-precision-action/u);
  assert.doesNotMatch(css, /source-media-fab|workbench-backdrop|media-focus|source-listing-workbench|precision-toolbar/u);
  assert.doesNotMatch(ozon, /data-action="collect-product"|fetch-ozon-product-to-erp|formatErpCollectTargetLabel/u);
  assert.match(ozon, /data-action="search-sources"/u, 'pricing source search remains available');
  assert.match(ozon, /data-action="compute"/u, 'Ozon profit calculator remains available');
});

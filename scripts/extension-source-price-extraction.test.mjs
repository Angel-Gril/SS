import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const priceCurrencyScript = fs.readFileSync('extensions/ss-erp/shared/currency/price-currency.js', 'utf8');
const collectScript = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');

function makeMockElement({ text = '', className = '', attrs = {}, value = '', children = [] }) {
  return {
    textContent: text,
    innerText: text,
    className,
    value,
    children,
    classList: {
      contains(name) {
        return String(className || '').split(/\s+/).includes(name);
      },
    },
    getAttribute(name) {
      if (name === 'class') return className;
      if (name === 'value') return value;
      return attrs[name] || '';
    },
    hasAttribute(name) {
      return Object.prototype.hasOwnProperty.call(attrs, name);
    },
    querySelectorAll(selector) {
      if (/input|button|\[role/.test(selector)) return children;
      return [];
    },
    closest() {
      return this;
    },
  };
}

async function collectWithPage({ url, title, bodyText, selectors, queryAll, pageState }) {
  let messageListener = null;
  const windowListeners = {};
  const document = {
    title,
    body: { innerText: bodyText || '' },
    head: { appendChild() {} },
    documentElement: { appendChild() {} },
    getElementById() { return null; },
    createElement() {
      return {
        set id(_value) {},
        set src(_value) {},
        set async(_value) {},
      };
    },
    querySelector(selector) {
      const value = selectors && selectors[selector];
      return value ? { textContent: value } : null;
    },
    querySelectorAll(selector) {
      if (typeof queryAll === 'function') return queryAll(selector);
      if (queryAll && queryAll[selector]) return queryAll[selector];
      return [];
    },
    addEventListener() {},
  };
  const locationUrl = new URL(url);
  const chrome = {
    runtime: {
      getURL(value) { return value; },
      onMessage: {
        addListener(fn) {
          messageListener = fn;
        },
      },
    },
  };
  const sandbox = {
    console,
    document,
    location: {
      href: locationUrl.href,
      hostname: locationUrl.hostname,
    },
    chrome,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
  };
  sandbox.window = {
    location: sandbox.location,
    addEventListener(type, fn) {
      windowListeners[type] = fn;
    },
    removeEventListener(type) {
      delete windowListeners[type];
    },
    postMessage(payload) {
      if (payload && payload.direction === 'spb-self-hosted:content' && windowListeners.message) {
        setTimeout(() => {
          windowListeners.message({
            source: sandbox.window,
            data: {
              direction: 'spb-self-hosted:bridge',
              requestId: payload.requestId,
              ok: true,
              payload: pageState || {},
            },
          });
        }, 0);
      }
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window.window = sandbox.window;
  sandbox.window.document = document;
  sandbox.window.chrome = chrome;
  sandbox.window.globalThis = sandbox;

  vm.createContext(sandbox);
  vm.runInContext(priceCurrencyScript, sandbox, { filename: 'price-currency.js' });
  vm.runInContext(collectScript, sandbox, { filename: 'collect-content-script.js' });

  assert.equal(typeof messageListener, 'function', 'collect script should register a runtime message listener');
  return await new Promise((resolve) => {
    messageListener({ type: 'spb-self-hosted:collect-product' }, {}, resolve);
  });
}

const aliResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/733344455566.html',
  title: '1688 detail',
  bodyText: '起批价 ¥12.80 近30天成交 1200 运费 ¥6 起',
  selectors: {
    h1: '1688 同款货源',
    '.price': '¥12.80 - ¥15.50',
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '733344455566',
        subject: '1688 同款货源',
        priceRange: '12.80-15.50',
      },
    },
  },
});

assert.equal(aliResponse.ok, true);
assert.equal(aliResponse.data.priceCny, 15.5);
assert.equal(aliResponse.data.priceText, '¥12.80 - ¥15.50');
assert.equal(aliResponse.data.priceSourceType, 'rangeHigh');
assert.equal(aliResponse.data.shippingCny, 6);
assert.equal(aliResponse.data.totalCostCny, 21.5);
assert.equal(aliResponse.data.currency, 'CNY');

const selectedSkuResponse = await collectWithPage({
  url: 'https://detail.1688.com/offer/1032907994887.html',
  title: '1688 selected sku detail',
  bodyText: '¥98.00 ~ ¥134.10 1个起批 运费 ¥0 起',
  selectors: {
    h1: '鱼缸过滤制氧一体机',
    '.price': '¥98.00 ~ ¥134.10',
  },
  queryAll(selector) {
    if (!/(sku|Sku|spec|Spec|\bli\b|\btr\b|role="row")/.test(selector)) return [];
    return [
      makeMockElement({ text: '颜色 大号过滤制氧一体 ¥98 库存413个', className: 'sku-row selected' }),
      makeMockElement({ text: '颜色 特大号过滤制氧一体 ¥134.10 库存254个', className: 'sku-row' }),
    ];
  },
  pageState: {
    knownGlobals: {
      offer: {
        offerId: '1032907994887',
        subject: '鱼缸过滤制氧一体机',
      },
    },
  },
});

assert.equal(selectedSkuResponse.ok, true);
assert.equal(selectedSkuResponse.data.priceCny, 98);
assert.equal(selectedSkuResponse.data.priceText, '¥98');
assert.equal(selectedSkuResponse.data.priceSourceType, 'selectedSku');
assert.equal(selectedSkuResponse.data.selectedSku.price, 98);
assert.equal(selectedSkuResponse.data.shippingCny, 0);
assert.equal(selectedSkuResponse.data.totalCostCny, 98);

const taobaoResponse = await collectWithPage({
  url: 'https://item.taobao.com/item.htm?id=99887766',
  title: 'Taobao detail',
  bodyText: '券后价 ￥89.90 月销量 300',
  selectors: {
    h1: '淘宝同款货源',
    '.Price--priceText': '￥89.90',
  },
  pageState: {
    knownGlobals: {
      item: {
        itemId: '99887766',
        title: '淘宝同款货源',
        promotionPrice: '89.90',
      },
    },
  },
});

assert.equal(taobaoResponse.ok, true);
assert.equal(taobaoResponse.data.priceCny, 89.9);
assert.equal(taobaoResponse.data.priceText, '￥89.90');
assert.equal(taobaoResponse.data.currency, 'CNY');

console.log('PASS source price extraction');

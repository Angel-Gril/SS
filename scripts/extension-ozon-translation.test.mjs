import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function readRepoFile(...parts) {
  return readFileSync(join(root, ...parts), 'utf8');
}

function loadOzonPanelHarness({ priceText, htmlText = '', dataStates = [] } = {}) {
  const helperSource = readRepoFile('extensions', 'ss-erp', 'shared', 'ozon', 'page-product.js');
  const source = readRepoFile('extensions', 'ss-erp', 'content', 'ozon-panel.js');
  const dataStateNodes = dataStates.map((value) => ({
    getAttribute(name) {
      return name === 'data-state' ? JSON.stringify(value) : '';
    },
  }));
  const priceNode = { textContent: priceText || '', innerText: priceText || '' };
  const titleNode = { textContent: 'GL.iNet GL-MT6000', innerText: 'GL.iNet GL-MT6000' };
  const document = {
    title: 'GL.iNet GL-MT6000',
    documentElement: { innerHTML: htmlText || priceText || '' },
    querySelector(selector) {
      if (selector === 'h1' || selector === '[data-widget*="webProductHeading"] h1') return titleNode;
      if (selector === '[data-widget*="webPrice"]') return priceNode;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-state]') return dataStateNodes;
      return [];
    },
    createElement() {
      return {
        style: {},
        addEventListener() {},
        appendChild() {},
        querySelector() { return null; },
        querySelectorAll() { return []; },
      };
    },
  };
  const context = {
    console: { log() {}, warn() {}, error() {} },
    window: {
      location: { href: 'https://www.ozon.ru/product/gl-inet-gl-mt6000-3885089607/' },
    },
    document,
    setTimeout() {},
    clearTimeout() {},
  };
  context.window.window = context.window;
  context.window.document = document;
  context.globalThis = context.window;
  vm.runInNewContext(helperSource, context, { filename: 'page-product.js' });
  vm.runInNewContext(source, context, { filename: 'ozon-panel.js' });
  return context.window.OZON_CALC_OZON_PANEL;
}

test('Ozon calculator keeps browser-translated China price as CNY instead of converting it from RUB', () => {
  const panel = loadOzonPanelHarness({
    priceText: [
      '1,384.66 日元',
      '1,505.70 日元',
      '4,018.95 日元',
      '每件1384.66元',
    ].join('\n'),
    dataStates: [
      {
        cardPrice: '1384.66',
        price: '1505.70',
        originalPrice: '4018.95',
      },
    ],
  });

  const product = panel.collectPageProduct();

  assert.equal(product.pagePriceCurrency, 'CNY');
  assert.equal(product.pagePriceValue, 1384.66);
});

test('Ozon calculator parses browser-translated visible China prices with comma thousands', () => {
  const panel = loadOzonPanelHarness({
    priceText: [
      '销售',
      '1,384.66 日元',
      '1,505.70 日元',
      '4,018.95 日元',
    ].join('\n'),
  });

  const product = panel.collectPageProduct();

  assert.equal(product.pagePriceCurrency, 'CNY');
  assert.equal(product.pagePriceValue, 1384.66);
});

test('Ozon calculator drawer opts out of browser page translation', () => {
  const injector = readRepoFile('extensions', 'ss-erp', 'content', 'ozon-injector.js');
  const manifest = JSON.parse(readRepoFile('extensions', 'ss-erp', 'manifest.json'));

  assert.match(injector, /fab\.classList\.add\('notranslate'\)/);
  assert.match(injector, /drawer\.classList\.add\('notranslate'\)/);
  assert.match(injector, /fab\.setAttribute\('translate',\s*'no'\)/);
  assert.match(injector, /drawer\.setAttribute\('translate',\s*'no'\)/);
  assert.match(injector, /drawer\.setAttribute\('lang',\s*'zh-CN'\)/);

  const ozonScript = manifest.content_scripts.find((entry) => Array.isArray(entry.js) && entry.js.includes('content/ozon-panel.js'));
  assert.ok(ozonScript, 'manifest should register the Ozon panel content script');
  assert.ok(
    ozonScript.js.indexOf('shared/ozon/page-product.js') >= 0
      && ozonScript.js.indexOf('shared/ozon/page-product.js') < ozonScript.js.indexOf('content/ozon-panel.js'),
    'Ozon product page helper should load before the Ozon panel',
  );
});

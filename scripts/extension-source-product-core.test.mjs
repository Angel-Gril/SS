import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadCore() {
  const source = fs.readFileSync('extensions/ss-erp/shared/collectors/source-product-core.js', 'utf8');
  const context = { module: { exports: {} } };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'source-product-core.js' });
  return context.SS_ERP_SOURCE_PRODUCT_CORE || context.module.exports;
}

test('source product core detects marketplace platforms', () => {
  const core = loadCore();
  assert.equal(core.detectPlatform('detail.1688.com'), '1688');
  assert.equal(core.detectPlatform('pifa.pinduoduo.com'), 'pdd');
  assert.equal(core.detectPlatform('mobile.yangkeduo.com'), 'pdd');
  assert.equal(core.detectPlatform('www.ozon.ru'), 'ozon');
  assert.equal(core.detectPlatform('item.taobao.com'), 'taobao');
  assert.equal(core.detectPlatform('example.test'), 'generic');
});

test('source product core parses loose marketplace numbers', () => {
  const core = loadCore();
  assert.equal(core.parseLooseNumber('1.2万+'), 12000);
  assert.equal(core.parseLooseNumber('3.5k'), 3500);
  assert.equal(core.parseLooseNumber('2m'), 2000000);
  assert.equal(core.parseLooseNumber('1,234'), 1234);
  assert.equal(core.parseLooseNumber(''), null);
});

test('source product core converts source weight units to grams', () => {
  const core = loadCore();
  assert.equal(core.convertWeightToGrams('1.2kg'), 1200);
  assert.equal(core.convertWeightToGrams('2斤'), 1000);
  assert.equal(core.convertWeightToGrams('1 lb'), 454);
  assert.equal(core.convertWeightToGrams('3 oz'), 85);
  assert.equal(core.convertWeightToGrams('250克'), 250);
  assert.equal(core.convertWeightToGrams('n/a'), null);
});

test('source product core keeps formatting helpers stable', () => {
  const core = loadCore();
  assert.equal(core.formatMoney(12), '12');
  assert.equal(core.formatMoney(12.5), '12.5');
  assert.equal(core.formatMoney(12.345), '12.35');
  assert.equal(core.formatMoney(null), '');
  assert.equal(core.normalizeWhitespace('  1688\n  同款\t货源  '), '1688 同款 货源');
});

test('source product core collects page state sources and candidates', () => {
  const core = loadCore();
  const sources = core.collectDataSources({
    knownGlobals: {
      offer: {
        subject: '  1688\n同款货源 ',
        trade: { monthSales: '1.2万+' },
        specs: [{ name: '重量', value: '1.5kg' }],
      },
      ignored: null,
    },
    aliExpressData: { product: { imageUrl: 'https://img.test/a.jpg' } },
  });

  assert.equal(sources.length, 2);
  assert.equal(core.collectStringCandidates(sources, /subject|image/i)[0].value, '1688 同款货源');
  assert.equal(core.collectNumberCandidates(sources, /monthSales|weight|重量/i)[0].value, 12000);
  assert.equal(core.collectObjectCandidates(sources, /specs/i)[0].path, 'specs');
  assert.equal(core.summarizeSources(sources)[0].keys.join('|'), 'subject|trade|specs');
  assert.equal(core.hasAnyKey({ skuId: '1' }, /sku/i), true);
  assert.equal(core.pickFirstValue({ price: '', salePrice: 12 }, ['price', 'salePrice']), 12);
});

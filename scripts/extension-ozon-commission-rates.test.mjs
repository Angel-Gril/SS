import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadCommissionRates() {
  const source = fs.readFileSync('extensions/ss-erp/shared/commission/commission-rates.js', 'utf8');
  const context = { console };
  context.globalThis = context;
  vm.runInNewContext(source, context, { filename: 'commission-rates.js' });
  return context.OZON_CALC_COMMISSION_RATES;
}

test('Ozon commission matcher can match maintained category-id rules', () => {
  const matcher = loadCommissionRates();

  const match = matcher.matchCommissionRate({
    source: 'system-category-db',
    sourceUrl: 'local:system-category-db',
    rules: [
      {
        category: '系统类目 300001',
        categoryIds: [300001],
        bands: [{ minRUB: 0, maxRUB: 1500, rfbs: 12, fbp: 15 }],
      },
    ],
  }, {
    scheme: 'fbp',
    priceRUB: 1200,
    categoryHints: ['Дом и сад / Тряпки'],
    categoryIds: [17028718, 200000933, 300001],
  });

  assert.equal(match.ratePct, 15);
  assert.equal(match.category, '系统类目 300001');
  assert.equal(match.source, 'official');
});

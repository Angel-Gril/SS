import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';

const context = { window: {} };
vm.runInNewContext(readFileSync('extensions/ss-erp/shared/calculator-core/profit-engine.js', 'utf8'), context);
const engine = context.window.OZON_CALC_PROFIT_ENGINE;
const input = { cost: 50, shippingCost: 15, packingFee: 2, domesticFee: 3,
  commissionPct: 17, adPct: 3, otherPct: 0, targetMarginPct: 20,
  discountPct: 30, currency: 'CNY', fxRate: 0.1 };

test('target pricing calculates a sale and crossed-out price with the existing cost breakdown', () => {
  const result = engine.calculateSalePriceForTargetMargin(input);
  assert.equal(result.price, '116.67');
  assert.equal(result.oldPrice, '166.68');
  assert.equal(result.currency, 'CNY');
  assert.equal(result.quote.shippingCost, 15);
  assert.equal(result.quote.packingFee, 2);
  assert.ok(result.quote.marginPct >= 20);
  assert.ok(result.quote.feeLines.some(line => line.label === '广告费' && line.amount > 0));
  assert.ok(result.quote.feeLines.some(line => line.label === '国内运费及杂费' && line.amount === 3));
});

test('RUB prices use an explicit exchange rate and retain target margin after rounding', () => {
  const result = engine.calculateSalePriceForTargetMargin({ ...input, currency: 'RUB' });
  assert.equal(result.price, '1166.67');
  assert.equal(result.oldPrice, '1666.68');
  assert.ok(result.quote.marginPct >= 20);
  assert.ok(result.quote.marginPct < 20.001);
  assert.equal(result.quote.priceRUB, Number(result.price));
});

test('pricing allows explicitly confirmed zero fees but never substitutes missing cost or freight', () => {
  const result = engine.calculateSalePriceForTargetMargin({ ...input, cost: 10, shippingCost: 0,
    packingFee: 0, domesticFee: 0, commissionPct: 0, adPct: 0, discountPct: 0, targetMarginPct: 50 });
  assert.equal(result.price, '20.00');
  assert.equal(result.oldPrice, result.price);
  for (const [field, values] of [['cost', [0, '', null, undefined, NaN, Infinity, -1]],
    ['shippingCost', ['', null, undefined, NaN, Infinity, -1]], ['packingFee', [-1]],
    ['domesticFee', [-1]], ['fxRate', [0, '', undefined]]]) {
    for (const value of values) assert.throws(() => engine.calculateSalePriceForTargetMargin({ ...input, currency: 'RUB', [field]: value }));
  }
});

test('pricing rejects impossible margins, nonfinite rates and unsupported sale currencies', () => {
  for (const invalid of [{ targetMarginPct: 80 }, { discountPct: 100 }, { commissionPct: -1 },
    { adPct: NaN }, { otherPct: Infinity }, { currency: 'USD' }, { cost: 1e9 }]) {
    assert.throws(() => engine.calculateSalePriceForTargetMargin({ ...input, ...invalid }));
  }
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function loadCore(extraContext = {}) {
  const source = fs.readFileSync('extensions/ss-erp/shared/source-costing/panel-core.js', 'utf8');
  const context = {
    console,
    URL,
    window: {},
    ...extraContext,
  };
  context.globalThis = context.window;
  vm.runInNewContext(source, context, { filename: 'panel-core.js' });
  return context.window.SS_ERP_SOURCE_COSTING_CORE;
}

test('source costing core detects supported source platforms', () => {
  const core = loadCore();
  assert.equal(core.detectSourcePlatform('https://detail.1688.com/offer/123.html'), '1688');
  assert.equal(core.detectSourcePlatform('https://mobile.yangkeduo.com/goods.html'), 'PDD');
  assert.equal(core.detectSourcePlatform('https://pifa.pinduoduo.com/goods/detail'), 'PDD');
  assert.equal(core.detectSourcePlatform('https://item.taobao.com/item.htm?id=99887766'), '淘宝');
  assert.equal(core.detectSourcePlatform('https://detail.tmall.com/item.htm?id=99887766'), '天猫');
  assert.equal(core.detectSourcePlatform('https://example.com/product/1'), '');
});

test('source costing core builds stable SKU-sensitive product signatures', () => {
  const core = loadCore();
  assert.equal(
    core.buildProductSignature({
      productId: 'offer-1',
      selectedSku: { skuId: 'sku-red', quantity: 3 },
      priceCny: 12.5,
      shippingCny: 4,
      totalCostCny: 16.5,
    }),
    'offer-1|sku-red|3|12.5|4|16.5',
  );
});

test('source costing core reads Ozon prices as CNY without double conversion', () => {
  const core = loadCore();
  assert.equal(core.readOzonPriceCny({ pagePriceValue: 199, pagePriceCurrency: 'CNY' }, 0.08), 199);
  assert.equal(core.readOzonPriceCny({ price: { value: 1000, currency: 'RUB' } }, 0.07), 70);
  assert.equal(
    core.readOzonPriceCny(
      { pagePriceValue: 1000, pagePriceCurrency: 'RUB' },
      0.08,
      { cnyPerCurrency: { RUB: 0.071 } },
      { priceToCNY: (value, currency, snapshot) => value * snapshot.cnyPerCurrency[currency] },
    ),
    71,
  );
  assert.equal(core.formatOzonPrice({ pagePriceValue: 88, pagePriceCurrency: 'CNY' }), '¥ 88');
});

test('source costing core computes quotes with synced commission match', () => {
  const core = loadCore();
  const result = core.computeCosting({
    sourcePlatform: '1688',
    status: {
      snapshot: {
        userConfig: { selectedServiceIds: ['rfbs'], resolutionMode: 'lowest_cost' },
        formState: { commissionScheme: 'rfbs' },
        catalogSnapshot: { services: [{ id: 'rfbs', displayName: 'RFBS' }] },
        ruleSnapshot: { services: [{ serviceId: 'rfbs', ruleId: 'r1' }] },
      },
      commissionSnapshot: { loaded: true },
    },
    ozon: { title: 'phone case', categoryHints: ['Cases'] },
    inputs: { priceRMB: 100, cost: 40, weightG: 300, fxRate: 0.08, commissionPct: 12 },
    commissionRates: {
      matchCommissionRate: (_snapshot, input) => ({
        ratePct: input.categoryHints[0] === 'Cases' ? 8 : input.manualRatePct,
        source: 'category',
        priceBand: { minRUB: 0, maxRUB: 0 },
      }),
    },
    ruleEngine: {
      buildServiceQuote: (_service, rules, input) => ({
        available: true,
        matchedRule: { serviceId: rules[0].serviceId, shippingCost: 15, commissionPct: input.commissionPct },
      }),
      resolveBestQuote: (quotes) => quotes[0],
    },
    profitEngine: {
      enrichQuote: (rule, input) => ({
        serviceId: rule.serviceId,
        displayName: 'RFBS',
        shippingCost: rule.shippingCost,
        commissionPct: rule.commissionPct,
        commissionFee: input.priceRMB * rule.commissionPct / 100,
        totalCost: input.cost + rule.shippingCost,
        profit: input.priceRMB - input.cost - rule.shippingCost,
        marginPct: 45,
      }),
    },
  });

  assert.equal(result.result.best.serviceId, 'rfbs');
  assert.equal(result.result.commissionMatch.ratePct, 8);
  assert.equal(result.unavailable.length, 0);
});

test('source costing core exposes unavailable quote reasons on no match', () => {
  const core = loadCore();
  assert.throws(
    () => core.computeCosting({
      sourcePlatform: 'PDD',
      status: {
        snapshot: {
          userConfig: { selectedServiceIds: ['slow'] },
          catalogSnapshot: { services: [{ id: 'slow' }] },
          ruleSnapshot: { services: [] },
        },
      },
      inputs: { priceRMB: 100, cost: 40, weightG: 300, fxRate: 0.08, commissionPct: 12 },
      ruleEngine: {
        buildServiceQuote: () => ({ available: false, reason: '超重' }),
        resolveBestQuote: (quotes) => quotes[0],
      },
      profitEngine: {
        enrichQuote: () => ({}),
      },
    }),
    (error) => {
      assert.equal(error.message, '当前条件没有命中物流：超重');
      assert.equal(error.unavailable[0].reason, '超重');
      return true;
    },
  );
});

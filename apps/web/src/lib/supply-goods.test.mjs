import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSupplyGoods1688Summary } from './supply-goods.ts';

test('builds pricing and mapping summary for a 1688 supply good', () => {
  const summary = buildSupplyGoods1688Summary({
    sourcePlatform: '1688',
    metadata: {
      pricing: {
        suggestedSalePriceCny: 73,
        suggestedSalePriceRub: 913,
        estimatedMarginPct: 30.1,
      },
      mappedCategory: {
        targetCategoryId: 17028711,
        targetTypeId: 95841,
        targetCategoryName: 'Чехлы',
      },
    },
  });

  assert.deepEqual(summary, {
    hasPricing: true,
    hasMapping: true,
    pricingText: '建议 ¥73 / ₽913 · 利润率 30.1%',
    mappingText: 'Ozon 17028711 / type 95841 · Чехлы',
  });
});

test('shows missing pricing and mapping for a 1688 supply good without import metadata', () => {
  const summary = buildSupplyGoods1688Summary({
    sourcePlatform: '1688',
    metadata: null,
  });

  assert.deepEqual(summary, {
    hasPricing: false,
    hasMapping: false,
    pricingText: '未生成核价',
    mappingText: '未命中类目映射',
  });
});

test('does not build 1688 summary for non-1688 supply goods', () => {
  assert.equal(buildSupplyGoods1688Summary({
    sourcePlatform: 'taobao',
    metadata: {
      pricing: { suggestedSalePriceCny: 88 },
    },
  }), null);
});

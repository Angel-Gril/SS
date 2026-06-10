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
        skuSummary: {
          count: 2,
          minSuggestedSalePriceCny: 69,
          maxSuggestedSalePriceCny: 81,
          minSuggestedSalePriceRub: 863,
          maxSuggestedSalePriceRub: 1013,
        },
      },
      mappedCategory: {
        targetCategoryId: 17028711,
        targetTypeId: 95841,
        targetCategoryName: 'Чехлы',
        matchType: 'sourceCategoryPath',
        scope: 'user',
      },
      sourceOzonProductId: '987654321',
      ozonSourceContext: {
        title: 'Ozon 透明手机壳',
        categoryName: '手机壳',
      },
    },
  });

  assert.deepEqual(summary, {
    hasPricing: true,
    hasMapping: true,
    hasOzonSource: true,
    pricingText: '建议 ¥73 / ₽913 · 利润率 30.1%',
    skuPricingText: 'SKU 2 个 · ¥69-81 / ₽863-1013',
    mappingText: 'Ozon 17028711 / type 95841 · Чехлы · 路径匹配 · 我的映射',
    ozonSourceText: '来自 Ozon 987654321 · Ozon 透明手机壳 · 手机壳',
  });
});

test('shows global id mapping match details for a 1688 supply good', () => {
  const summary = buildSupplyGoods1688Summary({
    sourcePlatform: '1688',
    metadata: {
      mappedCategory: {
        targetCategoryId: 17028711,
        targetTypeId: 95841,
        matchType: 'sourceCategoryId',
        scope: 'global',
      },
    },
  });

  assert.equal(summary?.hasMapping, true);
  assert.equal(summary?.mappingText, 'Ozon 17028711 / type 95841 · ID匹配 · 全局默认');
});

test('shows missing pricing and mapping for a 1688 supply good without import metadata', () => {
  const summary = buildSupplyGoods1688Summary({
    sourcePlatform: '1688',
    metadata: null,
  });

  assert.deepEqual(summary, {
    hasPricing: false,
    hasMapping: false,
    hasOzonSource: false,
    pricingText: '未生成核价',
    skuPricingText: '未生成 SKU 核价',
    mappingText: '未命中类目映射',
    ozonSourceText: '未关联 Ozon 来源',
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

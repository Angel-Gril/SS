import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildListingPriceOverrides,
  getListingVariantPriceKey,
} from './listing-prices.ts';

test('builds base and 1688 variant price overrides from suggested prices', () => {
  const overrides = buildListingPriceOverrides([
    {
      id: 'goods-1688',
      sourcePlatform: '1688',
      publishPriceCny: 73,
      variants: [
        { sku: '111111111', price: '69', suggestedSalePriceCny: 69 },
        { sku: '222222222', price: '81', suggestedSalePriceCny: 81 },
      ],
    },
  ]);

  assert.deepEqual(overrides, {
    'goods-1688': {
      _base: 73,
      '111111111': 69,
      '222222222': 81,
    },
  });
});

test('keeps manually edited 1688 variant prices even when suggested price was not matched', () => {
  const editedVariantPriceKeys = new Set([
    getListingVariantPriceKey('goods-1688', '333333333'),
  ]);

  const overrides = buildListingPriceOverrides([
    {
      id: 'goods-1688',
      sourcePlatform: '1688',
      variants: [
        { sku: '333333333', price: '88', suggestedSalePriceCny: null },
      ],
    },
  ], { editedVariantPriceKeys });

  assert.deepEqual(overrides, {
    'goods-1688': {
      '333333333': 88,
    },
  });
});

test('does not treat unedited 1688 source variant prices as publish overrides', () => {
  const overrides = buildListingPriceOverrides([
    {
      id: 'goods-1688',
      sourcePlatform: '1688',
      variants: [
        { sku: '111111111', price: '200', suggestedSalePriceCny: null },
      ],
    },
  ]);

  assert.deepEqual(overrides, {});
});

test('does not send non-1688 variant prices as CNY overrides', () => {
  const editedVariantPriceKeys = new Set([
    getListingVariantPriceKey('goods-ozon', '111111111'),
  ]);

  const overrides = buildListingPriceOverrides([
    {
      id: 'goods-ozon',
      sourcePlatform: 'ozon',
      publishPriceCny: 120,
      variants: [
        { sku: '111111111', price: '999', suggestedSalePriceCny: 999 },
      ],
    },
  ], { editedVariantPriceKeys });

  assert.deepEqual(overrides, {
    'goods-ozon': {
      _base: 120,
    },
  });
});

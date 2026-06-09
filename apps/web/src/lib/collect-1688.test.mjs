import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCollect1688PreviewSignature,
  getCollect1688SaveAction,
  isCollect1688PreviewStale,
} from './collect-1688.ts';

const baseInput = {
  sourceUrl: 'https://detail.1688.com/offer/123456789.html',
  title: '透明手机壳',
  sourceCategoryName: '手机壳',
  supplier: '义乌供应商',
  sku: 'SKU-1',
  purchasePriceCny: '20',
  domesticShippingCny: '5',
  weightG: '500',
  packageFeeCny: '2',
  commissionPct: '12',
  logisticsFeeCny: '18',
  exchangeRateRubToCny: '0.08',
  targetMarginPct: '30',
  notes: '内部备注',
};

test('marks a 1688 preview stale when pricing inputs change', () => {
  const signature = buildCollect1688PreviewSignature(baseInput);

  assert.equal(isCollect1688PreviewStale({
    ...baseInput,
    purchasePriceCny: '21',
  }, signature), true);
});

test('keeps a 1688 preview current when non-pricing notes change', () => {
  const signature = buildCollect1688PreviewSignature(baseInput);

  assert.equal(isCollect1688PreviewStale({
    ...baseInput,
    notes: '换一条采购备注',
  }, signature), false);
});

test('treats missing 1688 preview signature as not stale', () => {
  assert.equal(isCollect1688PreviewStale(baseInput, null), false);
});

test('shows update action when a 1688 preview matches an existing supply good', () => {
  const action = getCollect1688SaveAction({
    saveMode: 'update',
    existingSupplyGood: {
      id: 'goods-existing',
      title: '透明手机壳旧版',
      sourceProductId: '123456789',
      updatedAt: '2026-06-09T00:00:00.000Z',
    },
  });

  assert.equal(action.buttonLabel, '更新已有货源');
  assert.equal(action.panelTitle, '将更新已有货源');
  assert.equal(action.variant, 'update');
});

test('shows create action before a 1688 preview matches existing goods', () => {
  const action = getCollect1688SaveAction({
    saveMode: 'create',
    existingSupplyGood: null,
  });

  assert.equal(action.buttonLabel, '保存到货源');
  assert.equal(action.panelTitle, '将创建新货源');
  assert.equal(action.variant, 'create');
});

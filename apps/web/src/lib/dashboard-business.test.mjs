import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDashboardBusinessActions, getDashboardBusinessActionMeta } from './dashboard-business.ts';

test('dashboard business actions surface 1688 collection and category mapping', () => {
  const actions = buildDashboardBusinessActions();
  const byKey = new Map(actions.map((action) => [action.key, action]));

  assert.equal(byKey.get('collect-1688')?.href, '/collect/1688');
  assert.equal(byKey.get('collect-1688')?.label, '1688手工补录');
  assert.match(byKey.get('collect-1688')?.description || '', /兜底|排查/);
  assert.equal(byKey.get('category-mapping')?.href, '/collect/category-mapping');
  assert.equal(actions[0].key, 'collect-1688');
});

test('dashboard business actions have stable unique keys and usable links', () => {
  const actions = buildDashboardBusinessActions();
  const keys = actions.map((action) => action.key);

  assert.equal(new Set(keys).size, actions.length);
  assert.equal(actions.every((action) => action.href.startsWith('/')), true);
  assert.equal(actions.every((action) => action.label.length > 0 && action.description.length > 0), true);
});

test('dashboard business action meta summarizes current 1688 workflow status', () => {
  const actions = buildDashboardBusinessActions();
  const status = {
    collect1688: {
      supplyGoodCount: 3,
      latestSupplyGood: {
        id: 'goods-1',
        title: '透明手机壳',
        sourceProductId: '123456789',
        updatedAt: '2026-06-09T00:00:00.000Z',
      },
    },
    categoryMapping: {
      mappingCount: 2,
      latestMapping: {
        id: 'mapping-1',
        sourceCategoryName: '手机壳',
        targetCategoryId: 17028711,
        targetTypeId: 95841,
        updatedAt: '2026-06-08T00:00:00.000Z',
      },
    },
  };

  assert.equal(getDashboardBusinessActionMeta(actions[0], status), '3 条1688货源 · 最近 透明手机壳');
  assert.equal(getDashboardBusinessActionMeta(actions[1], status), '2 条映射 · 最近 手机壳');
  assert.equal(getDashboardBusinessActionMeta(actions[3], status), '已启用类目映射辅助上货');
});

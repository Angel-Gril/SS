import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSupplyGoodsExportFilename,
  buildSupplyGoodsExportPath,
} from './supply-export.ts';

test('builds supply goods export path with active filters', () => {
  const path = buildSupplyGoodsExportPath({
    id: 'goods-1',
    search: '手机壳',
    status: 'active',
    sourcePlatform: '1688',
  });

  assert.equal(
    path,
    '/api/supply/export?id=goods-1&search=%E6%89%8B%E6%9C%BA%E5%A3%B3&status=active&sourcePlatform=1688',
  );
});

test('omits empty supply goods export filters', () => {
  assert.equal(
    buildSupplyGoodsExportPath({ id: '', search: ' ', status: undefined, sourcePlatform: null }),
    '/api/supply/export',
  );
});

test('builds dated supply goods export filename', () => {
  assert.equal(
    buildSupplyGoodsExportFilename(new Date('2026-06-10T12:00:00.000Z')),
    'supply-goods-2026-06-10.csv',
  );
});

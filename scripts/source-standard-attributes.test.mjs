import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const sourcePath = 'packages/shared/src/source-standard-attributes.ts';
assert.equal(fs.existsSync(sourcePath), true, 'source standard attribute helper should exist');

const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText;

const sandbox = {
  exports: {},
  module: { exports: {} },
  require,
};
vm.runInNewContext(compiled, sandbox, { filename: sourcePath });
const standard = Object.keys(sandbox.module.exports).length ? sandbox.module.exports : sandbox.exports;

const item = {
  title: '女士无痕内衣跨境货源',
  metadata: {
    sourcePlatform: '1688',
    categoryPath: ['内衣', '文胸'],
    sourceAttributes: [
      { name: '品牌', value: '其他' },
      { name: '主面料成分', value: '锦纶/尼龙' },
      { name: '里料成分', value: '氨纶' },
      { name: '适用性别', value: '女' },
      { name: '适合季节', value: '四季' },
      { name: '颜色', value: '肤色、黑色' },
      { name: '尺码', value: 'M、L、XL' },
    ],
    sourcePackagingRows: [{ weightG: 120, lengthMm: 300, widthMm: 200, heightMm: 30 }],
  },
  variants: [
    { attrs: { 颜色: '肤色', 尺码: 'M' }, stock: 3 },
    { attrs: { 颜色: '黑色', 尺码: 'L' }, stock: 2 },
  ],
};

{
  const result = standard.normalizeSourceStandardAttributes(item);
  assert.equal(result.brand.value, '其他');
  assert.equal(result.brand.isBrandless, true);
  assert.equal(JSON.stringify(result.colors), JSON.stringify(['肤色', '黑色']));
  assert.equal(JSON.stringify(result.sizes), JSON.stringify(['M', 'L', 'XL']));
  assert.equal(JSON.stringify(result.materials), JSON.stringify(['锦纶/尼龙', '氨纶']));
  assert.equal(result.gender.value, 'female');
  assert.equal(JSON.stringify(result.seasons), JSON.stringify(['all-season']));
  assert.equal(JSON.stringify(result.packageDimensionsMm), JSON.stringify({ length: 300, width: 200, height: 30 }));
  assert.equal(result.packageWeightG, 120);
  assert.equal(JSON.stringify(result.categoryHints), JSON.stringify(['内衣', '文胸']));
  assert.equal(result.missingForOzon.includes('品牌/无品牌'), false);
  assert.equal(result.missingForOzon.includes('颜色尺码变体'), false);
  assert.equal(result.missingForOzon.includes('材质/成分'), false);
  assert.equal(result.missingForOzon.includes('性别/季节'), false);
  assert.equal(result.missingForOzon.includes('重量尺寸'), false);
}

{
  const result = standard.normalizeSourceStandardAttributes({
    title: '男士长裤',
    metadata: {
      sourceAttributes: [
        { name: '产品类别', value: '休闲裤' },
        { name: '款式细节', value: '抽绳' },
      ],
    },
    variants: [{ attrs: { 尺码: 'M' }, stock: 1 }],
  });
  assert.equal(result.materials.length, 0);
  assert.equal(JSON.stringify(result.colors), JSON.stringify([]));
  assert.equal(JSON.stringify(result.sizes), JSON.stringify(['M']));
  assert.ok(result.missingForOzon.includes('品牌/无品牌'));
  assert.ok(result.missingForOzon.includes('颜色尺码变体'));
  assert.ok(result.missingForOzon.includes('材质/成分'));
  assert.ok(result.missingForOzon.includes('重量尺寸'));
}

console.log('PASS source standard attributes');


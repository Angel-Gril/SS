import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function loadTsModule(modulePath, injected = {}) {
  assert.equal(fs.existsSync(modulePath), true, `${modulePath} should exist`);
  const source = fs.readFileSync(modulePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText;

  const sandbox = {
    exports: {},
    module: { exports: {} },
    require(specifier) {
      if (Object.prototype.hasOwnProperty.call(injected, specifier)) return injected[specifier];
      return require(specifier);
    },
  };
  vm.runInNewContext(compiled, sandbox, { filename: modulePath });
  return Object.keys(sandbox.module.exports).length ? sandbox.module.exports : sandbox.exports;
}

const standard = loadTsModule('packages/shared/src/source-standard-attributes.ts');
const planner = loadTsModule('packages/shared/src/source-rich-content-plan.ts', {
  './source-standard-attributes': standard,
});

{
  const plan = planner.buildSourceRichContentPlan({
    title: '女士睡裙吊带睡衣',
    metadata: {
      categoryName: '睡裙',
      categoryPath: ['服装', '睡裙'],
      sourceAttributes: [
        { name: '适用性别', value: '女' },
        { name: '主面料成分', value: '棉' },
        { name: '尺码', value: 'S、M、L' },
      ],
      sourceDetailImages: ['https://cdn.example.com/detail.jpg'],
    },
    variants: [{ attrs: { 颜色: '白色', 尺码: 'M' }, stock: 3 }],
  });

  assert.equal(plan.templateKey, 'apparel_sleepwear');
  assert.equal(plan.templateLabel, '睡衣/睡裙富内容模板');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'women_apparel');
  assert.deepEqual(JSON.parse(JSON.stringify(plan.sizeChart.tableColumns.slice(0, 3))), ['尺码', '俄罗斯尺码', '国际尺码']);
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === 'M' && row.ruSize === '44'));
  assert.ok(plan.modules.some((module) => module.key === 'size_note'));
}

{
  const plan = planner.buildSourceRichContentPlan({
    title: '无痕文胸内衣',
    metadata: {
      categoryName: '文胸',
      sourceAttributes: [
        { name: '尺码', value: 'S（适合75-95斤32/70AB）、M（适合95-110斤34/75AB）、L（适合110-125斤36/80AB）' },
        { name: '主面料成分', value: '锦纶' },
      ],
    },
    variants: [{ attrs: { 颜色: '肤色', 尺码: 'M（适合95-110斤34/75AB）' }, stock: 5 }],
  });

  assert.equal(plan.templateKey, 'bra');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'bra');
  assert.ok(plan.sizeChart.measurementEvidence.some((row) => row.includes('70AB')));
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '70AB' && row.ruSize === '70AB'));
  assert.match(plan.sizeChart.richText, /Размеры/);
}

{
  const plan = planner.buildSourceRichContentPlan({
    title: '女士背心',
    metadata: {
      sourceAttributes: [{ name: '尺码', value: '均码【适合80-125斤】' }],
    },
    variants: [{ attrs: { 颜色: '黑色', 尺码: '均码【适合80-125斤】' }, stock: 1 }],
  });

  assert.equal(plan.sizeChart.status, 'universal');
  assert.equal(plan.sizeChart.normalizedSizes[0], 'Универсальный');
  assert.doesNotMatch(plan.sizeChart.richText, /44|46|48/);
}

{
  const plan = planner.buildSourceRichContentPlan({
    title: '女鞋单鞋',
    metadata: {
      categoryName: '女鞋',
      sourceAttributes: [{ name: '尺码', value: '35、36、37' }],
    },
    variants: [{ attrs: { 颜色: '黑色', 尺码: '36' }, stock: 2 }],
  });

  assert.equal(plan.templateKey, 'shoes_women');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'women_shoes');
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '36' && row.footLengthCm === '23'));
}

{
  const plan = planner.buildSourceRichContentPlan({
    title: '女士文胸',
    metadata: {
      categoryName: '文胸',
      sourceAttributes: [{ name: '尺码', value: '70A、75B、80C' }],
    },
  });

  assert.equal(plan.templateKey, 'bra');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'bra');
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '75B' && row.ruSize === '75B'));
  assert.doesNotMatch(JSON.stringify(plan.sizeChart.tableRows), /44|46|48/);
}

console.log('PASS source rich content plan');

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
const sizeChartCatalog = loadTsModule('packages/shared/src/source-size-chart-template-catalog.ts');
const planner = loadTsModule('packages/shared/src/source-rich-content-plan.ts', {
  './source-standard-attributes': standard,
  './source-size-chart-template-catalog': sizeChartCatalog,
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
    title: '男士短袖T恤大码上衣',
    metadata: {
      categoryName: '男装',
      sourceAttributes: [{ name: '尺码', value: 'M、L、XL、2XL、3XL' }],
    },
    variants: [{ attrs: { 颜色: '黑色', 尺码: 'XL' }, stock: 2 }],
  });

  assert.equal(plan.templateKey, 'apparel_mens');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'men_apparel');
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === 'XL' && row.ruSize === '50'));
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '3XL' && row.ruSize === '54'));
}

{
  const plan = planner.buildSourceRichContentPlan({
    title: '儿童睡衣宝宝家居服',
    metadata: {
      categoryName: '童装',
      sourceAttributes: [{ name: '尺码', value: '90cm、100cm、110cm、120cm' }],
    },
    variants: [{ attrs: { 颜色: '蓝色', 尺码: '100cm' }, stock: 2 }],
  });

  assert.equal(plan.templateKey, 'apparel_children');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'children_apparel');
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '100' && row.ruSize === '100'));
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '120' && row.ruSize === '120'));
}

{
  const plan = planner.buildSourceRichContentPlan({
    title: '男鞋运动鞋休闲鞋',
    metadata: {
      categoryName: '男鞋',
      sourceAttributes: [{ name: '尺码', value: '40、41、42、43、44' }],
    },
    variants: [{ attrs: { 颜色: '白色', 尺码: '42' }, stock: 2 }],
  });

  assert.equal(plan.templateKey, 'shoes_men');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'men_shoes');
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '42' && row.footLengthCm === '26'));
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '44' && row.footLengthCm === '27'));
}

{
  const plan = planner.buildSourceRichContentPlan({
    title: '女士高腰牛仔裤直筒裤',
    metadata: {
      categoryName: '牛仔裤',
      sourceAttributes: [{ name: '尺码', value: 'W26/L28、W27/L30、W28/L32' }],
    },
    variants: [{ attrs: { 颜色: '蓝色', 尺码: 'W28/L32' }, stock: 2 }],
  });

  assert.equal(plan.templateKey, 'jeans');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'jeans');
  assert.ok(plan.sizeChart.tableColumns.includes('腰围(cm)'));
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === 'W28/L32' && row.ruSize === '44' && row['腰围(cm)'] === '70-72'));
}

{
  const plan = planner.buildSourceRichContentPlan({
    title: '儿童帽子宝宝渔夫帽',
    metadata: {
      categoryName: '儿童帽子',
      sourceAttributes: [{ name: '尺码', value: '44、46、48、49' }],
    },
    variants: [{ attrs: { 颜色: '黄色', 尺码: '48' }, stock: 2 }],
  });

  assert.equal(plan.templateKey, 'children_hats');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'children_hats');
  assert.ok(plan.sizeChart.tableColumns.includes('头围(cm)'));
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '48' && row.ruSize === '48' && row['年龄'] === '1.5年'));
}

{
  const plan = planner.buildSourceRichContentPlan({
    title: '儿童袜子宝宝短袜',
    metadata: {
      categoryName: '儿童袜子',
      sourceAttributes: [{ name: '尺码', value: '16-17、18-19、20-23、28-32' }],
    },
    variants: [{ attrs: { 颜色: '白色', 尺码: '28-32' }, stock: 2 }],
  });

  assert.equal(plan.templateKey, 'children_socks');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'children_socks');
  assert.ok(plan.sizeChart.tableColumns.includes('脚长(cm)'));
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '28-32' && row.ruSize === '20' && row['脚长(cm)'] === '19-20.4'));
}

{
  const plan = planner.buildSourceRichContentPlan({
    title: '儿童手套保暖手套',
    metadata: {
      categoryName: '儿童手套',
      sourceAttributes: [{ name: '尺码', value: '2、3、4、5' }],
    },
    variants: [{ attrs: { 颜色: '粉色', 尺码: '4' }, stock: 2 }],
  });

  assert.equal(plan.templateKey, 'children_gloves');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'children_gloves');
  assert.ok(plan.sizeChart.tableColumns.includes('手掌周长(cm)'));
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '4' && row.ruSize === '4' && row['国际尺码'] === 'S'));
}

{
  const plan = planner.buildSourceRichContentPlan({
    title: '儿童紧身衣连裤袜',
    metadata: {
      categoryName: '儿童紧身衣',
      sourceAttributes: [{ name: '尺码', value: '01S、02S、03S、04S' }],
    },
    variants: [{ attrs: { 颜色: '白色', 尺码: '02S' }, stock: 2 }],
  });

  assert.equal(plan.templateKey, 'children_tights');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'children_tights');
  assert.ok(plan.sizeChart.tableColumns.includes('身高(cm)'));
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '02S' && row.ruSize === '02S' && row['年龄'] === '9个月'));
}

{
  const plan = planner.buildSourceRichContentPlan({
    title: '女士中筒袜袜子',
    metadata: {
      categoryName: '袜子',
      sourceAttributes: [{ name: '尺码', value: '35-39码、39-42码' }],
    },
    variants: [{ attrs: { 颜色: '白色', 尺码: '35-39码' }, stock: 2 }],
  });

  assert.equal(plan.templateKey, 'socks');
  assert.equal(plan.sizeChart.status, 'mapped');
  assert.equal(plan.sizeChart.mappingProfile, 'socks');
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '35-39' && row.ruSize === '35-39'));
  assert.ok(plan.sizeChart.tableRows.some((row) => row.size === '39-42' && row.ruSize === '39-42'));
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

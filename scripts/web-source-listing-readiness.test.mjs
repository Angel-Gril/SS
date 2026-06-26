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
const sourcePath = 'apps/web/src/lib/source-listing-readiness.ts';
const readiness = loadTsModule(sourcePath, {
  'shared/source-standard-attributes': standard,
});

function item(overrides = {}) {
  return {
    title: '女士无痕内衣',
    images: ['https://cdn.example.com/main.jpg'],
    variants: [
      { attrs: { 颜色: '黑色', 尺码: 'M' }, stock: 10 },
    ],
    metadata: {
      sourceTitleRaw: '女士无痕内衣',
      publishTitleRu: 'Бесшовный бюстгальтер',
      sourceDescriptionRu: 'Бесшовный бюстгальтер для ежедневной носки.',
      descriptionCategoryId: 17027458,
      typeId: 93456,
      sourceAttributes: [
        { name: '品牌', value: '其他' },
        { name: '主面料成分', value: '锦纶' },
        { name: '适用性别', value: '女' },
        { name: '适合季节', value: '四季' },
      ],
      weightG: 120,
      lengthMm: 300,
      widthMm: 200,
      heightMm: 30,
      sourceMainImages: ['https://cdn.example.com/main.jpg'],
      sourceDetailImages: ['https://cdn.example.com/detail.jpg'],
      watermarkedImages: ['https://cdn.example.com/watermarked.jpg'],
      editedImages: ['https://cdn.example.com/edited.jpg'],
      sourceRichDescriptionJson: { blocks: [{ type: 'text', text: 'ok' }] },
    },
    ...overrides,
  };
}

{
  const result = readiness.evaluateSourceListingReadiness(item());
  assert.equal(result.status, 'ready');
  assert.equal(result.blockers.length, 0);
  assert.equal(result.missingFields.includes('Ozon 类目/type'), false);
}

{
  const result = readiness.evaluateSourceListingReadiness(item({
    metadata: {
      ...item().metadata,
      descriptionCategoryId: undefined,
      typeId: undefined,
    },
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.blockers.includes('Ozon 类目/type'));
}

{
  const result = readiness.evaluateSourceListingReadiness(item({
    metadata: {
      ...item().metadata,
      publishTitleRu: '',
      sourceDescriptionRu: '',
      watermarkedImages: [],
      editedImages: [],
    },
  }));
  assert.equal(result.status, 'needs_review');
  assert.ok(result.missingFields.includes('俄文标题/描述'));
  assert.ok(result.warnings.includes('图片待水印/改图'));
}
{
  const result = readiness.evaluateSourceListingReadiness(item({
    metadata: {
      ...item().metadata,
      publishTitleRu: '',
      sourceDescriptionRu: '<img style="display: block; width: 100%; height: auto;" src="https://cbu01.alicdn.com/img/ibank/demo.jpg"><br c',
    },
  }));
  assert.equal(result.status, 'needs_review');
  assert.ok(result.missingFields.includes('俄文标题/描述'));
}

{
  const result = readiness.evaluateSourceListingReadiness(item({
    title: '仿大牌战术无人机配件',
    metadata: {
      ...item().metadata,
      sourceTitleRaw: '仿大牌战术无人机配件',
    },
  }));
  assert.equal(result.status, 'blocked');
  assert.ok(result.restrictionRisks.some((risk) => risk.includes('销售受限')));
}

{
  const base = item();
  const result = readiness.evaluateSourceListingReadiness(item({
    metadata: {
      ...base.metadata,
      weightG: 20,
      lengthMm: undefined,
      widthMm: undefined,
      heightMm: undefined,
    },
  }));
  assert.equal(result.status, 'blocked');
  assert.equal(result.missingFields.includes('重量尺寸'), false);
  assert.equal(result.missingFields.includes('重量'), false);
  assert.ok(result.missingFields.includes('包装尺寸'));
  assert.ok(result.blockers.includes('包装尺寸'));
}

console.log('PASS web source listing readiness');

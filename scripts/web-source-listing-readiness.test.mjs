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
const ozonSizeChartCatalog = loadTsModule('packages/shared/src/ozon-size-chart-template-catalog.ts');
const sizeChartCatalog = loadTsModule('packages/shared/src/source-size-chart-template-catalog.ts', {
  './ozon-size-chart-template-catalog': ozonSizeChartCatalog,
});
const richPlan = loadTsModule('packages/shared/src/source-rich-content-plan.ts', {
  './source-standard-attributes': standard,
  './ozon-size-chart-template-catalog': ozonSizeChartCatalog,
  './source-size-chart-template-catalog': sizeChartCatalog,
});
const sourcePath = 'apps/web/src/lib/source-listing-readiness.ts';
const readiness = loadTsModule(sourcePath, {
  'shared/source-standard-attributes': standard,
  'shared/source-rich-content-plan': richPlan,
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
  const diagnostics = readiness.evaluateSourceListingFieldDiagnostics(item());
  assert.deepEqual(
    JSON.parse(JSON.stringify(diagnostics.filter((row) => ['title', 'description', 'category', 'gender', 'originCountry', 'package'].includes(row.key)).map((row) => [row.key, row.status]))),
    [
      ['title', 'auto'],
      ['description', 'auto'],
      ['category', 'auto'],
      ['gender', 'auto'],
      ['originCountry', 'manual'],
      ['package', 'auto'],
    ],
  );
  const originCountry = diagnostics.find((row) => row.key === 'originCountry');
  assert.equal(originCountry?.value, '未确认');
  assert.match(originCountry?.evidence || '', /不能根据货源平台或卖家所在地推断/);
  assert.match(originCountry?.action || '', /人工确认原产国并选择官方字典值/);
  assert.ok(diagnostics.find((row) => row.key === 'package')?.evidence.includes('120g'));
}

{
  const diagnostics = readiness.evaluateSourceListingFieldDiagnostics(item({
    metadata: {
      ...item().metadata,
      sourceAttributes: [
        ...item().metadata.sourceAttributes,
        { name: '原产国', value: '中国' },
      ],
    },
  }));
  const originCountry = diagnostics.find((row) => row.key === 'originCountry');
  assert.equal(originCountry?.status, 'auto');
  assert.equal(originCountry?.confidence, 'strong');
  assert.equal(originCountry?.value, '中国');
  assert.match(originCountry?.action || '', /核对并匹配官方字典/);
}

{
  const result = readiness.evaluateSourceListingFieldDiagnostics(item({
    metadata: {
      ...item().metadata,
      weightG: undefined,
      lengthMm: undefined,
      widthMm: undefined,
      heightMm: undefined,
      extractionDiagnostics: {
        packaging: {
          status: 'partial',
          reasonLabel: '只采到重量，缺包装尺寸',
        },
      },
    },
  }));
  const packageRow = result.find((row) => row.key === 'package');
  assert.equal(packageRow?.status, 'blocked');
  assert.equal(packageRow?.confidence, 'missing');
  assert.match(packageRow?.action || '', /填写重量、长、宽、高/);
}

{
  const result = readiness.evaluateSourceListingFieldDiagnostics(item({
    metadata: {
      ...item().metadata,
      publishTitleRu: '',
      sourceDescriptionRu: '',
      aiContentDrafts: {
        title: { text: 'Женский топ на бретелях с кружевом' },
        description: {
          text: 'Женский топ с кружевной отделкой.',
          structured: { confidence: 0.62 },
        },
      },
    },
  }));
  assert.equal(result.find((row) => row.key === 'title')?.source, 'AI 草稿');
  assert.equal(result.find((row) => row.key === 'description')?.status, 'review');
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
    metadata: {
      ...item().metadata,
      publishTitleRu: '',
      sourceDescriptionRu: '',
      aiContentDrafts: {
        title: { text: 'Женские трусы с высокой посадкой, хлопок' },
        description: { text: 'Женские трусы для повседневной носки из мягкой ткани.' },
      },
    },
  }));
  assert.equal(result.missingFields.includes('俄文标题/描述'), false);
}

{
  const diagnostics = readiness.evaluateSourceListingFieldDiagnostics(item({
    metadata: {
      ...item().metadata,
      sourceTitleRaw: '女士睡裙',
      categoryName: '睡裙',
      categoryPath: ['服装', '睡裙'],
      sourceRichDescriptionJson: undefined,
      sourceRichContentDraft: {
        status: 'ai_generated_reviewable',
        blocks: [
          { type: 'text', text: 'Описание.' },
          { type: 'image', url: 'https://cdn.example.com/detail.jpg' },
        ],
      },
    },
  }));
  const richContentRow = diagnostics.find((row) => row.key === 'richContent');
  assert.match(richContentRow?.value || '', /内衣富内容模板|本地草稿 2 块/);
  assert.match(richContentRow?.evidence || '', /发布时会尝试转换并附加到 Ozon RichContentJson/);
  assert.doesNotMatch(richContentRow?.evidence || '', /发布前会转换为 Ozon RichContentJson$/);
}
{
  const diagnostics = readiness.evaluateSourceListingFieldDiagnostics(item({
    title: '女士睡裙',
    metadata: {
      ...item().metadata,
      sourceTitleRaw: '女士睡裙',
      categoryName: '睡裙',
      categoryPath: ['服装', '睡裙'],
      sourceRichDescriptionJson: undefined,
      sourceRichContentDraft: {
        status: 'ai_generated_reviewable',
        blocks: [{ type: 'text', text: 'Описание.' }],
      },
    },
  }));
  const richContentRow = diagnostics.find((row) => row.key === 'richContent');
  assert.match(richContentRow?.value || '', /睡衣\/睡裙富内容模板/);
  assert.match(richContentRow?.evidence || '', /尺码表：Ozon 官方尺码表/);
  assert.match(richContentRow?.action || '', /生成 Ozon JSON 尺码表/);
}

{
  const result = readiness.evaluateSourceListingReadiness(item({
    title: '【直播专供】红内裤女',
    metadata: {
      ...item().metadata,
      titleNeedsReview: true,
      publishTitleRu: 'Женские трусы из хлопка, высокая посадка',
      sourceDescriptionRu: 'Женские трусы для повседневной носки.',
    },
  }));
  assert.equal(result.blockers.includes('真实商品标题'), false);
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

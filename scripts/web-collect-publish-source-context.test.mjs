import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const source = fs.readFileSync('apps/web/src/lib/collect-publish-context.ts', 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

const sandbox = { exports: {}, module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(compiled, sandbox);

const {
  isOzonCollectedSource,
  shouldDefaultUseItemCategoryForPublish,
  shouldHideManualOzonCategoryControls,
  shouldRequireManualOzonCategory,
} = sandbox.exports;

const ozonSkuFollowItems = [
  { sourcePlatform: 'ozon', sourceUrl: 'https://www.ozon.ru/product/demo-123/' },
  { sourcePlatform: null, sourceUrl: 'https://ozon.kz/product/demo-456/' },
];

assert.equal(isOzonCollectedSource(ozonSkuFollowItems[0]), true);
assert.equal(shouldHideManualOzonCategoryControls(ozonSkuFollowItems), true);
assert.equal(shouldDefaultUseItemCategoryForPublish(ozonSkuFollowItems), true);
assert.equal(shouldRequireManualOzonCategory(ozonSkuFollowItems), false);

for (const item of [
  { sourcePlatform: '1688', sourceUrl: 'https://detail.1688.com/offer/1.html' },
  { sourcePlatform: 'pdd', sourceUrl: 'https://mobile.pinduoduo.com/goods.html' },
  { sourcePlatform: 'taobao', sourceUrl: 'https://item.taobao.com/item.htm?id=1' },
]) {
  assert.equal(isOzonCollectedSource(item), false);
  assert.equal(shouldHideManualOzonCategoryControls([item]), false);
  assert.equal(shouldDefaultUseItemCategoryForPublish([item]), false);
  assert.equal(shouldRequireManualOzonCategory([item]), true);
}

assert.equal(shouldHideManualOzonCategoryControls([ozonSkuFollowItems[0], { sourcePlatform: '1688' }]), false);

const collectPage = fs.readFileSync('apps/web/src/app/(dashboard)/collect/page.tsx', 'utf8');
assert.match(
  collectPage,
  /shouldHideManualOzonCategoryControls/,
  'SKU collect publish dialog should use source-aware visibility for manual Ozon category controls',
);
assert.match(
  collectPage,
  /hideManualOzonCategoryControls[\s\S]*OZON 类目目录/,
  'Ozon-source SKU follow publishing should hide the Ozon category catalog block',
);
assert.match(
  collectPage,
  /manualOzonCategoryRequired[\s\S]*请输入 OZON 分类 ID/,
  'Ozon-source SKU follow publishing should not require manual category/type inputs',
);
assert.match(
  collectPage,
  /const useSourceCategory = hideManualOzonCategoryControls \|\| publishUseItemCategory/,
  'right-side publish preview should also use per-item source category when Ozon manual category controls are hidden',
);
assert.match(
  collectPage,
  /handleApplyTitleSuggestionsAndPublish[\s\S]*disabled=\{publishSubmitDisabled\}/,
  'the title-suggestion publish button should share the source-aware submit disabled state',
);

console.log('PASS web collect publish source context');

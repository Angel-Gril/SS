import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const files = {
  popup: 'extensions/ss-erp/pages/popup.html',
  settings: 'extensions/ss-erp/pages/settings.css',
  provider: 'extensions/ss-erp/pages/ai-provider-settings.css',
  imageWorkbench: 'extensions/ss-erp/pages/ai-image-workbench.css',
  product: 'extensions/ss-erp/content/collect-content-script.js',
  list: 'extensions/ss-erp/content/ozon-list-overlay.js',
  calculator: 'extensions/ss-erp/content/ozon-panel.css',
  costing: 'extensions/ss-erp/content/source-costing-panel.css',
  importPage: 'extensions/ss-erp/pages/config-import.html',
};

const contents = Object.fromEntries(
  await Promise.all(Object.entries(files).map(async ([key, path]) => [key, await readFile(path, 'utf8')])),
);

// 2026-11-11 皮肤改为磨砂半透明 + 淡紫，取值的唯一 owner 是 shared/ui/tokens.css
// （见 dev-docs/extension-direction.md）。各界面必须使用同一个品牌紫，不得回到旧的青色主色。
const tokens = await readFile('extensions/ss-erp/shared/ui/tokens.css', 'utf8');
const brand = /--ss-brand:\s*(#[0-9a-f]{6});/i.exec(tokens)?.[1];
assert.equal(brand, '#6654f5', 'tokens.css owns the brand colour');
assert.match(tokens, /--ss-glass-blur:\s*blur\(/, 'tokens.css owns the frosted-glass blur');

for (const [name, source] of Object.entries(contents)) {
  assert.match(source, new RegExp(brand, 'i'), `${name} must use the shared brand purple from tokens.css`);
  assert.doesNotMatch(source, /#0f766e|#115e59|#134e4a/i, `${name} must not reintroduce the legacy teal primary`);
  assert.doesNotMatch(
    source,
    /#ea580c|#f97316|#9a3412|#c4511c|rgba\(234,\s*88,\s*12/i,
    `${name} must not reintroduce the legacy orange brand palette`,
  );
  assert.doesNotMatch(source, /letter-spacing:\s*-[0-9.]+px/i, `${name} must not use negative letter spacing`);
}

assert.doesNotMatch(contents.settings, /radial-gradient|linear-gradient/i, 'settings should use flat operational surfaces');
assert.doesNotMatch(contents.list, /headerGradient:\s*['"]linear-gradient/i, 'list workbench header should stay flat');
assert.doesNotMatch(contents.product, /headerGradient:\s*['"]linear-gradient/i, 'product workbench header should stay flat');
assert.match(contents.costing, /linear-gradient\(90deg/, 'costing loading shimmer remains a functional gradient');
assert.match(contents.imageWorkbench, /linear-gradient\(45deg/, 'image preview checkerboard remains a functional gradient');

// 悬浮面板与统一入口使用磨砂外壳；工作台先加载 tokens 再加载自己的样式
const workbenchHtml = await readFile('extensions/ss-erp/pages/precision-workbench.html', 'utf8');
assert.ok(workbenchHtml.indexOf('shared/ui/tokens.css') > 0
  && workbenchHtml.indexOf('shared/ui/tokens.css') < workbenchHtml.indexOf('donor/ui/panel.css'), 'workbench loads tokens first');
const workbenchCss = await readFile('extensions/ss-erp/pages/donor/ui/panel.css', 'utf8');
assert.match(workbenchCss, /--brand:\s*var\(--ss-brand,/, 'workbench brand comes from tokens');
assert.doesNotMatch(workbenchCss, /#0068ff|rgba\(0,\s*104,\s*255/i, 'workbench must not keep the old blue brand');
for (const name of ['calculator', 'costing']) {
  assert.match(contents[name], /backdrop-filter:\s*var\(--ss-glass-blur/, `${name} panel uses the frosted shell`);
}
const dockCss = await readFile('extensions/ss-erp/content/ss-dock.css', 'utf8');
assert.match(dockCss, /backdrop-filter:\s*var\(--ss-glass-blur/, 'dock uses the frosted shell');
assert.doesNotMatch(dockCss.replace(/var\([^()]*(\([^()]*\)[^()]*)*\)/g, ''), /#[0-9a-f]{3,8}/i, 'dock colours only come from tokens (hex allowed only as var() fallbacks)');

console.log('PASS unified extension UI theme contract');

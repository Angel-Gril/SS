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

for (const [name, source] of Object.entries(contents)) {
  assert.match(source, /#0f766e/i, `${name} must expose the shared teal primary`);
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

console.log('PASS unified extension UI theme contract');

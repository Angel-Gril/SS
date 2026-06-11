import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));
const serviceWorker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const popupHtml = fs.readFileSync('extensions/ss-erp/pages/popup.html', 'utf8');
const popupJs = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');

assert.match(
  serviceWorker,
  /shared\/source-search\/image-search-job\.js/,
  'service worker should import the image search job helper',
);
assert.match(
  serviceWorker,
  /SS_ERP_IMAGE_SEARCH_JOBS_KEY\s*=\s*['"]ss-erp:image-search-jobs['"]/,
  'service worker should use the SS ERP image search job storage key',
);
assert.match(
  serviceWorker,
  /ss-erp:image-search-create/,
  'service worker should expose an image search create message',
);

const contentScripts = Array.isArray(manifest.content_scripts) ? manifest.content_scripts : [];
const searchBridge = contentScripts.find((entry) => {
  const scripts = Array.isArray(entry.js) ? entry.js : [];
  return scripts.includes('content/source-search-1688.js');
});
assert.ok(searchBridge, 'manifest should register the 1688 image search content bridge');
assert.ok(
  searchBridge.matches.includes('https://s.1688.com/*')
    && searchBridge.matches.includes('https://*.1688.com/*'),
  '1688 image search bridge should run on 1688 search pages',
);

const resources = (manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || []);
assert.ok(
  resources.includes('content/source-search-1688-page.js'),
  '1688 page bridge should be web accessible for MAIN-world injection',
);

assert.match(
  popupHtml,
  /id=["']secondaryActionBtn["']/,
  'popup should expose one contextual secondary action slot',
);
assert.equal(
  (popupHtml.match(/secondaryActionBtn/g) || []).length,
  1,
  'popup should keep a single secondary action button instead of a source-platform button wall',
);
assert.match(
  popupJs,
  /search1688ByImage/,
  'popup should route the secondary action to 1688 image search on Ozon product pages',
);
assert.doesNotMatch(
  popupHtml,
  /去1688搜图|去拼多多搜图|去淘宝搜图|加入待生成/,
  'popup should not reintroduce the old multi-button source workflow',
);

console.log('PASS image search integration wiring');

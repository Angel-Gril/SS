import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));
const serviceWorker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const popupHtml = fs.readFileSync('extensions/ss-erp/pages/popup.html', 'utf8');
const popupJs = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');
const sourceCostingPanelJs = fs.readFileSync('extensions/ss-erp/content/source-costing-panel.js', 'utf8');

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
assert.match(
  serviceWorker,
  /enqueueImageSearchJob/,
  'service worker should serialize concurrent image search job creation',
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

const sourceCostingPanel = contentScripts.find((entry) => {
  const scripts = Array.isArray(entry.js) ? entry.js : [];
  return scripts.includes('content/source-costing-panel.js');
});
assert.ok(sourceCostingPanel, 'manifest should register the source costing panel');
assert.ok(
  sourceCostingPanel.matches.includes('https://detail.1688.com/*'),
  'source costing panel should run on 1688 detail pages',
);
assert.ok(
  sourceCostingPanel.matches.includes('https://*.pinduoduo.com/*')
    && sourceCostingPanel.matches.includes('https://*.yangkeduo.com/*'),
  'source costing panel should run on PDD source pages',
);
assert.ok(
  sourceCostingPanel.css.includes('content/source-costing-panel.css'),
  'source costing panel should include its CSS',
);
for (const script of [
  'shared/calculator-core/profit-engine.js',
  'shared/calculator-core/rule-engine.js',
  'shared/commission/commission-rates.js',
  'shared/currency/fx-rates.js',
]) {
  assert.ok(
    sourceCostingPanel.js.includes(script),
    `source costing panel should load ${script} on 1688 detail pages`,
  );
  assert.ok(
    sourceCostingPanel.js.indexOf(script) < sourceCostingPanel.js.indexOf('content/source-costing-panel.js'),
    `${script} should load before the 1688 costing panel`,
  );
}
assert.match(
  sourceCostingPanelJs,
  /spb-self-hosted:collect-current-tab/,
  'source costing panel should collect 1688 data through the existing background tab collector',
);
assert.match(
  sourceCostingPanelJs,
  /ozon-calculator:status/,
  'source costing panel should read the Ozon calculator snapshot before computing',
);
assert.match(
  sourceCostingPanelJs,
  /runCosting/,
  'source costing panel should run calculator logic directly on 1688 pages',
);
assert.match(
  sourceCostingPanelJs,
  /OZON_CALC_RULE_ENGINE\.buildServiceQuote/,
  'source costing panel should reuse the shared logistics rule engine',
);
assert.match(
  sourceCostingPanelJs,
  /OZON_CALC_PROFIT_ENGINE\.enrichQuote/,
  'source costing panel should reuse the shared profit engine',
);
assert.match(
  sourceCostingPanelJs,
  /重新核价/,
  'source costing panel primary action should be recalculating, not saving',
);
assert.match(
  sourceCostingPanelJs,
  /detectSourcePlatform/,
  'source costing panel should detect the current source platform',
);
assert.doesNotMatch(
  sourceCostingPanelJs,
  /\^https:\\\/\\\/detail\\\.1688\\\.com\\\//,
  'source costing panel should not be hard-gated to only 1688 detail pages',
);
assert.match(
  sourceCostingPanelJs,
  /PANEL_POSITION_KEY\s*=\s*['"]ss-erp:source-costing-panel-position['"]/,
  'source costing panel should persist its dragged position',
);
assert.match(
  sourceCostingPanelJs,
  /pointerdown/,
  'source costing panel header should start dragging with pointer events',
);
assert.match(
  sourceCostingPanelJs,
  /pointermove/,
  'source costing panel should move while dragged',
);
assert.match(
  sourceCostingPanelJs,
  /chrome\.storage\.local\.set/,
  'source costing panel should save dragged position in extension storage',
);
assert.match(
  sourceCostingPanelJs,
  /tryAutoCosting/,
  'source costing panel should automatically recompute when the selected source SKU changes',
);
assert.match(
  sourceCostingPanelJs,
  /openPanel/,
  'source costing panel should automatically expand when an Ozon source context is available',
);

const pddBridge = contentScripts.find((entry) => {
  const scripts = Array.isArray(entry.js) ? entry.js : [];
  return scripts.includes('content/source-search-pdd.js');
});
assert.ok(pddBridge, 'manifest should register the PDD image search content bridge');
assert.ok(
  pddBridge.matches.includes('https://pifa.pinduoduo.com/*'),
  'PDD image search bridge should run on pifa.pinduoduo.com',
);

const taobaoBridge = contentScripts.find((entry) => {
  const scripts = Array.isArray(entry.js) ? entry.js : [];
  return scripts.includes('content/source-search-taobao.js');
});
assert.ok(taobaoBridge, 'manifest should register the Taobao image search content bridge');
assert.ok(
  taobaoBridge.matches.includes('https://www.taobao.com/*')
    && taobaoBridge.matches.includes('https://s.taobao.com/*'),
  'Taobao image search bridge should run on Taobao search pages',
);

const resources = (manifest.web_accessible_resources || []).flatMap((entry) => entry.resources || []);
assert.ok(
  resources.includes('content/source-search-1688-page.js'),
  '1688 page bridge should be web accessible for MAIN-world injection',
);
assert.ok(
  resources.includes('content/source-search-pdd-page.js'),
  'PDD page bridge should be web accessible for MAIN-world injection',
);
assert.ok(
  resources.includes('content/source-search-taobao-page.js'),
  'Taobao page bridge should be web accessible for MAIN-world injection',
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
  /searchSourcesByImage/,
  'popup should route the secondary action to multi-platform image search on Ozon product pages',
);
assert.match(
  popupHtml,
  /id=["']sourceSearchPlatformPrefs["']/,
  'popup should expose compact source platform preferences for costing search',
);
assert.match(
  popupJs,
  /SOURCE_SEARCH_PLATFORM_PREFS_KEY\s*=\s*['"]ss-erp:source-search-platforms['"]/,
  'popup should persist source search platform preferences',
);
assert.match(
  popupJs,
  /loadSourceSearchPlatformPrefs/,
  'popup should load saved source search platform preferences',
);
assert.match(
  popupJs,
  /saveSourceSearchPlatformPrefs/,
  'popup should save source search platform preferences when changed',
);
assert.match(
  popupJs,
  /getSelectedSourceSearchPlatforms/,
  'popup should build search jobs from selected source platforms',
);
for (const platform of ['1688', 'pdd', 'taobao']) {
  assert.match(
    popupJs,
    new RegExp("platform:\\s*['\"]" + platform + "['\"]"),
    `popup should create an image search job for ${platform}`,
  );
}
assert.match(
  popupJs,
  /Promise\.all/,
  'popup should open multiple source image-search tabs from one action',
);
assert.doesNotMatch(
  popupHtml,
  /去1688搜图|去拼多多搜图|去淘宝搜图|加入待生成/,
  'popup should not reintroduce the old multi-button source workflow',
);

console.log('PASS image search integration wiring');

import assert from 'node:assert/strict';
import fs from 'node:fs';

const popupJs = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');
const serviceWorker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const ozonPanel = fs.readFileSync('extensions/ss-erp/content/ozon-panel.js', 'utf8');
const popupHtml = fs.readFileSync('extensions/ss-erp/pages/popup.html', 'utf8');
const sourceCostingPanel = fs.readFileSync('extensions/ss-erp/content/source-costing-panel.js', 'utf8');
const serviceWorkerSource = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');

assert.match(
  popupJs,
  /type:\s*['"]quoteSourcePage['"]/,
  'domestic source pages should expose a quote/costing action',
);
assert.match(
  popupJs,
  /type:\s*['"]ss-erp:source-quote-save['"]/,
  'source-page quote action should save a source quote through the service worker',
);
assert.match(
  popupJs,
  /buttonText:\s*['"]采集到 ERP['"]/,
  'source pages should still keep one compact ERP collect action',
);
assert.match(
  popupHtml,
  /id=["']exportSourceQuotesBtn["']/,
  'popup maintenance area should expose a source quote export action',
);
assert.match(
  popupJs,
  /type:\s*['"]ss-erp:source-quote-export['"]/,
  'popup should request source quote CSV export from the service worker',
);
assert.match(
  popupJs,
  /chrome\.downloads\.download/,
  'popup should download source quote export content through the downloads API',
);
assert.doesNotMatch(
  popupJs,
  /去1688搜图|去拼多多搜图|去淘宝搜图|加入待生成/,
  'source quote workflow must not reintroduce the old button wall',
);

assert.match(
  serviceWorker,
  /shared\/source-quotes\/source-quote-store\.js/,
  'service worker should import the source quote store',
);
assert.match(
  serviceWorker,
  /SS_ERP_SOURCE_QUOTES_KEY\s*=\s*['"]ss-erp:source-quotes['"]/,
  'service worker should persist source quote records',
);
assert.match(
  serviceWorker,
  /message\.type\s*===\s*['"]ss-erp:source-quote-save['"]/,
  'service worker should handle saving quote records',
);
assert.doesNotMatch(
  serviceWorkerSource,
  /await syncSourceCandidateQuote\(quote\)/,
  'saving a source quote should stay extension-local and not sync candidate quotes to ERP',
);
assert.match(
  serviceWorker,
  /ss-erp:source-quote-apply/,
  'service worker should notify the Ozon tab to apply a selected source quote',
);
assert.match(
  serviceWorker,
  /suppressOzonApply/,
  'service worker should allow 1688 page quotes to be saved without switching back to Ozon',
);
assert.match(
  serviceWorker,
  /message\.type\s*===\s*['"]ss-erp:source-quote-pending-clear['"]/,
  'service worker should allow the Ozon panel to clear an applied pending quote',
);

assert.match(
  ozonPanel,
  /ss-erp:source-quote-pending-get/,
  'Ozon panel should read pending source quotes when it renders',
);
assert.match(
  ozonPanel,
  /ss-erp:source-quote-pending-clear/,
  'Ozon panel should clear pending source quotes after applying them',
);
assert.match(
  ozonPanel,
  /ss-erp:source-quote-apply/,
  'Ozon panel should handle source quote apply messages',
);
assert.match(
  ozonPanel,
  /state\.inputs\.cost\s*=\s*quote\.costCny/,
  'Ozon panel should fill the purchase cost from the selected source quote',
);
assert.match(
  ozonPanel,
  /data-action="search-sources"/,
  'Ozon panel should expose an in-page source search action beside calculator actions',
);
assert.match(
  ozonPanel,
  /type:\s*['"]ss-erp:source-candidate-context-save['"]/,
  'Ozon panel source search should save the current Ozon product context before opening source sites',
);
assert.match(
  ozonPanel,
  /type:\s*['"]ss-erp:image-search-open-from-ozon['"]/,
  'Ozon panel source search should ask the background worker to open source image-search tabs without requiring the popup entry',
);
assert.match(
  ozonPanel,
  /costingInputPriceCny/,
  'Ozon panel source search should pass the calculator input CNY price into 1688-side costing context',
);
assert.match(
  serviceWorker,
  /message\.type\s*===\s*['"]ss-erp:image-search-open-from-ozon['"]/,
  'service worker should support opening source image-search tabs from the Ozon page panel',
);
assert.match(
  serviceWorker,
  /createImageSearchJob/,
  'service worker source search should reuse the shared image-search job helper',
);
assert.match(
  serviceWorker,
  /chrome\.tabs\.create/,
  'service worker source search should open source search tabs after creating jobs',
);
assert.doesNotMatch(
  sourceCostingPanel,
  /type:\s*['"]ss-erp:source-candidate-upsert['"]/,
  '1688 costing panel should not save source candidates from its main page workflow',
);
assert.doesNotMatch(
  sourceCostingPanel,
  /buildOzonQuoteContext\(\)/,
  '1688 costing panel should not keep dead Ozon candidate save plumbing',
);
assert.match(
  popupJs,
  /ozon:\s*ozon/,
  'Ozon source-search context should use the collected Ozon product snapshot',
);
assert.match(
  popupJs,
  /price:\s*\{\s*value:\s*product\.pagePriceValue/,
  'Ozon source-search context should persist the collected sale price for 1688-side costing',
);
assert.match(
  popupJs,
  /weightG:\s*product\.weightG/,
  'Ozon source-search context should persist the collected weight for 1688-side costing',
);
assert.match(
  sourceCostingPanel,
  /data-action="run-costing"/,
  '1688 costing panel should expose a primary in-page recalculation action',
);
assert.doesNotMatch(
  sourceCostingPanel,
  /class="primary" data-action="save-quote">保存核价/,
  'saving a quote must not remain the primary 1688 page action',
);
assert.doesNotMatch(
  sourceCostingPanel,
  /data-action="save-quote"[^>]*>保存货源候选/,
  '1688 costing panel should not expose source candidate saving as a main page action',
);

console.log('PASS source quote flow wiring');

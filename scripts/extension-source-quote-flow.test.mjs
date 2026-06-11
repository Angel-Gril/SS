import assert from 'node:assert/strict';
import fs from 'node:fs';

const popupJs = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');
const serviceWorker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const ozonPanel = fs.readFileSync('extensions/ss-erp/content/ozon-panel.js', 'utf8');

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
assert.match(
  serviceWorker,
  /ss-erp:source-quote-apply/,
  'service worker should notify the Ozon tab to apply a selected source quote',
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

console.log('PASS source quote flow wiring');

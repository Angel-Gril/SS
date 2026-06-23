import assert from 'node:assert/strict';
import fs from 'node:fs';

const popupJs = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');
const serviceWorker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const collectContentScript = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');

assert.match(
  popupJs,
  /type:\s*['"]ss-erp:collect-source-to-erp['"]/,
  'source-page collection should submit domestic source products to the ERP collect list',
);
assert.match(
  popupJs,
  /已进入 ERP 上品列表/,
  'popup should tell the user the source product entered the ERP listing workflow',
);
assert.match(
  serviceWorker,
  /message\.type\s*===\s*['"]ss-erp:collect-source-to-erp['"]/,
  'service worker should expose a source-to-ERP collect message',
);
assert.match(
  serviceWorker,
  /SS_ERP_CLIENT\.submitCollect\s*\(\s*\{\s*items:/,
  'service worker should post source products through the existing /api/collect batch path',
);
assert.match(
  serviceWorker,
  /pickSourceCollectTitle/,
  'source ERP collection should sanitize title candidates before building the payload',
);
assert.doesNotMatch(
  serviceWorker,
  /const title = firstText\(\[source\.title, source\.titleZh, source\.name, source\.tabTitle\]\)/,
  'source ERP collection must not blindly fall back to an Ozon tab title',
);
assert.doesNotMatch(
  popupJs,
  /baseStatus\s*\+\s*['"]，已加入候选货源/,
  'source-page primary action should not stop at the local candidate-store workflow',
);
assert.match(
  collectContentScript,
  /const hasCoreData = coreResult &&/,
  '1688 structured collector should guard core parser results before replacing fallback extraction',
);
assert.match(
  collectContentScript,
  /Array\.isArray\(coreResult\.skuItems\) && coreResult\.skuItems\.length > 0/,
  '1688 structured collector must not treat an empty sku array as useful core data',
);
assert.match(
  collectContentScript,
  /fromCore:\s*true/,
  '1688 structured collector should mark data returned by the shared core parser',
);
assert.match(
  collectContentScript,
  /!structured\.fromCore[\s\S]{0,160}infer1688SkuItemsFromText/,
  '1688 merge should not infer sku rows from full page text when shared core already extracted product data',
);

console.log('PASS source collect enters ERP workflow');

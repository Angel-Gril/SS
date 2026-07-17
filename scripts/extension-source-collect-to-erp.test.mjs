import assert from 'node:assert/strict';
import fs from 'node:fs';

const popupJs = fs.readFileSync('extensions/ss-erp/pages/popup.js', 'utf8');
const serviceWorker = fs.readFileSync('extensions/ss-erp/background/service-worker.js', 'utf8');
const collectContentScript = fs.readFileSync('extensions/ss-erp/content/collect-content-script.js', 'utf8');
const pageBridge = fs.readFileSync('extensions/ss-erp/content/page-bridge.js', 'utf8');
const manifest = JSON.parse(fs.readFileSync('extensions/ss-erp/manifest.json', 'utf8'));

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
  'service worker should retain the explicit legacy compatibility path',
);
assert.match(
  serviceWorker,
  /getSourceCaptureSubmitter\(\)/,
  'service worker should submit native V2 captures through the device-authenticated helper',
);
assert.match(
  serviceWorker,
  /nativeCaptureItems[\s\S]{0,1600}submitter\.submit\(sourceItem\.captureV2\)/,
  'service worker should prefer the native V2 capture over the legacy projection',
);
assert.match(
  serviceWorker,
  /outcome\.state === 'legacy_compatible'[\s\S]{0,350}submitted\.length/,
  'legacy fallback must be selected before any V2 capture in the batch is admitted',
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
  /networkCapture:\s*buildNetworkCaptureDiagnostic/,
  'source collection should persist a bounded network-capture diagnostic summary',
);
assert.match(
  collectContentScript,
  /applied:\s*false[\s\S]{0,120}trust:\s*'untrusted'[\s\S]{0,160}evidenceCount/,
  'network observations must remain untrusted and unapplied in persisted diagnostics',
);
assert.match(
  serviceWorker,
  /const item\s*=\s*\{\s*\.\.\.source,/,
  'legacy collect payload must preserve extractionDiagnostics, including networkCapture',
);
assert.match(
  collectContentScript,
  /!structured\.fromCore[\s\S]{0,160}infer1688SkuItemsFromText/,
  '1688 merge should not infer sku rows from full page text when shared core already extracted product data',
);
assert.match(
  collectContentScript,
  /collect1688DomPackagingRows/,
  '1688 source collection should scan visible DOM packaging tables instead of relying only on document.body text',
);
assert.match(
  collectContentScript,
  /domFallback\.packagingRows\s*=\s*domPackagingRows\.map[\s\S]{0,240}sourceType:\s*'dom'/,
  '1688 DOM packaging rows should enter the evidence-aware fallback bundle as DOM observations',
);
assert.doesNotMatch(
  collectContentScript,
  /cells\.length\s*>=\s*4/,
  '1688 DOM packaging scan must not skip real three-column tables such as color / size / weight(g)',
);
assert.match(
  collectContentScript,
  /cells\.length\s*>=\s*1/,
  '1688 DOM packaging scan should keep single-column weight-only tables',
);
assert.match(
  collectContentScript,
  /const hasSkuIdentity = \/\(颜色\|色号\|color\)/,
  '1688 DOM packaging header detection should look for color in weight-only SKU tables',
);
assert.match(
  collectContentScript,
  /\(尺码\|规格\|尺寸\|size\|spec\)/,
  '1688 DOM packaging header detection should look for size/spec in weight-only SKU tables',
);
assert.match(
  collectContentScript,
  /return \/\(重量\|weight\)\/i\.test\(text\) && \(hasDimensions \|\| hasSkuIdentity \|\| cells\.length === 1\)/,
  '1688 DOM packaging header detection should accept color / size / single-column weight-only tables',
);
assert.match(
  pageBridge,
  /["']context["']/,
  '1688 page bridge should expose window.context so productPackInfo packaging data reaches the collector',
);
assert.doesNotMatch(
  pageBridge,
  /grantToken|accessToken|refreshToken|Authorization/,
  'MAIN-world evidence must not carry credentials or command grants',
);

const collectorScripts = manifest.content_scripts.find((entry) => (
  Array.isArray(entry.js) && entry.js.includes('content/collect-content-script.js')
)).js;
assert.ok(
  collectorScripts.indexOf('shared/contracts/source-product-capture-v2.js')
    < collectorScripts.indexOf('shared/collectors/source-product-core.js'),
  'generated Capture V2 validator must load before the source collector',
);

console.log('PASS source collect enters ERP workflow');

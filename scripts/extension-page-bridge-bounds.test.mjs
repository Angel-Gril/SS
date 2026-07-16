import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const PAGE_BRIDGE_PATH = 'extensions/ss-erp/content/page-bridge.js';
const pageBridgeScript = fs.readFileSync(PAGE_BRIDGE_PATH, 'utf8');

function inlineScript(text, src = '') {
  return {
    textContent: text,
    getAttribute(name) {
      return name === 'src' ? src : '';
    },
  };
}

async function readPayload({ globals = {}, scripts = [], url = 'https://detail.1688.com/offer/733344455566.html' } = {}) {
  const listeners = new Map();
  let resolveResponse;
  const response = new Promise((resolve) => {
    resolveResponse = resolve;
  });
  const locationUrl = new URL(url);
  const document = {
    cookie: '',
    querySelectorAll(selector) {
      return selector === 'script:not([src])' ? scripts : [];
    },
  };
  const window = {
    ...globals,
    document,
    location: {
      href: locationUrl.href,
      host: locationUrl.host,
      hostname: locationUrl.hostname,
      pathname: locationUrl.pathname,
      search: locationUrl.search,
      origin: locationUrl.origin,
    },
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    postMessage(message) {
      if (message?.direction === 'spb-self-hosted:bridge') resolveResponse(message);
    },
  };
  window.window = window;

  const sandbox = {
    URL,
    URLSearchParams,
    TextEncoder,
    clearTimeout,
    console,
    document,
    encodeURIComponent,
    fetch: async () => { throw new Error('unexpected fetch'); },
    location: window.location,
    setTimeout,
    structuredClone,
    unescape,
    window,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(pageBridgeScript, sandbox, { filename: PAGE_BRIDGE_PATH });

  const onMessage = listeners.get('message');
  assert.equal(typeof onMessage, 'function');
  await onMessage({
    source: window,
    data: {
      direction: 'spb-self-hosted:content',
      requestId: 'page-bridge-test',
      type: 'GET_PAGE_STATE',
    },
  });
  const message = await response;
  assert.equal(message.ok, true, message.error);
  return message.payload;
}

function assertLegalTruncation(row) {
  assert.equal(row.stage, 'page_bridge');
  assert.equal(typeof row.fieldPath, 'string');
  assert.ok(row.fieldPath.startsWith('/'));
  assert.ok(Number.isInteger(row.observedCount) && row.observedCount >= 0);
  assert.ok(Number.isInteger(row.retainedCount) && row.retainedCount >= 0);
  assert.ok(Number.isInteger(row.limit) && row.limit >= 0);
  assert.ok(['items', 'utf8_bytes', 'characters', 'depth'].includes(row.unit));
  assert.ok(['source_limit', 'candidate_limit', 'size_limit', 'transport_limit', 'timeout', 'parse_failure', 'unsupported_shape', 'legacy_projection_limit', 'ui_preview_limit'].includes(row.reason));
  assert.ok(['same_page_fallback', 'reload_page', 'chunked_resubmit', 'server_refetch', 'manual_recapture', 'not_recoverable'].includes(row.recoverability));
  assert.ok(row.fallbackSourcePath === null || typeof row.fallbackSourcePath === 'string');
}

test('known globals enforce the 500000 UTF-8 byte per-value limit', async () => {
  const belowLimit = { text: 'a'.repeat(499_900) };
  const overUtf8Limit = { text: '\u6c49'.repeat(170_000) };
  const payload = await readPayload({
    url: 'https://item.taobao.com/item.htm?id=733344455566',
    globals: {
      rawData: belowLimit,
      __NEXT_DATA__: overUtf8Limit,
    },
  });

  assert.equal(payload.knownGlobals.rawData.text.length, belowLimit.text.length);
  assert.equal(Object.hasOwn(payload.knownGlobals, '__NEXT_DATA__'), false);
  const truncation = payload.truncations.find((row) => row.fieldPath === '/pageState/knownGlobals/__NEXT_DATA__');
  assert.ok(truncation);
  assert.equal(truncation.limit, 500_000);
  assert.equal(truncation.unit, 'utf8_bytes');
  assert.equal(truncation.reason, 'size_limit');
  assertLegalTruncation(truncation);
});

test('known globals enforce an aggregate byte limit and omit the value that crosses it', async () => {
  const payload = await readPayload({
    url: 'https://item.taobao.com/item.htm?id=733344455566',
    globals: {
      rawData: { text: 'a'.repeat(450_000) },
      __NEXT_DATA__: { text: 'b'.repeat(450_000) },
      __INITIAL_STATE__: { text: 'c'.repeat(450_000) },
      __INIT_DATA__: { text: 'd'.repeat(450_000) },
      __NUXT__: { text: 'e'.repeat(450_000) },
    },
  });

  assert.equal(Object.hasOwn(payload.knownGlobals, 'rawData'), true);
  assert.equal(Object.hasOwn(payload.knownGlobals, '__INIT_DATA__'), true);
  assert.equal(Object.hasOwn(payload.knownGlobals, '__NUXT__'), false);
  assert.ok(Buffer.byteLength(JSON.stringify(payload.knownGlobals), 'utf8') <= 2_000_000);
  const truncation = payload.truncations.find((row) => (
    row.fieldPath === '/pageState/knownGlobals'
      && row.fallbackSourcePath === '/pageState/knownGlobals/__NUXT__'
  ));
  assert.ok(truncation);
  assert.equal(truncation.limit, 2_000_000);
  assert.equal(truncation.reason, 'size_limit');
  assertLegalTruncation(truncation);
});

test('1688 known globals retain only evidence bound to the current offer', async () => {
  const currentOffer = '733344455566';
  const payload = await readPayload({
    globals: {
      recommendationOffer: {
        offerId: '999999999999',
        subject: 'wrong recommendation title',
        skuModel: { skuInfoMap: { wrong: { skuId: 'wrong-sku' } } },
      },
      currentOffer: {
        offerId: currentOffer,
        subject: 'current offer title',
        skuModel: { skuInfoMap: { current: { skuId: 'current-sku', stock: 0 } } },
      },
      mixedOfferData: {
        recommendations: [{ offerId: '888888888888', subject: 'wrong nested title' }],
        detail: {
          offerId: currentOffer,
          subject: 'current nested title',
          skuModel: { skuInfoMap: { nested: { skuId: 'nested-current-sku' } } },
        },
      },
      skuModel: { skuInfoMap: { unbound: { skuId: 'ambiguous-unbound-sku' } } },
    },
  });

  const serialized = JSON.stringify(payload.knownGlobals);
  assert.match(serialized, /current-sku/);
  assert.match(serialized, /nested-current-sku/);
  assert.doesNotMatch(serialized, /wrong-sku|wrong recommendation title|wrong nested title|ambiguous-unbound-sku/);
});

test('targeted inline extraction keeps only current-offer evidence from inline scripts', async () => {
  const currentOffer = '733344455566';
  const payload = await readPayload({
    scripts: [
      inlineScript(`window.offer = {"offerId":"${currentOffer}","skuModel":{"skuProps":[{"prop":"\u989c\u8272","value":[{"name":"\u9ed1\u8272"}]}],"skuInfoMap":{"\u9ed1\u8272":{"skuId":"sku-current","price":"12.8","stock":0}}},"categoryPath":"\u670d\u9970 > \u7537\u88c5 > \u4f11\u95f2\u88e4","leafCategoryId":1038375,"videoUrl":"https:\\/\\/video.example.com\\/current.mp4"};`),
      inlineScript('window.offer = {"offerId":"999999999999","skuModel":{"skuProps":[],"skuInfoMap":{"wrong":{"skuId":"wrong"}}},"categoryPath":"wrong > category","categoryId":999,"videoUrl":"https://video.example.com/wrong.mp4"};'),
      inlineScript(`window.externalOnly = {"offerId":"${currentOffer}","categoryId":444};`, 'https://cdn.example.com/external.js'),
      inlineScript('window.unbound = {"categoryId":555,"videoUrl":"https://video.example.com/unbound.mp4"};'),
    ],
  });

  assert.equal(Array.isArray(payload.targetedInlineEvidenceSources), true);
  assert.equal(payload.targetedInlineEvidenceSources.length, 1);
  const source = payload.targetedInlineEvidenceSources[0];
  assert.equal(source.sourceType, 'script');
  assert.equal(source.sourcePath, '/document/inlineScripts/0');
  assert.equal(source.offerId, currentOffer);
  assert.equal(source.skuModel.skuInfoMap['\u9ed1\u8272'].stock, 0);
  assert.equal(source.categoryPath, '\u670d\u9970 > \u7537\u88c5 > \u4f11\u95f2\u88e4');
  assert.equal(source.categoryId, '1038375');
  assert.deepEqual(JSON.parse(JSON.stringify(source.videoUrls)), ['https://video.example.com/current.mp4']);
  assert.equal(JSON.stringify(payload.targetedInlineEvidenceSources).includes('wrong'), false);
  assert.equal(JSON.stringify(payload.targetedInlineEvidenceSources).includes('unbound'), false);
  assert.notEqual(source.categoryId, '444');
});

test('targeted inline extraction scopes evidence to the current offer object within a shared script', async () => {
  const currentOffer = '733344455566';
  const payload = await readPayload({
    scripts: [inlineScript([
      'window.recommendation = {"offerId":"999999999999","skuModel":{"skuProps":[],"skuInfoMap":{"wrong":{"skuId":"wrong"}}},"categoryPath":"wrong > category","categoryId":999,"videoUrl":"https://video.example.com/wrong.mp4"};',
      `window.currentOffer = {"offerId":"${currentOffer}","skuModel":{"skuProps":[],"skuInfoMap":{"current":{"skuId":"current","price":"18.8","stock":0}}},"categoryPath":"\u670d\u9970 > \u7537\u88c5","categoryId":1038375,"videoUrl":"https://video.example.com/current.mp4"};`,
    ].join('\n'))],
  });

  assert.equal(payload.targetedInlineEvidenceSources.length, 1);
  const source = payload.targetedInlineEvidenceSources[0];
  assert.equal(source.skuModel.skuInfoMap.current.stock, 0);
  assert.equal(Object.hasOwn(source.skuModel.skuInfoMap, 'wrong'), false);
  assert.equal(source.categoryPath, '\u670d\u9970 > \u7537\u88c5');
  assert.equal(source.categoryId, '1038375');
  assert.deepEqual(JSON.parse(JSON.stringify(source.videoUrls)), ['https://video.example.com/current.mp4']);
});

test('targeted inline extraction rejects nested foreign evidence that precedes current-offer fields', async () => {
  const currentOffer = '733344455566';
  const payload = await readPayload({
    scripts: [inlineScript(`window.offer = {
      "recommendations": [{
        "offerId": "999999999999",
        "skuModel": {"skuProps": [], "skuInfoMap": {"wrong": {"skuId": "wrong", "stock": 99}}},
        "categoryPath": "wrong > category",
        "categoryId": 999,
        "videoUrl": "https://video.example.com/wrong.mp4"
      }],
      "offerId": "${currentOffer}",
      "skuModel": {"skuProps": [], "skuInfoMap": {"current": {"skuId": "current", "price": "18.8", "stock": 0}}},
      "categoryPath": "\u670d\u9970 > \u7537\u88c5",
      "categoryId": 1038375,
      "videoUrl": "https://video.example.com/current.mp4"
    };`)],
  });

  assert.equal(payload.targetedInlineEvidenceSources.length, 1);
  const source = payload.targetedInlineEvidenceSources[0];
  assert.equal(source.skuModel.skuInfoMap.current.stock, 0);
  assert.equal(Object.hasOwn(source.skuModel.skuInfoMap, 'wrong'), false);
  assert.equal(source.categoryPath, '\u670d\u9970 > \u7537\u88c5');
  assert.equal(source.categoryId, '1038375');
  assert.deepEqual(JSON.parse(JSON.stringify(source.videoUrls)), ['https://video.example.com/current.mp4']);
});

test('targeted inline video candidates retain 50 URLs and emit a legal truncation', async () => {
  const currentOffer = '733344455566';
  const videoUrls = Array.from(
    { length: 55 },
    (_value, index) => `https://video.example.com/current-${index}.mp4`
  );
  const payload = await readPayload({
    scripts: [inlineScript(`window.offer = ${JSON.stringify({
      offerId: currentOffer,
      categoryId: 1038375,
      videoUrls,
    })};`)],
  });

  assert.equal(payload.targetedInlineEvidenceSources.length, 1);
  const retained = JSON.parse(JSON.stringify(payload.targetedInlineEvidenceSources[0].videoUrls));
  assert.equal(retained.length, 50);
  assert.equal(retained[0], 'https://video.example.com/current-0.mp4');
  assert.equal(retained[49], 'https://video.example.com/current-49.mp4');
  assert.equal(retained.includes('https://video.example.com/current-50.mp4'), false);

  const truncation = payload.truncations.find((row) => (
    row.fieldPath === '/pageState/targetedInlineEvidenceSources/scripts/0/videoUrls'
  ));
  assert.ok(truncation, 'inline video candidate limit should be recorded');
  assert.equal(truncation.observedCount, 51);
  assert.equal(truncation.retainedCount, 50);
  assert.equal(truncation.limit, 50);
  assert.equal(truncation.unit, 'items');
  assert.equal(truncation.reason, 'candidate_limit');
  assertLegalTruncation(truncation);
});

test('targeted inline script count, script byte, and result limits emit legal truncations', async () => {
  const offerId = '733344455566';
  const scripts = [];
  scripts.push(inlineScript(`window.large = {"offerId":"${offerId}","categoryId":777,"padding":"${'\u6c49'.repeat(170_000)}"};`));
  for (let index = 0; index < 70; index += 1) {
    scripts.push(inlineScript(`window.offer${index} = {"offerId":"${offerId}","categoryPath":"\u7c7b\u76ee > ${index}","categoryId":${1000 + index}};`));
  }
  const payload = await readPayload({ scripts });

  assert.ok(payload.targetedInlineEvidenceSources.length > 0);
  assert.ok(payload.targetedInlineEvidenceSources.length <= 12);
  const countLimit = payload.truncations.find((row) => row.fieldPath === '/pageState/targetedInlineEvidenceSources/candidateScripts');
  const byteLimit = payload.truncations.find((row) => row.fieldPath === '/pageState/targetedInlineEvidenceSources/scripts/0');
  const resultLimit = payload.truncations.find((row) => row.fieldPath === '/pageState/targetedInlineEvidenceSources');
  assert.ok(countLimit, 'script count limit should be recorded');
  assert.ok(byteLimit, 'per-script byte limit should be recorded');
  assert.ok(resultLimit, 'result count limit should be recorded');
  assert.equal(countLimit.reason, 'candidate_limit');
  assert.equal(byteLimit.reason, 'size_limit');
  assert.equal(resultLimit.reason, 'candidate_limit');
  [countLimit, byteLimit, resultLimit].forEach(assertLegalTruncation);
});

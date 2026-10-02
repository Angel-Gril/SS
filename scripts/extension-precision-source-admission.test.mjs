import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const modulePath = 'extensions/ss-erp/shared/byok/precision-source-admission.js';
const context = { Array, Boolean, Date, Error, Map, Math, Number, Object, Promise, Set, String, URL, clearTimeout, setTimeout };
context.globalThis = context;
vm.runInNewContext(readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
const api = context.SS_ERP_PRECISION_SOURCE_ADMISSION;
const productUrl = 'https://detail.1688.com/offer/845581683597.html';
const platformUrls = new Map([
  [productUrl, { sourcePlatform: '1688', sourceProductId: '845581683597' }],
  ['https://item.taobao.com/item.htm?id=123', { sourcePlatform: 'taobao', sourceProductId: '123' }],
  ['https://detail.tmall.com/item.htm?id=456', { sourcePlatform: 'tmall', sourceProductId: '456' }],
  ['https://mobile.yangkeduo.com/goods.html?goods_id=789', { sourcePlatform: 'pdd', sourceProductId: '789' }],
]);
const frame = { tabId: 8, frameId: 7, documentId: 'actual-iframe-document',
  url: 'chrome-extension://extension-id/pages/precision-workbench.html', origin: 'chrome-extension://extension-id' };
const sourceSender = { id: 'extension-id', frameId: 0, documentId: 'actual-source-document',
  url: productUrl, origin: 'https://detail.1688.com', tab: { id: 8, url: productUrl } };
function plain(value) { return JSON.parse(JSON.stringify(value)); }
async function flush() { for (let count = 0; count < 24; count += 1) await Promise.resolve(); }
function harness(overrides = {}) {
  let currentTime = 1000;
  let nonceIndex = 0;
  let timerIndex = 0;
  const timers = new Map();
  const sent = [];
  const state = { tab: { id: 8, url: productUrl, status: 'complete' }, device: {
    state: 'paired', ownerUserId: 'real-owner', sessionId: 'real-device-session', scopes: ['listing:review'],
    expiresAt: new Date(60_000).toISOString(), deviceToken: 'secret-sentinel-never-forward',
  } };
  const admission = api.create({
    getTab: async () => state.tab,
    sendToSourcePage: async (...args) => { sent.push(args); return { ok: true }; },
    readDevice: async () => state.device,
    resolveProductUrl: (url) => platformUrls.get(url) || null,
    randomNonce: () => (++nonceIndex).toString(16).padStart(64, '0'), now: () => currentTime,
    setTimeout: (callback, delay) => { const id = ++timerIndex; timers.set(id, { callback, deadline: currentTime + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    ...overrides,
  });
  return { admission, sent, state, timers,
    advance(amount) { currentTime += amount; for (const [id, timer] of [...timers]) if (timer.deadline <= currentTime) { timers.delete(id); timer.callback(); } },
    message(index = 0) { return { type: 'ss-erp:precision-source-attestation', nonce: sent[index][1].nonce }; },
  };
}

{
  const selected = harness();
  const resolved = selected.admission.resolveSource(frame);
  await flush();
  assert.equal(selected.sent.length, 1);
  assert.deepEqual(plain(selected.sent[0]), [8, {
    type: 'ss-erp:precision-source-attest', nonce: '1'.padStart(64, '0'),
    sourcePlatform: '1688', sourceProductId: '845581683597',
  }, { frameId: 0 }]);
  let settled = false;
  resolved.then(() => { settled = true; });
  await flush();
  assert.equal(settled, false, 'send response alone must not admit a source');
  assert.equal(await selected.admission.acceptAttestation(selected.message(), sourceSender), true);
  assert.deepEqual(plain(await resolved), { tabId: 8, documentId: 'actual-source-document',
    sourcePlatform: '1688', sourceProductId: '845581683597', ownerUserId: 'real-owner', deviceSessionId: 'real-device-session' });
  assert.equal(selected.timers.size, 0);
  assert.equal(await selected.admission.acceptAttestation(selected.message(), sourceSender), false);
  assert.doesNotMatch(JSON.stringify(selected.sent), /real-owner|real-device-session|secret-sentinel/u);
}
for (const [url, source] of platformUrls) {
  const selected = harness(); selected.state.tab.url = url;
  const request = selected.admission.resolveSource(frame);
  await flush();
  const sender = { ...sourceSender, url, origin: new URL(url).origin, tab: { id: 8, url } };
  assert.equal(await selected.admission.acceptAttestation(selected.message(), sender), true);
  assert.deepEqual(plain(await request), { tabId: 8, documentId: sourceSender.documentId,
    ...source, ownerUserId: 'real-owner', deviceSessionId: 'real-device-session' });
}
for (const invalid of [
  { ...frame, frameId: 0 }, { ...frame, tabId: -1 }, { ...frame, documentId: '' },
  { ...frame, origin: 'https://detail.1688.com' }, { ...frame, ownerUserId: 'forged-owner' },
]) {
  const selected = harness();
  await assert.rejects(selected.admission.resolveSource(invalid));
  assert.equal(selected.sent.length, 0);
}
for (const mutate of [
  (state) => { state.tab.url = 'http://detail.1688.com/offer/845581683597.html'; },
  (state) => { state.tab.url = 'https://detail.1688.com.evil.test/offer/845581683597.html'; },
  (state) => { state.tab.url = productUrl + '#fragment'; },
  (state) => { state.tab.id = 9; },
  (state) => { state.device.state = 'unpaired'; },
  (state) => { state.device.scopes = ['media:execute']; },
  (state) => { state.device.ownerUserId = ''; },
  (state) => { state.device.expiresAt = new Date(500).toISOString(); },
]) {
  const selected = harness(); mutate(selected.state);
  await assert.rejects(selected.admission.resolveSource(frame));
  assert.equal(selected.sent.length, 0);
  assert.equal(selected.timers.size, 0);
}
{
  const selected = harness();
  const request = selected.admission.resolveSource(frame); await flush();
  for (const invalidSender of [
    { ...sourceSender, id: 'another-runtime' }, { ...sourceSender, frameId: 7 },
    { ...sourceSender, tab: { id: 9, url: productUrl } }, { ...sourceSender, documentId: '' },
    { ...sourceSender, origin: 'https://evil.test' },
    { ...sourceSender, url: 'http://detail.1688.com/offer/845581683597.html' },
    { ...sourceSender, tab: { id: 8, url: 'https://evil.test/offer/845581683597.html' } },
  ]) assert.equal(await selected.admission.acceptAttestation(selected.message(), invalidSender), false);
  assert.equal(await selected.admission.acceptAttestation({ ...selected.message(), ownerUserId: 'forged' }, sourceSender), false);
  assert.equal(await selected.admission.acceptAttestation({ ...selected.message(), documentId: 'forged' }, sourceSender), false);
  assert.equal(await selected.admission.acceptAttestation({ ...selected.message(), nonce: 'f'.repeat(64) }, sourceSender), false);
  assert.equal(await selected.admission.acceptAttestation(selected.message(), sourceSender), true);
  await request;
}
{
  const selected = harness();
  const request = selected.admission.resolveSource(frame);
  const rejection = assert.rejects(request, { code: 'SS_ERP_PRECISION_SOURCE_ATTESTATION_EXPIRED' });
  await flush(); selected.advance(api.ATTESTATION_TTL_MS);
  await rejection;
  assert.equal(await selected.admission.acceptAttestation(selected.message(), sourceSender), false);
}
for (const mutate of [
  (state) => { state.tab.url = 'https://item.taobao.com/item.htm?id=123'; },
  (state) => { state.device.sessionId = 'rotated-session'; },
  (state) => { state.device.ownerUserId = 'another-owner'; },
  (state) => { state.device.scopes = []; },
  (state) => { state.device.state = 'unpaired'; },
]) {
  const selected = harness();
  const request = selected.admission.resolveSource(frame);
  const rejected = assert.rejects(request);
  await flush(); mutate(selected.state);
  assert.equal(await selected.admission.acceptAttestation(selected.message(), sourceSender), false);
  await rejected;
}
for (const method of ['invalidateTab', 'clear']) {
  const selected = harness(); const request = selected.admission.resolveSource(frame);
  const rejected = assert.rejects(request, { code: 'SS_ERP_PRECISION_SOURCE_INVALIDATED' });
  await flush(); selected.admission[method](8); await rejected;
  assert.equal(selected.timers.size, 0);
  assert.equal(await selected.admission.acceptAttestation(selected.message(), sourceSender), false);
}
{
  const selected = harness({ sendToSourcePage: async () => { throw new Error('transport private detail'); } });
  await assert.rejects(selected.admission.resolveSource(frame), { code: 'SS_ERP_PRECISION_SOURCE_ATTESTATION_TRANSPORT_FAILED' });
  assert.equal(selected.timers.size, 0);
}
{
  const selected = harness(); const requests = [];
  for (let index = 0; index < api.MAX_PENDING; index += 1) requests.push(selected.admission.resolveSource(frame));
  const rejections = requests.map((request) => assert.rejects(request, { code: 'SS_ERP_PRECISION_SOURCE_INVALIDATED' }));
  await assert.rejects(selected.admission.resolveSource(frame), { code: 'SS_ERP_PRECISION_SOURCE_CAPACITY_EXHAUSTED' });
  await flush(); assert.equal(selected.sent.length, api.MAX_PENDING);
  selected.admission.clear(); await Promise.all(rejections);
}
{
  const selected = harness({ randomNonce: () => 'f'.repeat(64) });
  const first = selected.admission.resolveSource(frame); await flush();
  await assert.rejects(selected.admission.resolveSource(frame), { code: 'SS_ERP_PRECISION_SOURCE_NONCE_INVALID' });
  assert.equal(await selected.admission.acceptAttestation(selected.message(), sourceSender), true); await first;
}
{
  const selected = harness(); const request = selected.admission.resolveSource(frame); await flush();
  const accepted = await Promise.all([
    selected.admission.acceptAttestation(selected.message(), sourceSender),
    selected.admission.acceptAttestation(selected.message(), sourceSender),
  ]);
  assert.deepEqual(accepted, [true, false]); await request;
}
{
  let releaseTab;
  const tab = new Promise((resolve) => { releaseTab = resolve; });
  const selected = harness({ getTab: () => tab });
  const request = selected.admission.resolveSource(frame);
  const rejected = assert.rejects(request, { code: 'SS_ERP_PRECISION_SOURCE_ATTESTATION_EXPIRED' });
  selected.advance(api.ATTESTATION_TTL_MS); await rejected;
  releaseTab(selected.state.tab); await flush();
  assert.equal(selected.sent.length, 0, 'timed out preparation must never issue a later challenge');
}
{
  const selected = harness({ readDevice: async () => {
    throw Object.assign(new Error('secret-sentinel'), { code: 'SS_ERP_PRECISION_SOURCE_secret-sentinel' });
  } });
  await assert.rejects(selected.admission.resolveSource(frame), { code: 'SS_ERP_PRECISION_SOURCE_UNAVAILABLE' });
}
console.log('extension precision source admission tests passed');

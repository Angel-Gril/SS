import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = 'extensions/ss-erp';
const htmlPath = `${root}/pages/ai-image-workbench.html`;
const launchPath = `${root}/pages/ai-image-workbench-launch.html`;
const cssPath = `${root}/pages/ai-image-workbench.css`;
const pagePath = `${root}/pages/ai-image-workbench.js`;

for (const path of [htmlPath, launchPath, cssPath, pagePath]) {
  assert.equal(fs.existsSync(path), true, `${path} should exist`);
}

const html = fs.readFileSync(htmlPath, 'utf8');
const launchHtml = fs.readFileSync(launchPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');
const pageSource = fs.readFileSync(pagePath, 'utf8');
const verifierSource = fs.readFileSync('scripts/verify-extension-package.mjs', 'utf8');
const preflightSource = fs.readFileSync('scripts/preflight.mjs', 'utf8');

assert.match(html, /ai-image-workbench\.css/u);
assert.match(html, /shared\/byok\/workbench-client\.js/u);
assert.match(html, /ai-image-workbench\.js/u);
assert.match(html, /id=["']executionModeByok["'][^>]*checked/u);
assert.match(html, /id=["']executionModeHosted["'][^>]*disabled/u);
assert.match(html, /id=["']profileSelect["']/u);
assert.match(html, /id=["']promptInput["'][^>]*maxlength=["']8000["']/u);
assert.match(html, /id=["']negativePromptInput["'][^>]*maxlength=["']4000["']/u);
assert.match(html, /id=["']generateButton["']/u);
assert.match(html, /id=["']rejectButton["']/u);
assert.match(html, /id=["']approveButton["']/u);
assert.match(html, /href=["']\.\/ai-provider-settings\.html["'][^>]*target=["']_blank["']/u);
assert.match(html, /id=["']contextKicker["']/u);
assert.match(html, /id=["']contextBadge["']/u);
assert.match(html, /已批准但尚未上传 ERP/u);
assert.doesNotMatch(html, /api[_ -]?key|remember key|记住密钥/iu);
assert.doesNotMatch(html, /<script[^>]*>\s*[^<]/iu, 'workbench page must not use inline scripts');
assert.doesNotMatch(html, /https?:\/\//iu, 'workbench page must not load remote assets');
assert.doesNotMatch(launchHtml, /<script|product-|workflow-|api[_ -]?key/iu);
assert.match(css, /@media\s*\(max-width:\s*720px\)/u);
assert.match(css, /prefers-reduced-motion/u);
assert.doesNotMatch(pageSource, /innerHTML|localStorage|storage\.local|storage\.sync|apiKey/u);
assert.match(pageSource, /event\.isTrusted\s*!==\s*true/u);
assert.match(pageSource, /preview\.revoke\(\)/u);
assert.match(verifierSource, /pages\/ai-image-workbench\.html/u);
assert.match(verifierSource, /shared\/byok\/workbench-runtime-handler\.js/u);
assert.match(preflightSource, /scripts\/extension-byok-workbench-ui\.test\.mjs/u);
assert.match(preflightSource, /scripts\/extension-byok-workbench-runtime-handler\.test\.mjs/u);

class TestNode {
  constructor(id, tagName = 'div') {
    this.id = id;
    this.tagName = tagName.toUpperCase();
    this.textContent = '';
    this.value = '';
    this.disabled = false;
    this.hidden = false;
    this.checked = false;
    this.src = '';
    this.complete = true;
    this.naturalWidth = 1024;
    this.naturalHeight = 1024;
    this.alt = '';
    this.dataset = {};
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.className = '';
    this.classList = {
      values: new Set(),
      add: (...values) => values.forEach((value) => this.classList.values.add(value)),
      remove: (...values) => values.forEach((value) => this.classList.values.delete(value)),
      toggle: (value, force) => {
        if (force === true) this.classList.values.add(value);
        else if (force === false) this.classList.values.delete(value);
        else if (this.classList.values.has(value)) this.classList.values.delete(value);
        else this.classList.values.add(value);
      },
    };
  }

  addEventListener(type, listener) { this.listeners[type] = listener; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  appendChild(child) { this.children.push(child); return child; }
  replaceChildren(...children) { this.children = children; }
}

const ids = [
  'pageStatus', 'contextSource', 'contextShop', 'contextDraft', 'contextSku',
  'contextKicker', 'contextBadge',
  'executionModeByok', 'executionModeHosted', 'profileSelect', 'profileSummary',
  'promptInput', 'negativePromptInput', 'sizeSelect', 'generateButton',
  'resultPanel', 'previewImage', 'previewMeta', 'resultStatus', 'rejectButton',
  'approveButton', 'approvedNotice', 'refreshButton',
  'emptyResult',
];
const nodes = Object.fromEntries(ids.map((id) => [id, new TestNode(
  id,
  id === 'profileSelect' || id === 'sizeSelect' ? 'select'
    : id === 'promptInput' || id === 'negativePromptInput' ? 'textarea'
      : id.endsWith('Button') ? 'button'
        : id === 'previewImage' ? 'img' : 'div',
)]));
nodes.promptInput.value = 'Create a clean catalog hero image for the described product';
nodes.sizeSelect.value = '1024x1024';
nodes.executionModeByok.checked = true;
nodes.executionModeHosted.disabled = true;

const publicState = {
  contractVersion: 'extension-byok-workbench-public-state/v1',
  executionMode: 'BYOK',
  context: {
    contractVersion: 'extension-byok-workbench-launch-context/v1',
    sourcePlatform: '1688', sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
    skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND',
    assignmentOrdinal: 2,
  },
  profiles: [{
    profile: {
      id: 'profile-1', name: 'Relay', baseUrl: 'https://relay.example/v1',
      model: 'image-model-v1', allowedOperations: ['TEXT_TO_IMAGE'], preferences: {},
    },
    hasKey: true,
    permissionState: 'GRANTED',
    textToImageEvidence: {
      operation: 'TEXT_TO_IMAGE', requestMode: 'json', policyRevision: 'policy-7',
      verifiedAt: '2026-07-26T09:00:00.000Z', expiresAt: '2099-07-27T09:00:00.000Z',
    },
  }],
  result: null,
  generationOutcome: null,
  deliveryState: 'NOT_READY',
};
const readiness = {
  readinessHandle: 'rh_' + 'a'.repeat(48),
  readinessBinding: {
    contractVersion: 'extension-byok-readiness-binding/v2',
    ownerUserId: 'owner-1', deviceSessionId: 'session-1', shopId: 'shop-1',
    workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
    sourcePlatform: '1688', sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1', supplyGoodsId: 'goods-1',
    skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND',
    assignmentOrdinal: 2, providerOrigin: 'https://relay.example',
    model: 'image-model-v1', operation: 'TEXT_TO_IMAGE', policyRevision: 'policy-7',
  },
  expiresAt: '2099-07-26T10:10:00.000Z',
};
const resultId = 'br_' + 'b'.repeat(48);
const calls = [];
let revokeCount = 0;
let generateMode = 'unknown';
let reviewMode = 'valid';
let stateMode = 'valid';
let previewMode = 'valid';
const client = {
  async getPublicState() {
    calls.push(['state']);
    if (stateMode === 'error') throw Object.assign(new Error('stale'), {
      code: 'SS_ERP_BYOK_WORKBENCH_CONTEXT_STALE',
    });
    return publicState;
  },
  async getReadiness(profileId) { calls.push(['readiness', profileId]); return readiness; },
  async generate(value) {
    calls.push(['generate', value]);
    if (generateMode === 'unknown') {
      publicState.generationOutcome = 'UNKNOWN_OUTCOME';
      throw Object.assign(new Error('timeout'), {
        code: 'SS_ERP_BYOK_PROVIDER_UNKNOWN_OUTCOME',
      });
    }
    return {
      resultId, reviewState: 'CANDIDATE_READY',
      image: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
    };
  },
  async openPreview(id) {
    calls.push(['preview', id]);
    if (previewMode === 'error') throw Object.assign(new Error('preview unavailable'), {
      code: 'SS_ERP_BYOK_WORKBENCH_PREVIEW_TIMEOUT',
    });
    return {
      objectUrl: 'blob:workbench-preview',
      metadata: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
      revoke() { revokeCount += 1; },
    };
  },
  async reviewResult(id, decision) {
    calls.push(['review', id, decision]);
    if (reviewMode === 'invalid') return { resultId: 'br_' + 'f'.repeat(48), reviewState: 'APPROVED' };
    if (decision === 'REJECT') publicState.result = null;
    return decision === 'APPROVE'
      ? { resultId: id, reviewState: 'APPROVED', deliveryState: 'NOT_INGESTED' }
      : { resultId: id, reviewState: 'REJECTED' };
  },
};
let randomByte = 1;
const windowListeners = {};
const context = {
  Array, Boolean, Date, Error, Map, Math, Number, Object, Promise, Set, String, Uint8Array,
  document: {
    getElementById(id) { return nodes[id] || null; },
    createElement(tagName) { return new TestNode('', tagName); },
  },
  crypto: {
    getRandomValues(bytes) { bytes.fill(randomByte++); return bytes; },
  },
  chrome: { runtime: {} },
  setTimeout,
  clearTimeout,
};
context.window = context;
context.globalThis = context;
context.addEventListener = (type, listener) => { windowListeners[type] = listener; };
context.SS_ERP_BYOK_WORKBENCH_CLIENT = { createClient() { return client; } };

vm.runInNewContext(pageSource, context, { filename: pagePath });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));

assert.equal(nodes.contextSource.textContent, '1688 · product-1');
assert.match(nodes.contextDraft.textContent, /workflow-1.*r3.*v4/u);
assert.equal(nodes.contextSku.textContent, 'sku-1 · 主图 · 追加位置 3');
assert.equal(nodes.profileSelect.value, 'profile-1');
assert.equal(nodes.generateButton.disabled, false);
assert.match(nodes.profileSummary.textContent, /会话密钥已加载.*来源已授权.*能力证据有效/u);
assert.equal(nodes.contextKicker.textContent, '服务器已绑定');
assert.equal(nodes.contextBadge.textContent, '精确草稿');

publicState.result = {
  resultId, reviewState: 'CANDIDATE_READY',
  image: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
};
previewMode = 'error';
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(nodes.resultPanel.hidden, false);
assert.equal(nodes.rejectButton.disabled, false, 'preview transport failure preserves Reject');
assert.equal(nodes.approveButton.disabled, true);
assert.match(nodes.resultStatus.textContent, /预览.*可驳回/u);
nodes.rejectButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
previewMode = 'valid';
assert.equal(nodes.resultPanel.hidden, true);
assert.equal(nodes.generateButton.disabled, false);

nodes.generateButton.listeners.click({ isTrusted: false });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.filter((row) => row[0] === 'generate').length, 0);
nodes.generateButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.filter((row) => row[0] === 'generate').length, 1);
assert.equal(nodes.generateButton.disabled, true);
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(nodes.generateButton.disabled, true, 'unknown outcome remains locked after refresh');
nodes.generateButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.filter((row) => row[0] === 'generate').length, 1);
assert.match(nodes.pageStatus.textContent, /结果仍未知|不会重新提交/u);

publicState.generationOutcome = null;
generateMode = 'success';
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
nodes.generateButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.filter((row) => row[0] === 'generate').length, 2);
assert.equal(nodes.previewImage.src, 'blob:workbench-preview');
assert.equal(nodes.resultPanel.hidden, false);
assert.equal(nodes.rejectButton.disabled, false);
assert.equal(nodes.approveButton.disabled, true, 'approval waits for a decoded visible preview');
assert.match(nodes.resultStatus.textContent, /等待审核/u);
nodes.previewImage.src = 'blob:stale-preview';
nodes.previewImage.listeners.load();
assert.equal(nodes.approveButton.disabled, true, 'a stale preview load cannot unlock approval');
nodes.previewImage.src = 'blob:workbench-preview';
nodes.previewImage.listeners.load();
assert.equal(nodes.approveButton.disabled, false);
nodes.previewImage.listeners.error();
assert.equal(nodes.approveButton.disabled, true, 'a preview error revokes approval readiness');
nodes.previewImage.listeners.load();
assert.equal(nodes.approveButton.disabled, false);

const approveReviewsBeforeUntrustedClick = calls.filter(
  (row) => row[0] === 'review' && row[2] === 'APPROVE',
).length;
nodes.approveButton.listeners.click({ isTrusted: false });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.filter(
  (row) => row[0] === 'review' && row[2] === 'APPROVE',
).length, approveReviewsBeforeUntrustedClick);
reviewMode = 'invalid';
nodes.approveButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(nodes.approvedNotice.hidden, true, 'a mismatched approval response fails closed');
assert.match(nodes.resultStatus.textContent, /等待审核/u);
reviewMode = 'valid';
nodes.approveButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
assert.deepEqual(calls.filter((row) => row[0] === 'review').at(-1).slice(1), [resultId, 'APPROVE']);
assert.equal(nodes.approvedNotice.hidden, false);
assert.match(nodes.resultStatus.textContent, /已批准.*尚未上传 ERP/u);
assert.equal(nodes.generateButton.disabled, true);

stateMode = 'error';
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(nodes.contextSource.textContent, '不可用');
assert.equal(nodes.contextShop.textContent, '不可用');
assert.equal(nodes.contextDraft.textContent, '不可用');
assert.equal(nodes.contextSku.textContent, '不可用');
assert.equal(nodes.contextKicker.textContent, '服务器绑定不可用');
assert.equal(nodes.contextBadge.textContent, '上下文失效');

windowListeners.pagehide();
assert.ok(revokeCount >= 1);
assert.equal(JSON.stringify(calls).includes('apiKey'), false);
assert.equal(JSON.stringify(calls).includes('base64'), false);

console.log('extension BYOK workbench UI tests passed');

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
assert.match(html, /接收并绑定 ERP/u);
assert.match(html, /id=["']publishPanel["']/u);
assert.match(html, /id=["']publishMediaList["']/u);
assert.match(html, /id=["']publishConfirmation["'][^>]*type=["']checkbox["']/u);
assert.match(html, /id=["']publishConfirmButton["']/u);
assert.match(html, /id=["']publishRecoverButton["']/u);
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
assert.doesNotMatch(pageSource, /只查询同一幂等回执|不会重新生成或重复上传/u);
assert.match(pageSource, /先核对[^。]*回执[^。]*没有活动[^。]*同一图片字节/u);
assert.match(pageSource, /接收身份不可重用[^。]*候选图已清除[^。]*重新生成/u);
assert.match(pageSource, /getPublishPreview\(\)/u);
assert.match(pageSource, /confirmPublish\(state\.publishPreview\.previewHash\)/u);
assert.match(pageSource, /recoverPublish\(\)/u);
assert.doesNotMatch(html + pageSource, /Ozon 发布仍保持关闭|当前不能发布/u);
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
  'resultPanel', 'previewFrame', 'previewImage', 'previewMeta', 'resultStatus', 'rejectButton',
  'approveButton', 'approvedNotice', 'refreshButton',
  'publishPanel', 'publishStatus', 'publishShop', 'publishDraft', 'publishSkuOrder',
  'publishMediaList', 'publishNotice', 'publishConfirmationRow', 'publishConfirmation',
  'publishConfirmButton', 'publishRecoverButton',
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
  publish: null,
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
const candidateExpiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
const ingestReceipt = {
  contractVersion: 'extension-byok-generated-asset-ingest-client/v1', replayed: false,
  receiptId: 'receipt-1', assetId: 'asset-1', provenanceId: 'provenance-1',
  normalizedSha256: 'd'.repeat(64), mimeType: 'image/png', width: 1024, height: 1024,
  sourceDraftRevision: 3, sourceDraftVersion: 4,
  boundDraftRevision: 4, boundDraftVersion: 5,
  assignmentOrdinal: 2, assignmentSha256: 'e'.repeat(64),
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
};
const publishPreview = {
  contractVersion: 'extension-byok-listing-publish/v1',
  previewHash: '9'.repeat(64),
  shopId: 'shop-1', workflowId: 'workflow-1',
  sourceDraftRevision: 3, sourceDraftVersion: 4,
  boundDraftRevision: 4, boundDraftVersion: 5,
  assetId: 'asset-1', provenanceId: 'provenance-1',
  normalizedSha256: 'd'.repeat(64),
  skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentOrdinal: 2,
  assignmentSha256: 'e'.repeat(64),
  selectedSkuKeys: ['sku-2', 'sku-1'],
  orderedMedia: [
    {
      ordinal: 0, scope: 'PRODUCT', skuKey: null, slotKey: 'product:hero',
      assetId: 'asset-source', source: 'SOURCE',
    },
    {
      ordinal: 1, scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero',
      assetId: 'asset-sku-2', source: 'REVIEWED',
    },
    {
      ordinal: 2, scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
      assetId: 'asset-1', source: 'GENERATED',
    },
  ],
};
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
      expiresAt: candidateExpiresAt,
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
  async ingestApproved(id) {
    calls.push(['ingest', id]);
    return {
      resultId: id,
      reviewState: 'APPROVED',
      deliveryState: 'BOUND',
      ingest: ingestReceipt,
    };
  },
  async recoverApprovedIngest(id) {
    calls.push(['recover-ingest', id]);
    return {
      resultId: id, reviewState: 'APPROVED', deliveryState: 'BOUND',
      ingest: { ...ingestReceipt, replayed: true },
    };
  },
  async getPublishPreview() {
    calls.push(['publish-preview']);
    return publishPreview;
  },
  async confirmPublish(previewHash) {
    calls.push(['publish-confirm', previewHash]);
    publicState.publish = {
      contractVersion: 'extension-byok-listing-publish/v1',
      state: 'SUCCEEDED', shopId: 'shop-1', workflowId: 'workflow-1',
      boundDraftRevision: 4, boundDraftVersion: 5,
      previewHash: '9'.repeat(64), receiptId: 'publish-receipt-1', failureCode: null,
    };
    return publicState.publish;
  },
  async recoverPublish() {
    calls.push(['publish-recover']);
    return publicState.publish;
  },
};
let randomByte = 1;
const windowListeners = {};
const runtimeMessageListeners = [];
const context = {
  Array, Boolean, Date, Error, Map, Math, Number, Object, Promise, Set, String, Uint8Array,
  document: {
    getElementById(id) { return nodes[id] || null; },
    createElement(tagName) { return new TestNode('', tagName); },
  },
  crypto: {
    getRandomValues(bytes) { bytes.fill(randomByte++); return bytes; },
  },
  chrome: {
    runtime: {
      onMessage: {
        addListener(listener) { runtimeMessageListeners.push(listener); },
      },
    },
  },
  setTimeout,
  clearTimeout,
};
context.window = context;
context.globalThis = context;
context.addEventListener = (type, listener) => { windowListeners[type] = listener; };
context.SS_ERP_BYOK_WORKBENCH_CLIENT = {
  DEVICE_INVALIDATED_MESSAGE: 'ss-erp:byok-device-session-invalidated',
  createClient() { return client; },
};

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
  expiresAt: candidateExpiresAt,
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
assert.equal(nodes.approveButton.disabled, false, 'approved result can advance to ERP ingest');
assert.match(nodes.approveButton.textContent, /接收.*ERP/u);
const readinessCallsBeforeIngest = calls.filter((row) => row[0] === 'readiness').length;
nodes.approveButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(
  calls.filter((row) => row[0] === 'readiness').length,
  readinessCallsBeforeIngest,
  'ingest uses its dedicated server grant instead of generation readiness',
);
const ingestCall = calls.find((row) => row[0] === 'ingest');
assert.equal(ingestCall[1], resultId);
assert.match(nodes.resultStatus.textContent, /已绑定 ERP/u);
assert.match(nodes.approvedNotice.textContent, /receipt-1.*v5/u);
assert.equal(nodes.approveButton.disabled, true);
assert.equal(nodes.previewFrame.hidden, true, 'released Blob preview is hidden after binding');

publicState.result = {
  resultId, reviewState: 'APPROVED', deliveryState: 'INGESTING',
};
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.match(nodes.approveButton.textContent, /核对.*回执/u);
assert.equal(nodes.rejectButton.disabled, true, 'unknown ingest outcome cannot be deleted blindly');
nodes.approveButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
assert.equal(calls.filter((row) => row[0] === 'recover-ingest').length, 1);
assert.match(nodes.resultStatus.textContent, /已绑定 ERP/u);

const revokeBeforeExpiry = revokeCount;
publicState.result = {
  resultId, reviewState: 'CANDIDATE_READY', deliveryState: 'NOT_INGESTED',
  expiresAt: new Date(Date.now() + 20).toISOString(),
  image: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
};
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setTimeout(resolve, 40));
assert.equal(nodes.resultPanel.hidden, true);
assert.ok(revokeCount > revokeBeforeExpiry, 'candidate expiry must revoke the page object URL');
assert.match(nodes.pageStatus.textContent, /已过期/u);

publicState.result = {
  resultId, reviewState: 'CANDIDATE_READY', deliveryState: 'NOT_INGESTED',
  expiresAt: candidateExpiresAt,
  image: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
};
nodes.refreshButton.listeners.click({ isTrusted: true });
await new Promise((resolve) => setImmediate(resolve));
await new Promise((resolve) => setImmediate(resolve));
const revokeBeforeInvalidation = revokeCount;
assert.equal(nodes.previewImage.src, 'blob:workbench-preview');
assert.equal(runtimeMessageListeners.length, 1);
runtimeMessageListeners[0]({ type: 'ss-erp:byok-device-session-invalidated' });
assert.equal(nodes.resultPanel.hidden, true);
assert.equal(nodes.contextKicker.textContent, '服务器绑定不可用');
assert.ok(revokeCount > revokeBeforeInvalidation, 'device invalidation must revoke the page object URL');
assert.match(nodes.pageStatus.textContent, /设备会话已变化/u);

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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync(turns = 4) {
  for (let index = 0; index < turns; index += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
}

function cloneValue(value) {
  return JSON.parse(JSON.stringify(value));
}

function isolatedPublicState(result = null) {
  const value = cloneValue(publicState);
  value.result = result;
  value.generationOutcome = null;
  value.deliveryState = result?.deliveryState || 'NOT_READY';
  return value;
}

function isolatedCandidate(reviewState = 'CANDIDATE_READY', deliveryState = 'NOT_INGESTED') {
  return {
    resultId,
    reviewState,
    deliveryState,
    expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    image: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
  };
}

function createManualTimers() {
  let nextId = 1;
  const callbacks = new Map();
  return {
    setTimeout(callback) {
      const id = nextId;
      nextId += 1;
      callbacks.set(id, callback);
      return id;
    },
    clearTimeout(id) { callbacks.delete(id); },
    runAll() {
      const pending = [...callbacks.values()];
      callbacks.clear();
      pending.forEach((callback) => callback());
    },
  };
}

function createPageHarness(options = {}) {
  const harnessNodes = Object.fromEntries(ids.map((id) => [id, new TestNode(
    id,
    id === 'profileSelect' || id === 'sizeSelect' ? 'select'
      : id === 'promptInput' || id === 'negativePromptInput' ? 'textarea'
        : id.endsWith('Button') ? 'button'
          : id === 'previewImage' ? 'img' : 'div',
  )]));
  harnessNodes.promptInput.value = 'Create a clean catalog hero image';
  harnessNodes.sizeSelect.value = '1024x1024';
  harnessNodes.executionModeByok.checked = true;
  harnessNodes.executionModeHosted.disabled = true;

  const authoritative = options.authoritative || { value: isolatedPublicState() };
  const harnessCalls = [];
  let harnessRevokeCount = 0;
  const operations = {
    getPublicState: options.getPublicState || (() => authoritative.value),
    getReadiness: options.getReadiness || (() => readiness),
    generate: options.generate || (() => isolatedCandidate()),
    openPreview: options.openPreview || (() => ({
      objectUrl: 'blob:isolated-preview',
      metadata: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
      revoke() { harnessRevokeCount += 1; },
    })),
    reviewResult: options.reviewResult || ((id, decision) => ({
      resultId: id,
      reviewState: decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
      ...(decision === 'APPROVE' ? { deliveryState: 'NOT_INGESTED' } : {}),
    })),
    ingestApproved: options.ingestApproved || ((id) => ({
      resultId: id, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
    })),
    recoverApprovedIngest: options.recoverApprovedIngest || ((id) => ({
      resultId: id, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
    })),
    getPublishPreview: options.getPublishPreview || (() => publishPreview),
    confirmPublish: options.confirmPublish || (() => ({
      contractVersion: 'extension-byok-listing-publish/v1',
      state: 'SUCCEEDED', shopId: 'shop-1', workflowId: 'workflow-1',
      boundDraftRevision: 4, boundDraftVersion: 5,
      previewHash: '9'.repeat(64), receiptId: 'publish-receipt-1', failureCode: null,
    })),
    recoverPublish: options.recoverPublish || (() => ({
      contractVersion: 'extension-byok-listing-publish/v1',
      state: 'SUCCEEDED', shopId: 'shop-1', workflowId: 'workflow-1',
      boundDraftRevision: 4, boundDraftVersion: 5,
      previewHash: '9'.repeat(64), receiptId: 'publish-receipt-1', failureCode: null,
    })),
  };
  const harnessClient = {
    async getPublicState() { harnessCalls.push(['state']); return operations.getPublicState(); },
    async getReadiness(profileId) {
      harnessCalls.push(['readiness', profileId]);
      return operations.getReadiness(profileId);
    },
    async generate(input) { harnessCalls.push(['generate', input]); return operations.generate(input); },
    async openPreview(id) { harnessCalls.push(['preview', id]); return operations.openPreview(id); },
    async reviewResult(id, decision) {
      harnessCalls.push(['review', id, decision]);
      return operations.reviewResult(id, decision);
    },
    async ingestApproved(id) { harnessCalls.push(['ingest', id]); return operations.ingestApproved(id); },
    async recoverApprovedIngest(id) {
      harnessCalls.push(['recover-ingest', id]);
      return operations.recoverApprovedIngest(id);
    },
    async getPublishPreview() {
      harnessCalls.push(['publish-preview']);
      return operations.getPublishPreview();
    },
    async confirmPublish(previewHash) {
      harnessCalls.push(['publish-confirm', previewHash]);
      return operations.confirmPublish(previewHash);
    },
    async recoverPublish() {
      harnessCalls.push(['publish-recover']);
      return operations.recoverPublish();
    },
  };
  const harnessWindowListeners = {};
  const harnessRuntimeListeners = [];
  const timerApi = options.timers || createManualTimers();
  let harnessRandomByte = 32;
  const harnessContext = {
    Array, Boolean, Date, Error, Map, Math, Number, Object, Promise, Set, String, Uint8Array,
    document: {
      getElementById(id) { return harnessNodes[id] || null; },
      createElement(tagName) { return new TestNode('', tagName); },
    },
    crypto: {
      getRandomValues(bytes) { bytes.fill(harnessRandomByte++); return bytes; },
    },
    chrome: {
      runtime: {
        onMessage: {
          addListener(listener) { harnessRuntimeListeners.push(listener); },
        },
      },
    },
    setTimeout: timerApi.setTimeout.bind(timerApi),
    clearTimeout: timerApi.clearTimeout.bind(timerApi),
  };
  harnessContext.window = harnessContext;
  harnessContext.globalThis = harnessContext;
  harnessContext.addEventListener = (type, listener) => { harnessWindowListeners[type] = listener; };
  harnessContext.SS_ERP_BYOK_WORKBENCH_CLIENT = {
    DEVICE_INVALIDATED_MESSAGE: 'ss-erp:byok-device-session-invalidated',
    createClient() { return harnessClient; },
  };
  vm.runInNewContext(pageSource, harnessContext, { filename: pagePath });
  return {
    authoritative,
    calls: harnessCalls,
    nodes: harnessNodes,
    runtimeListeners: harnessRuntimeListeners,
    windowListeners: harnessWindowListeners,
    get revokeCount() { return harnessRevokeCount; },
  };
}

{
  const lateState = createDeferred();
  const harness = createPageHarness({ getPublicState: () => lateState.promise });
  harness.runtimeListeners[0]({ type: 'ss-erp:byok-device-session-invalidated' });
  lateState.resolve(isolatedPublicState());
  await flushAsync();
  assert.equal(harness.nodes.contextSource.textContent, '设备已断开');
  assert.match(harness.nodes.pageStatus.textContent, /设备会话已变化/u);
  assert.equal(harness.calls.filter((row) => row[0] === 'readiness').length, 0,
    'a stale state load must not start readiness after invalidation');
}

{
  const lateReadiness = createDeferred();
  const harness = createPageHarness({ getReadiness: () => lateReadiness.promise });
  await flushAsync();
  assert.equal(harness.calls.filter((row) => row[0] === 'readiness').length, 1);
  harness.runtimeListeners[0]({ type: 'ss-erp:byok-device-session-invalidated' });
  const invalidatedStatus = harness.nodes.pageStatus.textContent;
  lateReadiness.resolve(readiness);
  await flushAsync();
  assert.equal(harness.nodes.pageStatus.textContent, invalidatedStatus,
    'late readiness must not overwrite disconnected UI');
}

{
  const lateIngest = createDeferred();
  const authoritative = { value: isolatedPublicState(isolatedCandidate('APPROVED')) };
  const harness = createPageHarness({ authoritative, ingestApproved: () => lateIngest.promise });
  await flushAsync();
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(1);
  harness.runtimeListeners[0]({ type: 'ss-erp:byok-device-session-invalidated' });
  lateIngest.resolve({
    resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
  });
  await flushAsync();
  assert.equal(harness.nodes.resultPanel.hidden, true);
  assert.equal(harness.nodes.contextSource.textContent, '设备已断开');
  assert.match(harness.nodes.pageStatus.textContent, /设备会话已变化/u,
    'late ingest must not overwrite disconnected UI');
}

{
  const latePreview = createDeferred();
  let latePreviewRevokes = 0;
  const authoritative = { value: isolatedPublicState(isolatedCandidate()) };
  const harness = createPageHarness({ authoritative, openPreview: () => latePreview.promise });
  await flushAsync(1);
  harness.windowListeners.pagehide();
  const hiddenStatus = harness.nodes.pageStatus.textContent;
  latePreview.resolve({
    objectUrl: 'blob:late-pagehide-preview',
    metadata: { mimeType: 'image/png', byteLength: 1234, sha256: 'c'.repeat(64) },
    revoke() { latePreviewRevokes += 1; },
  });
  await flushAsync();
  assert.equal(latePreviewRevokes, 1, 'a preview arriving after pagehide is revoked');
  assert.equal(harness.nodes.pageStatus.textContent, hiddenStatus,
    'a preview arriving after pagehide must not mutate page state');
}

{
  const timers = createManualTimers();
  const lateReview = createDeferred();
  const authoritative = { value: isolatedPublicState(isolatedCandidate()) };
  const harness = createPageHarness({
    authoritative,
    timers,
    reviewResult: () => lateReview.promise,
  });
  await flushAsync();
  harness.nodes.previewImage.listeners.load();
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(1);
  timers.runAll();
  assert.equal(harness.nodes.resultPanel.hidden, false,
    'preview expiry must not clear a candidate while review is unresolved');
  authoritative.value.result = null;
  lateReview.resolve({ resultId, reviewState: 'APPROVED', deliveryState: 'NOT_INGESTED' });
  await flushAsync(8);
  assert.ok(harness.calls.filter((row) => row[0] === 'state').length >= 2,
    'expiry during review reloads authoritative state after review settles');
  assert.equal(harness.nodes.resultPanel.hidden, true);
}

{
  const timers = createManualTimers();
  const lateIngest = createDeferred();
  const authoritative = { value: isolatedPublicState(isolatedCandidate('APPROVED')) };
  const harness = createPageHarness({
    authoritative,
    timers,
    ingestApproved: () => lateIngest.promise,
  });
  await flushAsync();
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(1);
  timers.runAll();
  assert.equal(harness.nodes.resultPanel.hidden, false,
    'preview expiry must not clear a candidate while ingest is unresolved');
  authoritative.value.result = {
    resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
  };
  lateIngest.resolve(authoritative.value.result);
  await flushAsync(8);
  assert.ok(harness.calls.filter((row) => row[0] === 'state').length >= 2,
    'expiry during ingest reloads authoritative state after ingest settles');
  assert.match(harness.nodes.resultStatus.textContent, /已绑定 ERP/u);
}

for (const terminalCode of [
  'SS_ERP_BYOK_INGEST_RECOVERY_REJECTED',
  'SS_ERP_BYOK_INGEST_RECEIPT_NOT_FOUND',
  'SS_ERP_BYOK_INGEST_REQUEST_HASH_REQUIRED',
]) {
  const authoritative = {
    value: isolatedPublicState(isolatedCandidate('APPROVED', 'INGESTING')),
  };
  const harness = createPageHarness({
    authoritative,
    recoverApprovedIngest: () => {
      authoritative.value.result = isolatedCandidate('APPROVED', 'NOT_INGESTED');
      throw Object.assign(new Error('terminal recovery rejection'), {
        code: terminalCode,
      });
    },
  });
  await flushAsync();
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(8);
  assert.ok(harness.calls.filter((row) => row[0] === 'state').length >= 2,
    `${terminalCode} reloads the background-reset public state`);
  assert.match(harness.nodes.approveButton.textContent, /接收并绑定 ERP/u);
  assert.equal(harness.nodes.rejectButton.disabled, false);
}

{
  const authoritative = {
    value: isolatedPublicState(isolatedCandidate('APPROVED', 'INGESTING')),
  };
  const harness = createPageHarness({
    authoritative,
    recoverApprovedIngest: () => {
      authoritative.value.result = null;
      throw Object.assign(new Error('immutable failed receipt'), {
        code: 'SS_ERP_BYOK_INGEST_RECEIPT_FAILED',
      });
    },
  });
  await flushAsync();
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync(8);
  assert.ok(harness.calls.filter((row) => row[0] === 'state').length >= 2,
    'an immutable failed receipt reloads the cleared authoritative state');
  assert.equal(harness.nodes.resultPanel.hidden, true,
    'an immutable failed receipt must not expose another receive action');
}

for (const transientCode of [
  'SS_ERP_BYOK_INGEST_RECEIPT_PENDING',
  'SS_ERP_BYOK_INGEST_UNKNOWN_OUTCOME',
]) {
  const authoritative = {
    value: isolatedPublicState(isolatedCandidate('APPROVED', 'INGESTING')),
  };
  const harness = createPageHarness({
    authoritative,
    recoverApprovedIngest: () => {
      throw Object.assign(new Error('transient recovery state'), { code: transientCode });
    },
  });
  await flushAsync();
  harness.nodes.approveButton.listeners.click({ isTrusted: true });
  await flushAsync();
  assert.equal(harness.calls.filter((row) => row[0] === 'state').length, 1,
    `${transientCode} must preserve INGESTING without an implicit retry`);
  assert.match(harness.nodes.approveButton.textContent, /核对 ERP 回执/u);
  assert.match(harness.nodes.resultStatus.textContent, /等待 ERP 回执/u);
}

{
  const confirmation = createDeferred();
  const authoritative = {
    value: isolatedPublicState({
      resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
    }),
  };
  const harness = createPageHarness({
    authoritative,
    confirmPublish: () => confirmation.promise,
  });
  await flushAsync(8);
  assert.equal(harness.calls.filter((row) => row[0] === 'publish-preview').length, 1);
  assert.equal(harness.nodes.publishPanel.hidden, false);
  assert.equal(harness.nodes.publishShop.textContent, 'shop-1');
  assert.match(harness.nodes.publishDraft.textContent, /workflow-1.*r4.*v5/u);
  assert.equal(harness.nodes.publishSkuOrder.textContent, 'sku-2 -> sku-1');
  assert.equal(harness.nodes.publishMediaList.children.length, 3);
  assert.equal(
    harness.nodes.publishMediaList.children[2].classList.values.has('is-bound-asset'),
    true,
    'the newly bound BYOK asset is highlighted in the authoritative media order',
  );
  assert.equal(harness.nodes.publishConfirmButton.disabled, true,
    'publish requires a separate explicit confirmation');
  harness.nodes.publishConfirmation.checked = true;
  harness.nodes.publishConfirmation.listeners.change({ isTrusted: true });
  assert.equal(harness.nodes.publishConfirmButton.disabled, false);
  harness.nodes.publishConfirmButton.listeners.click({ isTrusted: false });
  await flushAsync(1);
  assert.equal(harness.calls.filter((row) => row[0] === 'publish-confirm').length, 0);
  harness.nodes.publishConfirmButton.listeners.click({ isTrusted: true });
  harness.nodes.publishConfirmButton.listeners.click({ isTrusted: true });
  await flushAsync(1);
  assert.equal(harness.calls.filter((row) => row[0] === 'publish-confirm').length, 1,
    'double-click must share the page operation lock');
  confirmation.resolve({
    contractVersion: 'extension-byok-listing-publish/v1',
    state: 'SUCCEEDED', shopId: 'shop-1', workflowId: 'workflow-1',
    boundDraftRevision: 4, boundDraftVersion: 5,
    previewHash: '9'.repeat(64), receiptId: 'publish-receipt-1', failureCode: null,
  });
  await flushAsync(8);
  assert.match(harness.nodes.publishStatus.textContent, /已提交/u);
  assert.match(harness.nodes.publishNotice.textContent, /publish-receipt-1/u);
  assert.equal(harness.nodes.publishRecoverButton.hidden, true);
  assert.equal(harness.nodes.publishConfirmButton.disabled, true);
}

{
  const recovery = createDeferred();
  const authoritative = {
    value: isolatedPublicState({
      resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
    }),
  };
  authoritative.value.publish = {
    contractVersion: 'extension-byok-listing-publish/v1',
    state: 'PENDING', shopId: 'shop-1', workflowId: 'workflow-1',
    boundDraftRevision: 4, boundDraftVersion: 5,
    previewHash: '9'.repeat(64), receiptId: 'publish-receipt-pending', failureCode: null,
  };
  const harness = createPageHarness({
    authoritative,
    recoverPublish: () => recovery.promise,
  });
  await flushAsync(8);
  assert.match(harness.nodes.publishStatus.textContent, /尚未形成终态/u);
  assert.match(harness.nodes.publishNotice.textContent, /处理或等待对账/u);
  assert.equal(harness.nodes.publishConfirmationRow.hidden, true);
  assert.equal(harness.nodes.publishRecoverButton.hidden, false);
  harness.nodes.publishRecoverButton.listeners.click({ isTrusted: true });
  harness.nodes.publishRecoverButton.listeners.click({ isTrusted: true });
  await flushAsync(1);
  assert.equal(harness.calls.filter((row) => row[0] === 'publish-recover').length, 1,
    'PENDING recovery must also be single-flight');
  recovery.resolve({
    contractVersion: 'extension-byok-listing-publish/v1',
    state: 'SUCCEEDED', shopId: 'shop-1', workflowId: 'workflow-1',
    boundDraftRevision: 4, boundDraftVersion: 5,
    previewHash: '9'.repeat(64), receiptId: 'publish-receipt-pending', failureCode: null,
  });
  await flushAsync(8);
  assert.match(harness.nodes.publishStatus.textContent, /已提交/u);
}

{
  const authoritative = {
    value: isolatedPublicState({
      resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
    }),
  };
  const harness = createPageHarness({
    authoritative,
    confirmPublish: () => {
      throw Object.assign(new Error('unknown publish outcome'), {
        code: 'SS_ERP_BYOK_PUBLISH_UNKNOWN_OUTCOME',
      });
    },
  });
  await flushAsync(8);
  harness.nodes.publishConfirmation.checked = true;
  harness.nodes.publishConfirmation.listeners.change({ isTrusted: true });
  harness.nodes.publishConfirmButton.listeners.click({ isTrusted: true });
  await flushAsync(8);
  assert.match(harness.nodes.publishStatus.textContent, /结果未知/u);
  assert.equal(harness.nodes.publishRecoverButton.hidden, false);
  assert.match(harness.nodes.publishNotice.textContent, /同一发布身份/u);
}

{
  const authoritative = {
    value: isolatedPublicState({
      resultId, reviewState: 'APPROVED', deliveryState: 'BOUND', ingest: ingestReceipt,
    }),
  };
  const harness = createPageHarness({
    authoritative,
    confirmPublish: () => ({
      contractVersion: 'extension-byok-listing-publish/v1',
      state: 'FAILED', shopId: 'shop-1', workflowId: 'workflow-1',
      boundDraftRevision: 4, boundDraftVersion: 5,
      previewHash: '9'.repeat(64), receiptId: 'publish-receipt-failed',
      failureCode: 'OZON_IMPORT_REJECTED',
    }),
  });
  await flushAsync(8);
  harness.nodes.publishConfirmation.checked = true;
  harness.nodes.publishConfirmation.listeners.change({ isTrusted: true });
  harness.nodes.publishConfirmButton.listeners.click({ isTrusted: true });
  await flushAsync(8);
  assert.match(harness.nodes.publishStatus.textContent, /提交失败/u);
  assert.match(harness.nodes.publishNotice.textContent, /OZON_IMPORT_REJECTED/u);
  assert.match(harness.nodes.pageStatus.textContent, /确认失败.*OZON_IMPORT_REJECTED/u);
  assert.doesNotMatch(harness.nodes.pageStatus.textContent, /恢复流程|继续核对/u);
  assert.equal(harness.nodes.publishRecoverButton.hidden, true);
}

console.log('extension BYOK workbench UI tests passed');

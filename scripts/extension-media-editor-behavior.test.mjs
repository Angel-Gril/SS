import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';
import './extension-media-editor-source-preview.test.mjs';

const extensionRoot = 'extensions/ss-erp';
const plain = (value) => JSON.parse(JSON.stringify(value));
const tick = () => new Promise((resolve) => setImmediate(resolve));

class FakeClassList {
  constructor(node) {
    this.node = node;
    this.names = new Set();
  }

  toggle(name, force) {
    if (force === false) this.names.delete(name);
    else if (force === true || !this.names.has(name)) this.names.add(name);
    else this.names.delete(name);
    this.node.className = [...this.names].join(' ');
  }
}

class FakeElement {
  constructor(id) {
    this.id = id;
    this.listeners = new Map();
    this.attributes = {};
    this.classList = new FakeClassList(this);
    this.className = '';
    this.style = {};
    this.disabled = false;
    this.hidden = false;
    this.textContent = '';
    this.value = '';
    this.clientWidth = 500;
    this.clientHeight = 400;
    this.capturedPointerId = null;
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) || []) listener({ target: this, ...event });
  }

  setAttribute(name, value) { this.attributes[name] = String(value); }
  removeAttribute(name) { delete this.attributes[name]; }
  focus() { this.focused = true; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; }
  setPointerCapture(pointerId) { this.capturedPointerId = pointerId; }
  hasPointerCapture(pointerId) { return this.capturedPointerId === pointerId; }
  releasePointerCapture(pointerId) {
    if (this.capturedPointerId === pointerId) this.capturedPointerId = null;
  }
}

class FakeCanvasContext {
  constructor(canvas) {
    this.canvas = canvas;
    this.painted = false;
    this.globalCompositeOperation = 'source-over';
  }

  save() {}
  restore() {}
  beginPath() {}
  arc() {}
  moveTo() {}
  lineTo() {}
  clearRect() { this.painted = false; }
  fillRect() { this.painted = this.fillStyle !== '#000000'; }
  fill() { this.painted = this.globalCompositeOperation !== 'destination-out'; }
  stroke() { this.painted = this.globalCompositeOperation !== 'destination-out'; }

  getImageData(_x, _y, width, height) {
    const data = new Uint8ClampedArray(width * height * 4);
    if (this.painted && data.length >= 4) data[3] = 255;
    return { data };
  }
}

class FakeCanvas extends FakeElement {
  constructor(id) {
    super(id);
    this.width = 100;
    this.height = 100;
    this.context = new FakeCanvasContext(this);
  }

  getContext() { return this.context; }
}

async function testEditorRuntimeBehavior() {
  const elementIds = [
    'editorTitle', 'sourceMeta', 'maskTools', 'canvasWorkspace', 'canvasStage',
    'canvasLoading', 'sourceImage', 'maskCanvas', 'paintTool', 'eraseTool',
    'brushSize', 'brushValue', 'undoButton', 'redoButton', 'clearButton',
    'promptInput', 'negativePromptInput', 'maskMetrics', 'editPixelCount',
    'preservedPixelCount', 'editorStatus', 'submitButton', 'cancelButton',
  ];
  const elements = Object.fromEntries(elementIds.map((id) => [
    id,
    id === 'maskCanvas' ? new FakeCanvas(id) : new FakeElement(id),
  ]));
  elements.brushSize.value = '4';
  elements.sourceImage.naturalWidth = 10;
  elements.sourceImage.naturalHeight = 10;
  const editorWorkspace = new FakeElement('editorWorkspace');
  const windowListeners = new Map();
  const runtimeMessages = [];
  const previewFetches = [];
  const revokedPreviewUrls = [];
  let closeCalls = 0;
  let animationId = 0;
  const nonce = 'a'.repeat(64);
  const pageContext = {
    Array,
    Date,
    Error,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    TypeError,
    Uint8Array,
    Uint8ClampedArray,
    URL,
    URLSearchParams,
    Blob,
    AbortController,
    fetch: async (url, options) => {
      previewFetches.push({ url, options });
      return new Response(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAE0lEQVQYlWP4TyRgGFWID1A/eAAj+46A5o3AdQAAAABJRU5ErkJggg==', 'base64'), {
        headers: { 'content-type': 'image/png', 'cross-origin-resource-policy': 'same-origin' },
      });
    },
    console,
    queueMicrotask,
    setTimeout,
    clearTimeout,
    document: {
      title: '',
      getElementById: (id) => elements[id],
      querySelector: (selector) => selector === '.editor-workspace' ? editorWorkspace : null,
      createElement: (tag) => tag === 'canvas'
        ? new FakeCanvas('generated-canvas')
        : new FakeElement(tag),
    },
    chrome: {
      runtime: {
        getManifest: () => ({ host_permissions: ['https://cdn.example/*'] }),
        lastError: null,
        sendMessage(message, callback) {
          runtimeMessages.push(plain(message));
          queueMicrotask(() => {
            if (message.type.endsWith('-read')) {
              callback({
                ok: true,
                editor: {
                  operation: 'INPAINT',
                  sourceMediaKeys: ['main-image'],
                  expiresAt: Date.now() + 60_000,
                  completed: false,
                  completion: null,
                  source: {
                    url: 'https://cdn.example/source.png',
                    mimeType: 'image/png',
                    width: 10,
                    height: 10,
                    maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
                    maxMaskBytes: 1024 * 1024,
                  },
                },
              });
              return;
            }
            if (message.type.endsWith('-cancel')) {
              callback({ ok: true, result: { state: 'recovery_required' } });
              return;
            }
            callback({ ok: true, result: { state: 'completed' } });
          });
        },
      },
    },
  };
  pageContext.window = pageContext;
  pageContext.URL = class extends URL {
    static createObjectURL() { return 'blob:chrome-extension://test/source-preview'; }
    static revokeObjectURL(url) { revokedPreviewUrls.push(url); }
  };
  pageContext.globalThis = pageContext;
  pageContext.location = { hash: `#nonce=${nonce}` };
  pageContext.devicePixelRatio = 1;
  pageContext.getComputedStyle = () => ({
    paddingLeft: '0', paddingRight: '0', paddingTop: '0', paddingBottom: '0',
  });
  pageContext.requestAnimationFrame = (callback) => {
    const id = ++animationId;
    setTimeout(() => callback(Date.now()), 0);
    return id;
  };
  pageContext.cancelAnimationFrame = () => {};
  pageContext.addEventListener = (type, listener) => {
    const listeners = windowListeners.get(type) || [];
    listeners.push(listener);
    windowListeners.set(type, listeners);
  };
  pageContext.confirm = () => true;
  pageContext.close = () => { closeCalls += 1; };

  for (const relativePath of [
    'shared/ai-media/image-mask-core.js',
    'shared/ai-media/image-mask-layout.js',
    'shared/ai-media/image-mask-canvas.js',
    'shared/byok/profile-schema.js',
    'shared/byok/image-input-inspector.js',
    'shared/ai-media/image-source-preview.js',
    'pages/media-editor.js',
  ]) {
    const path = `${extensionRoot}/${relativePath}`;
    vm.runInNewContext(fs.readFileSync(path, 'utf8'), pageContext, { filename: path });
  }
  await tick();
  assert.equal(previewFetches.length, 1,
    'CORP same-origin source must be fetched before being displayed inside the extension');
  assert.equal(previewFetches[0].options.credentials, 'omit');
  assert.equal(previewFetches[0].options.redirect, 'error');
  assert.match(elements.sourceImage.src, /^blob:/u,
    'the image element must display the bounded local blob, not the cross-origin source URL');
  elements.sourceImage.dispatch('load', { isTrusted: true });
  elements.promptInput.value = 'Replace the selected area';
  elements.promptInput.dispatch('input', { isTrusted: true });

  const pointer = (pointerId) => ({
    isTrusted: true,
    isPrimary: true,
    button: 0,
    pointerId,
    clientX: 25,
    clientY: 25,
  });
  elements.maskCanvas.dispatch('pointerdown', pointer(1));
  elements.maskCanvas.dispatch('pointerup', pointer(1));
  assert.equal(elements.submitButton.disabled, false,
    'a valid completed mask stroke should allow submission');

  elements.maskCanvas.dispatch('pointerdown', pointer(2));
  assert.equal(elements.submitButton.disabled, true,
    'an active mask stroke must disable submission');
  elements.submitButton.dispatch('click', { isTrusted: true });
  assert.equal(runtimeMessages.filter((message) => message.type.endsWith('-submit')).length, 0,
    'an active mask stroke must not submit through the Chrome runtime');
  elements.maskCanvas.dispatch('pointercancel', pointer(2));

  for (let index = 1; index < pageContext.SS_ERP_IMAGE_MASK_CORE.MAX_STROKES; index += 1) {
    const event = pointer(index + 2);
    elements.maskCanvas.dispatch('pointerdown', event);
    elements.maskCanvas.dispatch('pointerup', event);
  }
  assert.equal(elements.paintTool.disabled, true,
    'exhausting the aggregate stroke budget must disable additional drawing');
  assert.match(elements.editorStatus.textContent, /安全上限.*撤销或清空/u);
  elements.undoButton.dispatch('click', { isTrusted: true });
  assert.equal(elements.paintTool.disabled, false,
    'undoing a stroke must recover aggregate mask budget');

  elements.cancelButton.dispatch('click', { isTrusted: true });
  await tick();
  assert.equal(closeCalls, 0, 'a recovery-required cancellation must keep the editor open');
  assert.match(elements.editorStatus.textContent, /尚未确认/u);
  assert.equal(elements.cancelButton.disabled, false);
  for (const listener of windowListeners.get('pagehide')) listener();
  assert.deepEqual(revokedPreviewUrls, ['blob:chrome-extension://test/source-preview'],
    'closing the page must release the source blob');
  assert.equal(previewFetches[0].options.signal.aborted, true);
}

async function testTabCloseRecoveryLifecycle() {
  const paths = {
    contract: `${extensionRoot}/shared/erp-adapter/source-media-editor-session.js`,
    coordinator: `${extensionRoot}/shared/erp-adapter/source-media-editor-coordinator.js`,
    lifecycle: `${extensionRoot}/shared/erp-adapter/source-media-editor-lifecycle.js`,
  };
  assert.ok(fs.existsSync(paths.lifecycle), 'media editor lifecycle helper should exist');
  const context = {
    Array,
    Date,
    Error,
    JSON,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    TypeError,
    Uint8Array,
  };
  context.globalThis = context;
  for (const path of Object.values(paths)) {
    vm.runInNewContext(fs.readFileSync(path, 'utf8'), context, { filename: path });
  }

  const state = {};
  const storageKey = 'test:media-editor-sessions';
  const storage = {
    async get(keys) { return Object.fromEntries(keys.map((key) => [key, state[key]])); },
    async set(values) { Object.assign(state, plain(values)); },
  };
  const removedListeners = [];
  const updatedTabs = [];
  let nextTabId = 40;
  const tabs = {
    onRemoved: { addListener(listener) { removedListeners.push(listener); } },
    async query() { return []; },
    async update(tabId, input) { updatedTabs.push({ tabId, input: plain(input) }); },
  };
  const coordinator = context.SS_ERP_SOURCE_MEDIA_EDITOR_COORDINATOR.createCoordinator({
    contract: context.SS_ERP_SOURCE_MEDIA_EDITOR_SESSION,
    storage,
    windows: {
      async create() { return { id: 10, tabs: [{ id: nextTabId++ }] }; },
      async remove() {},
    },
    tabs,
    runtime: { getURL: (path) => `chrome-extension://extension-id/${path}` },
    crypto: webcrypto,
    storageKey,
    ttlMs: 30 * 60 * 1000,
    submitLeaseMs: 5 * 60 * 1000,
    minimumSubmitRemainingMs: 4 * 60 * 1000,
    limit: 10,
    now: () => Date.parse('2026-07-23T02:00:00.000Z'),
    launchPath: 'pages/media-confirm-launch.html',
    editorPath: 'pages/media-editor.html',
  });
  const lifecycleErrors = [];
  context.SS_ERP_SOURCE_MEDIA_EDITOR_LIFECYCLE.registerTabCleanup({
    tabs,
    getCoordinator: () => coordinator,
    onError: (error) => lifecycleErrors.push(error),
  });
  assert.equal(removedListeners.length, 1);

  const openInput = {
    platform: '1688',
    sourceProductId: 'source-runtime',
    snapshotId: 'snapshot-runtime',
    supplyGoodsId: 'goods-runtime',
    shopId: 'shop-runtime',
    listingWorkflowId: 'listing-runtime',
    revision: 1,
    draftVersion: 1,
    operation: 'FULL_EDIT',
    sourceMediaKeys: ['main-image'],
    preparedSource: null,
    sourceTabId: 9,
  };

  await coordinator.open(openInput);
  let records = state[storageKey];
  const unleasedNonce = Object.keys(records)[0];
  await removedListeners[0](records[unleasedNonce].editorTabId);
  assert.equal(await coordinator.read(unleasedNonce), null,
    'closing an unleased editor tab must remove its session');

  await coordinator.open(openInput);
  records = state[storageKey];
  const recoverableNonce = Object.keys(records)[0];
  const originalTabId = records[recoverableNonce].editorTabId;
  const sender = {
    tab: { id: originalTabId }, frameId: 0, documentId: 'editor-runtime-1',
  };
  assert.ok(await coordinator.claim(recoverableNonce, sender));
  await assert.rejects(() => coordinator.submit(recoverableNonce, sender, async () => {
    throw new Error('workflow response lost');
  }), /response lost/u);
  assert.deepEqual(plain(await coordinator.cancel(recoverableNonce, sender)), {
    state: 'recovery_required',
  });
  await removedListeners[0](originalTabId);
  assert.ok(await coordinator.read(recoverableNonce),
    'closing a leased ambiguous editor must preserve its recovery session');

  await coordinator.open({ ...openInput, sourceTabId: 10 });
  records = state[storageKey];
  assert.deepEqual(Object.keys(records), [recoverableNonce],
    'reopening the exact context must reuse its recoverable nonce');
  assert.notEqual(records[recoverableNonce].editorTabId, originalTabId);
  assert.equal(records[recoverableNonce].editorDocumentId, null);
  assert.equal(records[recoverableNonce].sourceTabId, 10);
  assert.match(updatedTabs.at(-1).input.url, new RegExp(`${recoverableNonce}$`, 'u'));

  for (let index = 1; index < 10; index += 1) {
    const sourceProductId = `source-protected-${index}`;
    await coordinator.open({
      ...openInput,
      sourceProductId,
      snapshotId: `snapshot-protected-${index}`,
      supplyGoodsId: `goods-protected-${index}`,
      listingWorkflowId: `listing-protected-${index}`,
      sourceTabId: 20 + index,
    });
    records = state[storageKey];
    const protectedNonce = Object.keys(records).find((value) => (
      records[value].sourceProductId === sourceProductId
    ));
    assert.ok(protectedNonce);
    const protectedSender = {
      tab: { id: records[protectedNonce].editorTabId },
      frameId: 0,
      documentId: `editor-protected-${index}`,
    };
    assert.ok(await coordinator.claim(protectedNonce, protectedSender));
    await assert.rejects(() => coordinator.submit(
      protectedNonce,
      protectedSender,
      async () => { throw new Error('workflow response lost'); },
    ), /response lost/u);
  }

  records = state[storageKey];
  assert.equal(Object.keys(records).length, 10);
  assert.ok(records[recoverableNonce], 'the oldest protected recovery nonce must remain stored');
  await assert.rejects(() => coordinator.open({
    ...openInput,
    sourceProductId: 'source-over-capacity',
    snapshotId: 'snapshot-over-capacity',
    supplyGoodsId: 'goods-over-capacity',
    listingWorkflowId: 'listing-over-capacity',
    sourceTabId: 99,
  }), /恢复会话已达上限/u);
  assert.equal(Object.keys(state[storageKey]).length, 10);
  assert.ok(state[storageKey][recoverableNonce]);

  await coordinator.open({ ...openInput, sourceTabId: 100 });
  assert.ok(state[storageKey][recoverableNonce],
    'a full protected store must still allow exact-context recovery');
  assert.match(updatedTabs.at(-1).input.url, new RegExp(`${recoverableNonce}$`, 'u'));
  assert.deepEqual(lifecycleErrors, []);
}

await testEditorRuntimeBehavior();
await testTabCloseRecoveryLifecycle();
console.log('PASS extension media editor runtime behavior');

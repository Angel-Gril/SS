import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import vm from 'node:vm';

const extensionRoot = 'extensions/ss-erp';
const corePath = `${extensionRoot}/shared/ai-media/image-mask-core.js`;
assert.ok(fs.existsSync(corePath), 'extension mask core should exist');

const coreSource = fs.readFileSync(corePath, 'utf8');
const coreContext = {
  Array,
  Error,
  Math,
  Number,
  Object,
  Set,
  String,
  TypeError,
  Uint8Array,
  Uint8ClampedArray,
};
coreContext.globalThis = coreContext;
vm.runInNewContext(coreSource, coreContext, { filename: corePath });
const maskApi = coreContext.SS_ERP_IMAGE_MASK_CORE;
assert.equal(typeof maskApi?.createMask, 'function');
assert.equal(maskApi.MASK_SEMANTICS, 'WHITE_EDIT_BLACK_PRESERVE_V1');

const mask = maskApi.createMask({ width: 7, height: 5, maxHistory: 8 });
assert.deepEqual(JSON.parse(JSON.stringify(mask.state())), {
  width: 7,
  height: 5,
  strokeCount: 0,
  pointCount: 0,
  activePointCount: 0,
  budgetExhausted: false,
  canBeginStroke: true,
  hasPaint: false,
  dirty: false,
  canUndo: false,
  canRedo: false,
});

mask.beginStroke({ mode: 'paint', brushSize: 2, x: 1, y: 2 });
mask.extendStroke({ x: 5, y: 2 });
assert.equal(mask.endStroke(), true);
let commands = mask.commands();
assert.equal(commands.length, 1);
assert.equal(commands[0].mode, 'paint');
assert.deepEqual(plain(commands[0].points), [
  { x: 1 / 7, y: 2 / 5 },
  { x: 5 / 7, y: 2 / 5 },
]);
assert.equal(commands[0].brushSize, 2 / 5);
assert.equal(mask.state().hasPaint, true);
assert.equal(mask.state().dirty, true);

assert.equal(mask.undo(), true);
assert.equal(mask.commands().length, 0);
assert.equal(mask.state().dirty, true);
assert.equal(mask.state().canRedo, true);
assert.equal(mask.redo(), true);
assert.deepEqual(plain(mask.commands()), plain(commands));

mask.beginStroke({ mode: 'erase', brushSize: 2, x: 3, y: 2 });
mask.endStroke();
assert.equal(mask.commands().at(-1).mode, 'erase');
assert.equal(mask.undo(), true);
assert.equal(mask.commands().length, 1);

assert.equal(mask.clear(), true);
assert.equal(mask.commands().length, 0);
assert.equal(mask.undo(), true);
assert.equal(mask.commands().length, 1);

const allWhite = maskApi.createMask({ width: 3, height: 3 });
allWhite.beginStroke({ mode: 'paint', brushSize: 10, x: 1, y: 1 });
allWhite.endStroke();
assert.equal(allWhite.commands()[0].brushSize, 10 / 3);

assert.throws(() => maskApi.createMask({ width: 0, height: 3 }), /dimensions/u);
assert.throws(() => maskApi.createMask({ width: 10000, height: 10000 }), /dimensions/u);
assert.equal(maskApi.createMask({ width: 4000, height: 3000 }).state().width, 4000);
assert.throws(() => maskApi.createMask({ width: 4001, height: 3000 }), /dimensions/u);
assert.throws(() => maskApi.createMask({ width: 21, height: 1 }), /dimensions/u);
assert.throws(() => maskApi.createMask({ width: 1, height: 21 }), /dimensions/u);
assert.throws(() => maskApi.createMask({ width: 16385, height: 1000 }), /dimensions/u);

const boundedStroke = maskApi.createMask({ width: 10, height: 10 });
boundedStroke.beginStroke({ mode: 'paint', brushSize: 1, x: 0, y: 0 });
for (let index = 1; index < 4096; index += 1) {
  assert.equal(boundedStroke.extendStroke({
    x: index % 10,
    y: Math.floor(index / 10) % 10,
  }), true);
}
assert.equal(boundedStroke.extendStroke({ x: 6, y: 9 }), false);
assert.equal(boundedStroke.endStroke(), true);
assert.equal(boundedStroke.undo(), true);

assert.ok(Number.isSafeInteger(maskApi.MAX_STROKES) && maskApi.MAX_STROKES > 0);
assert.ok(Number.isSafeInteger(maskApi.MAX_TOTAL_POINTS)
  && maskApi.MAX_TOTAL_POINTS >= maskApi.MAX_STROKE_POINTS);
const strokeBudget = maskApi.createMask({ width: 10, height: 10 });
for (let index = 0; index < maskApi.MAX_STROKES; index += 1) {
  assert.equal(strokeBudget.beginStroke({
    mode: 'paint', brushSize: 1, x: index % 2 ? 10 : 0, y: 0,
  }), true);
  assert.equal(strokeBudget.endStroke(), true);
}
assert.equal(strokeBudget.state().strokeCount, maskApi.MAX_STROKES);
assert.equal(strokeBudget.state().budgetExhausted, true);
assert.equal(strokeBudget.state().canBeginStroke, false);
assert.equal(strokeBudget.beginStroke({ mode: 'paint', brushSize: 1, x: 5, y: 5 }), false);
assert.equal(strokeBudget.undo(), true);
assert.equal(strokeBudget.state().budgetExhausted, false);
assert.equal(strokeBudget.beginStroke({ mode: 'paint', brushSize: 1, x: 5, y: 5 }), true);
assert.equal(strokeBudget.endStroke(), true);

const pointBudget = maskApi.createMask({ width: 10, height: 10 });
let remainingPoints = maskApi.MAX_TOTAL_POINTS;
while (remainingPoints > 0) {
  const pointsInStroke = Math.min(maskApi.MAX_STROKE_POINTS, remainingPoints);
  assert.equal(pointBudget.beginStroke({ mode: 'paint', brushSize: 1, x: 0, y: 0 }), true);
  for (let index = 1; index < pointsInStroke; index += 1) {
    assert.equal(pointBudget.extendStroke({ x: index % 2 ? 10 : 0, y: 10 }), true);
  }
  assert.equal(pointBudget.endStroke(), true);
  remainingPoints -= pointsInStroke;
}
assert.equal(pointBudget.state().pointCount, maskApi.MAX_TOTAL_POINTS);
assert.equal(pointBudget.state().budgetExhausted, true);
assert.equal(pointBudget.beginStroke({ mode: 'erase', brushSize: 1, x: 5, y: 5 }), false);
assert.equal(pointBudget.undo(), true);
assert.ok(pointBudget.state().pointCount < maskApi.MAX_TOTAL_POINTS);
assert.equal(pointBudget.state().canBeginStroke, true);

const retainedStrokes = maskApi.createMask({ width: 10, height: 10, maxHistory: 100 });
for (let index = 0; index < 150; index += 1) {
  retainedStrokes.beginStroke({ mode: 'paint', brushSize: 1, x: index % 10, y: index % 10 });
  retainedStrokes.endStroke();
}
assert.equal(retainedStrokes.commands().length, 150);
for (let index = 0; index < 100; index += 1) assert.equal(retainedStrokes.undo(), true);
assert.equal(retainedStrokes.commands().length, 50);
assert.equal(retainedStrokes.undo(), false);

const layoutPath = `${extensionRoot}/shared/ai-media/image-mask-layout.js`;
assert.ok(fs.existsSync(layoutPath), 'extension mask layout helper should exist');
const layoutContext = { Math, Number, Object, TypeError };
layoutContext.globalThis = layoutContext;
vm.runInNewContext(fs.readFileSync(layoutPath, 'utf8'), layoutContext, {
  filename: layoutPath,
});
const fitMaskStage = layoutContext.SS_ERP_IMAGE_MASK_LAYOUT?.fitStage;
assert.equal(typeof fitMaskStage, 'function');
assert.deepEqual(plain(fitMaskStage({
  sourceWidth: 2000, sourceHeight: 1000, availableWidth: 800, availableHeight: 600,
})), { width: 800, height: 400, scale: 0.4 });
assert.deepEqual(plain(fitMaskStage({
  sourceWidth: 1000, sourceHeight: 2000, availableWidth: 800, availableHeight: 600,
})), { width: 300, height: 600, scale: 0.3 });
const fitPreviewBitmap = layoutContext.SS_ERP_IMAGE_MASK_LAYOUT?.fitPreviewBitmap;
assert.equal(typeof fitPreviewBitmap, 'function');
const cappedPreview = plain(fitPreviewBitmap({
  cssWidth: 2000, cssHeight: 1000, pixelRatio: 2, maxPixels: 1_500_000,
}));
assert.ok(cappedPreview.width * cappedPreview.height <= 1_500_000);
assert.ok(cappedPreview.width < 4000);
assert.deepEqual(plain(fitPreviewBitmap({
  cssWidth: 400, cssHeight: 200, pixelRatio: 2, maxPixels: 1_500_000,
})), { width: 800, height: 400, scale: 2 });

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

const clientPath = `${extensionRoot}/shared/erp-adapter/listing-workflow-client.js`;
const clientSource = fs.readFileSync(clientPath, 'utf8');
const clientContext = {
  Array,
  Boolean,
  Date,
  Error,
  Map,
  Math,
  Number,
  Object,
  Promise,
  Set,
  String,
  TextEncoder,
  TypeError,
  URL,
  URLSearchParams,
  Uint8Array,
  crypto: webcrypto,
};
clientContext.globalThis = clientContext;
vm.runInNewContext(clientSource, clientContext, { filename: clientPath });

{
  const posts = [];
  const client = clientContext.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
    transport: {
      async get() { throw new Error('unexpected GET'); },
      async post(path, body, options) {
        posts.push({ path, body, options });
        if (path.endsWith('/media-edit-source')) {
          return { state: 'response', status: 200, body: { code: 1, data: {
            contractVersion: 'extension-media-edit-source/v1',
            sourceMediaKey: 'main-image',
            sourceAsset: {
              id: 'source-asset-1',
              url: 'https://cdn.example/source.png',
              mimeType: 'image/png',
              width: 7,
              height: 5,
            },
            maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
            maxMaskBytes: 20 * 1024 * 1024,
          } } };
        }
        return { state: 'response', status: 201, body: {
          code: 1,
          replayed: false,
          data: {
            contractVersion: 'extension-media-edit-mask/v1',
            sourceMediaKey: 'main-image',
            sourceAssetId: 'source-asset-1',
            maskAssetId: 'mask-asset-1',
            url: 'https://cdn.example/mask.png',
            mimeType: 'image/png',
            width: 7,
            height: 5,
            maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
            editPixelCount: 12,
            preservedPixelCount: 23,
            featheredPixelCount: 4,
          },
        } };
      },
    },
  });
  const base = {
    snapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    shopId: 'shop-1',
    listingWorkflowId: 'listing-1',
    revision: 7,
    draftVersion: 3,
    sourceMediaKey: 'main-image',
  };
  const prepared = await client.prepareMediaEditSource(base);
  assert.equal(prepared.state, 'ready');
  assert.equal(prepared.sourceAsset.width, 7);
  assert.deepEqual(plain(posts[0]), {
    path: '/api/extension-device/source-workbench/media-edit-source',
    body: base,
    options: { requiredScope: 'media:execute' },
  });

  const maskDataUrl = 'data:image/png;base64,iVBORw0KGgo=';
  const uploaded = await client.uploadMediaEditMask({
    ...base,
    maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
    maskDataUrl,
    expectedWidth: 7,
    expectedHeight: 5,
    maxMaskBytes: 20 * 1024 * 1024,
  });
  assert.equal(uploaded.state, 'ready');
  assert.equal(uploaded.maskAssetId, 'mask-asset-1');
  assert.equal(uploaded.replayed, false);
  assert.deepEqual(plain(posts[1]), {
    path: '/api/extension-device/source-workbench/media-edit-mask',
    body: {
      ...base,
      maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
      maskDataUrl,
    },
    options: { requiredScope: 'media:execute' },
  });

  const malformedClient = clientContext.SS_ERP_LISTING_WORKFLOW_CLIENT.createClient({
    transport: {
      async get() { throw new Error('unexpected GET'); },
      async post() {
        return { state: 'response', status: 201, body: {
          code: 1,
          replayed: false,
          data: {
            contractVersion: 'extension-media-edit-mask/v1',
            sourceMediaKey: 'main-image',
            sourceAssetId: 'source-asset-1',
            maskAssetId: 'mask-asset-2',
            url: 'https://cdn.example/mask-2.png',
            mimeType: 'image/png',
            width: 7,
            height: 5,
            maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
            editPixelCount: 2,
            preservedPixelCount: 33,
            featheredPixelCount: 3,
          },
        } };
      },
    },
  });
  await assert.rejects(() => malformedClient.uploadMediaEditMask({
    ...base,
    maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
    maskDataUrl,
    expectedWidth: 7,
    expectedHeight: 5,
    maxMaskBytes: 20 * 1024 * 1024,
  }), /invalid media edit mask response/u);
}

{
  const sessionPath = `${extensionRoot}/shared/erp-adapter/source-workflow-device-session.js`;
  const sessionSource = fs.readFileSync(sessionPath, 'utf8');
  const calls = [];
  const scheduledDelays = [];
  const sessionContext = {
    AbortController,
    Array,
    Boolean,
    Error,
    JSON,
    Math,
    Number,
    Object,
    Promise,
    Set,
    String,
    TextDecoder,
    TextEncoder,
    TypeError,
    URL,
    clearTimeout() {},
    setTimeout(_callback, delay) {
      scheduledDelays.push(delay);
      return scheduledDelays.length;
    },
  };
  sessionContext.globalThis = sessionContext;
  vm.runInNewContext(sessionSource, sessionContext, { filename: sessionPath });
  const transport = sessionContext.SS_ERP_SOURCE_WORKFLOW_DEVICE_SESSION.createTransport({
    credentials: {
      async beginOperation() {
        return {
          state: 'paired',
          baseUrl: 'https://erp.example',
          accessToken: 'access-token',
          scopes: ['media:execute'],
        };
      },
      async isOperationCurrent() { return true; },
    },
    async fetchImpl(url, options) {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        headers: { get() { return null; } },
        async text() { return JSON.stringify({ code: 1 }); },
      };
    },
  });
  const oversizedForNormalCommand = 'x'.repeat(70 * 1024);
  await transport.post(
    '/api/extension-device/source-workbench/media-edit-source',
    { sourceMediaKey: 'main-image' },
    { requiredScope: 'media:execute' },
  );
  assert.equal(scheduledDelays[0], 60_000);
  await transport.post(
    '/api/extension-device/source-workbench/media-edit-mask',
    { maskDataUrl: oversizedForNormalCommand },
    { requiredScope: 'media:execute' },
  );
  assert.equal(calls.length, 2);
  assert.equal(scheduledDelays[1], 60_000);
  await assert.rejects(() => transport.post(
    '/api/extension-device/source-workbench/media-edit-source',
    { payload: oversizedForNormalCommand },
    { requiredScope: 'media:execute' },
  ), /too large/u);
  await assert.rejects(() => transport.post(
    '/api/extension-device/media-workflows/execute',
    { payload: oversizedForNormalCommand },
    { requiredScope: 'media:execute' },
  ), /too large/u);
  await assert.rejects(() => transport.post(
    '/api/extension-device/source-workbench/media-edit-mask?unsafe=1',
    { maskDataUrl: 'small' },
    { requiredScope: 'media:execute' },
  ), /path is invalid/u);
  await assert.rejects(() => transport.post(
    '/api/extension-device/source-workbench/media-edit-mask',
    { maskDataUrl: 'x'.repeat(30 * 1024 * 1024 + 1) },
    { requiredScope: 'media:execute' },
  ), /too large/u);
}

{
  const contractPath = `${extensionRoot}/shared/erp-adapter/source-media-editor-session.js`;
  const coordinatorPath = `${extensionRoot}/shared/erp-adapter/source-media-editor-coordinator.js`;
  assert.ok(fs.existsSync(contractPath), 'media editor session contract should exist');
  assert.ok(fs.existsSync(coordinatorPath), 'media editor coordinator should exist');
  const securityContext = {
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
    TextEncoder,
    TypeError,
    URL,
    Uint8Array,
  };
  securityContext.globalThis = securityContext;
  vm.runInNewContext(fs.readFileSync(contractPath, 'utf8'), securityContext, {
    filename: contractPath,
  });
  vm.runInNewContext(fs.readFileSync(coordinatorPath, 'utf8'), securityContext, {
    filename: coordinatorPath,
  });
  const contract = securityContext.SS_ERP_SOURCE_MEDIA_EDITOR_SESSION;
  const coordinatorApi = securityContext.SS_ERP_SOURCE_MEDIA_EDITOR_COORDINATOR;
  assert.equal(typeof contract?.bindSender, 'function');
  assert.equal(typeof coordinatorApi?.createCoordinator, 'function');

  const sessionState = {};
  const sessionStorage = {
    async get(keys) {
      return Object.fromEntries(keys.map((key) => [key, sessionState[key]]));
    },
    async set(values) { Object.assign(sessionState, plain(values)); },
  };
  const createdWindows = [];
  const updatedTabs = [];
  let nextEditorTabId = 30;
  let now = Date.parse('2026-07-23T01:00:00.000Z');
  const storageKey = 'test:media-editor-sessions';
  const coordinatorOptions = {
    contract,
    storage: sessionStorage,
    windows: {
      async create(input) {
        createdWindows.push(plain(input));
        const tabId = nextEditorTabId;
        nextEditorTabId += 1;
        return { id: 20 + createdWindows.length, tabs: [{ id: tabId }] };
      },
      async remove() {},
    },
    tabs: {
      async query() { return [{ id: 30 }]; },
      async update(tabId, input) {
        updatedTabs.push({ tabId, input: plain(input) });
      },
    },
    runtime: { getURL: (path) => `chrome-extension://extension-id/${path}` },
    crypto: webcrypto,
    storageKey,
    ttlMs: 30 * 60 * 1000,
    submitLeaseMs: 5 * 60 * 1000,
    minimumSubmitRemainingMs: 4 * 60 * 1000,
    limit: 10,
    now: () => now,
    launchPath: 'pages/media-confirm-launch.html',
    editorPath: 'pages/media-editor.html',
  };
  assert.throws(() => coordinatorApi.createCoordinator({
    ...coordinatorOptions,
    minimumSubmitRemainingMs: coordinatorOptions.submitLeaseMs + 1,
  }), /options are invalid/u);
  assert.throws(() => coordinatorApi.createCoordinator({
    ...coordinatorOptions,
    minimumSubmitRemainingMs: 0,
  }), /options are invalid/u);
  let coordinator = coordinatorApi.createCoordinator(coordinatorOptions);
  const frozenOpen = {
    platform: '1688',
    sourceProductId: 'source-1',
    snapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    shopId: 'shop-1',
    listingWorkflowId: 'listing-1',
    revision: 7,
    draftVersion: 3,
    operation: 'INPAINT',
    sourceMediaKeys: ['main-image'],
    preparedSource: {
      sourceMediaKey: 'main-image',
      sourceAssetId: 'source-asset-1',
      mimeType: 'image/png',
      width: 7,
      height: 5,
      maskSemantics: 'WHITE_EDIT_BLACK_PRESERVE_V1',
      maxMaskBytes: 20 * 1024 * 1024,
    },
    sourceTabId: 9,
  };
  const openResult = await coordinator.open(frozenOpen);
  frozenOpen.revision = 99;
  frozenOpen.sourceMediaKeys[0] = 'mutated-client-source';
  frozenOpen.preparedSource.sourceAssetId = 'mutated-client-asset';
  assert.equal(openResult.state, 'editor_opened');
  assert.deepEqual(createdWindows, [{
    url: 'chrome-extension://extension-id/pages/media-confirm-launch.html',
    type: 'popup',
    width: 1180,
    height: 860,
    focused: true,
  }]);
  const records = sessionState[storageKey];
  const nonce = Object.keys(records)[0];
  assert.match(nonce, /^[a-f0-9]{64}$/u);
  assert.deepEqual(updatedTabs, [{
    tabId: 30,
    input: {
      url: `chrome-extension://extension-id/pages/media-editor.html#nonce=${nonce}`,
    },
  }]);
  assert.doesNotMatch(JSON.stringify(records), /provider|model|api.?key|secret/iu);
  assert.equal(records[nonce].operation, 'INPAINT');
  assert.deepEqual(records[nonce].sourceMediaKeys, ['main-image']);
  assert.equal(records[nonce].snapshotId, 'snapshot-1');
  assert.equal(records[nonce].supplyGoodsId, 'goods-1');
  assert.equal(records[nonce].shopId, 'shop-1');
  assert.equal(records[nonce].revision, 7);
  assert.equal(records[nonce].draftVersion, 3);
  assert.equal(records[nonce].preparedSource.sourceAssetId, 'source-asset-1');
  assert.equal(records[nonce].submitLeaseExpiresAt, null);
  assert.doesNotMatch(JSON.stringify(records), /prompt|negativePrompt/iu);

  const wrongTab = {
    tab: { id: 31 }, frameId: 0, documentId: 'editor-document-1',
  };
  const childFrame = {
    tab: { id: 30 }, frameId: 1, documentId: 'editor-document-1',
  };
  const editorSender = {
    tab: { id: 30 }, frameId: 0, documentId: 'editor-document-1',
  };
  assert.equal(await coordinator.claim(nonce, wrongTab), null);
  assert.equal(await coordinator.claim(nonce, childFrame), null);
  const claimed = await coordinator.claim(nonce, editorSender);
  assert.equal(claimed.editorDocumentId, 'editor-document-1');
  assert.equal(await coordinator.claim(nonce, {
    ...editorSender, documentId: 'editor-document-2',
  }), null);

  coordinator = coordinatorApi.createCoordinator(coordinatorOptions);
  assert.equal((await coordinator.read(nonce)).operation, 'INPAINT');

  await assert.rejects(() => coordinator.submit(
    nonce,
    editorSender,
    async (session, checkpointMask) => {
      assert.equal(session.maskCheckpoint, null);
      await checkpointMask({
        maskSha256: 'a'.repeat(64),
        maskAssetId: 'mask-asset-1',
      });
      throw new Error('workflow response lost');
    },
  ), /response lost/u);
  const checkpointed = await coordinator.read(nonce);
  assert.deepEqual(plain(checkpointed.maskCheckpoint), {
    maskSha256: 'a'.repeat(64),
    maskAssetId: 'mask-asset-1',
    sourceMediaKey: 'main-image',
    sourceAssetId: 'source-asset-1',
    sourceWidth: 7,
    sourceHeight: 5,
  });

  now = checkpointed.expiresAt + 30 * 1000;
  let retryCalls = 0;
  const completed = await coordinator.submit(
    nonce,
    editorSender,
    async (session) => {
      retryCalls += 1;
      assert.equal(session.maskCheckpoint.maskAssetId, 'mask-asset-1');
      assert.ok(now > session.expiresAt);
      assert.ok(session.submitLeaseExpiresAt - now >= coordinatorOptions.minimumSubmitRemainingMs);
      return {
        replay: false,
        result: {
          workflowId: 'workflow-1',
          operation: 'INPAINT',
          status: 'QUEUED',
          revision: 1,
        },
      };
    },
  );
  assert.equal(completed.state, 'completed');
  assert.equal(completed.replay, false);
  const completedSession = await coordinator.read(nonce);
  assert.ok(completedSession.completedAt > completedSession.expiresAt);
  assert.equal(
    completedSession.submitLeaseExpiresAt,
    completedSession.expiresAt + coordinatorOptions.submitLeaseMs,
  );
  const replayed = await coordinator.submit(nonce, editorSender, async () => {
    retryCalls += 1;
    throw new Error('completed editor session must not execute twice');
  });
  assert.equal(replayed.replay, true);
  assert.equal(retryCalls, 1);
  assert.equal(replayed.result.workflowId, 'workflow-1');

  const openPromptSession = async (sourceProductId, sourceTabId) => coordinator.open({
    platform: '1688',
    sourceProductId,
    snapshotId: `snapshot-${sourceProductId}`,
    supplyGoodsId: `goods-${sourceProductId}`,
    shopId: 'shop-1',
    listingWorkflowId: `listing-${sourceProductId}`,
    revision: 1,
    draftVersion: 1,
    operation: 'FULL_EDIT',
    sourceMediaKeys: ['main-image'],
    preparedSource: null,
    sourceTabId,
  });
  await openPromptSession('source-edge', 12);
  const edgeNonce = Object.keys(sessionState[storageKey]).find((value) => (
    sessionState[storageKey][value].sourceProductId === 'source-edge'
  ));
  assert.ok(edgeNonce);
  const edgeSender = {
    tab: { id: sessionState[storageKey][edgeNonce].editorTabId },
    frameId: 0,
    documentId: 'editor-document-edge',
  };
  assert.ok(await coordinator.claim(edgeNonce, edgeSender));
  let edgeExecuteCalls = 0;
  await assert.rejects(() => coordinator.submit(edgeNonce, edgeSender, async () => {
    edgeExecuteCalls += 1;
    throw new Error('edge workflow response lost');
  }), /response lost/u);
  const leasedEdgeSession = await coordinator.read(edgeNonce);
  now = leasedEdgeSession.submitLeaseExpiresAt
    - coordinatorOptions.minimumSubmitRemainingMs + 1;
  await assert.rejects(() => coordinator.submit(edgeNonce, edgeSender, async () => {
    edgeExecuteCalls += 1;
    throw new Error('near-expiry execute must not run');
  }), /即将失效/u);
  assert.equal(edgeExecuteCalls, 1);
  assert.deepEqual(plain(await coordinator.cancel(edgeNonce, edgeSender)), {
    state: 'recovery_required',
  });
  assert.ok(await coordinator.read(edgeNonce));

  await openPromptSession('source-2', 10);
  await openPromptSession('source-3', 11);
  const activeNonces = Object.keys(sessionState[storageKey]).filter((value) => (
    ['source-2', 'source-3'].includes(sessionState[storageKey][value].sourceProductId)
  ));
  assert.equal(activeNonces.length, 2);
  const firstSender = {
    tab: { id: sessionState[storageKey][activeNonces[0]].editorTabId },
    frameId: 0,
    documentId: 'editor-document-2',
  };
  const secondSender = {
    tab: { id: sessionState[storageKey][activeNonces[1]].editorTabId },
    frameId: 0,
    documentId: 'editor-document-3',
  };
  assert.ok(await coordinator.claim(activeNonces[0], firstSender));
  assert.ok(await coordinator.claim(activeNonces[1], secondSender));
  let releaseFirst;
  let signalFirstStarted;
  const firstStarted = new Promise((resolve) => { signalFirstStarted = resolve; });
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const firstSubmit = coordinator.submit(activeNonces[0], firstSender, async () => {
    signalFirstStarted();
    await firstGate;
    return {
      replay: false,
      result: {
        workflowId: 'workflow-source-2', operation: 'FULL_EDIT', status: 'QUEUED', revision: 1,
      },
    };
  });
  await firstStarted;
  const secondSubmit = await coordinator.submit(activeNonces[1], secondSender, async () => ({
    replay: false,
    result: {
      workflowId: 'workflow-source-3', operation: 'FULL_EDIT', status: 'QUEUED', revision: 1,
    },
  }));
  assert.equal(secondSubmit.result.workflowId, 'workflow-source-3');
  releaseFirst();
  assert.equal((await firstSubmit).result.workflowId, 'workflow-source-2');

  await openPromptSession('source-overlap', 13);
  const overlapNonce = Object.keys(sessionState[storageKey]).find((value) => (
    sessionState[storageKey][value].sourceProductId === 'source-overlap'
  ));
  assert.ok(overlapNonce);
  const overlapSender = {
    tab: { id: sessionState[storageKey][overlapNonce].editorTabId },
    frameId: 0,
    documentId: 'editor-document-overlap',
  };
  assert.ok(await coordinator.claim(overlapNonce, overlapSender));
  let overlapExecuteCalls = 0;
  let releaseOverlap;
  let signalOverlapStarted;
  const overlapStarted = new Promise((resolve) => { signalOverlapStarted = resolve; });
  const overlapGate = new Promise((resolve) => { releaseOverlap = resolve; });
  const firstOverlapSubmit = coordinator.submit(overlapNonce, overlapSender, async () => {
    overlapExecuteCalls += 1;
    signalOverlapStarted();
    await overlapGate;
    return {
      replay: false,
      result: {
        workflowId: 'workflow-source-overlap',
        operation: 'FULL_EDIT',
        status: 'QUEUED',
        revision: 1,
      },
    };
  });
  await overlapStarted;
  const secondOverlapSubmit = coordinator.submit(overlapNonce, overlapSender, async () => {
    overlapExecuteCalls += 1;
    throw new Error('overlapping submit must replay the first completion');
  });
  releaseOverlap();
  const [firstOverlapResult, secondOverlapResult] = await Promise.all([
    firstOverlapSubmit,
    secondOverlapSubmit,
  ]);
  assert.equal(overlapExecuteCalls, 1);
  assert.equal(firstOverlapResult.replay, false);
  assert.equal(secondOverlapResult.replay, true);
  assert.equal(secondOverlapResult.result.workflowId, 'workflow-source-overlap');

  await openPromptSession('source-submit-cancel', 14);
  const submitCancelNonce = Object.keys(sessionState[storageKey]).find((value) => (
    sessionState[storageKey][value].sourceProductId === 'source-submit-cancel'
  ));
  assert.ok(submitCancelNonce);
  const submitCancelSender = {
    tab: { id: sessionState[storageKey][submitCancelNonce].editorTabId },
    frameId: 0,
    documentId: 'editor-document-submit-cancel',
  };
  assert.ok(await coordinator.claim(submitCancelNonce, submitCancelSender));
  let releaseSubmitCancel;
  let signalSubmitCancelStarted;
  const submitCancelStarted = new Promise((resolve) => { signalSubmitCancelStarted = resolve; });
  const submitCancelGate = new Promise((resolve) => { releaseSubmitCancel = resolve; });
  const orderedSubmit = coordinator.submit(submitCancelNonce, submitCancelSender, async () => {
    signalSubmitCancelStarted();
    await submitCancelGate;
    return {
      replay: false,
      result: {
        workflowId: 'workflow-source-submit-cancel',
        operation: 'FULL_EDIT',
        status: 'QUEUED',
        revision: 1,
      },
    };
  });
  await submitCancelStarted;
  let cancelSettled = false;
  const orderedCancel = coordinator.cancel(submitCancelNonce, submitCancelSender).then((result) => {
    cancelSettled = true;
    return result;
  });
  await Promise.resolve();
  assert.equal(cancelSettled, false);
  releaseSubmitCancel();
  const [orderedSubmitResult, orderedCancelResult] = await Promise.all([
    orderedSubmit,
    orderedCancel,
  ]);
  assert.equal(orderedSubmitResult.result.workflowId, 'workflow-source-submit-cancel');
  assert.deepEqual(plain(orderedCancelResult), { state: 'completed' });
  assert.equal((await coordinator.read(submitCancelNonce)).completion.workflowId,
    'workflow-source-submit-cancel');
}

{
  const htmlPath = `${extensionRoot}/pages/media-editor.html`;
  const cssPath = `${extensionRoot}/pages/media-editor.css`;
  const pagePath = `${extensionRoot}/pages/media-editor.js`;
  for (const path of [htmlPath, cssPath, pagePath]) {
    assert.ok(fs.existsSync(path), `extension media editor asset should exist: ${path}`);
  }
  const html = fs.readFileSync(htmlPath, 'utf8');
  const css = fs.readFileSync(cssPath, 'utf8');
  const page = fs.readFileSync(pagePath, 'utf8');
  assert.match(html, /media-editor\.css/u);
  assert.match(
    html,
    /shared\/ai-media\/image-mask-core\.js[\s\S]*shared\/ai-media\/image-mask-layout\.js[\s\S]*media-editor\.js/u,
  );
  assert.doesNotMatch(html, /<script(?!\s+src=)[^>]*>/iu);
  for (const id of [
    'paintTool', 'eraseTool', 'brushSize', 'undoButton', 'redoButton',
    'clearButton', 'sourceImage', 'maskCanvas', 'promptInput', 'negativePromptInput',
    'submitButton', 'cancelButton',
  ]) {
    assert.match(html, new RegExp(`id=["']${id}["']`, 'u'));
  }
  assert.match(html, /id=["']promptInput["'][^>]*\brequired\b/u);
  assert.match(css, /\.editor-workspace\s*\{/u);
  assert.match(css, /\.editor-workspace\.is-prompt-only\s*\{/u);
  assert.match(css, /\.canvas-stage\s*\{/u);
  assert.match(css, /\.tool-button\.is-active/u);
  assert.match(css, /\[hidden\]\s*\{[\s\S]*?display:\s*none\s*!important/u);
  assert.match(css, /:focus-visible/u);

  assert.match(page, /WHITE_EDIT_BLACK_PRESERVE_V1/u);
  assert.match(page, /IMAGE_TO_IMAGE/u);
  assert.match(page, /FULL_EDIT/u);
  assert.match(page, /operation\s*===\s*['"]INPAINT['"]/u);
  assert.match(page, /maskTools\.hidden\s*=\s*!inpaint/u);
  assert.match(page, /canvasWorkspace\.hidden\s*=\s*!inpaint/u);
  assert.match(page, /maskMetrics\.hidden\s*=\s*!inpaint/u);
  assert.match(page, /setPointerCapture/u);
  assert.match(page, /lostpointercapture/u);
  assert.match(page, /ResizeObserver/u);
  assert.match(page, /canvasStage\.style\.width/u);
  assert.match(page, /canvasStage\.style\.height/u);
  assert.match(page, /mask\.undo\(\)/u);
  assert.match(page, /mask\.redo\(\)/u);
  assert.match(page, /mask\.clear\(\)/u);
  assert.match(page, /MAX_PREVIEW_PIXELS\s*=\s*1_500_000/u);
  assert.match(page, /MAX_EXPORT_SCAN_PIXELS\s*=\s*1_000_000/u);
  assert.match(page, /fitPreviewBitmap/u);
  assert.match(page, /mask\.commands\(true\)/u);
  assert.match(page, /requestAnimationFrame/u);
  assert.match(page, /exportCanvas\.width\s*=\s*source\.width/u);
  assert.match(page, /exportCanvas\.height\s*=\s*source\.height/u);
  assert.match(page, /toBlob\([\s\S]*?\},\s*['"]image\/png['"]/u);
  assert.match(page, /Math\.min\(window\.devicePixelRatio\s*\|\|\s*1,\s*2\)/u);
  assert.doesNotMatch(page, /mask\.pixels\(\)|mask\.rgba\(\)|createImageData/u);
  assert.match(page, /getImageData\(0,\s*y,\s*width,\s*rows\)/u);
  assert.doesNotMatch(page, /getImageData\(0,\s*0,\s*source\.width,\s*source\.height\)/u);
  assert.match(page, /beforeunload/u);
  assert.match(page, /window\.confirm/u);
  assert.match(page, /event\.isTrusted\s*!==\s*true/u);
  const refreshControlsSource = page.slice(
    page.indexOf('function refreshControls()'),
    page.indexOf('function refreshDraftStatus()'),
  );
  assert.match(refreshControlsSource, /activePointerId\s*!==\s*null/u);
  const pointerDownSource = page.slice(
    page.indexOf("maskCanvas.addEventListener('pointerdown'"),
    page.indexOf("maskCanvas.addEventListener('pointermove'"),
  );
  assert.match(pointerDownSource, /activePointerId\s*=\s*event\.pointerId/u);
  assert.match(pointerDownSource, /refreshControls\(\)/u);
  const submitHandlerSource = page.slice(
    page.indexOf("submitButton.addEventListener('click'"),
    page.indexOf("cancelButton.addEventListener('click'"),
  );
  assert.match(submitHandlerSource, /activePointerId\s*!==\s*null/u);
  assert.match(page, /ss-erp:source-listing-workbench-media-editor-read/u);
  assert.match(page, /ss-erp:source-listing-workbench-media-editor-submit/u);
  assert.match(page, /ss-erp:source-listing-workbench-media-editor-cancel/u);
  assert.match(page, /classList\.toggle\(['"]is-prompt-only['"],\s*!inpaint\)/u);
  const dirtyGuard = page.slice(
    page.indexOf('function hasUnsubmittedChanges'),
    page.indexOf('function formatCount'),
  );
  assert.match(dirtyGuard, /promptInput\.value\s*!==\s*initialPrompt/u);
  assert.match(dirtyGuard, /negativePromptInput\.value\s*!==\s*initialNegativePrompt/u);
  assert.match(dirtyGuard, /mask\.state\(\)\.dirty/u);

  const submitStart = page.indexOf('var submitMessage = {');
  const submitObjectEnd = page.indexOf('\n    };', submitStart);
  const submitObject = page.slice(submitStart, submitObjectEnd);
  const submitFlow = page.slice(submitStart, page.indexOf('prepareMessage.then(send)', submitStart));
  assert.ok(submitStart >= 0 && submitObjectEnd > submitStart);
  assert.match(submitObject, /operation:\s*editor\.operation/u);
  assert.match(submitObject, /prompt:\s*promptInput\.value/u);
  assert.match(submitObject, /negativePrompt:\s*negativePromptInput\.value/u);
  assert.doesNotMatch(submitObject, /maskDataUrl/u);
  assert.match(
    submitFlow,
    /isInpaint\(\)[\s\S]*?exportMaskDataUrl\(\)[\s\S]*?submitMessage\.maskDataUrl\s*=\s*maskDataUrl/u,
  );
  assert.doesNotMatch(submitFlow, /shopId|revision|draftVersion|provider|model|api.?key|secret/iu);

  const manifest = JSON.parse(fs.readFileSync(`${extensionRoot}/manifest.json`, 'utf8'));
  const webResources = (manifest.web_accessible_resources || [])
    .flatMap((group) => group.resources || []);
  assert.equal(webResources.includes('pages/media-editor.html'), false);
}

{
  const policyPath = `${extensionRoot}/shared/message-security/runtime-message-policy.js`;
  const policyContext = { Array, Object, Set, String, URL };
  policyContext.globalThis = policyContext;
  vm.runInNewContext(fs.readFileSync(policyPath, 'utf8'), policyContext, {
    filename: policyPath,
  });
  const policy = policyContext.SS_ERP_RUNTIME_MESSAGE_POLICY;
  const extensionId = 'extension-id';
  const openType = 'ss-erp:source-listing-workbench-media-editor-open';
  const pageTypes = [
    'ss-erp:source-listing-workbench-media-editor-read',
    'ss-erp:source-listing-workbench-media-editor-submit',
    'ss-erp:source-listing-workbench-media-editor-cancel',
  ];
  const sourceUrl = 'https://detail.1688.com/offer/123.html';
  const sourceSender = {
    id: extensionId,
    url: sourceUrl,
    origin: 'https://detail.1688.com',
    tab: { id: 9, url: sourceUrl },
    frameId: 0,
    documentId: 'source-document',
  };
  const editorUrl = `chrome-extension://${extensionId}/pages/media-editor.html`;
  const editorSender = {
    id: extensionId,
    url: editorUrl,
    origin: `chrome-extension://${extensionId}`,
    tab: { id: 30, url: editorUrl },
    frameId: 0,
    documentId: 'editor-document',
  };
  const popupUrl = `chrome-extension://${extensionId}/pages/popup.html`;
  const popupSender = {
    id: extensionId,
    url: popupUrl,
    origin: `chrome-extension://${extensionId}`,
    tab: { id: 31, url: popupUrl },
    frameId: 0,
    documentId: 'popup-document',
  };
  const confirmUrl = `chrome-extension://${extensionId}/pages/media-confirm.html`;
  const confirmSender = {
    ...popupSender,
    url: confirmUrl,
    tab: { id: 32, url: confirmUrl },
    documentId: 'confirm-document',
  };
  for (const type of [openType, ...pageTypes]) {
    assert.equal(policy.isKnownRuntimeMessageType(type), true);
  }
  assert.equal(policy.isAllowedRuntimeMessageSender(openType, sourceSender, extensionId), true);
  assert.equal(policy.isAllowedRuntimeMessageSender(openType, editorSender, extensionId), false);
  assert.equal(policy.isAllowedRuntimeMessageSender(openType, popupSender, extensionId), false);
  for (const type of pageTypes) {
    assert.equal(policy.isAllowedRuntimeMessageSender(type, editorSender, extensionId), true);
    assert.equal(policy.isAllowedRuntimeMessageSender(type, sourceSender, extensionId), false);
    assert.equal(policy.isAllowedRuntimeMessageSender(type, popupSender, extensionId), false);
    assert.equal(policy.isAllowedRuntimeMessageSender(type, confirmSender, extensionId), false);
  }
}

{
  const worker = fs.readFileSync(`${extensionRoot}/background/service-worker.js`, 'utf8');
  const panel = fs.readFileSync(`${extensionRoot}/content/source-costing-panel.js`, 'utf8');
  assert.match(worker, /importScripts\(['"]\.\.\/shared\/erp-adapter\/source-media-editor-session\.js['"]\)/u);
  assert.match(worker, /importScripts\(['"]\.\.\/shared\/erp-adapter\/source-media-editor-coordinator\.js['"]\)/u);
  assert.match(worker, /importScripts\(['"]\.\.\/shared\/erp-adapter\/source-media-editor-lifecycle\.js['"]\)/u);
  assert.match(worker, /ss-erp:source-workbench:media-editor-sessions:v1/u);
  assert.match(worker, /chrome\.storage\.session/u);
  assert.match(
    worker,
    /SS_ERP_SOURCE_MEDIA_EDITOR_SUBMIT_MINIMUM_REMAINING_MS\s*=\s*4\s*\*\s*60\s*\*\s*1000/u,
  );
  assert.match(
    worker,
    /minimumSubmitRemainingMs:\s*SS_ERP_SOURCE_MEDIA_EDITOR_SUBMIT_MINIMUM_REMAINING_MS/u,
  );
  assert.match(worker, /registerSourceMediaEditorTabCleanup\(\)/u);
  assert.match(worker, /registerTabCleanup\(/u);
  for (const suffix of ['open', 'read', 'submit', 'cancel']) {
    assert.match(worker, new RegExp(
      `ss-erp:source-listing-workbench-media-editor-${suffix}`,
      'u',
    ));
  }
  const directMediaHandler = worker.slice(
    worker.indexOf('if (message.type === SS_ERP_SOURCE_WORKBENCH_MEDIA_COMMAND_MESSAGE)'),
    worker.indexOf('if (OZON_CALC_SETTINGS_WRITE_CHANNELS.has(message.type))'),
  );
  assert.ok(directMediaHandler.length > 0);
  assert.doesNotMatch(directMediaHandler, /message\.action\s*===\s*['"]CREATE_WORKFLOW['"]/u);
  assert.match(directMediaHandler, /CREATE_TRANSLATION/u);

  const createExecutor = worker.slice(
    worker.indexOf('async function executeSourceMediaCreateWorkflow'),
    worker.indexOf('async function submitSourceMediaEditor'),
  );
  assert.ok(createExecutor.length > 0);
  assert.match(createExecutor, /client\.createWorkflowCommand/u);
  assert.doesNotMatch(createExecutor, /getSourceMediaCreateIntentStore\(\)\.clear/u);

  const editorSubmit = worker.slice(
    worker.indexOf('async function submitSourceMediaEditor'),
    worker.indexOf('async function cancelSourceMediaEditor'),
  );
  assert.ok(editorSubmit.length > 0);
  assert.match(
    editorSubmit,
    /const operation\s*=\s*\[['"]IMAGE_TO_IMAGE['"],\s*['"]FULL_EDIT['"],\s*['"]INPAINT['"]\]/u,
  );
  assert.match(
    editorSubmit,
    /['"]type['"],\s*['"]nonce['"],\s*['"]operation['"],\s*['"]prompt['"],\s*['"]negativePrompt['"]/u,
  );
  assert.match(
    editorSubmit,
    /\.\.\.\(operation\s*===\s*['"]INPAINT['"]\s*\?\s*\[['"]maskDataUrl['"]\]\s*:\s*\[\]\)/u,
  );
  assert.match(editorSubmit, /session\.operation\s*!==\s*operation/u);
  assert.match(
    editorSubmit,
    /operation\s*===\s*['"]INPAINT['"]\s*&&\s*\(typeof message\.maskDataUrl\s*!==\s*['"]string['"]/u,
  );
  const prepareIndex = editorSubmit.indexOf('loadFrozenSourceMediaEditorAuthority');
  const uploadIndex = editorSubmit.indexOf('client.uploadMediaEditMask');
  const checkpointIndex = editorSubmit.indexOf('await saveMaskCheckpoint');
  const createIndex = editorSubmit.indexOf('executeSourceMediaCreateWorkflow');
  assert.ok(prepareIndex >= 0 && uploadIndex > prepareIndex);
  assert.ok(checkpointIndex > uploadIndex && createIndex > checkpointIndex);

  assert.match(panel, /async function openSourceWorkbenchMediaEditor/u);
  assert.match(panel, /ss-erp:source-listing-workbench-media-editor-open/u);
  assert.match(panel, /onOpenMediaEditor/u);
}

console.log('PASS extension media mask editor contract');

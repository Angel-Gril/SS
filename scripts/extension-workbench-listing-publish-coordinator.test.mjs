import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const SOURCE = await readFile(
  new URL(
    '../extensions/ss-erp/shared/publish/workbench-listing-publish-coordinator.js',
    import.meta.url,
  ),
  'utf8',
);

function loadApi() {
  const context = vm.createContext({ console, crypto: webcrypto, TextEncoder, URL });
  context.globalThis = context;
  context.self = context;
  vm.runInContext(SOURCE, context, { filename: 'workbench-listing-publish-coordinator.js' });
  return context.SS_ERP_WORKBENCH_LISTING_PUBLISH_COORDINATOR;
}

function plain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function createSessionStore() {
  const values = new Map();
  return {
    async get(key) {
      if (key === null) return plain(Object.fromEntries(values.entries()));
      if (Array.isArray(key)) {
        return Object.fromEntries(key.filter((name) => values.has(name)).map((name) => (
          [name, plain(values.get(name))]
        )));
      }
      return values.has(key) ? { [key]: plain(values.get(key)) } : {};
    },
    async set(input) {
      Object.entries(input).forEach(([key, value]) => values.set(key, plain(value)));
    },
    async remove(key) {
      (Array.isArray(key) ? key : [key]).forEach((name) => values.delete(name));
    },
    snapshot() { return plain(Object.fromEntries(values.entries())); },
  };
}

const CONTRACT_VERSION = 'extension-workbench-listing-publish/v1';
const PREVIEW_HASH = 'a'.repeat(64);
const REQUEST_HASH = 'b'.repeat(64);
const GRANT_TOKEN = 'g'.repeat(43);
const SECRET_SENTINEL = 'sk-secret-never-persist';

function request(executionMode = 'ERP_HOSTED', overrides = {}) {
  return {
    executionMode,
    binding: {
      shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 12, draftVersion: 9,
    },
    selectedMedia: [
      {
        scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assetId: 'asset-hosted-1',
      },
      {
        scope: 'PRODUCT', skuKey: null,
        slotKey: 'shared:detail:SCENE', assetId: 'asset-byok-1',
      },
    ],
    ...overrides,
  };
}

function previewData(input = request(), overrides = {}) {
  return {
    contractVersion: CONTRACT_VERSION,
    executionMode: input.executionMode,
    shopId: input.binding.shopId,
    workflowId: input.binding.workflowId,
    basisDraftRevision: input.binding.draftRevision,
    basisDraftVersion: input.binding.draftVersion,
    selectedMedia: plain(input.selectedMedia),
    currentDraftRevision: 12,
    currentDraftVersion: 9,
    previewHash: PREVIEW_HASH,
    selectedSkuKeys: ['sku-1'],
    orderedMedia: [
      {
        ordinal: 0, scope: 'PRODUCT', skuKey: null, slotKey: 'product:gallery:0',
        assetId: 'source-1', source: 'SOURCE',
      },
      {
        ordinal: 1, scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero',
        assetId: 'asset-hosted-1', source: 'GENERATED',
      },
      {
        ordinal: 2, scope: 'PRODUCT', skuKey: null, slotKey: 'shared:detail:SCENE',
        assetId: 'asset-byok-1', source: 'EDITED',
      },
    ],
    ...overrides,
  };
}

function envelope(input, idempotencyKey) {
  return {
    operation: 'OZON_PUBLISH',
    shopId: input.binding.shopId,
    workflowId: input.binding.workflowId,
    draftVersion: 9,
    idempotencyKey,
    command: {
      schemaVersion: 'ozon-publish-command/v1',
      draftRevision: 13,
      publishIntentId: 'publish-intent-1',
      selectedSkuKeys: ['sku-1'],
    },
  };
}

function response(status, body) {
  return { state: status >= 400 ? 'http_error' : 'response', status, body };
}

function previewResponse(input, overrides = {}) {
  return response(200, { code: 1, data: previewData(input, overrides) });
}

function prepareResponse(input, body) {
  return response(201, {
    code: 1,
    data: {
      contractVersion: CONTRACT_VERSION,
      previewHash: PREVIEW_HASH,
      requestHash: REQUEST_HASH,
      replayed: false,
      envelope: envelope(input, body.idempotencyKey),
    },
  });
}

function grantResponse() {
  return response(201, {
    code: 1,
    msg: 'command grant issued',
    data: {
      grantId: 'grant-1',
      grantToken: GRANT_TOKEN,
      expiresAt: '2026-07-28T12:00:00.000Z',
    },
  });
}

function executeResponse() {
  return response(202, {
    code: 1,
    data: {
      replay: false,
      receipt: {
        id: 'receipt-1', status: 'PENDING', failureCode: null,
        result: { secret: SECRET_SENTINEL },
      },
    },
  });
}

function statusResponse(state) {
  return response(state === 'PENDING' ? 202 : 200, {
    code: 1,
    data: {
      contractVersion: CONTRACT_VERSION,
      state,
      receiptId: state === 'NOT_COMMITTED' ? null : 'receipt-1',
      failureCode: state === 'FAILED' ? 'OZON_SUBMIT_REJECTED' : null,
    },
  });
}

function transport(input, calls, options = {}) {
  return {
    async post(path, body, requestOptions) {
      calls.push({ path, body: plain(body), options: plain(requestOptions) });
      if (path.endsWith('/preview')) return previewResponse(input);
      if (path.endsWith('/prepare')) return prepareResponse(input, body);
      if (path.endsWith('/command-grants')) return grantResponse();
      if (path.endsWith('/ozon-publish/execute')) {
        return options.execute ? options.execute() : executeResponse();
      }
      if (path.endsWith('/status')) {
        return options.status ? options.status() : statusResponse('SUCCEEDED');
      }
      throw new Error(`unexpected path ${path}`);
    },
  };
}

const api = loadApi();
assert.equal(api.CONTRACT_VERSION, CONTRACT_VERSION);

for (const executionMode of ['ERP_HOSTED', 'BYOK']) {
  const input = request(executionMode);
  const calls = [];
  const store = createSessionStore();
  const coordinator = api.createCoordinator({
    transport: transport(input, calls), store, crypto: webcrypto, now: () => 1_722_153_600_000,
  });
  assert.deepEqual(plain(await coordinator.preview(input)), previewData(input));
  const state = plain(await coordinator.confirm({ ...input, previewHash: PREVIEW_HASH }));
  assert.deepEqual(state, {
    contractVersion: CONTRACT_VERSION,
    request: input,
    state: 'SUCCEEDED',
    executionMode,
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    currentDraftRevision: 12,
    currentDraftVersion: 9,
    previewHash: PREVIEW_HASH,
    receiptId: 'receipt-1',
    failureCode: null,
  });
  assert.deepEqual(calls.map((call) => call.path), [
    '/api/extension-device/workbench-publish/preview',
    '/api/extension-device/workbench-publish/prepare',
    '/api/extension-device/command-grants',
    '/api/extension-device/ozon-publish/execute',
    '/api/extension-device/workbench-publish/status',
  ]);
  assert.match(calls[1].body.idempotencyKey, /^wb_publish_v2_[a-f0-9]{48}$/u);
  assert.equal(calls[2].body.operation, 'OZON_PUBLISH');
  assert.equal(calls[3].body.operation, undefined);
  assert.equal(calls[3].options.commandGrant, GRANT_TOKEN);
  assert.deepEqual(calls[4].body, {
    contractVersion: CONTRACT_VERSION,
    previewHash: PREVIEW_HASH,
    requestHash: REQUEST_HASH,
    envelope: envelope(input, calls[1].body.idempotencyKey),
  });
  const durable = JSON.stringify(store.snapshot());
  assert.doesNotMatch(durable, new RegExp(SECRET_SENTINEL, 'u'));
  assert.doesNotMatch(durable, /grantToken|commandGrant/u);
  assert.equal(await coordinator.getState({
    ...input,
    binding: { ...input.binding, draftVersion: input.binding.draftVersion + 1 },
  }), null, 'a new draft version must never reuse the prior publish receipt');
}

{
  const input = request('BYOK');
  const calls = [];
  const coordinator = api.createCoordinator({
    transport: transport(input, calls, {
      async execute() {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return executeResponse();
      },
    }),
    store: createSessionStore(),
    crypto: webcrypto,
    now: Date.now,
  });
  await coordinator.preview(input);
  const confirmation = { ...input, previewHash: PREVIEW_HASH };
  const [first, second] = await Promise.all([
    coordinator.confirm(confirmation), coordinator.confirm(confirmation),
  ]);
  assert.deepEqual(plain(first), plain(second));
  assert.equal(calls.filter((call) => call.path.endsWith('/prepare')).length, 1);
  assert.equal(calls.filter((call) => call.path.endsWith('/ozon-publish/execute')).length, 1);
}

{
  const input = request('ERP_HOSTED');
  const calls = [];
  const store = createSessionStore();
  const first = api.createCoordinator({
    transport: transport(input, calls, {
      async execute() { throw new Error('timeout'); },
      async status() { throw new Error('status unavailable'); },
    }),
    store,
    crypto: webcrypto,
    now: Date.now,
  });
  await first.preview(input);
  await assert.rejects(
    first.confirm({ ...input, previewHash: PREVIEW_HASH }),
    (error) => error?.code === 'SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME'
      && error?.outcome === 'UNKNOWN_OUTCOME',
  );
  const active = plain(await first.getActive({ shopId: 'shop-1', workflowId: 'workflow-1' }));
  assert.equal(active.state, 'OUTCOME_UNRESOLVED');

  let statusCalls = 0;
  const afterReload = api.createCoordinator({
    transport: transport(input, calls, {
      status() {
        statusCalls += 1;
        return statusResponse(statusCalls === 1 ? 'NOT_COMMITTED' : 'SUCCEEDED');
      },
    }),
    store,
    crypto: webcrypto,
    now: Date.now,
  });
  const recovered = plain(await afterReload.recover({
    ...input,
    binding: { ...input.binding, draftRevision: 13 },
  }));
  assert.equal(recovered.state, 'SUCCEEDED');
  assert.equal(recovered.receiptId, 'receipt-1');
  assert.equal(calls.filter((call) => call.path.endsWith('/prepare')).length, 1);
  assert.equal(new Set(calls.filter((call) => call.path.endsWith('/ozon-publish/execute'))
    .map((call) => call.body.idempotencyKey)).size, 1);
}

{
  const input = request('BYOK');
  const calls = [];
  const store = createSessionStore();
  const coordinator = api.createCoordinator({
    transport: transport(input, calls, {
      status() { return statusResponse('PENDING'); },
    }),
    store,
    crypto: webcrypto,
    now: Date.now,
  });
  await coordinator.preview(input);
  const pending = plain(await coordinator.confirm({ ...input, previewHash: PREVIEW_HASH }));
  assert.equal(pending.state, 'PENDING');
  assert.equal(pending.receiptId, 'receipt-1');
  const firstRecovery = plain(await coordinator.recover(input));
  const secondRecovery = plain(await coordinator.recover(input));
  assert.equal(firstRecovery.state, 'PENDING');
  assert.equal(secondRecovery.receiptId, 'receipt-1');
  assert.equal(
    calls.filter((call) => call.path.endsWith('/ozon-publish/execute')).length,
    1,
    'an authoritative pending receipt must never create a second executor call',
  );
}

{
  const invalidInputs = [
    request('BYOK', { selectedMedia: [] }),
    request('BYOK', {
      selectedMedia: [{
        scope: 'SKU', skuKey: null, slotKey: 'sku:sku-1:hero', assetId: 'asset-1',
      }],
    }),
    request('BYOK', {
      selectedMedia: [
        {
          scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assetId: 'asset-1',
        },
        {
          scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assetId: 'asset-2',
        },
      ],
    }),
  ];
  for (const input of invalidInputs) {
    let networkCalls = 0;
    const coordinator = api.createCoordinator({
      transport: { async post() { networkCalls += 1; throw new Error('must not run'); } },
      store: createSessionStore(),
      crypto: webcrypto,
      now: Date.now,
    });
    await assert.rejects(
      coordinator.preview(input),
      (error) => error?.code === 'SS_ERP_WORKBENCH_PUBLISH_INPUT_INVALID',
    );
    assert.equal(networkCalls, 0);
  }
}

{
  const input = request('BYOK');
  const coordinator = api.createCoordinator({
    transport: {
      async post(path) {
        if (path.endsWith('/preview')) {
          return previewResponse(input, {
            selectedMedia: [...input.selectedMedia].reverse(),
          });
        }
        throw new Error('must not run');
      },
    },
    store: createSessionStore(),
    crypto: webcrypto,
    now: Date.now,
  });
  await assert.rejects(
    coordinator.preview(input),
    (error) => error?.code === 'SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID',
  );
}

{
  const input = request('ERP_HOSTED');
  const coordinator = api.createCoordinator({
    transport: {
      async post() {
        return response(409, {
          code: 0,
          errorCode: 'extension_workbench_listing_publish_not_ready',
          msg: 'draft validation is stale',
        });
      },
    },
    store: createSessionStore(),
    crypto: webcrypto,
    now: Date.now,
  });
  await assert.rejects(
    coordinator.preview(input),
    (error) => error?.code === 'SS_ERP_WORKBENCH_PUBLISH_DRAFT_NOT_READY'
      && error?.outcome === 'FAILED_FINAL',
  );
}

{
  const input = request('ERP_HOSTED');
  const video = { skuKey: 'sku-1', role: 'MAIN', url: 'https://cdnvideo.v.ozone.ru/vod/video-1/ABC/asset.mp4', sourceMediaKey: null,
    sourceCaptureSnapshotId: 'snapshot-1', sourceCaptureHash: 'c'.repeat(64), approvedByUserId: 'owner', approvedAt: '2026-10-04T00:00:00Z' };
  const coordinator = api.createCoordinator({ transport: { async post() { return previewResponse(input, { videoBindings: [video] }); } },
    store: createSessionStore(), crypto: webcrypto, now: Date.now });
  const view = await coordinator.preview(input);
  assert.deepEqual(plain(view.videoBindings), [video]);
  assert.ok(Object.isFrozen(view.videoBindings));
  for (const altered of [{ ...video, skuKey: 'other' }, { ...video, role: 'FAKE' }, { ...video, url: 'http://127.0.0.1/video.mp4' }]) {
    const invalid = api.createCoordinator({ transport: { async post() { return previewResponse(input, { videoBindings: [altered] }); } },
      store: createSessionStore(), crypto: webcrypto, now: Date.now });
    await assert.rejects(invalid.preview(input), error => error.code === 'SS_ERP_WORKBENCH_PUBLISH_RESPONSE_INVALID');
  }
}
console.log('extension workbench listing publish coordinator tests passed');

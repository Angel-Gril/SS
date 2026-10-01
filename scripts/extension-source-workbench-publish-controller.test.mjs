import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const SOURCE = await readFile(new URL(
  '../extensions/ss-erp/shared/publish/source-workbench-publish-controller.js',
  import.meta.url,
), 'utf8');
const PREVIEW_HASH = 'a'.repeat(64);
const COORDINATOR_SOURCE = await readFile(new URL(
  '../extensions/ss-erp/shared/publish/workbench-listing-publish-coordinator.js',
  import.meta.url,
), 'utf8');

function plain(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function loadApi() {
  const context = vm.createContext({});
  context.globalThis = context;
  vm.runInContext(SOURCE, context, { filename: 'source-workbench-publish-controller.js' });
  return context.SS_ERP_SOURCE_WORKBENCH_PUBLISH_CONTROLLER;
}

function basis(overrides = {}) {
  return {
    binding: { shopId: 'shop-1', workflowId: 'draft-1', draftRevision: 12, draftVersion: 9 },
    selectedSkuKeys: ['sku-1', 'sku-2'],
    mediaAssignments: [
      { scope: 'PRODUCT', skuKey: null, slotKey: 'product-main', assetId: 'asset-source-1' },
      { scope: 'SKU', skuKey: 'sku-2', slotKey: 'sku:sku-2:hero', assetId: 'asset-hosted-2' },
      { scope: 'SKU', skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assetId: 'asset-hosted-1' },
    ],
    stage: 'READY_TO_PUBLISH',
    validation: { status: 'VALID', report: null },
    ...overrides,
  };
}

function expectedRequest(value = basis()) {
  return { executionMode: 'ERP_HOSTED', binding: value.binding, selectedMedia: value.mediaAssignments };
}

function setup(options = {}) {
  const calls = [];
  const preview = { previewHash: PREVIEW_HASH, orderedMedia: basis().mediaAssignments };
  const coordinator = {
    async preview(request) { calls.push(['preview', plain(request)]); return preview; },
    async confirm(request) {
      calls.push(['confirm', plain(request)]);
      return { state: 'PENDING', receiptId: 'receipt-1', failureCode: null };
    },
    async getState(request) {
      calls.push(['getState', plain(request)]);
      return { state: 'PENDING', receiptId: 'receipt-1', failureCode: null };
    },
    ...options.coordinator,
  };
  const controller = loadApi().create({
    async loadBasis(workflowId) {
      calls.push(['loadBasis', workflowId]);
      return options.loadBasis ? options.loadBasis(workflowId) : basis();
    },
    coordinator,
  });
  return { controller, calls, preview };
}

test('builds a hosted request from current server assignments in exact server order', async () => {
  const { controller, calls, preview } = setup();
  const result = await controller.execute({ listingWorkflowId: 'draft-1', action: 'PREVIEW' });
  assert.equal(result, preview);
  assert.deepEqual(calls, [['loadBasis', 'draft-1'], ['preview', expectedRequest()]]);
  assert.equal(calls.some(([method]) => method === 'confirm'), false);
});

test('requires an explicit hash confirmation and rereads the server basis', async () => {
  const { controller, calls } = setup();
  await controller.execute({ listingWorkflowId: 'draft-1', action: 'PREVIEW' });
  const result = await controller.execute({ listingWorkflowId: 'draft-1', action: 'CONFIRM', previewHash: PREVIEW_HASH });
  assert.equal(result.state, 'PENDING');
  assert.deepEqual(calls.at(-1), ['confirm', { ...expectedRequest(), previewHash: PREVIEW_HASH }]);
  assert.equal(calls.filter(([method]) => method === 'loadBasis').length, 2);
});

test('rejects malformed commands and frontend authority fields before loading any basis', async () => {
  const valid = { listingWorkflowId: 'draft-1', action: 'PREVIEW' };
  const invalid = [
    null, [], {}, { ...valid, listingWorkflowId: '' }, { ...valid, action: 'EXECUTE' },
    { ...valid, previewHash: PREVIEW_HASH }, { ...valid, shopId: 'other-shop' },
    { ...valid, binding: basis().binding }, { ...valid, selectedMedia: basis().mediaAssignments },
    { ...valid, executionMode: 'BYOK' }, { ...valid, commandGrant: 'secret' },
    { ...valid, action: 'CONFIRM' }, { ...valid, action: 'CONFIRM', previewHash: 'bad' },
    { ...valid, action: 'STATUS', previewHash: PREVIEW_HASH },
  ];
  for (const input of invalid) {
    const { controller, calls } = setup();
    await assert.rejects(controller.execute(input), { code: 'SS_ERP_SOURCE_WORKBENCH_PUBLISH_INPUT_INVALID' });
    assert.deepEqual(calls, []);
  }
});

test('rejects mismatched workflow and malformed server bindings before publisher invocation', async () => {
  const invalid = [
    { ...basis().binding, workflowId: 'draft-2' },
    { ...basis().binding, shopId: '' },
    { ...basis().binding, draftRevision: 0 },
    { ...basis().binding, draftVersion: 1.5 },
    { ...basis().binding, grantToken: 'secret' },
  ];
  for (const binding of invalid) {
    const { controller, calls } = setup({ loadBasis: () => basis({ binding }) });
    await assert.rejects(controller.execute({ listingWorkflowId: 'draft-1', action: 'PREVIEW' }), {
      code: 'SS_ERP_SOURCE_WORKBENCH_PUBLISH_BASIS_INVALID',
    });
    assert.equal(calls.length, 1);
  }
});

test('rejects empty, ambiguous, unselected and local-only media assignments', async () => {
  const original = basis().mediaAssignments;
  const invalid = [
    [],
    [original[0], original[0]],
    [original[0], { ...original[1], assetId: original[0].assetId }],
    [{ ...original[0], assetId: '' }],
    [{ ...original[0], assetId: 'https://provider.example/output.png' }],
    [{ ...original[0], assetId: 'blob:chrome-extension://abc/image' }],
    [{ ...original[0], assetId: 'data:image/png;base64,AAAA' }],
    [{ ...original[0], assetId: 'br_local_result_1' }],
    [{ ...original[0], assetId: 'asset-1', url: 'https://provider.example/output.png' }],
    [{ ...original[1], skuKey: 'unselected-sku' }],
    [{ ...original[1], skuKey: null }],
    [{ ...original[0], skuKey: 'sku-1' }],
    [{ ...original[0], scope: 'UNKNOWN' }],
  ];
  for (const mediaAssignments of invalid) {
    const { controller, calls } = setup({ loadBasis: () => basis({ mediaAssignments }) });
    await assert.rejects(controller.execute({ listingWorkflowId: 'draft-1', action: 'PREVIEW' }), {
      code: 'SS_ERP_SOURCE_WORKBENCH_PUBLISH_BASIS_INVALID',
    });
    assert.equal(calls.length, 1);
  }
});

test('rejects duplicate or empty SKU selection and oversized server data', async () => {
  const invalid = [
    basis({ selectedSkuKeys: [] }),
    basis({ selectedSkuKeys: ['sku-1', 'sku-1'] }),
    basis({ selectedSkuKeys: [''] }),
    basis({ selectedSkuKeys: Array.from({ length: 501 }, (_, index) => `sku-${index}`) }),
    basis({ mediaAssignments: Array.from({ length: 501 }, (_, index) => ({
      scope: 'PRODUCT', skuKey: null, slotKey: `slot-${index}`, assetId: `asset-${index}`,
    })) }),
  ];
  for (const value of invalid) {
    const { controller, calls } = setup({ loadBasis: () => value });
    await assert.rejects(controller.execute({ listingWorkflowId: 'draft-1', action: 'PREVIEW' }), {
      code: 'SS_ERP_SOURCE_WORKBENCH_PUBLISH_BASIS_INVALID',
    });
    assert.equal(calls.length, 1);
  }
});

test('keeps readiness checks on the publisher and propagates server rejection', async () => {
  const failure = Object.assign(new Error('not ready'), { code: 'SS_ERP_WORKBENCH_PUBLISH_DRAFT_NOT_READY' });
  const { controller, calls } = setup({
    loadBasis: () => basis({ stage: 'CATEGORY_REQUIRED', validation: { status: 'INVALID', report: null } }),
    coordinator: { async preview(request) { calls.push(['preview', plain(request)]); throw failure; } },
  });
  await assert.rejects(controller.execute({ listingWorkflowId: 'draft-1', action: 'PREVIEW' }), (error) => error === failure);
  assert.deepEqual(calls.at(-1), ['preview', expectedRequest()]);
});

test('forwards a changed confirmation basis to the coordinator for stale preview rejection', async () => {
  let current = basis();
  const stale = Object.assign(new Error('stale'), { code: 'SS_ERP_WORKBENCH_PUBLISH_CONFIRMATION_REQUIRED' });
  const { controller, calls } = setup({
    loadBasis: () => current,
    coordinator: { async confirm(request) { calls.push(['confirm', plain(request)]); throw stale; } },
  });
  await controller.execute({ listingWorkflowId: 'draft-1', action: 'PREVIEW' });
  current = basis({ binding: { ...basis().binding, draftRevision: 13 } });
  await assert.rejects(controller.execute({ listingWorkflowId: 'draft-1', action: 'CONFIRM', previewHash: PREVIEW_HASH }),
    (error) => error === stale);
  assert.equal(calls.at(-1)[1].binding.draftRevision, 13);
});

test('uses a frozen request for read-only status after an unknown outcome and revision change', async () => {
  let current = basis();
  let confirmations = 0;
  let recoveries = 0;
  const failure = Object.assign(new Error('unknown'), { code: 'SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME', outcome: 'UNKNOWN_OUTCOME' });
  const { controller, calls } = setup({
    loadBasis: () => current,
    coordinator: {
      async confirm() { confirmations += 1; throw failure; },
      async recover() { recoveries += 1; throw new Error('must remain read-only'); },
    },
  });
  const command = { listingWorkflowId: 'draft-1', action: 'CONFIRM', previewHash: PREVIEW_HASH };
  await assert.rejects(controller.execute(command), (error) => error === failure);
  current = basis({ binding: { ...basis().binding, draftRevision: 13 } });
  const status = await controller.execute({ listingWorkflowId: 'draft-1', action: 'STATUS' });
  assert.equal(status.state, 'PENDING');
  assert.deepEqual(calls.at(-1), ['getState', expectedRequest()]);
  await assert.rejects(controller.execute(command), { code: 'SS_ERP_SOURCE_WORKBENCH_PUBLISH_RECONCILIATION_REQUIRED' });
  assert.equal(confirmations, 1);
  assert.equal(recoveries, 0);
});

test('does not fabricate a status or retry confirmation when readback cannot find an operation', async () => {
  let confirmations = 0;
  const { controller } = setup({ coordinator: {
    async confirm() { confirmations += 1; throw Object.assign(new Error('unknown'), { outcome: 'UNKNOWN_OUTCOME' }); },
    async getState() { return null; },
  } });
  const command = { listingWorkflowId: 'draft-1', action: 'CONFIRM', previewHash: PREVIEW_HASH };
  await assert.rejects(controller.execute(command));
  assert.equal(await controller.execute({ listingWorkflowId: 'draft-1', action: 'STATUS' }), null);
  await assert.rejects(controller.execute(command), { code: 'SS_ERP_SOURCE_WORKBENCH_PUBLISH_RECONCILIATION_REQUIRED' });
  assert.equal(confirmations, 1);
});

test('reconciles frozen publication when a newer draft has no selected SKU or assignments', async () => {
  let current = basis();
  const { controller, calls } = setup({ loadBasis: () => current });
  await controller.execute({ listingWorkflowId: 'draft-1', action: 'CONFIRM', previewHash: PREVIEW_HASH });
  current = basis({
    binding: { ...basis().binding, draftRevision: 18, draftVersion: 10 },
    mediaAssignments: [], selectedSkuKeys: [], stage: 'DRAFT', validation: { status: 'INVALID' },
  });
  const status = await controller.execute({ listingWorkflowId: 'draft-1', action: 'STATUS' });
  assert.equal(status.state, 'PENDING');
  assert.deepEqual(calls.at(-1), ['getState', expectedRequest()]);
});

test('denies frozen operation readback if the authoritative shop changed', async () => {
  let current = basis();
  const { controller, calls } = setup({ loadBasis: () => current });
  await controller.execute({ listingWorkflowId: 'draft-1', action: 'CONFIRM', previewHash: PREVIEW_HASH });
  current = basis({ binding: { ...basis().binding, shopId: 'other-shop' } });
  await assert.rejects(controller.execute({ listingWorkflowId: 'draft-1', action: 'STATUS' }), {
    code: 'SS_ERP_SOURCE_WORKBENCH_PUBLISH_CONTEXT_STALE',
  });
  assert.equal(calls.some(([method]) => method === 'getState'), false);
});

test('reads current basis without creating an operation when status is requested before confirmation', async () => {
  const { controller, calls } = setup({ coordinator: { async getState(request) { calls.push(['getState', plain(request)]); return null; } } });
  assert.equal(await controller.execute({ listingWorkflowId: 'draft-1', action: 'STATUS' }), null);
  assert.deepEqual(calls, [['loadBasis', 'draft-1'], ['getState', expectedRequest()]]);
});

test('bounds frozen operations without evicting unresolved writes', async () => {
  let confirmations = 0;
  const { controller } = setup({
    loadBasis: (workflowId) => basis({ binding: { ...basis().binding, workflowId } }),
    coordinator: { async confirm() { confirmations += 1; throw Object.assign(new Error('unknown'), { outcome: 'UNKNOWN_OUTCOME' }); } },
  });
  for (let index = 0; index < 8; index += 1) {
    await assert.rejects(controller.execute({ listingWorkflowId: `draft-${index}`, action: 'CONFIRM', previewHash: PREVIEW_HASH }));
  }
  await assert.rejects(controller.execute({ listingWorkflowId: 'draft-extra', action: 'CONFIRM', previewHash: PREVIEW_HASH }), {
    code: 'SS_ERP_SOURCE_WORKBENCH_PUBLISH_OPERATION_LIMIT',
  });
  assert.equal(confirmations, 8);
  await assert.rejects(controller.execute({ listingWorkflowId: 'draft-0', action: 'CONFIRM', previewHash: PREVIEW_HASH }), {
    code: 'SS_ERP_SOURCE_WORKBENCH_PUBLISH_RECONCILIATION_REQUIRED',
  });
});

test('uses the existing publisher end to end and performs status-only reconciliation after lost execution response', async () => {
  const context = vm.createContext({ crypto: webcrypto, TextEncoder });
  context.globalThis = context;
  vm.runInContext(COORDINATOR_SOURCE, context);
  vm.runInContext(SOURCE, context);
  const stored = new Map();
  const calls = [];
  let current = basis();
  let statusUnavailable = true;
  const coordinator = context.SS_ERP_WORKBENCH_LISTING_PUBLISH_COORDINATOR.createCoordinator({
    crypto: webcrypto,
    now: Date.now,
    store: {
      async get(key) { return stored.has(key) ? { [key]: plain(stored.get(key)) } : {}; },
      async set(value) { Object.entries(value).forEach(([key, entry]) => stored.set(key, plain(entry))); },
      async remove(key) { stored.delete(key); },
    },
    transport: {
      async post(path, body) {
        calls.push({ path, body: plain(body) });
        if (path.endsWith('/preview')) {
          return { state: 'response', status: 200, body: { code: 1, data: {
            ...plain(body), currentDraftRevision: 12, currentDraftVersion: 9,
            previewHash: PREVIEW_HASH, selectedSkuKeys: ['sku-1', 'sku-2'],
            orderedMedia: basis().mediaAssignments.map((row, ordinal) => ({
              ordinal, ...row, source: ordinal === 0 ? 'SOURCE' : 'GENERATED',
            })),
          } } };
        }
        if (path.endsWith('/prepare')) {
          return { state: 'response', status: 201, body: { code: 1, data: {
            contractVersion: 'extension-workbench-listing-publish/v1',
            previewHash: PREVIEW_HASH, requestHash: 'b'.repeat(64), replayed: false,
            envelope: {
              operation: 'OZON_PUBLISH', shopId: body.shopId, workflowId: body.workflowId,
              draftVersion: 9, idempotencyKey: body.idempotencyKey,
              command: { schemaVersion: 'ozon-publish-command/v1', draftRevision: 13,
                publishIntentId: 'intent-1', selectedSkuKeys: ['sku-1', 'sku-2'] },
            },
          } } };
        }
        if (path.endsWith('/command-grants')) {
          return { state: 'response', status: 201, body: { code: 1, msg: 'ok', data: {
            grantId: 'grant-1', grantToken: 'g'.repeat(43), expiresAt: '2026-10-02T00:00:00Z',
          } } };
        }
        if (path.endsWith('/ozon-publish/execute')) throw new Error('lost execution response');
        if (path.endsWith('/status')) {
          if (statusUnavailable) throw new Error('readback unavailable');
          return { state: 'response', status: 202, body: { code: 1, data: {
            contractVersion: 'extension-workbench-listing-publish/v1',
            state: 'PENDING', receiptId: 'receipt-1', failureCode: null,
          } } };
        }
        throw new Error(`Unexpected path: ${path}`);
      },
    },
  });
  const controller = context.SS_ERP_SOURCE_WORKBENCH_PUBLISH_CONTROLLER.create({
    loadBasis: async () => current, coordinator,
  });
  const preview = await controller.execute({ listingWorkflowId: 'draft-1', action: 'PREVIEW' });
  assert.equal(preview.previewHash, PREVIEW_HASH);
  assert.equal(calls.length, 1);
  const confirmation = { listingWorkflowId: 'draft-1', action: 'CONFIRM', previewHash: PREVIEW_HASH };
  await assert.rejects(controller.execute(confirmation), { code: 'SS_ERP_WORKBENCH_PUBLISH_UNKNOWN_OUTCOME' });
  assert.deepEqual(calls.map(({ path }) => path), [
    '/api/extension-device/workbench-publish/preview',
    '/api/extension-device/workbench-publish/prepare',
    '/api/extension-device/command-grants',
    '/api/extension-device/ozon-publish/execute',
  ]);
  current = basis({ binding: { ...basis().binding, draftRevision: 13 }, stage: 'PUBLISH_INTENT_RECORDED' });
  statusUnavailable = false;
  const status = await controller.execute({ listingWorkflowId: 'draft-1', action: 'STATUS' });
  assert.equal(status.state, 'PENDING');
  assert.equal(status.receiptId, 'receipt-1');
  assert.equal(calls.at(-1).path, '/api/extension-device/workbench-publish/status');
  await assert.rejects(controller.execute(confirmation), { code: 'SS_ERP_SOURCE_WORKBENCH_PUBLISH_RECONCILIATION_REQUIRED' });
  assert.equal(calls.filter(({ path }) => path.endsWith('/ozon-publish/execute')).length, 1);
  assert.doesNotMatch(JSON.stringify(Object.fromEntries(stored)), /grantToken|commandGrant|g{43}/u);
});

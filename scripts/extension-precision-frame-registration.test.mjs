import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const runtimeId = 'abcdefghijklmnopabcdefghijklmnop';
const origin = `chrome-extension://${runtimeId}`;
const url = `${origin}/pages/precision-workbench.html`;
const now = () => Date.parse('2026-10-01T02:00:00Z');

function storage() {
  const values = {};
  return {
    values,
    async get(keys) { return Object.fromEntries(keys.filter((key) => Object.hasOwn(values, key)).map((key) => [key, structuredClone(values[key])])); },
    async set(patch) { Object.assign(values, structuredClone(patch)); },
    async remove(keys) { keys.forEach((key) => delete values[key]); },
  };
}

function loadApi() {
  const context = vm.createContext({ URL, Date });
  context.globalThis = context;
  for (const name of ['workbench-launch-session.js', 'precision-frame-registration.js']) {
    vm.runInContext(readFileSync(`extensions/ss-erp/shared/byok/${name}`, 'utf8'), context, { filename: name });
  }
  return { registryApi: context.SS_ERP_PRECISION_FRAME_REGISTRATION, sessionApi: context.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION };
}

function sender(overrides = {}) {
  return { id: runtimeId, tab: { id: 12, url: 'https://detail.1688.com/offer/990499606077.html' },
    frameId: 7, documentId: 'precision-document-1', url, origin, ...overrides };
}

function source(overrides = {}) {
  return { tabId: 12, documentId: 'source-document-1', sourcePlatform: '1688',
    sourceProductId: '990499606077', ownerUserId: 'owner-1', deviceSessionId: 'device-1', ...overrides };
}

function mediaContext(overrides = {}) {
  return { contractVersion: 'extension-byok-workbench-launch-context/v1',
    sourcePlatform: '1688', sourceProductId: '990499606077', sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1', shopId: 'shop-1', workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4,
    skuKey: 'sku-1', slotKey: 'sku:sku-1:hero', assignmentMode: 'APPEND', assignmentOrdinal: 0, ...overrides };
}

function setup(overrides = {}) {
  const { registryApi, sessionApi } = loadApi();
  const sessionStorage = overrides.sessionStorage || storage();
  const options = { runtimeId, sessionStorage, now,
    resolveSource: async () => source(),
    validateMediaContext: async ({ context }) => context,
    normalizeMediaContext: sessionApi.normalizeContext,
    ...overrides };
  return { registryApi, sessionApi, sessionStorage, options, registry: registryApi.createRegistry(options) };
}

test('registers only UI state and binds media only after the trusted validation port returns current context', async () => {
  let mediaChecks = 0;
  const { registry } = setup({ validateMediaContext: async ({ context }) => { mediaChecks += 1; return context; } });
  await registry.registerFrame(sender());
  assert.equal(await registry.authorizeEmbeddedFrame({ sender: sender(), mediaRequired: false }), 'UI_REGISTERED');
  await assert.rejects(registry.authorizeEmbeddedFrame({ sender: sender(), mediaRequired: true }), { code: 'PRECISION_FRAME_MEDIA_NOT_READY' });
  await registry.bindMedia(sender(), mediaContext());
  assert.equal(await registry.authorizeEmbeddedFrame({ sender: sender(), mediaRequired: true }), 'MEDIA_READY');
  assert.equal(mediaChecks, 1);
});

test('rejects foreign, top-level, wrong-path and malformed iframe senders before the source port', async () => {
  let resolutions = 0;
  const { registry } = setup({ resolveSource: async () => { resolutions += 1; return source(); } });
  for (const actual of [
    sender({ id: 'foreign' }), sender({ frameId: 0 }), sender({ frameId: -1 }),
    sender({ url: `${url}?launch=fake` }), sender({ url: `${url}#fake` }),
    sender({ origin: 'https://detail.1688.com' }), sender({ documentId: '' }),
  ]) await assert.rejects(registry.registerFrame(actual), { code: 'PRECISION_FRAME_SENDER_DENIED' });
  assert.equal(resolutions, 0);
});

test('denies unregistered, different-frame, different-tab and different-document claims', async () => {
  const { registry } = setup();
  await assert.rejects(registry.claimFrame(sender()), { code: 'PRECISION_FRAME_NOT_REGISTERED' });
  await registry.registerFrame(sender());
  for (const actual of [sender({ frameId: 8 }), sender({ documentId: 'other-document' }), sender({ tab: { id: 13 } })]) {
    await assert.rejects(registry.claimFrame(actual));
  }
});

test('preserves live registration across Worker reconstruction and fences retired iframe documents', async () => {
  const { registry, registryApi, options } = setup();
  await registry.registerFrame(sender());
  await registry.bindMedia(sender(), mediaContext());
  const restarted = registryApi.createRegistry(options);
  assert.equal(await restarted.authorizeEmbeddedFrame({ sender: sender(), mediaRequired: true }), 'MEDIA_READY');
  const successor = sender({ documentId: 'precision-document-2' });
  await restarted.registerFrame(successor);
  assert.equal(await restarted.authorizeEmbeddedFrame({ sender: successor, mediaRequired: false }), 'UI_REGISTERED');
  await assert.rejects(restarted.registerFrame(sender()), { code: 'PRECISION_FRAME_DOCUMENT_RETIRED' });
  await assert.rejects(restarted.claimFrame(sender()), { code: 'PRECISION_FRAME_SENDER_DENIED' });
});

test('does not allow another iframe in the same tab to replace the registered frame', async () => {
  const { registry } = setup();
  await registry.registerFrame(sender());
  await assert.rejects(registry.registerFrame(sender({ frameId: 8, documentId: 'other-frame-document' })), {
    code: 'PRECISION_FRAME_SENDER_DENIED',
  });
});

test('rejects source navigation, device replacement and explicit invalidation before media use', async () => {
  for (const changed of [source({ documentId: 'source-document-2' }), source({ sourceProductId: 'other-product' }), source({ deviceSessionId: 'device-2' }), source({ ownerUserId: 'other-owner' })]) {
    let currentSource = source();
    const { registry } = setup({ resolveSource: async () => currentSource });
    await registry.registerFrame(sender());
    await registry.bindMedia(sender(), mediaContext());
    currentSource = changed;
    await assert.rejects(registry.claimFrame(sender()), { code: 'PRECISION_FRAME_SOURCE_STALE' });
  }
  const { registry } = setup();
  await registry.registerFrame(sender());
  await registry.invalidateTab(12);
  await assert.rejects(registry.claimFrame(sender()), { code: 'PRECISION_FRAME_NOT_REGISTERED' });
  await registry.registerFrame(sender());
  await registry.clear();
  await assert.rejects(registry.claimFrame(sender()), { code: 'PRECISION_FRAME_NOT_REGISTERED' });
});

test('cannot elevate media state from a page assertion, wrong source or failed shop validation', async () => {
  for (const validateMediaContext of [async () => null, async () => ({ authenticated: true }), async () => mediaContext({ shopId: 'other-shop' })]) {
    const { registry } = setup({ validateMediaContext });
    await registry.registerFrame(sender());
    await assert.rejects(registry.bindMedia(sender(), mediaContext()));
    assert.equal(await registry.authorizeEmbeddedFrame({ sender: sender(), mediaRequired: false }), 'UI_REGISTERED');
  }
  const { registry } = setup();
  await registry.registerFrame(sender());
  await assert.rejects(registry.bindMedia(sender(), mediaContext({ sourceProductId: 'another-product' })), { code: 'PRECISION_FRAME_MEDIA_CONTEXT_STALE' });
});

test('rejects a delayed concurrent registration instead of letting it replace the winning document', async () => {
  let ready;
  const barrier = new Promise((resolve) => { ready = resolve; });
  let calls = 0;
  const resolveSource = async () => { calls += 1; if (calls === 2) ready(); await barrier; return source(); };
  const { registry, registryApi, options } = setup({ resolveSource });
  const secondWriter = registryApi.createRegistry(options);
  const results = await Promise.allSettled([
    registry.registerFrame(sender()),
    secondWriter.registerFrame(sender({ documentId: 'concurrent-document' })),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.equal(rejected.reason.code, 'PRECISION_FRAME_STATE_CHANGED');
});

test('embedded sessions use the actual frame, survive restart and never create or impersonate a top-level tab', async () => {
  let creates = 0;
  const { registry, sessionApi, sessionStorage } = setup();
  await registry.registerFrame(sender());
  const frame = (await registry.claimFrame(sender())).frame;
  const options = { sessionStorage, now,
    tabs: { async create() { creates += 1; return { id: 44 }; }, async update() {} },
    runtime: { getURL: (page) => `${origin}/${page}` },
    resolveEmbeddedFrame: (identity) => registry.claimFrame(identity),
  };
  const manager = sessionApi.createManager(options);
  const opened = await manager.openEmbedded({ context: mediaContext(), sourceTabId: 12, sourceDocumentId: 'source-document-1', frameSender: frame });
  assert.equal(opened.state, 'workbench_embedded');
  assert.equal(creates, 0);
  await registry.bindMedia(frame, mediaContext());
  const restored = sessionApi.createManager(options);
  const claimed = await restored.claim(frame);
  assert.equal(claimed.workbenchTabId, 12);
  assert.equal(claimed.workbenchDocumentId, 'precision-document-1');
  assert.equal(claimed.embeddedFrame.frameId, 7);
  await assert.rejects(restored.claim({ ...frame, frameId: 0 }), /SESSION_(?:NOT_FOUND|SENDER_DENIED)/u);
  await assert.rejects(restored.claim({ ...frame, documentId: 'forged-document' }));
  await restored.beginOperation(frame, 'unknown-generation-1');
  await assert.rejects(restored.openEmbedded({ context: mediaContext({ shopId: 'other-shop' }),
    sourceTabId: 12, sourceDocumentId: 'source-document-1', frameSender: frame }), /SESSION_(?:CONTEXT_STALE|OPERATION_PENDING)/u);
  assert.equal((await restored.claim(frame)).operation.idempotencyKey, 'unknown-generation-1');
});

test('embedded unknown operations retain their old document fence and are isolated from legacy storage', async () => {
  const { registry, sessionApi, sessionStorage } = setup();
  await registry.registerFrame(sender());
  const initial = (await registry.claimFrame(sender())).frame;
  const options = { sessionStorage, now,
    tabs: { async create() { return { id: 44 }; }, async update() {} },
    runtime: { getURL: (page) => `${origin}/${page}` },
    resolveEmbeddedFrame: (identity) => registry.claimFrame(identity) };
  const manager = sessionApi.createManager(options);
  await manager.open({ context: mediaContext(), sourceTabId: 12, sourceDocumentId: 'source-document-1' });
  await manager.openEmbedded({ context: mediaContext(), sourceTabId: 12, sourceDocumentId: 'source-document-1', frameSender: initial });
  await registry.bindMedia(initial, mediaContext());
  await manager.beginOperation(initial, 'unknown-generation-preserved');
  assert.deepEqual(Object.keys(sessionStorage.values[sessionApi.STORAGE_KEY]), ['44']);
  assert.deepEqual(Object.keys(sessionStorage.values[sessionApi.EMBEDDED_STATE_KEY].records), ['embedded:12']);
  const next = sender({ documentId: 'precision-document-2' });
  await registry.registerFrame(next);
  const current = (await registry.claimFrame(next)).frame;
  const restored = sessionApi.createManager(options);
  await restored.openEmbedded({ context: mediaContext(), sourceTabId: 12, sourceDocumentId: 'source-document-1', frameSender: current });
  await registry.bindMedia(current, mediaContext());
  assert.equal((await restored.claim(current)).operation.idempotencyKey, 'unknown-generation-preserved');
  assert.equal(sessionStorage.values[sessionApi.EMBEDDED_STATE_KEY].fences['embedded:12'].retiredDocumentIds.includes(initial.documentId), true);
  await assert.rejects(restored.clearOperation(initial, 'unknown-generation-preserved'));
  assert.equal((await restored.claim(current)).operation.idempotencyKey, 'unknown-generation-preserved');
  assert.equal((await restored.claim({ tabId: 44, frameId: 0, documentId: 'legacy-workbench-document' })).context.shopId, 'shop-1');
  await restored.clear();
  assert.equal(Object.hasOwn(sessionStorage.values, sessionApi.STORAGE_KEY), false);
  assert.equal(Object.hasOwn(sessionStorage.values, sessionApi.EMBEDDED_STATE_KEY), false);
});

test('registration enforces bounded lifetime and never evicts a live frame to register another tab', async () => {
  let currentTime = now();
  const { registry } = setup({ now: () => currentTime,
    resolveSource: async (frame) => source({ tabId: frame.tabId }) });
  for (let index = 0; index < 8; index += 1) {
    await registry.registerFrame(sender({ tab: { id: index }, documentId: `document-${index}` }));
  }
  await assert.rejects(registry.registerFrame(sender({ tab: { id: 99 } })), { code: 'PRECISION_FRAME_CAPACITY_EXCEEDED' });
  currentTime += 10 * 60 * 1000 + 1;
  await assert.rejects(registry.claimFrame(sender({ tab: { id: 0 }, documentId: 'document-0' })), { code: 'PRECISION_FRAME_NOT_REGISTERED' });
  await registry.registerFrame(sender({ tab: { id: 99 } }));
});

test('embedded reviewed results and ingest receipts survive Worker restart without changing the bound owner', async () => {
  const { registry, sessionApi, sessionStorage } = setup();
  await registry.registerFrame(sender());
  const frame = (await registry.claimFrame(sender())).frame;
  const options = { sessionStorage, now,
    tabs: { async create() { throw new Error('must not create a tab'); }, async update() {} },
    runtime: { getURL: (page) => `${origin}/${page}` },
    resolveEmbeddedFrame: (identity) => registry.claimFrame(identity) };
  const manager = sessionApi.createManager(options);
  await manager.openEmbedded({ context: mediaContext(), sourceTabId: 12, sourceDocumentId: 'source-document-1', frameSender: frame });
  await registry.bindMedia(frame, mediaContext());
  const resultId = 'br_' + 'a'.repeat(48);
  await manager.beginOperation(frame, 'provider-generation-1');
  await manager.attachResult(frame, { resultId, reviewState: 'CANDIDATE_READY' }, 'provider-generation-1');
  await manager.setReviewState(frame, resultId, 'APPROVED');
  const authority = { ownerUserId: 'owner-1', deviceSessionId: 'device-1', shopId: 'shop-1',
    workflowId: 'workflow-1', draftRevision: 3, draftVersion: 4, policyRevision: 'policy-1' };
  const ingestKey = 'wb_ingest_' + 'e'.repeat(48);
  await manager.beginIngest(frame, resultId, ingestKey, authority);
  await manager.setIngestRequestHash(frame, resultId, ingestKey, 'b'.repeat(64));
  const receipt = { contractVersion: 'extension-byok-generated-asset-ingest-client/v1', replayed: false,
    receiptId: 'receipt-1', assetId: 'asset-1', provenanceId: 'provenance-1', normalizedSha256: 'c'.repeat(64),
    mimeType: 'image/png', width: 1024, height: 1024, sourceDraftRevision: 3, sourceDraftVersion: 4,
    boundDraftRevision: 4, boundDraftVersion: 5, assignmentOrdinal: 0, assignmentSha256: 'd'.repeat(64),
    skuKey: 'sku-1', slotKey: 'sku:sku-1:hero' };
  const restored = sessionApi.createManager(options);
  assert.equal((await restored.claim(frame)).result.deliveryState, 'INGESTING');
  await restored.setIngestResult(frame, resultId, ingestKey, authority, receipt);
  const afterSecondRestart = sessionApi.createManager(options);
  const bound = await afterSecondRestart.claim(frame);
  assert.equal(bound.result.deliveryState, 'BOUND');
  assert.equal(bound.result.ingest.receiptId, 'receipt-1');
  assert.equal(bound.result.ingestAuthority.ownerUserId, 'owner-1');
});

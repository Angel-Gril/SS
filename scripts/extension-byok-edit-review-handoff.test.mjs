import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const TYPES = Object.fromEntries([
  'GET_PUBLIC_STATE', 'GET_READINESS', 'EXECUTE_PROVIDER', 'OPEN_PREVIEW',
  'SOURCE_CATALOG', 'SOURCE_PREVIEW', 'REVIEW_RESULT', 'INGEST', 'RECOVER_INGEST',
  'PUBLISH', 'EDIT_MEDIA_PREPARE', 'EDIT_MEDIA_RELEASE', 'EDIT_STATE',
  'EDIT_REFERENCES', 'EDIT_START', 'EDIT_SELECT', 'EDIT_REGENERATE',
  'EDIT_PREVIEW', 'EDIT_CLEANUP',
].map((name) => [name, name]));
TYPES.EDIT_REVIEW = 'ss-erp:ai-image-workbench-edit-review';
const plain = (value) => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

async function until(predicate) {
  for (let index = 0; index < 30; index += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('fixture did not reach the expected state');
}

async function fixture() {
  const sandbox = {
    Array, ArrayBuffer, Blob, Boolean, Date, Error, JSON, Map, Math, Number, Object,
    Promise, Set, String, TextEncoder, TypeError, Uint8Array, URL, crypto: webcrypto,
  };
  sandbox.globalThis = sandbox;
  for (const relative of [
    'shared/contracts/ai-image-workbench-v1.js', 'shared/byok/media-job-engine.js',
    'shared/byok/generated-result-vault.js', 'shared/byok/workbench-provider-semaphore.js',
    'shared/byok/workbench-edit-controller.js', 'shared/byok/workbench-launch-session.js',
    'shared/byok/workbench-edit-epoch-guard.js', 'shared/byok/workbench-runtime-handler.js',
  ]) {
    const path = `extensions/ss-erp/${relative}`;
    vm.runInNewContext(readFileSync(path, 'utf8'), sandbox, { filename: path });
  }
  const launch = {
    contractVersion: 'extension-byok-workbench-launch-context/v1',
    sourcePlatform: '1688', sourceProductId: 'product-fixture',
    sourceCaptureSnapshotId: 'snapshot-fixture', supplyGoodsId: 'goods-fixture',
    shopId: 'shop-fixture', workflowId: 'workflow-fixture', draftRevision: 3, draftVersion: 4,
    skuKey: 'sku-fixture', slotKey: 'sku:sku-fixture:hero',
    assignmentMode: 'APPEND', assignmentOrdinal: 0,
  };
  const sender = { tabId: 77, documentId: 'workbench-document', frameId: 0 };
  const owner = { tabId: sender.tabId, documentId: sender.documentId, context: launch };
  const state = {
    now: Date.parse('2026-09-08T10:00:00Z'), providerCalls: 0, ingestCalls: 0,
    textCalls: 0, failAttach: false, attachGate: null, attachStarted: false,
    providerError: null, deviceCurrent: true, contextCurrent: true,
  };
  const stored = {};
  const sessionApi = sandbox.SS_ERP_BYOK_WORKBENCH_LAUNCH_SESSION;
  const storage = {
    async get(keys) {
      return plain(Object.fromEntries(keys.filter((key) => Object.hasOwn(stored, key))
        .map((key) => [key, stored[key]])));
    },
    async set(patch) {
      const attaching = Object.values(patch[sessionApi.STORAGE_KEY] || {})
        .some((record) => record.result?.reviewState === 'CANDIDATE_READY');
      if (attaching) {
        state.attachStarted = true;
        if (state.failAttach) throw new Error('fixture session persistence failed');
        if (state.attachGate) await state.attachGate.promise;
      }
      Object.assign(stored, plain(patch));
    },
    async remove(keys) { for (const key of keys) delete stored[key]; },
  };
  const managerOptions = {
    sessionStorage: storage,
    tabs: {
      async create() { return { id: sender.tabId }; },
      async update(id) { return { id }; },
      async remove() {},
    },
    runtime: { getURL: (path) => `chrome-extension://fixture/${path}` },
    now: () => state.now,
  };
  let manager = sessionApi.createManager(managerOptions);
  await manager.open({ context: launch, sourceTabId: 12, sourceDocumentId: 'source-document' });
  await manager.claim(sender);
  const vault = sandbox.SS_ERP_BYOK_GENERATED_RESULT_VAULT.createVault({ now: () => state.now });
  const authorityGuard = {
    async capture(binding) {
      if (state.authorityError) throw state.authorityError;
      if (!state.deviceCurrent || binding.ownerUserId !== 'owner-fixture'
        || binding.deviceSessionId !== 'device-fixture') {
        throw Object.assign(new Error('fixture device revoked'), {
          code: 'SS_ERP_BYOK_DEVICE_AUTHORITY_STALE',
        });
      }
      return {
        lifecycleAuthority: { contractVersion: 'extension-byok-device-session-lifecycle/v1', epoch: 1 },
        ...Object.fromEntries(['ownerUserId', 'deviceSessionId', 'shopId', 'workflowId',
          'draftRevision', 'draftVersion', 'policyRevision'].map((key) => [key, binding[key]])),
      };
    },
    async commitGeneratedResult(input) {
      return input.vault.put(input.generated, input.binding, input.authority.lifecycleAuthority);
    },
    matchesVaultAuthority(entry, binding, authority) {
      return entry.lifecycleEpoch === authority.lifecycleAuthority.epoch
        && JSON.stringify(entry.binding) === JSON.stringify(binding);
    },
  };
  const readinessClient = {
    async getReadiness(input) {
      const result = {
        readinessHandle: 'readiness-fixture',
        readinessBinding: {
          ...launch, contractVersion: 'extension-byok-readiness-binding/v2',
          ownerUserId: 'owner-fixture', deviceSessionId: 'device-fixture',
          providerOrigin: 'https://provider.example', model: 'fixture-model',
          operation: input.operation, policyRevision: '1',
        },
        expiresAt: new Date(state.now + 60000).toISOString(),
      };
      Object.defineProperty(result, 'concurrencyAuthority', {
        value: Object.freeze({ policyRevision: '1', maxConcurrency: 1 }),
      });
      return result;
    },
  };
  const results = new Map();
  const imageEditClient = {
    async edit(input) {
      state.providerCalls += 1;
      if (state.providerError) throw state.providerError;
      const generated = {
        outcome: 'SUCCEEDED', operation: input.operation, requestMode: 'multipart',
        profileId: 'profile-fixture', providerOrigin: input.readinessBinding.providerOrigin,
        model: input.readinessBinding.model, policyRevision: input.readinessBinding.policyRevision,
        executionIntentId: `intent-fixture-${state.providerCalls}`, idempotencyKey: input.idempotencyKey,
        requestHash: String(state.providerCalls).padStart(64, 'a'), promptHash: 'b'.repeat(64),
        negativePromptHash: null, endpointHash: 'c'.repeat(64),
        sourceSha256: input.operation === 'IMAGE_TO_IMAGE' ? null : 'd'.repeat(64),
        referenceSha256s: input.operation === 'IMAGE_TO_IMAGE' ? ['d'.repeat(64)] : [],
        maskSha256: input.operation === 'INPAINT' ? 'e'.repeat(64) : null,
        acceptedAt: new Date(state.now).toISOString(),
        image: {
          blob: new Blob([new Uint8Array([1, state.providerCalls])], { type: 'image/png' }),
          mimeType: 'image/png', byteLength: 2, sha256: String(state.providerCalls).padStart(64, 'f'),
        },
      };
      results.set(input.idempotencyKey, generated);
      return generated;
    },
    async commitResult(key, hash, commit) {
      assert.equal(results.get(key).requestHash, hash);
      return commit(results.get(key));
    },
    releaseResult(key) { results.delete(key); return { released: true }; },
  };
  const mediaStore = {
    async getForBackground() {
      return { blob: new Blob([new Uint8Array([1, 2])], { type: 'image/png' }),
        mimeType: 'image/png', width: 8, height: 8 };
    },
    releaseOwner() { return { releasedCount: 1 }; },
    prepare() { throw new Error('unused fixture media channel'); },
    release() { return true; },
  };
  const semaphore = sandbox.SS_ERP_BYOK_WORKBENCH_PROVIDER_SEMAPHORE.createSemaphore({ now: () => state.now });
  const controller = sandbox.SS_ERP_BYOK_WORKBENCH_EDIT_CONTROLLER.createController({
    mediaJobEngine: sandbox.SS_ERP_BYOK_MEDIA_JOB_ENGINE, readinessClient, imageEditClient,
    generatedResultVault: vault, authorityGuard, mediaStore, providerSemaphore: semaphore,
    now: () => state.now,
  });
  let epochGuard = sandbox.SS_ERP_BYOK_WORKBENCH_EDIT_EPOCH_GUARD.createGuard({
    sessionStorage: storage, now: () => state.now,
  });
  const noop = async () => null;
  const ingestReceipt = {
    contractVersion: 'extension-byok-generated-asset-ingest-client/v1', replayed: false,
    receiptId: 'receipt-fixture', assetId: 'asset-fixture', provenanceId: 'provenance-fixture',
    normalizedSha256: 'a'.repeat(64), mimeType: 'image/png', width: 8, height: 8,
    sourceDraftRevision: 3, sourceDraftVersion: 4, boundDraftRevision: 4, boundDraftVersion: 5,
    assignmentOrdinal: 0, assignmentSha256: 'b'.repeat(64),
    skuKey: launch.skuKey, slotKey: launch.slotKey,
  };
  const runtimeOptions = () => ({
    messageTypes: TYPES, sessionManager: manager,
    launchClient: { async resolve() {
      return { contractVersion: 'extension-byok-workbench-launch-decision/v2', state: 'READY',
        context: state.contextCurrent ? launch : { ...launch, draftRevision: 4 } };
    } },
    assertSourceCurrent: noop,
    profileStore: { listPublicProfiles: async () => [], getProfile: noop, getPublicState: noop },
    permissionBroker: { hasOriginPermission: noop }, readinessClient,
    providerClient: {
      async generate() { state.textCalls += 1; throw new Error('must not generate text image'); },
      commitResult: noop, releaseResult() {}, getOperationState() { return null; },
    },
    vault, authorityGuard,
    previewBroker: { open: (entry) => ({ resultId: entry.resultId }), releaseResult: () => true },
    sourceMediaLibrary: { loadCatalog: noop, open: noop },
    editController: controller, editMediaStore: mediaStore, editEpochGuard: epochGuard,
    providerSemaphore: semaphore,
    ingestClient: {
      async ingest(input, authority, commit, commitHash) {
        state.ingestCalls += 1;
        assert.equal(vault.getForBackground(input.resultId).reviewState, 'APPROVED');
        assert.equal(authority.ownerUserId, 'owner-fixture');
        await commitHash('e'.repeat(64));
        await commit(ingestReceipt);
        return ingestReceipt;
      },
      recover: noop, discardResult() {}, getOperationState() { return null; },
    },
    publishCoordinator: { preview: noop, confirm: noop, recover: noop, getState: noop },
    now: () => state.now,
  });
  let dispatcher = sandbox.SS_ERP_BYOK_WORKBENCH_RUNTIME_HANDLER.createDispatcher(runtimeOptions());
  const dispatch = async (name, payload = {}, actor = sender) => {
    const handler = dispatcher.handlers[TYPES[name]];
    return handler ? handler({ payload, sender: actor }) : { ok: false, errorCode: 'MESSAGE_UNHANDLED' };
  };
  const command = (operation) => ({
    profileId: 'profile-fixture', operation, prompt: 'Keep the product factual.',
    negativePrompt: null, size: '1024x1024',
    sourceHandle: operation === 'IMAGE_TO_IMAGE' ? null : 'source-fixture',
    maskHandle: operation === 'INPAINT' ? 'mask-fixture' : null,
  });
  async function candidate(operation = 'FULL_EDIT') {
    assert.equal((await dispatch('EDIT_STATE')).ok, true);
    if (operation === 'IMAGE_TO_IMAGE') {
      assert.equal((await dispatch('EDIT_REFERENCES', { scope: 'SESSION_GLOBAL', handles: ['reference-fixture'] })).ok, true);
    }
    assert.equal((await dispatch('EDIT_START', command(operation))).ok, true);
    const settled = await controller.whenSettled(owner);
    assert.equal(settled.alternatives[0].state, 'CANDIDATE_READY');
    const selected = await dispatch('EDIT_SELECT', { attemptId: settled.alternatives[0].attemptId });
    assert.equal(selected.ok, true);
    return {
      attemptId: selected.data.slot.selectedAttemptId,
      expectedSlotRevision: selected.data.slot.revision,
      resultId: selected.data.slot.selectedCandidateId,
    };
  }
  return {
    state, stored, sessionApi, vault, controller, sender, owner, dispatch, candidate, command,
    get manager() { return manager; },
    get epochGuard() { return epochGuard; },
    restart() {
      manager = sessionApi.createManager(managerOptions);
      epochGuard = sandbox.SS_ERP_BYOK_WORKBENCH_EDIT_EPOCH_GUARD.createGuard({ sessionStorage: storage, now: () => state.now });
      dispatcher = sandbox.SS_ERP_BYOK_WORKBENCH_RUNTIME_HANDLER.createDispatcher(runtimeOptions());
    },
  };
}

const handoffInput = ({ attemptId, expectedSlotRevision }) => ({ attemptId, expectedSlotRevision });

for (const operation of ['IMAGE_TO_IMAGE', 'FULL_EDIT', 'INPAINT']) {
  test(`${operation} selected candidate enters normal review without approving or ingesting`, async () => {
    const f = await fixture();
    const selected = await f.candidate(operation);
    const response = await f.dispatch('EDIT_REVIEW', handoffInput(selected));
    const publicState = await f.dispatch('GET_PUBLIC_STATE');
    assert.equal(publicState.data.result?.resultId, selected.resultId,
      'the selected edit must be attached to the authoritative normal review session');
    assert.equal(response.ok, true);
    assert.equal(response.data.reviewState, 'CANDIDATE_READY');
    assert.equal(response.data.deliveryState, 'NOT_INGESTED');
    assert.equal(publicState.data.result.operation, operation);
    assert.equal('editReviewHandoff' in publicState.data.result, false);
    assert.equal(f.state.providerCalls, 1);
    assert.equal(f.state.ingestCalls, 0);
    assert.equal(f.state.textCalls, 0);
    assert.equal((await f.epochGuard.assertCurrent(f.owner)).state, 'EMPTY');
    f.controller.cleanupByTab(f.sender.tabId);
    assert.equal(f.vault.getForBackground(selected.resultId).reviewState, 'CANDIDATE_READY');
    assert.equal((await f.dispatch('OPEN_PREVIEW', { resultId: selected.resultId })).ok, true);
    assert.equal((await f.dispatch('REVIEW_RESULT', { resultId: selected.resultId, decision: 'APPROVE' })).ok, true);
    const ingested = await f.dispatch('INGEST', { resultId: selected.resultId });
    assert.equal(ingested.ok, true);
    assert.equal(ingested.data.deliveryState, 'BOUND');
    assert.equal(ingested.data.ingest.slotKey, f.owner.context.slotKey);
    assert.equal(f.state.providerCalls, 1);
    assert.equal(f.state.ingestCalls, 1);
  });
}

test('temporary authority failure hides the candidate without discarding its persisted handoff', async () => {
  const f = await fixture();
  const selection = await f.candidate();
  const handedOff = await f.dispatch('EDIT_REVIEW', handoffInput(selection));
  assert.equal(handedOff.ok, true);
  const expectedResult = plain(f.stored[f.sessionApi.STORAGE_KEY][String(f.sender.tabId)].result);
  f.state.authorityError = Object.assign(new Error('temporary authority lookup failed'), {
    code: 'FIXTURE_AUTHORITY_TEMPORARILY_UNAVAILABLE',
  });
  const unavailable = await f.dispatch('GET_PUBLIC_STATE');
  assert.equal(unavailable.ok, false, 'authority failure must not become a successful empty workspace');
  assert.equal(unavailable.errorCode, 'FIXTURE_AUTHORITY_TEMPORARILY_UNAVAILABLE');
  assert.deepEqual(f.stored[f.sessionApi.STORAGE_KEY][String(f.sender.tabId)].result, expectedResult);
  assert.equal(f.vault.getPublic(handedOff.data.resultId).reviewState, 'CANDIDATE_READY');
  f.state.authorityError = null;
  const restored = await f.dispatch('GET_PUBLIC_STATE');
  assert.equal(restored.ok, true);
  assert.equal(restored.data.result.resultId, handedOff.data.resultId);
  assert.equal(f.state.providerCalls, 1);
  assert.equal(f.state.ingestCalls, 0);
});

test('replays the same handoff after manager restart and rejects another selection identity', async () => {
  const f = await fixture();
  const selected = await f.candidate();
  assert.equal((await f.dispatch('EDIT_REVIEW', handoffInput(selected))).ok, true);
  const baseResult = f.stored[f.sessionApi.STORAGE_KEY][String(f.sender.tabId)].result;
  assert.equal('editReviewHandoff' in baseResult, false, 'the legacy session result remains compatible');
  f.restart();
  assert.equal((await f.dispatch('EDIT_STATE')).ok, true, 'a normal page refresh may reopen an idle editor');
  const replay = await f.dispatch('EDIT_REVIEW', handoffInput(selected));
  assert.equal(replay.ok, true);
  assert.equal(replay.data.resultId, selected.resultId);
  assert.equal((await f.dispatch('EDIT_REVIEW', { ...handoffInput(selected), expectedSlotRevision: selected.expectedSlotRevision + 1 })).ok, false);
  assert.equal(f.state.providerCalls, 1);
  assert.equal(f.state.ingestCalls, 0);
});

test('persistence failure retains the selected edit and permits the identical handoff', async () => {
  const f = await fixture();
  const selected = await f.candidate();
  f.state.failAttach = true;
  assert.equal((await f.dispatch('EDIT_REVIEW', handoffInput(selected))).ok, false);
  assert.equal((await f.manager.claim(f.sender)).result, null);
  assert.equal(f.controller.getSnapshot(f.owner).slot.selectedCandidateId, selected.resultId);
  assert.equal(f.vault.getForBackground(selected.resultId).reviewState, 'CANDIDATE_READY');
  f.state.failAttach = false;
  assert.equal((await f.dispatch('EDIT_REVIEW', handoffInput(selected))).ok, true);
  assert.equal(f.state.providerCalls, 1);
});

test('handoff fences selection and regeneration while session persistence is pending', async () => {
  const f = await fixture();
  const selected = await f.candidate();
  f.state.attachGate = deferred();
  const pending = f.dispatch('EDIT_REVIEW', handoffInput(selected));
  await until(() => f.state.attachStarted);
  const duplicate = f.dispatch('EDIT_REVIEW', handoffInput(selected));
  assert.throws(() => f.controller.selectAlternative(f.owner, { attemptId: selected.attemptId }));
  await assert.rejects(f.controller.regenerate(f.owner, {
    ...f.command('FULL_EDIT'), expectedSlotRevision: selected.expectedSlotRevision,
    chargeAcknowledgement: { warningVersion: 'external-provider-charge/v1', confirmed: true },
  }));
  f.state.attachGate.resolve();
  assert.equal((await pending).ok, true);
  assert.equal((await duplicate).ok, true);
  assert.equal(f.state.providerCalls, 1);
  assert.equal(f.vault.getForBackground(selected.resultId).reviewState, 'CANDIDATE_READY');
});

test('rejects stale revision, forged payload, cross-tab, expired and revoked candidates', async () => {
  for (const kind of ['revision', 'payload', 'tab', 'document', 'expired', 'device', 'context']) {
    const f = await fixture();
    const selected = await f.candidate();
    const input = handoffInput(selected);
    if (kind === 'revision') input.expectedSlotRevision += 1;
    if (kind === 'payload') input.resultId = selected.resultId;
    if (kind === 'expired') f.state.now += 600001;
    if (kind === 'device') f.state.deviceCurrent = false;
    if (kind === 'context') f.state.contextCurrent = false;
    const response = await f.dispatch('EDIT_REVIEW', input,
      kind === 'tab' ? { ...f.sender, tabId: 78 }
        : kind === 'document' ? { ...f.sender, documentId: 'another-document' } : f.sender);
    assert.equal(response.ok, false, kind);
    assert.equal(f.state.providerCalls, 1, kind);
    assert.equal(f.state.ingestCalls, 0, kind);
  }
});

test('requires the selected alternative and releases only the unselected results on handoff', async () => {
  const f = await fixture();
  const first = await f.candidate();
  await f.dispatch('EDIT_REGENERATE', {
    ...f.command('FULL_EDIT'), expectedSlotRevision: first.expectedSlotRevision,
    chargeAcknowledgement: { warningVersion: 'external-provider-charge/v1', confirmed: true },
  });
  const settled = await f.controller.whenSettled(f.owner);
  const second = settled.alternatives[1];
  assert.equal((await f.dispatch('EDIT_REVIEW', {
    attemptId: second.attemptId, expectedSlotRevision: settled.slot.revision,
  })).ok, false);
  const chosen = await f.dispatch('EDIT_SELECT', { attemptId: second.attemptId });
  const response = await f.dispatch('EDIT_REVIEW', {
    attemptId: second.attemptId, expectedSlotRevision: chosen.data.slot.revision,
  });
  assert.equal(response.ok, true);
  assert.equal(response.data.resultId, second.candidateId);
  assert.throws(() => f.vault.getForBackground(first.resultId));
  assert.equal(f.vault.getForBackground(second.candidateId).reviewState, 'CANDIDATE_READY');
  f.controller.clear();
  assert.equal(f.vault.getForBackground(second.candidateId).reviewState, 'CANDIDATE_READY');
  assert.equal(f.state.providerCalls, 2);
  assert.equal(f.state.ingestCalls, 0);
});

test('keeps pending operations, another normal result and mismatched session context intact', async () => {
  for (const kind of ['pending', 'result', 'context']) {
    const f = await fixture();
    const selected = await f.candidate();
    if (kind === 'context') {
      await assert.rejects(f.manager.attachEditResult(f.sender,
        { ...f.owner.context, draftRevision: 4 }, {
          contractVersion: 'extension-byok-edit-review-handoff/v1',
          ...selected, operation: 'FULL_EDIT',
        }));
      assert.equal((await f.manager.claim(f.sender)).result, null);
    } else {
      await f.manager.beginOperation(f.sender, 'conflicting-request');
      if (kind === 'result') {
        await f.manager.attachResult(f.sender, {
          resultId: `br_${'0'.repeat(48)}`, reviewState: 'CANDIDATE_READY',
        }, 'conflicting-request');
      }
      assert.equal((await f.dispatch('EDIT_REVIEW', handoffInput(selected))).ok, false);
      const current = await f.manager.claim(f.sender);
      if (kind === 'pending') assert.equal(current.operation.idempotencyKey, 'conflicting-request');
      else assert.equal(current.result.resultId, `br_${'0'.repeat(48)}`);
    }
    assert.equal(f.vault.getForBackground(selected.resultId).reviewState, 'CANDIDATE_READY');
    assert.equal(f.state.providerCalls, 1);
    assert.equal(f.state.ingestCalls, 0);
  }
});

test('does not hand off a selected result while another edit outcome is unknown', async () => {
  const f = await fixture();
  const selected = await f.candidate();
  f.state.providerError = Object.assign(new Error('fixture lost Provider response'), {
    code: 'SS_ERP_BYOK_IMAGE_EDIT_UNKNOWN_OUTCOME', outcome: 'UNKNOWN_OUTCOME',
  });
  assert.equal((await f.dispatch('EDIT_REGENERATE', {
    ...f.command('FULL_EDIT'), expectedSlotRevision: selected.expectedSlotRevision,
    chargeAcknowledgement: { warningVersion: 'external-provider-charge/v1', confirmed: true },
  })).ok, true);
  const settled = await f.controller.whenSettled(f.owner);
  assert.equal(settled.alternatives[1].state, 'UNKNOWN_OUTCOME');
  assert.equal((await f.dispatch('EDIT_REVIEW', {
    attemptId: selected.attemptId, expectedSlotRevision: settled.slot.revision,
  })).ok, false);
  assert.equal((await f.manager.claim(f.sender)).result, null);
  assert.equal(f.state.providerCalls, 2);
  assert.equal(f.state.ingestCalls, 0);
});

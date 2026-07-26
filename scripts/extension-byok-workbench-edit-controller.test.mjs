import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const contractPath = 'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js';
const enginePath = 'extensions/ss-erp/shared/byok/media-job-engine.js';
const vaultPath = 'extensions/ss-erp/shared/byok/generated-result-vault.js';
const semaphorePath = 'extensions/ss-erp/shared/byok/workbench-provider-semaphore.js';
const controllerPath = 'extensions/ss-erp/shared/byok/workbench-edit-controller.js';

function loadApis() {
  const context = {
    Array, ArrayBuffer, Blob, Boolean, Date, Error, JSON, Map, Math, Number, Object,
    Promise, Set, String, TextEncoder, TypeError, Uint8Array, URL, crypto: webcrypto,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(contractPath, 'utf8'), context, { filename: contractPath });
  vm.runInNewContext(readFileSync(enginePath, 'utf8'), context, { filename: enginePath });
  vm.runInNewContext(readFileSync(vaultPath, 'utf8'), context, { filename: vaultPath });
  vm.runInNewContext(readFileSync(semaphorePath, 'utf8'), context, { filename: semaphorePath });
  vm.runInNewContext(readFileSync(controllerPath, 'utf8'), context, { filename: controllerPath });
  return {
    controllerApi: context.SS_ERP_BYOK_WORKBENCH_EDIT_CONTROLLER,
    engineApi: context.SS_ERP_BYOK_MEDIA_JOB_ENGINE,
    vaultApi: context.SS_ERP_BYOK_GENERATED_RESULT_VAULT,
    semaphoreApi: context.SS_ERP_BYOK_WORKBENCH_PROVIDER_SEMAPHORE,
  };
}

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });
  return { promise, resolve, reject };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail('timed out waiting for deterministic fixture state');
}

function owner(overrides = {}) {
  const context = {
    contractVersion: 'extension-byok-workbench-launch-context/v1',
    sourcePlatform: '1688',
    sourceProductId: 'product-1',
    sourceCaptureSnapshotId: 'snapshot-1',
    supplyGoodsId: 'goods-1',
    shopId: 'shop-1',
    workflowId: 'workflow-1',
    draftRevision: 3,
    draftVersion: 4,
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    assignmentMode: 'APPEND',
    assignmentOrdinal: 0,
    ...(overrides.context || {}),
  };
  return {
    tabId: overrides.tabId ?? 31,
    documentId: overrides.documentId || 'document-1',
    context,
  };
}

function readiness(input, nowMillis, overrides = {}) {
  const { maxConcurrency = 3, ...readinessOverrides } = overrides;
  const value = {
    readinessHandle: 'rh_fixture_1',
    readinessBinding: {
      contractVersion: 'extension-byok-readiness-binding/v2',
      ownerUserId: 'owner-1',
      deviceSessionId: 'device-session-1',
      shopId: input.shopId,
      workflowId: input.workflowId,
      draftRevision: input.draftRevision,
      draftVersion: input.draftVersion,
      sourcePlatform: input.sourcePlatform,
      sourceProductId: input.sourceProductId,
      sourceCaptureSnapshotId: input.sourceCaptureSnapshotId,
      supplyGoodsId: input.supplyGoodsId,
      skuKey: input.skuKey,
      slotKey: input.slotKey,
      assignmentMode: input.assignmentMode,
      assignmentOrdinal: input.assignmentOrdinal,
      providerOrigin: 'https://relay.example',
      model: 'edit-model-v1',
      operation: input.operation,
      policyRevision: '734',
    },
    expiresAt: new Date(nowMillis + 60_000).toISOString(),
    ...readinessOverrides,
  };
  Object.defineProperty(value, 'concurrencyAuthority', {
    value: Object.freeze({ policyRevision: '734', maxConcurrency }),
    enumerable: false,
  });
  return Object.freeze(value);
}

function media(blobType = 'image/png', width = 8, height = 8, marker = 1) {
  return {
    blob: new Blob([new Uint8Array([marker, marker + 1])], { type: blobType }),
    mimeType: blobType,
    width,
    height,
  };
}

function command(operation, overrides = {}) {
  return {
    profileId: 'profile-1',
    operation,
    prompt: 'Keep the exact product and improve the marketplace presentation',
    negativePrompt: 'watermark, invented product claims',
    size: '1024x1024',
    sourceHandle: operation === 'IMAGE_TO_IMAGE' ? null : 'source-1',
    maskHandle: operation === 'INPAINT' ? 'mask-1' : null,
    ...overrides,
  };
}

function containsBlob(value, seen = new Set()) {
  if (value instanceof Blob) return true;
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  return Object.values(value).some((item) => containsBlob(item, seen));
}

function createFixture(options = {}) {
  const { controllerApi, engineApi, vaultApi, semaphoreApi } = loadApis();
  let current = Date.parse('2026-07-27T09:00:00.000Z');
  let randomCounter = 1;
  let resultCounter = 1;
  const readinessCalls = [];
  const engineOptions = [];
  const editCalls = [];
  const commitCalls = [];
  const releaseCalls = [];
  const releasedMediaOwners = [];
  const mediaCalls = [];
  const vaultEntries = new Map();
  const pinned = new Set();
  const retainedEdits = new Map();
  const mediaEntries = new Map([
    ['global-1', media('image/png', 8, 8, 10)],
    ['global-2', media('image/jpeg', 8, 8, 20)],
    ['slot-1', media('image/webp', 8, 8, 30)],
    ['source-1', media('image/png', 8, 8, 40)],
    ['source-2', media('image/png', 8, 8, 50)],
    ['mask-1', media('image/png', 8, 8, 60)],
    ['mask-mismatch', media('image/png', 7, 8, 70)],
    ['mask-jpeg', media('image/jpeg', 8, 8, 80)],
  ]);
  let vaultFull = false;

  const fixtureVault = {
    put(generated, binding, lifecycleAuthority) {
      if (vaultFull) {
        const error = new Error('vault full');
        error.code = 'SS_ERP_BYOK_RESULT_VAULT_FULL';
        throw error;
      }
      const resultId = `br_${String(resultCounter).padStart(48, '0')}`;
      resultCounter += 1;
      const entry = {
        resultId,
        binding,
        lifecycleAuthority,
        blob: generated.image.blob,
        operation: generated.operation,
        image: {
          mimeType: generated.image.mimeType,
          byteLength: generated.image.byteLength,
          sha256: generated.image.sha256,
        },
      };
      vaultEntries.set(resultId, entry);
      return Object.freeze({
        contractVersion: 'extension-byok-result-vault/v1',
        resultId,
        outcome: 'SUCCEEDED',
        operation: generated.operation,
        requestMode: generated.requestMode,
        model: generated.model,
        policyRevision: generated.policyRevision,
        idempotencyKey: generated.idempotencyKey,
        requestHash: generated.requestHash,
        promptHash: generated.promptHash,
        acceptedAt: generated.acceptedAt,
        reviewState: 'CANDIDATE_READY',
        reviewedAt: null,
        expiresAt: new Date(current + 600_000).toISOString(),
        image: Object.freeze(entry.image),
      });
    },
    pinSelection(resultId) {
      if (!vaultEntries.has(resultId)) throw new Error('missing vault result');
      pinned.add(resultId);
      return true;
    },
    getForBackground(resultId) {
      const entry = vaultEntries.get(resultId);
      if (!entry) {
        const error = new Error('result not found');
        error.code = 'SS_ERP_BYOK_RESULT_NOT_FOUND';
        throw error;
      }
      return entry;
    },
    unpinSelection(resultId) {
      return pinned.delete(resultId);
    },
    release(resultId) {
      pinned.delete(resultId);
      return vaultEntries.delete(resultId);
    },
  };

  function fillRandom(bytes) {
    bytes.fill(randomCounter % 255);
    randomCounter += 1;
    return bytes;
  }

  const generatedResultVault = options.useRealVault
    ? vaultApi.createVault({ now: () => new Date(current), randomValues: fillRandom })
    : fixtureVault;

  const imageEditClient = {
    async edit(input) {
      editCalls.push(input);
      if (options.editGate) await options.editGate.promise;
      const requestHash = String(editCalls.length).padStart(64, 'a').slice(-64);
      const generated = {
        contractVersion: 'extension-byok-image-edit/v1',
        outcome: 'SUCCEEDED',
        operation: input.operation,
        requestMode: 'multipart',
        adapterId: 'OPENAI_MULTIPART_SYNC',
        profileId: input.profileId,
        profileIdentity: 'secret-profile-identity',
        providerOrigin: input.readinessBinding.providerOrigin,
        model: input.readinessBinding.model,
        policyRevision: input.readinessBinding.policyRevision,
        idempotencyKey: input.idempotencyKey,
        requestHash,
        promptHash: 'b'.repeat(64),
        negativePromptHash: 'c'.repeat(64),
        endpointHash: 'd'.repeat(64),
        sourceSha256: 'e'.repeat(64),
        referenceSha256s: [],
        maskSha256: null,
        providerRequestIdSha256: null,
        providerTaskIdSha256: null,
        acceptedAt: new Date(current).toISOString(),
        secret: 'secret-provider-output',
        image: {
          blob: new Blob([new Uint8Array([90, editCalls.length])], { type: 'image/png' }),
          mimeType: 'image/png',
          byteLength: 2,
          sha256: String(editCalls.length).padStart(64, 'f').slice(-64),
          source: 'b64_json',
          resultOrigin: null,
          resultUrlHash: null,
        },
      };
      retainedEdits.set(input.idempotencyKey, generated);
      return generated;
    },
    async commitResult(idempotencyKey, requestHash, commit) {
      const generated = retainedEdits.get(idempotencyKey);
      assert.equal(generated.requestHash, requestHash);
      commitCalls.push({ idempotencyKey, requestHash });
      return commit(generated);
    },
    releaseResult(idempotencyKey, requestHash) {
      const generated = retainedEdits.get(idempotencyKey);
      assert.equal(generated.requestHash, requestHash);
      retainedEdits.delete(idempotencyKey);
      releaseCalls.push({ idempotencyKey, requestHash });
      return { released: true, outcome: 'SUCCEEDED' };
    },
  };

  const authorityGuard = {
    async capture(binding) {
      return {
        lifecycleAuthority: {
          contractVersion: 'extension-byok-device-session-lifecycle/v1',
          epoch: 9,
        },
        ownerUserId: binding.ownerUserId,
        deviceSessionId: binding.deviceSessionId,
        shopId: binding.shopId,
        workflowId: binding.workflowId,
        draftRevision: binding.draftRevision,
        draftVersion: binding.draftVersion,
        policyRevision: binding.policyRevision,
      };
    },
    async commitGeneratedResult(input) {
      commitCalls.push({ authorityCommit: true, operation: input.generated.operation });
      return input.vault.put(
        input.generated,
        input.binding,
        input.authority.lifecycleAuthority,
      );
    },
  };

  const readinessClient = {
    async getReadiness(input) {
      readinessCalls.push(input);
      return readiness(input, current, options.readinessOverrides || {});
    },
  };
  const mediaStore = {
    async getForBackground(trustedOwner, handle, purpose) {
      mediaCalls.push({ owner: trustedOwner, handle, purpose });
      if (Number.isSafeInteger(options.advanceOnMediaMs)) current += options.advanceOnMediaMs;
      const value = mediaEntries.get(handle);
      if (!value) throw new Error('missing media');
      return value;
    },
    releaseOwner(trustedOwner) {
      releasedMediaOwners.push(trustedOwner);
      return { releasedCount: mediaEntries.size, releasedBytes: 16, cancelledChannels: 0 };
    },
  };
  const capturingEngineApi = {
    ...engineApi,
    createEngine(input) {
      engineOptions.push(input);
      return engineApi.createEngine(input);
    },
  };
  const controller = controllerApi.createController({
    mediaJobEngine: capturingEngineApi,
    readinessClient,
    imageEditClient,
    generatedResultVault,
    authorityGuard,
    mediaStore,
    providerSemaphore: semaphoreApi.createSemaphore({ now: () => new Date(current) }),
    crypto: webcrypto,
    randomValues: fillRandom,
    now: () => new Date(current),
  });
  return {
    api: controllerApi,
    controller,
    readinessCalls,
    engineOptions,
    editCalls,
    commitCalls,
    releaseCalls,
    mediaCalls,
    releasedMediaOwners,
    vaultEntries,
    generatedResultVault,
    pinned,
    mediaEntries,
    editGate: options.editGate,
    setVaultFull(value) { vaultFull = value; },
    evictResult(resultId) { return vaultEntries.delete(resultId); },
    advance(ms) { current += ms; },
  };
}

test('uses trusted operation readiness, runner concurrency one, and global/slot precedence', async () => {
  const fixture = createFixture();
  const trustedOwner = owner();
  fixture.controller.open(trustedOwner);
  fixture.controller.setReferences(trustedOwner, {
    scope: 'SESSION_GLOBAL', handles: ['global-1', 'global-2'],
  });
  fixture.controller.setReferences(trustedOwner, {
    scope: 'SLOT', slotKey: trustedOwner.context.slotKey, handles: ['slot-1'],
  });

  await fixture.controller.start(trustedOwner, command('IMAGE_TO_IMAGE'));
  await fixture.controller.whenSettled(trustedOwner);

  assert.equal(fixture.readinessCalls.length, 1);
  assert.equal(fixture.readinessCalls[0].operation, 'IMAGE_TO_IMAGE');
  assert.equal(Object.hasOwn(fixture.readinessCalls[0], 'readinessBinding'), false);
  assert.equal(Object.hasOwn(fixture.readinessCalls[0], 'providerOrigin'), false);
  assert.equal(fixture.engineOptions[0].requestedConcurrency, 1);
  assert.equal(fixture.engineOptions[0].runnerMaxConcurrency, 1);
  assert.deepEqual(plain(fixture.engineOptions[0].concurrencyAuthority), {
    policyRevision: '734', maxConcurrency: 3,
  });
  assert.deepEqual(fixture.mediaCalls.map((item) => [item.handle, item.purpose]), [
    ['slot-1', fixture.api.MEDIA_PURPOSES.IMAGE_TO_IMAGE_REFERENCE],
  ]);
  assert.equal(fixture.editCalls[0].images.length, 1);
  assert.equal(fixture.editCalls[0].images[0], fixture.mediaEntries.get('slot-1').blob);
  assert.equal(fixture.commitCalls.some((item) => item.authorityCommit === true), true);
  assert.equal(fixture.releaseCalls.length, 1);
});

test('rejects invalid reference counts and mask mismatches before any edit call', async () => {
  const noReferences = createFixture();
  const firstOwner = owner({ tabId: 41, documentId: 'document-no-refs' });
  noReferences.controller.open(firstOwner);
  await assert.rejects(
    noReferences.controller.start(firstOwner, command('IMAGE_TO_IMAGE')),
    (error) => error && error.code === 'SS_ERP_BYOK_EDIT_REFERENCE_COUNT_INVALID',
  );
  assert.equal(noReferences.editCalls.length, 0);
  assert.equal(noReferences.readinessCalls.length, 0);

  const mismatch = createFixture();
  const secondOwner = owner({ tabId: 42, documentId: 'document-mask-mismatch' });
  mismatch.controller.open(secondOwner);
  await mismatch.controller.start(secondOwner, command('INPAINT', {
    maskHandle: 'mask-mismatch',
  }));
  const snapshot = await mismatch.controller.whenSettled(secondOwner);
  assert.equal(mismatch.editCalls.length, 0);
  assert.equal(snapshot.alternatives[0].state, 'FAILED_RETRYABLE');
  assert.equal(snapshot.alternatives[0].errorCode, 'SS_ERP_BYOK_EDIT_MASK_DIMENSIONS_MISMATCH');

  const wrongMime = createFixture();
  const thirdOwner = owner({ tabId: 43, documentId: 'document-mask-mime' });
  wrongMime.controller.open(thirdOwner);
  await wrongMime.controller.start(thirdOwner, command('INPAINT', { maskHandle: 'mask-jpeg' }));
  await wrongMime.controller.whenSettled(thirdOwner);
  assert.equal(wrongMime.editCalls.length, 0);

  const missing = createFixture();
  const fourthOwner = owner({ tabId: 44, documentId: 'document-media-missing' });
  missing.controller.open(fourthOwner);
  await missing.controller.start(fourthOwner, command('FULL_EDIT', {
    sourceHandle: 'missing-source',
  }));
  const missingSnapshot = await missing.controller.whenSettled(fourthOwner);
  assert.equal(missing.editCalls.length, 0);
  assert.equal(missingSnapshot.alternatives[0].state, 'FAILED_RETRYABLE');
  assert.equal(
    missingSnapshot.alternatives[0].errorCode,
    'SS_ERP_BYOK_EDIT_MEDIA_UNAVAILABLE',
  );
});

test('dispatches inpaint with one source and one PNG white-edit mask', async () => {
  const fixture = createFixture();
  const trustedOwner = owner({ tabId: 45, documentId: 'document-inpaint-success' });
  fixture.controller.open(trustedOwner);
  await fixture.controller.start(trustedOwner, command('INPAINT'));
  const snapshot = await fixture.controller.whenSettled(trustedOwner);

  assert.equal(snapshot.alternatives[0].state, 'CANDIDATE_READY');
  assert.deepEqual(fixture.readinessCalls.map((item) => item.operation), ['INPAINT']);
  assert.deepEqual(fixture.mediaCalls.map((item) => [item.handle, item.purpose]), [
    ['source-1', fixture.api.MEDIA_PURPOSES.INPAINT_SOURCE],
    ['mask-1', fixture.api.MEDIA_PURPOSES.INPAINT_MASK],
  ]);
  assert.equal(fixture.editCalls.length, 1);
  assert.equal(fixture.editCalls[0].images.length, 1);
  assert.equal(fixture.editCalls[0].images[0], fixture.mediaEntries.get('source-1').blob);
  assert.equal(fixture.editCalls[0].mask.blob, fixture.mediaEntries.get('mask-1').blob);
  assert.equal(
    fixture.editCalls[0].mask.maskSemantics,
    fixture.api.INTERNAL_MASK_SEMANTICS,
  );
});

test('commits a real edit result through the repository vault contract', async () => {
  const fixture = createFixture({ useRealVault: true });
  const trustedOwner = owner({ tabId: 46, documentId: 'document-real-vault' });
  fixture.controller.open(trustedOwner);
  await fixture.controller.start(trustedOwner, command('FULL_EDIT'));
  let snapshot = await fixture.controller.whenSettled(trustedOwner);

  assert.equal(snapshot.alternatives[0].state, 'CANDIDATE_READY');
  assert.match(snapshot.alternatives[0].candidateId, /^br_[a-f0-9]{48}$/u);
  snapshot = fixture.controller.selectAlternative(trustedOwner, {
    attemptId: snapshot.alternatives[0].attemptId,
  });
  assert.equal(snapshot.slot.selectedCandidateId, snapshot.alternatives[0].candidateId);
  assert.equal(fixture.releaseCalls.length, 1);
  assert.equal(fixture.controller.cleanup(trustedOwner).releasedResultCount, 1);
});

test('projects a selected candidate as expired after the real vault TTL removes it', async () => {
  const fixture = createFixture({ useRealVault: true });
  const trustedOwner = owner({ tabId: 47, documentId: 'document-vault-expiry' });
  fixture.controller.open(trustedOwner);
  await fixture.controller.start(trustedOwner, command('FULL_EDIT'));
  let snapshot = await fixture.controller.whenSettled(trustedOwner);
  const attemptId = snapshot.alternatives[0].attemptId;
  snapshot = fixture.controller.selectAlternative(trustedOwner, { attemptId });
  assert.equal(snapshot.slot.selectedAttemptId, attemptId);

  fixture.advance(10 * 60 * 1000 + 1);
  snapshot = fixture.controller.getSnapshot(trustedOwner);
  assert.equal(snapshot.alternatives[0].state, 'EXPIRED');
  assert.equal(snapshot.alternatives[0].candidateId, null);
  assert.equal(snapshot.alternatives[0].selected, false);
  assert.equal(snapshot.slot.selectedAttemptId, null);
  assert.equal(snapshot.slot.selectedCandidateId, null);
  assert.throws(
    () => fixture.controller.selectAlternative(trustedOwner, { attemptId }),
    (error) => error?.code === 'SS_ERP_BYOK_EDIT_RESULT_EXPIRED',
  );
});

test('projects a FIFO-evicted alternate as expired while preserving a retained candidate', async () => {
  const fixture = createFixture();
  const trustedOwner = owner({ tabId: 48, documentId: 'document-vault-fifo' });
  fixture.controller.open(trustedOwner);
  await fixture.controller.start(trustedOwner, command('FULL_EDIT'));
  let snapshot = await fixture.controller.whenSettled(trustedOwner);
  const first = snapshot.alternatives[0];
  const revision = snapshot.slot.revision;
  await fixture.controller.regenerate(trustedOwner, {
    ...command('FULL_EDIT', { sourceHandle: 'source-2' }),
    expectedSlotRevision: revision,
    chargeAcknowledgement: {
      warningVersion: fixture.api.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    },
  });
  snapshot = await fixture.controller.whenSettled(trustedOwner);
  const second = snapshot.alternatives[1];
  assert.equal(fixture.evictResult(first.candidateId), true);

  snapshot = fixture.controller.getSnapshot(trustedOwner);
  assert.equal(snapshot.alternatives[0].state, 'EXPIRED');
  assert.equal(snapshot.alternatives[0].candidateId, null);
  assert.equal(snapshot.alternatives[1].state, 'CANDIDATE_READY');
  assert.equal(snapshot.alternatives[1].candidateId, second.candidateId);
  assert.throws(
    () => fixture.controller.selectAlternative(trustedOwner, { attemptId: first.attemptId }),
    (error) => error?.code === 'SS_ERP_BYOK_EDIT_RESULT_EXPIRED',
  );
});

test('returns only redacted alternatives and never publicizes Blob, secret, readiness, or binding', async () => {
  const fixture = createFixture();
  const trustedOwner = owner({ tabId: 51, documentId: 'document-redacted' });
  fixture.controller.open(trustedOwner);
  await fixture.controller.start(trustedOwner, command('FULL_EDIT'));
  const snapshot = await fixture.controller.whenSettled(trustedOwner);
  const serialized = JSON.stringify(snapshot);

  assert.equal(containsBlob(snapshot), false);
  assert.equal(serialized.includes('secret-provider-output'), false);
  assert.equal(serialized.includes('readinessBinding'), false);
  assert.equal(serialized.includes('providerOrigin'), false);
  assert.equal(serialized.includes('resultHandle'), false);
  assert.equal(snapshot.alternatives.length, 1);
  assert.match(snapshot.alternatives[0].candidateId, /^br_[0-9]{48}$/u);
});

test('preserves alternatives and selection and fences charged regeneration by acknowledgement/revision', async () => {
  const fixture = createFixture();
  const trustedOwner = owner({ tabId: 61, documentId: 'document-regenerate' });
  fixture.controller.open(trustedOwner);
  await fixture.controller.start(trustedOwner, command('FULL_EDIT'));
  let snapshot = await fixture.controller.whenSettled(trustedOwner);
  const first = snapshot.alternatives[0];
  snapshot = fixture.controller.selectAlternative(trustedOwner, { attemptId: first.attemptId });
  const selectedRevision = snapshot.slot.revision;
  assert.equal(fixture.pinned.has(first.candidateId), true);

  await assert.rejects(
    fixture.controller.regenerate(trustedOwner, {
      ...command('FULL_EDIT', { sourceHandle: 'source-2' }),
      expectedSlotRevision: selectedRevision,
      chargeAcknowledgement: {
        warningVersion: fixture.api.EXTERNAL_CHARGE_WARNING_VERSION,
        confirmed: false,
      },
    }),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_CHARGE_ACK_REQUIRED',
  );
  await assert.rejects(
    fixture.controller.regenerate(trustedOwner, {
      ...command('FULL_EDIT', { sourceHandle: 'source-2' }),
      expectedSlotRevision: selectedRevision + 1,
      chargeAcknowledgement: {
        warningVersion: fixture.api.EXTERNAL_CHARGE_WARNING_VERSION,
        confirmed: true,
      },
    }),
    (error) => error && error.code === 'SS_ERP_MEDIA_JOB_SLOT_REVISION_STALE',
  );

  await fixture.controller.regenerate(trustedOwner, {
    ...command('FULL_EDIT', { sourceHandle: 'source-2' }),
    expectedSlotRevision: selectedRevision,
    chargeAcknowledgement: {
      warningVersion: fixture.api.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    },
  });
  snapshot = await fixture.controller.whenSettled(trustedOwner);
  assert.equal(fixture.readinessCalls.length, 2, 'regeneration must fetch fresh readiness');
  assert.equal(snapshot.alternatives.length, 2);
  assert.equal(snapshot.slot.selectedAttemptId, first.attemptId);
  assert.equal(snapshot.slot.selectedCandidateId, first.candidateId);
  const second = snapshot.alternatives[1];
  snapshot = fixture.controller.selectAlternative(trustedOwner, { attemptId: second.attemptId });
  assert.equal(snapshot.slot.selectedCandidateId, second.candidateId);
  assert.equal(fixture.pinned.has(first.candidateId), false);
  assert.equal(fixture.pinned.has(second.candidateId), true);
});

test('rejects page-supplied authority fields and expired bootstrap readiness', async () => {
  const fixture = createFixture();
  const trustedOwner = owner({ tabId: 71, documentId: 'document-injection' });
  fixture.controller.open(trustedOwner);
  await assert.rejects(
    fixture.controller.start(trustedOwner, {
      ...command('FULL_EDIT'),
      endpoint: 'https://evil.example',
      model: 'evil-model',
      readinessBinding: {},
      authority: {},
    }),
    (error) => error && error.code === 'SS_ERP_BYOK_EDIT_INPUT_INVALID',
  );
  assert.equal(fixture.readinessCalls.length, 0);
  assert.equal(fixture.editCalls.length, 0);

  const expired = createFixture({
    readinessOverrides: { expiresAt: '2026-07-27T08:59:59.000Z' },
  });
  const expiredOwner = owner({ tabId: 72, documentId: 'document-expired' });
  expired.controller.open(expiredOwner);
  await assert.rejects(
    expired.controller.start(expiredOwner, command('FULL_EDIT')),
    (error) => error && error.code === 'SS_ERP_BYOK_EDIT_READINESS_EXPIRED',
  );
  assert.equal(expired.editCalls.length, 0);

  const expiredBeforeEdit = createFixture({
    readinessOverrides: { expiresAt: '2026-07-27T09:00:00.005Z' },
    advanceOnMediaMs: 10,
  });
  const delayedOwner = owner({ tabId: 73, documentId: 'document-delayed-expiry' });
  expiredBeforeEdit.controller.open(delayedOwner);
  await expiredBeforeEdit.controller.start(delayedOwner, command('FULL_EDIT'));
  const delayedSnapshot = await expiredBeforeEdit.controller.whenSettled(delayedOwner);
  assert.equal(expiredBeforeEdit.editCalls.length, 0);
  assert.equal(delayedSnapshot.alternatives[0].state, 'FAILED_RETRYABLE');
  assert.equal(
    delayedSnapshot.alternatives[0].errorCode,
    'SS_ERP_BYOK_EDIT_READINESS_EXPIRED',
  );
});

test('replaces stale document owners, releases their alternatives, and denies stale cleanup', async () => {
  const fixture = createFixture();
  const oldOwner = owner({ tabId: 81, documentId: 'document-old' });
  fixture.controller.open(oldOwner);
  await fixture.controller.start(oldOwner, command('FULL_EDIT'));
  let snapshot = await fixture.controller.whenSettled(oldOwner);
  const oldResult = snapshot.alternatives[0].candidateId;
  assert.equal(fixture.vaultEntries.has(oldResult), true);

  const newOwner = owner({ tabId: 81, documentId: 'document-new' });
  fixture.controller.open(newOwner);
  assert.equal(fixture.vaultEntries.has(oldResult), false);
  assert.equal(fixture.releasedMediaOwners.length, 1);
  assert.equal(fixture.releasedMediaOwners[0].documentId, oldOwner.documentId);
  await fixture.controller.start(newOwner, command('FULL_EDIT'));
  snapshot = await fixture.controller.whenSettled(newOwner);
  const newResult = snapshot.alternatives[0].candidateId;
  assert.deepEqual(plain(fixture.controller.cleanup(oldOwner)), {
    cleaned: false, releasedResultCount: 0, externalChargeUnresolved: false,
  });
  assert.equal(fixture.releasedMediaOwners.length, 1);
  assert.equal(fixture.vaultEntries.has(newResult), true);
  assert.deepEqual(plain(fixture.controller.cleanup(newOwner)), {
    cleaned: true, releasedResultCount: 1, externalChargeUnresolved: false,
  });
  assert.equal(fixture.releasedMediaOwners.length, 2);
  assert.equal(fixture.releasedMediaOwners[1].documentId, newOwner.documentId);
  assert.equal(fixture.vaultEntries.has(newResult), false);
});

test('drops an in-flight edit result when the trusted document owner is replaced', async () => {
  const editGate = deferred();
  const fixture = createFixture({ editGate });
  const oldOwner = owner({ tabId: 82, documentId: 'document-active-old' });
  fixture.controller.open(oldOwner);
  await fixture.controller.start(oldOwner, command('FULL_EDIT'));
  await waitFor(() => fixture.editCalls.length === 1);

  const newOwner = owner({ tabId: 82, documentId: 'document-active-new' });
  fixture.controller.open(newOwner);
  editGate.resolve();
  await waitFor(() => fixture.releaseCalls.length === 1);

  assert.equal(fixture.commitCalls.some((item) => item.authorityCommit === true), false);
  assert.equal(fixture.vaultEntries.size, 0);
  assert.equal(fixture.controller.getSnapshot(newOwner).scheduler.state, 'READY');
  assert.equal(fixture.releasedMediaOwners.length, 1);
  assert.equal(fixture.releasedMediaOwners[0].documentId, oldOwner.documentId);
});

test('clears every background owner session for device or permission revocation', async () => {
  const fixture = createFixture();
  const firstOwner = owner({ tabId: 83, documentId: 'document-clear-1' });
  const secondOwner = owner({ tabId: 84, documentId: 'document-clear-2' });
  fixture.controller.open(firstOwner);
  await fixture.controller.start(firstOwner, command('FULL_EDIT'));
  await fixture.controller.whenSettled(firstOwner);
  fixture.controller.open(secondOwner);
  await fixture.controller.start(secondOwner, command('FULL_EDIT'));
  await fixture.controller.whenSettled(secondOwner);

  assert.deepEqual(plain(fixture.controller.clear()), {
    clearedSessionCount: 2,
    releasedResultCount: 2,
    unresolvedSessionCount: 0,
  });
  assert.equal(fixture.vaultEntries.size, 0);
  assert.deepEqual(
    fixture.releasedMediaOwners.map((item) => item.documentId).sort(),
    [firstOwner.documentId, secondOwner.documentId].sort(),
  );
  assert.throws(
    () => fixture.controller.getSnapshot(firstOwner),
    (error) => error?.code === 'SS_ERP_BYOK_EDIT_OWNER_STALE',
  );
  assert.deepEqual(plain(fixture.controller.clear()), {
    clearedSessionCount: 0,
    releasedResultCount: 0,
    unresolvedSessionCount: 0,
  });
});

test('cleans an exact tab when the persisted launch owner is no longer available', async () => {
  const fixture = createFixture({ editGate: deferred() });
  const activeOwner = owner({ tabId: 91, documentId: 'document-tab-cleanup' });
  fixture.controller.open(activeOwner);
  await fixture.controller.start(activeOwner, command('FULL_EDIT'));
  await waitFor(() => fixture.editCalls.length === 1);

  assert.deepEqual(plain(fixture.controller.cleanupByTab(91)), {
    cleaned: true,
    releasedResultCount: 0,
    externalChargeUnresolved: true,
  });
  assert.deepEqual(plain(fixture.controller.cleanupByTab(91)), {
    cleaned: false,
    releasedResultCount: 0,
    externalChargeUnresolved: false,
  });
  assert.equal(fixture.releasedMediaOwners.length, 1);
  fixture.editGate.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.vaultEntries.size, 0);

  assert.throws(() => fixture.controller.cleanupByTab(-1), {
    code: 'SS_ERP_BYOK_EDIT_OWNER_INVALID',
  });
});

test('shares the authenticated Provider concurrency cap across workbench tabs', async () => {
  const editGate = deferred();
  const fixture = createFixture({
    editGate,
    readinessOverrides: { maxConcurrency: 1 },
  });
  const firstOwner = owner({ tabId: 92, documentId: 'document-global-cap-1' });
  const secondOwner = owner({
    tabId: 93,
    documentId: 'document-global-cap-2',
    context: {
      workflowId: 'workflow-2',
      skuKey: 'sku-2',
      slotKey: 'sku:sku-2:hero',
    },
  });
  fixture.controller.open(firstOwner);
  fixture.controller.open(secondOwner);
  await fixture.controller.start(firstOwner, command('FULL_EDIT'));
  await fixture.controller.start(secondOwner, command('FULL_EDIT'));
  await waitFor(() => fixture.editCalls.length === 1);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.editCalls.length, 1,
    'a second tab must wait before making another Provider POST');

  editGate.resolve();
  await Promise.all([
    fixture.controller.whenSettled(firstOwner),
    fixture.controller.whenSettled(secondOwner),
  ]);
  assert.equal(fixture.editCalls.length, 2);
});

test('cancels a queued tab without releasing active Provider work or dispatching later', async () => {
  const editGate = deferred();
  const fixture = createFixture({
    editGate,
    readinessOverrides: { maxConcurrency: 1 },
  });
  const activeOwner = owner({ tabId: 94, documentId: 'document-active-cap' });
  const queuedOwner = owner({
    tabId: 95,
    documentId: 'document-queued-cap',
    context: {
      workflowId: 'workflow-queued',
      skuKey: 'sku-queued',
      slotKey: 'sku:sku-queued:hero',
    },
  });
  fixture.controller.open(activeOwner);
  fixture.controller.open(queuedOwner);
  await fixture.controller.start(activeOwner, command('FULL_EDIT'));
  await fixture.controller.start(queuedOwner, command('FULL_EDIT'));
  await waitFor(() => fixture.editCalls.length === 1);
  assert.equal(fixture.controller.cleanupByTab(queuedOwner.tabId).cleaned, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.editCalls.length, 1);

  editGate.resolve();
  await fixture.controller.whenSettled(activeOwner);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fixture.editCalls.length, 1,
    'the closed queued tab must never reach the Provider after capacity is released');
});

test('releases Provider bytes and pauses the engine when vault capacity applies backpressure', async () => {
  const fixture = createFixture();
  fixture.setVaultFull(true);
  const trustedOwner = owner({ tabId: 91, documentId: 'document-backpressure' });
  fixture.controller.open(trustedOwner);
  await fixture.controller.start(trustedOwner, command('FULL_EDIT'));
  const snapshot = await fixture.controller.whenSettled(trustedOwner);

  assert.equal(fixture.editCalls.length, 1);
  assert.equal(fixture.releaseCalls.length, 1);
  assert.equal(snapshot.scheduler.pauseRequested, true);
  assert.equal(snapshot.alternatives[0].state, 'FAILED_FINAL');
  assert.equal(snapshot.alternatives[0].errorCode, 'SS_ERP_BYOK_RESULT_VAULT_FULL');
  assert.equal(fixture.vaultEntries.size, 0);
});

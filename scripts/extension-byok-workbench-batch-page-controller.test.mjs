import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL(
  '../extensions/ss-erp/pages/ai-image-workbench-batch.js',
  import.meta.url,
), 'utf8');

function uuid(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
}

function sha256Hex(value) {
  return Array.from(value).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function bootstrap() {
  return {
    contractVersion: 'extension-byok-workbench-workspace-state/v1',
    binding: {
      shopId: 'shop-1',
      workflowId: 'workflow-1',
      draftRevision: 7,
      draftVersion: 11,
    },
    executionMode: 'BYOK',
    availableExecutionModes: ['ERP_HOSTED', 'BYOK'],
    dispatched: false,
    selectedSkuKey: 'sku-1',
    selectedSlotKey: 'sku:sku-1:hero',
    globalReferenceIds: [],
    libraryItems: [],
    skus: [{
      skuKey: 'sku-1',
      label: 'SKU 1',
      slots: [{
        slotKey: 'sku:sku-1:hero',
        role: 'HERO',
        prompt: 'White ceramic mug on a clean background',
        negativePrompt: 'watermark',
        referenceIds: [],
        alternatives: [],
        selectedAttemptId: null,
      }, {
        slotKey: 'shared:detail:DETAIL',
        role: 'DETAIL',
        assignmentScope: 'SHARED',
        applicableSkuKeys: ['sku-1'],
        prompt: 'Close-up of the ceramic surface',
        negativePrompt: '',
        referenceIds: [],
        alternatives: [],
        selectedAttemptId: null,
      }],
    }],
  };
}

function projection(overrides = {}) {
  return {
    contractVersion: 'extension-byok-workbench-batch-coordinator/v1',
    executionMode: 'BYOK',
    revision: 3,
    scheduler: {
      state: 'REVIEW',
      activeCount: 0,
      queuedCount: 0,
      pauseRequested: false,
      effectiveConcurrency: 1,
    },
    billing: { erpGenerationChargeCents: 0 },
    slots: [{
      slotKey: 'sku:sku-1:hero',
      skuKey: 'sku-1',
      assignmentOrdinal: 0,
      operation: 'TEXT_TO_IMAGE',
      revision: 2,
      state: 'CANDIDATE_READY',
      selectedAttemptId: null,
      selectedResultId: null,
      attempts: [{
        attemptId: 'attempt-1',
        generation: 1,
        operation: 'TEXT_TO_IMAGE',
        state: 'CANDIDATE_READY',
        resultId: `br_${'a'.repeat(48)}`,
        errorCode: null,
        retryOfAttemptId: null,
        externalChargePossible: true,
        retryRisk: null,
        chargeWarningVersion: 'external-provider-charge/v1',
        automaticRetryAllowed: false,
        recoveryRequirement: null,
        unknownOutcomeSuperseded: false,
        reviewState: 'AVAILABLE',
      }],
    }],
    ingest: {
      state: 'NOT_STARTED',
      replayed: null,
      receiptId: null,
      boundDraftRevision: null,
      boundDraftVersion: null,
      erpGenerationChargeCents: 0,
      rebootstrapRequired: false,
      errorCode: null,
    },
    ...overrides,
  };
}

function createHarness(options = {}) {
  const calls = [];
  const emitted = [];
  let uuidIndex = 1;
  const client = {
    async state() {
      calls.push(['state']);
      return typeof options.state === 'function' ? options.state() : projection();
    },
    async start(value) {
      calls.push(['start', value]);
      return typeof options.start === 'function' ? options.start(value) : projection();
    },
    async command(value) {
      calls.push(['command', value]);
      if (value.kind !== 'KEEP_ATTEMPT') return projection();
      const kept = projection();
      kept.slots[0].selectedAttemptId = 'attempt-1';
      kept.slots[0].selectedResultId = `br_${'a'.repeat(48)}`;
      kept.slots[0].attempts[0].reviewState = 'KEPT';
      return kept;
    },
    async openPreview(value) {
      calls.push(['preview', value]);
      return {
        slotKey: value.slotKey,
        attemptId: value.attemptId,
        image: new Blob(['image'], { type: 'image/png' }),
        metadata: {
          mimeType: 'image/png',
          byteLength: 5,
          sha256: 'b'.repeat(64),
        },
      };
    },
    async ingest(value) {
      calls.push(['ingest', value]);
      return projection({
        revision: 5,
        ingest: {
          state: 'SUCCEEDED',
          replayed: false,
          receiptId: 'receipt-1',
          boundDraftRevision: 8,
          boundDraftVersion: 12,
          erpGenerationChargeCents: 0,
          rebootstrapRequired: true,
          errorCode: null,
        },
      });
    },
    async recover(value) { calls.push(['recover', value]); return projection(); },
    async clear() {
      calls.push(['clear']);
      return typeof options.clear === 'function' ? options.clear() : { cleared: true };
    },
  };
  const context = {
    console,
    Blob,
    ArrayBuffer,
    Uint8Array,
    TextEncoder,
    URL: {
      createObjectURL() { return 'blob:ss-erp-preview'; },
      revokeObjectURL(value) { calls.push(['revoke', value]); },
    },
    crypto: {
      randomUUID() { return uuid(uuidIndex++); },
      subtle: {
        async digest(_algorithm, bytes) {
          assert.ok(bytes instanceof ArrayBuffer);
          return Uint8Array.from({ length: 32 }, (_unused, index) => index).buffer;
        },
      },
    },
  };
  context.globalThis = context;
  context.self = context;
  vm.runInNewContext(source, context, { filename: 'ai-image-workbench-batch.js' });
  const api = context.SS_ERP_BYOK_WORKBENCH_BATCH_PAGE;
  assert.ok(api && typeof api.createController === 'function');
  let runtimeRevision = 0;
  const controller = api.createController({
    client,
    crypto: context.crypto,
    TextEncoder,
    Blob,
    URL: context.URL,
    nextRuntimeRevision() { runtimeRevision += 1; return runtimeRevision; },
    emit(type, detail) { emitted.push({ type, detail }); },
  });
  return { api, controller, calls, emitted };
}

function batchError(code, outcome = 'UNKNOWN_OUTCOME') {
  return Object.assign(new Error(code), {
    code,
    outcome,
    automaticRetryAllowed: false,
  });
}

{
  const { controller, calls, emitted } = createHarness();
  controller.bootstrap(bootstrap());
  controller.setSlotSelected('shared:detail:DETAIL', true);
  for (const requestedConcurrency of [2, 3, 4]) {
    assert.throws(
      () => controller.setConcurrency(requestedConcurrency),
      (error) => error?.code === 'SS_ERP_BYOK_BATCH_PAGE_CONCURRENCY_INVALID',
    );
  }
  await controller.start({ profileId: 'profile-1', size: '1024x1024' });

  const start = calls.find((call) => call[0] === 'start')[1];
  assert.deepEqual(Object.keys(start), [
    'profileId', 'requestedConcurrency', 'slots',
  ]);
  assert.equal(start.requestedConcurrency, 1);
  assert.equal(start.slots.length, 2);
  assert.equal(start.slots[0].providerIdempotencyKey.startsWith('byok-page:'), true);
  assert.equal(start.slots[0].intentHash, sha256Hex(Uint8Array.from({ length: 32 }, (_v, i) => i)));
  assert.equal(JSON.stringify(start).includes('shop-1'), false);
  assert.equal(JSON.stringify(start).includes('workflow-1'), false);
  assert.equal(JSON.stringify(start).toLowerCase().includes('batchid'), false);
  assert.equal(JSON.stringify(start).toLowerCase().includes('binding'), false);
  assert.ok(emitted.some((event) => event.type === 'ss-erp:workspace-runtime'));
}

{
  const { controller, calls, emitted } = createHarness();
  controller.bootstrap(bootstrap());
  await controller.start({ profileId: 'profile-1', size: '1024x1024' });
  await controller.handleWorkspaceAction({
    contractVersion: 'extension-byok-workbench-workspace-action/v1',
    action: 'PREVIEW_ATTEMPT',
    revision: 2,
    executionMode: 'BYOK',
    skuKey: 'sku-1',
    slotKey: 'sku:sku-1:hero',
    mediaId: null,
    attemptId: 'attempt-1',
    libraryKind: null,
    direction: null,
    prompt: null,
    negativePrompt: null,
  });
  assert.equal(
    JSON.stringify(calls.find((call) => call[0] === 'preview')[1]),
    JSON.stringify({ slotKey: 'sku:sku-1:hero', attemptId: 'attempt-1' }),
  );
  assert.equal(controller.getView().preview.objectUrl, 'blob:ss-erp-preview');
  controller.markPreviewLoaded();
  assert.ok(emitted.some((event) => event.type === 'ss-erp:workspace-preview-state'
    && event.detail.ready === true));

  await controller.handleWorkspaceIntent({
    contractVersion: 'extension-byok-workbench-action-intent/v1',
    binding: bootstrap().binding,
    action: 'KEEP_ATTEMPT',
    commandId: uuid(99),
    expectedWorkspaceRevision: 3,
    expectedRuntimeRevision: 1,
    expectedSlotRevision: 2,
    slotKey: 'sku:sku-1:hero',
    attemptId: 'attempt-1',
    externalChargeAcknowledgement: null,
  });
  const command = calls.find((call) => call[0] === 'command')[1];
  assert.equal(Object.hasOwn(command, 'binding'), false);
  assert.equal(Object.hasOwn(command, 'batchId'), false);
  assert.equal(command.kind, 'KEEP_ATTEMPT');
  assert.equal(command.expectedRuntimeRevision, 3,
    'the trusted background projection revision fences the Registry command');
}

{
  const { controller, calls, emitted } = createHarness();
  controller.bootstrap(bootstrap());
  await controller.start({ profileId: 'profile-1', size: '1024x1024' });
  await controller.handleWorkspaceIntent({
    contractVersion: 'extension-byok-workbench-action-intent/v1',
    binding: bootstrap().binding,
    action: 'KEEP_ATTEMPT',
    commandId: uuid(100),
    expectedWorkspaceRevision: 3,
    expectedRuntimeRevision: 1,
    expectedSlotRevision: 2,
    slotKey: 'sku:sku-1:hero',
    attemptId: 'attempt-1',
    externalChargeAcknowledgement: null,
  });
  await controller.ingest();
  assert.equal(calls.some((call) => call[0] === 'clear'), true);
  assert.ok(emitted.some((event) => event.type === 'ss-erp:workspace-authoritative-reload'
    && event.detail.boundDraftRevision === 8
    && event.detail.boundDraftVersion === 12));
  assert.equal(controller.getView().erpGenerationChargeCents, 0);
}

{
  const { controller, emitted } = createHarness({
    async clear() { throw new Error('CLEAR_RESPONSE_LOST'); },
  });
  controller.bootstrap(bootstrap());
  await controller.start({ profileId: 'profile-1', size: '1024x1024' });
  await controller.handleWorkspaceIntent({
    contractVersion: 'extension-byok-workbench-action-intent/v1',
    binding: bootstrap().binding,
    action: 'KEEP_ATTEMPT',
    commandId: uuid(101),
    expectedWorkspaceRevision: 3,
    expectedRuntimeRevision: 1,
    expectedSlotRevision: 2,
    slotKey: 'sku:sku-1:hero',
    attemptId: 'attempt-1',
    externalChargeAcknowledgement: null,
  });
  await assert.doesNotReject(controller.ingest());
  assert.equal(controller.getView().active, false);
  assert.equal(emitted.filter((event) => (
    event.type === 'ss-erp:workspace-authoritative-reload'
  )).length, 1, 'a lost cleanup response must not suppress the committed draft reload');
}

{
  const startError = batchError('SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_UNRESOLVED');
  const stateError = batchError('SS_ERP_BYOK_BATCH_REGISTRY_START_UNRESOLVED');
  const { controller } = createHarness({
    async start() { throw startError; },
    async state() { throw stateError; },
  });
  controller.bootstrap(bootstrap());
  await assert.rejects(controller.start({ profileId: 'profile-1', size: '1024x1024' }),
    (error) => error === startError);
  assert.equal(controller.getView().active, true);
  assert.equal(controller.getView().locked, true);

  await assert.rejects(controller.refresh(), (error) => error === stateError);
  assert.equal(controller.getView().active, true,
    'an unresolved startup poll must retain the duplicate-dispatch lock');
  assert.equal(controller.getView().locked, true);
}

{
  const startError = batchError('SS_ERP_BYOK_BATCH_CLIENT_RESPONSE_UNRESOLVED');
  const { controller } = createHarness({
    async start() { throw startError; },
    async state() {
      return projection({ revision: 0, scheduler: null, slots: [], ingest: null });
    },
  });
  controller.bootstrap(bootstrap());
  await assert.rejects(controller.start({ profileId: 'profile-1', size: '1024x1024' }));
  assert.equal(controller.getView().active, true);

  assert.equal(await controller.refresh(), null);
  assert.equal(controller.getView().active, false,
    'only an explicit empty Registry projection releases the startup lock');
  assert.equal(controller.getView().locked, false);
  assert.equal(controller.getView().errorCode, null);
}

console.log('extension BYOK workbench batch page controller tests passed');

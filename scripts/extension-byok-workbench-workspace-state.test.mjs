import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const contractPath = 'extensions/ss-erp/shared/contracts/ai-image-workbench-v1.js';
const modulePath = 'extensions/ss-erp/shared/byok/workbench-workspace-state.js';

function plain(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadApi() {
  assert.equal(fs.existsSync(modulePath), true, 'workspace state module must exist');
  const context = {
    Array, Boolean, Error, JSON, Map, Math, Number, Object, RegExp, Set, String, TypeError,
  };
  context.globalThis = context;
  vm.runInNewContext(fs.readFileSync(contractPath, 'utf8'), context, { filename: contractPath });
  vm.runInNewContext(fs.readFileSync(modulePath, 'utf8'), context, { filename: modulePath });
  return context.SS_ERP_BYOK_WORKBENCH_WORKSPACE_STATE;
}

function libraryItem(mediaId, sourceType, overrides = {}) {
  return {
    mediaId,
    sourceType,
    label: `${sourceType} ${mediaId}`,
    secondaryLabel: '',
    skuKeys: [],
    referenceEligible: true,
    ...overrides,
  };
}

function alternative(attemptId, state = 'CANDIDATE_READY', mediaId = `generated-${attemptId}`) {
  return { attemptId, state, mediaId, errorCode: null };
}

function slot(slotKey, role, overrides = {}) {
  return {
    slotKey,
    role,
    prompt: '',
    negativePrompt: '',
    referenceIds: null,
    alternatives: [],
    selectedAttemptId: null,
    ...overrides,
  };
}

function binding(overrides = {}) {
  return {
    shopId: 'shop-primary',
    workflowId: 'workflow-primary',
    draftRevision: 7,
    draftVersion: 11,
    ...overrides,
  };
}

function sku(skuKey, overrides = {}) {
  return {
    skuKey,
    label: `SKU ${skuKey}`,
    slots: [
      slot(`${skuKey}:hero`, 'HERO'),
      slot(`${skuKey}:detail-1`, 'DETAIL'),
    ],
    ...overrides,
  };
}

function input(overrides = {}) {
  return {
    contractVersion: 'extension-byok-workbench-workspace-state/v1',
    binding: binding(),
    executionMode: 'BYOK',
    dispatched: false,
    selectedSkuKey: 'sku-red',
    selectedSlotKey: null,
    globalReferenceIds: ['captured-main'],
    libraryItems: [
      libraryItem('captured-main', 'CAPTURED'),
      libraryItem('sku-red-source', 'SKU', { skuKeys: ['sku-red'] }),
      libraryItem('upload-one', 'UPLOADED'),
      libraryItem('generated-seed', 'GENERATED'),
    ],
    skus: [sku('sku-red'), sku('sku-blue')],
    ...overrides,
  };
}

function publishProjection(api, workspace, revision, overrides = {}) {
  const basis = workspace.getSnapshot().publishBasis;
  return {
    contractVersion: api.PUBLISH_PROJECTION_CONTRACT_VERSION,
    revision,
    expectedWorkspaceRevision: basis.expectedWorkspaceRevision,
    expectedRuntimeRevision: basis.expectedRuntimeRevision,
    binding: plain(basis.binding),
    draftState: 'CURRENT',
    disabledReason: null,
    orderedMedia: plain(basis.orderedMedia),
    ...overrides,
  };
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach((child) => assertDeepFrozen(child, seen));
}

test('creates a stable closed v1 snapshot with four media sources and no invented facts', () => {
  const api = loadApi();
  assert.equal(api.CONTRACT_VERSION, 'extension-byok-workbench-workspace-state/v1');
  assert.equal(api.RUNTIME_CONTRACT_VERSION, 'extension-byok-workbench-workspace-runtime/v1');
  assert.equal(
    api.ACTION_OUTCOME_CONTRACT_VERSION,
    'extension-byok-workbench-action-outcome/v1',
  );
  assert.deepEqual(Array.from(api.MEDIA_SOURCE_TYPES), ['CAPTURED', 'SKU', 'UPLOADED', 'GENERATED']);

  const workspace = api.createWorkspace(input());
  const snapshot = workspace.getSnapshot();
  assert.deepEqual(Object.keys(snapshot), [
    'contractVersion', 'runtimeContractVersion', 'revision', 'runtimeRevision',
    'publishProjectionContractVersion', 'publishRevision', 'publishBasis', 'binding',
    'executionMode', 'executionModeFrozen', 'modeDisabledReasons', 'selectedSkuKey',
    'selectedSlotKey', 'globalReferenceIds', 'globalReferencesEditable',
    'globalReferencesDisabledReason', 'libraryItems', 'skus', 'slots', 'taskSummary',
    'taskControls', 'publishSummary',
  ]);
  assert.deepEqual(Object.keys(snapshot.libraryItems[0]), [
    'mediaId', 'sourceType', 'label', 'secondaryLabel', 'skuKeys', 'referenceEligible',
    'selectedAsGlobalReference', 'selectedAsSlotReference',
  ]);
  assert.deepEqual(Object.keys(snapshot.skus[0]), [
    'skuKey', 'label', 'selected', 'slotKeys', 'mainSlotKey',
  ]);
  assert.deepEqual(Object.keys(snapshot.slots[0]), [
    'slotKey', 'skuKey', 'position', 'role', 'isMain', 'selected', 'status', 'prompt',
    'negativePrompt', 'promptEditable', 'promptDisabledReason', 'referenceSource',
    'referenceIds', 'referenceOverrideIds', 'referencesEditable',
    'referencesDisabledReason', 'alternatives', 'selectedAttemptId',
    'slotRevision',
    'regenerateAvailable', 'regenerateDisabledReason', 'publishMediaEligible',
    'publishMediaDisabledReason',
  ]);
  assert.deepEqual(Object.keys(snapshot.taskSummary), [
    'schedulerState', 'disabledReason', 'totalSlots', 'selectedSlots', 'missingSlots',
    'queuedAttempts', 'activeAttempts', 'candidateReadyAttempts', 'failedAttempts',
    'unknownOutcomeAttempts', 'cancelledAttempts', 'expiredAttempts', 'missingSlotKeys',
  ]);
  assert.equal(snapshot.executionMode, 'BYOK');
  assert.equal(snapshot.executionModeFrozen, false);
  assert.equal(snapshot.globalReferencesEditable, true);
  assert.equal(snapshot.globalReferencesDisabledReason, null);
  assert.equal(snapshot.slots[0].referencesEditable, true);
  assert.equal(snapshot.slots[0].referencesDisabledReason, null);
  assert.deepEqual(plain(snapshot.modeDisabledReasons), {
    ERP_HOSTED: 'HOSTED_ADAPTER_NOT_READY',
    BYOK: null,
  });
  assert.equal(snapshot.selectedSkuKey, 'sku-red');
  assert.equal(snapshot.taskSummary.disabledReason, 'BATCH_COORDINATOR_NOT_READY');
  assert.deepEqual(Object.keys(snapshot.taskControls), [
    'pauseAfterCurrent', 'continue', 'cancelQueued',
  ]);
  assert.deepEqual(plain(snapshot.taskControls), {
    pauseAfterCurrent: { enabled: false, disabledReason: 'BATCH_COORDINATOR_NOT_READY' },
    continue: { enabled: false, disabledReason: 'BATCH_COORDINATOR_NOT_READY' },
    cancelQueued: {
      enabled: false,
      disabledReason: 'BATCH_COORDINATOR_NOT_READY',
      attemptIds: [],
    },
  });
  assert.equal(snapshot.publishRevision, 0);
  assert.deepEqual(Object.keys(snapshot.publishBasis), [
    'expectedWorkspaceRevision', 'expectedRuntimeRevision', 'binding', 'orderedMedia',
  ]);
  assert.equal(snapshot.publishBasis.expectedWorkspaceRevision, snapshot.revision);
  assert.equal(snapshot.publishBasis.expectedRuntimeRevision, snapshot.runtimeRevision);
  assert.deepEqual(plain(snapshot.publishBasis.binding), binding());
  assert.deepEqual(plain(snapshot.publishBasis.orderedMedia), []);
  assert.deepEqual(plain(snapshot.binding), binding());
  assertDeepFrozen(snapshot.binding);
  assert.equal(snapshot.publishSummary.draftState, 'UNKNOWN');
  assert.equal(snapshot.publishSummary.eligible, false);
  assert.deepEqual(plain(snapshot.publishSummary.blockerCodes), [
    'PUBLISH_COORDINATOR_NOT_READY', 'DRAFT_STATUS_UNKNOWN', 'MISSING_SELECTION',
  ]);
  assert.equal(snapshot.selectedSlotKey, 'sku-red:hero');
  assert.deepEqual(plain(snapshot.skus.map((row) => row.skuKey)), ['sku-red', 'sku-blue']);
  assert.deepEqual(plain(snapshot.slots.map((row) => row.slotKey)), [
    'sku-red:hero', 'sku-red:detail-1', 'sku-blue:hero', 'sku-blue:detail-1',
  ]);
  assert.deepEqual(plain(snapshot.libraryItems.map((row) => row.sourceType)), [
    'CAPTURED', 'SKU', 'UPLOADED', 'GENERATED',
  ]);
  assert.equal(snapshot.libraryItems[0].selectedAsGlobalReference, true);
  assert.equal(snapshot.libraryItems[0].selectedAsSlotReference, true);
  assert.equal(snapshot.slots[0].prompt, '');
  assert.equal(snapshot.slots[0].negativePrompt, '');
  assert.equal(JSON.stringify(snapshot).includes('material'), false);
  assert.equal(JSON.stringify(snapshot).includes('dimension'), false);
  assertDeepFrozen(snapshot);

  assert.deepEqual(plain(workspace.getSnapshot()), plain(snapshot));
});

test('rejects unknown fields, URL-bearing text, ineligible references, and invalid limits', () => {
  const api = loadApi();
  const { binding: omittedBinding, ...withoutBinding } = input();
  assert.ok(omittedBinding);
  const invalidInputs = [
    withoutBinding,
    { ...input(), arbitrary: true },
    input({ binding: { ...binding(), arbitrary: true } }),
    input({ binding: binding({ shopId: ' shop-primary' }) }),
    input({ binding: binding({ shopId: 'https://shop.example' }) }),
    input({ binding: binding({ workflowId: 'ｗorkflow-primary' }) }),
    input({ binding: binding({ draftRevision: 0 }) }),
    input({ binding: binding({ draftVersion: 1.5 }) }),
    input({ binding: binding({ draftVersion: Number.MAX_SAFE_INTEGER + 1 }) }),
    input({ availableExecutionModes: [] }),
    input({ availableExecutionModes: ['BYOK', 'BYOK'] }),
    input({ availableExecutionModes: ['BYOK', 'UNKNOWN'] }),
    input({ libraryItems: [{ ...libraryItem('one', 'CAPTURED'), previewUrl: 'https://x.test/a' }] }),
    input({ libraryItems: [libraryItem('one', 'CAPTURED', { label: 'https://x.test/a' })] }),
    input({
      globalReferenceIds: ['captured-main'],
      libraryItems: [libraryItem('captured-main', 'CAPTURED', { referenceEligible: false })],
    }),
    input({ skus: Array.from({ length: 51 }, (_, index) => sku(`sku-${index}`)) }),
    input({
      skus: [sku('sku-red', {
        slots: Array.from({ length: 501 }, (_, index) => slot(
          `sku-red:${index}`,
          index === 0 ? 'HERO' : 'DETAIL',
        )),
      })],
      selectedSkuKey: 'sku-red',
    }),
  ];

  for (const invalid of invalidInputs) {
    assert.throws(
      () => api.createWorkspace(invalid),
      (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
    );
  }
});

test('fails closed for the pending hosted adapter and freezes mode after dispatch', () => {
  const workspace = loadApi().createWorkspace(input());
  assert.equal(workspace.setExecutionMode('BYOK').executionMode, 'BYOK');
  assert.throws(
    () => workspace.setExecutionMode('ERP_HOSTED'),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_MODE_UNAVAILABLE',
  );
  const dispatched = workspace.markDispatched();
  assert.equal(dispatched.executionModeFrozen, true);
  assert.deepEqual(plain(dispatched.modeDisabledReasons), {
    ERP_HOSTED: 'HOSTED_ADAPTER_NOT_READY',
    BYOK: null,
  });
  assert.throws(
    () => workspace.setExecutionMode('ERP_HOSTED'),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_MODE_LOCKED',
  );
  assert.equal(workspace.setExecutionMode('BYOK').executionMode, 'BYOK');
  assert.throws(
    () => loadApi().createWorkspace(input({ executionMode: 'ERP_HOSTED' })),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_MODE_UNAVAILABLE',
  );
  assert.throws(
    () => loadApi().createWorkspace(input({ availableExecutionModes: ['ERP_HOSTED'] })),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_MODE_UNAVAILABLE',
  );
});

test('allows only explicitly connected execution modes and locks the selected mode after dispatch', () => {
  const api = loadApi();
  const workspace = api.createWorkspace(input({
    availableExecutionModes: ['BYOK', 'ERP_HOSTED'],
  }));
  assert.deepEqual(plain(workspace.getSnapshot().modeDisabledReasons), {
    ERP_HOSTED: null,
    BYOK: null,
  });
  assert.equal(workspace.setExecutionMode('ERP_HOSTED').executionMode, 'ERP_HOSTED');
  assert.equal(workspace.setExecutionMode('BYOK').executionMode, 'BYOK');
  assert.equal(workspace.setExecutionMode('ERP_HOSTED').executionMode, 'ERP_HOSTED');
  workspace.markDispatched();
  assert.throws(
    () => workspace.setExecutionMode('BYOK'),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_MODE_LOCKED',
  );

  const hosted = api.createWorkspace(input({
    executionMode: 'ERP_HOSTED',
    availableExecutionModes: ['ERP_HOSTED'],
  }));
  assert.deepEqual(plain(hosted.getSnapshot().modeDisabledReasons), {
    ERP_HOSTED: null,
    BYOK: 'BYOK_ADAPTER_NOT_READY',
  });
  assert.throws(
    () => hosted.setExecutionMode('BYOK'),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_MODE_UNAVAILABLE',
  );
});

test('supports keyboard SKU selection and preserves the last selected slot per SKU', () => {
  const workspace = loadApi().createWorkspace(input());
  workspace.selectSlot('sku-red:detail-1');
  assert.equal(workspace.selectSkuByKeyboard('ArrowRight').selectedSkuKey, 'sku-blue');
  assert.equal(workspace.getSnapshot().selectedSlotKey, 'sku-blue:hero');
  assert.equal(workspace.selectSkuByKeyboard('ArrowDown').selectedSkuKey, 'sku-blue');
  assert.equal(workspace.selectSkuByKeyboard('Home').selectedSkuKey, 'sku-red');
  assert.equal(workspace.getSnapshot().selectedSlotKey, 'sku-red:detail-1');
  assert.equal(workspace.selectSkuByKeyboard('End').selectedSkuKey, 'sku-blue');
  assert.equal(workspace.selectSkuByKeyboard('ArrowLeft').selectedSkuKey, 'sku-red');
  assert.throws(
    () => workspace.selectSkuByKeyboard('PageDown'),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_SELECTION_INVALID',
  );
});

test('keeps one main slot per SKU and moves the selected slot deterministically', () => {
  const api = loadApi();
  assert.throws(
    () => api.createWorkspace(input({
      skus: [sku('sku-red', {
        slots: [
          slot('sku-red:detail-1', 'DETAIL'),
          slot('sku-red:hero', 'HERO'),
        ],
      })],
    })),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );

  const workspace = api.createWorkspace(input());
  workspace.selectSlot('sku-red:detail-1');
  let snapshot = workspace.setMainSlot('sku-red:detail-1');
  const red = snapshot.slots.filter((row) => row.skuKey === 'sku-red');
  assert.equal(red.filter((row) => row.isMain).length, 1);
  assert.equal(red.find((row) => row.isMain).slotKey, 'sku-red:detail-1');
  assert.equal(snapshot.skus[0].mainSlotKey, 'sku-red:detail-1');
  assert.deepEqual(plain(snapshot.skus[0].slotKeys), [
    'sku-red:detail-1', 'sku-red:hero',
  ]);
  assert.deepEqual(plain(red.map((row) => row.role)), ['HERO', 'DETAIL']);

  snapshot = workspace.moveSelectedSlotUp();
  assert.deepEqual(plain(snapshot.skus[0].slotKeys), ['sku-red:detail-1', 'sku-red:hero']);
  assert.deepEqual(
    plain(workspace.moveSelectedSlotUp().skus[0].slotKeys),
    ['sku-red:detail-1', 'sku-red:hero'],
  );
  snapshot = workspace.moveSelectedSlotDown();
  assert.deepEqual(
    plain(snapshot.skus[0].slotKeys),
    ['sku-red:hero', 'sku-red:detail-1'],
  );
  assert.equal(snapshot.skus[0].mainSlotKey, 'sku-red:hero');
  assert.deepEqual(
    plain(snapshot.slots.filter((row) => row.skuKey === 'sku-red').map((row) => row.role)),
    ['HERO', 'DETAIL'],
  );
});

test('updates prompts, references, alternatives, selection, and missing-slot summary', () => {
  const api = loadApi();
  const workspace = api.createWorkspace(input());
  workspace.setSlotPrompt('sku-red:hero', {
    prompt: 'Keep the supplied product identity unchanged.',
    negativePrompt: 'No invented claims.',
  });
  workspace.setSlotReferenceIds('sku-red:hero', ['upload-one']);
  const inherited = workspace.setSlotReferenceIds('sku-red:hero', null);
  assert.equal(inherited.slots[0].referenceSource, 'GLOBAL');
  assert.deepEqual(plain(inherited.slots[0].referenceIds), ['captured-main']);
  workspace.setSlotReferenceIds('sku-red:hero', ['upload-one']);
  workspace.upsertLibraryItem(libraryItem('generated-attempt-1', 'GENERATED', {
    skuKeys: ['sku-red'],
  }));
  const snapshot = workspace.setAlternatives(
    'sku-red:hero',
    [alternative('attempt-1', 'CANDIDATE_READY', 'generated-attempt-1')],
    'attempt-1',
  );

  const hero = snapshot.slots.find((row) => row.slotKey === 'sku-red:hero');
  assert.equal(hero.prompt, 'Keep the supplied product identity unchanged.');
  assert.equal(hero.negativePrompt, 'No invented claims.');
  assert.equal(hero.referenceSource, 'SLOT_OVERRIDE');
  assert.deepEqual(plain(hero.referenceIds), ['upload-one']);
  assert.equal(hero.selectedAttemptId, 'attempt-1');
  assert.equal(snapshot.taskSummary.selectedSlots, 1);
  assert.equal(snapshot.taskSummary.missingSlots, 3);
  assert.deepEqual(plain(snapshot.taskSummary.missingSlotKeys), [
    'sku-red:detail-1', 'sku-blue:hero', 'sku-blue:detail-1',
  ]);
  assert.equal(snapshot.taskSummary.candidateReadyAttempts, 1);
  assertDeepFrozen(snapshot);
});

test('enforces global and per-SKU reference compatibility in every state mutation', () => {
  const api = loadApi();
  assert.throws(
    () => api.createWorkspace(input({ globalReferenceIds: ['sku-red-source'] })),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );

  const workspace = api.createWorkspace(input());
  assert.deepEqual(
    plain(workspace.setSlotReferenceIds('sku-red:hero', ['sku-red-source']).slots[0].referenceIds),
    ['sku-red-source'],
  );
  assert.throws(
    () => workspace.setSlotReferenceIds('sku-blue:hero', ['sku-red-source']),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.throws(
    () => workspace.upsertLibraryItem(libraryItem('sku-red-source', 'SKU', {
      skuKeys: ['sku-blue'],
    })),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
});

test('rejects generated alternatives outside the target slot SKU in all mutation paths', () => {
  const api = loadApi();
  const generatedRed = libraryItem('generated-red-only', 'GENERATED', {
    skuKeys: ['sku-red'],
  });
  const blueWithRedResult = sku('sku-blue', {
    slots: [
      slot('sku-blue:hero', 'HERO', {
        alternatives: [alternative(
          'attempt-red-on-blue', 'CANDIDATE_READY', 'generated-red-only',
        )],
        selectedAttemptId: 'attempt-red-on-blue',
      }),
      slot('sku-blue:detail-1', 'DETAIL'),
    ],
  });
  assert.throws(
    () => api.createWorkspace(input({
      dispatched: true,
      libraryItems: [...input().libraryItems, generatedRed],
      skus: [sku('sku-red'), blueWithRedResult],
    })),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );

  const interactive = api.createWorkspace(input());
  interactive.upsertLibraryItem(generatedRed);
  assert.throws(
    () => interactive.setAlternatives('sku-blue:hero', [alternative(
      'attempt-red-on-blue', 'CANDIDATE_READY', 'generated-red-only',
    )], 'attempt-red-on-blue'),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );

  const runtime = api.createWorkspace(input());
  assert.throws(
    () => runtime.applyRuntimeProjection({
      contractVersion: api.RUNTIME_CONTRACT_VERSION,
      binding: binding(),
      revision: 1,
      task: { schedulerState: 'REVIEW', disabledReason: null },
      libraryItems: [generatedRed],
      slots: [{
        slotKey: 'sku-blue:hero',
        status: 'CANDIDATE_READY',
        alternatives: [alternative(
          'attempt-red-on-blue', 'CANDIDATE_READY', 'generated-red-only',
        )],
        selectedAttemptId: 'attempt-red-on-blue',
      }],
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.equal(runtime.getSnapshot().runtimeRevision, 0);
  assert.equal(
    runtime.getSnapshot().libraryItems.some((item) => item.mediaId === 'generated-red-only'),
    false,
  );
});

test('requires generated media to enumerate every compatible target SKU explicitly', () => {
  const api = loadApi();
  const unscoped = libraryItem('generated-unscoped', 'GENERATED', { skuKeys: [] });
  const scopedAlternative = alternative(
    'attempt-unscoped', 'CANDIDATE_READY', 'generated-unscoped',
  );
  const redWithUnscoped = sku('sku-red', {
    slots: [
      slot('sku-red:hero', 'HERO', {
        alternatives: [scopedAlternative],
        selectedAttemptId: 'attempt-unscoped',
      }),
      slot('sku-red:detail-1', 'DETAIL'),
    ],
  });
  assert.throws(
    () => api.createWorkspace(input({
      dispatched: true,
      libraryItems: [...input().libraryItems, unscoped],
      skus: [redWithUnscoped, sku('sku-blue')],
    })),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );

  const interactive = api.createWorkspace(input());
  interactive.upsertLibraryItem(unscoped);
  assert.throws(
    () => interactive.setAlternatives(
      'sku-red:hero', [scopedAlternative], 'attempt-unscoped',
    ),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );

  const runtime = api.createWorkspace(input());
  assert.throws(
    () => runtime.applyRuntimeProjection({
      contractVersion: api.RUNTIME_CONTRACT_VERSION,
      binding: binding(),
      revision: 1,
      task: { schedulerState: 'REVIEW', disabledReason: null },
      libraryItems: [unscoped],
      slots: [{
        slotKey: 'sku-red:hero',
        status: 'CANDIDATE_READY',
        alternatives: [scopedAlternative],
        selectedAttemptId: 'attempt-unscoped',
      }],
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.equal(runtime.getSnapshot().runtimeRevision, 0);

  const shared = api.createWorkspace(input());
  shared.upsertLibraryItem(libraryItem('generated-shared', 'GENERATED', {
    skuKeys: ['sku-red', 'sku-blue'],
  }));
  shared.setAlternatives('sku-red:hero', [alternative(
    'attempt-shared-red', 'CANDIDATE_READY', 'generated-shared',
  )], 'attempt-shared-red');
  const sharedSnapshot = shared.setAlternatives('sku-blue:hero', [alternative(
    'attempt-shared-blue', 'CANDIDATE_READY', 'generated-shared',
  )], 'attempt-shared-blue');
  assert.equal(sharedSnapshot.taskSummary.selectedSlots, 2);
});

test('freezes global and dispatched-slot reference selection with explicit reasons', () => {
  const api = loadApi();
  assert.deepEqual(Array.from(api.REFERENCE_DISABLED_REASONS), [
    'GLOBAL_REFERENCES_FROZEN',
    'SLOT_EXECUTION_FROZEN',
    'SLOT_EXECUTION_ACTIVE',
    'UNKNOWN_OUTCOME_REQUIRES_RECOVERY',
  ]);
  const workspace = api.createWorkspace(input());
  const active = workspace.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 1,
    task: { schedulerState: 'RUNNING', disabledReason: null },
    libraryItems: [],
    slots: [{
      slotKey: 'sku-red:hero',
      status: 'QUEUED',
      alternatives: [alternative('attempt-reference-lock', 'QUEUED', null)],
      selectedAttemptId: null,
    }],
  });
  assert.equal(active.globalReferencesEditable, false);
  assert.equal(active.globalReferencesDisabledReason, 'GLOBAL_REFERENCES_FROZEN');
  const red = active.slots.find((row) => row.slotKey === 'sku-red:hero');
  const blue = active.slots.find((row) => row.slotKey === 'sku-blue:hero');
  assert.equal(red.referencesEditable, false);
  assert.equal(red.referencesDisabledReason, 'SLOT_EXECUTION_ACTIVE');
  assert.equal(blue.referencesEditable, true);
  assert.equal(blue.referencesDisabledReason, null);

  assert.throws(
    () => workspace.setGlobalReferenceIds(['upload-one']),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_REFERENCE_LOCKED'
      && error.reason === 'GLOBAL_REFERENCES_FROZEN',
  );
  assert.throws(
    () => workspace.setSlotReferenceIds('sku-red:hero', ['upload-one']),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_REFERENCE_LOCKED'
      && error.reason === 'SLOT_EXECUTION_ACTIVE',
  );
  const blueUpdated = workspace.setSlotReferenceIds('sku-blue:hero', ['upload-one']);
  assert.deepEqual(
    plain(blueUpdated.slots.find((row) => row.slotKey === 'sku-blue:hero').referenceIds),
    ['upload-one'],
  );
});

test('keeps the SKU scope of an existing generated media ID immutable', () => {
  const api = loadApi();
  const generatedRed = libraryItem('generated-red-scoped', 'GENERATED', {
    skuKeys: ['sku-red'],
  });
  const broadened = { ...generatedRed, skuKeys: [] };

  const local = api.createWorkspace(input());
  local.upsertLibraryItem(generatedRed);
  assert.throws(
    () => local.upsertLibraryItem(broadened),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.deepEqual(
    plain(local.getSnapshot().libraryItems.find(
      (item) => item.mediaId === 'generated-red-scoped',
    ).skuKeys),
    ['sku-red'],
  );

  const runtime = api.createWorkspace(input({
    libraryItems: [...input().libraryItems, generatedRed],
  }));
  assert.throws(
    () => runtime.applyRuntimeProjection({
      contractVersion: api.RUNTIME_CONTRACT_VERSION,
      binding: binding(),
      revision: 1,
      task: { schedulerState: 'REVIEW', disabledReason: null },
      libraryItems: [broadened],
      slots: [{
        slotKey: 'sku-blue:hero',
        status: 'CANDIDATE_READY',
        alternatives: [alternative(
          'attempt-broadened', 'CANDIDATE_READY', 'generated-red-scoped',
        )],
        selectedAttemptId: 'attempt-broadened',
      }],
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.equal(runtime.getSnapshot().runtimeRevision, 0);
  assert.deepEqual(
    plain(runtime.getSnapshot().libraryItems.find(
      (item) => item.mediaId === 'generated-red-scoped',
    ).skuKeys),
    ['sku-red'],
  );
});

test('binds runtime slot status exactly to the selected attempt state', () => {
  const api = loadApi();
  const workspace = api.createWorkspace(input());
  const candidate = libraryItem('runtime-selected-result', 'GENERATED', {
    skuKeys: ['sku-blue'],
  });
  const projection = {
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 1,
    task: { schedulerState: 'RUNNING', disabledReason: null },
    libraryItems: [candidate],
    slots: [{
      slotKey: 'sku-blue:hero',
      status: 'WAITING',
      alternatives: [
        alternative('attempt-selected', 'CANDIDATE_READY', 'runtime-selected-result'),
        alternative('attempt-other', 'WAITING', null),
      ],
      selectedAttemptId: 'attempt-selected',
    }],
  };
  assert.throws(
    () => workspace.applyRuntimeProjection(projection),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.equal(workspace.getSnapshot().runtimeRevision, 0);

  const accepted = workspace.applyRuntimeProjection({
    ...projection,
    slots: [{ ...projection.slots[0], status: 'CANDIDATE_READY' }],
  });
  assert.equal(accepted.slots.find((row) => row.slotKey === 'sku-blue:hero').status,
    'CANDIDATE_READY');
});

test('keeps runtime scheduler state consistent with the full projected attempt set', () => {
  const api = loadApi();

  function projection(schedulerState, attemptState) {
    return {
      contractVersion: api.RUNTIME_CONTRACT_VERSION,
      binding: binding(),
      revision: 1,
      task: { schedulerState, disabledReason: null },
      libraryItems: [],
      slots: [{
        slotKey: 'sku-red:hero',
        status: attemptState,
        alternatives: [alternative(`attempt-${attemptState}`, attemptState, null)],
        selectedAttemptId: null,
      }],
    };
  }

  for (const [schedulerState, attemptState] of [
    ['READY', 'WAITING'],
    ['PAUSED', 'WAITING'],
  ]) {
    const workspace = api.createWorkspace(input());
    assert.throws(
      () => workspace.applyRuntimeProjection(projection(schedulerState, attemptState)),
      (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
    );
    assert.equal(workspace.getSnapshot().runtimeRevision, 0);
  }

  const pausing = api.createWorkspace(input()).applyRuntimeProjection(
    projection('PAUSING', 'WAITING'),
  );
  assert.equal(pausing.taskSummary.schedulerState, 'PAUSING');
  assert.equal(pausing.taskSummary.activeAttempts, 1);

  const paused = api.createWorkspace(input()).applyRuntimeProjection(
    projection('PAUSED', 'QUEUED'),
  );
  assert.equal(paused.taskSummary.schedulerState, 'PAUSED');
  assert.equal(paused.taskSummary.queuedAttempts, 1);
});

test('accepts canonical Unicode context keys while runtime identifiers stay strict ASCII', () => {
  const api = loadApi();

  function unicodeInput(skuKey, slotKey) {
    return {
      contractVersion: api.CONTRACT_VERSION,
      binding: binding(),
      executionMode: 'BYOK',
      dispatched: false,
      selectedSkuKey: skuKey,
      selectedSlotKey: slotKey,
      globalReferenceIds: ['captured-main'],
      libraryItems: [libraryItem('captured-main', 'CAPTURED')],
      skus: [{
        skuKey,
        label: 'Canonical Unicode SKU',
        slots: [slot(slotKey, 'HERO')],
      }],
    };
  }

  const skuKey = '红色 / Размер 42';
  const slotKey = '主图 · 红色 / 42';
  const unicode = api.createWorkspace(unicodeInput(skuKey, slotKey)).getSnapshot();
  assert.equal(unicode.selectedSkuKey, skuKey);
  assert.equal(unicode.selectedSlotKey, slotKey);
  assert.equal(api.createWorkspace(unicodeInput('款'.repeat(500), '主'.repeat(200)))
    .getSnapshot().selectedSkuKey.length, 500);

  for (const invalid of [
    unicodeInput('款'.repeat(501), 'hero'),
    unicodeInput('sku', '主'.repeat(201)),
    unicodeInput('https://example.test/sku', 'hero'),
    unicodeInput('sk-1234567890', 'hero'),
    unicodeInput('sku', `safe\u202Ehidden`),
    unicodeInput('Ａ', 'hero'),
  ]) {
    assert.throws(
      () => api.createWorkspace(invalid),
      (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
    );
  }

  assert.throws(
    () => api.createWorkspace({
      ...unicodeInput('sku', 'hero'),
      libraryItems: [libraryItem('媒体', 'GENERATED')],
      globalReferenceIds: [],
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  for (const strictAlternative of [
    { attemptId: '尝试', state: 'FAILED_FINAL', mediaId: null, errorCode: null },
    { attemptId: 'attempt-ascii', state: 'FAILED_FINAL', mediaId: null, errorCode: '错误' },
  ]) {
    assert.throws(
      () => api.createWorkspace({
        ...unicodeInput('sku', 'hero'),
        dispatched: true,
        skus: [{
          skuKey: 'sku',
          label: 'SKU',
          slots: [slot('hero', 'HERO', { alternatives: [strictAlternative] })],
        }],
      }),
      (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
    );
  }
});

test('exposes Prompt editability and rejects optimistic writes after execution starts', () => {
  const api = loadApi();
  const workspace = api.createWorkspace(input());
  assert.equal(workspace.getSnapshot().slots[0].promptEditable, true);
  assert.equal(workspace.getSnapshot().slots[0].promptDisabledReason, null);

  const frozen = workspace.markDispatched();
  assert.equal(frozen.slots[0].promptEditable, false);
  assert.equal(frozen.slots[0].promptDisabledReason, 'SLOT_EXECUTION_FROZEN');
  assert.throws(
    () => workspace.setSlotPrompt('sku-red:hero', {
      prompt: 'This local write must not be accepted.',
      negativePrompt: '',
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_PROMPT_LOCKED',
  );
  assert.equal(workspace.getSnapshot().slots[0].prompt, '');

  const active = api.createWorkspace(input());
  const activeSnapshot = active.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 1,
    task: { schedulerState: 'RUNNING', disabledReason: null },
    libraryItems: [],
    slots: [{
      slotKey: 'sku-red:hero',
      status: 'QUEUED',
      alternatives: [alternative('attempt-active', 'QUEUED', null)],
      selectedAttemptId: null,
    }],
  });
  assert.equal(activeSnapshot.slots[0].promptEditable, false);
  assert.equal(activeSnapshot.slots[0].promptDisabledReason, 'SLOT_EXECUTION_ACTIVE');
  const untouchedSlot = activeSnapshot.slots.find((row) => row.slotKey === 'sku-blue:detail-1');
  assert.equal(untouchedSlot.promptEditable, true);
  assert.equal(untouchedSlot.promptDisabledReason, null);
  const batchFrozen = active.markDispatched();
  const nowFrozen = batchFrozen.slots.find((row) => row.slotKey === 'sku-blue:detail-1');
  assert.equal(nowFrozen.promptEditable, false);
  assert.equal(nowFrozen.promptDisabledReason, 'SLOT_EXECUTION_FROZEN');

  const unknown = api.createWorkspace(input());
  const unknownSnapshot = unknown.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 1,
    task: { schedulerState: 'FAILED', disabledReason: null },
    libraryItems: [],
    slots: [{
      slotKey: 'sku-red:hero',
      status: 'UNKNOWN_OUTCOME',
      alternatives: [alternative('attempt-unknown', 'UNKNOWN_OUTCOME', null)],
      selectedAttemptId: null,
    }],
  });
  assert.equal(unknownSnapshot.slots[0].promptEditable, false);
  assert.equal(
    unknownSnapshot.slots[0].promptDisabledReason,
    'UNKNOWN_OUTCOME_REQUIRES_RECOVERY',
  );

  const unknownWithMedia = api.createWorkspace(input());
  assert.throws(
    () => unknownWithMedia.applyRuntimeProjection({
      contractVersion: api.RUNTIME_CONTRACT_VERSION,
      binding: binding(),
      revision: 1,
      task: { schedulerState: 'FAILED', disabledReason: null },
      libraryItems: [libraryItem('unknown-result', 'GENERATED', { skuKeys: ['sku-red'] })],
      slots: [{
        slotKey: 'sku-red:hero',
        status: 'UNKNOWN_OUTCOME',
        alternatives: [alternative('attempt-unknown', 'UNKNOWN_OUTCOME', 'unknown-result')],
        selectedAttemptId: null,
      }],
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.equal(unknownWithMedia.getSnapshot().runtimeRevision, 0);
});

test('applies a closed runtime projection atomically and rejects stale or partial invalid data', () => {
  const api = loadApi();
  const workspace = api.createWorkspace(input());
  const before = workspace.getSnapshot();
  const runtime = {
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 4,
    task: { schedulerState: 'REVIEW', disabledReason: null },
    libraryItems: [libraryItem('runtime-result', 'GENERATED', { skuKeys: ['sku-red'] })],
    slots: [{
      slotKey: 'sku-red:hero',
      status: 'CANDIDATE_READY',
      alternatives: [alternative('attempt-runtime', 'CANDIDATE_READY', 'runtime-result')],
      selectedAttemptId: 'attempt-runtime',
    }],
  };
  const after = workspace.applyRuntimeProjection(runtime);
  assert.equal(after.runtimeRevision, 4);
  assert.equal(after.taskSummary.schedulerState, 'REVIEW');
  assert.equal(after.taskSummary.selectedSlots, 1);
  assert.equal(after.libraryItems.at(-1).mediaId, 'runtime-result');
  assert.equal(after.slots[0].selectedAttemptId, 'attempt-runtime');
  assert.ok(after.revision > before.revision);
  assertDeepFrozen(after);

  assert.throws(
    () => workspace.applyRuntimeProjection(runtime),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_RUNTIME_STALE',
  );
  assert.throws(
    () => workspace.applyRuntimeProjection({ ...runtime, revision: 5, leaked: true }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.equal(workspace.getSnapshot().runtimeRevision, 4);
});

test('rejects cross-shop and old-draft events without advancing any projection revision', () => {
  const api = loadApi();
  const currentBinding = binding({ draftVersion: 12 });
  const workspace = api.createWorkspace(input({ binding: currentBinding }));
  const runtime = {
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: currentBinding,
    revision: 1,
    task: { schedulerState: 'READY', disabledReason: null },
    libraryItems: [],
    slots: [],
  };
  for (const mismatchedBinding of [
    binding({ shopId: 'shop-other', draftVersion: 12 }),
    binding({ workflowId: 'workflow-other', draftVersion: 12 }),
    binding({ draftRevision: 8, draftVersion: 12 }),
    binding({ draftVersion: 11 }),
  ]) {
    assert.throws(
      () => workspace.applyRuntimeProjection({
        ...runtime,
        revision: 99,
        binding: mismatchedBinding,
      }),
      (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_BINDING_MISMATCH',
    );
    assert.equal(workspace.getSnapshot().runtimeRevision, 0);
  }

  const { binding: removedRuntimeBinding, ...runtimeWithoutBinding } = runtime;
  assert.ok(removedRuntimeBinding);
  assert.throws(
    () => workspace.applyRuntimeProjection(runtimeWithoutBinding),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.throws(
    () => workspace.applyRuntimeProjection({
      ...runtime,
      binding: { ...currentBinding, unexpected: true },
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );

  const publish = publishProjection(api, workspace, 1);
  const { binding: removedPublishBinding, ...publishWithoutBinding } = publish;
  assert.ok(removedPublishBinding);
  assert.throws(
    () => workspace.applyPublishProjection(publishWithoutBinding),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.throws(
    () => workspace.applyPublishProjection({
      ...publish,
      binding: { ...currentBinding, unexpected: true },
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.throws(
    () => workspace.applyPublishProjection({
      ...publish,
      revision: 99,
      binding: binding({ draftVersion: 11 }),
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_BINDING_MISMATCH',
  );
  assert.equal(workspace.getSnapshot().publishRevision, 0);
  assert.deepEqual(plain(workspace.getSnapshot().binding), currentBinding);
});

test('public projections never retain Blob-like, key, URL, or arbitrary fields', () => {
  const api = loadApi();
  const workspace = api.createWorkspace(input());
  const serialized = JSON.stringify(workspace.getSnapshot());
  assert.doesNotMatch(serialized, /(?:https?:|blob:|data:|apiKey|authorization)/iu);
  assert.throws(
    () => workspace.upsertLibraryItem({
      ...libraryItem('unsafe', 'UPLOADED'),
      apiKey: 'not-public',
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.throws(
    () => workspace.setSlotPrompt('sku-red:hero', {
      prompt: 'Use https://private.example/image.png',
      negativePrompt: '',
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
});

test('projects truthful task controls and emits revision-fenced local intents only', () => {
  const api = loadApi();
  const blocked = api.createWorkspace(input());
  const blockedSnapshot = blocked.setAlternatives('sku-red:hero', [
    alternative('attempt-blocked-control', 'QUEUED', null),
  ], null);
  assert.equal(blockedSnapshot.taskControls.pauseAfterCurrent.enabled, false);
  assert.equal(
    blockedSnapshot.taskControls.cancelQueued.disabledReason,
    'BATCH_COORDINATOR_NOT_READY',
  );
  assert.throws(
    () => blocked.createPauseAfterCurrentIntent('command-blocked-pause'),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_ACTION_UNAVAILABLE'
      && error.reason === 'BATCH_COORDINATOR_NOT_READY',
  );
  assert.throws(
    () => blocked.createCancelQueuedIntent(
      'attempt-blocked-control', 'command-blocked-cancel',
    ),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_ACTION_UNAVAILABLE'
      && error.reason === 'BATCH_COORDINATOR_NOT_READY',
  );

  const workspace = api.createWorkspace(input());
  const running = workspace.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 1,
    task: { schedulerState: 'RUNNING', disabledReason: null },
    libraryItems: [],
    slots: [
      {
        slotKey: 'sku-red:hero',
        status: 'WAITING',
        alternatives: [alternative('attempt-active-control', 'WAITING', null)],
        selectedAttemptId: null,
        slotRevision: 7,
      },
      {
        slotKey: 'sku-red:detail-1',
        status: 'QUEUED',
        alternatives: [alternative('attempt-queued-control', 'QUEUED', null)],
        selectedAttemptId: null,
        slotRevision: 11,
      },
    ],
  });
  assert.deepEqual(plain(running.taskControls), {
    pauseAfterCurrent: { enabled: true, disabledReason: null },
    continue: { enabled: false, disabledReason: 'TASK_NOT_PAUSED' },
    cancelQueued: {
      enabled: true,
      disabledReason: null,
      attemptIds: ['attempt-queued-control'],
    },
  });

  const before = workspace.getSnapshot();
  assert.deepEqual(plain(workspace.createPauseAfterCurrentIntent('command-pause-01')), {
    contractVersion: api.ACTION_INTENT_CONTRACT_VERSION,
    binding: binding(),
    action: 'PAUSE_AFTER_CURRENT',
    commandId: 'command-pause-01',
    expectedWorkspaceRevision: before.revision,
    expectedRuntimeRevision: 1,
    expectedSlotRevision: null,
    slotKey: null,
    attemptId: null,
    externalChargeAcknowledgement: null,
  });
  const boundPauseIntent = workspace.createPauseAfterCurrentIntent('command-pause-01');
  assertDeepFrozen(boundPauseIntent);
  assert.deepEqual(plain(boundPauseIntent.binding), binding());
  const secondPauseIntent = workspace.createPauseAfterCurrentIntent('command-pause-02');
  assert.equal(secondPauseIntent.expectedWorkspaceRevision,
    boundPauseIntent.expectedWorkspaceRevision);
  assert.equal(secondPauseIntent.expectedRuntimeRevision,
    boundPauseIntent.expectedRuntimeRevision);
  assert.notDeepEqual(plain(secondPauseIntent), plain(boundPauseIntent));
  for (const invalidCommandId of [
    undefined,
    null,
    '命令-01',
    'https://command.example',
    ' command-01',
    'a'.repeat(201),
  ]) {
    assert.throws(
      () => workspace.createPauseAfterCurrentIntent(invalidCommandId),
      (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
    );
  }
  assert.deepEqual(plain(workspace.createCancelQueuedIntent(
    'attempt-queued-control', 'command-cancel-01',
  )), {
    contractVersion: api.ACTION_INTENT_CONTRACT_VERSION,
    binding: binding(),
    action: 'CANCEL_QUEUED',
    commandId: 'command-cancel-01',
    expectedWorkspaceRevision: before.revision,
    expectedRuntimeRevision: 1,
    expectedSlotRevision: 11,
    slotKey: 'sku-red:detail-1',
    attemptId: 'attempt-queued-control',
    externalChargeAcknowledgement: null,
  });
  assert.equal(workspace.getSnapshot().revision, before.revision);
  assert.throws(
    () => workspace.createCancelQueuedIntent(
      'attempt-active-control', 'command-cancel-active',
    ),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_ACTION_UNAVAILABLE'
      && error.reason === 'ATTEMPT_NOT_QUEUED',
  );

  const pausing = workspace.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 2,
    task: { schedulerState: 'PAUSING', disabledReason: null },
    libraryItems: [],
    slots: [],
  });
  assert.equal(pausing.taskControls.continue.enabled, true);
  assert.equal(workspace.createContinueIntent('command-continue-01').action, 'CONTINUE');
  assert.throws(
    () => workspace.createPauseAfterCurrentIntent('command-pause-repeat'),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_ACTION_UNAVAILABLE'
      && error.reason === 'PAUSE_ALREADY_REQUESTED',
  );
});

test('accepts legacy runtime slots but requires a trusted positive slot revision for slot intents', () => {
  const api = loadApi();
  const workspace = api.createWorkspace(input());
  workspace.upsertLibraryItem(libraryItem('legacy-slot-result', 'GENERATED', {
    skuKeys: ['sku-red'],
  }));
  const legacySlot = {
    slotKey: 'sku-red:hero',
    status: 'CANDIDATE_READY',
    alternatives: [alternative(
      'attempt-legacy-slot', 'CANDIDATE_READY', 'legacy-slot-result',
    )],
    selectedAttemptId: null,
  };
  let snapshot = workspace.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 1,
    task: { schedulerState: 'REVIEW', disabledReason: null },
    libraryItems: [],
    slots: [legacySlot],
  });
  let hero = snapshot.slots.find((row) => row.slotKey === 'sku-red:hero');
  assert.equal(hero.slotRevision, null);
  assert.equal(hero.alternatives[0].keepAvailable, false);
  assert.equal(hero.alternatives[0].keepDisabledReason, 'SLOT_REVISION_UNAVAILABLE');
  assert.equal(hero.regenerateAvailable, false);
  assert.equal(hero.regenerateDisabledReason, 'SLOT_REVISION_UNAVAILABLE');
  assert.throws(
    () => workspace.createKeepAttemptIntent(
      'sku-red:hero', 'attempt-legacy-slot', 'command-legacy-keep-blocked',
    ),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_ACTION_UNAVAILABLE'
      && error.reason === 'SLOT_REVISION_UNAVAILABLE',
  );

  snapshot = workspace.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 2,
    task: { schedulerState: 'REVIEW', disabledReason: null },
    libraryItems: [],
    slots: [{ ...legacySlot, slotRevision: 41 }],
  });
  hero = snapshot.slots.find((row) => row.slotKey === 'sku-red:hero');
  assert.equal(hero.slotRevision, 41);
  assert.equal(hero.alternatives[0].keepAvailable, true);
  assert.equal(
    workspace.createKeepAttemptIntent(
      'sku-red:hero', 'attempt-legacy-slot', 'command-legacy-keep',
    )
      .expectedSlotRevision,
    41,
  );

  assert.throws(
    () => workspace.applyRuntimeProjection({
      contractVersion: api.RUNTIME_CONTRACT_VERSION,
      binding: binding(),
      revision: 3,
      task: { schedulerState: 'REVIEW', disabledReason: null },
      libraryItems: [],
      slots: [{ ...legacySlot, slotRevision: 40 }],
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.equal(workspace.getSnapshot().runtimeRevision, 2);

  assert.throws(
    () => workspace.applyRuntimeProjection({
      contractVersion: api.RUNTIME_CONTRACT_VERSION,
      binding: binding(),
      revision: 3,
      task: { schedulerState: 'REVIEW', disabledReason: null },
      libraryItems: [],
      slots: [{
        ...legacySlot,
        selectedAttemptId: 'attempt-legacy-slot',
        slotRevision: 41,
      }],
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_SLOT_REVISION_REUSED',
  );
  assert.equal(workspace.getSnapshot().runtimeRevision, 2);

  assert.throws(
    () => workspace.applyRuntimeProjection({
      contractVersion: api.RUNTIME_CONTRACT_VERSION,
      binding: binding(),
      revision: 3,
      task: { schedulerState: 'FAILED', disabledReason: null },
      libraryItems: [],
      slots: [{
        ...legacySlot,
        status: 'UNKNOWN_OUTCOME',
        alternatives: [
          ...legacySlot.alternatives,
          alternative('attempt-same-revision-unknown', 'UNKNOWN_OUTCOME', null),
        ],
        slotRevision: 41,
      }],
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_SLOT_REVISION_REUSED',
  );
  assert.equal(workspace.getSnapshot().runtimeRevision, 2);

  snapshot = workspace.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 3,
    task: { schedulerState: 'REVIEW', disabledReason: null },
    libraryItems: [],
    slots: [legacySlot],
  });
  assert.equal(snapshot.slots.find((row) => row.slotKey === 'sku-red:hero').slotRevision, null);
  assert.throws(
    () => workspace.createRejectAttemptIntent(
      'sku-red:hero', 'attempt-legacy-slot', 'command-legacy-reject',
    ),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_ACTION_UNAVAILABLE'
      && error.reason === 'SLOT_REVISION_UNAVAILABLE',
  );

  for (const slotRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    const closed = api.createWorkspace(input({
      libraryItems: [...input().libraryItems, libraryItem('invalid-revision-result', 'GENERATED', {
        skuKeys: ['sku-red'],
      })],
    }));
    assert.throws(
      () => closed.applyRuntimeProjection({
        contractVersion: api.RUNTIME_CONTRACT_VERSION,
        binding: binding(),
        revision: 1,
        task: { schedulerState: 'REVIEW', disabledReason: null },
        libraryItems: [],
        slots: [{
          slotKey: 'sku-red:hero',
          status: 'CANDIDATE_READY',
          alternatives: [alternative(
            'attempt-invalid-revision', 'CANDIDATE_READY', 'invalid-revision-result',
          )],
          selectedAttemptId: null,
          slotRevision,
        }],
      }),
      (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
    );
    assert.equal(closed.getSnapshot().runtimeRevision, 0);
  }
});

test('creates keep and reject intents only for reviewable candidates without optimistic mutation', () => {
  const api = loadApi();
  const workspace = api.createWorkspace(input());
  workspace.upsertLibraryItem(libraryItem('review-red-one', 'GENERATED', {
    skuKeys: ['sku-red'],
  }));
  workspace.upsertLibraryItem(libraryItem('review-red-two', 'GENERATED', {
    skuKeys: ['sku-red'],
  }));
  const staged = workspace.setAlternatives('sku-red:hero', [
    alternative('attempt-review-one', 'CANDIDATE_READY', 'review-red-one'),
    alternative('attempt-review-two', 'CANDIDATE_READY', 'review-red-two'),
  ], null);
  assert.equal(staged.slots[0].alternatives[0].keepAvailable, false);
  assert.equal(
    staged.slots[0].alternatives[0].keepDisabledReason,
    'BATCH_COORDINATOR_NOT_READY',
  );
  assert.equal(
    staged.slots[0].alternatives[0].reviewDisabledReason,
    'BATCH_COORDINATOR_NOT_READY',
  );
  assert.throws(
    () => workspace.createKeepAttemptIntent(
      'sku-red:hero', 'attempt-review-one', 'command-review-blocked',
    ),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_ACTION_UNAVAILABLE'
      && error.reason === 'BATCH_COORDINATOR_NOT_READY',
  );
  const review = workspace.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 1,
    task: { schedulerState: 'REVIEW', disabledReason: null },
    libraryItems: [],
    slots: [{
      slotKey: 'sku-red:hero',
      status: 'CANDIDATE_READY',
      alternatives: [
        alternative('attempt-review-one', 'CANDIDATE_READY', 'review-red-one'),
        alternative('attempt-review-two', 'CANDIDATE_READY', 'review-red-two'),
      ],
      selectedAttemptId: null,
      slotRevision: 21,
    }],
  });
  const projected = review.slots[0].alternatives;
  assert.deepEqual(Object.keys(projected[0]), [
    'attemptId', 'state', 'mediaId', 'errorCode', 'selected', 'keepAvailable',
    'keepDisabledReason', 'rejectAvailable', 'rejectDisabledReason',
    'reviewDisabledReason',
  ]);
  assert.equal(projected[0].keepAvailable, true);
  assert.equal(projected[0].rejectAvailable, true);

  const revision = review.revision;
  const keep = workspace.createKeepAttemptIntent(
    'sku-red:hero', 'attempt-review-two', 'command-review-keep',
  );
  const reject = workspace.createRejectAttemptIntent(
    'sku-red:hero', 'attempt-review-one', 'command-review-reject',
  );
  assert.equal(keep.action, 'KEEP_ATTEMPT');
  assert.equal(keep.slotKey, 'sku-red:hero');
  assert.equal(keep.attemptId, 'attempt-review-two');
  assert.equal(keep.expectedSlotRevision, 21);
  assert.equal(reject.action, 'REJECT_ATTEMPT');
  assert.equal(workspace.getSnapshot().revision, revision);
  assert.equal(workspace.getSnapshot().slots[0].selectedAttemptId, null);

  const selected = workspace.selectAttempt('sku-red:hero', 'attempt-review-two');
  const selectedAlternative = selected.slots[0].alternatives.find(
    (item) => item.attemptId === 'attempt-review-two',
  );
  assert.equal(selectedAlternative.keepAvailable, false);
  assert.equal(selectedAlternative.keepDisabledReason, 'ATTEMPT_ALREADY_SELECTED');
  assert.equal(selectedAlternative.rejectAvailable, true);
  assert.equal(selectedAlternative.rejectDisabledReason, null);
  assert.equal(selectedAlternative.reviewDisabledReason, null);
  assert.throws(
    () => workspace.createKeepAttemptIntent(
      'sku-red:hero', 'attempt-review-two', 'command-review-selected',
    ),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_ACTION_UNAVAILABLE'
      && error.reason === 'ATTEMPT_ALREADY_SELECTED',
  );

  workspace.setAlternatives('sku-red:hero', [
    alternative('attempt-review-one', 'REJECTED', 'review-red-one'),
  ], null);
  workspace.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 2,
    task: { schedulerState: 'REVIEW', disabledReason: null },
    libraryItems: [],
    slots: [{
      slotKey: 'sku-red:hero',
      status: 'REJECTED',
      alternatives: [alternative('attempt-review-one', 'REJECTED', 'review-red-one')],
      selectedAttemptId: null,
      slotRevision: 22,
    }],
  });
  assert.throws(
    () => workspace.createKeepAttemptIntent(
      'sku-red:hero', 'attempt-review-one', 'command-review-final',
    ),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_ACTION_UNAVAILABLE'
      && error.reason === 'ATTEMPT_NOT_REVIEWABLE',
  );
});

test('requires the current external-charge acknowledgement for slot regeneration intents', () => {
  const api = loadApi();
  const workspace = api.createWorkspace(input());
  workspace.upsertLibraryItem(libraryItem('regenerate-red', 'GENERATED', {
    skuKeys: ['sku-red'],
  }));
  const staged = workspace.setAlternatives('sku-red:hero', [
    alternative('attempt-regenerate', 'CANDIDATE_READY', 'regenerate-red'),
  ], 'attempt-regenerate');
  assert.equal(staged.slots[0].regenerateAvailable, false);
  assert.equal(staged.slots[0].regenerateDisabledReason, 'BATCH_COORDINATOR_NOT_READY');
  assert.throws(
    () => workspace.createRegenerateIntent('sku-red:hero', {
      warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    }, 'command-regenerate-blocked'),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_ACTION_UNAVAILABLE'
      && error.reason === 'BATCH_COORDINATOR_NOT_READY',
  );
  const review = workspace.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 1,
    task: { schedulerState: 'REVIEW', disabledReason: null },
    libraryItems: [],
    slots: [{
      slotKey: 'sku-red:hero',
      status: 'CANDIDATE_READY',
      alternatives: [
        alternative('attempt-regenerate', 'CANDIDATE_READY', 'regenerate-red'),
      ],
      selectedAttemptId: 'attempt-regenerate',
      slotRevision: 31,
    }],
  });
  assert.equal(review.slots[0].regenerateAvailable, true);
  assert.equal(review.slots[0].regenerateDisabledReason, null);

  for (const invalidAcknowledgement of [
    undefined,
    null,
    { warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION, confirmed: false },
    { warningVersion: 'external-provider-charge/v0', confirmed: true },
    { warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION, confirmed: true, extra: true },
  ]) {
    assert.throws(
      () => workspace.createRegenerateIntent(
        'sku-red:hero', invalidAcknowledgement, 'command-regenerate-invalid-ack',
      ),
      (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_CHARGE_ACKNOWLEDGEMENT_REQUIRED',
    );
  }

  const before = workspace.getSnapshot();
  assert.deepEqual(plain(workspace.createRegenerateIntent('sku-red:hero', {
    warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION,
    confirmed: true,
  }, 'command-regenerate-01')), {
    contractVersion: api.ACTION_INTENT_CONTRACT_VERSION,
    binding: binding(),
    action: 'REGENERATE_SLOT',
    commandId: 'command-regenerate-01',
    expectedWorkspaceRevision: before.revision,
    expectedRuntimeRevision: before.runtimeRevision,
    expectedSlotRevision: 31,
    slotKey: 'sku-red:hero',
    attemptId: null,
    externalChargeAcknowledgement: {
      warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    },
  });

  const unknown = api.createWorkspace(input());
  unknown.setAlternatives('sku-red:hero', [
    alternative('attempt-regenerate-unknown', 'UNKNOWN_OUTCOME', null),
  ], null);
  unknown.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 1,
    task: { schedulerState: 'FAILED', disabledReason: null },
    libraryItems: [],
    slots: [{
      slotKey: 'sku-red:hero',
      status: 'UNKNOWN_OUTCOME',
      alternatives: [alternative('attempt-regenerate-unknown', 'UNKNOWN_OUTCOME', null)],
      selectedAttemptId: null,
      slotRevision: 32,
    }],
  });
  assert.equal(unknown.getSnapshot().slots[0].regenerateAvailable, false);
  assert.equal(
    unknown.getSnapshot().slots[0].regenerateDisabledReason,
    'UNKNOWN_OUTCOME_REQUIRES_RECOVERY',
  );
  assert.throws(
    () => unknown.createRegenerateIntent('sku-red:hero', {
      warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    }, 'command-regenerate-unknown'),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_ACTION_UNAVAILABLE'
      && error.reason === 'UNKNOWN_OUTCOME_REQUIRES_RECOVERY',
  );
});

test('requires the ERP-hosted cost warning for hosted slot regeneration', () => {
  const api = loadApi();
  const workspace = api.createWorkspace(input({
    executionMode: 'ERP_HOSTED',
    availableExecutionModes: ['ERP_HOSTED', 'BYOK'],
  }));
  workspace.upsertLibraryItem(libraryItem('hosted-regenerate-red', 'GENERATED', {
    skuKeys: ['sku-red'],
  }));
  workspace.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 1,
    task: { schedulerState: 'REVIEW', disabledReason: null },
    libraryItems: [],
    slots: [{
      slotKey: 'sku-red:hero',
      status: 'CANDIDATE_READY',
      alternatives: [
        alternative('attempt-hosted-regenerate', 'CANDIDATE_READY', 'hosted-regenerate-red'),
      ],
      selectedAttemptId: 'attempt-hosted-regenerate',
      slotRevision: 41,
    }],
  });
  assert.throws(
    () => workspace.createRegenerateIntent('sku-red:hero', {
      warningVersion: api.EXTERNAL_CHARGE_WARNING_VERSION,
      confirmed: true,
    }, 'command-hosted-wrong-warning'),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_CHARGE_ACKNOWLEDGEMENT_REQUIRED',
  );
  const intent = workspace.createRegenerateIntent('sku-red:hero', {
    warningVersion: api.ERP_HOSTED_CHARGE_WARNING_VERSION,
    confirmed: true,
  }, 'command-hosted-regenerate');
  assert.deepEqual(plain(intent.externalChargeAcknowledgement), {
    warningVersion: api.ERP_HOSTED_CHARGE_WARNING_VERSION,
    confirmed: true,
  });
});

test('offers deterministic keyboard slot ordering while preserving one explicit main slot', () => {
  const workspace = loadApi().createWorkspace(input());
  let snapshot = workspace.moveSlotByKeyboard('sku-red:detail-1', 'Home');
  assert.deepEqual(plain(snapshot.skus[0].slotKeys), [
    'sku-red:detail-1', 'sku-red:hero',
  ]);
  assert.equal(snapshot.selectedSlotKey, 'sku-red:detail-1');
  assert.deepEqual(
    plain(snapshot.slots.filter((row) => row.skuKey === 'sku-red').map((row) => row.role)),
    ['HERO', 'DETAIL'],
  );
  snapshot = workspace.setMainSlot('sku-red:detail-1');
  assert.equal(snapshot.skus[0].mainSlotKey, 'sku-red:detail-1');
  assert.equal(snapshot.slots.filter((row) => row.skuKey === 'sku-red' && row.isMain).length, 1);
  assert.deepEqual(
    plain(workspace.moveSlotByKeyboard('sku-red:detail-1', 'End').skus[0].slotKeys),
    ['sku-red:hero', 'sku-red:detail-1'],
  );
  assert.equal(workspace.getSnapshot().skus[0].mainSlotKey, 'sku-red:hero');
  assert.deepEqual(
    plain(workspace.moveSlotByKeyboard('sku-red:detail-1', 'ArrowUp').skus[0].slotKeys),
    ['sku-red:detail-1', 'sku-red:hero'],
  );
  assert.throws(
    () => workspace.moveSlotByKeyboard('sku-red:detail-1', 'PageDown'),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_SELECTION_INVALID',
  );
});

test('fails publish eligibility closed for unknown, stale, missing, expired, and unbound media', () => {
  const api = loadApi();
  const workspace = api.createWorkspace(input());
  workspace.upsertLibraryItem(libraryItem('publish-bound-red', 'GENERATED', {
    skuKeys: ['sku-red'],
  }));
  workspace.setAlternatives('sku-red:hero', [
    alternative('attempt-publish-bound', 'BOUND', 'publish-bound-red'),
  ], 'attempt-publish-bound');
  workspace.setAlternatives('sku-blue:hero', [
    alternative('attempt-publish-unknown', 'UNKNOWN_OUTCOME', null),
  ], null);
  workspace.setAlternatives('sku-blue:detail-1', [
    alternative('attempt-publish-expired', 'EXPIRED', null),
  ], null);
  const current = workspace.applyPublishProjection(publishProjection(api, workspace, 1));
  assert.equal(current.publishSummary.eligible, false);
  assert.equal(current.publishSummary.readySlots, 1);
  assert.deepEqual(plain(current.publishSummary.orderedMedia), []);
  assert.deepEqual(plain(current.publishBasis.orderedMedia), []);
  assert.deepEqual(plain(current.publishSummary.missingSlotKeys), ['sku-red:detail-1']);
  assert.deepEqual(plain(current.publishSummary.unknownOutcomeSlotKeys), ['sku-blue:hero']);
  assert.deepEqual(plain(current.publishSummary.expiredSlotKeys), ['sku-blue:detail-1']);
  assert.deepEqual(plain(current.publishSummary.unboundSlotKeys), []);
  assert.deepEqual(plain(current.publishSummary.blockerCodes), [
    'MISSING_SELECTION', 'UNKNOWN_OUTCOME', 'RESULT_EXPIRED',
  ]);
  assert.equal(
    current.slots.find((row) => row.slotKey === 'sku-blue:hero').publishMediaDisabledReason,
    'UNKNOWN_OUTCOME',
  );

  const stale = workspace.applyPublishProjection(publishProjection(api, workspace, 2, {
    draftState: 'STALE',
  }));
  assert.equal(stale.publishSummary.eligible, false);
  assert.equal(stale.publishSummary.blockerCodes[0], 'DRAFT_STALE');
  assert.throws(
    () => workspace.applyPublishProjection(publishProjection(api, workspace, 2)),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_PUBLISH_STALE',
  );
  assert.throws(
    () => workspace.applyPublishProjection({
      ...publishProjection(api, workspace, 3),
      extra: true,
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.equal(workspace.getSnapshot().publishRevision, 2);
});

test('keeps unknown outcomes absorbing and never lets a selected bound attempt mask them', () => {
  const api = loadApi();
  const workspace = api.createWorkspace(input());
  workspace.upsertLibraryItem(libraryItem('bound-before-unknown', 'GENERATED', {
    skuKeys: ['sku-red'],
  }));
  const bound = alternative('attempt-bound-before-unknown', 'BOUND', 'bound-before-unknown');
  const unknown = alternative('attempt-absorbing-unknown', 'UNKNOWN_OUTCOME', null);
  let snapshot = workspace.setAlternatives(
    'sku-red:hero', [bound, unknown], 'attempt-bound-before-unknown',
  );
  let hero = snapshot.slots.find((row) => row.slotKey === 'sku-red:hero');
  assert.equal(hero.status, 'UNKNOWN_OUTCOME');
  assert.equal(hero.publishMediaEligible, false);
  assert.equal(hero.publishMediaDisabledReason, 'UNKNOWN_OUTCOME');
  assert.equal(snapshot.taskSummary.schedulerState, 'FAILED');

  assert.throws(
    () => workspace.setAlternatives(
      'sku-red:hero', [bound], 'attempt-bound-before-unknown',
    ),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_UNKNOWN_OUTCOME_LOCKED',
  );
  assert.throws(
    () => workspace.applyRuntimeProjection({
      contractVersion: api.RUNTIME_CONTRACT_VERSION,
      binding: binding(),
      revision: 1,
      task: { schedulerState: 'REVIEW', disabledReason: null },
      libraryItems: [],
      slots: [{
        slotKey: 'sku-red:hero',
        status: 'BOUND',
        alternatives: [bound],
        selectedAttemptId: 'attempt-bound-before-unknown',
        slotRevision: 51,
      }],
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_UNKNOWN_OUTCOME_LOCKED',
  );
  assert.equal(workspace.getSnapshot().runtimeRevision, 0);

  snapshot = workspace.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 1,
    task: { schedulerState: 'FAILED', disabledReason: null },
    libraryItems: [],
    slots: [{
      slotKey: 'sku-red:hero',
      status: 'UNKNOWN_OUTCOME',
      alternatives: [bound, unknown],
      selectedAttemptId: 'attempt-bound-before-unknown',
      slotRevision: 52,
    }],
  });
  hero = snapshot.slots.find((row) => row.slotKey === 'sku-red:hero');
  assert.equal(hero.status, 'UNKNOWN_OUTCOME');
  assert.equal(hero.regenerateDisabledReason, 'UNKNOWN_OUTCOME_REQUIRES_RECOVERY');
  snapshot = workspace.applyPublishProjection(publishProjection(api, workspace, 1));
  assert.equal(snapshot.publishSummary.eligible, false);
  assert.ok(snapshot.publishSummary.blockerCodes.includes('UNKNOWN_OUTCOME'));
});

test('never marks an empty workspace as publish eligible', () => {
  const api = loadApi();
  const empty = api.createWorkspace(input({
    selectedSkuKey: null,
    selectedSlotKey: null,
    globalReferenceIds: ['captured-main'],
    libraryItems: [libraryItem('captured-main', 'CAPTURED')],
    skus: [],
  }));
  const snapshot = empty.applyPublishProjection(publishProjection(api, empty, 1));
  assert.equal(snapshot.publishSummary.eligible, false);
  assert.deepEqual(plain(snapshot.publishSummary.orderedMedia), []);
  assert.ok(snapshot.publishSummary.blockerCodes.includes('NO_MEDIA_SLOTS'));
});

test('publishes a deterministic ordered summary only for current bound selections', () => {
  const api = loadApi();
  const generated = [
    libraryItem('publish-red-hero', 'GENERATED', { skuKeys: ['sku-red'] }),
    libraryItem('publish-red-detail', 'GENERATED', { skuKeys: ['sku-red'] }),
  ];
  const ready = api.createWorkspace(input({
    dispatched: true,
    libraryItems: [...input().libraryItems, ...generated],
    skus: [sku('sku-red', {
      slots: [
        slot('sku-red:hero', 'HERO', {
          alternatives: [alternative('attempt-ready-hero', 'BOUND', 'publish-red-hero')],
          selectedAttemptId: 'attempt-ready-hero',
        }),
        slot('sku-red:detail-1', 'DETAIL', {
          alternatives: [alternative(
            'attempt-ready-detail', 'BOUND', 'publish-red-detail',
          )],
          selectedAttemptId: 'attempt-ready-detail',
        }),
      ],
    })],
  }));
  const firstProjection = publishProjection(api, ready, 1);
  let snapshot = ready.applyPublishProjection(firstProjection);
  assert.equal(snapshot.publishSummary.eligible, true);
  assert.equal(snapshot.publishSummary.readySlots, 2);
  assert.deepEqual(plain(snapshot.publishSummary.orderedMedia), [
    {
      skuKey: 'sku-red', slotKey: 'sku-red:hero', position: 0, role: 'HERO',
      attemptId: 'attempt-ready-hero', mediaId: 'publish-red-hero',
    },
    {
      skuKey: 'sku-red', slotKey: 'sku-red:detail-1', position: 1, role: 'DETAIL',
      attemptId: 'attempt-ready-detail', mediaId: 'publish-red-detail',
    },
  ]);
  snapshot = ready.selectSlot('sku-red:detail-1');
  assert.equal(snapshot.publishSummary.eligible, false);
  assert.ok(snapshot.publishSummary.blockerCodes.includes('PUBLISH_BASIS_STALE'));
  snapshot = ready.applyPublishProjection(publishProjection(api, ready, 2));
  assert.equal(snapshot.publishSummary.eligible, true);
  snapshot = ready.moveSlotByKeyboard('sku-red:detail-1', 'Home');
  assert.equal(snapshot.publishSummary.eligible, false);
  assert.equal(snapshot.publishSummary.draftState, 'UNKNOWN');
  assert.equal(snapshot.publishSummary.blockerCodes[0], 'ORDER_REBIND_REQUIRED');
  assert.throws(
    () => ready.applyPublishProjection({ ...firstProjection, revision: 99 }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_PUBLISH_BASIS_STALE',
  );
  const currentProjection = publishProjection(api, ready, 99);
  assert.throws(
    () => ready.applyPublishProjection({
      ...currentProjection,
      orderedMedia: firstProjection.orderedMedia,
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_PUBLISH_BASIS_STALE',
  );
  assert.throws(
    () => ready.applyPublishProjection({
      ...currentProjection,
      orderedMedia: currentProjection.orderedMedia.map((row, index) => (
        index === 0 ? { ...row, extra: true } : row
      )),
    }),
    (error) => error?.code === 'SS_ERP_BYOK_WORKSPACE_INPUT_INVALID',
  );
  assert.equal(ready.getSnapshot().publishRevision, 2);
  snapshot = ready.applyPublishProjection(publishProjection(api, ready, 3));
  assert.equal(snapshot.publishSummary.eligible, true);
  assert.deepEqual(plain(snapshot.publishSummary.orderedMedia.map((row) => row.slotKey)), [
    'sku-red:detail-1', 'sku-red:hero',
  ]);
  assert.equal(snapshot.publishSummary.orderedMedia[0].role, 'HERO');
  snapshot = ready.applyRuntimeProjection({
    contractVersion: api.RUNTIME_CONTRACT_VERSION,
    binding: binding(),
    revision: 1,
    task: { schedulerState: 'REVIEW', disabledReason: null },
    libraryItems: [],
    slots: [],
  });
  assert.equal(snapshot.publishSummary.eligible, false);
  assert.equal(snapshot.publishSummary.blockerCodes[0], 'PUBLISH_BASIS_STALE');
  snapshot = ready.applyPublishProjection(publishProjection(api, ready, 4));
  assert.equal(snapshot.publishSummary.eligible, true);
  snapshot = ready.setMainSlot('sku-red:hero');
  assert.equal(snapshot.publishSummary.eligible, false);
  assert.equal(snapshot.publishSummary.blockerCodes[0], 'ORDER_REBIND_REQUIRED');
});

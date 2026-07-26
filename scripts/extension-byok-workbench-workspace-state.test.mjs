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
  assert.deepEqual(Array.from(api.MEDIA_SOURCE_TYPES), ['CAPTURED', 'SKU', 'UPLOADED', 'GENERATED']);

  const workspace = api.createWorkspace(input());
  const snapshot = workspace.getSnapshot();
  assert.deepEqual(Object.keys(snapshot), [
    'contractVersion', 'runtimeContractVersion', 'revision', 'runtimeRevision',
    'executionMode', 'executionModeFrozen', 'modeDisabledReasons', 'selectedSkuKey',
    'selectedSlotKey', 'globalReferenceIds', 'globalReferencesEditable',
    'globalReferencesDisabledReason', 'libraryItems', 'skus', 'slots', 'taskSummary',
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
  const invalidInputs = [
    { ...input(), arbitrary: true },
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
  const workspace = loadApi().createWorkspace(input());
  workspace.selectSlot('sku-red:detail-1');
  let snapshot = workspace.setMainSlot('sku-red:detail-1');
  const red = snapshot.slots.filter((row) => row.skuKey === 'sku-red');
  assert.equal(red.filter((row) => row.isMain).length, 1);
  assert.equal(red.find((row) => row.isMain).slotKey, 'sku-red:detail-1');
  assert.equal(snapshot.skus[0].mainSlotKey, 'sku-red:detail-1');

  snapshot = workspace.moveSelectedSlotUp();
  assert.deepEqual(plain(snapshot.skus[0].slotKeys), ['sku-red:detail-1', 'sku-red:hero']);
  assert.deepEqual(
    plain(workspace.moveSelectedSlotUp().skus[0].slotKeys),
    ['sku-red:detail-1', 'sku-red:hero'],
  );
  assert.deepEqual(
    plain(workspace.moveSelectedSlotDown().skus[0].slotKeys),
    ['sku-red:hero', 'sku-red:detail-1'],
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

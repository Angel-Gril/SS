import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AI_MEDIA_APPLICATION_CONTRACT_VERSION,
  AI_MEDIA_APPLICATION_INTENT_TTL_MS,
  aiMediaApplicationIntentStorageKey,
  aiMediaApplicationRecoveryPath,
  aiMediaTargetApplicationsPath,
  appendAiMediaApplicationLedgerPage,
  buildAiMediaApplicationRequest,
  buildAiMediaApplicationRollbackRequest,
  clearAiMediaApplicationIntent,
  isDefinitiveAiMediaApplicationFailure,
  loadAiMediaApplicationIntent,
  mergeAiMediaWorkflowApplicationSummary,
  normalizeAiMediaApplicationLedger,
  normalizeAiMediaApplicationCapability,
  normalizeAiMediaApplicationMutationResult,
  normalizeAiMediaWorkflowApplicationSummary,
  projectAiMediaApplicationImageUrls,
  resolveAiMediaApplicationIntent,
  resolveAiMediaApplicationRecovery,
  resolveAiMediaApplicationTargetStaleVersion,
  saveAiMediaApplicationIntent,
} from '../apps/web/src/lib/ai-media-application.ts';

assert.equal(resolveAiMediaApplicationTargetStaleVersion({
  renderedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
  authoritativeTargetUpdatedAt: '2026-07-20T01:00:00.001Z',
}), '2026-07-20T01:00:00.001Z', 'a newer ledger target must block stale rendered controls');
assert.equal(resolveAiMediaApplicationTargetStaleVersion({
  renderedTargetUpdatedAt: '2026-07-20T01:00:00.002Z',
  authoritativeTargetUpdatedAt: '2026-07-20T01:00:00.001Z',
  currentStaleVersion: '2026-07-20T01:00:00.001Z',
}), null, 'a rendered target that caught up must clear the stale blocker');
assert.equal(resolveAiMediaApplicationTargetStaleVersion({
  renderedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
  authoritativeTargetUpdatedAt: '2026-07-20T01:00:00.001Z',
  currentStaleVersion: '2026-07-20T01:00:00.003Z',
}), '2026-07-20T01:00:00.003Z', 'a delayed ledger response cannot regress a newer stale authority');

function mutation(overrides = {}) {
  return {
    id: 'application-1',
    revision: 7,
    kind: 'APPLY',
    workflowId: 'workflow-1',
    jobId: 'job-1',
    assetId: 'asset-1',
    rollbackOfId: null,
    rolledBackById: null,
    targetType: 'collect',
    targetId: 'goods-1',
    targetSequence: 1,
    mode: 'append',
    contextSkuKey: null,
    contextSlotKey: null,
    operationKey: 'application-operation-1',
    workflowRevisionBefore: 4,
    workflowRevisionAfter: 5,
    targetVersionBefore: '2026-07-20T01:00:00.000Z',
    targetVersionAfter: '2026-07-20T01:00:00.001Z',
    beforeCounts: { images: 1, watermarkedImages: 1, editedImages: 0 },
    afterCounts: { images: 2, watermarkedImages: 2, editedImages: 1 },
    createdAt: '2026-07-20T01:00:00.001Z',
    rollbackEligible: true,
    rollbackReason: 'READY',
    ...overrides,
  };
}

function target(overrides = {}) {
  return {
    type: 'collect',
    id: 'goods-1',
    updatedAt: '2026-07-20T01:00:00.001Z',
    images: ['/original.png', '/generated.png'],
    editedImages: ['/generated.png'],
    mainImage: '/original.png',
    ...overrides,
  };
}

function ledger(overrides = {}) {
  return {
    contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
    items: [mutation()],
    frontier: mutation(),
    recoveredOperation: null,
    legacyApplications: [],
    nextBeforeSequence: null,
    target: target(),
    ...overrides,
  };
}

const validSuiteSlotKey = 's'.repeat(509);

const normalizedLedger = normalizeAiMediaApplicationLedger(ledger());
assert.ok(normalizedLedger);
assert.equal(normalizedLedger.frontier.revision, 7);
assert.equal(normalizedLedger.frontier.workflowRevisionAfter, 5);
const suiteSlotLedger = normalizeAiMediaApplicationLedger(ledger({
  items: [mutation({ contextSlotKey: validSuiteSlotKey })],
  frontier: mutation({ contextSlotKey: validSuiteSlotKey }),
}));
assert.ok(suiteSlotLedger, 'valid suite slot keys must not invalidate the application ledger');
assert.equal(suiteSlotLedger.items[0].contextSlotKey, validSuiteSlotKey);
assert.equal(normalizeAiMediaApplicationLedger(ledger({
  items: [mutation({ contextSlotKey: 's'.repeat(1_025) })],
})), null, 'slot keys above the persisted 1024-character limit remain invalid');
assert.equal(normalizeAiMediaApplicationLedger(ledger({
  frontier: { ...mutation(), revision: undefined },
})), null, 'rollback CAS revision is mandatory');
assert.equal(normalizeAiMediaApplicationLedger(ledger({
  target: target({ id: 'other-goods' }),
})), null, 'ledger mutations must belong to the returned target');
assert.deepEqual(normalizeAiMediaApplicationCapability({
  contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
  readEnabled: true,
  applyEnabled: false,
  rollbackEnabled: true,
  defaultMode: 'append',
  replaceOperations: ['IMAGE_TO_IMAGE', 'IMAGE_TO_IMAGE'],
}), {
  contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
  readEnabled: true,
  applyEnabled: false,
  rollbackEnabled: true,
  defaultMode: 'append',
  replaceOperations: ['IMAGE_TO_IMAGE'],
});

const normalizedResult = normalizeAiMediaApplicationMutationResult({
  contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
  application: mutation(),
  target: target(),
  replayed: false,
});
assert.ok(normalizedResult);
assert.equal(normalizedResult.application.operationKey, 'application-operation-1');
const mixedLegacyTarget = target({
  images: [
    { legacyUrl: '/legacy-object.png' },
    ' /original.png ',
    null,
    '/generated.png',
    '/generated.png',
  ],
  editedImages: [
    { legacyResult: true },
    '/generated.png',
    42,
    ' ',
  ],
});
const mixedLegacyLedger = normalizeAiMediaApplicationLedger(ledger({
  target: mixedLegacyTarget,
}));
assert.ok(mixedLegacyLedger, 'mixed legacy image JSON must not invalidate the application ledger');
assert.deepEqual(mixedLegacyLedger.target.editedImages, mixedLegacyTarget.editedImages);
const mixedLegacyResult = normalizeAiMediaApplicationMutationResult({
  contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
  application: mutation(),
  target: mixedLegacyTarget,
  replayed: false,
});
assert.ok(mixedLegacyResult, 'mixed legacy image JSON must not hide a committed mutation result');
assert.deepEqual(projectAiMediaApplicationImageUrls(mixedLegacyResult.target.images), [
  '/original.png',
  '/generated.png',
]);
assert.deepEqual(projectAiMediaApplicationImageUrls(mixedLegacyResult.target.editedImages), [
  '/generated.png',
]);
assert.deepEqual(projectAiMediaApplicationImageUrls([
  '/valid.png',
  'x'.repeat(8_001),
  { toString: () => '/must-not-coerce.png' },
]), ['/valid.png'], 'UI projection accepts only bounded string URLs');
const suiteSlotResult = normalizeAiMediaApplicationMutationResult({
  contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
  application: mutation({ contextSlotKey: validSuiteSlotKey }),
  target: target(),
  replayed: false,
});
assert.ok(suiteSlotResult, 'valid suite slot keys must survive mutation result normalization');
assert.equal(suiteSlotResult.application.contextSlotKey, validSuiteSlotKey);
assert.ok(normalizeAiMediaApplicationMutationResult({
  contractVersion: AI_MEDIA_APPLICATION_CONTRACT_VERSION,
  application: mutation({
    id: 'rollback-null-images', kind: 'ROLLBACK', rollbackOfId: 'application-1',
    operationKey: 'rollback-null-images-1', rollbackEligible: false, rollbackReason: 'NOT_APPLY',
  }),
  target: target({ images: null, mainImage: null }),
  replayed: false,
}), 'rollback must preserve an exact null images projection');

assert.deepEqual(buildAiMediaApplicationRequest({
  mode: 'append',
  operationKey: 'application-operation-1',
  expectedWorkflowRevision: 4,
  expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
}), {
  mode: 'append',
  operationKey: 'application-operation-1',
  expectedWorkflowRevision: 4,
  expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
});
assert.deepEqual(buildAiMediaApplicationRequest({
  mode: 'replace',
  operationKey: 'application-replace-1',
  expectedWorkflowRevision: 4,
  expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
  replaceConfirmed: true,
}), {
  mode: 'replace',
  operationKey: 'application-replace-1',
  expectedWorkflowRevision: 4,
  expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
  replaceConfirmed: true,
});
assert.throws(() => buildAiMediaApplicationRequest({
  mode: 'replace',
  operationKey: 'application-replace-1',
  expectedWorkflowRevision: 4,
  expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
}), /再次确认/u);
assert.deepEqual(buildAiMediaApplicationRollbackRequest({
  application: normalizedLedger.frontier,
  operationKey: 'application-rollback-1',
  expectedTargetUpdatedAt: normalizedLedger.target.updatedAt,
}), {
  operationKey: 'application-rollback-1',
  expectedApplicationRevision: 7,
  expectedWorkflowRevision: 5,
  expectedTargetUpdatedAt: '2026-07-20T01:00:00.001Z',
});

const storageValues = new Map();
const storage = {
  getItem: (key) => storageValues.get(key) || null,
  setItem: (key, value) => storageValues.set(key, value),
  removeItem: (key) => storageValues.delete(key),
};
const storageKey = aiMediaApplicationIntentStorageKey('goods-1', 'apply', 'workflow-1');
const intent = resolveAiMediaApplicationIntent(
  null,
  'apply-fingerprint',
  () => 'application-operation-1',
  { now: 1_000 },
);
saveAiMediaApplicationIntent(storage, storageKey, intent);
assert.deepEqual(loadAiMediaApplicationIntent(storage, storageKey, { now: 1_001 }), intent);
assert.equal(resolveAiMediaApplicationIntent(
  intent,
  'apply-fingerprint',
  () => 'different-operation-1',
  { now: 1_001 },
).operationKey, 'application-operation-1');
assert.equal(loadAiMediaApplicationIntent(storage, storageKey, {
  now: 1_000 + AI_MEDIA_APPLICATION_INTENT_TTL_MS + 1,
}), null);
saveAiMediaApplicationIntent(storage, storageKey, intent);
clearAiMediaApplicationIntent(storage, storageKey);
assert.equal(storageValues.has(storageKey), false);

const recoveredApply = mutation();
assert.equal(resolveAiMediaApplicationRecovery({
  kind: 'APPLY', workflowId: 'workflow-1', operationKey: recoveredApply.operationKey,
  recoveredOperation: recoveredApply,
}), 'confirmed');
assert.equal(resolveAiMediaApplicationRecovery({
  kind: 'APPLY', workflowId: 'workflow-1', operationKey: recoveredApply.operationKey,
  recoveredOperation: mutation({
    rolledBackById: 'rollback-1', rollbackEligible: false, rollbackReason: 'ALREADY_ROLLED_BACK',
  }),
}), 'rolled_back', 'a recovered apply that was later rolled back is not currently applied');
assert.equal(resolveAiMediaApplicationRecovery({
  kind: 'APPLY', workflowId: 'workflow-1', operationKey: recoveredApply.operationKey,
  recoveredOperation: null,
}), 'retry');
const recoveredRollback = mutation({
  id: 'rollback-1',
  revision: 8,
  kind: 'ROLLBACK',
  rollbackOfId: 'application-1',
  targetSequence: 2,
  operationKey: 'application-rollback-1',
  workflowRevisionBefore: 5,
  workflowRevisionAfter: 6,
  targetVersionBefore: '2026-07-20T01:00:00.001Z',
  targetVersionAfter: '2026-07-20T01:00:00.002Z',
  beforeCounts: { images: 2, watermarkedImages: 2, editedImages: 1 },
  afterCounts: { images: 1, watermarkedImages: 1, editedImages: 0 },
  createdAt: '2026-07-20T01:00:00.002Z',
  rollbackEligible: false,
  rollbackReason: 'NOT_APPLY',
});
assert.equal(resolveAiMediaApplicationRecovery({
  kind: 'ROLLBACK', workflowId: 'workflow-1', applicationId: 'application-1',
  operationKey: recoveredRollback.operationKey, recoveredOperation: recoveredRollback,
}), 'confirmed');
assert.equal(resolveAiMediaApplicationRecovery({
  kind: 'ROLLBACK', workflowId: 'workflow-1', applicationId: 'different-application',
  operationKey: recoveredRollback.operationKey, recoveredOperation: recoveredRollback,
}), 'conflict');
assert.match(aiMediaApplicationRecoveryPath('workflow-1', 'application-operation-1'), /operationKey=application-operation-1/u);
const targetApplicationsPath = aiMediaTargetApplicationsPath('goods-1', {
  limit: 25,
  beforeSequence: 10,
  operationKey: 'application-operation-1',
});
const targetApplicationsQuery = new URLSearchParams(targetApplicationsPath.split('?')[1]);
assert.match(targetApplicationsPath, /^\/api\/ai-images\/applications\?/u);
assert.deepEqual(Object.fromEntries(targetApplicationsQuery), {
  targetType: 'collect',
  targetId: 'goods-1',
  limit: '25',
  beforeSequence: '10',
  operationKey: 'application-operation-1',
});
assert.equal(isDefinitiveAiMediaApplicationFailure('ROLLBACK_ORDER_CONFLICT'), true);
assert.equal(isDefinitiveAiMediaApplicationFailure(0), false);

const firstPage = normalizedLedger;
const secondPage = normalizeAiMediaApplicationLedger(ledger({
  items: [
    mutation(),
    mutation({ id: 'application-older', targetSequence: 0 }),
  ],
  nextBeforeSequence: null,
}));
assert.equal(secondPage, null, 'target sequences are positive');
const validSecondPage = normalizeAiMediaApplicationLedger(ledger({
  items: [
    mutation(),
    mutation({ id: 'application-older', targetSequence: 2 }),
  ],
  nextBeforeSequence: null,
}));
assert.ok(validSecondPage);
assert.deepEqual(
  appendAiMediaApplicationLedgerPage(firstPage, validSecondPage).items.map((item) => item.id),
  ['application-older', 'application-1'],
  'application history pages are de-duplicated and ordered by target sequence',
);

const refreshedFrontier = mutation({
  id: 'application-new',
  revision: 9,
  targetSequence: 3,
  operationKey: 'application-operation-new',
  workflowRevisionBefore: 6,
  workflowRevisionAfter: 7,
  targetVersionBefore: '2026-07-20T01:00:00.002Z',
  targetVersionAfter: '2026-07-20T01:00:00.003Z',
  createdAt: '2026-07-20T01:00:00.003Z',
});
const refreshedHead = normalizeAiMediaApplicationLedger(ledger({
  items: [
    refreshedFrontier,
    mutation({
      revision: 8,
      rolledBackById: 'rollback-2',
      rollbackEligible: false,
      rollbackReason: 'ALREADY_ROLLED_BACK',
    }),
  ],
  frontier: refreshedFrontier,
  recoveredOperation: refreshedFrontier,
  nextBeforeSequence: 2,
  target: target({
    updatedAt: '2026-07-20T01:00:00.003Z',
    images: ['/original.png', '/generated.png', '/new.png'],
    editedImages: ['/generated.png', '/new.png'],
  }),
}));
const delayedOlderPage = normalizeAiMediaApplicationLedger(ledger({
  items: [
    mutation(),
    mutation({
      id: 'application-older',
      targetSequence: 2,
      operationKey: 'application-operation-older',
      targetVersionBefore: '2026-07-20T00:59:59.999Z',
      targetVersionAfter: '2026-07-20T01:00:00.000Z',
      createdAt: '2026-07-20T01:00:00.000Z',
    }),
  ],
  frontier: mutation(),
  recoveredOperation: null,
  nextBeforeSequence: null,
  target: target({ updatedAt: '2026-07-20T01:00:00.001Z' }),
}));
assert.ok(refreshedHead && delayedOlderPage);
const mergedDelayedPage = appendAiMediaApplicationLedgerPage(refreshedHead, delayedOlderPage);
assert.equal(mergedDelayedPage.frontier?.id, 'application-new', 'a delayed page cannot regress rollback authority');
assert.equal(mergedDelayedPage.recoveredOperation?.id, 'application-new', 'a delayed page cannot erase recovery authority');
assert.equal(mergedDelayedPage.target.updatedAt, '2026-07-20T01:00:00.003Z', 'a delayed page cannot regress target CAS');
assert.equal(
  mergedDelayedPage.items.find((item) => item.id === 'application-1')?.revision,
  8,
  'a delayed duplicate cannot replace a newer mutation revision',
);
assert.equal(mergedDelayedPage.nextBeforeSequence, null, 'the delayed page still advances the history cursor');

const appliedSummary = {
  id: 'application-1', revision: 1, state: 'APPLIED', mode: 'append',
  workflowId: 'workflow-1', jobId: 'job-1', outputAssetId: 'asset-1',
  targetType: 'collect', targetId: 'goods-1', contextSkuKey: null, contextSlotKey: null,
  appliedAt: '2026-07-20T01:00:00.001Z', rolledBackAt: null,
  targetUpdatedAt: '2026-07-20T01:00:00.001Z', legacy: false,
};
const rolledBackSummary = {
  ...appliedSummary,
  revision: 2,
  state: 'ROLLED_BACK',
  rolledBackAt: '2026-07-20T01:00:00.002Z',
  targetUpdatedAt: '2026-07-20T01:00:00.002Z',
};
assert.deepEqual(normalizeAiMediaWorkflowApplicationSummary(rolledBackSummary), rolledBackSummary);
assert.equal(
  normalizeAiMediaWorkflowApplicationSummary({
    ...appliedSummary,
    contextSlotKey: validSuiteSlotKey,
  })?.contextSlotKey,
  validSuiteSlotKey,
  'valid suite slot keys must survive workflow application summary normalization',
);
assert.equal(normalizeAiMediaWorkflowApplicationSummary({
  ...appliedSummary,
  contextSlotKey: 's'.repeat(1_025),
}), null, 'workflow application summaries enforce the persisted slot-key limit');
assert.equal(normalizeAiMediaWorkflowApplicationSummary({
  ...rolledBackSummary, state: 'APPLIED', rolledBackAt: '2026-07-20T01:00:00.002Z',
}), null);
assert.equal(
  mergeAiMediaWorkflowApplicationSummary(rolledBackSummary, appliedSummary).state,
  'ROLLED_BACK',
  'a late APPLIED projection must not regress ROLLED_BACK',
);

const panel = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-panel.tsx', 'utf8');
const suitePanel = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-suite-panel.tsx', 'utf8');
const planningPanel = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-planning-panel.tsx', 'utf8');
const sourcePage = fs.readFileSync('apps/web/src/app/(dashboard)/collect/source/page.tsx', 'utf8');
assert.match(panel, /workflows\/\$\{encodeURIComponent\(workflow\.id\)\}\/applications/u);
assert.match(panel, /applications\/\$\{encodeURIComponent\(application\.id\)\}\/rollback/u);
assert.doesNotMatch(panel, /jobs\/\$\{job\.id\}\/apply/u);
assert.match(panel, /replaceConfirmed/u);
assert.match(panel, /targetIdRef\.current !== requestTargetId/u);
assert.match(panel, /aiMediaTargetApplicationsPath\(requestTargetId/u);
assert.match(panel, /applicationPageGenerationRef\.current \+= 1;\s*setApplicationLoadingMore\(false\);\s*applicationLastReadAtRef\.current = Date\.now\(\);\s*const ledger = await readApplicationLedger\(request\.targetId\)/u);
assert.match(panel, /applicationHistoryItems = applicationLedger[\s\S]*applicationLedger\.frontier/u);
assert.doesNotMatch(panel, /applicationAnchorWorkflowIdRef/u);
assert.match(panel, /runMediaMutation\(\(\) => api\.post<unknown>\(/u);
assert.match(panel, /onConflictRefresh/u);
assert.match(panel, /projectAiMediaApplicationImageUrls/u);
assert.match(panel, /recovery === 'rolled_back'/u);
assert.match(
  panel,
  /responseRecovery = resolveAiMediaApplicationRecovery\([\s\S]*recoveredOperation: normalized\.application[\s\S]*responseRecovery === 'rolled_back'/u,
  'a direct APPLY replay that was already rolled back must use the recovery branch',
);
assert.match(panel, /applicationTargetStaleVersion/u);
assert.match(panel, /AI_MEDIA_APPLICATION_POLL_INTERVAL_MS = 30_000/u);
assert.match(panel, /request\.interactive[\s\S]*applicationLastReadAtRef\.current >= AI_MEDIA_APPLICATION_POLL_INTERVAL_MS/u);
assert.match(panel, /reconcileApplicationTargetVersion\(ledger\.target\.updatedAt\)/u);
assert.match(panel, /refreshedTarget\?\.id === requestTargetId/u);
assert.match(panel, /applicationLedgerError/u);
assert.match(panel, /回滚已完成，商品图片待同步/u);
assert.match(panel, /图片应用与回滚已暂停/u);
assert.match(panel, /历史不可回滚/u);
assert.match(panel, /撤销此次应用/u);
assert.match(sourcePage, /const mediaDraftDirty =/u);
assert.match(sourcePage, /onRemove=\{saving \|\| mediaMutationBusy/u);
assert.match(sourcePage, /mediaDraftDirty=\{mediaDraftDirty\}/u);
assert.match(planningPanel, /mediaDraftDirty=\{mediaDraftDirty\}/u);
assert.match(suitePanel, /mediaDraftDirty/u);
assert.match(suitePanel, /套图候选已追加，商品图片待同步/u);
assert.match(sourcePage, /return refreshedTarget/u);

console.log('PASS Web AI media application ledger contract');

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  aiMediaPlanSlotDraftStorageKey,
  buildAiMediaPlanSlotReferenceUpdateRequest,
  canToggleAiMediaPlanSlotCandidate,
  loadAiMediaPlanSlotDraft,
  normalizeAiMediaPlanBundle,
  resolveAiMediaPlanSlotCandidateEditMode,
  resolveAiMediaPlanSlotCandidateOptions,
  resolveAiMediaPlanSlotDraftAuthority,
  saveAiMediaPlanSlotDraft,
} from '../apps/web/src/lib/ai-media-workflow.ts';
import {
  confirmAiMediaInteractiveDraftDiscard,
} from '../apps/web/src/components/ai-media/source-ai-media-state.ts';

const planPayload = {
  plan: {
    id: 'plan-1', revision: 3, latestVersion: 2, currentVersionId: 'version-2',
    approvedVersionId: null, reviewStatus: 'PENDING', sourceCaptureSnapshotId: 'snapshot-1',
    staleAt: null, staleReasons: [], sourceCurrent: true,
  },
  currentVersion: {
    id: 'version-2', planId: 'plan-1', version: 2, sourceCaptureSnapshotId: 'snapshot-1',
    planPayload: {
      version: '2.0', mode: 'rule_based', manualSelectionAllowed: true, recoverable: true,
      compatibilityGroups: [{ groupKey: 'group-1', identitySignature: '{}', skuKeys: ['sku-red', 'sku-blue'] }],
      slots: [{
        slotKey: 'sku:sku-red:hero', goal: 'sku_hero', status: 'MANUAL_REQUIRED', aspectRatio: '3:4',
        ownership: { level: 'sku', key: 'sku-red' }, references: [], factEvidenceIds: ['fact-1'],
        safetyConstraints: ['preserve_identity'], acceptanceChecks: ['matches_reference'],
      }],
      verifiedFacts: [], diagnostics: [], fallbackReason: null,
    },
    curation: {
      version: '1.0', mode: 'deterministic', consideredCandidateIds: ['main-red', 'main-blue', 'detail-red'],
      selectedCandidateIds: ['main-red', 'main-blue'], decisions: [],
      selectionTarget: { minimum: 1, maximum: 14, eligibleCount: 2, selectedCount: 2, met: true },
      diagnostics: [], fallbackReason: null,
    },
  },
};

const normalized = normalizeAiMediaPlanBundle(planPayload);
assert.ok(normalized);
assert.equal(normalized.currentVersion.planPayload.manualSelectionAllowed, true);
assert.equal(normalized.currentVersion.planPayload.recoverable, true);

const request = buildAiMediaPlanSlotReferenceUpdateRequest({
  expectedRevision: 3,
  baseVersionId: 'version-2',
  operationKey: 'slot-save-operation-1',
  slotKey: 'sku:sku-red:hero',
  referenceCandidateIds: ['main-red', 'detail-red'],
});
assert.deepEqual(request, {
  expectedRevision: 3,
  baseVersionId: 'version-2',
  operationKey: 'slot-save-operation-1',
  changes: [{ slotKey: 'sku:sku-red:hero', referenceCandidateIds: ['main-red', 'detail-red'] }],
});
assert.deepEqual(
  buildAiMediaPlanSlotReferenceUpdateRequest({
    expectedRevision: 3,
    baseVersionId: 'version-2',
    operationKey: 'slot-save-operation-2',
    slotKey: 'sku:sku-red:hero',
    referenceCandidateIds: ['detail-red', 'main-red'],
  }).changes[0].referenceCandidateIds,
  ['detail-red', 'main-red'],
  'reference order is part of the operator decision',
);
assert.deepEqual(buildAiMediaPlanSlotReferenceUpdateRequest({
  expectedRevision: 3,
  baseVersionId: 'version-2',
  operationKey: 'slot-save-clear-1',
  slotKey: 'sku:sku-red:hero',
  referenceCandidateIds: [],
}).changes[0].referenceCandidateIds, []);
for (const invalid of [
  ['main-red', 'main-red'],
  ['1', '2', '3', '4', '5', '6'],
]) {
  assert.throws(() => buildAiMediaPlanSlotReferenceUpdateRequest({
    expectedRevision: 3,
    baseVersionId: 'version-2',
    operationKey: 'slot-save-invalid',
    slotKey: 'sku:sku-red:hero',
    referenceCandidateIds: invalid,
  }));
}

const slot = normalized.currentVersion.planPayload.slots[0];
const options = resolveAiMediaPlanSlotCandidateOptions({
  slot,
  compatibilityGroups: normalized.currentVersion.planPayload.compatibilityGroups,
  consideredCandidateIds: normalized.currentVersion.curation.consideredCandidateIds,
  selectedCandidateIds: normalized.currentVersion.curation.selectedCandidateIds,
  inputs: [
    { sourceMediaKey: 'main-red', role: 'product_main', sourceUrl: '/red.png', assetId: null, assetUrl: null, mimeType: 'image/png', width: 900, height: 1200, scope: 'SKU', skuKeys: ['sku-red'] },
    { sourceMediaKey: 'main-blue', role: 'product_main', sourceUrl: '/blue.png', assetId: null, assetUrl: null, mimeType: 'image/png', width: 900, height: 1200, scope: 'SKU', skuKeys: ['sku-blue'] },
    { sourceMediaKey: 'detail-red', role: 'detail', sourceUrl: '/detail.png', assetId: null, assetUrl: null, mimeType: 'image/png', width: 900, height: 1200, scope: 'SKU', skuKeys: ['sku-red'] },
  ],
});
assert.deepEqual(options.map((option) => [option.candidateId, option.selectable, option.reasonCode]), [
  ['main-red', true, null],
  ['main-blue', false, 'SLOT_INCOMPATIBLE'],
  ['detail-red', false, 'NOT_CURATED'],
]);
const groupOptions = resolveAiMediaPlanSlotCandidateOptions({
  slot: { ...slot, ownership: { level: 'compatibility_group', key: 'group-1' } },
  compatibilityGroups: normalized.currentVersion.planPayload.compatibilityGroups,
  consideredCandidateIds: ['within-group', 'cross-group'],
  selectedCandidateIds: ['within-group', 'cross-group'],
  draftCandidateIds: ['removed-draft-candidate'],
  inputs: [
    { sourceMediaKey: 'within-group', role: 'sku', sourceUrl: '/within.png', assetId: null, assetUrl: null, mimeType: 'image/png', width: 1, height: 1, skuKeys: ['sku-red', 'sku-blue'] },
    { sourceMediaKey: 'cross-group', role: 'sku', sourceUrl: '/cross.png', assetId: null, assetUrl: null, mimeType: 'image/png', width: 1, height: 1, skuKeys: ['sku-red', 'sku-green'] },
  ],
});
assert.deepEqual(groupOptions.map((option) => [option.candidateId, option.selectable]), [
  ['within-group', true],
  ['cross-group', false],
  ['removed-draft-candidate', false],
]);
assert.equal(groupOptions.at(-1)?.reasonCode, 'SOURCE_UNAVAILABLE');
const authorityDraft = {
  planId: 'plan-1', baseVersionId: 'version-2', baseRevision: 3,
};
const authorityPlan = {
  id: 'plan-1', revision: 3, staleAt: null, sourceCurrent: true,
};
assert.equal(resolveAiMediaPlanSlotDraftAuthority({
  draft: authorityDraft, plan: authorityPlan, currentVersionId: 'version-2',
}), 'CURRENT');
assert.equal(resolveAiMediaPlanSlotDraftAuthority({
  draft: authorityDraft, plan: { ...authorityPlan, revision: 4 }, currentVersionId: 'version-3',
}), 'VERSION_CONFLICT');
assert.equal(resolveAiMediaPlanSlotDraftAuthority({
  draft: authorityDraft,
  plan: { ...authorityPlan, revision: 4, staleAt: '2026-07-21T00:00:00.000Z' },
  currentVersionId: 'version-3',
}), 'STALE_SOURCE');
assert.equal(resolveAiMediaPlanSlotDraftAuthority({
  draft: authorityDraft, plan: { ...authorityPlan, sourceCurrent: false }, currentVersionId: 'version-2',
}), 'STALE_SOURCE');
assert.equal(resolveAiMediaPlanSlotCandidateEditMode({
  editingAllowed: true, staleConflict: false, rebaseRequested: false, authority: 'CURRENT',
}), 'current');
assert.equal(resolveAiMediaPlanSlotCandidateEditMode({
  editingAllowed: true, staleConflict: false, rebaseRequested: true, authority: 'CURRENT',
}), 'read-only', 'a failed authority refresh must not allow rebase against the old bundle');
assert.equal(resolveAiMediaPlanSlotCandidateEditMode({
  editingAllowed: true, staleConflict: false, rebaseRequested: true, authority: 'VERSION_CONFLICT',
}), 'version-conflict');
assert.equal(resolveAiMediaPlanSlotCandidateEditMode({
  editingAllowed: true, staleConflict: true, rebaseRequested: false, authority: 'CURRENT',
}), 'read-only', 'a stale response remains terminal even when its follow-up load fails');
assert.equal(resolveAiMediaPlanSlotCandidateEditMode({
  editingAllowed: true, staleConflict: true, rebaseRequested: true, authority: 'STALE_SOURCE',
}), 'read-only');
assert.equal(canToggleAiMediaPlanSlotCandidate({
  mode: 'version-conflict', selected: true, selectable: false,
}), true);
assert.equal(canToggleAiMediaPlanSlotCandidate({
  mode: 'version-conflict', selected: false, selectable: true,
}), false);
assert.equal(canToggleAiMediaPlanSlotCandidate({
  mode: 'read-only', selected: true, selectable: true,
}), false);
assert.equal(canToggleAiMediaPlanSlotCandidate({
  mode: 'current', selected: false, selectable: true,
}), true);

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) || null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key),
};
const draftKey = aiMediaPlanSlotDraftStorageKey('plan-1', 'sku:sku-red:hero');
const savedDraft = {
  planId: 'plan-1', baseVersionId: 'version-2', baseRevision: 3,
  slotKey: 'sku:sku-red:hero', referenceCandidateIds: ['main-red'], savedAt: 100,
};
saveAiMediaPlanSlotDraft(storage, draftKey, savedDraft);
assert.deepEqual(loadAiMediaPlanSlotDraft(storage, draftKey, { now: 200 }), savedDraft);
assert.equal(loadAiMediaPlanSlotDraft(storage, draftKey, { now: 1_000, ttlMs: 100 }), null);
let discardPrompts = 0;
assert.equal(confirmAiMediaInteractiveDraftDiscard(false, () => { discardPrompts += 1; return false; }), true);
assert.equal(confirmAiMediaInteractiveDraftDiscard(true, () => { discardPrompts += 1; return false; }), false);
assert.equal(discardPrompts, 1);

const planningPanel = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-planning-panel.tsx', 'utf8');
const mediaPanel = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-panel.tsx', 'utf8');
const sourcePage = fs.readFileSync('apps/web/src/app/(dashboard)/collect/source/page.tsx', 'utf8');
const preflight = fs.readFileSync('scripts/preflight.mjs', 'utf8');

assert.match(mediaPanel, /target\.type === 'collect' \? <SourceAiMediaPlanningPanel/u);
assert.doesNotMatch(mediaPanel, /target\.type === 'collect' && context/u);
assert.match(mediaPanel, /candidateInputs=\{context\?\.inputs \?\? \[\]\}/u);
assert.match(mediaPanel, /candidateSnapshotId=\{context\?\.snapshot\.id\}/u);
assert.match(planningPanel, /plans\/\$\{encodeURIComponent\(slotDraft\.planId\)\}\/slot-references/u);
assert.match(planningPanel, /buildAiMediaPlanSlotReferenceUpdateRequest/u);
assert.match(planningPanel, /resolveWorkflowSubmissionIntent/u);
assert.match(planningPanel, /saveAiMediaPlanSlotDraft/u);
assert.match(planningPanel, /slotDraftDirty/u);
assert.match(planningPanel, /beforeunload/u);
assert.match(planningPanel, /\['PENDING', 'APPROVED', 'REJECTED'\]\.includes/u);
assert.match(planningPanel, /code\.includes\('ACTIVE_SUITE_CONFLICT'\)[\s\S]*setSlotConflictRequiresRebase\(false\)/u);
assert.match(planningPanel, /code\.includes\('STALE'\)[\s\S]*setSlotConflictRequiresRebase\(false\)/u);
assert.match(planningPanel, /canToggleAiMediaPlanSlotCandidate/u);
assert.match(planningPanel, /draftCandidateIds: slotDraft\?\.referenceCandidateIds/u);
assert.match(planningPanel, /slotSourceStaleConflict/u);
assert.match(planningPanel, /Promise<PlanLoadOutcome>/u);
assert.match(planningPanel, /const refreshed = await load\(true\)/u);
assert.match(planningPanel, /slotCandidateEditMode !== 'current'/u);
assert.match(planningPanel, /disabled=\{!canRebaseSlotDraft\}/u);
assert.match(planningPanel, /retrySlotConflictRefresh/u);
assert.match(planningPanel, /重新读取最新版本/u);
assert.match(planningPanel, /canRefreshSlotConflict/u);
assert.match(planningPanel, /!slotSourceStaleConflict[\s\S]*&& !slotSaving/u);
assert.match(planningPanel, /!canRefreshSlotConflict \|\| slotConflictRefreshing \|\| slotSaving/u);
assert.match(planningPanel, /if \(!slotSavingRef\.current\)/u);
assert.match(planningPanel, /参考图/u);
assert.match(planningPanel, /DialogContent/u);
assert.doesNotMatch(planningPanel, /evidenceIds\s*:/u);
assert.doesNotMatch(planningPanel, /ownerUserId|actorUserId/u);
assert.match(mediaPanel, /mediaDraftDirty \|\| planningDraftDirty/u);
assert.match(mediaPanel, /aiMediaInteractiveDraftDirty = maskDirty \|\| planningDraftDirty/u);
assert.match(mediaPanel, /interactiveDraftDirtyRef/u);
assert.match(mediaPanel, /window\.history\.pushState/u);
assert.match(mediaPanel, /discardInteractiveDrafts/u);
assert.match(mediaPanel, /onRegisterSlotDraftDiscard=\{registerSlotDraftDiscard\}/u);
assert.match(sourcePage, /aiMediaInteractiveDraftDirty/u);
assert.match(sourcePage, /aiMediaInteractiveDraftDiscardRef/u);
assert.match(sourcePage, /discardAiMediaInteractiveDraft/u);
assert.ok((planningPanel.match(/isCurrentOperation\(\)/gu) || []).length >= 5, 'slot saves must reject late target responses');
assert.match(preflight, /web-ai-media-plan-slot-editor\.test\.mjs/u);

console.log('PASS Web AI media plan slot editor contract');

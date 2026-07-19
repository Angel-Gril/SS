import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildAiMediaPlanReviewRequest,
  canApproveAiMediaPlan,
  canRegenerateAiMediaPlan,
  formatAiMediaPlanningIdentity,
  formatAiMediaPlanningSlotKey,
  normalizeAiMediaPlanBundle,
} from '../apps/web/src/lib/ai-media-workflow.ts';
import { SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY } from '../packages/shared/src/ozon-listing-draft.ts';

const normalized = normalizeAiMediaPlanBundle({
  plan: {
    id: 'plan-1', revision: 3, latestVersion: 2, currentVersionId: 'version-2',
    approvedVersionId: null, reviewStatus: 'PENDING', staleAt: null, staleReasons: [], sourceCurrent: true,
  },
  currentVersion: {
    id: 'version-2', planId: 'plan-1', version: 2, sourceCaptureSnapshotId: 'snapshot-1',
    curation: {
      version: '1.0', mode: 'deterministic', consideredCandidateIds: ['image-1', 'image-2'],
      selectedCandidateIds: ['image-1'],
      decisions: [
        { candidateId: 'image-1', disposition: 'keep', reasonCodes: [], translation: 'skip', contentRole: 'identity', score: 10, duplicateOfCandidateId: null, continuity: null },
        { candidateId: 'image-2', disposition: 'manual', reasonCodes: ['DIMENSIONS_UNKNOWN'], translation: 'unknown', contentRole: 'unknown', score: null, duplicateOfCandidateId: null, continuity: null },
      ],
      selectionTarget: { minimum: 1, maximum: 14, eligibleCount: 1, selectedCount: 1, met: true },
      diagnostics: [], fallbackReason: null,
    },
    planPayload: {
      version: '2.0', mode: 'rule_based',
      compatibilityGroups: [{ groupKey: 'group-1', identitySignature: '{}', skuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY] }],
      slots: [{
        slotKey: `sku:${SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY}:hero`, goal: 'sku_hero', status: 'READY', aspectRatio: '3:4',
        ownership: { level: 'sku', key: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY },
        references: [{ candidateId: 'image-1', evidenceIds: ['evidence:image-1'] }],
        factEvidenceIds: ['evidence:color'], safetyConstraints: ['preserve identity'], acceptanceChecks: ['same color'],
      }],
      verifiedFacts: [{ path: '/facts/title', value: 'Bottle', evidenceIds: ['evidence:color'], skuKeys: [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY] }],
      diagnostics: [], fallbackReason: null,
    },
  },
});

assert.equal(normalized?.plan.id, 'plan-1');
assert.equal(normalized?.plan.sourceCurrent, true);
assert.equal(normalized?.plan.sourceCaptureSnapshotId, 'snapshot-1');
assert.deepEqual(normalized?.currentVersion?.curation?.decisions[1]?.reasonCodes, ['DIMENSIONS_UNKNOWN']);
assert.deepEqual(normalized?.currentVersion?.planPayload?.compatibilityGroups[0]?.skuKeys, [SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY]);
assert.deepEqual(normalized?.currentVersion?.planPayload?.slots[0]?.ownership, {
  level: 'sku', key: SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY,
});
assert.deepEqual(normalized?.currentVersion?.planPayload?.slots[0]?.references[0], {
  candidateId: 'image-1', evidenceIds: ['evidence:image-1'],
});
assert.equal(normalizeAiMediaPlanBundle(null), null);
assert.equal(normalizeAiMediaPlanBundle({ plan: { revision: 1 } }), null);
assert.equal(canApproveAiMediaPlan(normalized), true);
const manualPlan = structuredClone(normalized);
manualPlan.currentVersion.planPayload.slots[0].status = 'MANUAL_REQUIRED';
manualPlan.currentVersion.planPayload.slots[0].references = [];
assert.equal(canApproveAiMediaPlan(manualPlan), false);
assert.equal(canRegenerateAiMediaPlan({ reviewStatus: 'REJECTED', staleAt: null, sourceCurrent: true }), true);
assert.equal(canRegenerateAiMediaPlan({ reviewStatus: 'PENDING', staleAt: '2026-07-19T00:00:00.000Z', sourceCurrent: true }), true);
assert.equal(canRegenerateAiMediaPlan({ reviewStatus: 'APPROVED', staleAt: null, sourceCurrent: false }), true);
assert.equal(canRegenerateAiMediaPlan({ reviewStatus: 'PENDING', staleAt: null, sourceCurrent: true }), false);
assert.equal(canRegenerateAiMediaPlan({ reviewStatus: 'APPROVED', staleAt: null, sourceCurrent: true }), false);
assert.equal(formatAiMediaPlanningIdentity(SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY), '商品级');
assert.equal(formatAiMediaPlanningIdentity('sku-red'), 'sku-red');
assert.equal(
  formatAiMediaPlanningSlotKey(`sku:${SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY}:hero`),
  'sku:商品级:hero',
);

assert.deepEqual(buildAiMediaPlanReviewRequest({
  expectedRevision: 3,
  operationKey: 'plan-review-123',
  decision: 'APPROVE',
  note: ' checked ',
}), {
  expectedRevision: 3,
  operationKey: 'plan-review-123',
  decision: 'APPROVE',
  note: 'checked',
});
assert.throws(() => buildAiMediaPlanReviewRequest({ expectedRevision: 0, operationKey: 'plan-review-123', decision: 'APPROVE' }), /版本已失效/u);

const panel = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-planning-panel.tsx', 'utf8');
const shell = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-panel.tsx', 'utf8');
const workflow = fs.readFileSync('apps/web/src/lib/ai-media-workflow.ts', 'utf8');
const sourcePage = fs.readFileSync('apps/web/src/app/(dashboard)/collect/source/page.tsx', 'utf8');

assert.match(shell, /SourceAiMediaPlanningPanel/u);
assert.match(panel, /plans\/current\?contextType=collect&contextId=/u);
assert.match(panel, /api\/ai-images\/plans'/u);
assert.match(panel, /plans\/\$\{encodeURIComponent\(plan\.id\)\}\/review/u);
assert.match(panel, /尚未生成图片策展计划/u);
assert.match(panel, /生成规则策展计划/u);
assert.match(panel, /基于当前快照重新生成/u);
assert.match(panel, /planningEnabled/u);
assert.match(panel, /selectedSkuKeys/u);
assert.match(panel, /\.\.\.\(normalizedSkuKeys\.length \? \{ selectedSkuKeys: normalizedSkuKeys \} : \{\}\)/u);
assert.match(panel, /reasonCodes/u);
assert.match(panel, /compatibilityGroups/u);
assert.match(panel, /slot\.ownership/u);
assert.match(panel, /reference\.evidenceIds/u);
assert.match(panel, /slot\.factEvidenceIds/u);
assert.match(panel, /group\.skuKeys\.map\(formatAiMediaPlanningIdentity\)/u);
assert.match(panel, /formatAiMediaPlanningSlotKey\(slot\.slotKey\)/u);
assert.match(panel, /formatAiMediaPlanningIdentity\(slot\.ownership\.key\)/u);
assert.match(panel, /contextVersion/u);
assert.match(panel, /operationContextVersion/u);
assert.match(panel, /isCurrentOperation/u);
assert.match(panel, /sourceCurrent === false/u);
assert.match(panel, /buildAiMediaPlanReviewRequest/u);
assert.match(panel, /canApproveAiMediaPlan/u);
assert.match(panel, /Boolean\(reviewing\) \|\| !approvalReady/u);
assert.match(panel, /expectedRevision: plan\.revision/u);
assert.match(panel, /resolveWorkflowSubmissionIntent/u);
assert.match(workflow, /normalizeAiMediaPlanBundle/u);
assert.match(workflow, /canRegenerateAiMediaPlan/u);
assert.doesNotMatch(panel, /currentVersion\?\.planHash/u);
assert.match(sourcePage, /const planningSkuKeys = \[\.\.\.new Set\(selectedSkuKeys\.filter\(Boolean\)\)\]\.sort\(\)/u);

console.log('PASS Web AI media planning read and review workbench contract');

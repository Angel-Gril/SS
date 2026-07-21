import assert from 'node:assert/strict';
import fs from 'node:fs';

const client = fs.readFileSync('apps/web/src/lib/ai-media-listing-draft-application.ts', 'utf8');
const panel = fs.readFileSync('apps/web/src/components/ai-media/source-ai-media-panel.tsx', 'utf8');
const workbench = fs.readFileSync('apps/web/src/components/source-listing/source-listing-workbench.tsx', 'utf8');
const attributeEditor = fs.readFileSync('apps/web/src/components/source-listing/ozon-attribute-editor.tsx', 'utf8');
const route = fs.readFileSync('apps/server/src/routes/ai-images.ts', 'utf8');
const service = fs.readFileSync('apps/server/src/services/ai-media-listing-draft-application-mutations.ts', 'utf8');
const preflight = fs.readFileSync('scripts/preflight.mjs', 'utf8');

assert.match(client, /ai-media-listing-draft-application\/v1/u);
assert.match(client, /AI_MEDIA_LISTING_DRAFT_APPLICATION_SLOT_KEY_MAX_LENGTH = 200/u);
assert.match(client, /listing-draft-application/u);
assert.match(client, /contexts\/listing-draft\/\$\{encoded\(draftId\)\}\/applications/u);
assert.match(client, /workflows\/\$\{encoded\(normalized\)\}\/listing-draft-application/u);
assert.match(client, /listing-draft-applications\/\$\{encoded\(normalized\)\}\/rollback/u);
assert.match(client, /expectedTargetRevision: authority\.revision/u);
assert.match(client, /expectedTargetDraftVersion: authority\.draftVersion/u);
const applyRequestStart = client.indexOf('export function buildAiMediaListingDraftApplicationRequest');
const applyRequestEnd = client.indexOf('\nexport function buildAiMediaListingDraftRollbackRequest', applyRequestStart);
assert.ok(applyRequestStart >= 0 && applyRequestEnd > applyRequestStart);
const applyRequest = client.slice(applyRequestStart, applyRequestEnd);
assert.doesNotMatch(
  applyRequest,
  /targetId:|skuKey:|slotKey:/u,
  'application mutation body must derive target identity from the frozen workflow/context',
);
assert.match(client, /当前槽位标识过长，无法写回商品草稿/u);
assert.match(client, /exactText\(\s*candidate\.contextSlotKey,[\s\S]{0,120}AI_MEDIA_LISTING_DRAFT_APPLICATION_SLOT_KEY_MAX_LENGTH/u);
assert.match(client, /workflowMatchesListingDraftAuthority/u);
assert.match(client, /replaceConfirmed !== true/u);
assert.match(client, /appendAiMediaListingDraftApplicationLedgerPage/u);
assert.match(client, /compareListingDraftTargetVersion/u);
assert.match(client, /class AiMediaListingDraftApplicationResponseError extends Error/u);
assert.match(client, /throw new AiMediaListingDraftApplicationResponseError/u);

assert.match(panel, /aiMediaListingDraftApplicationClient/u);
assert.match(panel, /listingDraftApplicationSlotKeyTooLong/u);
assert.match(panel, /替换当前槽位/u);
assert.match(panel, /草稿槽位已追加候选图/u);
assert.match(panel, /target\.type === 'listing-draft' \?[\s\S]{0,100}listingDraftTargetStale/u);
assert.match(panel, /applicationRollbackReason\(application\.rollbackReason\)/u);
assert.match(panel, /listingDraftTargetStale/u);
assert.match(panel, /listingDraftApplicationLedger/u);
assert.match(panel, /listingDraftApplicationClient\.rollback/u);
assert.match(panel, /listingWorkflowHasApplication/u);
assert.doesNotMatch(panel, /listingWorkflowHasApplication[\s\S]{0,260}!application\.rolledBackById/u);
assert.match(panel, /recoveredOperation/u);
assert.match(panel, /readListingDraftApplicationLedger\(requestTargetId, \{ operationKey: intent\.operationKey \}\)/u);
assert.match(panel, /listingDraftApplicationLedger\?\.nextBeforeSequence/u);
assert.match(panel, /applicationPageGenerationRef/u);
assert.match(panel, /appendAiMediaListingDraftApplicationLedgerPage\(current, page\)/u);
assert.match(panel, /requestTargetIdentity = aiMediaTargetIdentity\(requestTarget\)/u);
assert.match(panel, /listingGeneration !== applicationLoadGenerationRef\.current/u);
assert.match(panel, /aiMediaTargetIdentity\(targetRef\.current\) !== requestTargetIdentity/u);
assert.match(panel, /isAiMediaListingDraftApplicationResponseError\(caught\)[\s\S]{0,180}isDefinitiveAiMediaApplicationFailure\(caught\.code\)/u);
assert.match(panel, /clearIntent\(\);[\s\S]{0,180}草稿候选应用失败/u);
assert.match(panel, /maskDirtyRef\.current[\s\S]{0,180}请先提交或放弃当前遮罩草稿，再应用候选图/u);
assert.match(panel, /maskDirtyRef\.current[\s\S]{0,180}请先提交或放弃当前遮罩草稿，再回滚图片应用/u);
assert.match(panel, /mediaDraftDirty \|\| maskDirty \|\| listingDraftTargetStale/u);
assert.match(panel, /target\.revision[\s\S]{0,220}target\.draftVersion/u);
assert.match(panel, /flex-wrap/u);
assert.match(panel, /min-w-0/u);
assert.match(panel, /overflow-x-auto/u);
assert.doesNotMatch(panel, /targetId:\s*target\.id[\s\S]{0,500}listingDraftApplicationClient\.apply/u);

assert.match(workbench, /aiMediaMaskDraftDirty/u);
assert.match(workbench, /onMaskDraftDirtyChange=\{handleAiMediaMaskDraftDirtyChange\}/u);
assert.match(workbench, /disabled=\{aiMediaMutationBusy \|\| Boolean\(busyAction\) \|\| aiMediaMaskDraftDirty\}/u);
assert.match(workbench, /请先提交或放弃当前遮罩草稿，再切换图片槽位/u);
assert.match(workbench, /blockDraftRevisionChangeForMask/u);
assert.match(workbench, /disabled=\{Boolean\(busyAction\) \|\| aiMediaMaskDraftDirty\}/u);
assert.match(workbench, /disabled=\{aiMediaMaskDraftDirty\}/u);
assert.match(workbench, /mediaMutationBusy=\{aiMediaMutationBusy \|\| Boolean\(busyAction\)\}/u);
assert.match(workbench, /if \(!draft\) handleAiMediaMaskDraftDirtyChange\(false\)/u);
assert.match(workbench, /aiMediaMaskDraftDirtyRef\.current/u);
assert.match(workbench, /const handleAttributeDraftChange = useCallback/u);
assert.match(workbench, /onDraftChange=\{handleAttributeDraftChange\}/u);
assert.doesNotMatch(workbench, /onDraftChange=\{\(nextDraft\)/u);
assert.match(panel, /disabled=\{submitting \|\| mediaMutationBusy\}/u);
assert.match(attributeEditor, /disabled = false/u);
assert.match(attributeEditor, /const editorLocked = disabled \|\| listingWorkflowLoading/u);
assert.match(workbench, /LISTING_AI_MEDIA_PRODUCT_SLOTS/u);
assert.match(workbench, /sku:\$\{skuKey\}:hero/u);

assert.match(route, /contexts\/listing-draft\/:id\/applications/u);
assert.match(route, /workflows\/:id\/listing-draft-application/u);
assert.match(route, /listing-draft-applications\/:id\/rollback/u);
assert.match(route, /listingDraftApplyEnabled: !production && workflowEnabled && webMediaDecision\.enabled/u);
assert.match(panel, /applications\?\.listingDraftApplyEnabled !== true/u);
assert.match(service, /expectedTargetDraftVersion/u);
assert.match(service, /targetDraftVersionBefore/u);
assert.match(service, /targetDraftVersionAfter/u);
assert.match(service, /FOR UPDATE/u);
assert.match(service, /operationKey/u);
assert.match(service, /rollbackEligible/u);
assert.match(service, /ROLLBACK_ORDER_CONFLICT/u);
assert.match(preflight, /web-ai-media-listing-draft-application\.test\.mjs/u);

console.log('PASS Web AI media listing-draft application contract');

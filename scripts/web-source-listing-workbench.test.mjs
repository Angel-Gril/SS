import assert from 'node:assert/strict';
import fs from 'node:fs';

const pagePath = 'apps/web/src/app/(dashboard)/collect/source/page.tsx';
const workbenchPath = 'apps/web/src/components/source-listing/source-listing-workbench.tsx';
const attributeEditorPath = 'apps/web/src/components/source-listing/ozon-attribute-editor.tsx';
const clientPath = 'apps/web/src/lib/source-listing-workflow.ts';

for (const path of [pagePath, clientPath, workbenchPath, attributeEditorPath]) {
  assert.equal(fs.existsSync(path), true, `${path} should exist`);
}

const page = fs.readFileSync(pagePath, 'utf8');
const workbench = fs.readFileSync(workbenchPath, 'utf8');
const attributeEditor = fs.readFileSync(attributeEditorPath, 'utf8');
const client = fs.readFileSync(clientPath, 'utf8');

for (const token of ['useSearchParams', 'Suspense', 'parseSourceListingHandoff', 'SourceListingWorkbench']) {
  assert.match(page, new RegExp(token), `source page should wire ${token}`);
}
assert.match(page, /section[^\n]*listing|section:\s*['"]listing['"]/, 'handoff should open the listing workbench');

for (const token of [
  'getCaptureView',
  'skuOffset',
  'mediaOffset',
  'selectedSkuKeys',
  'createWorkflowFromSnapshot',
  'getDraft',
  'getPublishAttempt',
  'workflowId',
  'attemptId',
]) {
  assert.match(workbench, new RegExp(token), `workbench should implement exact resume/paging via ${token}`);
}
assert.doesNotMatch(workbench, /\/variants\/|deleteSourceVariant|handleDeleteSourceVariant/, 'SKU selection must not mutate the source projection');
assert.match(workbench, /history\.replaceState|router\.replace/, 'workflow and attempt IDs should be written back to the URL');

for (const token of [
  'getPublisherCapability',
  'capability.enabled',
  'capability.legacyAllowed',
  'createPublishAttempt',
  'v2AttemptStartedRef',
  '/api/collect/publish-ozon',
]) {
  assert.match(workbench, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `workbench should make an explicit rollout decision via ${token}`);
}
assert.match(
  workbench,
  /v2AttemptStartedRef\.current[\s\S]{0,500}(?:throw|setError|return)/,
  'once V2 starts, an error must not fall back to the legacy publisher',
);
assert.match(workbench, /useRef\(Boolean\(handoff\.attemptId\)\)/, 'an exact attempt handoff must fail closed before recovery starts');
assert.match(workbench, /attemptDiscoveryState\s*!==\s*['"]ready['"]/, 'publish must wait for successful attempt discovery');
assert.match(
  workbench,
  /source-listing-copy-review:\$\{candidate\.id\.slice\(0, 80\)\}:r\$\{current\.revision\}/,
  'copy apply idempotency must identify the candidate and starting revision',
);
assert.match(workbench, /pendingCopyApplyRef/, 'ambiguous copy applies must retain their exact operation key for retry');
assert.match(workbench, /reusableManualCandidate/, 'ambiguous manual candidate creation must reconcile an exact persisted candidate');
assert.match(workbench, /systemDialog\.confirm/, 'publish should require the in-app final confirmation dialog');
assert.doesNotMatch(workbench, /window\.confirm/, 'publish must not use the browser confirm dialog');
assert.match(workbench, /SOURCE_LISTING_PRODUCT_ONLY_SKU_KEY/, 'product-only captures should receive the reserved canonical SKU');
assert.match(workbench, /view\.skus\.total\s*===\s*0/, 'product-only selection should be derived from the exact empty SKU snapshot');
assert.match(
  workbench,
  /const confirmationDraft = await sourceListingWorkflowClient\.getDraft[\s\S]{0,1800}systemDialog\.confirm/,
  'final confirmation must display an owner-refreshed exact draft',
);
assert.match(
  workbench,
  /createPublishAttempt\(confirmationDraft\.id,[\s\S]{0,300}expectedRevision: confirmationDraft\.revision/,
  'V2 submission must CAS the exact revision shown in final confirmation',
);

for (const token of ['exactWorkflowId={draft.id}', 'exactSnapshotId={activeHandoff.snapshotId}', 'lockedShopId={draft.shopId}', 'exactRevision={draft.revision}', 'onDraftChange={handleAttributeDraftChange}']) {
  assert.match(workbench, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `workbench should bind attributes through ${token}`);
}
assert.match(
  workbench,
  /draft\.category\s*\?\s*\([\s\S]{0,200}<OzonAttributeEditor/,
  'a category-less draft must not mount the attribute editor or issue expected 409 requests',
);
for (const token of ['exactWorkflowId', 'exactSnapshotId', 'lockedShopId', 'sourceCaptureSnapshotId', 'onDraftChange?.(draft)']) {
  assert.match(attributeEditor, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `attribute editor exact mode should enforce ${token}`);
}
assert.match(attributeEditor, /if \(exactMode\)[\s\S]{0,2500}api\.get<OzonListingDraft>/, 'exact attribute mode should GET the specified workflow');

for (const token of [
  'getAiCopyCapability',
  'generateCopyCandidate',
  'createCopyCandidate',
  'applyCopyCandidate',
  'internalizeMedia',
  'assignMedia',
  'buildOzonListingPricingV1',
  'validateFinalDraft',
  'isDraftReadyForImmutablePublish',
]) {
  assert.match(workbench, new RegExp(token), `workbench should close review and validation through ${token}`);
}
assert.match(client, /ai-candidates\/generate/, 'AI copy generation must use the server-authoritative generation route');
assert.match(workbench, /selectedCopyCandidateId/, 'review should preserve the exact generated candidate provenance when unchanged');
assert.match(workbench, /pendingCopyGenerationRef/, 'ambiguous generation retries must preserve the exact operation key');
assert.match(workbench, /COPY_GENERATION_STORAGE_KEY/, 'unresolved generation operation keys must survive remounts');
assert.match(workbench, /COPY_GENERATION_STORAGE_MAX_ITEMS/, 'persisted generation operation keys must be bounded');
assert.match(
  workbench,
  /const refreshed = await sourceListingWorkflowClient\.getDraft\(current\.id\);[\s\S]{0,180}forgetPendingGeneration\(signature, operationKey\)/,
  'paid generation recovery keys must survive until the persisted draft refresh succeeds',
);
assert.match(workbench, /new Map\(/, 'multiple generation instruction signatures must be retained independently');
assert.match(workbench, /activeHandoffRef/, 'late generation responses must be checked against the active exact handoff');
assert.match(workbench, /handoffEpochRef/, 'late handoff-scoped responses must be rejected by epoch');
assert.match(workbench, /useLayoutEffect/, 'handoff epoch must be synchronized after React commits, not during render');
assert.match(workbench, /captureRequestIdRef/, 'late capture pages must not overwrite the active product');
assert.match(workbench, /pollControllerRef\.current\?\.abort\(\)/, 'product switching must abort an old publish poll');
assert.match(workbench, /v2AttemptStartedRef\.current = Boolean\(handoff\.attemptId\)/, 'a new handoff must reset its V2 fallback boundary');
for (const handler of ['refreshDraft', 'confirmCategory', 'internalizeAndAssignMedia', 'saveStrictPricing', 'validateFinalDraft', 'pollPublishAttempt', 'publish', 'refreshAttempt', 'resolvePublishAttempt']) {
  const start = workbench.indexOf(`async function ${handler}`);
  const next = workbench.indexOf('\n  async function ', start + 1);
  const body = workbench.slice(start, next < 0 ? workbench.length : next);
  assert.match(body, /captureHandoffRequest\(\)/, `${handler} must capture the exact handoff epoch`);
  assert.match(body, /isHandoffRequestActive\(/, `${handler} must reject late handoff responses`);
}
assert.match(workbench, /copyEditorVersionRef/, 'late generation results must preserve edits made while the request was running');
assert.match(workbench, /applied\.copy\.applyAudit\.find/, 'copy editor hydration must follow the exact apply audit');
assert.match(workbench, /setCopyTitle\(applied\.copy\.publishTitleRu \|\| ''\)/, 'partial apply must hydrate the effective publish title');
assert.match(workbench, /setCopyDescription\(applied\.copy\.publishDescriptionRu \|\| ''\)/, 'partial apply must hydrate the effective publish description');
assert.match(workbench, /reviewsTitle[\s\S]{0,700}reviewsDescription/, 'manual review should submit explicit changed-field coverage');
assert.match(
  workbench,
  /!copyTitle\.trim\(\)\s*&&\s*!copyDescription\.trim\(\)/,
  'description-only candidates must remain applicable',
);
assert.match(workbench, /role="alert" aria-live="assertive"/, 'AI capability failures must be announced accessibly');
assert.match(workbench, /aria-label=\{`载入候选 \$\{candidate\.titleRu \|\| candidate\.id\}`\}/, 'candidate load controls need candidate-specific accessible names');
for (const label of ['OZON_LISTING_SUPPORTED_CURRENCY_CODES', 'OZON_LISTING_SUPPORTED_VAT_RATES', 'VAT', '定价币种', '选择税率', '服务端校验通过', '校验已过期']) {
  assert.match(workbench, new RegExp(label), `workbench should expose ${label}`);
}
assert.doesNotMatch(workbench, /vat:\s*String\(row\?\.vat\s*\?\?\s*['"]0['"]\)/, 'VAT must not be silently defaulted');

for (const token of ['listPublishAttempts', 'pollPublishAttempt', 'requestPayloadHash', 'itemErrors', "state === 'UNKNOWN'", 'resolvePublishAttempt']) {
  assert.match(workbench, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `workbench should expose recovery via ${token}`);
}
for (const token of ['offerTrace', 'itemErrorCount', 'itemErrorsTruncated', 'Canonical SKU']) {
  assert.match(workbench, new RegExp(token), `attempt repair UI should preserve ${token}`);
}
for (const label of ['Ozon Task ID', '提交载荷哈希', '人工确认已提交', '人工确认未提交', '错误明细']) {
  assert.match(workbench, new RegExp(label), `workbench should render ${label}`);
}

assert.doesNotMatch(client, /\/api\/collect\/publish-ozon/, 'central client must remain V2-only');

console.log('PASS web source listing workbench');

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
assert.match(workbench, /source-listing-copy-review:\$\{candidate\.id\}/, 'copy apply idempotency must be scoped to the candidate');
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

for (const token of ['exactWorkflowId={draft.id}', 'exactSnapshotId={activeHandoff.snapshotId}', 'lockedShopId={draft.shopId}', 'exactRevision={draft.revision}', 'onDraftChange={setDraft}']) {
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
for (const label of ['RUB', 'VAT', '服务端校验通过', '校验已过期']) {
  assert.match(workbench, new RegExp(label), `workbench should expose ${label}`);
}

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

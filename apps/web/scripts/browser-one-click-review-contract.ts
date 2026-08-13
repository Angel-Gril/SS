import assert from 'node:assert/strict';
import {
  browserOneClickReviewDraftHref,
  parseBrowserOneClickReviewFailure,
  parseBrowserOneClickReviewHandoff,
} from '../src/lib/browser-one-click-review';

const draft = {
  supplyGoodsId: 'goods-1',
  snapshotId: 'snapshot-1',
  draftId: 'draft-1',
  draftVersion: 0,
  revision: 0,
  skuKey: 'legacy-sku-1',
  sourceSku: 'sku-1',
};
const validHandoff = {
  contractVersion: 'browser-one-click-v2-handoff/v1',
  state: 'REVIEW_REQUIRED',
  drafts: [draft],
  failures: [],
};

assert.deepEqual(parseBrowserOneClickReviewHandoff(validHandoff)?.drafts, [draft]);
assert.equal(
  browserOneClickReviewDraftHref(draft),
  '/collect/source?supplyGoodsId=goods-1&snapshotId=snapshot-1&workflowId=draft-1&section=listing',
);

for (const value of [
  { ...validHandoff, drafts: [] },
  { ...validHandoff, drafts: [{ ...draft, snapshotId: undefined }] },
  { ...validHandoff, drafts: [{ ...draft, draftVersion: -1 }] },
  { ...validHandoff, drafts: [draft, { ...draft, snapshotId: 'snapshot-2', sourceSku: 'sku-2' }] },
  { ...validHandoff, drafts: Array.from({ length: 101 }, (_, index) => ({
    ...draft,
    supplyGoodsId: `goods-${index}`,
    snapshotId: `snapshot-${index}`,
    draftId: `draft-${index}`,
    sourceSku: `sku-${index}`,
  })) },
]) {
  assert.equal(parseBrowserOneClickReviewHandoff(value), null);
}

assert.equal(browserOneClickReviewDraftHref({ ...draft, draftId: 'draft\n1' }), null);
assert.deepEqual(parseBrowserOneClickReviewFailure({
  errorCode: 'BROWSER_ONE_CLICK_SKU_COVERAGE_INCOMPLETE',
  failures: [{ errorCode: 'SOURCE_CAPTURE_LEGACY_INGEST_FAILED', supplyGoodsId: '', sku: 'sku-1' }],
  missingSkus: ['sku-2'],
  unknownSkus: [],
  duplicateSkus: [],
}), {
  errorCode: 'BROWSER_ONE_CLICK_SKU_COVERAGE_INCOMPLETE',
  failures: [{ errorCode: 'SOURCE_CAPTURE_LEGACY_INGEST_FAILED', sku: 'sku-1' }],
  missingSkus: ['sku-2'],
  unknownSkus: [],
  duplicateSkus: [],
});

console.log('PASS Web browser one-click review parser contract');

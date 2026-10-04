import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveCombinedImageAction } from '../extensions/ss-erp/pages/donor/combined-image-flow.js';
const ready = { draftId: 'draft', billing: { state: 'ready', listingWorkflowId: 'draft', quote: null, suite: null },
  availability: { state: 'ready', available: true }, translation: { items: [], busy: false, unknown: false }, busy: false };
test('combined processing reads readiness before generation and rejects a disabled translation provider', () => {
  assert.equal(resolveCombinedImageAction({ ...ready, availability: { state: 'idle' } }).action, 'CHECK');
  const denied = resolveCombinedImageAction({ ...ready, availability: { state: 'ready', available: false } });
  assert.equal(denied.disabled, true);
});
test('only an explicit main-only quote is started; an existing multi-image suite stays in its original flow', () => {
  assert.equal(resolveCombinedImageAction(ready).action, 'PREPARE');
  assert.equal(resolveCombinedImageAction({ ...ready, billing: { ...ready.billing, quote: { itemCount: 1 } } }).action, 'START');
  assert.equal(resolveCombinedImageAction({ ...ready, billing: { ...ready.billing, quote: { itemCount: 2 } } }).action, 'EXISTING_SUITE');
});
test('a main image must succeed and pass review before the follow-up source translations', () => {
  const base = { ...ready, billing: { ...ready.billing, quote: { itemCount: 1 }, suite: { status: 'SUCCEEDED', slots: [
    { goal: 'sku_hero', status: 'SUCCEEDED', media: { reviewStatus: 'PENDING' } },
  ] } } };
  assert.equal(resolveCombinedImageAction(base).action, 'REVIEW');
  assert.equal(resolveCombinedImageAction({ ...base, billing: { ...base.billing, suite: { ...base.billing.suite,
    slots: [{ goal: 'sku_hero', status: 'SUCCEEDED', media: { reviewStatus: 'APPROVED' } }] } } }).action, 'TRANSLATE');
  assert.equal(resolveCombinedImageAction({ ...base, billing: { ...base.billing, suite: { ...base.billing.suite,
    slots: [{ goal: 'sku_hero', status: 'SUCCEEDED', media: { reviewStatus: 'REJECTED' } }] } } }).action, 'REVIEW');
});
test('uncertain translations and busy operations offer no new mutation or automatic repeat', () => {
  assert.equal(resolveCombinedImageAction({ ...ready, translation: { unknown: true } }).action, 'READ');
  assert.equal(resolveCombinedImageAction({ ...ready, busy: true }).disabled, true);
});

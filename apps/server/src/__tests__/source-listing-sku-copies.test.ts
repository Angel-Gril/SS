import { describe, expect, it } from 'vitest';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { sourceListingEditorSkuKeysForDraft, sourceListingOfferRowsForDraft } from '../services/source-listing-sku-copies.js';

async function copiedDraft() {
  const workflow = createSourceListingWorkflowService({ repository: new InMemoryOzonListingDraftRepository() });
  const source = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods',
    sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['source-red'] });
  return workflow.duplicateSku({ ownerUserId: 'owner', actorUserId: 'owner', draftId: source.id, expectedRevision: source.revision,
    expectedDraftVersion: source.draftVersion, operationKey: 'original-copy-operation', sourceSkuKey: 'source-red' });
}

describe('server-owned copy authority proof', () => {
  it('accepts a complete original owner receipt and preserves canonical legacy rows', async () => {
    const draft = await copiedDraft();
    expect(sourceListingOfferRowsForDraft(draft)).toHaveLength(1);
    expect(sourceListingEditorSkuKeysForDraft(draft)).toEqual(['source-red', draft.offerRows!.rows[0]!.rowKey]);
    expect(sourceListingEditorSkuKeysForDraft({ selectedSkuKeys: ['source-red'] })).toEqual(['source-red']);
    expect(sourceListingOfferRowsForDraft({ selectedSkuKeys: ['source-red'], offerRows: { contractVersion: 'source-listing-offer-rows/v1', rows: [] } })).toEqual([]);
  });

  it.each(['id', 'sourceCaptureSnapshotId', 'sourceCaptureHash', 'revision', 'draftVersion', 'auditEvents'] as const)(
    'rejects copied rows when the draft proof omits %s instead of treating them as authorized', async (field) => {
      const draft = await copiedDraft();
      const partial = { ...draft, [field]: undefined };
      expect(() => sourceListingOfferRowsForDraft(partial)).toThrowError(expect.objectContaining({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID' }));
      expect(() => sourceListingEditorSkuKeysForDraft(partial)).toThrow();
    });

  it.each([
    ['id', ''], ['id', ' padded '], ['sourceCaptureSnapshotId', ''], ['sourceCaptureHash', 'wrong-hash'],
    ['revision', 0], ['revision', 1.5], ['draftVersion', 0], ['draftVersion', -1], ['auditEvents', null], ['auditEvents', {}],
  ])('rejects an invalid full proof field %s=%j before returning copy authority', async (field, value) => {
    const draft = await copiedDraft();
    Object.defineProperty(draft, String(field), { value, configurable: true });
    expect(() => sourceListingOfferRowsForDraft(draft)).toThrowError(expect.objectContaining({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID' }));
  });

  it('refuses forged mapping even when the only omitted proof is its audit array', async () => {
    const draft = await copiedDraft();
    draft.offerRows!.rows[0]!.sourceCaptureSnapshotId = 'foreign-snapshot';
    draft.offerRows!.rows[0]!.sourceCaptureHash = 'f'.repeat(64);
    draft.offerRows!.rows[0]!.sourceDraftVersion = 99;
    const partial = { ...draft, auditEvents: undefined };
    expect(() => sourceListingEditorSkuKeysForDraft(partial)).toThrowError(expect.objectContaining({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID' }));
  });
});

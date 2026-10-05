import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { sourceProductCaptureCanonicalStringify, type OzonListingDraft, type SourceProductCaptureV2Submission } from 'shared';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService, hashOzonListingPublishState } from '../services/source-listing-workflow.js';
import { createSourceListingWorkflowAttributeService } from '../services/source-listing-workflow-attributes.js';
import { createSourceListingAttributeEditorService } from '../services/source-listing-attribute-editor.js';
import { buildSourceProductProfile } from '../services/source-product-profile.js';
import { buildSourceListingAttributeSourceContext } from '../services/source-listing-workflow-source-context.js';
import { compileOzonListingPayload } from '../services/ozon-listing-payload-compiler.js';
import { sourceListingOfferRowsForDraft, sourceListingEditorSkuKeysForDraft } from '../services/source-listing-sku-copies.js';
import { createExtensionListingEditorService } from '../services/extension-listing-editor.js';

const fixture = JSON.parse(readFileSync(new URL('../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json', import.meta.url), 'utf8')) as SourceProductCaptureV2Submission;
async function setup() {
  const capture = structuredClone(fixture.capture), repository = new InMemoryOzonListingDraftRepository();
  const workflow = createSourceListingWorkflowService({ repository });
  const sourceHash = createHash('sha256').update(sourceProductCaptureCanonicalStringify(capture)).digest('hex');
  let draft = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods',
    sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: sourceHash, selectedSkuKeys: ['sku-0'] });
  const context = (value: OzonListingDraft) => ({ ownerUserId: 'owner', actorUserId: 'owner', draftId: value.id, expectedRevision: value.revision });
  draft = await workflow.setCategory({ ...context(draft), category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog' } });
  const schema = { schemaVersion: 'ozon-attribute-schema/v1' as const, shopId: 'shop', descriptionCategoryId: 10, typeId: 20,
    language: 'DEFAULT' as const, definitionSource: 'ozon_api' as const, catalogRevision: 'catalog', definitionsHash: 'b'.repeat(64), fields: [{ attributeId: 20,
      name: 'Цвет', description: '', sourceType: 'String', valueType: 'STRING' as const, cardinality: 'SINGLE' as const,
      required: true, dictionaryId: null, valuePolicy: 'FREE_TEXT' as const, ownership: 'SKU' as const, editorMode: 'SKU_MATRIX' as const,
      aiSuggestionAllowed: false, requiresRussianText: true }] };
  const attributes = createSourceListingWorkflowAttributeService({ loadSchema: async () => schema,
    loadDictionary: async () => ({ complete: true, values: [] }),
    loadSourceContext: async () => ({ ...buildSourceListingAttributeSourceContext({ capture,
      sourceProfile: buildSourceProductProfile({ id: 'goods', title: '商品', sourcePlatform: '1688' }), selectedSkuKeys: ['sku-0'] }),
      allowSourceProfileFallback: false, skuStandards: { 'sku-0': { sourceStandard: { brand: { value: '', isBrandless: false },
        colors: ['红色'], sizes: [], materials: [], gender: { value: '' }, seasons: [], packageDimensionsMm: null, packageWeightG: null,
        categoryHints: [], missingForOzon: [] } } } }),
  });
  draft = await workflow.setAttributeValues({ ...context(draft), values: { '20': { value: 'Красный', source: 'MANUAL', reviewed: true,
    evidence: ['supplier-confirmed'], skuValues: { 'sku-0': { value: 'Красный', source: 'MANUAL', reviewed: true, evidence: ['supplier-confirmed'] } } } } });
  draft = await workflow.setSkuPackaging({ ...context(draft), operationKey: 'copy-source-packaging', expectedDraftVersion: draft.draftVersion,
    items: [{ skuKey: 'sku-0', weightG: 500, lengthMm: 200, widthMm: 100, heightMm: 50 }], evidence: ['operator-measured'] });
  draft = await workflow.setPricing({ ...context(draft), value: { contractVersion: 'ozon-listing-pricing/v1', items: [{ skuKey: 'sku-0',
    price: '100', oldPrice: '120', currencyCode: 'RUB', vat: '0', offerId: 'source-offer' }] } });
  const copy = await workflow.addAiCopyCandidate({ ...context(draft), titleRu: 'Красный товар', descriptionRu: 'Описание товара.', sourcePromptVersion: 'copy-v1' });
  draft = await workflow.applyAiCopyCandidate({ ...context(copy.draft), candidateId: copy.candidate.id, operationKey: 'source-copy-approval' });
  const duplicated = await workflow.duplicateSku({ ...context(draft), expectedDraftVersion: draft.draftVersion, operationKey: 'copy-vertical-operation', sourceSkuKey: 'sku-0' });
  const key = duplicated.offerRows!.rows[0]!.rowKey;
  return { capture, sourceHash, workflow, attributes, context, draft: duplicated, key };
}

describe('copy SKU vertical owner flow', () => {
  it('retains independent copied pricing and packaging at creation, while canonical source selection never changes', async () => {
    const f = await setup();
    expect(f.draft.selectedSkuKeys).toEqual(['sku-0']);
    expect((f.draft.pricing.value as any).items.map((item: any) => item.skuKey)).toEqual(['sku-0', f.key]);
    expect((f.draft.pricing.value as any).items[1].offerId).toBe(f.draft.offerRows!.rows[0]!.offerId);
    expect(f.draft.attributes.values.packaging!.skuValues![f.key]!.value).toEqual({ weightG: 500, lengthMm: 200, widthMm: 100, heightMm: 50 });
  });
  it('exposes thin copied row metadata and accepts per-copy official edits without changing the original SKU', async () => {
    const f = await setup();
    const editor = createExtensionListingEditorService({ workflow: f.workflow, ownership: { assertOwnedTarget: async (input) => ({
      shopId: 'shop', supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: f.sourceHash, selectedSkuKeys: input.selectedSkuKeys }) },
      loadCatalog: async () => ({ revision: 'catalog', entries: [] }) });
    const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: f.draft.id,
      draftRevision: f.draft.revision, draftVersion: f.draft.draftVersion };
    const view = await editor.read({ ownerUserId: 'owner', actorUserId: 'owner', allowedShopIds: ['shop'] }, binding);
    expect(JSON.stringify(view)).not.toMatch(/sourceCaptureHash|sourceDraftRevision|suggestionProvenance|supplier-confirmed/);
    const attributeEditor = createSourceListingAttributeEditorService({ workflow: f.workflow, attributes: f.attributes });
    const attrContext = { draftId: f.draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: f.draft.revision, expectedDraftVersion: f.draft.draftVersion };
    const workspace = await attributeEditor.readWorkspace(attrContext);
    expect(workspace.values.map((item) => item.skuKey)).toEqual(['sku-0', f.key]);
    expect(workspace.values.find((item) => item.skuKey === f.key)?.value).toBe('Красный');
    const saved = await attributeEditor.saveAttributes({ ...attrContext, operationKey: 'copy-row-color-edit', schemaRevision: workspace.schemaRevision,
      changes: [{ attributeId: 20, skuKey: f.key, value: 'Синий', evidence: ['same-source-offer-text-confirmed'] }] });
    expect(saved.attributes.values['20']!.skuValues!['sku-0']!.value).toBe('Красный');
    expect(saved.attributes.values['20']!.skuValues![f.key]!.value).toBe('Синий');
  });
  it('publishes distinct reviewed rows using original capture hash and independent price, attributes, packaging and media', async () => {
    const f = await setup();
    let draft = f.draft;
    draft = await f.workflow.setPricing({ ...f.context(draft), value: { contractVersion: 'ozon-listing-pricing/v1', items: [
      { skuKey: 'sku-0', price: '100', oldPrice: '120', offerId: 'source-offer', currencyCode: 'RUB', vat: '0' },
      { skuKey: f.key, price: '110', oldPrice: '130', offerId: 'copy-offer', currencyCode: 'RUB', vat: '0' },
    ] } });
    draft = await f.workflow.setSkuPackaging({ ...f.context(draft), operationKey: 'copy-final-package', expectedDraftVersion: draft.draftVersion,
      items: [{ skuKey: 'sku-0', weightG: 500, lengthMm: 200, widthMm: 100, heightMm: 50 },
        { skuKey: f.key, weightG: 600, lengthMm: 210, widthMm: 110, heightMm: 60 }], evidence: ['two-offers-same-source-confirmed'] });
    expect(draft.offerRows!.rows[0]!.pricing?.price).toBe('110');
    expect(draft.offerRows!.rows[0]!.offerId).toBe('copy-offer');
    expect(draft.offerRows!.rows[0]!.packaging?.weightG).toBe(600);
    draft = await f.workflow.setMediaAssignments({ ...f.context(draft), assignments: [
      { scope: 'SKU', skuKey: 'sku-0', slotKey: 'sku:sku-0:hero', assetId: 'source-asset', source: 'REVIEWED' },
      { scope: 'SKU', skuKey: f.key, slotKey: `sku:${f.key}:hero`, assetId: 'copy-asset', source: 'REVIEWED' },
    ] });
    const candidate = await f.workflow.addAiCopyCandidate({ ...f.context(draft), titleRu: 'Товар', descriptionRu: 'Описание.', sourcePromptVersion: 'copy-v1' });
    draft = await f.workflow.applyAiCopyCandidate({ ...f.context(candidate.draft), candidateId: candidate.candidate.id, operationKey: 'copy-final-review' });
    const validation = await f.attributes.validateAuthoritative({ ownerUserId: 'owner', draft });
    expect(validation.result.status, JSON.stringify(validation.result.blockers)).toBe('VALID');
    draft = await f.workflow.recordValidationResult({ ...f.context(draft), ...validation.result });
    draft = (await f.workflow.recordPublishIntent({ ...f.context(draft), idempotencyKey: 'copy-vertical-publish-intent' })).draft;
    const { schemaSource: _schema, officialDataFreshness: _freshness, ...report } = draft.validation.report!;
    const payloadDraft = structuredClone(draft); payloadDraft.validation.report = report;
    const result = compileOzonListingPayload({ draft: payloadDraft, capture: f.capture, validationReport: report,
      resolvedImages: { contractVersion: 'ozon-listing-resolved-images/v1', authority: { draftId: draft.id, draftVersion: draft.draftVersion,
        revision: draft.revision, shopId: draft.shopId, sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId, sourceCaptureHash: draft.sourceCaptureHash,
        resolverVersion: 'copy-evidence', resolvedAt: draft.updatedAt }, product: [], bySku: {
          'sku-0': [{ assetId: 'source-asset', url: 'https://cdn.example.com/source.jpg', status: 'VALIDATED_DURABLE' }],
          [f.key]: [{ assetId: 'copy-asset', url: 'https://cdn.example.com/copy.jpg', status: 'VALIDATED_DURABLE' }],
        } } });
    expect(result.payload.items).toHaveLength(2);
    expect(result.payload.items.map((item) => item.offer_id).sort()).toEqual(['copy-offer', 'source-offer']);
    expect(result.authority.sourceCapture.hash).toBe(f.sourceHash);
    expect(f.capture.skus).toHaveLength(1);
    expect(sourceListingEditorSkuKeysForDraft(draft)).toEqual(['sku-0', f.key]);
    const copied = result.payload.items.find((item) => item.offer_id === 'copy-offer')!;
    expect(copied).toMatchObject({ price: '110', weight: 600, images: ['https://cdn.example.com/copy.jpg'] });
  });
  it('rejects corrupted copy provenance and changes publish hash for copied rows', async () => {
    const f = await setup(); const originalHash = hashOzonListingPublishState(f.draft);
    const altered = structuredClone(f.draft); altered.offerRows!.rows[0]!.offerId = 'changed-copy-offer';
    expect(hashOzonListingPublishState(altered)).not.toBe(originalHash);
    const bad = structuredClone(f.draft); bad.offerRows!.rows[0]!.sourceCaptureHash = 'f'.repeat(64);
    expect(() => sourceListingOfferRowsForDraft(bad)).toThrow();
    const foreign = structuredClone(f.draft); foreign.offerRows!.rows[0]!.rowKey = 'listing-copy:forged';
    expect(() => sourceListingOfferRowsForDraft(foreign)).toThrow();
  });
  it('removes only the copied offer and its current row fields through a replayable CAS without deleting source facts or assets', async () => {
    const f = await setup();
    const input = { ...f.context(f.draft), expectedDraftVersion: f.draft.draftVersion, operationKey: 'remove-copy-operation', rowKey: f.key };
    const removed = await f.workflow.removeSkuCopy(input);
    expect(removed.offerRows).toBeUndefined();
    expect(removed.selectedSkuKeys).toEqual(['sku-0']);
    expect((removed.pricing.value as any).items.map((item: any) => item.skuKey)).toEqual(['sku-0']);
    expect(removed.attributes.values['20']!.skuValues).not.toHaveProperty(f.key);
    expect(removed.attributes.values.packaging!.skuValues).not.toHaveProperty(f.key);
    expect(removed.grantRevocation.required).toBe(true);
    expect(await f.workflow.removeSkuCopy(input)).toEqual(removed);
    await expect(f.workflow.removeSkuCopy({ ...input, rowKey: 'sku-0', operationKey: 'cannot-remove-source' })).rejects.toMatchObject({ statusCode: 409 });
    const historic = await f.workflow.getDraftVersion({ ownerUserId: 'owner', draftId: f.draft.id, draftVersion: f.draft.draftVersion });
    expect(historic.offerRows!.rows[0]!.rowKey).toBe(f.key);
  });
});

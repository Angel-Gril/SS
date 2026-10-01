import { describe, expect, it, vi } from 'vitest';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createSourceListingCopyEditorService } from '../services/source-listing-copy-editor.js';
import { createSourceListingWorkflowAttributeService } from '../services/source-listing-workflow-attributes.js';
import { createSourceListingAttributeEditorService } from '../services/source-listing-attribute-editor.js';
import { buildSourceProductProfile } from '../services/source-product-profile.js';
import { OZON_V3_IMPORT_PACKAGE_CONTRACT } from '../services/ozon-v3-import-package-contract.js';

async function setup() {
  const repository = new InMemoryOzonListingDraftRepository();
  const workflow = createSourceListingWorkflowService({ repository });
  const draft = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods',
    sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['sku'] });
  const context = { draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: draft.revision, expectedDraftVersion: draft.draftVersion };
  return { repository, workflow, draft, context, editor: createSourceListingCopyEditorService({ workflow }) };
}
function rebound(context: Awaited<ReturnType<typeof setup>>['context'], draft: Awaited<ReturnType<typeof setup>>['draft']) {
  return { ...context, expectedRevision: draft.revision, expectedDraftVersion: draft.draftVersion };
}
describe('manual copy editor', () => {
  it('rejects missing operation keys instead of falling back to the legacy candidate path', async () => {
    const { editor, context, workflow } = await setup();
    await expect(editor.create({ ...context, operationKey: undefined as unknown as string, titleRu: 'Товар' }))
      .rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID' });
    expect((await workflow.getDraft({ draftId: context.draftId, ownerUserId: 'owner' })).copy.candidates).toHaveLength(0);
  });
  it('creates a reviewed-source candidate but changes publish text only after explicit approval', async () => {
    const { editor, context, workflow } = await setup();
    const created = await editor.create({ ...context, operationKey: 'copy-create-123', titleRu: '  Коробка   для хранения ', descriptionRu: 'Описание коробки.' });
    expect(created.draft.copy.publishTitleRu).toBeNull();
    const read = await editor.read(rebound(context, created.draft));
    expect(read).toMatchObject({ titleRu: null, descriptionRu: null, pendingCandidates: [{ id: created.candidateId,
      titleRu: 'Коробка для хранения', descriptionRu: 'Описание коробки.', sourceCurrent: true }] });
    expect(JSON.stringify(read)).not.toMatch(/generation|provider|createdByUserId|sourcePromptVersion|sourceCaptureHash/);
    const approved = await editor.approve({ ...rebound(context, created.draft), candidateId: created.candidateId, operationKey: 'copy-approve-123' });
    expect(approved.copy.publishTitleRu).toBe('Коробка для хранения');
    const replay = await editor.approve({ ...rebound(context, created.draft), candidateId: created.candidateId, operationKey: 'copy-approve-123' });
    expect(replay.revision).toBe(approved.revision);
    expect((await workflow.getDraft({ draftId: context.draftId, ownerUserId: 'owner' })).copy.applyAudit).toHaveLength(1);
  });
  it('rejects invalid publish copy and attempts to supply server metadata before creating a candidate', async () => {
    const { editor, context, workflow } = await setup();
    for (const value of [
      { titleRu: '中文名称' }, { titleRu: 'English only' }, { titleRu: 'Я'.repeat(501) },
      { titleRu: 'Товар', descriptionRu: 'Ж'.repeat(10001) }, { titleRu: 'Товар', descriptionRu: '含有汉字' },
      { titleRu: 'Товар', kind: 'AI_GENERATED' }, { titleRu: 'Товар', sourcePromptVersion: 'forged' },
    ]) await expect(editor.create({ ...context, operationKey: 'copy-create-123', ...value })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID' });
    expect((await workflow.getDraft({ draftId: context.draftId, ownerUserId: 'owner' })).copy.candidates).toHaveLength(0);
    const nullable = await editor.create({ ...context, operationKey: 'copy-null-desc-123', titleRu: 'Товар', descriptionRu: null });
    expect(nullable.draft.copy.candidates[0]!.descriptionRu).toBeNull();
  });
  it('keeps old long descriptions visible without truncation and refuses old-source candidate approval', async () => {
    const { workflow, context, editor } = await setup();
    const legacy = await workflow.addAiCopyCandidate({ ...context, titleRu: 'Товар', descriptionRu: 'Ж'.repeat(20000), sourcePromptVersion: 'legacy-copy' });
    const read = await editor.read(rebound(context, legacy.draft));
    expect(read.pendingCandidates[0]!.descriptionRu).toHaveLength(20000);
    const replaced = await workflow.replaceSourceSnapshot({ ...rebound(context, legacy.draft), sourceCaptureSnapshotId: 'new-snapshot', sourceCaptureHash: 'f'.repeat(64) });
    const stale = await editor.read(rebound(context, replaced));
    expect(stale.pendingCandidates[0]!.sourceCurrent).toBe(false);
    await expect(editor.approve({ ...rebound(context, replaced), candidateId: legacy.candidate.id, operationKey: 'copy-approve-123' }))
      .rejects.toMatchObject({ code: 'OZON_LISTING_AI_CANDIDATE_STALE' });
  });
  it('requires editing a legacy non-canonical title instead of approving text the compiler will reject', async () => {
    const { workflow, context, editor } = await setup();
    const legacy = await workflow.addAiCopyCandidate({ ...context, titleRu: 'Товар  для дома', sourcePromptVersion: 'legacy-copy' });
    await expect(editor.approve({ ...rebound(context, legacy.draft), candidateId: legacy.candidate.id, operationKey: 'copy-approve-123' }))
      .rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID' });
  });
  it('does not allow a foreign owner or stale revision to read and approve text', async () => {
    const { editor, context } = await setup();
    await expect(editor.read({ ...context, ownerUserId: 'foreign' })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_NOT_FOUND' });
    const created = await editor.create({ ...context, operationKey: 'copy-create-123', titleRu: 'Товар' });
    await expect(editor.approve({ ...context, candidateId: created.candidateId, operationKey: 'copy-approve-123' }))
      .rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT' });
  });
  it('records readiness only from the injected real attribute authority and rejects a schema mismatch', async () => {
    const { workflow, context, repository } = await setup();
    let current = await workflow.setCategory({ ...context, category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog' } });
    current = await workflow.setPricing({ ...rebound(context, current), value: { contractVersion: 'ozon-listing-pricing/v1', items: [
      { skuKey: 'sku', price: '100', oldPrice: '120', currencyCode: 'CNY', vat: '0' },
    ] } });
    current = await workflow.setMediaAssignments({ ...rebound(context, current), assignments: [{ scope: 'PRODUCT', slotKey: 'product-main', assetId: 'asset', source: 'SOURCE' }] });
    const attributes = createSourceListingWorkflowAttributeService({ loadSchema: async () => ({ schemaVersion: 'ozon-attribute-schema/v1',
      shopId: 'shop', descriptionCategoryId: 10, typeId: 20, language: 'DEFAULT', catalogRevision: 'catalog', definitionsHash: 'b'.repeat(64), definitionSource: 'ozon_api', fields: [] }),
    loadSourceContext: async () => ({ sourceProfile: buildSourceProductProfile({ id: 'goods', title: '商品', sourcePlatform: '1688', sourceProductId: 'source-product' }),
      operationalFacts: { packageWeightG: 100, packageLengthMm: 40, packageWidthMm: 30, packageHeightMm: 20,
        selectedStock: { known: 1, unknown: 0 }, shippingCny: 0, evidence: {}, requirements: { packageWeightForImport: true,
          packageDimensionsForImport: true, importContract: { contractId: OZON_V3_IMPORT_PACKAGE_CONTRACT.contractId,
            contractRevision: OZON_V3_IMPORT_PACKAGE_CONTRACT.revision, contractHash: OZON_V3_IMPORT_PACKAGE_CONTRACT.contractHash } } } }),
    loadDictionary: async () => ({ complete: true, values: [] }) });
    const attributeEditor = createSourceListingAttributeEditorService({ workflow, attributes });
    const validateAttributes = vi.fn(attributeEditor.validateAttributes);
    const editor = createSourceListingCopyEditorService({ workflow, validateAttributes });
    const workspace = await attributeEditor.readWorkspace(rebound(context, current));
    const blocked = await editor.validate({ ...rebound(context, current), schemaRevision: workspace.schemaRevision, operationKey: 'validation-blocked-123' });
    expect(blocked.validation.status).toBe('INVALID');
    expect(blocked.blockers).toContainEqual(expect.objectContaining({ code: 'OZON_LISTING_COPY_INVALID' }));
    const created = await editor.create({ ...rebound(context, blocked), operationKey: 'copy-create-123', titleRu: 'Товар', descriptionRu: null });
    const approved = await editor.approve({ ...rebound(context, created.draft), operationKey: 'copy-approve-123', candidateId: created.candidateId });
    await expect(editor.validate({ ...rebound(context, approved), schemaRevision: 'f'.repeat(64), operationKey: 'validation-ready-123' })).rejects.toMatchObject({ code: 'OZON_ATTRIBUTE_SCHEMA_MISMATCH' });
    const request = { ...rebound(context, approved), schemaRevision: workspace.schemaRevision, operationKey: 'validation-ready-123' };
    const callsBefore = validateAttributes.mock.calls.length;
    const [ready, concurrent] = await Promise.all([editor.validate(request), editor.validate(request)]);
    expect(ready).toMatchObject({ stage: 'READY_TO_PUBLISH', validation: { status: 'VALID' }, blockers: [] });
    expect(Object.values(ready.freshness).map((item) => item.state)).toEqual(Array(6).fill('CURRENT'));
    expect(concurrent.revision).toBe(ready.revision);
    expect(validateAttributes).toHaveBeenCalledTimes(callsBefore + 1);
    const restarted = createSourceListingCopyEditorService({ workflow: createSourceListingWorkflowService({ repository }), validateAttributes });
    const replay = await restarted.validate(request);
    expect(replay.revision).toBe(ready.revision);
    expect(validateAttributes).toHaveBeenCalledTimes(callsBefore + 1);
    expect(replay.auditEvents.filter((event) => event.type === 'VALIDATION_RECORDED')).toHaveLength(2);
    await expect(restarted.validate({ ...request, schemaRevision: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT' });
    expect(validateAttributes).toHaveBeenCalledTimes(callsBefore + 1);
    const forged = { ...rebound(context, ready), schemaRevision: workspace.schemaRevision, operationKey: 'validation-forged-123', status: 'VALID' };
    await expect(editor.validate(forged))
      .rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID' });
    await workflow.replaceSourceSnapshot({ ...rebound(context, ready), sourceCaptureSnapshotId: 'new-snapshot', sourceCaptureHash: 'f'.repeat(64) });
    await expect(restarted.validate(request)).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT' });
    expect(validateAttributes).toHaveBeenCalledTimes(callsBefore + 1);
  });
});

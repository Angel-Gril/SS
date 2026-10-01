import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createExtensionListingEditorService } from '../services/extension-listing-editor.js';
import { extensionListingEditorRoutes } from '../routes/extension-listing-editor.js';
import { createSourceListingAttributeEditorService } from '../services/source-listing-attribute-editor.js';
import { createSourceListingWorkflowAttributeService } from '../services/source-listing-workflow-attributes.js';
import { buildSourceProductProfile } from '../services/source-product-profile.js';
import { createSourceListingCopyEditorService } from '../services/source-listing-copy-editor.js';

async function setup(scopes = ['listing:review', 'listing:write'], allowedShopIds = ['shop'], selectedSkuKeys = ['sku']) {
  const workflow = createSourceListingWorkflowService({ repository: new InMemoryOzonListingDraftRepository() });
  const draft = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys });
  const attributes = createSourceListingWorkflowAttributeService({
    loadSchema: async () => ({ schemaVersion: 'ozon-attribute-schema/v1', shopId: 'shop', descriptionCategoryId: 10, typeId: 20,
      language: 'DEFAULT', catalogRevision: 'catalog-1', definitionsHash: 'b'.repeat(64), fields: [
        { attributeId: 10, name: 'Материал', description: '', sourceType: 'String', valueType: 'STRING', cardinality: 'SINGLE',
          required: false, dictionaryId: null, valuePolicy: 'FREE_TEXT', ownership: 'EDITOR', editorMode: 'EDITABLE', aiSuggestionAllowed: false },
        { attributeId: 20, name: 'Цвет', description: '', sourceType: 'String', valueType: 'STRING', cardinality: 'MULTI',
          required: false, dictionaryId: 200, valuePolicy: 'STRICT_DICTIONARY', ownership: 'SKU', editorMode: 'SKU_MATRIX', aiSuggestionAllowed: false },
      ] }),
    loadSourceContext: async () => ({ sourceProfile: buildSourceProductProfile({ id: 'goods', title: '商品', sourcePlatform: '1688', sourceProductId: 'source-product' }) }),
    loadDictionary: async () => ({ complete: true, source: 'ozon_api', values: [{ id: 201, value: 'Красный' }, { id: 202, value: 'Синий' }] }),
  });
  const service = createExtensionListingEditorService({ workflow,
    attributesEditor: createSourceListingAttributeEditorService({ workflow, attributes }),
    copyEditor: createSourceListingCopyEditorService({ workflow,
      validateAttributes: createSourceListingAttributeEditorService({ workflow, attributes }).validateAttributes }),
    ownership: { assertOwnedTarget: async () => ({ shopId: 'shop', supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['sku'] }) },
    loadCatalog: async () => ({ revision: 'catalog-1', entries: [{ descriptionCategoryId: 10, typeId: 20, categoryNameRu: 'Одежда', typeNameRu: 'Футболка', categoryNameZh: '服装', typeNameZh: '上衣', selectable: true }] }),
  });
  const app = Fastify();
  await app.register(extensionListingEditorRoutes, { prefix: '/api/extension-device/source-workbench', service,
    featureFlags: { evaluate: async () => ({ enabled: true, reason: 'pilot_match', listingStage: 'dual_read' }) },
    authenticateDevice: async (request) => { (request as any).device = { ownerUserId: 'owner', actorUserId: 'owner', sessionId: 'device', scopes, allowedShopIds }; },
  });
  const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: draft.id, draftRevision: 1, draftVersion: 1 };
  return { app, workflow, draft, binding };
}
function pricing() {
  return { contractVersion: 'ozon-listing-pricing/v1', items: [{ skuKey: 'sku', price: '100', oldPrice: '120', offerId: 'SS-1', currencyCode: 'CNY', vat: '0' }] };
}
describe('extension listing editor owner', () => {
  it('records real readiness blockers and refuses caller-supplied VALID reports', async () => {
    const fixture = await setup();
    const category = await fixture.workflow.setCategory({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id,
      expectedRevision: 1, category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' } });
    const binding = { ...fixture.binding, draftRevision: category.revision, draftVersion: category.draftVersion };
    try {
      const schema = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/attributes', payload: { binding } });
      const payload = { binding, operationKey: 'listing-validation-test-1', action: 'VALIDATE', value: { schemaRevision: schema.json().data.schemaRevision } };
      const invalid = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: {
        ...payload, value: { ...payload.value, status: 'VALID', report: { forged: true } },
      } });
      expect(invalid.statusCode).toBe(400);
      const validated = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload });
      expect(validated.statusCode).toBe(200);
      expect(validated.json().data.validation.status).toBe('INVALID');
      expect(validated.json().data.blockers.length).toBeGreaterThan(0);
      const replay = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);
      expect(replay.json().data.binding.draftRevision).toBe(validated.json().data.binding.draftRevision);
    } finally { await fixture.app.close(); }
  });
  it('keeps manual copy pending until explicit approval and supports exact create/approval replay', async () => {
    const fixture = await setup();
    const create = { binding: fixture.binding, operationKey: 'manual-copy-create-1', action: 'COPY_CANDIDATE',
      value: { titleRu: 'Коробка для хранения', descriptionRu: 'Практичная коробка.' } };
    try {
      const candidate = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: create });
      expect(candidate.statusCode).toBe(200);
      expect(candidate.json().data.copy.titleRu).toBeNull();
      const replay = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: create });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().candidateId).toBe(candidate.json().candidateId);
      expect(replay.json().replayed).toBe(true);
      const approve = { binding: candidate.json().data.binding, operationKey: 'manual-copy-approve-1', action: 'COPY_APPROVE',
        value: { candidateId: candidate.json().candidateId } };
      const approved = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: approve });
      expect(approved.statusCode).toBe(200);
      expect(approved.json().data.copy.titleRu).toBe(create.value.titleRu);
      const approvedReplay = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: approve });
      expect(approvedReplay.statusCode).toBe(200);
      expect(approvedReplay.json().replayed).toBe(true);
      expect(approvedReplay.json().data.binding.draftRevision).toBe(approved.json().data.binding.draftRevision);
    } finally { await fixture.app.close(); }
  });
  it('reads official attribute schema and IDs, saves through the real owner and replays the accepted operation', async () => {
    const fixture = await setup();
    const category = await fixture.workflow.setCategory({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id,
      expectedRevision: 1, category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' } });
    const binding = { ...fixture.binding, draftRevision: category.revision, draftVersion: category.draftVersion };
    try {
      const workspace = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/attributes', payload: { binding } });
      expect(workspace.statusCode).toBe(200);
      expect(workspace.json().data.fields[1].maxValues).toBe(100);
      const schemaRevision = workspace.json().data.schemaRevision;
      const dictionary = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/dictionary',
        payload: { binding, schemaRevision, attributeId: 20, query: '', limit: 10 } });
      expect(dictionary.statusCode).toBe(200);
      expect(dictionary.json().data.values).toEqual([{ id: 201, value: 'Красный' }, { id: 202, value: 'Синий' }]);
      const payload = { binding, operationKey: 'official-attributes-test-1', action: 'ATTRIBUTES', value: { schemaRevision,
        changes: [{ attributeId: 10, action: 'SET', value: 'Полипропилен', evidence: ['用户确认材质标识'] }] } };
      const saved = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload });
      expect(saved.statusCode).toBe(200);
      const replay = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);
      expect(replay.json().data.binding.draftRevision).toBe(saved.json().data.binding.draftRevision);
      expect(JSON.stringify(workspace.json())).not.toMatch(/sourceProfile|suggestions|provenance|ownerUserId/);
    } finally { await fixture.app.close(); }
  });
  it('keeps the editor readable so stale pricing and packaging can be repaired after SKU selection changes', async () => {
    const fixture = await setup(undefined, undefined, ['sku', 'sku2']);
    const priced = await fixture.workflow.setPricing({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id,
      expectedRevision: 1, value: { ...pricing(), items: [pricing().items[0], { ...pricing().items[0], skuKey: 'sku2', offerId: 'SS-2' }] } });
    const packed = await fixture.workflow.setSkuPackaging({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id,
      expectedRevision: priced.revision, expectedDraftVersion: priced.draftVersion, operationKey: 'packaging-before-selection',
      items: ['sku', 'sku2'].map((skuKey) => ({ skuKey, weightG: 100, lengthMm: 10, widthMm: 20, heightMm: 30 })), evidence: ['用户确认包装'] });
    const changed = await fixture.workflow.changeSkuSelection({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id,
      expectedRevision: packed.revision, selectedSkuKeys: ['sku'] });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/read', payload: {
        binding: { ...fixture.binding, draftRevision: changed.revision, draftVersion: changed.draftVersion },
      } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.pricing).toBeNull();
      expect(response.json().data.packaging).toEqual([]);
      expect(response.json().data.fieldIssues.map((item: { field: string }) => item.field)).toEqual(['PRICING', 'PACKAGING']);
      expect(response.json().data.freshness.validation).toBe('STALE');
      expect((await fixture.workflow.getDraft({ ownerUserId: 'owner', draftId: fixture.draft.id })).revision).toBe(changed.revision);
    } finally { await fixture.app.close(); }
  });
  it('saves exact selected-SKU packaging through the device route and replays without another revision', async () => {
    const { app, binding } = await setup();
    const payload = { binding, operationKey: 'packaging-operation-1', action: 'PACKAGING', value: {
      items: [{ skuKey: 'sku', weightG: 200, lengthMm: 150, widthMm: 120, heightMm: 90 }],
      evidence: ['用户确认实测包装，单位克与毫米'],
    } };
    try {
      const first = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload });
      expect(first.statusCode).toBe(200);
      expect(first.json().data.packaging).toEqual(payload.value.items);
      const replay = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);
      expect(replay.json().data.binding.draftRevision).toBe(first.json().data.binding.draftRevision);
    } finally { await app.close(); }
  });
  it('rejects foreign SKU, caller-owned review flags and missing write permission for packaging', async () => {
    const fixture = await setup();
    const payload = { binding: fixture.binding, operationKey: 'packaging-operation-1', action: 'PACKAGING', value: {
      items: [{ skuKey: 'sku', weightG: 200, lengthMm: 150, widthMm: 120, heightMm: 90 }], evidence: ['用户确认实测包装'],
    } };
    try {
      for (const items of [[{ ...payload.value.items[0], skuKey: 'another' }],
        [{ ...payload.value.items[0], reviewed: true }], [{ ...payload.value.items[0], weightG: 0 }]]) {
        const rejected = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: {
          ...payload, value: { ...payload.value, items },
        } });
        expect(rejected.statusCode).toBe(400);
      }
      expect((await fixture.workflow.getDraft({ ownerUserId: 'owner', draftId: fixture.draft.id })).revision).toBe(1);
    } finally { await fixture.app.close(); }
    const noWrite = await setup(['listing:review']);
    try {
      const response = await noWrite.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save',
        payload: { ...payload, binding: noWrite.binding } });
      expect(response.statusCode).toBe(403);
    } finally { await noWrite.app.close(); }
  });
  it('projects ordered server-bound media and readiness without internal reports or receipts', async () => {
    const { app, binding, workflow, draft } = await setup();
    const updated = await workflow.setMediaAssignments({ ownerUserId: 'owner', actorUserId: 'owner', draftId: draft.id,
      expectedRevision: draft.revision, assignments: [
        { scope: 'PRODUCT', slotKey: 'product-main', assetId: 'asset-main', source: 'SOURCE' },
        { scope: 'SKU', skuKey: 'sku', slotKey: 'hero', assetId: 'asset-hero', source: 'GENERATED' },
      ] });
    try {
      const response = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/read', payload: {
        binding: { ...binding, draftRevision: updated.revision, draftVersion: updated.draftVersion },
      } });
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.mediaAssignments).toEqual([
        { scope: 'PRODUCT', skuKey: null, slotKey: 'product-main', assetId: 'asset-main' },
        { scope: 'SKU', skuKey: 'sku', slotKey: 'hero', assetId: 'asset-hero' },
      ]);
      expect(data.stage).toBe(updated.stage);
      expect(data.validation).toEqual({ status: 'STALE' });
      expect(data.freshness.media).toBe('CURRENT');
      expect(JSON.stringify(data)).not.toMatch(/auditEvents|ownerUserId|sourceCaptureHash|storageKey|grantToken/);
    } finally { await app.close(); }
  });
  it('reads selected SKUs and draft fields with no owner, credentials or audit receipt details', async () => {
    const { app, binding } = await setup();
    const response = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/read', payload: { binding } });
    expect(response.statusCode).toBe(200);
    expect(response.json().data.selectedSkuKeys).toEqual(['sku']);
    expect(JSON.stringify(response.json())).not.toMatch(/ownerUserId|sourceCaptureHash|auditEvents/);
    await app.close();
  });
  it('saves pricing through the existing draft owner and supports exact replay', async () => {
    const { app, binding } = await setup();
    const payload = { binding, operationKey: 'editor-test-1', action: 'PRICING', value: pricing() };
    const first = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload });
    expect(first.statusCode).toBe(200);
    expect(first.json().data.binding.draftRevision).toBe(2);
    const replay = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload });
    expect(replay.statusCode).toBe(200);
    expect(replay.json().replayed).toBe(true);
    expect(replay.json().data.binding.draftRevision).toBe(2);
    await app.close();
  });
  it('uses official catalog IDs/names and advances the normal category state', async () => {
    const { app, binding } = await setup();
    const catalog = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/catalog', payload: { binding, query: '上衣' } });
    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().data.entries[0].typeId).toBe(20);
    const saved = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: { binding, operationKey: 'category-test-1', action: 'CATEGORY', value: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' } } });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().data.category.typeName).toBe('Футболка');
    expect(saved.json().data.binding.draftVersion).toBe(2);
    await app.close();
  });
  it.each([
    [['listing:review'], ['shop'], 403],
    [['listing:review', 'listing:write'], ['another'], 403],
  ])('requires existing write scope and exact device shop grants', async (scopes, shops, code) => {
    const { app, binding, workflow, draft } = await setup(scopes as string[], shops as string[]);
    const response = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: { binding, operationKey: 'editor-test-1', action: 'PRICING', value: pricing() } });
    expect(response.statusCode).toBe(code);
    expect((await workflow.getDraft({ draftId: draft.id, ownerUserId: 'owner' })).revision).toBe(1);
    await app.close();
  });
  it('rejects foreign snapshots, stale revisions and forged identity fields', async () => {
    const { app, binding } = await setup();
    for (const payload of [{ binding: { ...binding, snapshotId: 'other' } }, { binding: { ...binding, draftRevision: 9 } }, { binding, ownerUserId: 'forged' }]) {
      const response = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/read', payload });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    }
    await app.close();
  });
  it('rejects unknown pricing SKUs and catalog revisions without mutating the draft', async () => {
    const { app, binding, workflow, draft } = await setup();
    for (const fields of [
      { action: 'PRICING', value: { ...pricing(), items: [{ ...pricing().items[0], skuKey: 'foreign' }] } },
      { action: 'CATEGORY', value: { categoryId: 10, typeId: 20, catalogRevision: 'stale' } },
    ]) {
      const response = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: { binding, operationKey: 'editor-test-1', ...fields } });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
    }
    expect((await workflow.getDraft({ draftId: draft.id, ownerUserId: 'owner' })).revision).toBe(1);
    await app.close();
  });
  it('binds exact replay to the original draft version as well as revision', async () => {
    const { app, binding } = await setup();
    const payload = { binding, operationKey: 'editor-version-test', action: 'PRICING', value: pricing() };
    expect((await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload })).statusCode).toBe(200);
    const response = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: { ...payload, binding: { ...binding, draftVersion: 99 } } });
    expect(response.statusCode).toBe(409);
    await app.close();
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { OzonNormalizedAttributeSchema } from 'shared';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createSourceListingWorkflowAttributeService } from '../services/source-listing-workflow-attributes.js';
import { createSourceListingAttributeEditorService } from '../services/source-listing-attribute-editor.js';
import { buildSourceProductProfile } from '../services/source-product-profile.js';

async function setup() {
  const repository = new InMemoryOzonListingDraftRepository();
  const workflow = createSourceListingWorkflowService({ repository });
  const created = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop',
    supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['small', 'large'] });
  const draft = await workflow.setCategory({ draftId: created.id, ownerUserId: 'owner', actorUserId: 'owner',
    expectedRevision: created.revision, category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog' } });
  const schema: OzonNormalizedAttributeSchema = { schemaVersion: 'ozon-attribute-schema/v1', shopId: 'shop',
    descriptionCategoryId: 10, typeId: 20, language: 'DEFAULT', catalogRevision: 'catalog', definitionsHash: 'b'.repeat(64), fields: [
      { attributeId: 10, name: 'Материал', description: 'Internal description', sourceType: 'String', valueType: 'STRING',
        cardinality: 'SINGLE', required: false, dictionaryId: null, valuePolicy: 'FREE_TEXT', ownership: 'EDITOR',
        editorMode: 'EDITABLE', aiSuggestionAllowed: false },
      { attributeId: 20, name: 'Цвет', description: '', sourceType: 'String', valueType: 'STRING', cardinality: 'MULTI',
        required: false, dictionaryId: 200, valuePolicy: 'STRICT_DICTIONARY', ownership: 'SKU', editorMode: 'SKU_MATRIX', aiSuggestionAllowed: false },
      { attributeId: 30, name: 'System field', description: '', sourceType: 'String', valueType: 'STRING', cardinality: 'SINGLE',
        required: false, dictionaryId: null, valuePolicy: 'FREE_TEXT', ownership: 'SYSTEM', editorMode: 'READ_ONLY', aiSuggestionAllowed: false },
    ] };
  const loadSchema = vi.fn(async (_input: { freshness: string }) => schema);
  const attributes = createSourceListingWorkflowAttributeService({ loadSchema,
    loadSourceContext: async () => ({ sourceProfile: buildSourceProductProfile({ id: 'goods', title: '商品', sourcePlatform: '1688', sourceProductId: 'source-product' }) }),
    loadDictionary: async () => ({ complete: true, source: 'ozon_api', values: [{ id: 201, value: 'Красный' }, { id: 202, value: 'Синий' }] }),
  });
  const prepare = vi.spyOn(attributes, 'prepareManualValues');
  const editor = createSourceListingAttributeEditorService({ workflow, attributes });
  const binding = { draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: draft.revision, expectedDraftVersion: draft.draftVersion };
  const workspace = await editor.readWorkspace(binding);
  const input = { ...binding, operationKey: 'attributes-save-123', schemaRevision: workspace.schemaRevision,
    changes: [{ attributeId: 10, value: 'Полипропилен', evidence: ['owner:supplier-label'] },
      { attributeId: 20, skuKey: 'small', value: ['Красный'], dictionaryValueIds: [201], evidence: ['owner:small'] },
      { attributeId: 20, skuKey: 'large', value: ['Синий'], dictionaryValueIds: [202], evidence: ['owner:large'] }] };
  return { repository, workflow, attributes, prepare, loadSchema, editor, draft, binding, workspace, input, schema };
}

describe('source listing attribute editor authority', () => {
  it('projects only official fields and preserves dictionary IDs and the existing MULTI bound', async () => {
    const { editor, workspace, binding } = await setup();
    expect(Object.keys(workspace).sort()).toEqual(['fields', 'schemaRevision', 'values']);
    expect(workspace.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ attributeId: 10, maxValues: 1 }),
      expect.objectContaining({ attributeId: 20, maxValues: 100 }),
    ]));
    expect(workspace.values).toHaveLength(4);
    const dictionary = await editor.searchDictionary({ ...binding, schemaRevision: workspace.schemaRevision, attributeId: 20, query: '', limit: 20 });
    expect(dictionary.values).toEqual([{ id: 201, value: 'Красный' }, { id: 202, value: 'Синий' }]);
    expect(dictionary.schemaRevision).toBe(workspace.schemaRevision);
    expect(JSON.stringify(workspace)).not.toMatch(/sourceProfile|suggestions|provenance|Internal description/);
  });
  it('persists server-prepared attributes and replays after restart without re-querying official authority', async () => {
    const { editor, input, prepare, loadSchema, repository, attributes } = await setup();
    const first = await editor.saveAttributes(input);
    expect(first.attributes.values['10']).toMatchObject({ value: 'Полипропилен', source: 'MANUAL', reviewed: true });
    expect(first.attributes.values['20']!.skuValues).toMatchObject({
      small: { dictionaryMatches: [{ dictionaryValueId: 201 }] }, large: { dictionaryMatches: [{ dictionaryValueId: 202 }] },
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    const schemaCalls = loadSchema.mock.calls.length;
    loadSchema.mockRejectedValue(new Error('Official authority temporarily unavailable'));
    const restarted = createSourceListingAttributeEditorService({ workflow: createSourceListingWorkflowService({ repository }), attributes });
    expect(await restarted.saveAttributes(input)).toEqual(first);
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(loadSchema).toHaveBeenCalledTimes(schemaCalls);
  });
  it('coalesces simultaneous identical saves and rejects conflicting reuse before preparing again', async () => {
    const { editor, input, prepare } = await setup();
    const [first, second] = await Promise.all([editor.saveAttributes(input), editor.saveAttributes(input)]);
    expect(second).toEqual(first);
    expect(prepare).toHaveBeenCalledTimes(1);
    await expect(editor.saveAttributes({ ...input, changes: [{ ...input.changes[0]!, value: 'Другой материал' }] }))
      .rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT' });
    expect(prepare).toHaveBeenCalledTimes(1);
  });
  it('rejects a stale schema or binding and an unowned draft without storing changes', async () => {
    const { editor, input, workflow, draft } = await setup();
    await expect(editor.saveAttributes({ ...input, schemaRevision: 'f'.repeat(64) })).rejects.toMatchObject({ code: 'OZON_ATTRIBUTE_SCHEMA_MISMATCH' });
    await expect(editor.saveAttributes({ ...input, expectedDraftVersion: draft.draftVersion + 1 })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT' });
    await expect(editor.saveAttributes({ ...input, ownerUserId: 'foreign', actorUserId: 'foreign' })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_NOT_FOUND' });
    expect((await workflow.getDraft({ draftId: draft.id, ownerUserId: 'owner' })).revision).toBe(draft.revision);
  });
  it('keeps official SKU, read-only, cardinality and dictionary rules in the existing attribute owner', async () => {
    const { editor, input, workflow, draft } = await setup();
    for (const changes of [
      [{ attributeId: 20, skuKey: 'foreign', value: ['Красный'], dictionaryValueIds: [201], evidence: ['owner'] }],
      [{ attributeId: 30, value: 'overwrite', evidence: ['owner'] }],
      [{ attributeId: 10, value: ['wrong single cardinality'], evidence: ['owner'] }],
      [{ attributeId: 20, skuKey: 'small', value: ['Красный'], dictionaryValueIds: [999], evidence: ['owner'] }],
    ]) {
      await expect(editor.saveAttributes({ ...input, changes })).rejects.toMatchObject({ statusCode: 422 });
    }
    expect((await workflow.getDraft({ draftId: draft.id, ownerUserId: 'owner' })).revision).toBe(draft.revision);
  });
  it('rejects user review/source flags, empty changes and oversized values before preparation', async () => {
    const { editor, input, prepare } = await setup();
    for (const changes of [[], [{ ...input.changes[0], reviewed: true }], [{ ...input.changes[0], source: 'MANUAL' }],
      [{ ...input.changes[0], confidence: 1 }], [{ ...input.changes[0], value: 'x'.repeat(65 * 1024) }]]) {
      await expect(editor.saveAttributes({ ...input, changes })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID' });
    }
    expect(prepare).not.toHaveBeenCalled();
  });
  it('rejects an official refresh that changes the schema while validating', async () => {
    const { editor, binding, workspace, loadSchema, schema } = await setup();
    loadSchema.mockImplementation(async ({ freshness }) => freshness === 'OFFICIAL_REFRESH_REQUIRED'
      ? { ...schema, definitionsHash: 'f'.repeat(64) } : schema);
    await expect(editor.validateAttributes({ ...binding, schemaRevision: workspace.schemaRevision }))
      .rejects.toMatchObject({ code: 'OZON_ATTRIBUTE_SCHEMA_MISMATCH' });
  });
  it('rejects a schema change between editor workspace and actual manual preparation', async () => {
    const { editor, input, loadSchema, schema, workflow, draft } = await setup();
    let reads = 0;
    loadSchema.mockImplementation(async () => ++reads < 2 ? schema : { ...schema, definitionsHash: 'f'.repeat(64) });
    await expect(editor.saveAttributes(input)).rejects.toMatchObject({ code: 'OZON_ATTRIBUTE_SCHEMA_MISMATCH' });
    expect((await workflow.getDraft({ draftId: draft.id, ownerUserId: 'owner' })).revision).toBe(draft.revision);
  });
});

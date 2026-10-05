import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { OzonListingDraft, OzonNormalizedAttributeSchema, SourceStandardAttributes } from 'shared';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createSourceListingWorkflowAttributeService } from '../services/source-listing-workflow-attributes.js';
import { createSourceListingAttributeEditorService } from '../services/source-listing-attribute-editor.js';
import { createExtensionListingEditorService } from '../services/extension-listing-editor.js';
import { extensionListingEditorRoutes } from '../routes/extension-listing-editor.js';
import { buildSourceProductProfile } from '../services/source-product-profile.js';

const prefix = '/api/extension-device/source-workbench/editor';
const identity = { ownerUserId: 'owner', actorUserId: 'owner', allowedShopIds: ['shop'] };
function standard(colors: string[] = [], materials: string[] = []): SourceStandardAttributes {
  return { brand: { value: '', isBrandless: false }, colors, sizes: [], materials, gender: { value: '' }, seasons: [],
    packageDimensionsMm: null, packageWeightG: null, categoryHints: [], missingForOzon: [] };
}
function bindingFor(draft: OzonListingDraft) {
  return { snapshotId: draft.sourceCaptureSnapshotId, supplyGoodsId: draft.supplyGoodsId, shopId: draft.shopId,
    listingWorkflowId: draft.id, draftRevision: draft.revision, draftVersion: draft.draftVersion };
}
async function setup(options: { scopes?: string[]; shops?: string[]; owner?: string; actor?: string; enabled?: boolean;
  mixedColors?: boolean; missingAttributes?: boolean } = {}) {
  const repository = new InMemoryOzonListingDraftRepository();
  const workflow = createSourceListingWorkflowService({ repository });
  const created = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods',
    sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['red', 'blue'] });
  const draft = await workflow.setCategory({ draftId: created.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: created.revision,
    category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog' } });
  const schema: OzonNormalizedAttributeSchema = { schemaVersion: 'ozon-attribute-schema/v1', shopId: 'shop',
    descriptionCategoryId: 10, typeId: 20, language: 'DEFAULT', catalogRevision: 'catalog', definitionsHash: 'b'.repeat(64), fields: [
      { attributeId: 10, name: 'Материал', description: '', sourceType: 'String', valueType: 'STRING', cardinality: 'SINGLE', required: false,
        dictionaryId: null, valuePolicy: 'FREE_TEXT', ownership: 'EDITOR', editorMode: 'EDITABLE', aiSuggestionAllowed: false },
      { attributeId: 20, name: 'Цвет', description: '', sourceType: 'String', valueType: 'STRING', cardinality: 'MULTI', required: true,
        dictionaryId: 200, valuePolicy: 'STRICT_DICTIONARY', ownership: 'SKU', editorMode: 'SKU_MATRIX', aiSuggestionAllowed: false },
      { attributeId: 30, name: 'Сертификат', description: '', sourceType: 'String', valueType: 'STRING', cardinality: 'SINGLE', required: false,
        dictionaryId: null, valuePolicy: 'FREE_TEXT', ownership: 'COMPLIANCE', editorMode: 'MANUAL_REQUIRED', aiSuggestionAllowed: false },
      { attributeId: 40, name: 'Вес упаковки', description: '', sourceType: 'Integer', valueType: 'INTEGER', cardinality: 'SINGLE', required: false,
        dictionaryId: null, valuePolicy: 'FREE_TEXT', ownership: 'EDITOR', editorMode: 'MANUAL_REQUIRED', aiSuggestionAllowed: false },
    ] };
  const sourceContext = { sourceProfile: buildSourceProductProfile({ id: 'goods', title: '商品', sourcePlatform: '1688' }),
    allowSourceProfileFallback: false, sourceStandard: standard([], ['Полипропилен']),
    skuStandards: { red: { sourceStandard: standard(options.mixedColors ? ['红色', '未知色'] : ['红色']) },
      blue: { sourceStandard: standard(['蓝色']) }, unselected: { sourceStandard: standard(['绿色']) } },
    aiCandidates: [{ attributeId: 30, value: 'forged-certification', confidence: 1, evidence: ['forged'] },
      { attributeId: 40, value: 100, confidence: 1, evidence: ['forged'] }],
  };
  const loadSchema = vi.fn(async () => schema);
  const loadSourceContext = vi.fn(async () => sourceContext);
  const loadDictionary = vi.fn(async () => ({ complete: true, source: 'ozon_api' as const,
    values: [{ id: 201, value: 'Красный' }, { id: 202, value: 'Синий' }] }));
  const attributes = createSourceListingWorkflowAttributeService({ loadSchema, loadSourceContext, loadDictionary,
    dictionaryAliases: ({ value }) => value === '红色' ? ['Красный'] : value === '蓝色' ? ['Синий'] : [value] });
  const prepare = vi.spyOn(attributes, 'prepareSuggestedValues');
  const createEditor = (currentWorkflow = workflow) => createExtensionListingEditorService({ workflow: currentWorkflow,
    ...(options.missingAttributes ? {} : { attributesEditor: createSourceListingAttributeEditorService({ workflow: currentWorkflow, attributes }) }),
    ownership: { assertOwnedTarget: async (input) => ({ shopId: input.shopId, supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot',
      sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: input.selectedSkuKeys }) },
    loadCatalog: async () => ({ revision: 'catalog', entries: [] }),
  });
  const app = Fastify();
  await app.register(extensionListingEditorRoutes, { prefix: '/api/extension-device/source-workbench', service: createEditor(),
    authenticateDevice: async (request) => { (request as any).device = { ownerUserId: options.owner ?? 'owner', actorUserId: options.actor ?? 'owner',
      sessionId: 'device', scopes: options.scopes ?? ['listing:review', 'listing:write'], allowedShopIds: options.shops ?? ['shop'] }; },
    featureFlags: { evaluate: async () => ({ enabled: options.enabled ?? true, reason: 'pilot_match', listingStage: 'dual_read' }) },
  });
  const binding = bindingFor(draft);
  const current = () => workflow.getDraft({ ownerUserId: 'owner', draftId: draft.id });
  return { app, repository, workflow, draft, schema, sourceContext, attributes, prepare, binding, current, createEditor, loadSchema, loadDictionary, loadSourceContext };
}
async function preview(fixture: Awaited<ReturnType<typeof setup>>) {
  const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/attribute-suggestions`, payload: { binding: fixture.binding } });
  expect(response.statusCode).toBe(200);
  return response.json().data;
}
function apply(binding: ReturnType<typeof bindingFor>, data: any, attributeIds = [20], operationKey = 'apply-source-attributes') {
  return { binding, operationKey, action: 'ATTRIBUTE_SUGGESTIONS' as const, value: { schemaRevision: data.workspace.schemaRevision,
    candidates: data.suggestions.filter((candidate: any) => attributeIds.includes(candidate.attributeId))
      .map(({ attributeId, candidateId, candidateHash, schemaRevision }: any) => ({ attributeId, candidateId, candidateHash, schemaRevision })) } };
}

describe('extension source attribute candidates', () => {
  it('previews traceable product and selected-SKU candidates without approving, mutating or inventing forbidden facts', async () => {
    const fixture = await setup();
    try {
      const data = await preview(fixture);
      expect(data).toMatchObject({ state: 'ready', workspace: { schemaRevision: expect.stringMatching(/^[a-f0-9]{64}$/u) } });
      expect(data.suggestions.map((candidate: any) => candidate.attributeId)).toEqual([10, 20]);
      expect(data.suggestions[1]).toMatchObject({ attributeId: 20, reviewed: false, rows: [
        { skuKey: 'blue', value: ['Синий'], sourceValue: ['蓝色'], source: 'SOURCE', dictionaryValueIds: [202], reviewed: false },
        { skuKey: 'red', value: ['Красный'], sourceValue: ['红色'], source: 'SOURCE', dictionaryValueIds: [201], reviewed: false },
      ] });
      expect(data.suggestions[1].rows.every((row: any) => row.evidence.some((evidence: any) => evidence.source === 'SOURCE_STANDARD'
        && evidence.path && evidence.value && evidence.isEstimated === false))).toBe(true);
      expect(data.blockedSuggestions).toEqual(expect.arrayContaining([
        expect.objectContaining({ attributeId: 30, reasonCode: 'AI_FORBIDDEN_FACT' }),
        expect.objectContaining({ attributeId: 40, reasonCode: 'AI_FORBIDDEN_FACT' }),
      ]));
      expect(JSON.stringify(data)).not.toMatch(/sourceCaptureHash|ownerUserId|auditEvents|sourceProfile|unselected|forged-certification/);
      expect((await fixture.current()).attributes.values).toEqual({});
      expect((await fixture.current()).revision).toBe(fixture.draft.revision);
      expect(fixture.prepare).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });

  it('explicitly applies only chosen attribute groups with canonical values, SOURCE provenance and original grant invalidation', async () => {
    const fixture = await setup();
    try {
      const data = await preview(fixture);
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: apply(fixture.binding, data) });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ replayed: false, data: { binding: { ...fixture.binding,
        draftRevision: fixture.draft.revision + 1, draftVersion: fixture.draft.draftVersion + 1 } } });
      const saved = await fixture.current();
      expect(saved.attributes.values['10']).toBeUndefined();
      expect(saved.attributes.values['20']?.skuValues).toMatchObject({
        red: { value: ['Красный'], source: 'SOURCE', reviewed: true, suggestionProvenance: {
          candidateId: data.suggestions[1].candidateId, sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64),
          evidenceDetails: [expect.objectContaining({ value: ['红色'], source: 'SOURCE_STANDARD' })] } },
        blue: { value: ['Синий'], source: 'SOURCE', reviewed: true },
      });
      expect(saved.grantRevocation).toMatchObject({ required: true, reason: 'ATTRIBUTE_VALUES_CHANGED' });
      expect(saved.freshness.content.state).toBe('STALE');
      expect(saved.freshness.validation.state).toBe('STALE');
      expect(saved.auditEvents.at(-1)?.details).toMatchObject({ operation: 'SUGGESTION_APPLIED', editorOperationKey: 'apply-source-attributes' });
    } finally { await fixture.app.close(); }
  });

  it('recovers the original applied receipt across restarts and simultaneous independent instances without re-preparing', async () => {
    const fixture = await setup();
    try {
      const request = apply(fixture.binding, await preview(fixture));
      const second = fixture.createEditor(createSourceListingWorkflowService({ repository: fixture.repository }));
      const outcomes = await Promise.all([fixture.createEditor().save(identity, request), second.save(identity, request)]);
      expect(outcomes.map((outcome) => outcome.data.binding.draftRevision)).toEqual([3, 3]);
      expect((await fixture.current()).revision).toBe(3);
      fixture.loadSchema.mockRejectedValue(new Error('official authority temporarily unavailable'));
      fixture.prepare.mockClear();
      const replay = await fixture.createEditor(createSourceListingWorkflowService({ repository: fixture.repository })).save(identity, request);
      expect(replay.replayed).toBe(true);
      expect(replay.data.binding).toEqual(outcomes[0]!.data.binding);
      expect(fixture.prepare).not.toHaveBeenCalled();
      const conflict = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: { ...request,
        value: { ...request.value, candidates: [{ ...request.value.candidates[0], candidateHash: 'f'.repeat(64) }] } } });
      expect(conflict.statusCode).toBe(409);
    } finally { await fixture.app.close(); }
  });

  it('coalesces concurrent identical requests within the original workflow owner', async () => {
    const fixture = await setup();
    try {
      const request = apply(fixture.binding, await preview(fixture), [10, 20]);
      const editor = fixture.createEditor();
      const outcomes = await Promise.all([editor.save(identity, request), editor.save(identity, request)]);
      expect(outcomes[0]?.data.binding).toEqual(outcomes[1]?.data.binding);
      expect((await fixture.current()).revision).toBe(fixture.draft.revision + 1);
      expect(fixture.prepare).toHaveBeenCalledTimes(1);
      expect((await fixture.current()).attributes.values['10']).toMatchObject({ value: 'Полипропилен', source: 'SOURCE',
        suggestionProvenance: { sourceCaptureSnapshotId: 'snapshot', evidenceDetails: [expect.objectContaining({ source: 'SOURCE_STANDARD' })] } });
    } finally { await fixture.app.close(); }
  });

  it('keeps old applied receipts immutable after later SKU changes and refuses a changed binding on the same key', async () => {
    const fixture = await setup();
    try {
      const request = apply(fixture.binding, await preview(fixture));
      const first = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: request });
      expect(first.statusCode).toBe(200);
      const changed = await fixture.workflow.changeSkuSelection({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id,
        expectedRevision: first.json().data.binding.draftRevision, selectedSkuKeys: ['blue'] });
      const replay = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: request });
      expect(replay.statusCode).toBe(200);
      expect(replay.json().replayed).toBe(true);
      expect(replay.json().data.binding).toEqual(first.json().data.binding);
      const forged = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: { ...request, binding: bindingFor(changed) } });
      expect(forged.statusCode).toBe(409);
      expect((await fixture.current()).selectedSkuKeys).toEqual(['blue']);
      expect((await fixture.current()).revision).toBe(changed.revision);
    } finally { await fixture.app.close(); }
  });

  it('reports unresolved candidates when official dictionary authority is unavailable instead of guessing IDs', async () => {
    const fixture = await setup();
    try {
      fixture.loadDictionary.mockRejectedValue(new Error('official dictionary unavailable'));
      const data = await preview(fixture);
      expect(data.suggestions.map((candidate: any) => candidate.attributeId)).toEqual([10]);
      expect(data.blockedSuggestions).toEqual(expect.arrayContaining([
        expect.objectContaining({ attributeId: 20, skuKey: 'red', reasonCode: 'STRICT_DICTIONARY_UNRESOLVED' }),
        expect.objectContaining({ attributeId: 20, skuKey: 'blue', reasonCode: 'STRICT_DICTIONARY_UNRESOLVED' }),
      ]));
      expect((await fixture.current()).attributes.values).toEqual({});
    } finally { await fixture.app.close(); }
  });

  it('refuses a candidate read that finishes after the draft version has changed', async () => {
    const fixture = await setup();
    try {
      fixture.loadSourceContext.mockImplementationOnce(async () => {
        await fixture.workflow.changeSkuSelection({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id,
          expectedRevision: fixture.draft.revision, selectedSkuKeys: ['blue'] });
        return fixture.sourceContext;
      });
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/attribute-suggestions`, payload: { binding: fixture.binding } });
      expect(response.statusCode).toBe(409);
      expect(response.json().errorCode).toBe('ozon_listing_draft_version_conflict');
      expect(response.json().data).toBeUndefined();
    } finally { await fixture.app.close(); }
  });

  it('preserves unresolved strict-dictionary subsets as requiring review and does not fabricate a dictionary choice', async () => {
    const fixture = await setup({ mixedColors: true });
    try {
      const data = await preview(fixture);
      expect(data.blockedSuggestions).toContainEqual(expect.objectContaining({ attributeId: 20, skuKey: 'red',
        reasonCode: 'STRICT_DICTIONARY_UNRESOLVED', unsupportedValues: ['未知色'] }));
      expect(data.suggestions[1].rows.find((row: any) => row.skuKey === 'red').unresolvedValues).toEqual(['未知色']);
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: apply(fixture.binding, data) });
      expect(response.statusCode).toBe(200);
      expect((await fixture.current()).attributes.values['20']?.skuValues?.red).toMatchObject({ value: ['Красный'],
        unresolvedValues: ['未知色'], manualReview: 'REQUIRED' });
    } finally { await fixture.app.close(); }
  });

  it.each(['schema', 'source', 'sku', 'draft', 'candidate', 'unavailable'] as const)('rejects %s drift before writing a reviewed candidate', async (kind) => {
    const fixture = await setup();
    try {
      const request = apply(fixture.binding, await preview(fixture));
      if (kind === 'schema') fixture.schema.definitionsHash = 'f'.repeat(64);
      if (kind === 'source') fixture.sourceContext.skuStandards.red.sourceStandard.colors = ['蓝色'];
      if (kind === 'sku') await fixture.workflow.changeSkuSelection({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id,
        expectedRevision: fixture.draft.revision, selectedSkuKeys: ['blue'] });
      if (kind === 'draft') request.binding.draftVersion += 1;
      if (kind === 'candidate') request.value.candidates[0].candidateHash = 'f'.repeat(64);
      if (kind === 'unavailable') fixture.sourceContext.skuStandards = {} as typeof fixture.sourceContext.skuStandards;
      const before = await fixture.current();
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: request });
      expect([409, 422]).toContain(response.statusCode);
      expect((await fixture.current()).revision).toBe(before.revision);
      expect((await fixture.current()).attributes.values).toEqual({});
    } finally { await fixture.app.close(); }
  });

  it.each([{ scopes: [] }, { shops: ['foreign'] }, { owner: 'foreign', actor: 'foreign' }, { actor: 'foreign' }, { enabled: false }])(
    'rejects an unauthorized read before preparing candidates: %j', async (options) => {
      const fixture = await setup(options);
      try {
        const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/attribute-suggestions`, payload: { binding: fixture.binding } });
        expect([401, 403, 404, 409]).toContain(response.statusCode);
        expect(fixture.loadSourceContext).not.toHaveBeenCalled();
      } finally { await fixture.app.close(); }
    });

  it('allows read-only candidate previews but requires the existing write scope for an explicit apply', async () => {
    const fixture = await setup({ scopes: ['listing:review'] });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: apply(fixture.binding, await preview(fixture)) });
      expect(response.statusCode).toBe(403);
      expect(fixture.prepare).not.toHaveBeenCalled();
      expect((await fixture.current()).revision).toBe(fixture.draft.revision);
    } finally { await fixture.app.close(); }
  });

  it.each([{ ownerUserId: 'forged' }, { autoApprove: true }, { binding: { forged: true } }])('rejects forged preview fields: %j', async (fields) => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/attribute-suggestions`, payload: { binding: fixture.binding, ...fields } });
      expect(response.statusCode).toBe(400);
      expect(fixture.loadSourceContext).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });

  it.each([{ snapshotId: 'foreign' }, { supplyGoodsId: 'foreign' }, { listingWorkflowId: 'foreign' },
    { draftRevision: 9 }, { draftVersion: 9 }])('rejects a stale source binding before a candidate read: %j', async (changes) => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/attribute-suggestions`, payload: {
        binding: { ...fixture.binding, ...changes },
      } });
      expect([404, 409]).toContain(response.statusCode);
      expect(fixture.loadSourceContext).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });

  it.each(['value', 'source', 'reviewed', 'evidence', 'skuKey', 'duplicate', 'empty'] as const)('rejects caller-owned %s in candidate application', async (kind) => {
    const fixture = await setup();
    try {
      const request = apply(fixture.binding, await preview(fixture));
      if (kind === 'duplicate') request.value.candidates.push(request.value.candidates[0]);
      else if (kind === 'empty') request.value.candidates = [];
      else (request.value.candidates[0] as Record<string, unknown>)[kind] = 'forged';
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: request });
      expect(response.statusCode).toBe(400);
      expect(fixture.prepare).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });

  it('rejects unconfigured attributes instead of claiming an empty successful preview', async () => {
    const fixture = await setup({ missingAttributes: true });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/attribute-suggestions`, payload: { binding: fixture.binding } });
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe(0);
    } finally { await fixture.app.close(); }
  });

  it('preserves terminal-workflow rejection and reference validation below the HTTP handler', async () => {
    const fixture = await setup();
    try {
      const request = apply(fixture.binding, await preview(fixture));
      await expect(fixture.createEditor().save(identity, { ...request, value: { ...request.value,
        candidates: [{ ...request.value.candidates[0], value: 'forged' }] } })).rejects.toMatchObject({
          code: 'OZON_LISTING_DRAFT_INPUT_INVALID', statusCode: 400,
        });
      const cancelled = await fixture.workflow.setRunState({ draftId: fixture.draft.id, ownerUserId: 'owner', actorUserId: 'owner',
        expectedRevision: fixture.draft.revision, runState: 'CANCELLED', reason: 'operator_cancelled' });
      request.binding = bindingFor(cancelled);
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: request });
      expect(response.statusCode).toBe(409);
      expect(response.json().errorCode).toBe('ozon_listing_workflow_terminal');
      expect(fixture.prepare).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });

  it('does not let a service caller override trusted command context through the suggestion value', async () => {
    const fixture = await setup();
    try {
      const request = apply(fixture.binding, await preview(fixture));
      for (const key of ['ownerUserId', 'actorUserId', 'draftId', 'operationKey', 'expectedRevision', 'expectedDraftVersion']) {
        await expect(fixture.createEditor().save(identity, { ...request,
          value: { ...request.value, [key]: 'forged-context' } })).rejects.toMatchObject({ statusCode: 400 });
      }
      expect(fixture.prepare).not.toHaveBeenCalled();
      expect((await fixture.current()).revision).toBe(fixture.draft.revision);
    } finally { await fixture.app.close(); }
  });

  it('fails a response over the device transport limit without mutating or returning an oversized preview', async () => {
    const fixture = await setup();
    try {
      fixture.sourceContext.sourceStandard.materials = ['x'.repeat(600 * 1024)];
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/attribute-suggestions`, payload: { binding: fixture.binding } });
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe(0);
      expect((await fixture.current()).attributes.values).toEqual({});
    } finally { await fixture.app.close(); }
  });
});

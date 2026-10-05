import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import type { OzonListingDraft } from 'shared';
import { SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS, SOURCE_LISTING_SKU_KEY_MAX_LENGTH } from 'shared';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { assertSourceListingDraftPublishReady, createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createPrismaSourceListingWorkflowContextResolver } from '../services/source-listing-workflow-context.js';
import { createExtensionListingEditorService } from '../services/extension-listing-editor.js';
import { extensionListingEditorRoutes } from '../routes/extension-listing-editor.js';

const endpoint = '/api/extension-device/source-workbench/editor/save';
const available = ['sku-red', 'sku-blue', 'sku-green'];
const snapshotHash = 'a'.repeat(64);
const bindingFor = (draft: OzonListingDraft) => ({ snapshotId: draft.sourceCaptureSnapshotId,
  supplyGoodsId: draft.supplyGoodsId, shopId: draft.shopId, listingWorkflowId: draft.id,
  draftRevision: draft.revision, draftVersion: draft.draftVersion });

async function setup(options: { scopes?: string[]; shops?: string[]; owner?: string; actor?: string;
  session?: string | null; enabled?: boolean; listingStage?: string } = {}) {
  const repository = new InMemoryOzonListingDraftRepository();
  const workflow = createSourceListingWorkflowService({ repository });
  const draft = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop',
    supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: snapshotHash, selectedSkuKeys: ['sku-red'] });
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const ownership = createPrismaSourceListingWorkflowContextResolver({ client: {
    async $queryRawUnsafe<T>(sql: string, ...params: unknown[]): Promise<T> {
      queries.push({ sql, params });
      let rows: unknown[] = [];
      if (params[1] === 'owner') {
        if (sql.includes('FROM "shops"') && params[0] === 'shop') rows = [{ id: 'shop' }];
        if (sql.includes('FROM "supply_goods"') && params[0] === 'goods') rows = [{ supplyGoodsId: 'goods', subjectId: 'subject' }];
        if (sql.includes('FROM "source_capture_snapshots"') && params[0] === 'snapshot' && params[2] === 'subject') {
          rows = [{ snapshotId: 'snapshot', subjectId: 'subject', supplyGoodsId: 'goods', captureHash: snapshotHash,
            payload: { skus: available.map((key) => ({ key, sourceSkuId: `source-${key}` })) } }];
        }
      }
      return rows as T;
    },
  } });
  const editor = (current = workflow) => createExtensionListingEditorService({ workflow: current, ownership,
    loadCatalog: async () => ({ revision: 'catalog-1', entries: [] }) });
  const app = Fastify();
  await app.register(extensionListingEditorRoutes, { prefix: '/api/extension-device/source-workbench', service: editor(),
    featureFlags: { evaluate: async () => ({ enabled: options.enabled ?? true, reason: 'pilot_match', listingStage: options.listingStage ?? 'dual_read' }) },
    authenticateDevice: async (request) => { (request as any).device = {
      ownerUserId: options.owner ?? 'owner', actorUserId: options.actor ?? 'owner', sessionId: options.session === undefined ? 'device' : options.session,
      scopes: options.scopes ?? ['listing:review', 'listing:write'], allowedShopIds: options.shops ?? ['shop'],
    }; },
  });
  return { app, repository, workflow, draft, binding: bindingFor(draft), queries, editor,
    current: () => workflow.getDraft({ ownerUserId: 'owner', draftId: draft.id }) };
}
function selection(binding: ReturnType<typeof bindingFor>, selectedSkuKeys = ['sku-red', 'sku-blue'], operationKey = 'sku-selection-1') {
  return { binding, operationKey, action: 'SKU_SELECTION' as const, value: { selectedSkuKeys } };
}
const identity = { ownerUserId: 'owner', actorUserId: 'owner', allowedShopIds: ['shop'] };

async function prepared(fixture: Awaited<ReturnType<typeof setup>>) {
  const context = (draft: OzonListingDraft) => ({ ownerUserId: 'owner', actorUserId: 'owner', draftId: draft.id, expectedRevision: draft.revision });
  let draft = await fixture.workflow.setCategory({ ...context(fixture.draft), category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' } });
  const copy = await fixture.workflow.addAiCopyCandidate({ ...context(draft), titleRu: 'Товар для продажи',
    descriptionRu: 'Описание товара.', sourcePromptVersion: 'copy-v1' });
  draft = await fixture.workflow.applyAiCopyCandidate({ ...context(copy.draft), candidateId: copy.candidate.id, operationKey: 'approve-source-copy' });
  draft = await fixture.workflow.setMediaAssignments({ ...context(draft), assignments: [
    { scope: 'PRODUCT', slotKey: 'product-main', assetId: 'asset-main', source: 'REVIEWED' },
    { scope: 'SKU', skuKey: 'sku-red', slotKey: 'hero', assetId: 'asset-red', source: 'GENERATED' },
  ] });
  draft = await fixture.workflow.setPricing({ ...context(draft), value: { contractVersion: 'ozon-listing-pricing/v1',
    items: [{ skuKey: 'sku-red', price: '100', oldPrice: '120', offerId: 'SS-RED', currencyCode: 'RUB', vat: '0' }] } });
  draft = await fixture.workflow.recordValidationResult({ ...context(draft), status: 'VALID', blockers: [], warnings: [], report: {
    schemaVersion: 'ozon-attribute-validation/v1', schemaRevision: 'schema-1', normalizedAttributes: [], fieldDecisions: [],
    operationReadiness: { ozonImport: { status: 'READY', issues: [] }, inventoryActivation: { status: 'READY', issues: [] },
      costingAutoPricing: { status: 'READY', issues: [] } },
  } });
  return draft;
}

describe('extension selected-SKU changes', () => {
  it('adds and removes only captured SKUs in the same draft, returning the new exact binding', async () => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({ method: 'POST', url: endpoint, payload: selection(fixture.binding) });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ code: 1, replayed: false, data: { selectedSkuKeys: ['sku-blue', 'sku-red'],
        binding: { ...fixture.binding, draftRevision: 2, draftVersion: 2 } } });
      const removed = await fixture.app.inject({ method: 'POST', url: endpoint,
        payload: selection(response.json().data.binding, ['sku-blue'], 'sku-selection-remove') });
      expect(removed.statusCode).toBe(200);
      expect(removed.json().data).toMatchObject({ selectedSkuKeys: ['sku-blue'], binding: { ...fixture.binding, draftRevision: 3, draftVersion: 3 } });
      expect((await fixture.current()).auditEvents.filter((event) => event.type === 'SKU_SELECTION_CHANGED')).toHaveLength(2);
      expect(fixture.queries.every(({ params }) => params[1] === 'owner')).toBe(true);
      expect(JSON.stringify(response.json())).not.toMatch(/auditEvents|editorRequestHash|ownerUserId|sourceCaptureHash|grantRevocation/);
    } finally { await fixture.app.close(); }
  });

  it('replays the original operation after service restart and later edits, without advancing the current draft', async () => {
    const fixture = await setup();
    try {
      const request = selection(fixture.binding);
      const first = await fixture.app.inject({ method: 'POST', url: endpoint, payload: request });
      expect(first.statusCode).toBe(200);
      const changed = await fixture.workflow.changeSkuSelection({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id,
        expectedRevision: first.json().data.binding.draftRevision, selectedSkuKeys: ['sku-green'] });
      const restarted = fixture.editor(createSourceListingWorkflowService({ repository: fixture.repository }));
      const replay = await restarted.save(identity, request);
      expect(replay.replayed).toBe(true);
      expect(replay.data).toMatchObject({ selectedSkuKeys: ['sku-blue', 'sku-red'], binding: first.json().data.binding });
      expect((await fixture.current()).revision).toBe(changed.revision);
      expect((await fixture.current()).selectedSkuKeys).toEqual(['sku-green']);
    } finally { await fixture.app.close(); }
  });

  it('persists one mutation for concurrent identical requests and rejects an altered request on the same key', async () => {
    const fixture = await setup();
    try {
      const request = selection(fixture.binding);
      const results = await Promise.all([0, 1].map(() => fixture.app.inject({ method: 'POST', url: endpoint, payload: request })));
      expect(results.map((result) => result.statusCode)).toEqual([200, 200]);
      expect((await fixture.current()).revision).toBe(2);
      for (const payload of [selection(fixture.binding, ['sku-green']), { ...request, binding: { ...fixture.binding, draftVersion: 9 } },
        { ...request, binding: { ...fixture.binding, draftRevision: 9 } }]) {
        const rejected = await fixture.app.inject({ method: 'POST', url: endpoint, payload });
        expect(rejected.statusCode).toBe(409);
      }
      expect((await fixture.current()).revision).toBe(2);
    } finally { await fixture.app.close(); }
  });

  it('canonicalizes captured legacy SKU aliases through the existing source owner', async () => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({ method: 'POST', url: endpoint,
        payload: selection(fixture.binding, ['source-sku-blue', 'sku-red']) });
      expect(response.statusCode).toBe(200);
      expect(response.json().data.selectedSkuKeys).toEqual(['sku-blue', 'sku-red']);
    } finally { await fixture.app.close(); }
  });

  it('recovers one durable receipt when two independent workflow instances race', async () => {
    const fixture = await setup();
    try {
      const request = selection(fixture.binding);
      const secondEditor = fixture.editor(createSourceListingWorkflowService({ repository: fixture.repository }));
      const results = await Promise.all([fixture.editor().save(identity, request), secondEditor.save(identity, request)]);
      expect(results.map((result) => result.data.binding.draftRevision)).toEqual([2, 2]);
      const current = await fixture.current();
      expect(current.revision).toBe(2);
      expect(current.auditEvents.filter((event) => event.type === 'SKU_SELECTION_CHANGED')).toHaveLength(1);
      expect(current.auditEvents.at(-1)?.details).toMatchObject({ editorOperationKey: request.operationKey,
        editorRequestHash: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    } finally { await fixture.app.close(); }
  });

  it('invalidates existing price, media, copy, attributes, validation and publishing authority while retaining the originals', async () => {
    const fixture = await setup();
    try {
      const before = await prepared(fixture);
      expect(() => assertSourceListingDraftPublishReady(before)).not.toThrow();
      const response = await fixture.app.inject({ method: 'POST', url: endpoint, payload: selection(bindingFor(before), ['sku-blue']) });
      expect(response.statusCode).toBe(200);
      const after = await fixture.current();
      expect(after).toMatchObject({ selectedSkuKeys: ['sku-blue'], draftVersion: before.draftVersion + 1,
        revision: before.revision + 1, validation: { status: 'STALE' },
        grantRevocation: { required: true, reason: 'SKU_SELECTION_CHANGED', previousShopId: null } });
      for (const field of ['attributes', 'content', 'media', 'pricing', 'validation'] as const) {
        expect(after.freshness[field]).toEqual({ state: 'STALE', reason: 'SKU_SELECTION_CHANGED' });
      }
      expect(after.pricing.value).toEqual(before.pricing.value);
      expect(after.media.assignments).toEqual(before.media.assignments);
      expect(after.copy).toEqual(before.copy);
      expect(after.media.videoBindings ?? []).toEqual([]);
      expect(response.json().data.pricing).toBeNull();
      expect(response.json().data.fieldIssues).toContainEqual({ field: 'PRICING', message: expect.any(String) });
      expect(() => assertSourceListingDraftPublishReady(after)).toThrow(/not ready to publish/);
      await expect(fixture.workflow.recordPublishIntent({ ownerUserId: 'owner', actorUserId: 'owner', draftId: after.id,
        expectedRevision: after.revision, idempotencyKey: 'publish-after-sku-change' })).rejects.toMatchObject({ code: 'OZON_LISTING_PUBLISH_NOT_READY' });
    } finally { await fixture.app.close(); }
  });

  it.each([
    { scopes: ['listing:review'] }, { scopes: ['listing:write'] }, { shops: ['foreign-shop'] },
    { actor: 'another-user' }, { owner: 'another-user', actor: 'another-user' }, { session: null },
    { enabled: false }, { listingStage: 'legacy_only' },
  ])('rejects missing existing device authorization or rollout without a mutation: %j', async (options) => {
    const fixture = await setup(options);
    try {
      const response = await fixture.app.inject({ method: 'POST', url: endpoint, payload: selection(fixture.binding) });
      expect([401, 403, 404, 409]).toContain(response.statusCode);
      expect((await fixture.current()).revision).toBe(1);
    } finally { await fixture.app.close(); }
  });

  it.each([
    { snapshotId: 'foreign' }, { supplyGoodsId: 'foreign' }, { shopId: 'foreign' }, { listingWorkflowId: 'foreign' },
    { draftRevision: 9 }, { draftVersion: 9 },
  ])('rejects a changed binding before a mutation: %j', async (changes) => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({ method: 'POST', url: endpoint, payload: selection({ ...fixture.binding, ...changes }) });
      expect([403, 404, 409]).toContain(response.statusCode);
      expect((await fixture.current()).revision).toBe(1);
    } finally { await fixture.app.close(); }
  });

  it.each([
    { value: { selectedSkuKeys: [] } }, { value: { selectedSkuKeys: ['sku-red', 'sku-red'] } },
    { value: { selectedSkuKeys: ['x'.repeat(SOURCE_LISTING_SKU_KEY_MAX_LENGTH + 1)] } },
    { value: { selectedSkuKeys: Array.from({ length: SOURCE_LISTING_SELECTED_SKU_MAX_ITEMS + 1 }, (_, index) => `sku-${index}`) } },
    { value: { selectedSkuKeys: ['sku-red'], duplicateSku: true } }, { value: { selectedSkuKeys: ['sku-red'], reviewed: true } },
    { ownerUserId: 'forged' }, { deviceSessionId: 'forged' }, { operationKey: 'short' },
  ])('rejects malformed or caller-owned fields without a mutation: %j', async (fields) => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({ method: 'POST', url: endpoint, payload: { ...selection(fixture.binding), ...fields } });
      expect(response.statusCode).toBe(400);
      expect((await fixture.current()).revision).toBe(1);
    } finally { await fixture.app.close(); }
  });

  it('rejects invented/copied SKUs and never creates source rows', async () => {
    const fixture = await setup();
    try {
      for (const sku of ['sku-red-copy', 'foreign-sku']) {
        const response = await fixture.app.inject({ method: 'POST', url: endpoint, payload: selection(fixture.binding, [sku]) });
        expect(response.statusCode).toBe(422);
        expect(response.json().errorCode).toBe('source_listing_sku_invalid');
      }
      expect((await fixture.current()).revision).toBe(1);
      expect(fixture.queries.every(({ sql }) => !/INSERT|UPDATE|DELETE/u.test(sql))).toBe(true);
    } finally { await fixture.app.close(); }
  });

  it('preserves the original terminal-workflow prohibition', async () => {
    const fixture = await setup();
    try {
      const cancelled = await fixture.workflow.setRunState({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id,
        expectedRevision: 1, runState: 'CANCELLED', reason: 'operator_cancelled' });
      const response = await fixture.app.inject({ method: 'POST', url: endpoint, payload: selection(bindingFor(cancelled)) });
      expect(response.statusCode).toBe(409);
      expect(response.json().errorCode).toBe('ozon_listing_workflow_terminal');
      expect((await fixture.current()).revision).toBe(cancelled.revision);
    } finally { await fixture.app.close(); }
  });
});

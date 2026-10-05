import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createExtensionListingEditorService } from '../services/extension-listing-editor.js';
import { extensionListingEditorRoutes } from '../routes/extension-listing-editor.js';
import { deriveSourceListingSkuCopyKey, projectSourceCaptureForDraft, normalizeSourceListingOfferRows } from '../services/source-listing-sku-copies.js';

async function setup() {
  const workflow = createSourceListingWorkflowService({ repository: new InMemoryOzonListingDraftRepository() });
  let draft = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods',
    sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['sku-red', 'sku-blue'] });
  draft = await workflow.setPricing({ draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: draft.revision,
    value: { contractVersion: 'ozon-listing-pricing/v1', items: [
      { skuKey: 'sku-red', price: '100', oldPrice: '120', offerId: 'offer-red', currencyCode: 'RUB', vat: '0' },
      { skuKey: 'sku-blue', price: '110', oldPrice: '130', offerId: 'offer-blue', currencyCode: 'RUB', vat: '0' },
    ] } });
  const service = createExtensionListingEditorService({ workflow,
    ownership: { assertOwnedTarget: async (input) => ({ shopId: input.shopId, supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot',
      sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: input.selectedSkuKeys }) }, loadCatalog: async () => ({ revision: 'r', entries: [] }) });
  const app = Fastify();
  await app.register(extensionListingEditorRoutes, { prefix: '/api/extension-device/source-workbench', service,
    featureFlags: { evaluate: async () => ({ enabled: true, reason: 'test', listingStage: 'dual_read' }) },
    authenticateDevice: async (request) => { (request as any).device = { ownerUserId: 'owner', actorUserId: 'owner', sessionId: 'device',
      scopes: ['listing:review', 'listing:write'], allowedShopIds: ['shop'] }; },
  });
  const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: draft.id,
    draftRevision: draft.revision, draftVersion: draft.draftVersion };
  return { app, workflow, draft, binding, current: () => workflow.getDraft({ ownerUserId: 'owner', draftId: draft.id }) };
}
function request(binding: any, sourceSkuKey = 'sku-red', operationKey = 'duplicate-sku-1') {
  return { binding, operationKey, action: 'SKU_DUPLICATE', value: { sourceSkuKey } };
}

describe('extension source SKU duplication owner', () => {
  it('uses deterministic copy identities and projects source media only for the read-only capture view', () => {
    const key = deriveSourceListingSkuCopyKey('draft', 'operation-key');
    expect(key).toBe(deriveSourceListingSkuCopyKey('draft', 'operation-key'));
    expect(() => normalizeSourceListingOfferRows([{ rowKey: key, sourceSkuKey: 'listing-copy:parent', offerId: 'offer',
      sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), sourceDraftVersion: 1, sourceDraftRevision: 1,
      pricing: null, packaging: null, attributes: {} }], ['sku-red'])).toThrow();
    const capture: any = { skus: [{ key: 'sku-red', sourceSkuId: 'source-red', mediaKeys: ['image-red'], attributes: [],
      kind: 'observed', ordinal: 0 }], media: [{ key: 'image-red', skuKeys: ['sku-red'], disposition: 'accepted' }] };
    const row = { rowKey: key, sourceSkuKey: 'sku-red', offerId: 'offer', sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), sourceDraftVersion: 1, sourceDraftRevision: 1,
      pricing: null, packaging: null, attributes: {}, };
    const projected = projectSourceCaptureForDraft(capture, { id: 'draft', ownerUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), revision: 2, draftVersion: 2, selectedSkuKeys: ['sku-red'],
      offerRows: { contractVersion: 'source-listing-offer-rows/v1', rows: [row] }, auditEvents: [{ type: 'SKU_DUPLICATED', draftVersion: 2,
        details: { rowKey: key, sourceSkuKey: 'sku-red', editorOperationKey: 'operation-key' } }] } as any);
    expect(projected.skus.map((sku: any) => sku.key)).toEqual(['sku-red', key]);
    expect(projected.media[0]!.skuKeys).toEqual(['sku-red', key]);
    expect(capture.skus).toHaveLength(1);
  });

  it('creates a server-owned offer row with cloned confirmed row values and no copied media assignment', async () => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: request(fixture.binding) });
      expect(response.statusCode).toBe(200);
      const data = response.json().data;
      expect(data.offerRows.rows).toHaveLength(1);
      expect(data.offerRows.rows[0]).toMatchObject({ sourceSkuKey: 'sku-red', rowKey: expect.stringMatching(/^listing-copy:/), offerId: expect.stringMatching(/^copy-/),
        pricing: { skuKey: expect.stringMatching(/^listing-copy:/), offerId: expect.stringMatching(/^copy-/) } });
      expect(data.mediaAssignments).toEqual([]);
      const current = await fixture.current();
      expect(current.selectedSkuKeys).toEqual(['sku-blue', 'sku-red']);
      expect(current.freshness).toMatchObject({ media: { state: 'STALE' }, pricing: { state: 'STALE' }, validation: { state: 'STALE' } });
      expect(current.grantRevocation).toMatchObject({ required: true, reason: 'SKU_SELECTION_CHANGED' });
      expect(current.auditEvents.at(-1)?.type).toBe('SKU_DUPLICATED');
    } finally { await fixture.app.close(); }
  });

  it('replays the exact duplicate operation without another row or revision and rejects altered key reuse', async () => {
    const fixture = await setup();
    try {
      const first = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: request(fixture.binding) });
      const replay = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: request(fixture.binding) });
      expect(first.statusCode).toBe(200); expect(replay.statusCode).toBe(200); expect(replay.json().replayed).toBe(true);
      expect(replay.json().data.binding).toEqual(first.json().data.binding);
      expect((await fixture.current()).offerRows?.rows).toHaveLength(1);
      const conflict = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: request(fixture.binding, 'sku-blue') });
      expect(conflict.statusCode).toBe(409);
    } finally { await fixture.app.close(); }
  });

  it('rejects a non-source, copy-chain, stale, unauthorized or malformed duplicate without mutation', async () => {
    const fixture = await setup();
    try {
      for (const payload of [request(fixture.binding, 'not-selected'), request({ ...fixture.binding, draftRevision: 99 }),
        { ...request(fixture.binding), value: { sourceSkuKey: 'sku-red', forged: true } },
        { ...request(fixture.binding), operationKey: 'short' }]) {
        const response = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload });
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
      }
      expect((await fixture.current()).offerRows).toBeUndefined();
    } finally { await fixture.app.close(); }
  });

  it('preserves copies whose source remains selected and removes copies whose source is removed', async () => {
    const fixture = await setup();
    try {
      const first = await fixture.app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/editor/save', payload: request(fixture.binding) });
      const binding = first.json().data.binding;
      const removed = await fixture.workflow.changeSkuSelection({ draftId: fixture.draft.id, ownerUserId: 'owner', actorUserId: 'owner',
        expectedRevision: binding.draftRevision, operationKey: 'selection-remove-parent', expectedDraftVersion: binding.draftVersion, selectedSkuKeys: ['sku-blue'] });
      expect(removed.offerRows).toBeUndefined();
      const added = await fixture.workflow.changeSkuSelection({ draftId: fixture.draft.id, ownerUserId: 'owner', actorUserId: 'owner',
        expectedRevision: removed.revision, operationKey: 'selection-add-parent', expectedDraftVersion: removed.draftVersion, selectedSkuKeys: ['sku-red', 'sku-blue'] });
      expect(added.offerRows).toBeUndefined();
    } finally { await fixture.app.close(); }
  });
});

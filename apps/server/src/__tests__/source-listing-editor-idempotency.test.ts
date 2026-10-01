import { describe, expect, it } from 'vitest';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { projectSourceListingSkuPackaging } from '../services/source-listing-sku-packaging.js';

async function setup() {
  const repository = new InMemoryOzonListingDraftRepository();
  const service = createSourceListingWorkflowService({ repository });
  const draft = await service.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['sku'] });
  const input = {
    draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: draft.revision,
    operationKey: 'editor-save-123',
    value: { contractVersion: 'ozon-listing-pricing/v1', items: [{ skuKey: 'sku', offerId: 'SS-1', price: '100', oldPrice: '120', currencyCode: 'CNY', vat: '0' }] },
  };
  return { repository, service, draft, input };
}

describe('persistent extension editor operation receipts', () => {
  it('creates one server-owned manual copy candidate and replays its receipt after restart', async () => {
    const { service, repository, draft } = await setup();
    const input = { draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: draft.revision,
      expectedDraftVersion: draft.draftVersion, operationKey: 'manual-copy-create-123',
      titleRu: 'Коробка для хранения', descriptionRu: 'Описание коробки.', sourcePromptVersion: 'caller-must-not-own-this' };
    const created = await service.addAiCopyCandidate(input);
    expect(created.candidate).toMatchObject({ kind: 'MANUAL', sourcePromptVersion: 'manual-copy-editor/v1',
      sourceCaptureSnapshotId: draft.sourceCaptureSnapshotId, sourceCaptureHash: draft.sourceCaptureHash, createdByUserId: 'owner' });
    expect(created.draft.copy.publishTitleRu).toBeNull();
    const resumed = createSourceListingWorkflowService({ repository });
    const replay = await resumed.addAiCopyCandidate(input);
    expect(replay.candidate).toEqual(created.candidate);
    expect(replay.draft.copy.candidates).toHaveLength(1);
    expect(replay.draft.revision).toBe(created.draft.revision);
    await expect(resumed.addAiCopyCandidate({ ...input, titleRu: 'Другой товар' })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT' });
  });
  it('coalesces concurrent manual candidate creation and rejects an old source replay', async () => {
    const { service, draft } = await setup();
    const input = { draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: draft.revision,
      expectedDraftVersion: draft.draftVersion, operationKey: 'manual-copy-create-123', titleRu: 'Коробка для хранения', sourcePromptVersion: 'manual' };
    const [first, second] = await Promise.all([service.addAiCopyCandidate(input), service.addAiCopyCandidate(input)]);
    expect(first.candidate.id).toBe(second.candidate.id);
    await service.replaceSourceSnapshot({ draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner',
      expectedRevision: first.draft.revision, sourceCaptureSnapshotId: 'new-snapshot', sourceCaptureHash: 'f'.repeat(64) });
    await expect(service.addAiCopyCandidate(input)).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT' });
  });
  it('preserves distinct SKU packaging and replays its persisted receipt across service instances', async () => {
    const { service, repository } = await setup();
    const draft = await service.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys: ['small', 'large'] });
    const input = { draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: draft.revision,
      expectedDraftVersion: draft.draftVersion, operationKey: 'packaging-save-123', evidence: ['owner:measured'],
      items: [{ skuKey: 'small', weightG: 100, lengthMm: 40, widthMm: 30, heightMm: 20 },
        { skuKey: 'large', weightG: 900, lengthMm: 400, widthMm: 300, heightMm: 200 }] };
    const saved = await service.setSkuPackaging(input);
    expect(saved.attributes.values.packaging).toMatchObject({ value: null, source: 'MANUAL', reviewed: true,
      skuValues: { small: { value: { weightG: 100 }, source: 'MANUAL', reviewed: true, evidence: ['owner:measured'] },
        large: { value: { weightG: 900 } } } });
    expect(saved.draftVersion).toBe(draft.draftVersion + 1);
    expect(projectSourceListingSkuPackaging(saved)).toEqual([input.items[1], input.items[0]]);
    const restored = createSourceListingWorkflowService({ repository });
    const replay = await restored.setSkuPackaging(input);
    expect(replay).toEqual(saved);
    expect(replay.auditEvents.filter((event) => event.type === 'MANUAL_FACT_CONFIRMED')).toHaveLength(1);
    await expect(restored.setSkuPackaging({ ...input, items: [{ ...input.items[0]!, weightG: 901 }, input.items[1]!] }))
      .rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT' });
  });
  it('rejects incomplete, duplicate, foreign SKU and non-measured packaging without writing', async () => {
    const { service, draft } = await setup();
    const item = { skuKey: 'sku', weightG: 100, lengthMm: 40, widthMm: 30, heightMm: 20 };
    const input = { draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: draft.revision,
      expectedDraftVersion: draft.draftVersion, operationKey: 'packaging-save-123', evidence: ['owner:measured'] };
    for (const items of [[], [item, item], [{ ...item, skuKey: 'foreign' }], [{ ...item, weightG: 0 }],
      [{ ...item, weightG: Number.NaN }], [{ ...item, lengthMm: Number.POSITIVE_INFINITY }],
      [{ ...item, heightMm: -1 }], [{ ...item, widthMm: '30' }], [{ ...item, reviewed: true }]]) {
      await expect(service.setSkuPackaging({ ...input, items: items as typeof item[] })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID' });
    }
    await expect(service.setSkuPackaging({ ...input, ownerUserId: 'foreign', actorUserId: 'foreign', items: [item] })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_NOT_FOUND' });
    expect((await service.getDraft({ draftId: draft.id, ownerUserId: 'owner' })).revision).toBe(draft.revision);
  });
  it('requires the current draft version and serializes identical concurrent packaging saves', async () => {
    const { service, draft } = await setup();
    const input = { draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: draft.revision,
      expectedDraftVersion: draft.draftVersion, operationKey: 'packaging-save-123', evidence: ['owner:measured'],
      items: [{ skuKey: 'sku', weightG: 100, lengthMm: 40, widthMm: 30, heightMm: 20 }] };
    await expect(service.setSkuPackaging({ ...input, expectedDraftVersion: draft.draftVersion + 1 })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT' });
    const results = await Promise.all([service.setSkuPackaging(input), service.setSkuPackaging(input)]);
    expect(results.map((result) => result.revision)).toEqual([2, 2]);
  });
  it('projects an explicitly reviewed common package while preserving the old storage path', async () => {
    const { service, draft } = await setup();
    expect(projectSourceListingSkuPackaging(draft)).toBeNull();
    const updated = await service.confirmManualFact({ draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner',
      expectedRevision: draft.revision, attributeKey: 'packaging', evidence: ['owner:common-package'],
      value: { weightG: 100, lengthMm: 40, widthMm: 30, heightMm: 20 } });
    expect(updated.attributes.values.packaging!.skuValues).toBeUndefined();
    expect(projectSourceListingSkuPackaging(updated)).toEqual([{ skuKey: 'sku', weightG: 100, lengthMm: 40, widthMm: 30, heightMm: 20 }]);
  });
  it('keeps repeated manual evidence inside the existing stored attribute JSON budget', async () => {
    const { service } = await setup();
    const selectedSkuKeys = Array.from({ length: 100 }, (_, index) => `sku-${index}`);
    const draft = await service.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: 'a'.repeat(64), selectedSkuKeys });
    await expect(service.setSkuPackaging({ draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner',
      expectedRevision: draft.revision, expectedDraftVersion: draft.draftVersion, operationKey: 'packaging-size-123',
      items: selectedSkuKeys.map((skuKey) => ({ skuKey, weightG: 100, lengthMm: 40, widthMm: 30, heightMm: 20 })),
      evidence: Array.from({ length: 20 }, (_, index) => `${index}: ${'measured'.repeat(60)}`),
    })).rejects.toMatchObject({ code: 'OZON_LISTING_DRAFT_INPUT_INVALID' });
    expect((await service.getDraft({ draftId: draft.id, ownerUserId: 'owner' })).revision).toBe(draft.revision);
  });
  it('replays a lost pricing response without increasing revisions or duplicating events', async () => {
    const { service, input } = await setup();
    const first = await service.setPricing(input);
    const replay = await service.setPricing(input);
    expect(replay.revision).toBe(first.revision);
    expect(replay.auditEvents.filter((event) => event.type === 'PRICING_CHANGED')).toHaveLength(1);
  });
  it('rejects reuse of an operation key with another value', async () => {
    const { service, input } = await setup();
    await service.setPricing(input);
    await expect(service.setPricing({ ...input, value: { ...input.value, items: [{ ...input.value.items[0], price: '101' }] } })).rejects.toThrow(/operation/i);
  });
  it('serializes two simultaneous pricing saves through the existing compare-and-swap owner', async () => {
    const { service, input } = await setup();
    const results = await Promise.all([service.setPricing(input), service.setPricing(input)]);
    expect(results.map((draft) => draft.revision)).toEqual([2, 2]);
  });
  it('keeps the receipt when a new service instance loads the same stored draft', async () => {
    const { service, repository, input } = await setup();
    await service.setPricing(input);
    const next = createSourceListingWorkflowService({ repository });
    expect((await next.setPricing(input)).revision).toBe(2);
  });
  it('does not let an operation key change a draft owned by another user', async () => {
    const { service, input } = await setup();
    await expect(service.setPricing({ ...input, ownerUserId: 'another', actorUserId: 'another' })).rejects.toThrow();
  });
});

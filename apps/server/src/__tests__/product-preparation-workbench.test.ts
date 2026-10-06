import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { createSourceProductCaptureV2Submission, type SourceProductCaptureV2Submission, type OzonNormalizedAttributeSchema } from 'shared';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createProductPreparationWorkbenchService, type ProductPreparationWorkbenchOptions } from '../services/product-preparation-workbench.js';
import { normalizeProductPreparationReport } from '../services/product-preparation-report.js';
import type { ProductPreparationFailure } from '../services/product-preparation-stages.js';
import { preparationVisualMediaKeys } from '../services/product-preparation-stages.js';
import type { ProductPreparationOperationStore, ProductPreparationReceipt } from '../services/product-preparation-operation-store.js';
import { createPrismaProductPreparationOperationStore, PRODUCT_PREPARATION_PROMPT_CONTRACT } from '../services/product-preparation-operation-store.js';
import { extensionProductPreparationRoutes } from '../routes/extension-product-preparation.js';

const identity = { ownerUserId: 'owner', actorUserId: 'owner', allowedShopIds: ['shop'] };
const schemaRevision = 'a'.repeat(64);
const field = { attributeId: 10, name: 'Цвет', description: '', sourceType: 'String', valueType: 'STRING' as const,
  cardinality: 'SINGLE' as const, required: false, dictionaryId: 1, valuePolicy: 'STRICT_DICTIONARY' as const,
  ownership: 'EDITOR' as const, editorMode: 'EDITABLE' as const, aiSuggestionAllowed: true };
const schema: OzonNormalizedAttributeSchema = { schemaVersion: 'ozon-attribute-schema/v1', shopId: 'shop',
  descriptionCategoryId: 1, typeId: 2, language: 'RU', catalogRevision: 'catalog-1', definitionsHash: 'definitions', fields: [field] };
const report = () => ({ contractVersion: 'product-preparation-analysis/v1', reviewState: 'CANDIDATE',
  curation: [{ sourceMediaKey: 'media-main-0', decision: 'KEEP', reason: '商品清晰' }],
  visualDescription: { composition: '居中', background: '白色', lighting: '柔和', style: '实物',
    observations: { colors: ['白色'], shapes: [], visibleComponents: [], visibleText: [] } },
  productSummary: { observations: ['白色长方形'], uncertainties: ['无法从图中确定材质'] },
  skuObservations: [{ skuKey: 'sku-source-0', observations: ['白色'], titleRu: 'Белый органайзер' }],
  suggestedAttributes: [{ attributeId: 10, value: 'Белый', dictionaryValueId: 100,
    evidence: { sourceMediaKeys: ['media-main-0'], observation: '图中可见白色' }, manualReview: 'REQUIRED' }],
  copy: { titleRu: 'Белый органайзер', descriptionRu: 'Органайзер белого цвета.', tagsRu: ['органайзер'] } });
async function setup(fixtureInput: { twoSkus?: boolean; mediaCount?: number } = {}) {
  const original = JSON.parse(readFileSync(new URL('../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json', import.meta.url), 'utf8')) as SourceProductCaptureV2Submission;
  if (fixtureInput.mediaCount) {
    const source = original.capture.media[0]!;
    original.capture.media = Array.from({ length: fixtureInput.mediaCount }, (_, ordinal) => {
      const image = structuredClone(source); image.key = `media-main-${ordinal}`; image.ordinal = ordinal;
      image.url = `https://cbu01.alicdn.com/img/ibank/sanitized-main-${ordinal}.jpg`;
      image.fieldEvidence.url.value = image.url; return image;
    });
    for (const count of original.capture.counts) if (count.fieldPath === '/media') count.totalCount = count.capturedCount = count.submittedCount = fixtureInput.mediaCount;
  }
  if (fixtureInput.twoSkus) {
    const second = { ...structuredClone(original.capture.skus[0]!), key: 'sku-1', sourceSkuId: 'sku-source-1', ordinal: 1 };
    second.fieldEvidence.sourceSkuId.value = 'sku-source-1'; original.capture.skus.push(second);
    for (const count of original.capture.counts) if (count.fieldPath === '/skus') count.totalCount = count.capturedCount = count.submittedCount = 2;
  }
  const capture = await createSourceProductCaptureV2Submission(original.capture);
  const workflow = createSourceListingWorkflowService({ repository: new InMemoryOzonListingDraftRepository() });
  const initial = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods',
    sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: capture.captureHash, selectedSkuKeys: fixtureInput.twoSkus ? ['sku-source-0', 'sku-source-1'] : ['sku-source-0'] });
  const draft = await workflow.setCategory({ ownerUserId: 'owner', actorUserId: 'owner', draftId: initial.id,
    expectedRevision: initial.revision, category: { categoryId: 1, typeId: 2, catalogRevision: 'catalog-1', categoryName: 'Дом', typeName: 'Органайзер' } });
  const records = new Map<string, { hash: string; status: string }>();
  const receipts = new Map<string, ProductPreparationReceipt>();
  const failures = new Map<string, ProductPreparationFailure>();
  const key = (input: { ownerUserId: string; draftId: string; operationKey: string }) => JSON.stringify([input.ownerUserId, input.draftId, input.operationKey]);
  const operationStore: ProductPreparationOperationStore = {
    claim: vi.fn(async input => { const id = key(input), old = records.get(id);
      if (old) return { kind: old.hash !== input.clientRequestHash ? 'conflict' as const : old.status === 'complete' ? 'replay' as const : 'unknown' as const, executionId: id };
      records.set(id, { hash: input.clientRequestHash, status: 'claimed' }); return { kind: 'claimed' as const, executionId: id }; }),
    complete: vi.fn(async id => { records.get(id)!.status = 'complete'; }),
    release: vi.fn(async id => { records.delete(id); }),
    markUnknown: vi.fn(async id => { records.get(id)!.status = 'unknown'; }),
    findReceipt: vi.fn(async input => receipts.get(key(input)) || null),
    saveReceipt: vi.fn(async (input, value) => { receipts.set(key(input), structuredClone(value)); }),
    findFailure: vi.fn(async input => failures.get(key(input)) || null),
    saveFailure: vi.fn(async (input, value) => { failures.set(key(input), structuredClone(value)); }),
  };
  let used = 0;
  const options = { workflow, operationStore,
    ownership: { assertOwnedTarget: vi.fn(async () => ({ shopId: 'shop', supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: capture.captureHash, selectedSkuKeys: draft.selectedSkuKeys })) },
    loadOwnedSnapshot: vi.fn(async () => ({ id: 'snapshot', captureHash: capture.captureHash, payloadBytes: capture.payloadBytes, payload: capture.capture })),
    loadAttributeContext: vi.fn(async () => ({ schema, schemaRevision, dictionaries: { '10': [{ id: 100, value: 'Белый' }] } })),
    evaluateCapability: vi.fn(async () => ({ available: true, reasonCode: 'AVAILABLE', dailyLimit: 20,
      config: { provider: 'custom' as const, baseUrl: 'https://fixture.example/v1', apiKey: 'secret-sentinel', model: 'fixture' } })),
    usageStore: { getDailySummary: async () => ({ requestCount: used, cacheHitCount: 0, failureCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
      record: vi.fn(async () => {}), reserveDailyLimit: vi.fn(async ({ limit }: { limit: number }) => { const allowed = used < limit; if (allowed) used++; return { allowed, used, remaining: Math.max(0, limit - used), limit }; }),
      releaseDailyReservation: vi.fn(async () => { used--; }) },
    readImage: vi.fn(async () => ({ mimeType: 'image/jpeg' as const, buffer: Buffer.from('fixture-safe-loader') })),
    analyzeTransport: vi.fn<ProductPreparationWorkbenchOptions['analyzeTransport']>(async () => ({ text: JSON.stringify(report()), usage: { promptTokens: 10, completionTokens: 20 } })),
  };
  const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: draft.id, draftRevision: draft.revision, draftVersion: draft.draftVersion };
  const input = { binding, skuKey: 'sku-source-0', sourceMediaKeys: ['media-main-0'], operationKey: 'preparation-fixture-1', categoryRevision: { catalogRevision: 'catalog-1', schemaRevision } };
  return { options, input, draft, workflow, records, receipts, failures, service: createProductPreparationWorkbenchService(options), used: () => used };
}
describe('continuous preparation owner', () => {
  it('returns unified candidates with bounded source/category prompt, without approving or writing a draft', async () => {
    const f = await setup(); const before = await f.workflow.getDraft({ ownerUserId: 'owner', draftId: f.draft.id });
    const result = await f.service.analyze(identity, f.input);
    expect(result.report).toEqual(report()); expect(result.replayed).toBe(false); expect(f.used()).toBe(1);
    expect(await f.workflow.getDraft({ ownerUserId: 'owner', draftId: f.draft.id })).toEqual(before);
    const prompt = f.options.analyzeTransport.mock.calls[0]![0].prompt;
    expect(prompt).toContain('Sanitized explicit-zero stock fixture'); expect(prompt).toContain('Органайзер');
    expect(prompt).not.toMatch(/https?:|secret-sentinel/);
  });
  it('restores original receipt across restart and later draft changes with no Provider/quota/download', async () => {
    const f = await setup(), first = await f.service.analyze(identity, f.input);
    await f.workflow.setPricing({ ownerUserId: 'owner', actorUserId: 'owner', draftId: f.draft.id, expectedRevision: f.draft.revision,
      value: { contractVersion: 'ozon-listing-pricing/v1', items: [{ skuKey: 'sku-source-0', price: '100', oldPrice: '120', currencyCode: 'CNY', vat: '0' }] } });
    f.options.loadAttributeContext.mockRejectedValue(new Error('current schema unavailable'));
    const restored = createProductPreparationWorkbenchService(f.options);
    expect(await restored.read(identity, f.input)).toEqual({ ...first, replayed: true });
    expect(await restored.analyze(identity, f.input)).toEqual({ ...first, replayed: true });
    expect(f.options.analyzeTransport).toHaveBeenCalledTimes(1); expect(f.used()).toBe(1);
  });
  it('lookup-only recovery never claims or dispatches an absent operation', async () => {
    const f = await setup(); await expect(f.service.read(identity, f.input)).rejects.toMatchObject({ code: 'product_preparation_receipt_pending', outcome: 'UNKNOWN_OUTCOME' });
    expect(f.options.operationStore.claim).not.toHaveBeenCalled(); expect(f.options.analyzeTransport).not.toHaveBeenCalled();
    expect(f.options.readImage).not.toHaveBeenCalled(); expect(f.used()).toBe(0);
  });
  it('retains unknown Provider outcomes and prevents repeated submission', async () => {
    const f = await setup(); f.options.analyzeTransport.mockRejectedValue(new Error('Provider timeout'));
    await expect(f.service.analyze(identity, f.input)).rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
    await expect(f.service.analyze(identity, f.input)).rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
    expect(f.options.analyzeTransport).toHaveBeenCalledTimes(1); expect(f.used()).toBe(1);
  });
  it('rejects changed frozen input reuse and stale category before model', async () => {
    const f = await setup(); await f.service.analyze(identity, f.input);
    await expect(f.service.analyze(identity, { ...f.input, categoryRevision: { ...f.input.categoryRevision, schemaRevision: 'b'.repeat(64) } })).rejects.toMatchObject({ code: 'product_preparation_operation_conflict' });
    await expect(f.service.analyze(identity, { ...f.input, operationKey: 'new-operation-1', categoryRevision: { ...f.input.categoryRevision, catalogRevision: 'stale' } })).rejects.toMatchObject({ code: 'product_preparation_category_stale' });
    expect(f.options.analyzeTransport).toHaveBeenCalledTimes(1);
  });
  it('rechecks draft after image download and releases NOT_SENT reservations', async () => {
    const f = await setup(); f.options.readImage.mockImplementationOnce(async () => {
      await f.workflow.setPricing({ ownerUserId: 'owner', actorUserId: 'owner', draftId: f.draft.id, expectedRevision: f.draft.revision,
        value: { contractVersion: 'ozon-listing-pricing/v1', items: [{ skuKey: 'sku-source-0', price: '100', oldPrice: '120', currencyCode: 'CNY', vat: '0' }] } });
      return { mimeType: 'image/jpeg', buffer: Buffer.from('image') };
    });
    await expect(f.service.analyze(identity, f.input)).rejects.toMatchObject({ code: 'product_preparation_context_stale', outcome: 'NOT_SENT' });
    expect(f.options.analyzeTransport).not.toHaveBeenCalled(); expect(f.used()).toBe(0);
  });
  it('stores reviewed AI attributes using server receipt references, keeping AI provenance and operation replay', async () => {
    const f = await setup(); await f.service.analyze(identity, f.input);
    const input = { binding: f.input.binding, analysisInput: f.input, action: 'ATTRIBUTES' as const, operationKey: 'apply-attributes-1', selectedAttributeIds: [10] };
    const first = await f.service.apply(identity, input); const current = await f.workflow.getDraft({ ownerUserId: 'owner', draftId: f.draft.id });
    expect(current.attributes.values['10']).toMatchObject({ value: 'Белый', source: 'AI', reviewed: true,
      suggestionProvenance: { contractVersion: 'ozon-attribute-suggestion-provenance/v1', schemaRevision } });
    const replay = await f.service.apply(identity, input); expect(replay.binding).toEqual(first.binding);
    expect((await f.workflow.getDraft({ ownerUserId: 'owner', draftId: f.draft.id })).revision).toBe(current.revision);
    expect(f.options.analyzeTransport).toHaveBeenCalledTimes(1);
  });
  it('prepares read-only BYOK prompt context with current schema, SKU and captured source facts, without URLs or secrets', async () => {
    const f = await setup(), { operationKey: _operationKey, ...input } = f.input;
    const result = await f.service.context(identity, input);
    expect(result.promptContext.sku.skuKey).toBe('sku-source-0');
    expect(result.promptContext.fields).toHaveLength(1); expect(result.promptContext.dictionaries['10']).toEqual([{ id: 100, value: 'Белый' }]);
    expect(JSON.stringify(result)).not.toMatch(/https?:|secret-sentinel/);
    expect(f.options.readImage).not.toHaveBeenCalled(); expect(f.options.analyzeTransport).not.toHaveBeenCalled(); expect(f.used()).toBe(0);
  });
  it('persists server-validated BYOK candidates without hosted quota, Provider or image calls, and applies AI provenance', async () => {
    const f = await setup(), validateByokReadiness = vi.fn(async () => ({ available: true }));
    const service = createProductPreparationWorkbenchService({ ...f.options, validateByokReadiness });
    const device = { ...identity, deviceSessionId: 'actual-device-session' };
    const analysisInput = { ...f.input, executionMode: 'BYOK' as const,
      providerContext: { providerOrigin: 'https://provider.example', model: 'qwen-vl-plus', policyRevision: 2 } };
    const first = await service.byokCandidates(device, { analysisInput, report: report() });
    expect(first.replayed).toBe(false);
    expect(validateByokReadiness).toHaveBeenCalledWith(expect.objectContaining({ identity: expect.objectContaining({ deviceSessionId: 'actual-device-session' }) }));
    expect(await service.read(device, analysisInput)).toEqual({ ...first, replayed: true });
    expect((await service.byokCandidates(device, { analysisInput, report: report() })).replayed).toBe(true);
    expect(f.options.usageStore.reserveDailyLimit).not.toHaveBeenCalled(); expect(f.options.readImage).not.toHaveBeenCalled(); expect(f.options.analyzeTransport).not.toHaveBeenCalled();
    expect([...f.receipts.values()][0]).toMatchObject({ provider: 'BYOK', model: 'qwen-vl-plus', usage: null });
    const applied = await service.apply(device, { binding: f.input.binding, analysisInput, action: 'ATTRIBUTES', operationKey: 'byok-apply-operation-1', selectedAttributeIds: [10] });
    expect(applied.binding.draftRevision).toBeGreaterThan(f.draft.revision);
    expect((await f.workflow.getDraft({ ownerUserId: 'owner', draftId: f.draft.id })).attributes.values['10']).toMatchObject({ source: 'AI', reviewed: true });
  });
  it('rejects BYOK candidates when capability/session or report binding is absent, without a receipt or reservation', async () => {
    const f = await setup(), analysisInput = { ...f.input, executionMode: 'BYOK' as const,
      providerContext: { providerOrigin: 'https://provider.example', model: 'qwen-vl-plus', policyRevision: 2 } };
    await expect(f.service.byokCandidates(identity, { analysisInput, report: report() })).rejects.toMatchObject({ code: 'product_preparation_byok_disabled' });
    const service = createProductPreparationWorkbenchService({ ...f.options, validateByokReadiness: async () => ({ available: false }) });
    await expect(service.byokCandidates({ ...identity, deviceSessionId: 'device' }, { analysisInput, report: report() })).rejects.toMatchObject({ code: 'product_preparation_byok_disabled' });
    expect(f.options.operationStore.claim).not.toHaveBeenCalled(); expect(f.receipts.size).toBe(0); expect(f.used()).toBe(0);
  });
  it('does not reclassify a hosted receipt as BYOK and rejects altered report replay', async () => {
    const f = await setup(), analysisInput = { ...f.input, executionMode: 'BYOK' as const,
      providerContext: { providerOrigin: 'https://provider.example', model: 'qwen-vl-plus', policyRevision: 2 } };
    await f.service.analyze(identity, f.input);
    const service = createProductPreparationWorkbenchService({ ...f.options, validateByokReadiness: async () => ({ available: true }) });
    await expect(service.byokCandidates({ ...identity, deviceSessionId: 'device' }, { analysisInput, report: report() })).rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
    expect(f.options.analyzeTransport).toHaveBeenCalledTimes(1);
  });
  it('coalesces concurrent hosted operations, freezes operation input, and charges exactly one quota', async () => {
    const f = await setup(); const results = await Promise.all([f.service.analyze(identity, f.input), f.service.analyze(identity, f.input)]);
    expect(results.map(item => item.replayed)).toEqual([false, true]); expect(f.used()).toBe(1); expect(f.options.analyzeTransport).toHaveBeenCalledTimes(1);
  });
  it('does not replay a corrupt receipt with foreign curation or SKU evidence', async () => {
    const f = await setup(); await f.service.analyze(identity, f.input);
    const stored = [...f.receipts.values()][0]!;
    const malformed = stored.result as { report: ReturnType<typeof report> };
    malformed.report.curation[0]!.sourceMediaKey = 'foreign';
    await expect(f.service.read(identity, f.input)).rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
    expect(f.options.analyzeTransport).toHaveBeenCalledTimes(1);
  });
  it('rechecks BYOK current draft after async policy evaluation before storing candidates', async () => {
    const f = await setup(), analysisInput = { ...f.input, executionMode: 'BYOK' as const,
      providerContext: { providerOrigin: 'https://provider.example', model: 'qwen-vl-plus', policyRevision: 2 } };
    const service = createProductPreparationWorkbenchService({ ...f.options, validateByokReadiness: async () => {
      await f.workflow.setPricing({ ownerUserId: 'owner', actorUserId: 'owner', draftId: f.draft.id, expectedRevision: f.draft.revision,
        value: { contractVersion: 'ozon-listing-pricing/v1', items: [{ skuKey: 'sku-source-0', price: '100', oldPrice: '120', currencyCode: 'CNY', vat: '0' }] } });
      return { available: true };
    } });
    await expect(service.byokCandidates({ ...identity, deviceSessionId: 'device' }, { analysisInput, report: report() })).rejects.toMatchObject({ code: 'product_preparation_context_stale' });
    expect(f.receipts.size).toBe(0); expect(f.options.operationStore.claim).not.toHaveBeenCalled();
  });
  it('replays the same BYOK report when the server supplied an omitted dictionary ID', async () => {
    const f = await setup(), analysisInput = { ...f.input, executionMode: 'BYOK' as const,
      providerContext: { providerOrigin: 'https://provider.example', model: 'qwen-vl-plus', policyRevision: 2 } };
    const service = createProductPreparationWorkbenchService({ ...f.options, validateByokReadiness: async () => ({ available: true }) });
    const raw = report() as unknown as { suggestedAttributes: Array<{ dictionaryValueId?: number }> };
    delete raw.suggestedAttributes[0]!.dictionaryValueId;
    const first = await service.byokCandidates({ ...identity, deviceSessionId: 'device' }, { analysisInput, report: raw });
    expect(first.report.suggestedAttributes[0]!.dictionaryValueId).toBe(100);
    expect((await service.byokCandidates({ ...identity, deviceSessionId: 'device' }, { analysisInput, report: raw })).replayed).toBe(true);
  });
  it('preserves confirmed source/manual attribute facts instead of replacing them with contradictory visual candidates', async () => {
    const f = await setup(); await f.service.analyze(identity, f.input);
    const enriched = await f.workflow.setAttributeValues({ ownerUserId: 'owner', actorUserId: 'owner', draftId: f.draft.id, expectedRevision: f.draft.revision,
      values: { '10': { value: 'Черный', source: 'SOURCE', reviewed: true } } });
    await expect(f.service.apply(identity, { binding: { ...f.input.binding, draftRevision: enriched.revision, draftVersion: enriched.draftVersion },
      analysisInput: f.input, action: 'ATTRIBUTES', operationKey: 'source-priority-apply-1', selectedAttributeIds: [10] })).rejects.toMatchObject({ code: 'product_preparation_source_priority' });
    expect((await f.workflow.getDraft({ ownerUserId: 'owner', draftId: f.draft.id })).attributes.values['10']).toMatchObject({ value: 'Черный', source: 'SOURCE', reviewed: true });
  });
  it('refuses opaque configured keys echoed into otherwise valid model fields, preserving UNKNOWN without a receipt', async () => {
    const f = await setup(), value = report(); value.productSummary.observations = ['secret-sentinel'];
    f.options.analyzeTransport.mockResolvedValueOnce({ text: JSON.stringify(value), usage: null });
    await expect(f.service.analyze(identity, f.input)).rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
    expect(f.receipts.size).toBe(0); expect(f.used()).toBe(1);
  });
  it('returns normalized BYOK analysis image bytes with exact hash and metadata, independent of hosted image capability', async () => {
    const f = await setup(), image = await sharp({ create: { width: 48, height: 32, channels: 3, background: '#eee' } }).jpeg().toBuffer();
    f.options.readImage.mockResolvedValueOnce({ mimeType: 'image/jpeg', buffer: image });
    const service = createProductPreparationWorkbenchService({ ...f.options, evaluateCapability: async () => ({ available: false, reasonCode: 'VISION_OFF', dailyLimit: 0 }),
      validateByokReadiness: async () => ({ available: true }) });
    const { operationKey: _operationKey, ...source } = f.input;
    const result = await service.image({ ...identity, deviceSessionId: 'actual-device' }, { ...source,
      providerContext: { providerOrigin: 'https://provider.example', model: 'qwen-vl-plus', policyRevision: 2 } });
    expect(result).toMatchObject({ mimeType: 'image/jpeg', width: 48, height: 32, sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(result.buffer).toEqual(image); expect(f.used()).toBe(0); expect(f.options.analyzeTransport).not.toHaveBeenCalled();
  });
  it.each(['device', 'foreign media'])('rejects %s before returning BYOK source image bytes', async kind => {
    const f = await setup(), service = createProductPreparationWorkbenchService({ ...f.options, validateByokReadiness: async () => ({ available: true }) });
    const { operationKey: _operationKey, ...source } = f.input;
    await expect(service.image({ ...identity, ...(kind === 'device' ? {} : { deviceSessionId: 'actual-device' }) }, { ...source,
      ...(kind === 'foreign media' ? { sourceMediaKeys: ['foreign'] } : {}), providerContext: { providerOrigin: 'https://provider.example', model: 'qwen-vl-plus', policyRevision: 2 } }))
      .rejects.toMatchObject({ statusCode: kind === 'device' ? 403 : 422 });
    expect(f.options.readImage).not.toHaveBeenCalled();
  });
  it('refuses promoting observations of one SKU to a product-level attribute shared by multiple SKUs', async () => {
    const f = await setup({ twoSkus: true }); await f.service.analyze(identity, f.input);
    await expect(f.service.apply(identity, { binding: f.input.binding, analysisInput: f.input, action: 'ATTRIBUTES', operationKey: 'reject-global-color-1', selectedAttributeIds: [10] }))
      .rejects.toMatchObject({ code: 'product_preparation_attribute_scope' });
    expect((await f.workflow.getDraft({ ownerUserId: 'owner', draftId: f.draft.id })).attributes.values['10']).toBeUndefined();
  });
  it('applies an official SKU-owned color only to the analyzed SKU, preserving the other reviewed leaf', async () => {
    const f = await setup({ twoSkus: true }), scopedSchema: OzonNormalizedAttributeSchema = { ...schema,
      fields: [{ ...field, ownership: 'SKU', editorMode: 'SKU_MATRIX' }] };
    f.options.loadAttributeContext.mockResolvedValue({ schema: scopedSchema, schemaRevision, dictionaries: { '10': [{ id: 100, value: 'Белый' }] } });
    await f.service.analyze(identity, f.input);
    const black = { value: 'Черный', source: 'SOURCE' as const, reviewed: true, evidence: ['observed-other-sku'],
      dictionaryMatch: { status: 'MATCHED' as const, dictionaryValueId: 101 } };
    const enriched = await f.workflow.setAttributeValues({ ownerUserId: 'owner', actorUserId: 'owner', draftId: f.draft.id, expectedRevision: f.draft.revision,
      values: { '10': { ...black, reviewed: false, skuValues: { 'sku-source-1': black } } } });
    const request = { binding: { ...f.input.binding, draftRevision: enriched.revision, draftVersion: enriched.draftVersion },
      analysisInput: f.input, action: 'ATTRIBUTES' as const, operationKey: 'scoped-color-1', selectedAttributeIds: [10] };
    const first = await f.service.apply(identity, request), current = await f.workflow.getDraft({ ownerUserId: 'owner', draftId: f.draft.id });
    expect(current.attributes.values['10']!.skuValues!['sku-source-0']).toMatchObject({ value: 'Белый', source: 'AI', reviewed: true });
    expect(current.attributes.values['10']!.skuValues!['sku-source-1']).toEqual(black);
    expect(current.attributes.values['10']!.reviewed).toBe(true);
    expect((await f.service.apply(identity, request)).binding).toEqual(first.binding);
  });
  it('keeps aggregate SKU review incomplete when only one of two selected SKU attributes has been confirmed', async () => {
    const f = await setup({ twoSkus: true }), scopedSchema: OzonNormalizedAttributeSchema = { ...schema,
      fields: [{ ...field, ownership: 'SKU', editorMode: 'SKU_MATRIX' }] };
    f.options.loadAttributeContext.mockResolvedValue({ schema: scopedSchema, schemaRevision, dictionaries: { '10': [{ id: 100, value: 'Белый' }] } });
    await f.service.analyze(identity, f.input);
    await f.service.apply(identity, { binding: f.input.binding, analysisInput: f.input, action: 'ATTRIBUTES', operationKey: 'scoped-one-review-1', selectedAttributeIds: [10] });
    const current = await f.workflow.getDraft({ ownerUserId: 'owner', draftId: f.draft.id });
    expect(current.attributes.values['10']!.reviewed).toBe(false);
    expect(current.attributes.values['10']!.skuValues!['sku-source-1']).toBeUndefined();
  });
});
describe('staged preparation checkpoints', () => {
  it('chooses up to three current-SKU images before five shared images while preserving curation eligibility', () => {
    const curation: Array<{ sourceMediaKey: string; decision: 'KEEP' | 'OMIT' | 'REVIEW'; reason: string }> = Array.from({ length: 12 }, (_, ordinal) => ({ sourceMediaKey: `media-${ordinal}`, decision: 'KEEP', reason: '清晰' }));
    expect(preparationVisualMediaKeys(curation, ['media-9', 'media-10', 'media-11', 'foreign'])).toEqual([
      'media-9', 'media-10', 'media-11', 'media-0', 'media-1', 'media-2', 'media-3', 'media-4',
    ]);
    curation[9]!.decision = 'OMIT';
    expect(preparationVisualMediaKeys(curation, ['media-9', 'media-10', 'media-11'])).toEqual([
      'media-10', 'media-11', 'media-0', 'media-1', 'media-2', 'media-3', 'media-4', 'media-5',
    ]);
  });
  const stageOutput = (stage: string, sourceMediaKeys = ['media-main-0']) => stage === 'CURATION'
    ? { curation: sourceMediaKeys.map(sourceMediaKey => ({ sourceMediaKey, decision: 'KEEP', reason: '商品清晰' })) }
    : stage === 'VISION' ? { visualDescription: report().visualDescription, productSummary: report().productSummary, skuObservations: report().skuObservations }
    : { suggestedAttributes: report().suggestedAttributes, copy: report().copy };
  it('advertises staged transport only when installed and tells users all three requests may consume separate quota/Provider fees', async () => {
    const f = await setup(), analyzeStageTransport = vi.fn(f.options.analyzeTransport);
    const installed = createProductPreparationWorkbenchService({ ...f.options, analyzeStageTransport });
    expect(await installed.capability(identity, f.input.binding)).toMatchObject({ stagedAnalysis: true,
      stages: ['CURATION', 'VISION', 'COPY'], providerFeeNotice: expect.stringContaining('三个') });
    expect(await f.service.capability(identity, f.input.binding)).toMatchObject({ stagedAnalysis: false });
    expect(analyzeStageTransport).not.toHaveBeenCalled();
  });
  it('persists each independent stage and resumes through restart without repeating completed requests or downloading COPY images', async () => {
    const f = await setup(); f.options.analyzeTransport.mockImplementation(async ({ prompt }) => ({
      text: JSON.stringify(stageOutput(prompt.includes('STAGE:CURATION') ? 'CURATION' : prompt.includes('STAGE:VISION') ? 'VISION' : 'COPY')), usage: null,
    }));
    const curation = await f.service.analyze(identity, { ...f.input, stage: 'CURATION' });
    expect(curation).toMatchObject({ stage: 'CURATION', curation: report().curation, replayed: false });
    const restarted = createProductPreparationWorkbenchService(f.options);
    expect(await restarted.read(identity, { ...f.input, stage: 'CURATION' })).toEqual({ ...curation, replayed: true });
    const vision = await restarted.analyze(identity, { ...f.input, stage: 'VISION' });
    expect(vision).toMatchObject({ stage: 'VISION', visualDescription: report().visualDescription });
    const beforeCopy = f.options.readImage.mock.calls.length;
    const copy = await restarted.analyze(identity, { ...f.input, stage: 'COPY' });
    expect(copy).toMatchObject({ stage: 'COPY', report: report() });
    expect(f.options.readImage).toHaveBeenCalledTimes(beforeCopy);
    expect(f.options.analyzeTransport.mock.calls.at(-1)![0].images).toEqual([]);
    expect((await restarted.analyze(identity, { ...f.input, stage: 'COPY' })).replayed).toBe(true);
    expect(f.options.analyzeTransport).toHaveBeenCalledTimes(3); expect(f.receipts.size).toBe(3); expect(f.used()).toBe(3);
    const applied = await restarted.apply(identity, { binding: f.input.binding, analysisInput: { ...f.input, stage: 'COPY' },
      action: 'ATTRIBUTES', operationKey: 'staged-apply-attributes', selectedAttributeIds: [10] });
    expect(applied.binding.draftRevision).toBeGreaterThan(f.draft.revision);
  });
  it('rejects missing or differently bound checkpoints before Provider dispatch or quota reservation', async () => {
    const f = await setup();
    for (const stage of ['VISION', 'COPY'] as const) await expect(f.service.analyze(identity, { ...f.input, stage }))
      .rejects.toMatchObject({ code: 'product_preparation_stage_required', outcome: 'NOT_SENT' });
    expect(f.options.analyzeTransport).not.toHaveBeenCalled(); expect(f.options.readImage).not.toHaveBeenCalled(); expect(f.used()).toBe(0);
    f.options.analyzeTransport.mockResolvedValueOnce({ text: JSON.stringify(stageOutput('CURATION')), usage: null });
    await f.service.analyze(identity, { ...f.input, stage: 'CURATION' });
    await expect(f.service.analyze(identity, { ...f.input, stage: 'VISION', operationKey: 'different-root-operation' }))
      .rejects.toMatchObject({ code: 'product_preparation_stage_required' });
    expect(f.options.analyzeTransport).toHaveBeenCalledTimes(1);
  });
  it('accepts 24 bound curation inputs, caps visual references at 8 and keeps the legacy five-image bound', async () => {
    const f = await setup({ mediaCount: 24 }), sourceMediaKeys = Array.from({ length: 24 }, (_, i) => `media-main-${i}`);
    f.options.analyzeTransport.mockImplementation(async ({ prompt }) => ({ text: JSON.stringify(stageOutput(prompt.includes('STAGE:CURATION') ? 'CURATION' : 'VISION', sourceMediaKeys)), usage: null }));
    await f.service.analyze(identity, { ...f.input, sourceMediaKeys, stage: 'CURATION' });
    expect(f.options.analyzeTransport.mock.calls[0]![0].images).toHaveLength(24);
    await f.service.analyze(identity, { ...f.input, sourceMediaKeys, stage: 'VISION' });
    expect(f.options.analyzeTransport.mock.calls[1]![0].images).toHaveLength(8);
    expect(f.options.analyzeTransport.mock.calls[1]![0].config.timeoutMs).toBe(180000);
    await expect(f.service.analyze(identity, { ...f.input, sourceMediaKeys, operationKey: 'legacy-too-many' })).rejects.toThrow();
    expect(f.options.analyzeTransport).toHaveBeenCalledTimes(2);
  });
  it('prepares references in bounded parallel batches without submitting until every required image is ready', async () => {
    const f = await setup({ mediaCount: 8 }), sourceMediaKeys = Array.from({ length: 8 }, (_, i) => `media-main-${i}`);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.options.readImage.mockImplementation(async () => { await gate; return { mimeType: 'image/jpeg', buffer: Buffer.from('fixture-safe') }; });
    f.options.analyzeTransport.mockResolvedValueOnce({ text: JSON.stringify(stageOutput('CURATION', sourceMediaKeys)), usage: null });
    const request = f.service.analyze(identity, { ...f.input, sourceMediaKeys, stage: 'CURATION' });
    try {
      await vi.waitFor(() => { expect(f.options.readImage).toHaveBeenCalledTimes(4); }, { timeout: 250, interval: 5 });
      expect(f.options.analyzeTransport).not.toHaveBeenCalled();
    } finally { release(); }
    expect(await request).toMatchObject({ stage: 'CURATION', sourceMediaKeys });
    expect(f.options.readImage).toHaveBeenCalledTimes(8); expect(f.options.analyzeTransport).toHaveBeenCalledTimes(1);
  });
  it('expires the complete image-preparation window at 20 seconds, releases NOT_SENT resources and fences later batches/Provider dispatch', async () => {
    const f = await setup({ mediaCount: 8 }), sourceMediaKeys = Array.from({ length: 8 }, (_, i) => `media-main-${i}`);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.options.readImage.mockImplementation(async () => { await gate; return { mimeType: 'image/jpeg', buffer: Buffer.from('fixture-safe') }; });
    f.options.analyzeTransport.mockResolvedValueOnce({ text: JSON.stringify(stageOutput('CURATION', sourceMediaKeys)), usage: null });
    vi.useFakeTimers();
    const request = f.service.analyze(identity, { ...f.input, sourceMediaKeys, stage: 'CURATION' });
    const outcome = request.then(() => null, error => error);
    try {
      await vi.waitFor(() => expect(f.options.readImage).toHaveBeenCalledTimes(4));
      await vi.advanceTimersByTimeAsync(20_000);
      expect(await outcome).toMatchObject({ code: 'product_preparation_image_preparation_timeout', outcome: 'NOT_SENT' });
      expect(f.records.size).toBe(0); expect(f.used()).toBe(0);
      expect(f.options.analyzeTransport).not.toHaveBeenCalled();
      release(); await vi.advanceTimersByTimeAsync(0);
      expect(f.options.readImage).toHaveBeenCalledTimes(4); expect(f.options.analyzeTransport).not.toHaveBeenCalled();
    } finally { release(); await outcome; vi.useRealTimers(); }
  });
  it('compiles bounded later-stage prompts from maximal curation reasons and long observations without truncating durable checkpoints', async () => {
    const f = await setup({ mediaCount: 24 }), sourceMediaKeys = Array.from({ length: 24 }, (_, i) => `media-main-${i}`);
    const curated = { curation: sourceMediaKeys.map(sourceMediaKey => ({ sourceMediaKey, decision: 'KEEP', reason: '清'.repeat(200) })) };
    const vision = report();
    for (const group of Object.values(vision.visualDescription.observations)) (group as string[]).push(...Array.from({ length: 4 }, () => '图'.repeat(90)));
    vision.productSummary.observations = vision.productSummary.uncertainties = vision.skuObservations[0]!.observations = Array.from({ length: 7 }, () => '观'.repeat(180));
    f.options.analyzeTransport.mockImplementation(async ({ prompt }) => ({ text: JSON.stringify(prompt.includes('STAGE:CURATION') ? curated
      : prompt.includes('STAGE:VISION') ? { visualDescription: vision.visualDescription, productSummary: vision.productSummary, skuObservations: vision.skuObservations }
      : { suggestedAttributes: report().suggestedAttributes, copy: report().copy }), usage: null }));
    for (const stage of ['CURATION', 'VISION'] as const) await f.service.analyze(identity, { ...f.input, sourceMediaKeys, stage });
    const copy = await f.service.analyze(identity, { ...f.input, sourceMediaKeys, stage: 'COPY' });
    expect(copy.report.curation).toEqual(curated.curation); expect(copy.report.productSummary).toEqual(vision.productSummary);
    expect(f.options.analyzeTransport.mock.calls.at(-1)![0].prompt).toContain('"attributeId":10');
    expect(f.options.analyzeTransport.mock.calls.at(-1)![0].prompt).toContain('Белый');
    for (const call of f.options.analyzeTransport.mock.calls) expect(Buffer.byteLength(call[0].prompt, 'utf8')).toBeLessThanOrEqual(16 * 1024);
    expect(f.options.analyzeTransport).toHaveBeenCalledTimes(3);
  });
  it('keeps a stalled stage frozen, exposes a safe transport classification and leaves earlier checkpoint recoverable', async () => {
    const f = await setup();
    f.options.analyzeTransport.mockResolvedValueOnce({ text: JSON.stringify(stageOutput('CURATION')), usage: null });
    await f.service.analyze(identity, { ...f.input, stage: 'CURATION' });
    f.options.analyzeTransport.mockRejectedValue(Object.assign(new Error('secret-sentinel'), { code: 'PRODUCT_VISION_TIMEOUT', outcome: 'UNKNOWN_OUTCOME' }));
    const input = { ...f.input, stage: 'VISION' as const };
    await expect(f.service.analyze(identity, input)).rejects.toMatchObject({ stage: 'VISION', failureKind: 'TRANSPORT_UNKNOWN', failureCode: 'product_vision_timeout', outcome: 'UNKNOWN_OUTCOME' });
    await expect(f.service.analyze(identity, input)).rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
    await expect(createProductPreparationWorkbenchService(f.options).read(identity, input))
      .rejects.toMatchObject({ stage: 'VISION', failureKind: 'TRANSPORT_UNKNOWN', failureCode: 'product_vision_timeout', outcome: 'UNKNOWN_OUTCOME' });
    expect(await f.service.read(identity, { ...f.input, stage: 'CURATION' })).toMatchObject({ stage: 'CURATION', replayed: true });
    expect(f.options.analyzeTransport).toHaveBeenCalledTimes(2); expect(f.used()).toBe(2);
  });
  it('distinguishes a received invalid JSON candidate from an unanswered Provider request without exposing text or automatically resending', async () => {
    const f = await setup(); f.options.analyzeTransport.mockResolvedValueOnce({ text: 'invalid secret-sentinel', usage: null });
    await expect(f.service.analyze(identity, { ...f.input, stage: 'CURATION' }))
      .rejects.toMatchObject({ failureKind: 'RESPONSE_INVALID', failureCode: 'product_preparation_response_invalid', outcome: 'UNKNOWN_OUTCOME' });
    await expect(f.service.analyze(identity, { ...f.input, stage: 'CURATION' })).rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
    expect(JSON.stringify([...f.failures.values()])).not.toContain('secret-sentinel');
    expect(f.receipts.size).toBe(0); expect(f.options.analyzeTransport).toHaveBeenCalledTimes(1);
  });
});
describe('preparation report hostile output validation', () => {
  const context = { skuKey: 'sku-source-0', sourceMediaKeys: ['media-main-0'], schema, dictionaries: { '10': [{ id: 100, value: 'Белый' }] } };
  it.each(['foreign media', 'foreign sku', 'dictionary mismatch', 'material inference', 'credential', 'approved report'])('rejects %s', kind => {
    const value = report();
    if (kind === 'foreign media') value.curation[0]!.sourceMediaKey = 'foreign';
    if (kind === 'foreign sku') value.skuObservations[0]!.skuKey = 'foreign';
    if (kind === 'dictionary mismatch') value.suggestedAttributes[0]!.dictionaryValueId = 999;
    if (kind === 'material inference') { value.suggestedAttributes[0]!.attributeId = 20; }
    if (kind === 'credential') value.copy.descriptionRu = 'Bearer secret-token';
    if (kind === 'approved report') value.reviewState = 'APPROVED';
    const ownContext = kind === 'material inference' ? { ...context, schema: { ...schema, fields: [{ ...field, attributeId: 20, name: 'Материал' }] } } : context;
    expect(() => normalizeProductPreparationReport(value, ownContext)).toThrow();
  });
});
it('device route requires existing scope/shop/gate contract before preparation owner', async () => {
  const f = await setup(), app = Fastify();
  await app.register(extensionProductPreparationRoutes, { prefix: '/api/extension-device/source-workbench', service: f.service,
    authenticateDevice: async request => { (request as any).device = { ...identity, sessionId: 'device', scopes: ['listing:review'] }; },
    featureFlags: { evaluate: async () => ({ enabled: true, reason: 'pilot', listingStage: 'dual_read' }) } });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/preparation/analyze', payload: f.input });
    expect(response.statusCode).toBe(403); expect(f.options.loadOwnedSnapshot).not.toHaveBeenCalled();
  } finally { await app.close(); }
});
it('isolates durable preparation claim and receipts from old vision namespaces', async () => {
  const queryUnsafe = vi.fn(async () => []);
  const client = { $queryRaw: vi.fn(async () => []), $executeRaw: vi.fn(async () => 1), $queryRawUnsafe: queryUnsafe,
    $transaction: async <T>(callback: (tx: { $queryRawUnsafe: typeof queryUnsafe }) => Promise<T>) => callback({ $queryRawUnsafe: queryUnsafe }) };
  const store = createPrismaProductPreparationOperationStore({ client: client as never });
  const input = { ownerUserId: 'owner', draftId: 'draft', operationKey: 'operation-1', clientRequestHash: 'a'.repeat(64) };
  await store.claim(input);
  expect(queryUnsafe.mock.calls.flat(3)).toContain('preparation:operation-1');
  await store.findReceipt(input);
  expect(client.$queryRaw.mock.calls.flat(3)).toContain('product-preparation-receipt');
  await store.saveReceipt(input, { clientRequestHash: input.clientRequestHash, promptContract: PRODUCT_PREPARATION_PROMPT_CONTRACT,
    result: report(), provider: 'custom', model: 'fixture', providerConfigHash: 'b'.repeat(64), usage: null });
  expect(client.$executeRaw.mock.calls.flat(3)).toContain('product-preparation-receipt');
});
it.each(['caller identity', 'foreign actor', 'foreign shop', 'missing session', 'legacy scope', 'old draft', 'legacy URL', 'disabled gate'])(
  'rejects %s across the actual device preparation route before Provider dispatch', async kind => {
    const f = await setup(), app = Fastify();
    const device = { ...identity, sessionId: 'actual-session', scopes: ['listing:review', 'listing:write', 'media:execute'] };
    if (kind === 'foreign actor') device.actorUserId = 'foreign';
    if (kind === 'foreign shop') device.allowedShopIds = ['foreign'];
    if (kind === 'missing session') device.sessionId = undefined as never;
    if (kind === 'legacy scope') device.scopes = ['listing:review', 'media:generate'];
    await app.register(extensionProductPreparationRoutes, { prefix: '/api/extension-device/source-workbench', service: f.service,
      authenticateDevice: async request => { (request as any).device = device; },
      featureFlags: { evaluate: async () => ({ enabled: kind !== 'disabled gate', reason: 'fixture', listingStage: 'dual_read' }) } });
    try {
      const payload = { ...f.input, ...(kind === 'caller identity' ? { ownerUserId: 'foreign', deviceSessionId: 'client-spoof' } : {}),
        ...(kind === 'old draft' ? { binding: { ...f.input.binding, draftVersion: f.input.binding.draftVersion + 1 } } : {}),
        ...(kind === 'legacy URL' ? { sourceMediaKeys: ['https://foreign.example/image'] } : {}) };
      const response = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/preparation/analyze', payload });
      const expected = kind === 'caller identity' ? 400 : ['foreign actor', 'missing session'].includes(kind) ? 401
        : ['foreign shop', 'legacy scope'].includes(kind) ? 403 : kind === 'legacy URL' ? 422 : 409;
      expect(response.statusCode).toBe(expected); expect(f.options.analyzeTransport).not.toHaveBeenCalled(); expect(f.options.readImage).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
it('returns raw binary image headers only from actual device analysis authorization', async () => {
  const f = await setup(), app = Fastify(), jpeg = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#aaa' } }).jpeg().toBuffer();
  f.options.readImage.mockResolvedValueOnce({ mimeType: 'image/jpeg', buffer: jpeg });
  const validateByokReadiness = vi.fn(async () => ({ available: true }));
  await app.register(extensionProductPreparationRoutes, { prefix: '/api/extension-device/source-workbench',
    service: createProductPreparationWorkbenchService({ ...f.options, validateByokReadiness }),
    authenticateDevice: async request => { (request as any).device = { ...identity, sessionId: 'actual-session', scopes: ['listing:review', 'listing:write', 'media:execute'] }; },
    featureFlags: { evaluate: async () => ({ enabled: true, reason: 'fixture', listingStage: 'dual_read' }) } });
  try {
    const { operationKey: _operationKey, ...context } = f.input;
    const response = await app.inject({ method: 'POST', url: '/api/extension-device/source-workbench/preparation/image',
      payload: { ...context, providerContext: { providerOrigin: 'https://provider.example', model: 'fixture', policyRevision: 2 } } });
    expect(response.statusCode).toBe(200); expect(response.rawPayload).toEqual(jpeg);
    expect(response.headers).toMatchObject({ 'content-type': 'image/jpeg', 'content-length': String(jpeg.length),
      'x-ss-erp-media-width': '32', 'x-ss-erp-media-height': '24', 'x-ss-erp-media-sha256': expect.stringMatching(/^[a-f0-9]{64}$/u) });
    expect(validateByokReadiness).toHaveBeenCalledWith(expect.objectContaining({ identity: expect.objectContaining({ deviceSessionId: 'actual-session' }) }));
  } finally { await app.close(); }
});

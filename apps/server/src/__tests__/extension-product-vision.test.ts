import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Fastify from 'fastify';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { createSourceProductCaptureV2Submission, type SourceProductCaptureV2Submission } from 'shared';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createProductVisionWorkbenchService, readProductVisionImage, type ProductVisionWorkbenchOptions } from '../services/product-vision-workbench.js';
import { extensionProductVisionRoutes } from '../routes/extension-product-vision.js';
import { createPrismaProductVisionOperationStore, PRODUCT_VISION_PROMPT_CONTRACT,
  type ProductVisionOperationStore, type ProductVisionReceipt, type ProductVisionOperationIdentity } from '../services/product-vision-operation-store.js';
import type { AiUsageStore } from '../services/ai-usage.js';

const rawCapture = JSON.parse(readFileSync(new URL('../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json', import.meta.url), 'utf8')) as SourceProductCaptureV2Submission;
const path = '/api/extension-device/source-workbench/vision';
const visualDescription = { composition: '居中展示当前商品', background: '浅色背景', lighting: '柔和光线', style: '电商实物风格',
  observations: { colors: ['白色'], shapes: ['长方形'], visibleComponents: ['提手'], visibleText: ['30 cm'] } };
const identityKey = (input: ProductVisionOperationIdentity) => JSON.stringify([input.ownerUserId, input.draftId, input.operationKey]);

it('resolves the existing URL-free media alias against the owned capture without returning source URLs', async () => {
  const rawKey = 'media:image|product_main|0|https://cbu01.alicdn.com/fixture-reference.jpg';
  const fixture = await setup({ mutateCapture: capture => {
    const previous = capture.media[0]!.key;
    capture.media[0]!.key = rawKey;
    for (const sku of capture.skus) sku.mediaKeys = sku.mediaKeys.map(key => key === previous ? rawKey : key);
  } });
  try {
    const alias = 'media-key-sha256:' + createHash('sha256').update(rawKey).digest('hex');
    const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: { ...fixture.request, sourceMediaKeys: [alias] } });
    expect(response.statusCode, JSON.stringify(response.json())).toBe(200);
    expect(response.json().data.sourceMediaKeys).toEqual([alias]);
    expect(JSON.stringify(response.json())).not.toContain('https://');
    expect(fixture.analyzeTransport).toHaveBeenCalledTimes(1);
  } finally { await fixture.app.close(); }
});

function operationStore() {
  const records = new Map<string, { id: string; hash: string; status: string }>();
  const receipts = new Map<string, ProductVisionReceipt>();
  const store: ProductVisionOperationStore = {
    claim: vi.fn<ProductVisionOperationStore['claim']>(async (input) => {
      const key = identityKey(input), existing = records.get(key);
      if (!existing) { const id = String(records.size + 1); records.set(key, { id, hash: input.clientRequestHash, status: 'claimed' }); return { kind: 'claimed', executionId: id }; }
      return { kind: existing.hash !== input.clientRequestHash ? 'conflict' : existing.status === 'succeeded' ? 'replay'
        : existing.status === 'unknown' ? 'unknown' : 'in_progress', executionId: existing.id };
    }),
    complete: vi.fn(async (id) => { for (const row of records.values()) if (row.id === id) row.status = 'succeeded'; }),
    release: vi.fn(async (id) => { for (const [key, row] of records) if (row.id === id && row.status === 'claimed') records.delete(key); }),
    markUnknown: vi.fn(async (id) => { for (const row of records.values()) if (row.id === id) row.status = 'unknown'; }),
    findReceipt: vi.fn(async (input) => { const receipt = receipts.get(identityKey(input)); return receipt && receipt.clientRequestHash === input.clientRequestHash ? structuredClone(receipt) : null; }),
    saveReceipt: vi.fn(async (input, receipt) => { receipts.set(identityKey(input), structuredClone(receipt)); }),
  };
  return { store, records, receipts };
}

async function setup(input: { scopes?: string[]; shops?: string[]; enabled?: boolean; dailyLimit?: number; mutateCapture?:(capture: SourceProductCaptureV2Submission['capture']) => void } = {}) {
  const mutable = structuredClone(rawCapture.capture);
  input.mutateCapture?.(mutable);
  for (const count of mutable.counts) if (['/skus', '/media'].includes(count.fieldPath)) {
    const length = count.fieldPath === '/skus' ? mutable.skus.length : mutable.media.length;
    count.totalCount = count.capturedCount = count.submittedCount = length;
  }
  const capture = await createSourceProductCaptureV2Submission(mutable);
  const workflow = createSourceListingWorkflowService({ repository: new InMemoryOzonListingDraftRepository() });
  const draft = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods',
    sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: capture.captureHash, selectedSkuKeys: ['sku-source-0'] });
  const operation = operationStore();
  let used = 0;
  const usageStore: AiUsageStore = {
    getDailySummary: async () => ({ requestCount: used, cacheHitCount: 0, failureCount: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }),
    record: vi.fn(async () => {}),
    reserveDailyLimit: vi.fn(async ({ limit }) => { const allowed = used < limit; if (allowed) used++; return { allowed, used, remaining: Math.max(0, limit - used), limit }; }),
    releaseDailyReservation: vi.fn(async () => { used--; }),
  };
  const image = { mimeType: 'image/jpeg' as const, buffer: await sharp({ create: { width: 64, height: 64, channels: 3, background: '#eee' } }).jpeg().toBuffer() };
  const readImage = vi.fn(async () => image);
  const analyzeTransport = vi.fn(async () => ({ text: JSON.stringify(visualDescription), usage: { promptTokens: 10, completionTokens: 20 } }));
  const evaluateCapability = vi.fn(async () => ({ available: input.enabled !== false, reasonCode: input.enabled === false ? 'VISION_OFF' : 'AVAILABLE', dailyLimit: input.dailyLimit ?? 20,
    config: { provider: 'custom' as const, baseUrl: 'https://provider.example/v1', apiKey: 'fixture-key-never-return', model: 'fixture-vision' } }));
  const options: ProductVisionWorkbenchOptions = { workflow, usageStore, operationStore: operation.store, evaluateCapability, readImage, analyzeTransport,
    loadOwnedSnapshot: vi.fn(async () => ({ id: 'snapshot', captureHash: capture.captureHash, payloadBytes: capture.payloadBytes, payload: capture.capture })),
    ownership: { assertOwnedTarget: vi.fn(async () => ({ shopId: 'shop', supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot',
      sourceCaptureHash: capture.captureHash, selectedSkuKeys: draft.selectedSkuKeys })) },
    now: () => new Date('2026-10-04T00:00:00.000Z'),
  };
  const service = createProductVisionWorkbenchService(options), app = Fastify();
  await app.register(extensionProductVisionRoutes, { prefix: '/api/extension-device/source-workbench', service,
    featureFlags: { evaluate: async () => ({ enabled: true, reason: 'pilot_match', listingStage: 'dual_read' }) },
    authenticateDevice: async (request) => { (request as any).device = { ownerUserId: 'owner', actorUserId: 'owner', sessionId: 'device',
      scopes: input.scopes ?? ['listing:review', 'listing:write', 'media:execute'], allowedShopIds: input.shops ?? ['shop'] }; },
  });
  const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: draft.id,
    draftRevision: draft.revision, draftVersion: draft.draftVersion };
  const request = { binding, skuKey: 'sku-source-0', sourceMediaKeys: ['media-main-0'], operationKey: 'vision-extension-test-1' };
  return { app, workflow, draft, binding, request, service, options, capture, readImage, analyzeTransport, evaluateCapability, usageStore, operation, used: () => used };
}

describe('device product vision workbench', () => {
  it('analyzes a copied offer using its original source images while retaining the copy target and frozen original capture', async () => {
    const fixture = await setup();
    try {
      const source = await fixture.workflow.changeSkuSelection({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id,
        expectedRevision: fixture.draft.revision, selectedSkuKeys: ['sku-0'] });
      const copied = await fixture.workflow.duplicateSku({ ownerUserId: 'owner', actorUserId: 'owner', draftId: source.id,
        expectedRevision: source.revision, expectedDraftVersion: source.draftVersion, operationKey: 'vision-copy-operation', sourceSkuKey: 'sku-0' });
      const copyKey = copied.offerRows!.rows[0]!.rowKey;
      const request = { ...fixture.request, binding: { ...fixture.binding, draftRevision: copied.revision, draftVersion: copied.draftVersion }, skuKey: copyKey };
      const result = await fixture.service.analyze({ ownerUserId: 'owner', actorUserId: 'owner', allowedShopIds: ['shop'] }, request);
      expect(result.skuKey).toBe(copyKey);
      expect(fixture.capture.capture.skus).toHaveLength(1);
      expect(fixture.analyzeTransport).toHaveBeenCalledTimes(1);
    } finally { await fixture.app.close(); }
  });
  it('reports a bounded read-only capability without model or secret disclosure', async () => {
    const fixture = await setup({ scopes: ['listing:review'] });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${path}/capability`, payload: { binding: fixture.binding } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ available: true, reasonCode: 'AVAILABLE', providerFeeNotice: expect.stringContaining('Provider') });
      expect(JSON.stringify(response.json())).not.toMatch(/fixture-key|config|baseUrl|dailyLimit|model/);
      expect(fixture.readImage).not.toHaveBeenCalled(); expect(fixture.analyzeTransport).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });
  it('analyzes accepted current source images as editable observations without changing draft facts or plans', async () => {
    const fixture = await setup();
    try {
      const before = await fixture.workflow.getDraft({ ownerUserId: 'owner', draftId: fixture.draft.id });
      const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toEqual({ binding: fixture.binding, skuKey: 'sku-source-0', sourceMediaKeys: ['media-main-0'],
        operationKey: fixture.request.operationKey, visualDescription, replayed: false });
      expect(fixture.used()).toBe(1);
      expect(fixture.analyzeTransport).toHaveBeenCalledWith(expect.objectContaining({ images: [expect.objectContaining({ mimeType: 'image/jpeg', buffer: expect.any(Buffer) })] }));
      expect(await fixture.workflow.getDraft({ ownerUserId: 'owner', draftId: fixture.draft.id })).toEqual(before);
      expect(JSON.stringify(response.json())).not.toMatch(/verifiedFacts|apiKey|fixture-key|providerConfigHash|https?:/);
    } finally { await fixture.app.close(); }
  });
  it('replays across a new service instance and configuration change, with no quota/download/model call', async () => {
    const fixture = await setup();
    try {
      const first = await fixture.service.analyze({ ownerUserId: 'owner', actorUserId: 'owner', allowedShopIds: ['shop'] }, fixture.request);
      fixture.evaluateCapability.mockResolvedValue({ available: false, reasonCode: 'VISION_OFF', dailyLimit: 0,
        config: { provider: 'custom', baseUrl: 'https://new.example/v1', apiKey: 'changed', model: 'changed' } });
      const next = await fixture.workflow.setPricing({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id, expectedRevision: fixture.draft.revision,
        value: { contractVersion: 'ozon-listing-pricing/v1', items: [{ skuKey: 'sku-source-0', price: '100', oldPrice: '120', currencyCode: 'CNY', vat: '0' }] } });
      const restored = createProductVisionWorkbenchService(fixture.options);
      const replay = await restored.analyze({ ownerUserId: 'owner', actorUserId: 'owner', allowedShopIds: ['shop'] }, fixture.request);
      expect(replay).toEqual({ ...first, replayed: true });
      expect(replay.binding.draftRevision).not.toBe(next.revision);
      expect(fixture.used()).toBe(1); expect(fixture.readImage).toHaveBeenCalledTimes(1); expect(fixture.analyzeTransport).toHaveBeenCalledTimes(1);
    } finally { await fixture.app.close(); }
  });
  it('coalesces simultaneous same-key requests and rejects changed-input reuse', async () => {
    const fixture = await setup();
    try {
      const responses = await Promise.all([0, 1].map(() => fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request })));
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(responses.map((response) => response.json().data.replayed).sort()).toEqual([false, true]);
      const changed = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: { ...fixture.request, skuKey: 'sku-0' } });
      expect(changed.statusCode).toBe(409); expect(fixture.analyzeTransport).toHaveBeenCalledTimes(1); expect(fixture.used()).toBe(1);
    } finally { await fixture.app.close(); }
  });
  it.each([
    [['listing:review', 'listing:write'], ['shop'], 403],
    [['listing:review', 'media:execute'], ['shop'], 403],
    [['listing:write', 'media:execute'], ['shop'], 401],
    [['listing:review', 'listing:write', 'media:execute'], ['foreign'], 403],
  ])('requires existing review/write/media permissions and shop grant before reading source', async (scopes, shops, status) => {
    const fixture = await setup({ scopes: scopes as string[], shops: shops as string[] });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(response.statusCode).toBe(status); expect(fixture.options.loadOwnedSnapshot).not.toHaveBeenCalled(); expect(fixture.analyzeTransport).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });
  it.each(['snapshotId', 'supplyGoodsId', 'draftRevision', 'draftVersion'] as const)('rejects a fresh operation with stale %s without downloading', async (field) => {
    const fixture = await setup();
    try {
      const binding = { ...fixture.binding, [field]: typeof fixture.binding[field] === 'number' ? Number(fixture.binding[field]) + 1 : 'changed' };
      const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: { ...fixture.request, binding } });
      expect(response.statusCode).toBe(409); expect(fixture.readImage).not.toHaveBeenCalled(); expect(fixture.used()).toBe(0);
    } finally { await fixture.app.close(); }
  });
  it('enforces feature and quota before image downloads or Provider submission', async () => {
    for (const input of [{ enabled: false }, { dailyLimit: 0 }]) {
      const fixture = await setup(input);
      try {
        const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
        expect(response.statusCode).toBe(input.enabled === false ? 503 : 429);
        expect(fixture.readImage).not.toHaveBeenCalled(); expect(fixture.analyzeTransport).not.toHaveBeenCalled(); expect(fixture.used()).toBe(0);
      } finally { await fixture.app.close(); }
    }
  });
  it('rejects tampered snapshot integrity before downloading', async () => {
    const fixture = await setup(); fixture.capture.capture.facts.title = 'tampered';
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(response.statusCode).toBe(409); expect(fixture.readImage).not.toHaveBeenCalled(); expect(fixture.used()).toBe(0);
    } finally { await fixture.app.close(); }
  });
  it.each([
    { skuKey: 'foreign' }, { sourceMediaKeys: ['foreign'] }, { sourceMediaKeys: [] }, { sourceMediaKeys: ['media-main-0', 'media-main-0'] },
    { sourceMediaKeys: Array(6).fill('media-main-0') }, { sourceMediaKeys: ['http://127.0.0.1/image'] }, { url: 'file:///secret' },
    { apiKey: 'client-key' }, { operationKey: 'short' }, { verifiedFacts: { dimensions: 'invented' } },
  ])('rejects unsupported source selections and caller-owned authority', async (extra) => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: { ...fixture.request, ...extra } });
      expect([400, 403, 409, 422]).toContain(response.statusCode); expect(fixture.readImage).not.toHaveBeenCalled(); expect(fixture.used()).toBe(0);
    } finally { await fixture.app.close(); }
  });
  it('refuses images bound only to another captured SKU', async () => {
    const fixture = await setup({ mutateCapture: (capture) => {
      const other = { ...structuredClone(capture.skus[0]!), key: 'sku-other', sourceSkuId: 'source-other', ordinal: 1 };
      other.fieldEvidence.sourceSkuId.value = 'source-other'; capture.skus.push(other); capture.media[0]!.skuKeys = ['sku-other'];
    } });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(response.statusCode).toBe(422); expect(fixture.used()).toBe(0); expect(fixture.readImage).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });
  it('refuses an unbound SKU-role image instead of treating it as a shared product image', async () => {
    const fixture = await setup({ mutateCapture: (capture) => { capture.media[0]!.role = 'sku'; capture.media[0]!.fieldEvidence.role.value = 'sku'; } });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(response.statusCode).toBe(422); expect(fixture.readImage).not.toHaveBeenCalled(); expect(fixture.used()).toBe(0);
    } finally { await fixture.app.close(); }
  });
  it('rechecks the exact draft revision after downloading and before a Provider POST', async () => {
    const fixture = await setup(); const original = fixture.readImage.getMockImplementation()!;
    fixture.readImage.mockImplementationOnce(async () => {
      await fixture.workflow.setPricing({ ownerUserId: 'owner', actorUserId: 'owner', draftId: fixture.draft.id, expectedRevision: fixture.draft.revision,
        value: { contractVersion: 'ozon-listing-pricing/v1', items: [{ skuKey: 'sku-source-0', price: '100', oldPrice: '120', currencyCode: 'CNY', vat: '0' }] } });
      return original();
    });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(response.statusCode).toBe(409); expect(response.json().outcome).toBe('NOT_SUBMITTED');
      expect(fixture.analyzeTransport).not.toHaveBeenCalled(); expect(fixture.used()).toBe(0);
    } finally { await fixture.app.close(); }
  });
  it('rejects same-key requests with changed original binding revisions instead of returning a mismatched receipt', async () => {
    const fixture = await setup();
    try {
      const first = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(first.statusCode).toBe(200);
      const changed = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: { ...fixture.request,
        binding: { ...fixture.binding, draftRevision: fixture.binding.draftRevision + 1 } } });
      expect(changed.statusCode).toBe(409); expect(changed.json().errorCode).toBe('product_vision_operation_conflict');
      expect(fixture.analyzeTransport).toHaveBeenCalledTimes(1);
    } finally { await fixture.app.close(); }
  });
  it.each(['disabled', 'credential_changed'] as const)('rechecks %s capability after image download and releases a not-submitted reservation', async (mode) => {
    const fixture = await setup(); const first = await fixture.evaluateCapability(); fixture.evaluateCapability.mockClear();
    fixture.evaluateCapability.mockResolvedValueOnce(first).mockResolvedValueOnce(mode === 'disabled'
      ? { ...first, available: false, reasonCode: 'VISION_OFF' } : { ...first, config: { ...first.config, apiKey: 'changed-secret' } });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(response.statusCode).toBe(409); expect(response.json().outcome).toBe('NOT_SUBMITTED');
      expect(fixture.analyzeTransport).not.toHaveBeenCalled(); expect(fixture.used()).toBe(0);
    } finally { await fixture.app.close(); }
  });
  it('retains unknown Provider outcome and reservation across restart instead of resubmitting', async () => {
    const fixture = await setup(); fixture.analyzeTransport.mockRejectedValueOnce(Object.assign(new Error('safe unknown'), { outcome: 'UNKNOWN_OUTCOME' }));
    try {
      const first = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(first.statusCode).toBe(409); expect(first.json().outcome).toBe('UNKNOWN_OUTCOME'); expect(fixture.used()).toBe(1);
      await expect(createProductVisionWorkbenchService(fixture.options).analyze({ ownerUserId: 'owner', actorUserId: 'owner', allowedShopIds: ['shop'] }, fixture.request))
        .rejects.toMatchObject({ outcome: 'UNKNOWN_OUTCOME' });
      expect(fixture.analyzeTransport).toHaveBeenCalledTimes(1); expect(fixture.usageStore.releaseDailyReservation).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });
  it('releases a provably NOT_SENT request and permits the same-key controlled retry', async () => {
    const fixture = await setup(); fixture.analyzeTransport.mockRejectedValueOnce(Object.assign(new Error('not sent'), { outcome: 'NOT_SENT' }));
    try {
      const first = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(first.statusCode).toBe(503); expect(fixture.used()).toBe(0);
      const retry = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(retry.statusCode).toBe(200); expect(fixture.used()).toBe(1);
    } finally { await fixture.app.close(); }
  });
  it.each([
    'not JSON', JSON.stringify({ ...visualDescription, verifiedFacts: ['invented'] }),
    JSON.stringify({ ...visualDescription, composition: 'x'.repeat(61) }),
    JSON.stringify({ ...visualDescription, observations: { ...visualDescription.observations, colors: Array(11).fill('red') } }),
  ])('never returns invalid/oversized model JSON as a successful receipt', async (text) => {
    const fixture = await setup(); fixture.analyzeTransport.mockResolvedValueOnce({ text, usage: null as any });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(response.statusCode).toBe(409); expect(response.json().outcome).toBe('UNKNOWN_OUTCOME');
      expect(fixture.operation.store.saveReceipt).not.toHaveBeenCalled(); expect(fixture.used()).toBe(1);
    } finally { await fixture.app.close(); }
  });
  it('retains a missing durable receipt as unknown and never repeats its Provider call', async () => {
    const fixture = await setup(); vi.mocked(fixture.operation.store.saveReceipt).mockRejectedValueOnce(new Error('storage unavailable'));
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(response.statusCode).toBe(409); expect(fixture.used()).toBe(1);
      const retry = await fixture.app.inject({ method: 'POST', url: `${path}/analyze`, payload: fixture.request });
      expect(retry.statusCode).toBe(409); expect(fixture.analyzeTransport).toHaveBeenCalledTimes(1);
    } finally { await fixture.app.close(); }
  });
});

describe('vision image and receipt boundaries', () => {
  it('uses the existing source downloader to reject local/private URLs before network access', async () => {
    const fetch = vi.fn();
    for (const url of ['file:///private-image', 'http://127.0.0.1/image', 'https://10.0.0.1/image']) {
      await expect(readProductVisionImage(url, { fetch, lookup: async () => [{ address: '10.0.0.1', family: 4 }] })).rejects.toThrow();
    }
    expect(fetch).not.toHaveBeenCalled();
  });
  it('decodes and strips metadata into a bounded JPEG rather than forwarding source bytes', async () => {
    const source = await sharp({ create: { width: 1600, height: 1200, channels: 4, background: '#abc' } }).png().toBuffer();
    const image = await readProductVisionImage('https://source.example/image', { lookup: async () => [{ address: '93.184.216.34', family: 4 }],
      fetch: async () => new Response(source, { headers: { 'content-type': 'image/png' } }) });
    const metadata = await sharp(image.buffer).metadata();
    expect(image.mimeType).toBe('image/jpeg'); expect(image.buffer.length).toBeLessThanOrEqual(1024 * 1024);
    expect(metadata.format).toBe('jpeg'); expect(metadata.width).toBeLessThanOrEqual(1024); expect(metadata.exif).toBeUndefined();
  });
  it('rejects malformed image bytes and image pixel bombs', async () => {
    const bomb = await sharp({ create: { width: 4200, height: 4200, channels: 3, background: '#abc' } }).png().toBuffer();
    for (const bytes of [Buffer.from('not an image'), bomb]) {
      await expect(readProductVisionImage('https://source.example/image', { lookup: async () => [{ address: '93.184.216.34', family: 4 }],
        fetch: async () => new Response(bytes, { headers: { 'content-type': 'image/png' } }) })).rejects.toThrow();
    }
  });
  it('binds durable receipt lookup to owner/draft/key/request while allowing provider configuration changes', async () => {
    const query = vi.fn(async () => [{ outputText: JSON.stringify({ clientRequestHash: 'a'.repeat(64), promptContract: PRODUCT_VISION_PROMPT_CONTRACT,
      result: {}, provider: 'old-provider', model: 'old-model', providerConfigHash: 'b'.repeat(64), usage: null }) }]);
    const execute = vi.fn(async () => 1);
    const client = { $queryRaw: query, $executeRaw: execute, $queryRawUnsafe: vi.fn(), $transaction: vi.fn() };
    const store = createPrismaProductVisionOperationStore({ client: client as never });
    const identity = { ownerUserId: 'owner', draftId: 'draft', operationKey: 'vision-op-1', clientRequestHash: 'a'.repeat(64) };
    expect((await store.findReceipt(identity))?.model).toBe('old-model');
    const firstArguments = query.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(firstArguments[0].join('?')).not.toMatch(/"provider"\s*=|"model"\s*=/);
    await store.findReceipt({ ...identity, ownerUserId: 'foreign' });
    const foreignArguments = query.mock.calls[1] as unknown as [TemplateStringsArray, ...unknown[]];
    expect(firstArguments.slice(1)).not.toEqual(foreignArguments.slice(1));
    await expect(store.saveReceipt(identity, { clientRequestHash: 'wrong', promptContract: PRODUCT_VISION_PROMPT_CONTRACT,
      result: {}, provider: 'custom', model: 'vision', providerConfigHash: 'b'.repeat(64), usage: null })).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
});

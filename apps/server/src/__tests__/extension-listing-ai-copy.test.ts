import { readFileSync } from 'node:fs';
import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { SourceProductCaptureV2Submission } from 'shared';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { createSourceListingAiCopyService, type SourceListingAiCopyServiceOptions } from '../services/source-listing-ai-copy.js';
import { createSourceListingCopyEditorService } from '../services/source-listing-copy-editor.js';
import { createExtensionListingEditorService } from '../services/extension-listing-editor.js';
import { extensionListingEditorRoutes } from '../routes/extension-listing-editor.js';
import { buildSourceProductProfileFromCapture } from '../services/source-product-profile.js';
import { compileProductContentRequest } from '../services/product-content-ai.js';
import type { AiListingCopyCapability } from '../services/ai-listing-copy-capability.js';

const capture = JSON.parse(readFileSync(new URL('../../../../scripts/fixtures/source-collect/1688/minimal-v2-submission.sanitized.json', import.meta.url), 'utf8')) as SourceProductCaptureV2Submission;
const prefix = '/api/extension-device/source-workbench/editor';

async function setup(options: { scopes?: string[]; shops?: string[]; enabled?: boolean; prerequisites?: boolean } = {}) {
  const workflow = createSourceListingWorkflowService({ repository: new InMemoryOzonListingDraftRepository() });
  let draft = await workflow.createDraft({ ownerUserId: 'owner', actorUserId: 'owner', shopId: 'shop', supplyGoodsId: 'goods',
    sourceCaptureSnapshotId: 'snapshot', sourceCaptureHash: capture.captureHash, selectedSkuKeys: [capture.capture.skus[0]!.key] });
  if (options.prerequisites !== false) {
    draft = await workflow.setCategory({ draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: draft.revision,
      category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog', categoryName: 'Одежда' } });
    draft = await workflow.setAttributeValues({ draftId: draft.id, ownerUserId: 'owner', actorUserId: 'owner', expectedRevision: draft.revision,
      values: { '10': { value: 'Хлопок', source: 'MANUAL', reviewed: true, evidence: ['operator-confirmed'] } } });
  }
  const generateContent = vi.fn<SourceListingAiCopyServiceOptions['generateContent']>(async (input) => {
    const drafts = Object.fromEntries(input.fields.map((field) => {
      const prompt = input.prompts[field]!;
      const request = compileProductContentRequest(field, prompt.resolved.resolvedPrompt, prompt.resolved.resolvedNegativePrompt, prompt.registryAuthority);
      return [field, { text: field === 'title' ? 'Женская хлопковая футболка' : 'Женская футболка из хлопка для повседневной носки.',
        source: 'provider', provider: 'fixture-text', model: 'fixture-v1', promptHash: request.promptHash,
        providerRequestHash: request.providerRequestHash, providerConfigHash: 'a'.repeat(64), compileContractVersion: request.compileContractVersion,
        generatedAt: '2026-10-04T00:00:00.000Z', usage: null }];
    }));
    return { ok: true, drafts, limit: { used: 2, remaining: 18, limit: 20 } };
  });
  const profile = buildSourceProductProfileFromCapture(capture.capture, { itemId: capture.captureHash, captureHash: capture.captureHash });
  const aiCopyWorkflow = createSourceListingAiCopyService({ workflow, generateContent,
    loadOwnedSnapshot: async ({ ownerUserId, snapshotId }) => ownerUserId === 'owner' && snapshotId === 'snapshot'
      ? { id: snapshotId, captureHash: capture.captureHash, payloadBytes: capture.payloadBytes, payload: structuredClone(capture.capture), profileHash: profile.hash } : null,
    resolveTemplate: async ({ templateKey }) => ({ templateKey, release: { id: 'release', revisionId: 'revision', sequence: 1 }, checksum: 'b'.repeat(64),
      snapshot: { templateKey, releaseId: 'release', revisionId: 'revision', sequence: 1, checksum: 'b'.repeat(64),
        promptTemplate: 'Facts: {{source_facts_json}}', negativePromptTemplate: 'Forbidden: {{forbidden_claims}}',
        outputMode: 'listing_copy_candidate', variableSchemaVersion: 1, consumer: null,
        variableKeys: { prompt: ['sourceFactsJson'], negativePrompt: ['forbiddenClaims'] } },
      resolvedPrompt: 'Use only source facts', resolvedNegativePrompt: 'Do not invent facts', outputMode: 'listing_copy_candidate' }),
  });
  const evaluateAiCopyCapability = vi.fn(async (): Promise<AiListingCopyCapability> => ({ enabled: options.enabled !== false, revision: 1,
    reason: options.enabled === false ? 'listing_copy_off' : 'tenant_allowed' }));
  const service = createExtensionListingEditorService({ workflow, aiCopyWorkflow, evaluateAiCopyCapability,
    copyEditor: createSourceListingCopyEditorService({ workflow }),
    ownership: { assertOwnedTarget: async () => ({ shopId: 'shop', supplyGoodsId: 'goods', sourceCaptureSnapshotId: 'snapshot',
      sourceCaptureHash: capture.captureHash, selectedSkuKeys: draft.selectedSkuKeys }) },
    loadCatalog: async () => ({ revision: 'catalog', entries: [] }),
  });
  const app = Fastify();
  await app.register(extensionListingEditorRoutes, { prefix: '/api/extension-device/source-workbench', service,
    featureFlags: { evaluate: async () => ({ enabled: true, reason: 'pilot_match', listingStage: 'dual_read' }) },
    authenticateDevice: async (request) => { (request as any).device = { ownerUserId: 'owner', actorUserId: 'owner', sessionId: 'device',
      scopes: options.scopes ?? ['listing:review', 'listing:write'], allowedShopIds: options.shops ?? ['shop'] }; },
  });
  const binding = { snapshotId: 'snapshot', supplyGoodsId: 'goods', shopId: 'shop', listingWorkflowId: draft.id,
    draftRevision: draft.revision, draftVersion: draft.draftVersion };
  return { app, binding, draft, workflow, aiCopyWorkflow, service, generateContent, evaluateAiCopyCapability };
}
const request = (binding: Awaited<ReturnType<typeof setup>>['binding']) => ({ binding, operationKey: 'generate-copy-extension-1', fields: ['title', 'description'] });

describe('device-scoped generated copy editor', () => {
  it('reports availability and fee notice through a read-only bounded projection', async () => {
    const fixture = await setup({ scopes: ['listing:review'] });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/copy-capability`, payload: { binding: fixture.binding } });
      expect(response.statusCode).toBe(200);
      expect(response.json().data).toMatchObject({ available: true, reasonCode: 'AVAILABLE', providerFeeNotice: expect.stringContaining('Provider') });
      expect(JSON.stringify(response.json())).not.toMatch(/apiKey|baseUrl|revision|ownerUserId|model|token/i);
      expect(fixture.generateContent).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });
  it('generates a visible pending candidate, applies only after approval, and replays without another model call', async () => {
    const fixture = await setup();
    try {
      const payload = request(fixture.binding);
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/copy-generate`, payload });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body).toMatchObject({ code: 1, replayed: false, candidateId: expect.any(String), limit: { used: 2, remaining: 18, limit: 20 },
        data: { copy: { titleRu: null, descriptionRu: null, pendingCandidates: [{ titleRu: 'Женская хлопковая футболка', sourceCurrent: true }] } } });
      expect(JSON.stringify(body.data.copy)).not.toMatch(/generation|provider|sourceCaptureHash|draftContextHash|frozenRequest/i);
      const replay = await fixture.app.inject({ method: 'POST', url: `${prefix}/copy-generate`, payload });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ candidateId: body.candidateId, replayed: true });
      expect(fixture.generateContent).toHaveBeenCalledTimes(1);
      const changed = await fixture.app.inject({ method: 'POST', url: `${prefix}/copy-generate`, payload: { ...payload, fields: ['title'] } });
      expect(changed.statusCode).toBe(409);
      expect(changed.json().errorCode).toBe('ozon_listing_ai_generation_operation_conflict');
      const approval = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: { binding: body.data.binding,
        operationKey: 'approve-generated-copy-1', action: 'COPY_APPROVE', value: { candidateId: body.candidateId } } });
      expect(approval.statusCode).toBe(200);
      expect(approval.json().data.copy).toMatchObject({ titleRu: 'Женская хлопковая футболка', pendingCandidates: [] });
      const approvalReplay = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: { binding: body.data.binding,
        operationKey: 'approve-generated-copy-1', action: 'COPY_APPROVE', value: { candidateId: body.candidateId } } });
      expect(approvalReplay.statusCode).toBe(200);
      expect(approvalReplay.json().replayed).toBe(true);
      expect(fixture.generateContent).toHaveBeenCalledTimes(1);
    } finally { await fixture.app.close(); }
  });
  it('coalesces concurrent same-key requests and reports the second response as replayed', async () => {
    const fixture = await setup();
    try {
      const payload = request(fixture.binding);
      const responses = await Promise.all([0, 1].map(() => fixture.app.inject({ method: 'POST', url: `${prefix}/copy-generate`, payload })));
      expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
      expect(responses[0]!.json().candidateId).toBe(responses[1]!.json().candidateId);
      expect(responses.map((response) => response.json().replayed).sort()).toEqual([false, true]);
      expect(fixture.generateContent).toHaveBeenCalledTimes(1);
    } finally { await fixture.app.close(); }
  });
  it('keeps quota failures in the existing generation owner without saving or approving a candidate', async () => {
    const fixture = await setup();
    fixture.generateContent.mockResolvedValueOnce({ ok: false, error: 'AI product generation daily limit reached', drafts: {},
      limit: { used: 20, remaining: 0, limit: 20 } });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/copy-generate`, payload: request(fixture.binding) });
      expect(response.statusCode).toBe(502);
      expect(response.json().errorCode).toBe('ozon_listing_ai_generation_failed');
      const current = await fixture.workflow.getDraft({ ownerUserId: 'owner', draftId: fixture.draft.id });
      expect(current.copy.candidates).toHaveLength(0);
      expect(current.copy.publishTitleRu).toBeNull();
    } finally { await fixture.app.close(); }
  });
  it.each([
    [['listing:review'], ['shop'], 403],
    [['listing:write'], ['shop'], 401],
    [['listing:review', 'listing:write'], ['other-shop'], 403],
  ])('rejects generation without both existing scopes and the exact shop grant', async (scopes, shops, status) => {
    const fixture = await setup({ scopes: scopes as string[], shops: shops as string[] });
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/copy-generate`, payload: request(fixture.binding) });
      expect(response.statusCode).toBe(status);
      expect(fixture.generateContent).not.toHaveBeenCalled();
      expect(fixture.evaluateAiCopyCapability).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });
  it.each(['snapshotId', 'supplyGoodsId', 'draftRevision', 'draftVersion'] as const)('rejects stale %s before any model request', async (field) => {
    const fixture = await setup();
    try {
      const binding = { ...fixture.binding, [field]: typeof fixture.binding[field] === 'number' ? Number(fixture.binding[field]) + 1 : 'foreign' };
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/copy-generate`, payload: request(binding) });
      expect(response.statusCode).toBe(409);
      expect(fixture.generateContent).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });
  it('preserves the existing default-off feature and category/attribute generation prerequisites', async () => {
    for (const options of [{ enabled: false }, { prerequisites: false }]) {
      const fixture = await setup(options);
      try {
        const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/copy-generate`, payload: request(fixture.binding) });
        expect(response.statusCode).toBe(options.enabled === false ? 503 : 409);
        expect(fixture.generateContent).not.toHaveBeenCalled();
        if (options.enabled === false) {
          expect(response.json().errorCode).toBe('editor_copy_generation_disabled');
          const capability = await fixture.app.inject({ method: 'POST', url: `${prefix}/copy-capability`, payload: { binding: fixture.binding } });
          expect(capability.json().data).toMatchObject({ available: false, reasonCode: 'LISTING_COPY_OFF' });
        }
      } finally { await fixture.app.close(); }
    }
  });
  it('marks generated copy stale after a fact change and refuses its approval', async () => {
    const fixture = await setup();
    try {
      const generated = await fixture.app.inject({ method: 'POST', url: `${prefix}/copy-generate`, payload: request(fixture.binding) });
      expect(generated.statusCode).toBe(200);
      const body = generated.json();
      const changed = await fixture.workflow.setAttributeValues({ draftId: fixture.draft.id, ownerUserId: 'owner', actorUserId: 'owner',
        expectedRevision: body.data.binding.draftRevision, values: { '10': { value: 'Шерсть', source: 'MANUAL', reviewed: true, evidence: ['operator-confirmed'] } } });
      const binding = { ...fixture.binding, draftRevision: changed.revision, draftVersion: changed.draftVersion };
      const read = await fixture.app.inject({ method: 'POST', url: `${prefix}/read`, payload: { binding } });
      expect(read.json().data.copy.pendingCandidates[0]).toMatchObject({ id: body.candidateId, sourceCurrent: false });
      const approval = await fixture.app.inject({ method: 'POST', url: `${prefix}/save`, payload: { binding, operationKey: 'approve-stale-ai-copy',
        action: 'COPY_APPROVE', value: { candidateId: body.candidateId } } });
      expect(approval.statusCode).toBe(409);
      expect(approval.json().errorCode).toBe('ozon_listing_ai_candidate_stale');
      expect(changed.copy.publishTitleRu).toBeNull();
      const replay = await fixture.app.inject({ method: 'POST', url: `${prefix}/copy-generate`, payload: request(fixture.binding) });
      expect(replay.statusCode).toBe(409);
      expect(fixture.generateContent).toHaveBeenCalledTimes(1);
    } finally { await fixture.app.close(); }
  });
  it.each([
    { fields: ['title', 'title'] }, { fields: [] }, { fields: ['attributes'] }, { operationKey: 'short' },
    { userInstructions: 'x'.repeat(2001) }, { apiKey: 'forged-client-key' }, { provider: 'client-choice' }, { autoApprove: true },
  ])('rejects unsupported request fields without invoking a model', async (extras) => {
    const fixture = await setup();
    try {
      const response = await fixture.app.inject({ method: 'POST', url: `${prefix}/copy-generate`, payload: { ...request(fixture.binding), ...extras } });
      expect(response.statusCode).toBe(400);
      expect(fixture.generateContent).not.toHaveBeenCalled();
    } finally { await fixture.app.close(); }
  });
});

import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import {
  sourceListingWorkflowRoutes,
  type SourceListingPublisherLike,
  type SourceListingWorkflowServiceLike,
} from '../routes/source-listing-workflows.js';
import { InMemoryOzonListingDraftRepository } from '../services/ozon-listing-draft.js';
import { createSourceListingWorkflowService } from '../services/source-listing-workflow.js';
import { SourceWorkflowOzonCredentialsUnavailableError } from '../services/source-workflow-ozon-client.js';

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 'draft-1', ownerUserId: 'owner-1', shopId: 'shop-1', supplyGoodsId: 'goods-1',
    sourceCaptureSnapshotId: 'snap-1', sourceCaptureHash: 'a'.repeat(64),
    selectedSkuKeys: ['sku-a'], revision: 2, draftVersion: 1, ...overrides,
  } as any;
}

function strictPricing(skuKeys = ['sku-a'], currencyCode: 'CNY' | 'RUB' = 'RUB') {
  return {
    contractVersion: 'ozon-listing-pricing/v1',
    items: skuKeys.map((skuKey) => ({
      skuKey,
      price: '100',
      oldPrice: '120',
      currencyCode,
      vat: '0',
    })),
  };
}

function readinessDraft(overrides: Record<string, unknown> = {}) {
  const candidate = {
    id: 'candidate-1',
    titleRu: 'Товар для продажи',
    descriptionRu: 'Описание товара.',
    sourcePromptVersion: 'copy-v1',
    sourceCaptureSnapshotId: 'snap-1',
    sourceCaptureHash: 'a'.repeat(64),
    createdByUserId: 'owner-1',
    createdAt: '2026-07-15T00:00:00.000Z',
  };
  return draft({
    stage: 'VALIDATION',
    runState: 'ACTIVE',
    category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' },
    attributes: { values: {} },
    copy: {
      publishTitleRu: candidate.titleRu,
      publishDescriptionRu: candidate.descriptionRu,
      candidates: [candidate],
      applyAudit: [{ candidateId: candidate.id }],
    },
    media: {
      assignments: [{
        scope: 'PRODUCT', slotKey: 'product-main', assetId: 'asset-main', source: 'SOURCE',
      }],
    },
    pricing: { value: strictPricing() },
    validation: { status: 'STALE', report: null },
    completedStepHashes: {},
    blockers: [],
    warnings: [],
    publishTaskIds: [],
    freshness: {
      category: { state: 'CURRENT', reason: null },
      attributes: { state: 'CURRENT', reason: null },
      content: { state: 'CURRENT', reason: null },
      media: { state: 'CURRENT', reason: null },
      pricing: { state: 'CURRENT', reason: null },
      validation: { state: 'STALE', reason: 'PRICING_CHANGED' },
    },
    ...overrides,
  });
}

function authoritativeValidation() {
  return {
    status: 'VALID' as const,
    report: {
      schemaVersion: 'ozon-attribute-validation/v1',
      schemaRevision: 'schema-1',
      operationReadiness: {
        ozonImport: { status: 'READY', issues: [] },
        inventoryActivation: { status: 'READY', issues: [] },
        costingAutoPricing: { status: 'READY', issues: [] },
      },
    },
    blockers: [],
    warnings: [],
  };
}

function build(service: Partial<SourceListingWorkflowServiceLike>, options: {
  enabled?: boolean;
  legacyAllowed?: boolean;
  listingStage?: 'off' | 'shadow_write' | 'dual_read' | 'v2_only';
  actorUserId?: string;
  isSubAccount?: boolean;
  role?: string;
  ownership?: (input: any) => Promise<any>;
  attributeWorkflow?: any;
  mediaWorkflow?: any;
  aiCopyWorkflow?: any;
  evaluateAiCopyCapability?: any;
  publisher?: SourceListingPublisherLike;
  authorizeByokPublish?: (input: any) => Promise<unknown>;
  featureFlags?: any;
} = {}) {
  const app = Fastify();
  const authenticate = vi.fn(async (request: FastifyRequest) => {
    (request as any).user = {
      userId: 'owner-1', actorUserId: options.actorUserId || 'owner-1',
      isSubAccount: options.isSubAccount || false, role: options.role || 'USER',
    };
  });
  const ownership = vi.fn(options.ownership || (async (input: any) => ({
    shopId: input.shopId,
    supplyGoodsId: input.supplyGoodsId || 'goods-1',
    sourceCaptureSnapshotId: input.sourceCaptureSnapshotId || 'snap-latest',
    sourceCaptureHash: 'b'.repeat(64),
    selectedSkuKeys: input.selectedSkuKeys,
  })));
  const categoryValidator = { validate: vi.fn(async ({ category }) => ({ ...category, categoryName: 'Official' })) };
  const enabled = options.enabled ?? true;
  const listingStage = options.listingStage || (enabled ? 'v2_only' : 'off');
  app.register(sourceListingWorkflowRoutes, {
    service: service as SourceListingWorkflowServiceLike,
    authenticate,
    ownership: { assertOwnedTarget: ownership },
    categoryValidator,
    attributeWorkflow: options.attributeWorkflow,
    mediaWorkflow: options.mediaWorkflow,
    aiCopyWorkflow: options.aiCopyWorkflow,
    evaluateAiCopyCapability: options.evaluateAiCopyCapability || vi.fn(async () => ({
      enabled: true, reason: 'tenant_allowed', revision: 'test',
    })),
    publisher: options.publisher,
    authorizeByokPublish: options.authorizeByokPublish || vi.fn(async () => ({
      byokAssetIds: [], policyRevision: null,
    })),
    featureFlags: options.featureFlags || { evaluate: vi.fn(async () => ({
      enabled,
      legacyAllowed: options.legacyAllowed ?? (!enabled || listingStage === 'shadow_write' || listingStage === 'dual_read'),
      captureStage: null,
      listingStage,
      reason: enabled ? 'global' : 'master_off', revision: 'test',
    })) } as any,
  });
  return { app, ownership, categoryValidator };
}

describe('source listing workflow routes', () => {
  it('creates and resumes through the real domain service', async () => {
    const service = createSourceListingWorkflowService({
      repository: new InMemoryOzonListingDraftRepository(),
      idFactory: (prefix) => `${prefix}-1`,
    });
    const { app } = build(service);
    await app.ready();
    const created = await app.inject({ method: 'POST', url: '/', payload: {
      shopId: 'shop-1', supplyGoodsId: 'goods-1', selectedSkuKeys: ['sku-a'],
    }});
    expect(created.statusCode).toBe(201);
    const draftId = created.json().data.id;
    const resumed = await app.inject({ method: 'GET', url: `/${draftId}` });
    expect(resumed.statusCode).toBe(200);
    expect(resumed.json().data).toMatchObject({
      ownerUserId: 'owner-1', supplyGoodsId: 'goods-1', sourceCaptureSnapshotId: 'snap-latest',
    });
    await app.close();
  });

  it('internalizes exact capture media and CAS-writes revalidated source assignments', async () => {
    const current = draft({ revision: 2 });
    const assignments = [{
      assetId: 'asset-1', slotKey: 'product-main', source: 'SOURCE', scope: 'PRODUCT',
    }];
    const service = {
      getDraft: vi.fn(async () => current),
      setMediaAssignments: vi.fn(async (input) => draft({
        revision: 3, media: { assignments: input.assignments },
      })),
    };
    const mediaWorkflow = {
      internalize: vi.fn(async () => ({ assets: [{ id: 'asset-1' }], assignments })),
      validateSourceAssignments: vi.fn(async () => undefined),
    };
    const { app } = build(service, { mediaWorkflow });
    await app.ready();

    const imported = await app.inject({
      method: 'POST', url: '/draft-1/media/internalize', payload: {
        expectedRevision: 2,
        selections: [{ sourceMediaKey: 'media-1', slotKey: 'product-main', scope: 'PRODUCT' }],
      },
    });
    expect(imported.statusCode).toBe(200);
    expect(mediaWorkflow.internalize).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', draft: current,
      selections: [{ sourceMediaKey: 'media-1', slotKey: 'product-main', scope: 'PRODUCT' }],
    });

    const assigned = await app.inject({
      method: 'PUT', url: '/draft-1/media', payload: { expectedRevision: 2, assignments },
    });
    expect(assigned.statusCode).toBe(200);
    expect(mediaWorkflow.validateSourceAssignments).toHaveBeenCalledWith({
      ownerUserId: 'owner-1', draft: current, assignments,
    });
    expect(service.setMediaAssignments).toHaveBeenCalledWith(expect.objectContaining({
      draftId: 'draft-1', ownerUserId: 'owner-1', actorUserId: 'owner-1', expectedRevision: 2, assignments,
    }));
    await app.close();
  });

  it('rejects client owner and creates only from canonical owned context', async () => {
    const service = { createDraft: vi.fn(async (input) => draft(input)) };
    const { app, ownership } = build(service, { ownership: async (input) => ({
      shopId: input.shopId, supplyGoodsId: 'goods-db', sourceCaptureSnapshotId: 'snap-db',
      sourceCaptureHash: 'c'.repeat(64), selectedSkuKeys: ['sku-db'],
    }) });
    await app.ready();
    expect((await app.inject({ method: 'POST', url: '/', payload: {
      ownerUserId: 'attacker', shopId: 'shop-1', supplyGoodsId: 'goods-1', selectedSkuKeys: ['sku-a'],
    }})).statusCode).toBe(400);
    const response = await app.inject({ method: 'POST', url: '/', payload: {
      shopId: 'shop-1', supplyGoodsId: 'goods-1', selectedSkuKeys: ['sku-a'],
    }});
    expect(response.statusCode).toBe(201);
    expect(ownership).toHaveBeenCalledWith(expect.objectContaining({ ownerUserId: 'owner-1' }));
    expect(service.createDraft).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', supplyGoodsId: 'goods-db', sourceCaptureSnapshotId: 'snap-db',
      sourceCaptureHash: 'c'.repeat(64), selectedSkuKeys: ['sku-db'],
    }));
    await app.close();
  });

  it('allows reads only in dual_read/v2_only and supports owner-scoped versions', async () => {
    const service = {
      createDraft: vi.fn(async () => draft()),
      getDraft: vi.fn(async () => draft()),
      getDraftVersion: vi.fn(async () => draft({ draftVersion: 1 })),
    };
    const dual = build(service, { listingStage: 'dual_read' });
    await dual.app.ready();
    expect((await dual.app.inject({ method: 'GET', url: '/draft-1' })).statusCode).toBe(200);
    expect((await dual.app.inject({ method: 'GET', url: '/draft-1/versions/1' })).statusCode).toBe(200);
    expect(service.getDraftVersion).toHaveBeenCalledWith({ draftId: 'draft-1', ownerUserId: 'owner-1', draftVersion: 1 });
    await dual.app.close();
    const shadow = build(service, { listingStage: 'shadow_write' });
    await shadow.app.ready();
    expect((await shadow.app.inject({ method: 'GET', url: '/draft-1' })).statusCode).toBe(409);
    expect((await shadow.app.inject({ method: 'POST', url: '/', payload: {
      shopId: 'shop-1', supplyGoodsId: 'goods-1', selectedSkuKeys: ['sku-a'],
    }})).statusCode).toBe(409);
    expect(service.createDraft).not.toHaveBeenCalled();
    await shadow.app.close();
  });

  it('reloads the owner-scoped current draft on a real CAS conflict shape', async () => {
    const current = draft({ revision: 3, draftVersion: 2 });
    const service = {
      getDraft: vi.fn(async () => current),
      setCategory: vi.fn(async () => { throw Object.assign(new Error('revision changed'), { code: 'OZON_LISTING_DRAFT_VERSION_CONFLICT', statusCode: 409 }); }),
    };
    const { app } = build(service);
    await app.ready();
    const response = await app.inject({ method: 'PATCH', url: '/draft-1', payload: {
      expectedRevision: 2, category: { categoryId: 1, typeId: 2, catalogRevision: 'catalog-1' },
    }});
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ currentVersion: 3, currentDraftVersion: 2, current: { id: 'draft-1' } });
    await app.close();
  });

  it('uses canonical snapshot hash and authoritative category output for PATCH', async () => {
    const service = { getDraft: vi.fn(async () => draft()), replaceSourceSnapshot: vi.fn(async (input) => input), setCategory: vi.fn(async (input) => input) };
    const attributeWorkflow = {
      retainCompatibleReviewedValues: vi.fn(async () => ({
        '100': { value: 'Красный', source: 'MANUAL', reviewed: true },
      })),
    };
    const { app, categoryValidator } = build(service, {
      attributeWorkflow,
      ownership: async (input) => ({
        shopId: input.shopId, supplyGoodsId: 'goods-1', sourceCaptureSnapshotId: 'snap-canonical',
        sourceCaptureHash: 'd'.repeat(64), selectedSkuKeys: input.selectedSkuKeys,
      }),
    });
    await app.ready();
    const snapshot = await app.inject({ method: 'PATCH', url: '/draft-1', payload: { expectedRevision: 2, sourceCaptureSnapshotId: 'snap-hint' } });
    expect(snapshot.statusCode).toBe(200);
    expect(service.replaceSourceSnapshot).toHaveBeenCalledWith(expect.objectContaining({ sourceCaptureSnapshotId: 'snap-canonical', sourceCaptureHash: 'd'.repeat(64) }));
    const category = await app.inject({ method: 'PATCH', url: '/draft-1', payload: { expectedRevision: 2, category: { categoryId: 1, typeId: 2, catalogRevision: 'catalog-1' } } });
    expect(category.statusCode).toBe(200);
    expect(categoryValidator.validate).toHaveBeenCalled();
    expect(service.setCategory).toHaveBeenCalledWith(expect.objectContaining({
      category: expect.objectContaining({ categoryName: 'Official' }),
      retainedAttributeValues: {
        '100': { value: 'Красный', source: 'MANUAL', reviewed: true },
      },
    }));
    await app.close();
  });

  it('replaces a snapshot and its changed SKU selection atomically', async () => {
    const service = {
      getDraft: vi.fn(async () => draft({ selectedSkuKeys: ['old-canonical'] })),
      replaceSourceSnapshot: vi.fn(async (input) => input),
    };
    const { app, ownership } = build(service, {
      ownership: async (input) => ({
        shopId: input.shopId,
        supplyGoodsId: 'goods-1',
        sourceCaptureSnapshotId: 'snap-new-canonical',
        sourceCaptureHash: 'e'.repeat(64),
        selectedSkuKeys: ['new-canonical'],
      }),
    });
    await app.ready();

    const response = await app.inject({
      method: 'PATCH',
      url: '/draft-1',
      payload: {
        expectedRevision: 2,
        sourceCaptureSnapshotId: 'snap-new-hint',
        selectedSkuKeys: ['new-legacy-alias'],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(ownership).toHaveBeenCalledWith(expect.objectContaining({
      sourceCaptureSnapshotId: 'snap-new-hint',
      selectedSkuKeys: ['new-legacy-alias'],
    }));
    expect(service.replaceSourceSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      sourceCaptureSnapshotId: 'snap-new-canonical',
      sourceCaptureHash: 'e'.repeat(64),
      selectedSkuKeys: ['new-canonical'],
    }));

    const ambiguous = await app.inject({
      method: 'PATCH',
      url: '/draft-1',
      payload: {
        expectedRevision: 2,
        sourceCaptureSnapshotId: 'snap-new-hint',
        selectedSkuKeys: ['new-legacy-alias'],
        shopId: 'shop-2',
      },
    });
    expect(ambiguous.statusCode).toBe(400);
    await app.close();
  });

  it('requires explicit AI apply and maps workflow run states', async () => {
    const service = {
      getDraft: vi.fn(async () => draft()),
      addAiCopyCandidate: vi.fn(async () => ({
        draft: draft({ revision: 3 }),
        candidate: {
          id: 'candidate-1',
          titleRu: 'Товар',
          descriptionRu: null,
          sourcePromptVersion: 'copy-v1',
          sourceCaptureSnapshotId: 'snap-1',
          sourceCaptureHash: 'a'.repeat(64),
          createdByUserId: 'owner-1',
          createdAt: '2026-07-15T00:00:00.000Z',
        },
      })),
      applyAiCopyCandidate: vi.fn(async (input) => input), setRunState: vi.fn(async (input) => input),
    };
    const { app } = build(service);
    await app.ready();
    const createdCandidate = await app.inject({ method: 'POST', url: '/draft-1/ai-candidates', payload: {
      expectedRevision: 2, titleRu: 'Товар', sourcePromptVersion: 'copy-v1',
    }});
    expect(createdCandidate.statusCode).toBe(201);
    expect(createdCandidate.json().data).toMatchObject({ id: 'candidate-1', titleRu: 'Товар' });
    expect(service.addAiCopyCandidate).toHaveBeenCalledWith(expect.objectContaining({
      titleRu: 'Товар',
    }));
    expect((service.addAiCopyCandidate.mock.calls as any[])[0]?.[0]).not.toHaveProperty('descriptionRu');
    expect((await app.inject({ method: 'POST', url: '/draft-1/ai-candidates/apply', payload: {
      expectedRevision: 2, candidateId: 'candidate-1', operationKey: 'apply-1',
    }})).json()).toMatchObject({ audit: { action: 'ai_candidate_apply', actorUserId: 'owner-1' } });
    for (const [path, runState] of [['pause', 'PAUSED'], ['resume', 'ACTIVE'], ['cancel', 'CANCELLED'], ['manual-review', 'MANUAL_REVIEW']] as const) {
      const response = await app.inject({ method: 'POST', url: `/draft-1/${path}`, payload: { expectedRevision: 2 } });
      expect(response.json().data.runState).toBe(runState);
    }
    await app.close();
  });

  it('generates AI copy server-side and rejects client-controlled provider or output fields', async () => {
    const current = readinessDraft({ revision: 2, copy: {
      publishTitleRu: null, publishDescriptionRu: null, candidates: [], applyAudit: [],
    }});
    const service = { getDraft: vi.fn(async () => current) };
    const aiCopyWorkflow = {
      generate: vi.fn(async () => ({
        draft: draft({ revision: 3 }),
        candidate: {
          id: 'generated-1', kind: 'AI_GENERATED', titleRu: 'Товар для продажи', descriptionRu: null,
          sourcePromptVersion: 'listing-copy:1', sourceCaptureSnapshotId: 'snap-1',
          sourceCaptureHash: 'a'.repeat(64), createdByUserId: 'owner-1',
          createdAt: '2026-07-18T00:00:00.000Z',
          generation: {
            schemaVersion: 'listing-copy-generation/v1',
            operationKey: 'generate-copy-1',
            clientRequestHash: 'a'.repeat(64),
            draftContextHash: 'b'.repeat(64),
            fields: ['title'],
            title: {
              templateKey: 'listing-copy.title',
              sequence: 1,
              frozenRequest: {
                systemPrompt: 'PRIVATE SYSTEM PROMPT',
                userPrompt: 'PRIVATE SOURCE FACTS',
                variables: { sourceFactsJson: 'PRIVATE SOURCE FACTS' },
              },
            },
          },
        },
        limit: { used: 1, remaining: 9, limit: 10 },
      })),
    };
    const { app } = build(service, { aiCopyWorkflow });
    await app.ready();

    const generated = await app.inject({
      method: 'POST',
      url: '/draft-1/ai-candidates/generate',
      payload: {
        expectedRevision: 2,
        operationKey: 'generate-copy-1',
        fields: ['title'],
        userInstructions: 'Use concise wording',
      },
    });
    expect(generated.statusCode).toBe(201);
    expect(generated.json().data.candidate).toMatchObject({ id: 'generated-1', kind: 'AI_GENERATED' });
    expect(generated.body).not.toContain('PRIVATE SYSTEM PROMPT');
    expect(generated.body).not.toContain('PRIVATE SOURCE FACTS');
    expect(aiCopyWorkflow.generate).toHaveBeenCalledWith({
      draftId: 'draft-1', ownerUserId: 'owner-1', actorUserId: 'owner-1', expectedRevision: 2,
      operationKey: 'generate-copy-1', fields: ['title'], userInstructions: 'Use concise wording',
    });

    const forged = await app.inject({
      method: 'POST',
      url: '/draft-1/ai-candidates/generate',
      payload: {
        expectedRevision: 2,
        operationKey: 'generate-copy-2',
        fields: ['title'],
        provider: 'attacker-provider',
        titleRu: 'Поддельный результат',
        sourcePromptVersion: 'forged',
      },
    });
    expect(forged.statusCode).toBe(400);
    expect(aiCopyWorkflow.generate).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('fails closed before generation when the AI media rollout is disabled', async () => {
    const current = readinessDraft({ revision: 2 });
    const service = { getDraft: vi.fn(async () => current) };
    const aiCopyWorkflow = { generate: vi.fn() };
    const featureFlags = {
      evaluate: vi.fn(async () => ({
        enabled: true,
        legacyAllowed: false,
        captureStage: null,
        listingStage: 'v2_only',
        reason: 'global',
        revision: 'test',
      })),
    };
    const evaluateAiCopyCapability = vi.fn(async () => ({
      enabled: false, reason: 'master_off', revision: 'test',
    }));
    const { app } = build(service, { aiCopyWorkflow, featureFlags, evaluateAiCopyCapability });
    await app.ready();
    const capability = await app.inject({ method: 'GET', url: '/draft-1/ai-copy-capability' });
    expect(capability.statusCode).toBe(200);
    expect(capability.json().data).toMatchObject({ enabled: false, reason: 'master_off' });
    const response = await app.inject({
      method: 'POST',
      url: '/draft-1/ai-candidates/generate',
      payload: { expectedRevision: 2, operationKey: 'generate-copy-off', fields: ['title'] },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ errorCode: 'ai_media_workflow_disabled' });
    expect(aiCopyWorkflow.generate).not.toHaveBeenCalled();
    expect(evaluateAiCopyCapability).toHaveBeenCalledWith('owner-1');
    await app.close();
  });

  it('persists pricing and audited manual facts through CAS commands', async () => {
    const service = {
      getDraft: vi.fn(async () => draft()),
      setPricing: vi.fn(async (input) => ({ ...draft(), ...input, revision: 3 })),
      confirmManualFact: vi.fn(async (input) => ({ ...draft(), ...input, revision: 3 })),
    };
    const { app } = build(service);
    await app.ready();
    const pricing = await app.inject({
      method: 'PUT',
      url: '/draft-1/pricing',
      payload: { expectedRevision: 2, value: strictPricing(['sku-a'], 'CNY') },
    });
    expect(pricing.statusCode).toBe(200);
    expect(service.setPricing).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      value: strictPricing(['sku-a'], 'CNY'),
    }));
    const fact = await app.inject({
      method: 'POST',
      url: '/draft-1/manual-facts',
      payload: {
        expectedRevision: 2,
        attributeKey: 'packageWeightG',
        value: 500,
        evidence: ['owner-confirmed-in-source-workbench'],
      },
    });
    expect(fact.statusCode).toBe(200);
    expect(service.confirmManualFact).toHaveBeenCalledWith(expect.objectContaining({
      attributeKey: 'packageWeightG',
      value: 500,
    }));
    const missingValue = await app.inject({
      method: 'POST',
      url: '/draft-1/manual-facts',
      payload: {
        expectedRevision: 2,
        attributeKey: 'packageWeightG',
        evidence: ['owner-confirmed-in-source-workbench'],
      },
    });
    expect(missingValue.statusCode).toBe(400);
    expect(service.confirmManualFact).toHaveBeenCalledTimes(1);
    await app.close();
  });

  it('rejects loose pricing DTOs and rows that do not exactly cover selected SKUs', async () => {
    const current = draft({ selectedSkuKeys: ['sku-a', 'sku-b'] });
    const service = {
      getDraft: vi.fn(async () => current),
      setPricing: vi.fn(async (input) => input),
    };
    const { app } = build(service);
    await app.ready();

    for (const value of [
      null,
      { markupPct: 12 },
      { ...strictPricing(['sku-a', 'sku-b']), extra: true },
      strictPricing(['sku-a']),
      {
        ...strictPricing(['sku-a', 'sku-b']),
        items: [
          { ...strictPricing(['sku-a']).items[0], currencyCode: 'CNY' },
          { ...strictPricing(['sku-b']).items[0], currencyCode: 'RUB' },
        ],
      },
      {
        ...strictPricing(['sku-a', 'sku-b']),
        items: [
          { ...strictPricing(['sku-a']).items[0], vat: '0.20' },
          strictPricing(['sku-b']).items[0],
        ],
      },
      {
        ...strictPricing(['sku-a', 'sku-b']),
        items: [
          { ...strictPricing(['sku-a']).items[0], price: '121', oldPrice: '120' },
          strictPricing(['sku-b']).items[0],
        ],
      },
    ]) {
      const response = await app.inject({
        method: 'PUT', url: '/draft-1/pricing', payload: { expectedRevision: 2, value },
      });
      expect(response.statusCode).toBe(400);
    }
    expect(service.setPricing).not.toHaveBeenCalled();
    await app.close();
  });

  it('merges whole-workflow readiness into authoritative validation responses', async () => {
    const ready = readinessDraft();
    const readyValidation = authoritativeValidation();
    const readyService = {
      getDraft: vi.fn(async () => ready),
      recordValidationResult: vi.fn(async (input) => input),
    };
    const readyApp = build(readyService, {
      attributeWorkflow: { validate: vi.fn(async () => readyValidation) },
    }).app;
    await readyApp.ready();
    const accepted = await readyApp.inject({
      method: 'POST', url: '/draft-1/validate', payload: { expectedRevision: 2 },
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().validation).toMatchObject({
      status: 'VALID',
      blockers: [],
      report: { operationReadiness: { ozonImport: { status: 'READY', issues: [] } } },
    });
    expect(readyService.recordValidationResult).toHaveBeenCalledWith(expect.objectContaining({
      status: 'VALID', blockers: [],
    }));
    await readyApp.close();

    const incomplete = readinessDraft({
      copy: { publishTitleRu: null, publishDescriptionRu: null, candidates: [], applyAudit: [] },
      media: { assignments: [] },
      pricing: { value: null },
    });
    const incompleteService = {
      getDraft: vi.fn(async () => incomplete),
      recordValidationResult: vi.fn(async (input) => input),
    };
    const incompleteApp = build(incompleteService, {
      attributeWorkflow: { validate: vi.fn(async () => authoritativeValidation()) },
    }).app;
    await incompleteApp.ready();
    const rejected = await incompleteApp.inject({
      method: 'POST', url: '/draft-1/validate', payload: { expectedRevision: 2 },
    });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().validation).toMatchObject({
      status: 'INVALID',
      report: { operationReadiness: { ozonImport: { status: 'BLOCKED' } } },
    });
    expect(rejected.json().validation.blockers.map((item: { code: string }) => item.code))
      .toEqual(expect.arrayContaining([
        'OZON_LISTING_COPY_INVALID',
        'OZON_LISTING_MEDIA_REQUIRED',
        'OZON_LISTING_PRICING_INVALID',
      ]));
    await incompleteApp.close();
  });

  it('exposes one owner-scoped attribute workspace and persists canonical manual values', async () => {
    const current = draft({ category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' } });
    const canonicalValues = {
      '85': {
        value: 'Без бренда', source: 'MANUAL', reviewed: true,
        evidence: ['owner-confirmed'], confidence: 1,
        dictionaryMatch: { status: 'MATCHED', dictionaryValueId: 900, canonicalValue: 'Без бренда' },
        manualReview: 'CONFIRMED',
      },
    };
    const attributeWorkflow = {
      getWorkspace: vi.fn(async () => ({ schema: { fields: [] }, suggestions: [], values: {} })),
      searchDictionary: vi.fn(async () => ({
        attributeId: 85, complete: true, values: [{ id: 900, value: 'Без бренда' }],
      })),
      prepareManualValues: vi.fn(async () => canonicalValues),
    };
    const service = {
      getDraft: vi.fn(async () => current),
      setAttributeValues: vi.fn(async (input) => ({ ...current, attributes: { values: input.values }, revision: 3 })),
    };
    const { app } = build(service, { attributeWorkflow });
    await app.ready();

    const workspace = await app.inject({ method: 'GET', url: '/draft-1/attributes' });
    expect(workspace.statusCode).toBe(200);
    expect(attributeWorkflow.getWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', draft: current,
    }));
    const dictionary = await app.inject({
      method: 'GET', url: '/draft-1/attributes/85/dictionary?query=%D0%B1%D1%80%D0%B5%D0%BD%D0%B4&limit=20',
    });
    expect(dictionary.statusCode).toBe(200);
    expect(attributeWorkflow.searchDictionary).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', draft: current, attributeId: 85, query: 'бренд', limit: 20,
    }));

    const stale = await app.inject({
      method: 'PUT', url: '/draft-1/attributes', payload: {
        expectedRevision: 1,
        changes: [{ attributeId: 85, value: 'no brand', evidence: ['owner-confirmed'] }],
      },
    });
    expect(stale.statusCode).toBe(409);
    expect(attributeWorkflow.prepareManualValues).not.toHaveBeenCalled();

    const saved = await app.inject({
      method: 'PUT', url: '/draft-1/attributes', payload: {
        expectedRevision: 2,
        changes: [{ attributeId: 85, value: 'no brand', evidence: ['owner-confirmed'] }],
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(attributeWorkflow.prepareManualValues).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', actorUserId: 'owner-1', draft: current,
      changes: [{ attributeId: 85, value: 'no brand', evidence: ['owner-confirmed'] }],
    }));
    expect(service.setAttributeValues).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 2,
      values: canonicalValues,
    }));
    await app.close();
  });

  it('preserves the safe credential-unavailable error for attribute workspace recovery', async () => {
    const current = draft({ category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' } });
    const service = { getDraft: vi.fn(async () => current) };
    const attributeWorkflow = {
      getWorkspace: vi.fn(async () => {
        throw new Error('catalog refresh failed', {
          cause: new SourceWorkflowOzonCredentialsUnavailableError(),
        });
      }),
    };
    const { app } = build(service, { attributeWorkflow });
    await app.ready();

    const response = await app.inject({ method: 'GET', url: '/draft-1/attributes' });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: 0,
      errorCode: 'SOURCE_WORKFLOW_OZON_CREDENTIALS_UNAVAILABLE',
      msg: 'Ozon 店铺凭证不可用，请重新保存店铺 API 密钥',
    });
    await app.close();
  });

  it('accepts and forwards an explicit SKU key for matrix attribute edits', async () => {
    const current = draft({ category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' } });
    const canonicalValues = {
      '100': {
        value: ['Белый'], source: 'MANUAL', reviewed: true,
        skuValues: {
          'sku-a': { value: ['Белый'], source: 'MANUAL', reviewed: true, evidence: ['owner'] },
        },
      },
    };
    const attributeWorkflow = {
      prepareManualValues: vi.fn(async () => canonicalValues),
    };
    const service = {
      getDraft: vi.fn(async () => current),
      setAttributeValues: vi.fn(async (input) => ({ ...current, attributes: { values: input.values }, revision: 3 })),
    };
    const { app } = build(service, { attributeWorkflow });
    await app.ready();

    const response = await app.inject({
      method: 'PUT',
      url: '/draft-1/attributes',
      payload: {
        expectedRevision: 2,
        changes: [{
          attributeId: 100,
          skuKey: 'sku-a',
          value: ['Белый'],
          dictionaryValueIds: [201],
          evidence: ['owner'],
        }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(attributeWorkflow.prepareManualValues).toHaveBeenCalledWith(expect.objectContaining({
      draft: current,
      changes: [{
        attributeId: 100,
        skuKey: 'sku-a',
        value: ['Белый'],
        dictionaryValueIds: [201],
        evidence: ['owner'],
      }],
    }));
    expect(service.setAttributeValues).toHaveBeenCalledWith(expect.objectContaining({
      changeAudit: [{ attributeId: 100, skuKey: 'sku-a', action: 'SET', evidence: ['owner'] }],
    }));

    const cleared = await app.inject({
      method: 'PUT',
      url: '/draft-1/attributes',
      payload: {
        expectedRevision: 2,
        changes: [{ attributeId: 100, skuKey: 'sku-a', action: 'CLEAR', evidence: ['owner:clear'] }],
      },
    });
    expect(cleared.statusCode).toBe(200);
    expect(attributeWorkflow.prepareManualValues).toHaveBeenLastCalledWith(expect.objectContaining({
      changes: [{ attributeId: 100, skuKey: 'sku-a', action: 'CLEAR', evidence: ['owner:clear'] }],
    }));
    expect(service.setAttributeValues).toHaveBeenLastCalledWith(expect.objectContaining({
      changeAudit: [{ attributeId: 100, skuKey: 'sku-a', action: 'CLEAR', evidence: ['owner:clear'] }],
    }));
    await app.close();
  });

  it('applies only the frozen suggestion snapshot and records authoritative validation', async () => {
    const current = readinessDraft({
      category: { categoryId: 10, typeId: 20, catalogRevision: 'catalog-1' },
    });
    const suggestedValues = {
      '100': {
        value: 'Красный', source: 'SOURCE', reviewed: true,
        evidence: ['profile.colors'], confidence: 0.95,
        suggestionProvenance: {
          contractVersion: 'ozon-attribute-suggestion-provenance/v1',
          candidateId: 'attribute-suggestion:100:abcdef0123456789',
          candidateHash: 'a'.repeat(64),
          schemaRevision: 'b'.repeat(64),
          sourceCaptureSnapshotId: 'snapshot-1',
          sourceCaptureHash: 'c'.repeat(64),
          draftVersion: 1,
          draftRevision: 2,
          evidenceDetails: [{
            id: 'source-profile:100:colors', attributeId: 100,
            source: 'SOURCE_PROFILE', path: 'sourceProfile.colors', value: ['Красный'],
            confidence: 0.95, isEstimated: false,
          }],
        },
      },
    };
    const blockers = [{
      code: 'required_missing', message: 'Brand is required', fieldPath: 'attributes.85',
    }];
    const validation = {
      ...authoritativeValidation(),
      status: 'INVALID' as const,
      report: {
        ...authoritativeValidation().report,
        operationReadiness: {
          ...authoritativeValidation().report.operationReadiness,
          ozonImport: { status: 'BLOCKED', issues: blockers },
        },
      },
      blockers,
    };
    const attributeWorkflow = {
      prepareSuggestedValues: vi.fn(async () => suggestedValues),
      validate: vi.fn(async () => validation),
    };
    const service = {
      getDraft: vi.fn(async () => current),
      setAttributeValues: vi.fn(async (input) => ({ ...current, attributes: { values: input.values }, revision: 3 })),
      recordValidationResult: vi.fn(async (input) => ({ ...current, validation: { status: input.status, report: input.report }, blockers: input.blockers })),
    };
    const { app } = build(service, { attributeWorkflow });
    await app.ready();

    const candidate = {
      attributeId: 100,
      candidateId: 'attribute-suggestion:100:abcdef0123456789',
      candidateHash: 'a'.repeat(64),
      schemaRevision: 'b'.repeat(64),
    };

    const legacy = await app.inject({
      method: 'POST', url: '/draft-1/attributes/suggestions/apply',
      payload: { expectedRevision: 2, attributeIds: [100] },
    });
    expect(legacy.statusCode).toBe(400);

    const applied = await app.inject({
      method: 'POST', url: '/draft-1/attributes/suggestions/apply',
      payload: { expectedRevision: 2, candidates: [candidate] },
    });
    expect(applied.statusCode).toBe(200);
    expect(applied.json()).toMatchObject({
      data: {
        attributes: {
          values: {
            '100': {
              suggestionProvenance: {
                candidateId: candidate.candidateId,
                evidenceDetails: [{ path: 'sourceProfile.colors', value: ['Красный'] }],
              },
            },
          },
        },
      },
    });
    expect(attributeWorkflow.prepareSuggestedValues).toHaveBeenCalledWith(expect.objectContaining({
      draft: current, candidates: [candidate], actorUserId: 'owner-1',
    }));
    expect(service.setAttributeValues).toHaveBeenCalledWith(expect.objectContaining({ values: suggestedValues }));

    const validated = await app.inject({
      method: 'POST', url: '/draft-1/validate', payload: { expectedRevision: 2 },
    });
    expect(validated.statusCode).toBe(200);
    expect(attributeWorkflow.validate).toHaveBeenCalledWith(expect.objectContaining({ draft: current }));
    expect(service.recordValidationResult).toHaveBeenCalledWith(expect.objectContaining(validation));
    await app.close();
  });

  it('records server-side publish intent for owner only and masks unknown 5xx', async () => {
    const service = { getDraft: vi.fn(async () => draft()), recordPublishIntent: vi.fn(async (input) => input) };
    const owner = build(service);
    await owner.app.ready();
    const response = await owner.app.inject({ method: 'POST', url: '/draft-1/publish-intent', payload: { expectedRevision: 2, idempotencyKey: 'publish-1' } });
    expect(response.statusCode).toBe(200);
    expect(service.recordPublishIntent).toHaveBeenCalledWith(expect.not.objectContaining({ payloadHash: expect.anything() }));
    expect((await owner.app.inject({
      method: 'POST', url: '/draft-1/publish-intent',
      payload: { expectedRevision: 2, idempotencyKey: 'short' },
    })).statusCode).toBe(400);
    await owner.app.close();
    const staff = build(service, { actorUserId: 'staff-1', isSubAccount: true });
    await staff.app.ready();
    expect((await staff.app.inject({ method: 'POST', url: '/draft-1/publish-intent', payload: { expectedRevision: 2, idempotencyKey: 'publish-1' } })).statusCode).toBe(403);
    await staff.app.close();
    const failing = build({ getDraft: vi.fn(async () => { throw new Error('secret SQL text'); }) });
    await failing.app.ready();
    expect((await failing.app.inject({ method: 'GET', url: '/draft-1' })).json()).toMatchObject({ errorCode: 'source_listing_workflow_failed', msg: '来源商品工作流请求失败' });
    await failing.app.close();
  });

  it.each(['publish-intent', 'publish-attempts'] as const)(
    'rejects BYOK media at the web %s boundary before publish mutation',
    async (endpoint) => {
      const current = readinessDraft({ stage: 'READY_TO_PUBLISH', revision: 2 });
      const service = {
        getDraft: vi.fn(async () => current),
        recordPublishIntent: vi.fn(),
      };
      const publisher = { publish: vi.fn(), getAttempt: vi.fn() } as any;
      const authorizeByokPublish = vi.fn(async () => {
        throw Object.assign(new Error('BYOK publish is disabled'), {
          code: 'EXTENSION_BYOK_PUBLISH_DISABLED', statusCode: 409,
        });
      });
      const { app } = build(service, { publisher, authorizeByokPublish });
      await app.ready();

      const response = await app.inject({
        method: 'POST',
        url: `/draft-1/${endpoint}`,
        payload: { expectedRevision: 2, idempotencyKey: 'publish-attempt-1' },
      });

      expect(response.statusCode).toBe(409);
      expect(response.json()).toMatchObject({
        errorCode: 'EXTENSION_BYOK_PUBLISH_DISABLED',
      });
      expect(authorizeByokPublish).toHaveBeenCalledWith({
        ownerUserId: 'owner-1',
        shopId: 'shop-1',
        workflowId: 'draft-1',
        assignments: current.media.assignments,
      });
      expect(service.recordPublishIntent).not.toHaveBeenCalled();
      expect(publisher.publish).not.toHaveBeenCalled();
      await app.close();
    },
  );

  it('submits an owner-only V2 publish attempt through the authoritative publisher', async () => {
    const service = { getDraft: vi.fn(async () => draft()) };
    const record = {
      id: 'attempt-1', workflowId: 'draft-1', state: 'SUBMITTED',
      itemResults: [{ offerId: 'offer-1', status: 'pending' }], itemErrors: [],
      requestPayload: { items: [{ offer_id: 'secret-frozen-request' }] },
      catalogSnapshot: { secret: 'catalog-body' }, response: { secret: 'provider-response' },
      leaseToken: 'secret-lease-token', leaseOwner: 'internal-worker',
      resolutionEvidence: { secret: 'operator-evidence' },
    } as any;
    const publisher = {
      publish: vi.fn(async () => record),
      getAttempt: vi.fn(async () => record),
    };
    const { app } = build(service, { publisher });
    await app.ready();

    const response = await app.inject({
      method: 'POST',
      url: '/draft-1/publish-attempts',
      payload: { expectedRevision: 2, idempotencyKey: 'publish-attempt-1' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({
      code: 1,
      data: { id: 'attempt-1', state: 'SUBMITTED' },
      publishSubmitted: true,
    });
    for (const secret of [
      'secret-frozen-request', 'catalog-body', 'provider-response',
      'secret-lease-token', 'internal-worker', 'operator-evidence',
    ]) {
      expect(response.body).not.toContain(secret);
    }
    expect(publisher.publish).toHaveBeenCalledWith({
      draftId: 'draft-1', ownerUserId: 'owner-1', actorUserId: 'owner-1',
      expectedRevision: 2, idempotencyKey: 'publish-attempt-1',
    });

    const fetched = await app.inject({
      method: 'GET', url: '/draft-1/publish-attempts/attempt-1',
    });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().data).toMatchObject({
      id: 'attempt-1', itemResultCount: 1, itemErrors: [],
    });
    expect(fetched.body).not.toContain('secret-frozen-request');
    expect(fetched.body).not.toContain('secret-lease-token');
    expect(publisher.getAttempt).toHaveBeenCalledWith({ attemptId: 'attempt-1', ownerUserId: 'owner-1' });
    await app.close();
  });

  it('returns a complete bounded import batch with offer-to-canonical-SKU trace on exact attempt reads', async () => {
    const service = { getDraft: vi.fn(async () => draft()) };
    const offerTrace = Array.from({ length: 25 }, (_, ordinal) => ({
      ordinal,
      offerId: `offer-${ordinal}`,
      skuKey: `sku-${ordinal}`,
    }));
    const itemErrors = offerTrace.map((entry) => ({
      ordinal: entry.ordinal,
      offerId: entry.offerId,
      code: `ERROR_${entry.ordinal}`,
    }));
    const record = {
      id: 'attempt-many', workflowId: 'draft-1', state: 'SUBMITTED',
      reconciliationState: 'PARTIAL_FAILURE', itemCount: offerTrace.length,
      offerTrace, itemResults: [], itemErrors,
    } as any;
    const publisher = {
      publish: vi.fn(),
      getAttempt: vi.fn(async () => record),
    };
    const { app } = build(service, { publisher });
    await app.ready();

    const response = await app.inject({
      method: 'GET', url: '/draft-1/publish-attempts/attempt-many',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({
      itemErrorCount: 25,
      itemErrorsTruncated: false,
      offerTrace: expect.arrayContaining([{
        ordinal: 24, offerId: 'offer-24', skuKey: 'sku-24',
      }]),
    });
    expect(response.json().data.itemErrors).toHaveLength(25);
    await app.close();
  });

  it('rejects client payload injection, STAFF, and sub-account V2 publication', async () => {
    const service = { getDraft: vi.fn(async () => draft()) };
    const publisher = { publish: vi.fn(), getAttempt: vi.fn() } as any;
    const injected = build(service, { publisher });
    await injected.app.ready();
    expect((await injected.app.inject({
      method: 'POST', url: '/draft-1/publish-attempts',
      payload: { expectedRevision: 2, idempotencyKey: 'publish-attempt-1', payload: { items: [] } },
    })).statusCode).toBe(400);
    await injected.app.close();

    for (const auth of [{ role: 'STAFF' }, { isSubAccount: true, actorUserId: 'staff-1' }]) {
      const denied = build(service, { publisher, ...auth });
      await denied.app.ready();
      expect((await denied.app.inject({
        method: 'POST', url: '/draft-1/publish-attempts',
        payload: { expectedRevision: 2, idempotencyKey: 'publish-attempt-1' },
      })).statusCode).toBe(403);
      expect((await denied.app.inject({
        method: 'GET', url: '/draft-1/publish-attempts/attempt-1',
      })).statusCode).toBe(403);
      await denied.app.close();
    }
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('requires authoritative listing V2 and publisher rollout without legacy fallback', async () => {
    const service = { getDraft: vi.fn(async () => draft()) };
    const publisher = { publish: vi.fn(), getAttempt: vi.fn() } as any;
    for (const gate of [
      { listingStage: 'dual_read' as const, enabled: true, legacyAllowed: true },
      { listingStage: 'v2_only' as const, enabled: false, legacyAllowed: true },
    ]) {
      const denied = build(service, { publisher, ...gate });
      await denied.app.ready();
      const response = await denied.app.inject({
        method: 'POST', url: '/draft-1/publish-attempts',
        payload: { expectedRevision: 2, idempotencyKey: 'publish-attempt-1' },
      });
      expect(response.statusCode).toBe(409);
      await denied.app.close();
    }

    const unavailable = build(service, {
      publisher,
      featureFlags: { evaluate: vi.fn(async () => ({
        enabled: false, legacyAllowed: false, captureStage: null,
        reason: 'policy_invalid', revision: 'invalid',
      })) },
    });
    await unavailable.app.ready();
    expect((await unavailable.app.inject({
      method: 'POST', url: '/draft-1/publish-attempts',
      payload: { expectedRevision: 2, idempotencyKey: 'publish-attempt-1' },
    })).statusCode).toBe(503);
    await unavailable.app.close();

    const mixedRevision = build(service, {
      publisher,
      featureFlags: {
        evaluate: vi.fn(async (feature: string) => ({
          enabled: true,
          legacyAllowed: false,
          captureStage: null,
          listingStage: 'v2_only',
          reason: 'global',
          revision: feature === 'SOURCE_LISTING_WORKFLOW' ? 'rollout-1' : 'rollout-2',
        })),
      },
    });
    await mixedRevision.app.ready();
    const mixedResponse = await mixedRevision.app.inject({
      method: 'POST', url: '/draft-1/publish-attempts',
      payload: { expectedRevision: 2, idempotencyKey: 'publish-attempt-1' },
    });
    expect(mixedResponse.statusCode).toBe(503);
    expect(mixedResponse.json()).toMatchObject({ errorCode: 'source_listing_workflow_failed' });
    await mixedRevision.app.close();
    expect(publisher.publish).not.toHaveBeenCalled();
  });

  it('keeps existing attempts owner-readable after publisher rollout is disabled', async () => {
    const service = { getDraft: vi.fn(async () => draft()) };
    const record = { id: 'attempt-1', workflowId: 'draft-1', state: 'UNKNOWN' } as any;
    const featureFlags = { evaluate: vi.fn(async () => ({
      enabled: false, legacyAllowed: true, captureStage: null,
      reason: 'master_off', revision: 'master-off',
    })) };
    const resolved = { ...record, state: 'SUBMITTED', ozonTaskId: '987' } as any;
    const publisher = {
      publish: vi.fn(),
      getAttempt: vi.fn(async () => record),
      resolveAttempt: vi.fn(async () => resolved),
    };
    const { app } = build(service, { publisher, featureFlags });
    await app.ready();

    const response = await app.inject({
      method: 'GET', url: '/draft-1/publish-attempts/attempt-1',
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ state: 'UNKNOWN' });

    const resolution = await app.inject({
      method: 'POST',
      url: '/draft-1/publish-attempts/attempt-1/resolve',
      payload: {
        expectedStateVersion: 4,
        decision: 'SUBMITTED',
        taskId: '987',
        note: 'Verified against the test-shop task log',
        evidence: { source: 'operator-task-log', reference: 'audit-1' },
      },
    });
    expect(resolution.statusCode).toBe(200);
    expect(resolution.json().data).toMatchObject({ state: 'SUBMITTED', ozonTaskId: '987' });
    expect(publisher.resolveAttempt).toHaveBeenCalledWith({
      attemptId: 'attempt-1',
      ownerUserId: 'owner-1',
      actorUserId: 'owner-1',
      expectedStateVersion: 4,
      resolution: {
        decision: 'SUBMITTED',
        taskId: '987',
        note: 'Verified against the test-shop task log',
        evidence: { source: 'operator-task-log', reference: 'audit-1' },
      },
    });
    expect(featureFlags.evaluate).not.toHaveBeenCalled();
    await app.close();
  });

  it('rejects invalid or cross-workflow manual attempt resolution', async () => {
    const service = { getDraft: vi.fn(async () => draft()) };
    const publisher = {
      publish: vi.fn(),
      getAttempt: vi.fn(async () => ({ id: 'attempt-1', workflowId: 'other-draft' }) as any),
      resolveAttempt: vi.fn(),
    };
    const { app } = build(service, { publisher });
    await app.ready();

    const invalid = await app.inject({
      method: 'POST',
      url: '/draft-1/publish-attempts/attempt-1/resolve',
      payload: {
        expectedStateVersion: 4,
        decision: 'SUBMITTED',
        note: 'Missing task ID',
        evidence: { source: 'operator' },
      },
    });
    expect(invalid.statusCode).toBe(400);

    const wrongDraft = await app.inject({
      method: 'POST',
      url: '/draft-1/publish-attempts/attempt-1/resolve',
      payload: {
        expectedStateVersion: 4,
        decision: 'NOT_SUBMITTED',
        note: 'Verified no matching task',
        evidence: { source: 'operator' },
      },
    });
    expect(wrongDraft.statusCode).toBe(404);
    expect(publisher.resolveAttempt).not.toHaveBeenCalled();
    await app.close();
  });
});

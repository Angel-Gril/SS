import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { aiImageSuiteRoutes } from '../routes/ai-image-suites.js';
import {
  AiImageSuiteError,
  type AiImageSuiteProviderConfig,
  type AiImageSuiteService,
} from '../services/ai-image-suite.js';
import {
  AI_IMAGE_SUITE_MODEL,
  AI_IMAGE_SUITE_PROVIDER,
} from '../services/ai-image-provider-capabilities.js';

const providerConfig: AiImageSuiteProviderConfig = {
  provider: AI_IMAGE_SUITE_PROVIDER,
  model: AI_IMAGE_SUITE_MODEL,
  providerConfigHash: 'c'.repeat(64),
  pricingVersion: 'provider-free-zero/v1',
  estimatedCostPerImageCents: 0,
  maximumCostPerImageCents: 0,
  concurrencyLimit: 2,
};

function preview() {
  return {
    version: 'ai-image-suite-preview/v1' as const,
    planId: 'plan-1',
    planVersionId: 'plan-version-1',
    planRevision: 3,
    planHash: 'a'.repeat(64),
    provider: AI_IMAGE_SUITE_PROVIDER,
    model: AI_IMAGE_SUITE_MODEL,
    providerConfigHash: 'c'.repeat(64),
    pricingVersion: 'provider-free-zero/v1',
    concurrencyLimit: 2,
    itemCount: 1,
    estimatedCostCents: 0,
    maximumCostCents: 0,
    previewHash: 'd'.repeat(64),
    slots: [{
      ordinal: 0,
      slotKey: 'sku:sku-1:hero',
      goal: 'sku_hero',
      ownership: { level: 'sku' as const, key: 'sku-1' },
      compatibilityGroupKey: null,
      references: [{
        candidateId: 'main-1',
        evidenceIds: ['secret-evidence'],
        source: {
          url: 'https://source.example/private-reference.png',
          width: 900,
          height: 1200,
          mimeType: 'image/png',
          role: 'product_main',
          skuKeys: ['sku-1'],
        },
      }],
      slotSnapshot: { prompt: 'must not leak' },
      slotHash: 'e'.repeat(64),
      referencesHash: 'f'.repeat(64),
      estimatedCostCents: 0,
      maximumCostCents: 0,
    }],
  };
}

function suite() {
  return {
    id: 'suite-1',
    ownerUserId: 'owner-1',
    actorUserId: 'actor-1',
    planId: 'plan-1',
    planVersionId: 'plan-version-1',
    status: 'PLANNED',
    revision: 1,
    previewHash: 'd'.repeat(64),
    itemCount: 1,
    estimatedCostCents: 0,
    maximumCostCents: 0,
    slots: [{
      id: 'suite-slot-1',
      suiteId: 'suite-1',
      ownerUserId: 'owner-1',
      ordinal: 0,
      slotKey: 'sku:sku-1:hero',
      goal: 'sku_hero',
      ownershipLevel: 'sku',
      ownershipKey: 'sku-1',
      compatibilityGroupKey: null,
      slotSnapshot: { prompt: 'must not leak' },
      slotHash: 'e'.repeat(64),
      referencesSnapshot: [{
        candidateId: 'main-1',
        evidenceIds: ['secret-evidence'],
        source: { url: 'https://source.example/private-reference.png' },
      }],
      referencesHash: 'f'.repeat(64),
      diagnostics: [
        'OCR_LOW_CONFIDENCE',
        'OCR_LOW_CONFIDENCE',
        'https://provider.example/result?token=secret-diagnostic',
        ...Array.from({ length: 25 }, (_, index) => `QUALITY_WARNING_${index}`),
      ],
      status: 'PLANNED',
      childWorkflowId: null,
      attempt: 0,
      estimatedCostCents: 0,
      maximumCostCents: 0,
      errorCode: 'PROVIDER_REQUEST_FAILED',
      errorMessage: 'signed URL https://provider.example/result?token=secret-error',
    }],
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
    updatedAt: new Date('2026-07-19T00:00:00.000Z'),
  };
}

function serviceMock() {
  return {
    preview: vi.fn(async () => preview()),
    claim: vi.fn(async () => ({ suite: suite(), replayed: false })),
    get: vi.fn(async () => suite()),
  } as unknown as AiImageSuiteService;
}

async function build(options: {
  service?: AiImageSuiteService;
  suiteEnabled?: boolean;
  workflowEnabled?: boolean;
  webMediaEnabled?: boolean;
  production?: boolean;
  config?: AiImageSuiteProviderConfig;
} = {}) {
  const app = Fastify();
  const service = options.service || serviceMock();
  await app.register(aiImageSuiteRoutes, {
    service,
    production: options.production ?? false,
    getSuiteEnabled: async () => options.suiteEnabled ?? true,
    getMediaWorkflowEnabled: async () => options.workflowEnabled ?? true,
    getSourceListingWebMediaEnabled: async () => options.webMediaEnabled ?? true,
    getProviderConfig: async () => options.config || providerConfig,
    authenticate: async (request: FastifyRequest) => {
      (request as any).user = {
        userId: 'owner-1',
        effectiveUserId: 'owner-1',
        actorUserId: 'actor-1',
      };
    },
  });
  return { app, service };
}

describe('AI image suite routes', () => {
  it('previews a suite with server-owned actor and provider config while stripping frozen secrets', async () => {
    const { app, service } = await build();
    const response = await app.inject({
      method: 'POST',
      url: '/suites/preview',
      payload: { planId: 'plan-1' },
    });

    expect(response.statusCode).toBe(200);
    expect(service.preview).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      planId: 'plan-1',
      providerConfig,
    });
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        planId: 'plan-1',
        previewHash: 'd'.repeat(64),
        itemCount: 1,
        slots: [{
          slotKey: 'sku:sku-1:hero',
          references: [{ candidateId: 'main-1', source: { width: 900, height: 1200 } }],
        }],
      },
    });
    const serialized = JSON.stringify(response.json());
    expect(serialized).not.toContain('private-reference');
    expect(serialized).not.toContain('secret-evidence');
    expect(serialized).not.toContain('must not leak');
    expect(serialized).not.toContain('providerConfigHash');
    expect(serialized).not.toContain('planHash');
  });

  it('claims a preview idempotently and never accepts client provider or owner authority', async () => {
    const { app, service } = await build();
    const invalid = await app.inject({
      method: 'POST',
      url: '/suites/claim',
      payload: {
        planId: 'plan-1',
        expectedPlanRevision: 3,
        expectedPreviewHash: 'd'.repeat(64),
        idempotencyKey: 'suite-claim-1',
        ownerUserId: 'attacker',
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(service.claim).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'POST',
      url: '/suites/claim',
      payload: {
        planId: 'plan-1',
        expectedPlanRevision: 3,
        expectedPreviewHash: 'd'.repeat(64),
        idempotencyKey: 'suite-claim-1',
      },
    });
    expect(response.statusCode).toBe(202);
    expect(service.claim).toHaveBeenCalledWith({
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      planId: 'plan-1',
      expectedPlanRevision: 3,
      expectedPreviewHash: 'd'.repeat(64),
      idempotencyKey: 'suite-claim-1',
      providerConfig,
    });
    expect(response.json()).toMatchObject({
      code: 1,
      replayed: false,
      data: {
        id: 'suite-1',
        slots: [{
          slotKey: 'sku:sku-1:hero',
          referenceCandidateIds: ['main-1'],
          diagnostics: expect.arrayContaining(['OCR_LOW_CONFIDENCE']),
          errorCode: 'PROVIDER_REQUEST_FAILED',
        }],
      },
    });
    const serialized = JSON.stringify(response.json());
    expect(serialized).not.toContain('ownerUserId');
    expect(serialized).not.toContain('actorUserId');
    expect(serialized).not.toContain('private-reference');
    expect(serialized).not.toContain('secret-evidence');
    expect(serialized).not.toContain('slotHash');
    expect(serialized).not.toContain('referencesHash');
    expect(serialized).not.toContain('secret-diagnostic');
    expect(serialized).not.toContain('secret-error');
    expect(response.json().data.slots[0].diagnostics).toHaveLength(20);
  });

  it('returns 200 for a claim replay and maps suite errors', async () => {
    const replayService = serviceMock();
    (replayService.claim as any).mockResolvedValueOnce({ suite: suite(), replayed: true });
    const replay = await build({ service: replayService });
    const replayResponse = await replay.app.inject({
      method: 'POST',
      url: '/suites/claim',
      payload: {
        planId: 'plan-1', expectedPlanRevision: 3,
        expectedPreviewHash: 'd'.repeat(64), idempotencyKey: 'suite-claim-replay',
      },
    });
    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.json()).toMatchObject({ replayed: true });

    const errorService = serviceMock();
    (errorService.preview as any).mockRejectedValueOnce(new AiImageSuiteError(
      'AI_MEDIA_SUITE_NOT_APPROVED',
      'not approved',
      409,
    ));
    const failed = await build({ service: errorService });
    const failedResponse = await failed.app.inject({
      method: 'POST', url: '/suites/preview', payload: { planId: 'plan-1' },
    });
    expect(failedResponse.statusCode).toBe(409);
    expect(failedResponse.json()).toEqual({ code: 'AI_MEDIA_SUITE_NOT_APPROVED', msg: 'not approved' });
  });

  it.each([
    [{ suiteEnabled: false }, 'AI_MEDIA_SUITE_DISABLED'],
    [{ suiteEnabled: true, workflowEnabled: false }, 'AI_MEDIA_WORKFLOW_DISABLED'],
    [{ suiteEnabled: true, workflowEnabled: true, webMediaEnabled: false }, 'SOURCE_LISTING_WEB_MEDIA_DISABLED'],
  ] as const)('fails closed before preview and claim when a write gate is disabled', async (flags, code) => {
    const { app, service } = await build(flags);
    const previewResponse = await app.inject({
      method: 'POST', url: '/suites/preview', payload: { planId: 'plan-1' },
    });
    const claimResponse = await app.inject({
      method: 'POST',
      url: '/suites/claim',
      payload: {
        planId: 'plan-1', expectedPlanRevision: 3,
        expectedPreviewHash: 'd'.repeat(64), idempotencyKey: 'suite-claim-gated',
      },
    });

    expect(previewResponse.statusCode).toBe(503);
    expect(claimResponse.statusCode).toBe(503);
    expect(previewResponse.json()).toMatchObject({ code });
    expect(claimResponse.json()).toMatchObject({ code });
    expect(service.preview).not.toHaveBeenCalled();
    expect(service.claim).not.toHaveBeenCalled();
  });

  it('keeps fake claim fail-closed in production without blocking provider-free preview', async () => {
    const { app, service } = await build({ production: true });
    const previewResponse = await app.inject({
      method: 'POST', url: '/suites/preview', payload: { planId: 'plan-1' },
    });
    const claimResponse = await app.inject({
      method: 'POST',
      url: '/suites/claim',
      payload: {
        planId: 'plan-1', expectedPlanRevision: 3,
        expectedPreviewHash: 'd'.repeat(64), idempotencyKey: 'suite-claim-production',
      },
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(claimResponse.statusCode).toBe(503);
    expect(claimResponse.json()).toMatchObject({ code: 'AI_MEDIA_SUITE_PROVIDER_NOT_READY' });
    expect(service.preview).toHaveBeenCalledTimes(1);
    expect(service.claim).not.toHaveBeenCalled();
  });

  it('keeps owner-scoped historical suite reads available while all write flags are dark', async () => {
    const { app, service } = await build({
      suiteEnabled: false,
      workflowEnabled: false,
      webMediaEnabled: false,
      production: true,
    });
    const response = await app.inject({ method: 'GET', url: '/suites/suite-1' });

    expect(response.statusCode).toBe(200);
    expect(service.get).toHaveBeenCalledWith('suite-1', 'owner-1');
    expect(response.json()).toMatchObject({ code: 1, data: { id: 'suite-1' } });
  });

  it('maps an owner-scoped missing suite to 404 without consulting write gates', async () => {
    const service = serviceMock();
    (service.get as any).mockRejectedValueOnce(new AiImageSuiteError(
      'AI_MEDIA_SUITE_NOT_FOUND',
      'missing',
      404,
    ));
    const { app } = await build({
      service,
      suiteEnabled: false,
      workflowEnabled: false,
      webMediaEnabled: false,
    });
    const response = await app.inject({ method: 'GET', url: '/suites/other-owner-suite' });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({ code: 'AI_MEDIA_SUITE_NOT_FOUND', msg: 'missing' });
    expect(service.get).toHaveBeenCalledWith('other-owner-suite', 'owner-1');
  });
});

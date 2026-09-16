import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { aiImageSuiteRoutes } from '../routes/ai-image-suites.js';
import { hashAiMediaPlanningJson } from '../services/ai-media-planning.js';
import {
  AiImageSuiteError,
  type AiImageSuiteProviderConfig,
  type AiImageSuiteService,
} from '../services/ai-image-suite.js';
import {
  AI_IMAGE_SUITE_MODEL,
  AI_IMAGE_SUITE_PROVIDER,
} from '../services/ai-image-provider-capabilities.js';
import {
  AiImageSuiteReferenceError,
  type AiImageSuiteReferenceService,
} from '../services/ai-image-suite-references.js';
import {
  AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY,
  AiImageSuitePromptError,
  type AiImageSuitePromptService,
} from '../services/ai-image-suite-prompts.js';
import {
  AiImageSuiteMaterializationError,
  type AiImageSuiteMaterializationService,
} from '../services/ai-image-suite-materialization.js';
import {
  AiImageSuiteExecutionError,
  type AiImageSuiteExecutionService,
} from '../services/ai-image-suite-execution.js';
import {
  AiImageSuiteCandidateError,
  type AiImageSuiteCandidateService,
} from '../services/ai-image-suite-candidates.js';
import { AiMediaApplicationMutationError } from '../services/ai-media-application-mutations.js';
import * as capabilities from '../services/ai-image-provider-capabilities.js';

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
          contentHash: null,
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
    provider: AI_IMAGE_SUITE_PROVIDER,
    model: AI_IMAGE_SUITE_MODEL,
    providerConfigHash: 'c'.repeat(64),
    pricingVersion: 'provider-free-zero/v1',
    itemCount: 1,
    estimatedCostCents: 0,
    maximumCostCents: 0,
    concurrencyLimit: 2,
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
    getCurrentByPlan: vi.fn(async () => suite()),
    getActiveByPlan: vi.fn(async () => suite()),
  } as unknown as AiImageSuiteService;
}

it('exposes the frozen Wanx currency through preview and suite reads without relabeling legacy USD', async () => {
  for (const wanx of [false, true]) {
    const pricingVersion = wanx ? `ai-image-suite-price-cny/v1:${'a'.repeat(32)}` : 'ai-image-suite-price/v1:legacy';
    const service = serviceMock();
    vi.mocked(service.preview).mockResolvedValue({ ...preview(), pricingVersion });
    vi.mocked(service.get).mockResolvedValue({ ...suite(), pricingVersion });
    const { app } = await build({ service });
    try {
      const previewResponse = await app.inject({ method: 'POST', url: '/suites/preview', payload: { planId: 'plan-1' } });
      expect(previewResponse.json().data.currency).toBe(wanx ? 'CNY' : 'USD');
      const suiteResponse = await app.inject({ method: 'GET', url: '/suites/suite-1' });
      expect(suiteResponse.json().data.currency).toBe(wanx ? 'CNY' : 'USD');
    } finally { await app.close(); }
  }
});

it('uses validated Wanx runtime readiness without fabricating sandbox evidence and still blocks unavailable runtime', async () => {
  const wanxCapability = capabilities.resolveAiImageProviderCapability('dashscope-wanx', 'wanx2.1-imageedit')!;
  const originalResolve = capabilities.resolveAiImageProviderCapability;
  const spy = vi.spyOn(capabilities, 'resolveAiImageProviderCapability').mockImplementation((provider, model) =>
    provider === 'dashscope-wanx' ? { ...wanxCapability, evidenceLevel: 'adapter-characterized', sandboxEvidence: [] } : originalResolve(provider, model));
  try {
    for (const runtimeReady of [true, false]) {
      const service = serviceMock();
      const { app } = await build({ service, production: true,
        config: { ...providerConfig, provider: 'dashscope-wanx', model: 'wanx2.1-imageedit',
          pricingVersion: `ai-image-suite-price-cny/v1:${'a'.repeat(32)}`, estimatedCostPerImageCents: 14, maximumCostPerImageCents: 14 },
        runtimeReadiness: { queueReady: true, runtimeReady },
      });
      try {
        const response = await app.inject({ method: 'POST', url: '/suites/claim', payload: { planId: 'plan-1', expectedPlanRevision: 3,
          expectedPreviewHash: 'd'.repeat(64), idempotencyKey: 'wanx-claim-test-1' } });
        expect(response.statusCode).toBe(runtimeReady ? 202 : 503);
        if (!runtimeReady) expect(service.claim).not.toHaveBeenCalled();
      } finally { await app.close(); }
    }
  } finally { spy.mockRestore(); }
});

function referenceServiceMock() {
  return {
    internalize: vi.fn(async () => ({
      suiteId: 'suite-1',
      referenceCount: 1,
      referenceSetHash: '9'.repeat(64),
      replayed: false,
      bindings: [{
        candidateId: 'private-candidate',
        sourceUrl: 'https://source.example/private-reference.png',
        assetUrl: 'https://storage.example/private-reference.png',
        sourceSha256: '7'.repeat(64),
        assetSha256: '8'.repeat(64),
      }],
    })),
  } as unknown as Pick<AiImageSuiteReferenceService, 'internalize'>;
}

function promptServiceMock() {
  return {
    freeze: vi.fn(async () => ({
      suiteId: 'suite-1',
      promptSetHash: '4'.repeat(64),
      promptCount: 1,
      templateKey: AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY,
      templateReleaseId: 'release-7',
      templateSequence: 7,
      templateChecksum: '6'.repeat(64),
      replayed: false,
      resolvedPrompt: 'must not leak',
      variablesSnapshot: { secret: 'must not leak' },
    })),
  } as unknown as Pick<AiImageSuitePromptService, 'freeze'>;
}

function materializationServiceMock() {
  return {
    materialize: vi.fn(async () => ({
      suiteId: 'suite-1',
      revision: 4 as const,
      status: 'PLANNED' as const,
      childCount: 1,
      estimatedCostCents: 0,
      maximumCostCents: 0,
      materializationHash: '8'.repeat(64),
      children: [{
        ordinal: 0,
        slotKey: 'sku:sku-1:hero',
        childWorkflowId: 'workflow-1',
      }],
      replayed: false,
      resolvedPrompt: 'must not leak',
      sourceUrl: 'https://source.example/private-reference.png',
    })),
  } as unknown as Pick<AiImageSuiteMaterializationService, 'materialize'>;
}

function executionSummary(replayed = false) {
  return {
    suiteId: 'suite-1',
    revision: 5,
    status: 'QUEUED' as const,
    itemCount: 1,
    concurrencyLimit: 1,
    counts: {
      planned: 0,
      queued: 1,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelRequested: 0,
      cancelled: 0,
    },
    slots: [{
      slotId: 'suite-slot-1',
      ordinal: 0,
      slotKey: 'sku:sku-1:hero',
      status: 'QUEUED' as const,
      attempt: 1,
      revision: 3,
      childWorkflowId: 'workflow-1',
      error: {
        code: 'PROVIDER_FAILED',
        message: 'https://provider.example/private-output?token=secret',
      },
      providerJobId: 'provider-job-secret',
      outputUrl: 'https://provider.example/private-output?token=secret',
      promptHash: 'a'.repeat(64),
    }],
    replayed,
  };
}

function executionServiceMock() {
  return {
    dispatch: vi.fn(async () => executionSummary()),
    cancel: vi.fn(async () => ({
      ...executionSummary(),
      revision: 6,
      status: 'CANCELLED' as const,
      counts: {
        planned: 0, queued: 0, running: 0, succeeded: 0,
        failed: 0, cancelRequested: 0, cancelled: 1,
      },
      slots: [{
        ...executionSummary().slots[0],
        status: 'CANCELLED' as const,
        revision: 4,
      }],
    })),
    retryFailedSlot: vi.fn(async () => ({
      ...executionSummary(),
      revision: 8,
      slots: [{
        ...executionSummary().slots[0],
        attempt: 2,
        revision: 6,
      }],
    })),
  } as unknown as Pick<
    AiImageSuiteExecutionService,
    'dispatch' | 'cancel' | 'retryFailedSlot'
  >;
}

function candidateServiceMock() {
  return {
    review: vi.fn(async () => ({
      review: {
        suiteId: 'suite-1', slotId: 'suite-slot-1', workflowId: 'workflow-1',
        outputAssetId: 'asset-1', reviewStatus: 'APPROVED' as const,
        workflowRevision: 4, reviewedAt: new Date('2026-07-20T01:00:00.000Z'),
      },
      replayed: false,
    })),
    apply: vi.fn(async () => ({
      application: {
        suiteId: 'suite-1', slotId: 'suite-slot-1', workflowId: 'workflow-1',
        jobId: 'job-1', outputAssetId: 'asset-1', mode: 'append' as const,
        targetType: 'collect' as const, targetId: 'goods-1',
        images: ['/original.png', '/suite-output.png'], mainImage: '/original.png',
        editedImages: ['/suite-output.png'],
        targetUpdatedAt: new Date('2026-07-20T01:01:00.000Z'),
        appliedAt: new Date('2026-07-20T01:01:00.000Z'),
      },
      replayed: false,
    })),
  } as unknown as AiImageSuiteCandidateService;
}

async function build(options: {
  service?: AiImageSuiteService;
  referenceService?: Pick<AiImageSuiteReferenceService, 'internalize'> | null;
  promptService?: Pick<AiImageSuitePromptService, 'freeze'> | null;
  materializationService?: Pick<AiImageSuiteMaterializationService, 'materialize'> | null;
  executionService?: Pick<
    AiImageSuiteExecutionService,
    'dispatch' | 'cancel' | 'retryFailedSlot'
  > | null;
  candidateService?: AiImageSuiteCandidateService;
  applicationService?: { apply(input: any): Promise<any> };
  enqueueSuiteFrontier?: ((suiteId: string) => Promise<void>) | null;
  suiteEnabled?: boolean;
  workflowEnabled?: boolean;
  webMediaEnabled?: boolean;
  production?: boolean;
  config?: AiImageSuiteProviderConfig;
  runtimeReadiness?: { queueReady: boolean; runtimeReady: boolean };
  storageReadiness?: {
    ready: boolean;
    backend: 'local' | 'oss' | 'ozon-cdn' | null;
    publicHttps: boolean;
    reason: string;
  };
} = {}) {
  const app = Fastify();
  const service = options.service || serviceMock();
  const referenceService = options.referenceService === null
    ? undefined
    : options.referenceService || referenceServiceMock();
  const promptService = options.promptService === null
    ? undefined
    : options.promptService || promptServiceMock();
  const materializationService = options.materializationService === null
    ? undefined
    : options.materializationService || materializationServiceMock();
  const executionService = options.executionService === null
    ? undefined
    : options.executionService || executionServiceMock();
  const candidateService = options.candidateService || candidateServiceMock();
  const enqueueSuiteFrontier = options.enqueueSuiteFrontier === null
    ? undefined
    : options.enqueueSuiteFrontier || vi.fn(async () => undefined);
  await app.register(aiImageSuiteRoutes, {
    service,
    candidateService,
    ...(options.applicationService ? { applicationService: options.applicationService } : {}),
    ...(referenceService ? { referenceService } : {}),
    ...(promptService ? { promptService } : {}),
    ...(materializationService ? { materializationService } : {}),
    ...(executionService ? { executionService } : {}),
    ...(enqueueSuiteFrontier ? { enqueueSuiteFrontier } : {}),
    production: options.production ?? false,
    getSuiteEnabled: async () => options.suiteEnabled ?? true,
    getMediaWorkflowEnabled: async () => options.workflowEnabled ?? true,
    getSourceListingWebMediaEnabled: async () => options.webMediaEnabled ?? true,
    getProviderConfig: async () => options.config || providerConfig,
    getSuiteRuntimeReadiness: async () => options.runtimeReadiness || {
      queueReady: true,
      runtimeReady: true,
    },
    getReferenceStorageReadiness: async () => options.storageReadiness || {
      ready: true,
      backend: 'local',
      publicHttps: false,
      reason: 'Local test storage is ready',
    },
    authenticate: async (request: FastifyRequest) => {
      (request as any).user = {
        userId: 'owner-1',
        effectiveUserId: 'owner-1',
        actorUserId: 'actor-1',
      };
    },
  });
  return {
    app,
    service,
    referenceService,
    promptService,
    materializationService,
    executionService,
    candidateService,
    applicationService: options.applicationService,
    enqueueSuiteFrontier,
  };
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

    const activeConflictService = serviceMock();
    (activeConflictService.claim as any).mockRejectedValueOnce(new AiImageSuiteError(
      'AI_MEDIA_SUITE_PLAN_ACTIVE_CONFLICT',
      'another plan version is active',
      409,
    ));
    const activeConflict = await build({ service: activeConflictService });
    const activeConflictResponse = await activeConflict.app.inject({
      method: 'POST',
      url: '/suites/claim',
      payload: {
        planId: 'plan-1', expectedPlanRevision: 3,
        expectedPreviewHash: 'd'.repeat(64), idempotencyKey: 'suite-active-conflict',
      },
    });
    expect(activeConflictResponse.statusCode).toBe(409);
    expect(activeConflictResponse.json()).toEqual({
      code: 'AI_MEDIA_SUITE_PLAN_ACTIVE_CONFLICT',
      msg: 'another plan version is active',
    });
  });

  it('internalizes only server-owned frozen references and strips binding secrets', async () => {
    const { app, referenceService } = await build();
    const rejected = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/references/internalize',
      payload: {
        expectedRevision: 1,
        operationKey: 'reference-operation-1',
        candidateIds: ['attacker-candidate'],
        sourceUrl: 'https://attacker.example/image.png',
        ownerUserId: 'attacker',
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(referenceService?.internalize).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/references/internalize',
      payload: { expectedRevision: 1, operationKey: 'reference-operation-1' },
    });
    expect(response.statusCode).toBe(200);
    expect(referenceService?.internalize).toHaveBeenCalledWith({
      suiteId: 'suite-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: 1,
      operationKey: 'reference-operation-1',
    });
    expect(response.json()).toEqual({
      code: 1,
      data: {
        suiteId: 'suite-1',
        referenceCount: 1,
        referenceSetHash: '9'.repeat(64),
      },
      replayed: false,
    });
    const serialized = response.body;
    expect(serialized).not.toContain('private-candidate');
    expect(serialized).not.toContain('private-reference');
    expect(serialized).not.toContain('sourceSha256');
    expect(serialized).not.toContain('assetSha256');
  });

  it('maps typed reference errors and fails closed when production wiring is unavailable', async () => {
    const referenceService = referenceServiceMock();
    (referenceService.internalize as any).mockRejectedValueOnce(new AiImageSuiteReferenceError(
      'AI_MEDIA_SUITE_REFERENCE_STALE',
      409,
      'stale source authority',
    ));
    const failed = await build({ referenceService });
    const failedResponse = await failed.app.inject({
      method: 'POST',
      url: '/suites/suite-1/references/internalize',
      payload: { expectedRevision: 1, operationKey: 'reference-operation-2' },
    });
    expect(failedResponse.statusCode).toBe(409);
    expect(failedResponse.json()).toEqual({
      code: 'AI_MEDIA_SUITE_REFERENCE_STALE',
      msg: 'stale source authority',
    });

    const unavailable = await build({ referenceService: null });
    const unavailableResponse = await unavailable.app.inject({
      method: 'POST',
      url: '/suites/suite-1/references/internalize',
      payload: { expectedRevision: 1, operationKey: 'reference-operation-3' },
    });
    expect(unavailableResponse.statusCode).toBe(503);
    expect(unavailableResponse.json()).toMatchObject({
      code: 'AI_MEDIA_SUITE_REFERENCE_SERVICE_NOT_READY',
    });
  });

  it('freezes only server-derived slot Prompts and returns a secret-free version summary', async () => {
    const { app, promptService } = await build();
    const rejected = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/prompts/freeze',
      payload: {
        expectedRevision: 2,
        operationKey: 'prompt-freeze-operation-1',
        templateKey: 'attacker-template',
        variables: { userPrompt: 'attacker prompt' },
        provider: 'attacker',
        ownerUserId: 'attacker',
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(promptService?.freeze).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/prompts/freeze',
      payload: { expectedRevision: 2, operationKey: 'prompt-freeze-operation-1' },
    });
    expect(response.statusCode).toBe(202);
    expect(promptService?.freeze).toHaveBeenCalledWith({
      suiteId: 'suite-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: 2,
      operationKey: 'prompt-freeze-operation-1',
    });
    expect(response.json()).toEqual({
      code: 1,
      data: {
        suiteId: 'suite-1',
        promptSetHash: '4'.repeat(64),
        promptCount: 1,
        templateKey: AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY,
        templateReleaseId: 'release-7',
        templateSequence: 7,
        templateChecksum: '6'.repeat(64),
      },
      replayed: false,
    });
    expect(response.body).not.toContain('must not leak');
    expect(response.body).not.toContain('variablesSnapshot');
    expect(response.body).not.toContain('resolvedPrompt');
  });

  it('returns 200 for exact Prompt replay and maps typed/unwired Prompt failures', async () => {
    const replayService = promptServiceMock();
    vi.mocked(replayService.freeze).mockResolvedValueOnce({
      suiteId: 'suite-1', promptSetHash: '4'.repeat(64), promptCount: 1,
      templateKey: AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY,
      templateReleaseId: 'release-7', templateSequence: 7,
      templateChecksum: '6'.repeat(64), replayed: true,
    });
    const replay = await build({ promptService: replayService });
    const replayResponse = await replay.app.inject({
      method: 'POST', url: '/suites/suite-1/prompts/freeze',
      payload: { expectedRevision: 2, operationKey: 'prompt-freeze-replay-1' },
    });
    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.json()).toMatchObject({ replayed: true });

    const failedService = promptServiceMock();
    vi.mocked(failedService.freeze).mockRejectedValueOnce(new AiImageSuitePromptError(
      'AI_MEDIA_SUITE_PROMPT_STALE', 409, 'stale prompt authority',
    ));
    const failed = await build({ promptService: failedService });
    const failedResponse = await failed.app.inject({
      method: 'POST', url: '/suites/suite-1/prompts/freeze',
      payload: { expectedRevision: 2, operationKey: 'prompt-freeze-failure-1' },
    });
    expect(failedResponse.statusCode).toBe(409);
    expect(failedResponse.json()).toEqual({
      code: 'AI_MEDIA_SUITE_PROMPT_STALE', msg: 'stale prompt authority',
    });

    const unavailable = await build({ promptService: null });
    const unavailableResponse = await unavailable.app.inject({
      method: 'POST', url: '/suites/suite-1/prompts/freeze',
      payload: { expectedRevision: 2, operationKey: 'prompt-freeze-unwired-1' },
    });
    expect(unavailableResponse.statusCode).toBe(503);
    expect(unavailableResponse.json()).toMatchObject({
      code: 'AI_MEDIA_SUITE_PROMPT_SERVICE_NOT_READY',
    });
  });

  it('materializes only server-authorized frozen children and returns a secret-free summary', async () => {
    const { app, materializationService } = await build();
    const rejected = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/children/materialize',
      payload: {
        expectedRevision: 3,
        operationKey: 'children-materialize-operation-1',
        prompt: 'attacker prompt',
        referenceAssetIds: ['attacker-asset'],
        ownerUserId: 'attacker',
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(materializationService?.materialize).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/children/materialize',
      payload: { expectedRevision: 3, operationKey: 'children-materialize-operation-1' },
    });
    expect(response.statusCode).toBe(202);
    expect(materializationService?.materialize).toHaveBeenCalledWith({
      suiteId: 'suite-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: 3,
      operationKey: 'children-materialize-operation-1',
    });
    expect(response.json()).toEqual({
      code: 1,
      data: {
        suiteId: 'suite-1',
        revision: 4,
        status: 'PLANNED',
        childCount: 1,
        estimatedCostCents: 0,
        maximumCostCents: 0,
        materializationHash: '8'.repeat(64),
        children: [{
          ordinal: 0,
          slotKey: 'sku:sku-1:hero',
          childWorkflowId: 'workflow-1',
        }],
      },
      replayed: false,
    });
    expect(response.body).not.toContain('must not leak');
    expect(response.body).not.toContain('private-reference');
    expect(response.body).not.toContain('reservation');
    expect(response.body).not.toContain('jobId');
  });

  it('returns 200 for exact child replay and maps typed/unwired materialization failures', async () => {
    const replayService = materializationServiceMock();
    vi.mocked(replayService.materialize).mockResolvedValueOnce({
      suiteId: 'suite-1', revision: 4, status: 'PLANNED', childCount: 1,
      estimatedCostCents: 0, maximumCostCents: 0,
      materializationHash: '8'.repeat(64),
      children: [{ ordinal: 0, slotKey: 'sku:sku-1:hero', childWorkflowId: 'workflow-1' }],
      replayed: true,
    });
    const replay = await build({ materializationService: replayService });
    const replayResponse = await replay.app.inject({
      method: 'POST', url: '/suites/suite-1/children/materialize',
      payload: { expectedRevision: 3, operationKey: 'children-materialize-replay-1' },
    });
    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.json()).toMatchObject({ replayed: true });

    const failedService = materializationServiceMock();
    vi.mocked(failedService.materialize).mockRejectedValueOnce(new AiImageSuiteMaterializationError(
      'AI_MEDIA_SUITE_MATERIALIZATION_STALE', 409, 'stale materialization authority',
    ));
    const failed = await build({ materializationService: failedService });
    const failedResponse = await failed.app.inject({
      method: 'POST', url: '/suites/suite-1/children/materialize',
      payload: { expectedRevision: 3, operationKey: 'children-materialize-failure-1' },
    });
    expect(failedResponse.statusCode).toBe(409);
    expect(failedResponse.json()).toEqual({
      code: 'AI_MEDIA_SUITE_MATERIALIZATION_STALE', msg: 'stale materialization authority',
    });

    const unavailable = await build({ materializationService: null });
    const unavailableResponse = await unavailable.app.inject({
      method: 'POST', url: '/suites/suite-1/children/materialize',
      payload: { expectedRevision: 3, operationKey: 'children-materialize-unwired-1' },
    });
    expect(unavailableResponse.statusCode).toBe(503);
    expect(unavailableResponse.json()).toMatchObject({
      code: 'AI_MEDIA_SUITE_MATERIALIZATION_SERVICE_NOT_READY',
    });
  });

  it('dispatches a materialized suite with server-owned authority and enqueues its frontier', async () => {
    const { app, executionService, enqueueSuiteFrontier } = await build();
    const rejected = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/dispatch',
      payload: {
        expectedRevision: 4,
        operationKey: 'suite-dispatch-operation-1',
        ownerUserId: 'attacker',
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(executionService?.dispatch).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/dispatch',
      payload: { expectedRevision: 4, operationKey: 'suite-dispatch-operation-1' },
    });
    expect(response.statusCode).toBe(202);
    expect(executionService?.dispatch).toHaveBeenCalledWith({
      suiteId: 'suite-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: 4,
      operationKey: 'suite-dispatch-operation-1',
    });
    expect(enqueueSuiteFrontier).toHaveBeenCalledWith('suite-1');
    expect(response.json()).toMatchObject({
      code: 1,
      replayed: false,
      enqueuePending: false,
      data: {
        suiteId: 'suite-1',
        revision: 5,
        status: 'QUEUED',
        slots: [{
          slotId: 'suite-slot-1',
          status: 'QUEUED',
          errorCode: 'PROVIDER_FAILED',
        }],
      },
    });
    expect(response.body).not.toContain('provider-job-secret');
    expect(response.body).not.toContain('private-output');
    expect(response.body).not.toContain('promptHash');
    expect(response.body).not.toContain('token=secret');
  });

  it('re-enqueues exact dispatch replays and reports recoverable post-commit queue failure', async () => {
    const replayService = executionServiceMock();
    vi.mocked(replayService.dispatch).mockResolvedValueOnce(executionSummary(true));
    const replay = await build({ executionService: replayService });
    const replayResponse = await replay.app.inject({
      method: 'POST',
      url: '/suites/suite-1/dispatch',
      payload: { expectedRevision: 4, operationKey: 'suite-dispatch-replay-ok-1' },
    });
    expect(replayResponse.statusCode).toBe(200);
    expect(replayResponse.json()).toMatchObject({ replayed: true, enqueuePending: false });
    expect(replay.enqueueSuiteFrontier).toHaveBeenCalledWith('suite-1');

    const executionService = executionServiceMock();
    vi.mocked(executionService.dispatch).mockResolvedValueOnce(executionSummary(true));
    const enqueueSuiteFrontier = vi.fn(async () => {
      throw new Error('redis details must not leak');
    });
    const { app } = await build({ executionService, enqueueSuiteFrontier });
    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/dispatch',
      payload: { expectedRevision: 4, operationKey: 'suite-dispatch-replay-1' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ replayed: true, enqueuePending: true });
    expect(response.body).not.toContain('redis details');
    expect(enqueueSuiteFrontier).toHaveBeenCalledWith('suite-1');
  });

  it('cancels the full suite without filling another frontier slot', async () => {
    const { app, executionService, enqueueSuiteFrontier } = await build();
    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/cancel',
      payload: { expectedRevision: 5, operationKey: 'suite-cancel-operation-1' },
    });

    expect(response.statusCode).toBe(202);
    expect(executionService?.cancel).toHaveBeenCalledWith({
      suiteId: 'suite-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: 5,
      operationKey: 'suite-cancel-operation-1',
    });
    expect(enqueueSuiteFrontier).toHaveBeenCalledWith('suite-1');
    expect(response.json()).toMatchObject({
      replayed: false,
      enqueuePending: false,
      data: { suiteId: 'suite-1', revision: 6, status: 'CANCELLED' },
    });
  });

  it('selectively retries one failed slot and re-enqueues only through the suite frontier', async () => {
    const { app, executionService, enqueueSuiteFrontier } = await build();
    const rejected = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/slots/suite-slot-1/retry',
      payload: {
        expectedSlotRevision: 3,
        operationKey: 'suite-slot-retry-operation-1',
        prompt: 'attacker Prompt',
      },
    });
    expect(rejected.statusCode).toBe(400);
    expect(executionService?.retryFailedSlot).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/slots/suite-slot-1/retry',
      payload: { expectedSlotRevision: 3, operationKey: 'suite-slot-retry-operation-1' },
    });
    expect(response.statusCode).toBe(202);
    expect(executionService?.retryFailedSlot).toHaveBeenCalledWith({
      suiteId: 'suite-1',
      slotId: 'suite-slot-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedSlotRevision: 3,
      operationKey: 'suite-slot-retry-operation-1',
    });
    expect(enqueueSuiteFrontier).toHaveBeenCalledTimes(1);
    expect(enqueueSuiteFrontier).toHaveBeenCalledWith('suite-1');
    expect(response.json()).toMatchObject({
      replayed: false,
      enqueuePending: false,
      data: { revision: 8, slots: [{ attempt: 2, revision: 6 }] },
    });
  });

  it('maps typed execution failures and fails closed before an unwired execution write', async () => {
    const executionService = executionServiceMock();
    vi.mocked(executionService.retryFailedSlot).mockRejectedValueOnce(
      new AiImageSuiteExecutionError(
        'AI_MEDIA_SUITE_SLOT_NOT_FAILED',
        409,
        'Only failed slots can be retried',
      ),
    );
    const failed = await build({ executionService });
    const failedResponse = await failed.app.inject({
      method: 'POST',
      url: '/suites/suite-1/slots/suite-slot-1/retry',
      payload: { expectedSlotRevision: 3, operationKey: 'suite-slot-retry-failure-1' },
    });
    expect(failedResponse.statusCode).toBe(409);
    expect(failedResponse.json()).toEqual({
      code: 'AI_MEDIA_SUITE_SLOT_NOT_FAILED',
      msg: 'Only failed slots can be retried',
    });

    const activeConflictService = executionServiceMock();
    vi.mocked(activeConflictService.retryFailedSlot).mockRejectedValueOnce(
      new AiImageSuiteExecutionError(
        'AI_MEDIA_SUITE_PLAN_ACTIVE_CONFLICT',
        409,
        'Another plan version already has an actionable AI media suite',
      ),
    );
    const activeConflict = await build({ executionService: activeConflictService });
    const activeConflictResponse = await activeConflict.app.inject({
      method: 'POST',
      url: '/suites/suite-1/slots/suite-slot-1/retry',
      payload: { expectedSlotRevision: 3, operationKey: 'suite-slot-retry-active-conflict' },
    });
    expect(activeConflictResponse.statusCode).toBe(409);
    expect(activeConflictResponse.json()).toEqual({
      code: 'AI_MEDIA_SUITE_PLAN_ACTIVE_CONFLICT',
      msg: 'Another plan version already has an actionable AI media suite',
    });

    const unavailable = await build({ executionService: null });
    const unavailableResponse = await unavailable.app.inject({
      method: 'POST',
      url: '/suites/suite-1/cancel',
      payload: { expectedRevision: 5, operationKey: 'suite-cancel-unwired-1' },
    });
    expect(unavailableResponse.statusCode).toBe(503);
    expect(unavailableResponse.json()).toMatchObject({
      code: 'AI_MEDIA_SUITE_EXECUTION_SERVICE_NOT_READY',
    });

    const queueUnavailable = await build({ enqueueSuiteFrontier: null });
    const queueUnavailableResponse = await queueUnavailable.app.inject({
      method: 'POST',
      url: '/suites/suite-1/dispatch',
      payload: { expectedRevision: 4, operationKey: 'suite-dispatch-unwired-1' },
    });
    expect(queueUnavailableResponse.statusCode).toBe(503);
    expect(queueUnavailable.executionService?.dispatch).not.toHaveBeenCalled();
  });

  it.each([
    [{ suiteEnabled: false }, 'AI_MEDIA_SUITE_DISABLED'],
    [{ suiteEnabled: true, workflowEnabled: false }, 'AI_MEDIA_WORKFLOW_DISABLED'],
    [{ suiteEnabled: true, workflowEnabled: true, webMediaEnabled: false }, 'SOURCE_LISTING_WEB_MEDIA_DISABLED'],
  ] as const)('fails closed before suite writes when a write gate is disabled', async (flags, code) => {
    const {
      app,
      service,
      referenceService,
      promptService,
      materializationService,
      executionService,
      enqueueSuiteFrontier,
    } = await build(flags);
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
    const internalizeResponse = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/references/internalize',
      payload: { expectedRevision: 1, operationKey: 'reference-gated-operation' },
    });
    const prepareResponse = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/prepare',
      payload: { operationKey: 'prepare-gated-operation' },
    });
    const promptResponse = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/prompts/freeze',
      payload: { expectedRevision: 2, operationKey: 'prompt-gated-operation' },
    });
    const materializationResponse = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/children/materialize',
      payload: { expectedRevision: 3, operationKey: 'children-gated-operation' },
    });
    const dispatchResponse = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/dispatch',
      payload: { expectedRevision: 4, operationKey: 'suite-dispatch-gated-operation' },
    });
    const retryResponse = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/slots/suite-slot-1/retry',
      payload: { expectedSlotRevision: 3, operationKey: 'suite-retry-gated-operation' },
    });

    expect(previewResponse.statusCode).toBe(503);
    expect(claimResponse.statusCode).toBe(503);
    expect(internalizeResponse.statusCode).toBe(503);
    expect(prepareResponse.statusCode).toBe(503);
    expect(promptResponse.statusCode).toBe(503);
    expect(materializationResponse.statusCode).toBe(503);
    expect(dispatchResponse.statusCode).toBe(503);
    expect(retryResponse.statusCode).toBe(503);
    expect(previewResponse.json()).toMatchObject({ code });
    expect(claimResponse.json()).toMatchObject({ code });
    expect(internalizeResponse.json()).toMatchObject({ code });
    expect(prepareResponse.json()).toMatchObject({ code });
    expect(promptResponse.json()).toMatchObject({ code });
    expect(materializationResponse.json()).toMatchObject({ code });
    expect(dispatchResponse.json()).toMatchObject({ code });
    expect(retryResponse.json()).toMatchObject({ code });
    expect(service.preview).not.toHaveBeenCalled();
    expect(service.claim).not.toHaveBeenCalled();
    expect(referenceService?.internalize).not.toHaveBeenCalled();
    expect(promptService?.freeze).not.toHaveBeenCalled();
    expect(materializationService?.materialize).not.toHaveBeenCalled();
    expect(executionService?.dispatch).not.toHaveBeenCalled();
    expect(executionService?.retryFailedSlot).not.toHaveBeenCalled();
    expect(enqueueSuiteFrontier).not.toHaveBeenCalled();
  });

  it('keeps owner-scoped cancellation available while all creation flags are dark', async () => {
    const { app, executionService, enqueueSuiteFrontier } = await build({
      suiteEnabled: false,
      workflowEnabled: false,
      webMediaEnabled: false,
      production: true,
    });
    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/cancel',
      payload: { expectedRevision: 5, operationKey: 'suite-cancel-dark-flags-1' },
    });

    expect(response.statusCode).toBe(202);
    expect(executionService?.cancel).toHaveBeenCalledWith({
      suiteId: 'suite-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedRevision: 5,
      operationKey: 'suite-cancel-dark-flags-1',
    });
    expect(enqueueSuiteFrontier).toHaveBeenCalledWith('suite-1');
    expect(response.json()).toMatchObject({
      replayed: false,
      enqueuePending: false,
      data: { suiteId: 'suite-1', revision: 6, status: 'CANCELLED' },
    });
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
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        id: 'suite-1',
        provider: AI_IMAGE_SUITE_PROVIDER,
        model: AI_IMAGE_SUITE_MODEL,
        pricingVersion: 'provider-free-zero/v1',
      },
    });
    expect(response.body).not.toContain('previewHash');
    expect(response.body).not.toContain('slotHash');
    expect(response.body).not.toContain('referencesHash');
    expect(response.body).not.toContain('private-reference');
    expect(response.body).not.toContain('secret-error');
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

  it('reads the current owner-scoped suite with only current-attempt public assets while flags are dark', async () => {
    const service = serviceMock();
    const current = suite() as any;
    current.revision = 7;
    current.status = 'SUCCEEDED';
    current.slots[0] = {
      ...current.slots[0],
      status: 'SUCCEEDED',
      childWorkflowId: 'workflow-1',
      childWorkflow: {
        jobs: [{
          providerJobId: 'provider-job-secret',
          resolvedPrompt: 'secret frozen Prompt',
          assets: [{
            id: 'asset-1',
            ownerUserId: 'owner-1',
            url: '/uploads/suite-output.png',
            mimeType: 'image/png',
            width: 900,
            height: 1200,
            storageKey: 'tenant/private/storage-key',
            sha256: 'a'.repeat(64),
          }, {
            id: 'asset-2-must-not-be-projected',
            ownerUserId: 'owner-1',
            url: '/uploads/non-current-output.png',
            mimeType: 'image/png',
            width: 900,
            height: 1200,
          }],
        }],
      },
    };
    vi.mocked(service.getCurrentByPlan).mockResolvedValueOnce(current);
    const { app } = await build({
      service,
      suiteEnabled: false,
      workflowEnabled: false,
      webMediaEnabled: false,
      production: true,
    });

    const response = await app.inject({ method: 'GET', url: '/suites/current?planId=plan-1' });

    expect(response.statusCode).toBe(200);
    expect(service.getCurrentByPlan).toHaveBeenCalledWith('plan-1', 'owner-1');
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        id: 'suite-1',
        revision: 7,
        provider: AI_IMAGE_SUITE_PROVIDER,
        model: AI_IMAGE_SUITE_MODEL,
        pricingVersion: 'provider-free-zero/v1',
        slots: [{
          id: 'suite-slot-1',
          outputAssets: [{
            id: 'asset-1',
            url: '/uploads/suite-output.png',
            mimeType: 'image/png',
            width: 900,
            height: 1200,
          }],
        }],
      },
    });
    expect(response.body).not.toContain('previewHash');
    expect(response.body).not.toContain('provider-job-secret');
    expect(response.body).not.toContain('secret frozen Prompt');
    expect(response.body).not.toContain('storage-key');
    expect(response.body).not.toContain('sha256');
    expect(response.body).not.toContain('asset-2-must-not-be-projected');
    expect(response.body).not.toContain('token=secret-error');
  });

  it('keeps the suite readable while dropping an oversized current output URL', async () => {
    const service = serviceMock();
    const current = suite() as any;
    current.slots[0].childWorkflow = {
      jobs: [{
        assets: [{
          id: 'asset-oversized-url',
          ownerUserId: 'owner-1',
          url: `https://cdn.example.com/${'x'.repeat(4_100)}`,
          mimeType: 'image/png',
          width: 900,
          height: 1200,
        }],
      }],
    };
    vi.mocked(service.getCurrentByPlan).mockResolvedValueOnce(current);
    const { app } = await build({ service });

    const response = await app.inject({ method: 'GET', url: '/suites/current?planId=plan-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: { id: 'suite-1', slots: [{ outputAssets: [] }] },
    });
    expect(response.body).not.toContain('asset-oversized-url');
  });

  it('drops a current job asset whose owner does not match the suite owner', async () => {
    const service = serviceMock();
    const current = suite() as any;
    current.slots[0].childWorkflow = {
      jobs: [{
        assets: [{
          id: 'asset-other-owner',
          ownerUserId: 'owner-2',
          url: '/uploads/other-owner.png',
          mimeType: 'image/png',
          width: 900,
          height: 1200,
        }],
      }],
    };
    vi.mocked(service.getCurrentByPlan).mockResolvedValueOnce(current);
    const { app } = await build({ service });

    const response = await app.inject({ method: 'GET', url: '/suites/current?planId=plan-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: { id: 'suite-1', slots: [{ outputAssets: [] }] },
    });
    expect(response.body).not.toContain('asset-other-owner');
    expect(response.body).not.toContain('other-owner.png');
  });

  it('returns a successful null current-suite lookup without consulting write gates', async () => {
    const service = serviceMock();
    vi.mocked(service.getCurrentByPlan).mockResolvedValueOnce(null);
    const { app } = await build({
      service,
      suiteEnabled: false,
      workflowEnabled: false,
      webMediaEnabled: false,
    });

    const response = await app.inject({ method: 'GET', url: '/suites/current?planId=plan-without-suite' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ code: 1, data: null });
    expect(service.getCurrentByPlan).toHaveBeenCalledWith('plan-without-suite', 'owner-1');
  });

  it('keeps an older active suite owner-readable after the plan current version changes', async () => {
    const service = serviceMock();
    vi.mocked(service.getCurrentByPlan).mockResolvedValueOnce(null);
    const active = { ...suite(), revision: 5, status: 'RUNNING' };
    vi.mocked(service.getActiveByPlan).mockResolvedValueOnce(active);
    const { app } = await build({
      service,
      suiteEnabled: false,
      workflowEnabled: false,
      webMediaEnabled: false,
    });

    const [currentResponse, activeResponse] = await Promise.all([
      app.inject({ method: 'GET', url: '/suites/current?planId=plan-1' }),
      app.inject({ method: 'GET', url: '/suites/active?planId=plan-1' }),
    ]);

    expect(currentResponse.json()).toEqual({ code: 1, data: null });
    expect(activeResponse.json()).toMatchObject({
      code: 1,
      data: { id: 'suite-1', revision: 5, status: 'RUNNING' },
    });
    expect(service.getActiveByPlan).toHaveBeenCalledWith('plan-1', 'owner-1');
  });

  it('reports composite suite readiness without performing a write', async () => {
    const ready = await build();
    const readyResponse = await ready.app.inject({ method: 'GET', url: '/suites/readiness' });
    expect(readyResponse.statusCode).toBe(200);
    expect(readyResponse.json()).toMatchObject({
      code: 1,
      data: {
        suiteEnabled: true,
        workflowEnabled: true,
        webMediaEnabled: true,
        provider: {
          provider: AI_IMAGE_SUITE_PROVIDER,
          model: AI_IMAGE_SUITE_MODEL,
          evidenceLevel: 'local-test',
          ready: true,
        },
        services: {
          references: true,
          prompts: true,
          materialization: true,
          execution: true,
          queue: true,
          runtime: true,
        },
        storage: { ready: true, backend: 'local', publicHttps: false },
        ready: true,
        testOnly: true,
        reasonCode: 'READY',
      },
    });
    expect(ready.service.preview).not.toHaveBeenCalled();
    expect(ready.service.claim).not.toHaveBeenCalled();

    const dark = await build({ suiteEnabled: false });
    expect((await dark.app.inject({ method: 'GET', url: '/suites/readiness' })).json()).toMatchObject({
      code: 1,
      data: { ready: false, reasonCode: 'AI_MEDIA_SUITE_DISABLED' },
    });

    const production = await build({ production: true });
    expect((await production.app.inject({ method: 'GET', url: '/suites/readiness' })).json()).toMatchObject({
      code: 1,
      data: {
        ready: false,
        testOnly: true,
        reasonCode: 'AI_MEDIA_SUITE_PROVIDER_NOT_READY',
        provider: { ready: false },
      },
    });

    const unwired = await build({ referenceService: null });
    expect((await unwired.app.inject({ method: 'GET', url: '/suites/readiness' })).json()).toMatchObject({
      code: 1,
      data: {
        ready: false,
        reasonCode: 'AI_MEDIA_SUITE_SERVICE_NOT_READY',
        services: { references: false },
      },
    });

    const queueDown = await build({ runtimeReadiness: { queueReady: false, runtimeReady: false } });
    expect((await queueDown.app.inject({ method: 'GET', url: '/suites/readiness' })).json()).toMatchObject({
      code: 1,
      data: {
        ready: false,
        reasonCode: 'AI_MEDIA_SUITE_QUEUE_NOT_READY',
        services: { queue: false, runtime: false },
      },
    });

    const queueUnwired = await build({ enqueueSuiteFrontier: null });
    expect((await queueUnwired.app.inject({ method: 'GET', url: '/suites/readiness' })).json()).toMatchObject({
      code: 1,
      data: {
        ready: false,
        reasonCode: 'AI_MEDIA_SUITE_QUEUE_NOT_READY',
        services: { queue: false, runtime: true },
      },
    });
  });

  it.each([1, 2, 3, 4])(
    'prepares or resumes an owned suite from durable revision %s',
    async (initialRevision) => {
      let revision = initialRevision;
      const service = serviceMock();
      vi.mocked(service.get).mockImplementation(async () => ({ ...suite(), revision }));
      const referenceService = referenceServiceMock();
      (referenceService.internalize as any).mockImplementation(async () => {
        revision = 2;
        return { suiteId: 'suite-1', referenceCount: 1, referenceSetHash: '9'.repeat(64), replayed: false };
      });
      const promptService = promptServiceMock();
      (promptService.freeze as any).mockImplementation(async () => {
        revision = 3;
        return {
          suiteId: 'suite-1', promptSetHash: '4'.repeat(64), promptCount: 1,
          templateKey: AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY,
          templateReleaseId: 'release-7', templateSequence: 7,
          templateChecksum: '6'.repeat(64), replayed: false,
        };
      });
      const materializationService = materializationServiceMock();
      (materializationService.materialize as any).mockImplementation(async () => {
        revision = 4;
        return {
          suiteId: 'suite-1', revision: 4, status: 'PLANNED', childCount: 1,
          estimatedCostCents: 0, maximumCostCents: 0,
          materializationHash: '8'.repeat(64), children: [], replayed: false,
        };
      });
      const { app } = await build({
        service,
        referenceService,
        promptService,
        materializationService,
      });

      const response = await app.inject({
        method: 'POST',
        url: '/suites/suite-1/prepare',
        payload: { operationKey: 'suite-prepare-browser-intent-1' },
      });

      expect(response.statusCode).toBe(initialRevision === 4 ? 200 : 202);
      expect(response.json()).toMatchObject({
        code: 1,
        data: { id: 'suite-1', revision: 4 },
        replayed: initialRevision === 4,
      });
      expect(response.body).not.toContain('previewHash');
      expect(referenceService.internalize).toHaveBeenCalledTimes(initialRevision <= 1 ? 1 : 0);
      expect(promptService.freeze).toHaveBeenCalledTimes(initialRevision <= 2 ? 1 : 0);
      expect(materializationService.materialize).toHaveBeenCalledTimes(initialRevision <= 3 ? 1 : 0);
      for (const call of [
        ...(referenceService.internalize as any).mock.calls,
        ...(promptService.freeze as any).mock.calls,
        ...(materializationService.materialize as any).mock.calls,
      ]) {
        expect(call[0].operationKey).toMatch(/^suite-prepare-(references|prompts|children)-[a-f0-9]{64}$/u);
        expect(call[0].operationKey).not.toContain('browser-intent');
        expect(call[0]).toMatchObject({
          suiteId: 'suite-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
        });
      }
    },
  );

  it('reloads and continues when another prepare request wins a stage with a different operation key', async () => {
    let revision = 1;
    const service = serviceMock();
    vi.mocked(service.get).mockImplementation(async () => ({ ...suite(), revision }));
    const referenceService = referenceServiceMock();
    (referenceService.internalize as any).mockImplementation(async () => {
      revision = 2;
      throw new AiImageSuiteReferenceError(
        'AI_MEDIA_SUITE_REFERENCE_ALREADY_INTERNALIZED',
        409,
        'another request committed references',
      );
    });
    const promptService = promptServiceMock();
    (promptService.freeze as any).mockImplementation(async () => {
      revision = 3;
      return {
        suiteId: 'suite-1', promptSetHash: '4'.repeat(64), promptCount: 1,
        templateKey: AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY,
        templateReleaseId: 'release-7', templateSequence: 7,
        templateChecksum: '6'.repeat(64), replayed: false,
      };
    });
    const materializationService = materializationServiceMock();
    (materializationService.materialize as any).mockImplementation(async () => {
      revision = 4;
      return {
        suiteId: 'suite-1', revision: 4, status: 'PLANNED', childCount: 1,
        estimatedCostCents: 0, maximumCostCents: 0,
        materializationHash: '8'.repeat(64), children: [], replayed: false,
      };
    });
    const { app } = await build({ service, referenceService, promptService, materializationService });

    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/prepare',
      payload: { operationKey: 'suite-prepare-concurrent-loser' },
    });

    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ code: 1, data: { revision: 4 }, replayed: false });
    expect(referenceService.internalize).toHaveBeenCalledOnce();
    expect(promptService.freeze).toHaveBeenCalledOnce();
    expect(materializationService.materialize).toHaveBeenCalledOnce();
  });

  it('fails prepare before any partial write when a later preparation service is not installed', async () => {
    const { app, referenceService } = await build({ promptService: null });

    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/prepare',
      payload: { operationKey: 'suite-prepare-unwired-service' },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'AI_MEDIA_SUITE_PROMPT_SERVICE_NOT_READY' });
    expect(referenceService?.internalize).not.toHaveBeenCalled();
  });

  it('preflights only preparation stages that remain after the persisted revision', async () => {
    const preparedService = serviceMock();
    vi.mocked(preparedService.get).mockResolvedValue({ ...suite(), revision: 4 });
    const prepared = await build({
      service: preparedService,
      referenceService: null,
      promptService: null,
      materializationService: null,
    });
    const replay = await prepared.app.inject({
      method: 'POST',
      url: '/suites/suite-1/prepare',
      payload: { operationKey: 'suite-prepared-services-down' },
    });
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toMatchObject({ code: 1, data: { revision: 4 }, replayed: true });

    let revision = 2;
    const resumedService = serviceMock();
    vi.mocked(resumedService.get).mockImplementation(async () => ({ ...suite(), revision }));
    const promptService = promptServiceMock();
    (promptService.freeze as any).mockImplementation(async () => {
      revision = 3;
      return {
        suiteId: 'suite-1', promptSetHash: '4'.repeat(64), promptCount: 1,
        templateKey: AI_MEDIA_SUITE_GENERATION_TEMPLATE_KEY,
        templateReleaseId: 'release-7', templateSequence: 7,
        templateChecksum: '6'.repeat(64), replayed: false,
      };
    });
    const materializationService = materializationServiceMock();
    (materializationService.materialize as any).mockImplementation(async () => {
      revision = 4;
      return {
        suiteId: 'suite-1', revision: 4, status: 'PLANNED', childCount: 1,
        estimatedCostCents: 0, maximumCostCents: 0,
        materializationHash: '8'.repeat(64), children: [], replayed: false,
      };
    });
    const resumed = await build({
      service: resumedService,
      referenceService: null,
      promptService,
      materializationService,
    });
    const response = await resumed.app.inject({
      method: 'POST',
      url: '/suites/suite-1/prepare',
      payload: { operationKey: 'suite-resume-without-reference-service' },
    });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ code: 1, data: { revision: 4 }, replayed: false });
    expect(promptService.freeze).toHaveBeenCalledOnce();
    expect(materializationService.materialize).toHaveBeenCalledOnce();
  });

  it('fails claim before persistence when reference storage cannot satisfy the suite provider', async () => {
    const { app, service } = await build({
      storageReadiness: {
        ready: false,
        backend: 'ozon-cdn',
        publicHttps: true,
        reason: 'Suite references cannot use Ozon CDN without frozen shop authority',
      },
    });

    const response = await app.inject({
      method: 'POST',
      url: '/suites/claim',
      payload: {
        planId: 'plan-1',
        expectedPlanRevision: 3,
        expectedPreviewHash: 'd'.repeat(64),
        idempotencyKey: 'suite-storage-blocked-claim',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: 'AI_MEDIA_SUITE_REFERENCE_STORAGE_NOT_READY',
      msg: 'Suite references cannot use Ozon CDN without frozen shop authority',
    });
    expect(service.claim).not.toHaveBeenCalled();

    const readiness = await app.inject({ method: 'GET', url: '/suites/readiness' });
    expect(readiness.json()).toMatchObject({
      code: 1,
      data: {
        ready: false,
        reasonCode: 'AI_MEDIA_SUITE_REFERENCE_STORAGE_NOT_READY',
        storage: { ready: false, backend: 'ozon-cdn', publicHttps: true },
      },
    });
  });

  it('marks malformed provider configuration not ready and rejects claim before storage or persistence', async () => {
    const storage = vi.fn(async () => ({
      ready: true as const,
      backend: 'local' as const,
      publicHttps: false,
      reason: 'ready',
    }));
    const app = Fastify();
    const service = serviceMock();
    await app.register(aiImageSuiteRoutes, {
      service,
      referenceService: referenceServiceMock(),
      promptService: promptServiceMock(),
      materializationService: materializationServiceMock(),
      executionService: executionServiceMock(),
      enqueueSuiteFrontier: vi.fn(async () => undefined),
      production: false,
      getSuiteEnabled: async () => true,
      getMediaWorkflowEnabled: async () => true,
      getSourceListingWebMediaEnabled: async () => true,
      getProviderConfig: async () => ({
        ...providerConfig,
        providerConfigHash: 'not-a-sha256',
      }),
      getSuiteRuntimeReadiness: async () => ({ queueReady: true, runtimeReady: true }),
      getReferenceStorageReadiness: storage,
      authenticate: async (request: FastifyRequest) => {
        (request as any).user = {
          userId: 'owner-1', effectiveUserId: 'owner-1', actorUserId: 'actor-1',
        };
      },
    });

    const readiness = await app.inject({ method: 'GET', url: '/suites/readiness' });
    expect(readiness.json()).toMatchObject({
      code: 1,
      data: { ready: false, reasonCode: 'AI_MEDIA_SUITE_PROVIDER_NOT_READY' },
    });
    const claim = await app.inject({
      method: 'POST',
      url: '/suites/claim',
      payload: {
        planId: 'plan-1', expectedPlanRevision: 3,
        expectedPreviewHash: 'd'.repeat(64), idempotencyKey: 'suite-invalid-provider-claim',
      },
    });
    expect(claim.statusCode).toBe(400);
    expect(claim.json()).toMatchObject({ code: 'AI_MEDIA_SUITE_INVALID_INPUT' });
    expect(storage).not.toHaveBeenCalled();
    expect(service.claim).not.toHaveBeenCalled();
  });

  it('reviews one suite output with server-owned identities and strict input', async () => {
    const candidateService = candidateServiceMock();
    const { app } = await build({ candidateService });
    const invalid = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/slots/suite-slot-1/review',
      payload: {
        expectedWorkflowRevision: 3,
        operationKey: 'suite-review-route-1',
        outputAssetId: 'asset-1',
        decision: 'APPROVE',
        ownerUserId: 'attacker',
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(candidateService.review).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/slots/suite-slot-1/review',
      payload: {
        expectedWorkflowRevision: 3,
        operationKey: 'suite-review-route-1',
        outputAssetId: 'asset-1',
        decision: 'APPROVE',
        note: 'approved',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(candidateService.review).toHaveBeenCalledWith({
      suiteId: 'suite-1', slotId: 'suite-slot-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedWorkflowRevision: 3, operationKey: 'suite-review-route-1', outputAssetId: 'asset-1',
      decision: 'APPROVE', note: 'approved', production: false,
    });
    expect(response.json()).toMatchObject({ code: 1, replayed: false, data: { id: 'suite-1' } });
  });

  it('applies only the server-derived collect append target', async () => {
    const candidateService = candidateServiceMock();
    const { app } = await build({ candidateService });
    const invalid = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/slots/suite-slot-1/apply',
      payload: {
        expectedWorkflowRevision: 4,
        operationKey: 'suite-apply-route-1',
        expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
        mode: 'replace',
        targetId: 'attacker-target',
      },
    });
    expect(invalid.statusCode).toBe(400);
    expect(candidateService.apply).not.toHaveBeenCalled();

    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/slots/suite-slot-1/apply',
      payload: {
        expectedWorkflowRevision: 4,
        operationKey: 'suite-apply-route-1',
        expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(candidateService.apply).toHaveBeenCalledWith({
      suiteId: 'suite-1', slotId: 'suite-slot-1', ownerUserId: 'owner-1', actorUserId: 'actor-1',
      expectedWorkflowRevision: 4, operationKey: 'suite-apply-route-1',
      expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z', production: false,
    });
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        suite: { id: 'suite-1' },
        application: {
          jobId: 'job-1', outputAssetId: 'asset-1', mode: 'append',
          targetType: 'collect', targetId: 'goods-1',
        },
      },
      replayed: false,
    });
  });

  it('routes default suite application through the immutable mutation ledger with suite authority', async () => {
    const current: any = suite();
    current.slots[0]!.childWorkflowId = 'workflow-1';
    const service = serviceMock();
    vi.mocked(service.get).mockResolvedValue(current as any);
    const applicationService = {
      apply: vi.fn(async () => ({
        contractVersion: 'ai-media-application-mutation/v1',
        application: {
          id: 'mutation-1', kind: 'APPLY', workflowId: 'workflow-1', jobId: 'job-1',
          assetId: 'asset-1', mode: 'append', targetType: 'collect', targetId: 'goods-1',
          createdAt: new Date('2026-07-20T01:01:00.000Z'),
        },
        target: {
          images: ['/original.png', '/suite-output.png'], mainImage: '/original.png',
          editedImages: ['/suite-output.png'], updatedAt: new Date('2026-07-20T01:01:00.001Z'),
        },
        replayed: false,
      })),
    };
    const { app, candidateService } = await build({ service, applicationService });
    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/slots/suite-slot-1/apply',
      payload: {
        expectedWorkflowRevision: 4,
        operationKey: 'suite-ledger-apply-1',
        expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(200);
    expect(applicationService.apply).toHaveBeenCalledWith({
      workflowId: 'workflow-1',
      ownerUserId: 'owner-1',
      actorUserId: 'actor-1',
      expectedWorkflowRevision: 4,
      expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
      operationKey: 'suite-ledger-apply-1',
      mode: 'append',
      production: false,
      suiteId: 'suite-1',
      suiteSlotId: 'suite-slot-1',
    });
    expect(candidateService.apply).not.toHaveBeenCalled();
    expect(response.json()).toMatchObject({
      code: 1,
      data: {
        application: {
          id: 'mutation-1', state: 'APPLIED', legacy: false,
          suiteId: 'suite-1', slotId: 'suite-slot-1', workflowId: 'workflow-1',
        },
      },
    });
  });

  it('maps a mutation-ledger production fake rejection to service unavailable', async () => {
    const current: any = suite();
    current.slots[0]!.childWorkflowId = 'workflow-1';
    const service = serviceMock();
    vi.mocked(service.get).mockResolvedValue(current as any);
    const applicationService = {
      apply: vi.fn(async () => {
        throw new AiMediaApplicationMutationError(
          'PROVIDER_NOT_READY',
          'Test-only AI media suite candidates cannot be applied in production',
        );
      }),
    };
    const { app } = await build({ service, applicationService, production: true });

    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/slots/suite-slot-1/apply',
      payload: {
        expectedWorkflowRevision: 4,
        operationKey: 'suite-ledger-fake-production',
        expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: 'PROVIDER_NOT_READY',
      msg: 'Test-only AI media suite candidates cannot be applied in production',
    });
  });

  it('keeps an original suite apply replay rolled back after the mutation was reversed', async () => {
    const base: any = suite();
    base.slots[0]!.childWorkflowId = 'workflow-1';
    const applicationMutation = {
      id: 'mutation-1',
      revision: 1,
      kind: 'APPLY',
      workflowId: 'workflow-1',
      jobId: 'job-1',
      assetId: 'asset-1',
      mode: 'append',
      targetType: 'collect',
      targetId: 'goods-1',
      createdAt: new Date('2026-07-20T01:01:00.000Z'),
      targetVersionAfter: new Date('2026-07-20T01:01:00.001Z'),
      rolledBackById: null,
      rolledBackAt: null,
      rollbackTargetVersionAfter: null,
    };
    const suiteWithApplication = (rolledBack: boolean) => {
      const value: any = suite();
      value.slots[0]!.childWorkflowId = 'workflow-1';
      value.slots[0]!.childWorkflow = {
        id: 'workflow-1',
        contextId: 'goods-1',
        jobs: [{
          id: 'job-1',
          assets: [{
            id: 'asset-1', ownerUserId: 'owner-1', url: '/suite-output.png',
          }],
        }],
        applicationMutations: [{
          ...applicationMutation,
          mode: 'APPEND',
          rolledBackBy: rolledBack ? {
            id: 'rollback-1',
            createdAt: new Date('2026-07-20T01:02:00.000Z'),
            targetVersionAfter: new Date('2026-07-20T01:02:00.001Z'),
          } : null,
        }],
      };
      return value;
    };
    const service = serviceMock();
    vi.mocked(service.get)
      .mockResolvedValueOnce(base)
      .mockResolvedValueOnce(suiteWithApplication(false))
      .mockResolvedValueOnce(suiteWithApplication(true))
      .mockResolvedValueOnce(suiteWithApplication(true));
    const applicationService = {
      apply: vi.fn()
        .mockResolvedValueOnce({
          contractVersion: 'ai-media-application-mutation/v1',
          application: applicationMutation,
          target: {
            images: ['/original.png', '/suite-output.png'],
            mainImage: '/original.png',
            editedImages: ['/suite-output.png'],
            updatedAt: new Date('2026-07-20T01:01:00.001Z'),
          },
          replayed: false,
        })
        .mockResolvedValueOnce({
          contractVersion: 'ai-media-application-mutation/v1',
          application: {
            ...applicationMutation,
            rolledBackById: 'rollback-1',
            rolledBackAt: new Date('2026-07-20T01:02:00.000Z'),
            rollbackTargetVersionAfter: new Date('2026-07-20T01:02:00.001Z'),
          },
          target: {
            images: ['/original.png'],
            mainImage: '/original.png',
            editedImages: [],
            updatedAt: new Date('2026-07-20T01:02:00.001Z'),
          },
          replayed: true,
        }),
    };
    const { app } = await build({ service, applicationService });
    const request = {
      method: 'POST' as const,
      url: '/suites/suite-1/slots/suite-slot-1/apply',
      payload: {
        expectedWorkflowRevision: 4,
        operationKey: 'suite-ledger-replay-1',
        expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
      },
    };

    const applied = await app.inject(request);
    const replayed = await app.inject(request);

    expect(applied.json()).toMatchObject({
      replayed: false,
      data: {
        application: { id: 'mutation-1', revision: 1, state: 'APPLIED' },
        suite: { slots: [{ application: { id: 'mutation-1', revision: 1, state: 'APPLIED' } }] },
      },
    });
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json()).toMatchObject({
      replayed: true,
      data: {
        application: {
          id: 'mutation-1', revision: 2, state: 'ROLLED_BACK',
          rolledBackAt: '2026-07-20T01:02:00.000Z',
          targetUpdatedAt: '2026-07-20T01:02:00.001Z',
        },
        suite: {
          slots: [{
            application: {
              id: 'mutation-1', revision: 2, state: 'ROLLED_BACK',
              rolledBackAt: '2026-07-20T01:02:00.000Z',
              targetUpdatedAt: '2026-07-20T01:02:00.001Z',
            },
          }],
        },
      },
    });
    expect(applicationService.apply).toHaveBeenCalledTimes(2);
  });

  it('preserves candidate target conflict data for the client refresh path', async () => {
    const candidateService = candidateServiceMock();
    vi.mocked(candidateService.apply).mockRejectedValueOnce(new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_TARGET_CONFLICT',
      'Product images were updated by another operation',
      409,
      { targetUpdatedAt: new Date('2026-07-20T02:00:00.000Z') },
    ));
    const { app } = await build({ candidateService });

    const response = await app.inject({
      method: 'POST',
      url: '/suites/suite-1/slots/suite-slot-1/apply',
      payload: {
        expectedWorkflowRevision: 4,
        operationKey: 'suite-apply-target-conflict',
        expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
      },
    });

    expect(response.statusCode).toBe(409);
    expect(response.json()).toEqual({
      code: 'AI_MEDIA_SUITE_CANDIDATE_TARGET_CONFLICT',
      msg: 'Product images were updated by another operation',
      data: { targetUpdatedAt: '2026-07-20T02:00:00.000Z' },
    });
  });

  it('fails review and application closed while suite writes are dark', async () => {
    const candidateService = candidateServiceMock();
    const { app } = await build({ candidateService, suiteEnabled: false });
    const review = await app.inject({
      method: 'POST', url: '/suites/suite-1/slots/suite-slot-1/review',
      payload: {
        expectedWorkflowRevision: 3, operationKey: 'suite-review-dark-1',
        outputAssetId: 'asset-1', decision: 'REJECT',
      },
    });
    const apply = await app.inject({
      method: 'POST', url: '/suites/suite-1/slots/suite-slot-1/apply',
      payload: {
        expectedWorkflowRevision: 4, operationKey: 'suite-apply-dark-1',
        expectedTargetUpdatedAt: '2026-07-20T01:00:00.000Z',
      },
    });

    expect(review.statusCode).toBe(503);
    expect(apply.statusCode).toBe(503);
    expect(review.json()).toMatchObject({ code: 'AI_MEDIA_SUITE_DISABLED' });
    expect(candidateService.review).not.toHaveBeenCalled();
    expect(candidateService.apply).not.toHaveBeenCalled();
  });

  it('maps an in-transaction production fake rejection without refreshing suite state', async () => {
    const candidateService = candidateServiceMock();
    vi.mocked(candidateService.review).mockRejectedValueOnce(new AiImageSuiteCandidateError(
      'AI_MEDIA_SUITE_CANDIDATE_PROVIDER_NOT_READY', 'fake rejected', 503,
    ));
    const service = serviceMock();
    const { app } = await build({ candidateService, service, production: true });

    const response = await app.inject({
      method: 'POST', url: '/suites/suite-1/slots/suite-slot-1/review',
      payload: {
        expectedWorkflowRevision: 3, operationKey: 'suite-review-fake-prod',
        outputAssetId: 'asset-1', decision: 'APPROVE',
      },
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      code: 'AI_MEDIA_SUITE_CANDIDATE_PROVIDER_NOT_READY', msg: 'fake rejected',
    });
    expect(service.get).not.toHaveBeenCalled();
  });

  it('projects bounded slot references, workflow review and exact current application state', async () => {
    const service = serviceMock();
    const current = suite() as any;
    current.status = 'SUCCEEDED';
    current.revision = 7;
    current.referenceAssets = [{
      candidateId: 'main-1', ownerUserId: 'owner-1',
      asset: {
        id: 'source-asset-1', ownerUserId: 'owner-1', url: '/uploads/source.png',
        mimeType: 'image/png', width: 900, height: 1200,
      },
    }];
    const applicationPayload = {
      version: 'ai-image-suite-candidate-application/v1', requestFingerprint: 'a'.repeat(64),
      suiteId: 'suite-1', slotId: 'suite-slot-1', workflowId: 'workflow-1', jobId: 'job-1',
      outputAssetId: 'asset-1', targetType: 'collect', targetId: 'goods-1', mode: 'append',
      appliedAt: '2026-07-20T01:01:00.000Z', targetUpdatedAt: '2026-07-20T01:01:00.000Z',
    };
    current.slots[0] = {
      ...current.slots[0], status: 'SUCCEEDED', attempt: 1, revision: 4,
      childWorkflowId: 'workflow-1',
      childWorkflow: {
        id: 'workflow-1', revision: 5, reviewStatus: 'APPROVED',
        selectedOutputAssetId: 'asset-1', reviewedAt: new Date('2026-07-20T01:00:00.000Z'),
        jobs: [{ id: 'job-1', assets: [{
          id: 'asset-1', ownerUserId: 'owner-1', aiImageJobId: 'job-1',
          url: '/uploads/output.png', mimeType: 'image/png', width: 900, height: 1200,
        }] }],
        events: [{
          eventType: 'SUITE_CANDIDATE_APPLIED', jobId: 'job-1', assetId: 'asset-1',
          payload: applicationPayload,
          payloadHash: hashAiMediaPlanningJson(applicationPayload),
        }],
      },
    };
    vi.mocked(service.get).mockResolvedValueOnce(current);
    const { app } = await build({ service });

    const response = await app.inject({ method: 'GET', url: '/suites/suite-1' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1,
      data: { slots: [{
        workflowRevision: 5, reviewStatus: 'APPROVED', selectedOutputAssetId: 'asset-1',
        referenceAssets: [{ candidateId: 'main-1', id: 'source-asset-1', url: '/uploads/source.png' }],
        application: { jobId: 'job-1', outputAssetId: 'asset-1', appliedAt: '2026-07-20T01:01:00.000Z' },
      }] },
    });
  });
});

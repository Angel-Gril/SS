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

async function build(options: {
  service?: AiImageSuiteService;
  referenceService?: Pick<AiImageSuiteReferenceService, 'internalize'> | null;
  promptService?: Pick<AiImageSuitePromptService, 'freeze'> | null;
  materializationService?: Pick<AiImageSuiteMaterializationService, 'materialize'> | null;
  executionService?: Pick<
    AiImageSuiteExecutionService,
    'dispatch' | 'cancel' | 'retryFailedSlot'
  > | null;
  enqueueSuiteFrontier?: ((suiteId: string) => Promise<void>) | null;
  suiteEnabled?: boolean;
  workflowEnabled?: boolean;
  webMediaEnabled?: boolean;
  production?: boolean;
  config?: AiImageSuiteProviderConfig;
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
  const enqueueSuiteFrontier = options.enqueueSuiteFrontier === null
    ? undefined
    : options.enqueueSuiteFrontier || vi.fn(async () => undefined);
  await app.register(aiImageSuiteRoutes, {
    service,
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
    expect(promptResponse.statusCode).toBe(503);
    expect(materializationResponse.statusCode).toBe(503);
    expect(dispatchResponse.statusCode).toBe(503);
    expect(retryResponse.statusCode).toBe(503);
    expect(previewResponse.json()).toMatchObject({ code });
    expect(claimResponse.json()).toMatchObject({ code });
    expect(internalizeResponse.json()).toMatchObject({ code });
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
    expect(response.json()).toMatchObject({ code: 1, data: { id: 'suite-1' } });
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
});

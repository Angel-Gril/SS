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

async function build(options: {
  service?: AiImageSuiteService;
  referenceService?: Pick<AiImageSuiteReferenceService, 'internalize'> | null;
  promptService?: Pick<AiImageSuitePromptService, 'freeze'> | null;
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
  await app.register(aiImageSuiteRoutes, {
    service,
    ...(referenceService ? { referenceService } : {}),
    ...(promptService ? { promptService } : {}),
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
  return { app, service, referenceService, promptService };
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

  it.each([
    [{ suiteEnabled: false }, 'AI_MEDIA_SUITE_DISABLED'],
    [{ suiteEnabled: true, workflowEnabled: false }, 'AI_MEDIA_WORKFLOW_DISABLED'],
    [{ suiteEnabled: true, workflowEnabled: true, webMediaEnabled: false }, 'SOURCE_LISTING_WEB_MEDIA_DISABLED'],
  ] as const)('fails closed before suite writes when a write gate is disabled', async (flags, code) => {
    const { app, service, referenceService, promptService } = await build(flags);
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

    expect(previewResponse.statusCode).toBe(503);
    expect(claimResponse.statusCode).toBe(503);
    expect(internalizeResponse.statusCode).toBe(503);
    expect(promptResponse.statusCode).toBe(503);
    expect(previewResponse.json()).toMatchObject({ code });
    expect(claimResponse.json()).toMatchObject({ code });
    expect(internalizeResponse.json()).toMatchObject({ code });
    expect(promptResponse.json()).toMatchObject({ code });
    expect(service.preview).not.toHaveBeenCalled();
    expect(service.claim).not.toHaveBeenCalled();
    expect(referenceService?.internalize).not.toHaveBeenCalled();
    expect(promptService?.freeze).not.toHaveBeenCalled();
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

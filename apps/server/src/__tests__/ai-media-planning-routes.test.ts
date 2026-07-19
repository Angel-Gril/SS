import Fastify, { type FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { aiMediaPlanningRoutes } from '../routes/ai-media-plans.js';
import { AiMediaPlanningError, type AiMediaPlanningService } from '../services/ai-media-planning.js';

function version() {
  return {
    id: 'version-1',
    planId: 'plan-1',
    ownerUserId: 'owner-1',
    version: 1,
    sourceCaptureSnapshotId: 'snapshot-1',
    sourceCaptureHash: 'a'.repeat(64),
    sourceProfileHash: 'b'.repeat(64),
    sourceSchemaVersion: 'source-product-capture-v2',
    inputFingerprint: 'c'.repeat(64),
    planSchemaVersion: 'ai-image-prompt-plan/2.0',
    plannerVersion: 'ai-media-rule-planner/v1',
    mode: 'RULE_BASED' as const,
    fallbackReason: null,
    curation: {
      version: '1.0', mode: 'deterministic', consideredCandidateIds: ['media-1'],
      selectedCandidateIds: ['media-1'], decisions: [{
        candidateId: 'media-1', disposition: 'keep', reasonCodes: [], translation: 'skip',
        contentRole: 'identity', score: 10, duplicateOfCandidateId: null, continuity: null,
        compiledPrompt: 'must not leak',
      }],
      selectionTarget: { minimum: 1, maximum: 14, eligibleCount: 1, selectedCount: 1, met: true },
      discardedModelCandidateIds: [], diagnostics: [], fallbackReason: null,
    },
    curationHash: 'd'.repeat(64),
    visionEvidence: {
      version: '1.0', mode: 'fallback', fallbackReason: null,
      verifiedFacts: [{ path: '/facts/title', value: 'Bottle', evidenceIds: ['evidence-1'] }],
      images: [], unsupportedClaims: [], discardedCandidateIds: [], diagnostics: [],
    },
    visionEvidenceHash: 'e'.repeat(64),
    planHash: 'f'.repeat(64),
    planPayload: {
      version: '2.0', mode: 'rule_based', manualSelectionAllowed: true, recoverable: true,
      compatibilityGroups: [{ groupKey: 'group-1', identitySignature: '{}', skuKeys: ['sku-1'] }],
      slots: [{
        slotKey: 'sku:sku-1:hero', goal: 'sku_hero', status: 'READY', aspectRatio: '3:4',
        ownership: { level: 'sku', key: 'sku-1' },
        references: [{ candidateId: 'media-1', evidenceIds: ['evidence-1'] }],
        factEvidenceIds: ['evidence-1'], safetyConstraints: ['preserve_product_identity'],
        acceptanceChecks: ['product_matches_references'],
      }],
      verifiedFacts: [{ path: '/facts/title', value: 'Bottle', evidenceIds: ['evidence-1'] }],
      diagnostics: [], fallbackReason: null,
      compiledPrompt: 'must not leak',
    },
    planBytes: 100,
    provenance: {
      version: 'ai-media-planning-provenance/v1', mode: 'RULE_BASED',
      engineVersion: 'ai-media-rule-planner/v1', rules: { curation: 'deterministic/v1' },
      provider: null, promptTemplates: [{ compiledPrompt: 'must not leak' }],
    },
    provenanceHash: '1'.repeat(64),
    createdAt: new Date('2026-07-19T00:00:00.000Z'),
  };
}

function plan() {
  const currentVersion = version();
  return {
    id: 'plan-1', ownerUserId: 'owner-1', actorUserId: 'actor-1', sourceSubjectId: 'subject-1',
    contextType: 'collect', contextId: 'goods-1', revision: 1, latestVersion: 1,
    currentVersionId: currentVersion.id, approvedVersionId: null, reviewStatus: 'PENDING' as const,
    staleAt: null, staleAgainstFingerprint: null,
    staleReasons: {
      version: 'ai-media-plan-stale/v1', reasons: ['SOURCE_CAPTURE_HASH_CHANGED'],
      planned: { captureHash: 'secret-hash' }, latest: { captureHash: 'other-secret-hash' },
    },
    reviewedByUserId: null, reviewedAt: null,
    createdAt: new Date('2026-07-19T00:00:00.000Z'), updatedAt: new Date('2026-07-19T00:00:00.000Z'),
    currentVersion, approvedVersion: null,
  };
}

function serviceMock() {
  return {
    createCurrentRuleBased: vi.fn().mockResolvedValue({ plan: plan(), replayed: false, sourceCurrent: true }),
    getCurrentByContext: vi.fn().mockResolvedValue({ plan: plan(), sourceCurrent: true }),
    getWithSourceStatus: vi.fn().mockResolvedValue({ plan: plan(), sourceCurrent: true }),
    listVersions: vi.fn().mockResolvedValue([version()]),
    review: vi.fn().mockResolvedValue({ plan: plan(), replayed: false, sourceCurrent: true }),
  } as unknown as AiMediaPlanningService;
}

async function build(
  service = serviceMock(),
  options: { workflowEnabled?: boolean; webMediaEnabled?: boolean } = {},
) {
  const app = Fastify();
  await app.register(aiMediaPlanningRoutes, {
    service,
    getMediaWorkflowEnabled: async () => options.workflowEnabled ?? true,
    getSourceListingWebMediaEnabled: async () => options.webMediaEnabled ?? true,
    authenticate: async (request: FastifyRequest) => {
      (request as any).user = { userId: 'owner-1', actorUserId: 'actor-1' };
    },
  });
  return { app, service };
}

describe('AI media planning routes', () => {
  it('returns owner-scoped current plans with curation, slots and evidence while stripping secrets', async () => {
    const { app, service } = await build();
    const response = await app.inject({ method: 'GET', url: '/plans/current?contextType=collect&contextId=goods-1' });

    expect(response.statusCode).toBe(200);
    expect(service.getCurrentByContext).toHaveBeenCalledWith('owner-1', { type: 'collect', id: 'goods-1' });
    const body = response.json();
    expect(body.data).toMatchObject({ sourceCurrent: true, currentVersion: {
      curation: { decisions: [{ candidateId: 'media-1', disposition: 'keep' }] },
      planPayload: { compatibilityGroups: [{ groupKey: 'group-1' }], slots: [{ slotKey: 'sku:sku-1:hero' }] },
    } });
    expect(body.data).not.toHaveProperty('ownerUserId');
    expect(body.data).not.toHaveProperty('actorUserId');
    expect(JSON.stringify(body)).not.toContain('must not leak');
    expect(JSON.stringify(body)).not.toContain('secret-hash');
    expect(body.data.staleReasons).toEqual(['SOURCE_CAPTURE_HASH_CHANGED']);
  });

  it('returns an empty current context without manufacturing a plan', async () => {
    const service = serviceMock();
    (service.getCurrentByContext as any).mockResolvedValueOnce({ plan: null, sourceCurrent: null });
    const { app } = await build(service);
    const response = await app.inject({ method: 'GET', url: '/plans/current?contextId=goods-empty' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ code: 1, data: null });
  });

  it('fails closed for create while rollout is disabled and does not call the planner', async () => {
    const service = serviceMock();
    const { app } = await build(service, { workflowEnabled: false });
    const response = await app.inject({ method: 'POST', url: '/plans', payload: {
      context: { type: 'collect', id: 'goods-1' }, idempotencyKey: 'plan-create-off',
      candidateMediaKeys: ['media-1'],
    } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'AI_MEDIA_WORKFLOW_DISABLED' });
    expect(service.createCurrentRuleBased).not.toHaveBeenCalled();
  });

  it('fails closed for create while the Web media rollout is disabled', async () => {
    const service = serviceMock();
    const { app } = await build(service, { workflowEnabled: true, webMediaEnabled: false });
    const response = await app.inject({ method: 'POST', url: '/plans', payload: {
      context: { type: 'collect', id: 'goods-1' }, idempotencyKey: 'plan-create-web-off',
    } });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ code: 'SOURCE_LISTING_WEB_MEDIA_DISABLED' });
    expect(service.createCurrentRuleBased).not.toHaveBeenCalled();
  });

  it('creates a provider-free plan from a context and derives owner/actor server-side', async () => {
    const service = serviceMock();
    (service.createCurrentRuleBased as any).mockResolvedValueOnce({
      plan: plan(), replayed: false, sourceCurrent: false,
    });
    const { app } = await build(service);
    const response = await app.inject({ method: 'POST', url: '/plans', payload: {
      context: { type: 'collect', id: 'goods-1' }, idempotencyKey: 'plan-create-on',
      candidateMediaKeys: ['media-1'], galleryGoals: ['scene'],
    } });
    expect(response.statusCode).toBe(202);
    expect(response.json()).toMatchObject({ code: 1, data: { sourceCurrent: false } });
    expect(service.createCurrentRuleBased).toHaveBeenCalledWith(expect.objectContaining({
      ownerUserId: 'owner-1', actorUserId: 'actor-1', context: { type: 'collect', id: 'goods-1' },
    }));
    expect(service.createCurrentRuleBased).toHaveBeenCalledWith(expect.not.objectContaining({
      sourceSubjectId: expect.anything(), sourceCaptureSnapshotId: expect.anything(),
    }));
  });

  it('projects the current source status on an idempotent create replay', async () => {
    const service = serviceMock();
    (service.createCurrentRuleBased as any).mockResolvedValueOnce({
      plan: plan(), replayed: true, sourceCurrent: false,
    });
    const { app } = await build(service);
    const response = await app.inject({ method: 'POST', url: '/plans', payload: {
      context: { type: 'collect', id: 'goods-1' }, idempotencyKey: 'plan-create-replay',
    } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1, replayed: true, data: { id: 'plan-1', sourceCurrent: false },
    });
  });

  it('maps review CAS conflicts and never accepts a client owner', async () => {
    const service = serviceMock();
    (service.review as any).mockRejectedValueOnce(new AiMediaPlanningError(
      'AI_MEDIA_PLANNING_REVISION_CONFLICT', 'revision changed', 409,
    ));
    const { app } = await build(service);
    const response = await app.inject({ method: 'POST', url: '/plans/plan-1/review', payload: {
      expectedRevision: 1, operationKey: 'review-op-1', decision: 'APPROVE', note: null, ownerUserId: 'attacker',
    } });
    expect(response.statusCode).toBe(400);
    expect(service.review).not.toHaveBeenCalled();

    const success = await app.inject({ method: 'POST', url: '/plans/plan-1/review', payload: {
      expectedRevision: 1, operationKey: 'review-op-1', decision: 'APPROVE', note: null,
    } });
    expect(success.statusCode).toBe(409);
    expect(success.json()).toMatchObject({ code: 'AI_MEDIA_PLANNING_REVISION_CONFLICT' });
  });

  it('fails closed for review while either planning rollout is disabled', async () => {
    const workflowService = serviceMock();
    const workflowDisabled = await build(workflowService, { workflowEnabled: false });
    const workflowResponse = await workflowDisabled.app.inject({
      method: 'POST', url: '/plans/plan-1/review', payload: {
        expectedRevision: 1, operationKey: 'review-rollout-off', decision: 'REJECT', note: null,
      },
    });
    expect(workflowResponse.statusCode).toBe(503);
    expect(workflowService.review).not.toHaveBeenCalled();

    const webService = serviceMock();
    const webDisabled = await build(webService, { workflowEnabled: true, webMediaEnabled: false });
    const webResponse = await webDisabled.app.inject({
      method: 'POST', url: '/plans/plan-1/review', payload: {
        expectedRevision: 1, operationKey: 'review-web-rollout-off', decision: 'REJECT', note: null,
      },
    });
    expect(webResponse.statusCode).toBe(503);
    expect(webService.review).not.toHaveBeenCalled();
  });

  it('returns the source status projected by the review service', async () => {
    const service = serviceMock();
    (service.review as any).mockResolvedValueOnce({
      plan: plan(), replayed: true, sourceCurrent: false,
    });
    const { app } = await build(service);
    const response = await app.inject({ method: 'POST', url: '/plans/plan-1/review', payload: {
      expectedRevision: 1, operationKey: 'review-replay-1', decision: 'APPROVE', note: null,
    } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      code: 1, replayed: true, data: { id: 'plan-1', sourceCurrent: false },
    });
  });

  it('lists owner-scoped versions and maps missing plans to 404', async () => {
    const service = serviceMock();
    const { app } = await build(service);
    const versions = await app.inject({ method: 'GET', url: '/plans/plan-1/versions' });
    expect(versions.statusCode).toBe(200);
    expect(versions.json().data[0]).toHaveProperty('planPayload.slots');
    expect(JSON.stringify(versions.json())).not.toContain('must not leak');
    expect(service.listVersions).toHaveBeenCalledWith('plan-1', 'owner-1', {
      limit: 10,
    });

    const tooLarge = await app.inject({ method: 'GET', url: '/plans/plan-1/versions?limit=21' });
    expect(tooLarge.statusCode).toBe(400);
    expect(service.listVersions).toHaveBeenCalledTimes(1);

    const paged = await app.inject({
      method: 'GET', url: '/plans/plan-1/versions?limit=1&beforeVersion=3',
    });
    expect(paged.statusCode).toBe(200);
    expect(service.listVersions).toHaveBeenLastCalledWith('plan-1', 'owner-1', {
      limit: 1, beforeVersion: 3,
    });
    expect(paged.headers['x-ai-media-next-before-version']).toBe('1');

    (service.getWithSourceStatus as any).mockRejectedValueOnce(new AiMediaPlanningError(
      'AI_MEDIA_PLANNING_NOT_FOUND', 'missing', 404,
    ));
    const missing = await app.inject({ method: 'GET', url: '/plans/other-owner-plan' });
    expect(missing.statusCode).toBe(404);
    expect(service.getWithSourceStatus).toHaveBeenCalledWith('other-owner-plan', 'owner-1');
  });
});
